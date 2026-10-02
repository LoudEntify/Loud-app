// lib/pipeline/lifecycle.js
// ─────────────────────────────────────────────────────────────
// The broadcast lifecycle, written against a store so it runs identically
// on the real database (app/api/artist/*) and in tests/lifecycle.test.mjs.
//
// PRD 141: "Broadcast created when the show is scheduled, live at the
// slot, ended with the show. YouTube's own live chat and comments are
// switched off where the API allows. In Versus, viewer counts are
// aggregated across both." PRD 142: "If YouTube delivery drops, artists
// keep performing, recording continues, viewers see an honest reconnecting
// state, and the egress retries the same broadcast then creates a new one.
// Every step is audited." Stream keys: per show, never logged, never sent
// to a client, rotated afterwards.
//
// store = {
//   loadShow, updateShow, listBroadcasts(showId), insertBroadcast, updateBroadcast,
//   apiFor(userId) -> { api, provider }, storeStreamKey(broadcastId, key, ingestUrl),
//   readStreamKey(broadcastId), rotateStreamKey(broadcastId), audit(event), now()
// }
// ─────────────────────────────────────────────────────────────
export const RETRY_SAME_BROADCAST = 3;

async function audit(store, e) { try { await store.audit(e); } catch { /* the show must never stop because the audit write failed; logged by lib/audit.js */ } }

/** At schedule time: one broadcast per channel (two in Versus). */
export async function createBroadcastsForShow(store, { showId, correlationId }) {
  const show = await store.loadShow(showId);
  if (!show) return { error: 'no_show' };
  const channels = [show.artist_id, show.artist_b_id].filter(Boolean);
  const created = [];
  for (const userId of channels) {
    const existing = (await store.listBroadcasts(showId)).find((b) => b.channel_user_id === userId && !['failed', 'revoked', 'complete'].includes(b.state));
    if (existing) { created.push(existing); continue; }
    const { api, provider, error } = await store.apiFor(userId);
    if (!api) {
      const row = await store.insertBroadcast({ show_id: showId, channel_user_id: userId, state: 'failed', last_error: `not connected: ${error?.message || 'no YouTube connection'}`, provider: provider || 'google' });
      await audit(store, { actorType: 'system', actorId: userId, action: 'broadcast.create_failed', subjectType: 'broadcast', subjectId: row.id, correlationId, metadata: { reason: 'not_connected' } });
      created.push(row); continue;
    }
    try {
      const b = await api.createBroadcast({ title: show.title || 'Live on Loudentify', scheduledStartTime: show.slated_at, privacy: 'public', disableChat: true });
      const s = await api.createStream({ title: `${show.title || 'Loudentify'} ${showId.slice(0, 8)}` });
      await api.bindStream({ broadcastId: b.broadcastId, streamId: s.streamId });
      const row = await store.insertBroadcast({ show_id: showId, channel_user_id: userId, youtube_broadcast_id: b.broadcastId, youtube_video_id: b.videoId, youtube_stream_id: s.streamId, state: 'ready', chat_disabled: b.chatDisabled, provider });
      await store.storeStreamKey(row.id, s.streamKey, s.ingestUrl);
      await audit(store, { actorType: 'system', actorId: userId, action: 'broadcast.created', subjectType: 'broadcast', subjectId: row.id, correlationId, after: { youtube_broadcast_id: b.broadcastId, show_id: showId, chat_disabled: b.chatDisabled } });
      created.push(row);
    } catch (e) {
      const row = await store.insertBroadcast({ show_id: showId, channel_user_id: userId, state: 'failed', last_error: String(e.message).slice(0, 200), provider });
      await audit(store, { actorType: 'system', actorId: userId, action: 'broadcast.create_failed', subjectType: 'broadcast', subjectId: row.id, correlationId, metadata: { code: e.code || null } });
      created.push(row);
    }
  }
  // the embed id the viewer uses: the primary artist's broadcast
  const primary = created.find((b) => b.channel_user_id === show.artist_id && b.youtube_video_id);
  if (primary) await store.updateShow(showId, { youtube_video_id: primary.youtube_video_id, youtube_broadcast_id: primary.youtube_broadcast_id });
  return { broadcasts: created };
}

