// lib/youtube/api.js
// ─────────────────────────────────────────────────────────────
// The YouTube Live Streaming API, behind one small interface.
//
// Two implementations:
//   MockYouTubeApi    in-memory, deterministic, with failure modes that the
//                     failure drills in docs/ARCHITECTURE.md name: a channel
//                     not enabled for live, a rejected stream key, an ingest
//                     drop. Used in tests, locally, and on staging until
//                     Google verification lands (docs/NEEDS_KOREY.md).
//   GoogleYouTubeApi  the real REST calls (liveBroadcasts, liveStreams,
//                     channels) with a bearer token. Written against the
//                     documented API; not exercised here (no credentials,
//                     no outbound network from the build sandbox).
//
// Every method returns plain data. Tokens never appear in return values
// or errors. The narrowest scope that allows creating and ending a
// broadcast is youtube.force-ssl (liveBroadcasts.insert/transition need
// youtube or youtube.force-ssl; the latter is the smaller grant).
// ─────────────────────────────────────────────────────────────

export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

export class YouTubeApiError extends Error {
  constructor(code, message, { retryable = false } = {}) { super(message); this.code = code; this.retryable = retryable; }
}

export class MockYouTubeApi {
  constructor({ channel = { id: 'UC_mock_channel', title: 'Mock channel', liveEnabled: true }, now = () => Date.now() } = {}) {
    this.channel = channel;
    this.now = now;
    this.broadcasts = new Map();
    this.streams = new Map();
    this.failures = new Set(); // 'channel_not_live_enabled' | 'reject_stream_key' | 'ingest_drop' | 'quota'
    this.calls = [];
    this.ingestDropsLeft = 0;
    this.concurrent = 0;
  }
  fail(mode, on = true) { if (on) this.failures.add(mode); else this.failures.delete(mode); return this; }
  _call(name, args) { this.calls.push({ name, args }); if (this.failures.has('quota')) throw new YouTubeApiError('quotaExceeded', 'YouTube API quota exceeded', { retryable: true }); }
  async channelInfo() {
    this._call('channelInfo');
    return { id: this.channel.id, title: this.channel.title, liveEnabled: !this.failures.has('channel_not_live_enabled') && this.channel.liveEnabled !== false };
  }
  async createBroadcast({ title, scheduledStartTime, privacy = 'public', disableChat = true }) {
    this._call('createBroadcast', { title, scheduledStartTime, privacy, disableChat });
    const id = `bc_${this.broadcasts.size + 1}_${Math.random().toString(36).slice(2, 8)}`;
    const b = { id, videoId: `vid_${id}`, title, scheduledStartTime, privacy, status: 'created', chatDisabled: disableChat, streamId: null };
    this.broadcasts.set(id, b);
    return { broadcastId: id, videoId: b.videoId, chatDisabled: disableChat };
  }
  async createStream({ title }) {
    this._call('createStream', { title });
    const id = `st_${this.streams.size + 1}`;
    const key = `mock-key-${Math.random().toString(36).slice(2, 14)}`;
    this.streams.set(id, { id, key, ingestUrl: 'rtmp://mock.rtmp.youtube.invalid/live2', status: 'ready' });
    return { streamId: id, streamKey: key, ingestUrl: 'rtmp://mock.rtmp.youtube.invalid/live2' };
  }
  async bindStream({ broadcastId, streamId }) {
    this._call('bindStream', { broadcastId, streamId });
    const b = this.broadcasts.get(broadcastId); if (!b) throw new YouTubeApiError('notFound', 'broadcast not found');
    b.streamId = streamId; return { ok: true };
  }
  async transition({ broadcastId, status }) {
    this._call('transition', { broadcastId, status });
    const b = this.broadcasts.get(broadcastId); if (!b) throw new YouTubeApiError('notFound', 'broadcast not found');
    if (status === 'live' && this.failures.has('reject_stream_key')) throw new YouTubeApiError('invalidTransition', 'Stream is not active: the stream key was rejected by ingest');
    b.status = status; return { status };
  }
  async endBroadcast({ broadcastId }) { return this.transition({ broadcastId, status: 'complete' }); }
  async setPrivacy({ broadcastId, privacy }) {
    this._call('setPrivacy', { broadcastId, privacy });
    const b = this.broadcasts.get(broadcastId); if (b) b.privacy = privacy; return { privacy };
  }
  async ingestHealth({ streamId }) {
    this._call('ingestHealth', { streamId });
    if (this.failures.has('ingest_drop') && this.ingestDropsLeft > 0) { this.ingestDropsLeft -= 1; return { status: 'noData' }; }
    return { status: this.failures.has('ingest_drop') ? 'noData' : 'good' };
  }
  async concurrentViewers({ broadcastId }) { this._call('concurrentViewers', { broadcastId }); return { viewers: this.concurrent }; }
}

