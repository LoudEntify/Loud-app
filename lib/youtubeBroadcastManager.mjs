import { assertBroadcastOwner, assertTransition, classifyBroadcastError, publicBroadcastView, showMarker, validateBroadcastInput } from './youtubeBroadcastCore.mjs';

function ingestionSecret(stream) {
  const info = stream?.cdn?.ingestionInfo;
  if (!info?.streamName || !(info.rtmpsIngestionAddress || info.ingestionAddress)) return null;
  return JSON.stringify({
    address: info.rtmpsIngestionAddress || info.ingestionAddress,
    backupAddress: info.rtmpsBackupIngestionAddress || info.backupIngestionAddress || null,
    streamName: info.streamName,
  });
}

/**
 * Provider interface: findBroadcast, createBroadcast, findCompatibleStream,
 * createStream, bind, getStatus, updateBroadcast and transition.
 * Repository interface: loadShow, get, claim and patch.
 */
export function createYouTubeBroadcastManager({ repository, provider, sealCredentials, now = () => new Date() }) {
  async function owned(showId, artistId) {
    return assertBroadcastOwner(await repository.loadShow(showId), artistId);
  }

  async function providerFailure(showId, artistId, error) {
    const failure = classifyBroadcastError(error);
    await repository.patch(showId, artistId, { last_error: failure.code });
    error.broadcastFailure = failure;
    throw error;
  }

  async function prepare({ showId, artistId, ...raw }) {
    const show = await owned(showId, artistId);
    const input = validateBroadcastInput({ ...raw, title: raw.title || show.title || 'Loudentify Live', scheduledAt: raw.scheduledAt || show.slated_at });
    let row = await repository.claim(showId, artistId);
    if (row.artist_id !== artistId) throw Object.assign(new Error('This broadcast belongs to another artist'), { status: 403 });
    if (row.youtube_broadcast_id && row.youtube_stream_id && row.state !== 'failed') return publicBroadcastView(row);

    const marker = showMarker(showId);
    try {
      let broadcast = row.youtube_broadcast_id ? { id: row.youtube_broadcast_id } : await provider.findBroadcast(marker);
      if (!broadcast) broadcast = await provider.createBroadcast({ ...input, description: [input.description, marker].filter(Boolean).join('\n\n') });
      if (!broadcast?.id) throw new Error('YouTube did not return a broadcast id');
      row = await repository.patch(showId, artistId, { youtube_broadcast_id: broadcast.id, watch_url: `https://www.youtube.com/watch?v=${broadcast.id}` });

      let stream = row.youtube_stream_id ? { id: row.youtube_stream_id } : await provider.findCompatibleStream(marker);
      if (!stream) stream = await provider.createStream({ title: input.title, marker });
      if (!stream?.id) throw new Error('YouTube did not return a stream id');
      const secret = ingestionSecret(stream);
      row = await repository.patch(showId, artistId, {
        youtube_stream_id: stream.id,
        ...(secret ? { ingestion_credentials_ciphertext: sealCredentials(secret) } : {}),
      });
      await provider.bind(broadcast.id, stream.id);
      row = await repository.patch(showId, artistId, { state: 'prepared', privacy_status: input.privacy, last_error: null });
      return publicBroadcastView(row);
    } catch (error) {
      const failure = classifyBroadcastError(error);
      await repository.patch(showId, artistId, { state: 'failed', last_error: failure.code });
      error.broadcastFailure = failure;
      throw error;
    }
  }

  async function status({ showId, artistId }) {
    await owned(showId, artistId);
    const row = await repository.get(showId, artistId);
    if (!row?.youtube_broadcast_id || !row.youtube_stream_id) return { record: publicBroadcastView(row), youtube: null };
    try {
      const remote = await provider.getStatus(row.youtube_broadcast_id, row.youtube_stream_id);
      return {
        record: publicBroadcastView(row),
        youtube: {
          lifeCycleStatus: remote.broadcast?.status?.lifeCycleStatus || null,
          privacyStatus: remote.broadcast?.status?.privacyStatus || null,
          streamStatus: remote.stream?.status?.streamStatus || null,
          healthStatus: remote.stream?.status?.healthStatus?.status || null,
        },
      };
    } catch (error) { return providerFailure(showId, artistId, error); }
  }

  async function update({ showId, artistId, ...raw }) {
    await owned(showId, artistId);
    const row = await repository.get(showId, artistId);
    if (!row?.youtube_broadcast_id) throw Object.assign(new Error('Broadcast has not been prepared'), { status: 409 });
    try {
      const current = await provider.getStatus(row.youtube_broadcast_id, row.youtube_stream_id);
      const input = validateBroadcastInput({
        title: raw.title || current.broadcast?.snippet?.title,
        description: raw.description ?? current.broadcast?.snippet?.description,
        scheduledAt: raw.scheduledAt || current.broadcast?.snippet?.scheduledStartTime,
        privacy: raw.privacy || current.broadcast?.status?.privacyStatus,
      });
      const marker = showMarker(showId);
      const updated = await provider.updateBroadcast({
        id: row.youtube_broadcast_id,
        snippet: { title: input.title, description: [input.description.replace(marker, '').trim(), marker].filter(Boolean).join('\n\n'), scheduledStartTime: input.scheduledAt },
        status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: false },
      });
      await repository.patch(showId, artistId, { privacy_status: input.privacy, last_error: null });
      return { id: updated.id, title: updated.snippet?.title, privacyStatus: updated.status?.privacyStatus };
    } catch (error) { return providerFailure(showId, artistId, error); }
  }

  async function transition({ showId, artistId, to }) {
    await owned(showId, artistId);
    assertTransition(to);
    const row = await repository.get(showId, artistId);
    if (!row?.youtube_broadcast_id || !row.youtube_stream_id) throw Object.assign(new Error('Broadcast has not been prepared'), { status: 409 });
    if ((to === 'live' && row.state === 'live') || (to === 'complete' && row.state === 'complete') || (to === 'testing' && row.state === 'starting')) {
      return { record: publicBroadcastView(row), lifeCycleStatus: to, idempotent: true };
    }
    try {
      if (to !== 'complete') {
        const remote = await provider.getStatus(row.youtube_broadcast_id, row.youtube_stream_id);
        if (remote.stream?.status?.streamStatus !== 'active') throw Object.assign(new Error('YouTube is not receiving the programme feed yet'), { status: 409, localValidation: true });
      }
      const result = await provider.transition(row.youtube_broadcast_id, to);
      const timestamp = now().toISOString();
      const patch = to === 'complete'
        ? { state: 'complete', stopped_at: timestamp, last_error: null }
        : { state: to === 'live' ? 'live' : 'starting', ...(to === 'live' ? { started_at: timestamp } : {}), last_error: null };
      const saved = await repository.patch(showId, artistId, patch);
      return { record: publicBroadcastView(saved), lifeCycleStatus: result.status?.lifeCycleStatus || to };
    } catch (error) {
      if (error.localValidation) throw error;
      return providerFailure(showId, artistId, error);
    }
  }

  return { prepare, status, update, transition };
}