/** At the slot: start the egress to every ready broadcast, transition them live. */
export async function goLive(store, egress, { showId, correlationId, trainingAllowed = true }) {
  const show = await store.loadShow(showId);
  if (!show) return { error: 'no_show' };
  let broadcasts = (await store.listBroadcasts(showId)).filter((b) => b.state === 'ready');
  if (!broadcasts.length) { await createBroadcastsForShow(store, { showId, correlationId }); broadcasts = (await store.listBroadcasts(showId)).filter((b) => b.state === 'ready'); }
  const targets = [];
  for (const b of broadcasts) {
    const key = await store.readStreamKey(b.id);
    if (key) targets.push({ broadcastId: b.id, ingestUrl: key.ingest_url, streamKey: key.key_enc });
  }
  // The recording starts whether or not any YouTube target is ready: the show must never stop.
  const started = await egress.start({ showId, targets, trainingAllowed });
  await store.updateShow(showId, { actual_started_at: show.actual_started_at || new Date(store.now()).toISOString(), state: 'live', delivery_state: targets.length ? 'ok' : 'failed' });
  await audit(store, { actorType: 'artist', actorId: show.artist_id, action: 'show.started', subjectType: 'show', subjectId: showId, correlationId, after: { targets: targets.length, recording: started.recordingPath } });
  for (const b of broadcasts) {
    const { api } = await store.apiFor(b.channel_user_id);
    try {
      await api.transition({ broadcastId: b.youtube_broadcast_id, status: 'live' });
      await store.updateBroadcast(b.id, { state: 'live', delivery_state: 'ok', started_at: new Date(store.now()).toISOString() });
      await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'broadcast.started', subjectType: 'broadcast', subjectId: b.id, correlationId });
    } catch (e) {
      // e.g. a rejected stream key: the show carries on, delivery is reported honestly
      await store.updateBroadcast(b.id, { state: 'failed', delivery_state: 'failed', last_error: String(e.message).slice(0, 200), attempts: (b.attempts || 0) + 1 });
      await store.updateShow(showId, { delivery_state: 'reconnecting' });
      await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'broadcast.start_failed', subjectType: 'broadcast', subjectId: b.id, correlationId, metadata: { code: e.code || null } });
    }
  }
  return { ok: true, recordingPath: started.recordingPath, targets: targets.length };
}

/**
 * Called on every tick while live (the console polls). Checks delivery per
 * broadcast; on a drop retries the same broadcast up to RETRY_SAME_BROADCAST
 * ticks, then creates a new one and retargets the egress. Returns the
 * delivery summary for the console and the viewer.
 */
export async function deliveryTick(store, egress, { showId, correlationId }) {
  const show = await store.loadShow(showId);
  if (!show || show.actual_ended_at) return { state: 'ended' };
  const broadcasts = (await store.listBroadcasts(showId)).filter((b) => ['live', 'failed'].includes(b.state) && b.state !== 'complete');
  const health = egress.health();
  let overall = 'ok';
  for (const b of broadcasts) {
    if (b.state === 'failed' && (b.attempts || 0) > RETRY_SAME_BROADCAST) continue;
    const { api } = await store.apiFor(b.channel_user_id);
    if (!api) continue;
    let ingest = 'good';
    try { ingest = (await api.ingestHealth({ streamId: b.youtube_stream_id })).status; } catch { ingest = 'noData'; }
    const egressSays = health.delivering?.[b.id];
    const healthy = ingest === 'good' && egressSays !== 'noData' && b.state === 'live';
    if (healthy) {
      if (b.delivery_state !== 'ok') { await store.updateBroadcast(b.id, { delivery_state: 'ok', attempts: 0 }); await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'broadcast.delivery_recovered', subjectType: 'broadcast', subjectId: b.id, correlationId }); }
      continue;
    }
    overall = 'reconnecting';
    const attempts = (b.attempts || 0) + 1;
    if (attempts <= RETRY_SAME_BROADCAST) {
      await store.updateBroadcast(b.id, { delivery_state: 'reconnecting', attempts });
      if (attempts === 1) await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'broadcast.delivery_lost', subjectType: 'broadcast', subjectId: b.id, correlationId, metadata: { ingest } });
      try { if (b.state === 'failed') { await api.transition({ broadcastId: b.youtube_broadcast_id, status: 'live' }); await store.updateBroadcast(b.id, { state: 'live' }); } } catch { /* keep retrying */ }
      continue;
    }
    // give up on this broadcast: create a new one on the same channel and retarget
    await store.updateBroadcast(b.id, { state: 'failed', delivery_state: 'failed', attempts });
    await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'broadcast.abandoned', subjectType: 'broadcast', subjectId: b.id, correlationId, metadata: { attempts } });
    try {
      const nb = await api.createBroadcast({ title: show.title || 'Live on Loudentify', scheduledStartTime: new Date(store.now()).toISOString(), privacy: 'public', disableChat: true });
      const ns = await api.createStream({ title: `${show.title || 'Loudentify'} ${showId.slice(0, 8)} retry` });
      await api.bindStream({ broadcastId: nb.broadcastId, streamId: ns.streamId });
      const row = await store.insertBroadcast({ show_id: showId, channel_user_id: b.channel_user_id, youtube_broadcast_id: nb.broadcastId, youtube_video_id: nb.videoId, youtube_stream_id: ns.streamId, state: 'ready', chat_disabled: nb.chatDisabled, provider: b.provider });
      await store.storeStreamKey(row.id, ns.streamKey, ns.ingestUrl);
      egress.dropTarget?.(b.id);
      egress.retarget(row.id, { ingestUrl: ns.ingestUrl, streamKey: ns.streamKey });
      await store.rotateStreamKey(b.id);
      await api.transition({ broadcastId: nb.broadcastId, status: 'live' });
      await store.updateBroadcast(row.id, { state: 'live', delivery_state: 'ok', started_at: new Date(store.now()).toISOString() });
      if (b.channel_user_id === show.artist_id) await store.updateShow(showId, { youtube_video_id: nb.videoId, youtube_broadcast_id: nb.broadcastId });
      await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'broadcast.recreated', subjectType: 'broadcast', subjectId: row.id, correlationId, before: { youtube_broadcast_id: b.youtube_broadcast_id }, after: { youtube_broadcast_id: nb.broadcastId } });
    } catch (e) {
      await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'broadcast.recreate_failed', subjectType: 'broadcast', subjectId: b.id, correlationId, metadata: { code: e.code || null } });
      overall = 'failed';
    }
  }
  const live = (await store.listBroadcasts(showId)).filter((b) => b.state === 'live');
  if (live.length && live.every((b) => b.delivery_state === 'ok')) overall = 'ok';
  if (!live.length && overall !== 'failed') overall = broadcasts.length ? 'reconnecting' : 'failed';
  if (show.delivery_state !== overall) await store.updateShow(showId, { delivery_state: overall });
  return { state: overall, framesOut: health.framesOut, recordingFrames: health.recordingFrames };
}