export class GoogleYouTubeApi {
  constructor({ accessToken, fetchImpl = globalThis.fetch }) { this.token = accessToken; this.fetch = fetchImpl; }
  async _req(method, path, { query, body } = {}) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
    const res = await this.fetch(url, { method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || `http_${res.status}`;
      throw new YouTubeApiError(reason, data?.error?.message || `YouTube API ${res.status}`, { retryable: res.status === 429 || res.status >= 500 });
    }
    return data;
  }
  async channelInfo() {
    const d = await this._req('GET', 'channels', { query: { part: 'snippet,status', mine: 'true' } });
    const c = d.items?.[0];
    if (!c) throw new YouTubeApiError('noChannel', 'This Google account has no YouTube channel');
    return { id: c.id, title: c.snippet?.title, liveEnabled: Boolean(c.status?.isLinked) && c.status?.longUploadsStatus !== 'disallowed' };
  }
  async createBroadcast({ title, scheduledStartTime, privacy = 'public', disableChat = true }) {
    const d = await this._req('POST', 'liveBroadcasts', { query: { part: 'snippet,status,contentDetails' }, body: {
      snippet: { title, scheduledStartTime },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: false, enableAutoStop: false, enableDvr: true, recordFromStart: true, monitorStream: { enableMonitorStream: false }, ...(disableChat ? { enableEmbed: true } : {}) },
    } });
    return { broadcastId: d.id, videoId: d.id, chatDisabled: disableChat };
  }
  async createStream({ title }) {
    const d = await this._req('POST', 'liveStreams', { query: { part: 'snippet,cdn,status' }, body: { snippet: { title }, cdn: { frameRate: '30fps', ingestionType: 'rtmp', resolution: '1080p' } } });
    return { streamId: d.id, streamKey: d.cdn?.ingestionInfo?.streamName, ingestUrl: d.cdn?.ingestionInfo?.ingestionAddress };
  }
  async bindStream({ broadcastId, streamId }) { await this._req('POST', 'liveBroadcasts/bind', { query: { id: broadcastId, part: 'id', streamId } }); return { ok: true }; }
  async transition({ broadcastId, status }) { const d = await this._req('POST', 'liveBroadcasts/transition', { query: { id: broadcastId, broadcastStatus: status, part: 'status' } }); return { status: d.status?.lifeCycleStatus || status }; }
  async endBroadcast({ broadcastId }) { return this.transition({ broadcastId, status: 'complete' }); }
  async setPrivacy({ broadcastId, privacy }) { await this._req('PUT', 'liveBroadcasts', { query: { part: 'status' }, body: { id: broadcastId, status: { privacyStatus: privacy } } }); return { privacy }; }
  async ingestHealth({ streamId }) { const d = await this._req('GET', 'liveStreams', { query: { part: 'status', id: streamId } }); return { status: d.items?.[0]?.status?.healthStatus?.status || 'noData' }; }
  async concurrentViewers({ broadcastId }) { const d = await this._req('GET', 'videos', { query: { part: 'liveStreamingDetails', id: broadcastId } }); return { viewers: Number(d.items?.[0]?.liveStreamingDetails?.concurrentViewers || 0) }; }
}

/** Which implementation this environment uses. 'mock' until credentials exist. */
export function youtubeMode() {
  return process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET ? 'google' : 'mock';
}
