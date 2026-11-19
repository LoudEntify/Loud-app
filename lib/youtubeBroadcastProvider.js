import 'server-only';
import { youtubeApiRequest } from './youtubeServer';

const API = 'https://www.googleapis.com/youtube/v3';

/** YouTube implementation of the broadcast-provider interface used by
 * youtubeBroadcastService. It contains no database or ownership logic. */
export class YouTubeBroadcastProvider {
  constructor(accessToken, request = youtubeApiRequest) {
    this.accessToken = accessToken;
    this.request = request;
  }

  call(path, options, operation) {
    return this.request(`${API}${path}`, { ...options, headers: { ...options?.headers, Authorization: `Bearer ${this.accessToken}` } }, operation);
  }

  async findBroadcast(marker) {
    const q = new URLSearchParams({ part: 'id,snippet,status,contentDetails', broadcastStatus: 'all', mine: 'true', maxResults: '50' });
    const body = await this.call(`/liveBroadcasts?${q}`, {}, 'youtube_broadcast_list');
    return body.items?.find(item => item.snippet?.description?.includes(marker)) || null;
  }

  createBroadcast({ title, description, scheduledAt, privacy, immediate }) {
    const q = new URLSearchParams({ part: 'snippet,status,contentDetails' });
    return this.call(`/liveBroadcasts?${q}`, { method: 'POST', body: JSON.stringify({
      snippet: { title, description, scheduledStartTime: scheduledAt },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      contentDetails: { enableEmbed: true, enableDvr: true, recordFromStart: true, enableAutoStart: immediate, enableAutoStop: false },
    }), headers: { 'Content-Type': 'application/json' } }, 'youtube_broadcast_create');
  }

  async findCompatibleStream(marker) {
    const q = new URLSearchParams({ part: 'id,snippet,cdn,status,contentDetails', mine: 'true', maxResults: '50' });
    const body = await this.call(`/liveStreams?${q}`, {}, 'youtube_stream_list');
    return body.items?.find(item => item.snippet?.description?.includes(marker)) ||
      body.items?.find(item => item.contentDetails?.isReusable && ['inactive', 'ready'].includes(item.status?.streamStatus)) || null;
  }

  createStream({ title, marker }) {
    const q = new URLSearchParams({ part: 'snippet,cdn,contentDetails' });
    return this.call(`/liveStreams?${q}`, { method: 'POST', body: JSON.stringify({
      snippet: { title: `${title} programme feed`.slice(0, 128), description: marker },
      cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
      contentDetails: { isReusable: true },
    }), headers: { 'Content-Type': 'application/json' } }, 'youtube_stream_create');
  }

  bind(broadcastId, streamId) {
    const q = new URLSearchParams({ part: 'id,contentDetails,status', id: broadcastId, streamId });
    return this.call(`/liveBroadcasts/bind?${q}`, { method: 'POST' }, 'youtube_broadcast_bind');
  }

  async getStatus(broadcastId, streamId) {
    const bq = new URLSearchParams({ part: 'id,snippet,status,contentDetails', id: broadcastId });
    const sq = new URLSearchParams({ part: 'id,status', id: streamId });
    const [broadcasts, streams] = await Promise.all([
      this.call(`/liveBroadcasts?${bq}`, {}, 'youtube_broadcast_status'),
      this.call(`/liveStreams?${sq}`, {}, 'youtube_stream_status'),
    ]);
    return { broadcast: broadcasts.items?.[0] || null, stream: streams.items?.[0] || null };
  }

  updateBroadcast(resource) {
    const q = new URLSearchParams({ part: 'id,snippet,status' });
    return this.call(`/liveBroadcasts?${q}`, { method: 'PUT', body: JSON.stringify(resource), headers: { 'Content-Type': 'application/json' } }, 'youtube_broadcast_update');
  }

  transition(broadcastId, status) {
    const q = new URLSearchParams({ part: 'id,status', id: broadcastId, broadcastStatus: status });
    return this.call(`/liveBroadcasts/transition?${q}`, { method: 'POST' }, 'youtube_broadcast_transition');
  }
}