/** End: stop the egress (recording finalised), end every broadcast, rotate keys. */
export async function endShow(store, egress, { showId, endedBy = 'artist', correlationId }) {
  const show = await store.loadShow(showId);
  if (!show) return { error: 'no_show' };
  const result = egress.state === 'running' || egress.state === undefined ? await egress.stop().catch((e) => ({ error: e.message })) : { skipped: true };
  await store.updateShow(showId, { actual_ended_at: new Date(store.now()).toISOString(), state: 'ended', ended_by: endedBy, delivery_state: 'ended' });
  await audit(store, { actorType: endedBy === 'artist' ? 'artist' : 'system', actorId: show.artist_id, action: 'show.ended', subjectType: 'show', subjectId: showId, correlationId, after: { ended_by: endedBy, recording_frames: result?.recording?.frames ?? null } });
  for (const b of await store.listBroadcasts(showId)) {
    if (!['live', 'ready', 'failed'].includes(b.state) || !b.youtube_broadcast_id) continue;
    const { api } = await store.apiFor(b.channel_user_id);
    try { if (api && b.state !== 'failed') await api.endBroadcast({ broadcastId: b.youtube_broadcast_id }); } catch { /* ended anyway on our side */ }
    const rotated = await store.rotateStreamKey(b.id);
    await store.updateBroadcast(b.id, { state: b.state === 'failed' ? 'failed' : 'complete', ended_at: new Date(store.now()).toISOString(), key_rotated_at: new Date(store.now()).toISOString() });
    await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'broadcast.ended', subjectType: 'broadcast', subjectId: b.id, correlationId });
    if (rotated) await audit(store, { actorType: 'system', actorId: b.channel_user_id, action: 'stream_key.rotated', subjectType: 'broadcast', subjectId: b.id, correlationId });
  }
  return { ok: true, recording: result?.recording || null, training: result?.training || null };
}

/** Safety: a stop (report, legal hold) ends and makes private where the API allows. */
export async function stopForSafety(store, egress, { showId, reason, actorId, correlationId }) {
  const r = await endShow(store, egress, { showId, endedBy: 'admin', correlationId });
  for (const b of await store.listBroadcasts(showId)) {
    const { api } = await store.apiFor(b.channel_user_id);
    try { if (api && b.youtube_broadcast_id) await api.setPrivacy({ broadcastId: b.youtube_broadcast_id, privacy: 'private' }); await store.updateBroadcast(b.id, { state: 'revoked' }); } catch { /* best effort */ }
    await audit(store, { actorType: 'admin', actorId, action: 'broadcast.made_private', subjectType: 'broadcast', subjectId: b.id, correlationId, metadata: { reason } });
  }
  return r;
}
