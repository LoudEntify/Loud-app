export const YOUTUBE_PRIVACY = Object.freeze(['private', 'unlisted', 'public']);
export const YOUTUBE_TRANSITIONS = Object.freeze(['testing', 'live', 'complete']);

export function showMarker(showId) {
  if (!showId) throw new Error('A show id is required');
  return `[Loudentify show:${showId}]`;
}

export function validateBroadcastInput(input = {}) {
  const title = String(input.title || '').trim().slice(0, 100);
  if (!title) throw new Error('A broadcast title is required');
  const privacy = input.privacy || 'unlisted';
  if (!YOUTUBE_PRIVACY.includes(privacy)) throw new Error('Unsupported YouTube privacy setting');
  const immediate = input.immediate === true;
  const scheduledAt = immediate ? new Date(Date.now() + 60_000) : new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('A valid scheduled time is required');
  return { title, privacy, immediate, scheduledAt: scheduledAt.toISOString(), description: String(input.description || '').trim().slice(0, 4900) };
}

export function assertBroadcastOwner(show, artistId) {
  if (!show || !artistId || !show.artist_id || show.artist_id !== artistId) {
    const error = new Error('This show does not belong to this artist');
    error.status = show ? 403 : 404;
    throw error;
  }
  return show;
}

export function assertTransition(value) {
  if (!YOUTUBE_TRANSITIONS.includes(value)) throw new Error('Unsupported YouTube broadcast transition');
  return value;
}

export function classifyBroadcastError(error = {}) {
  const reason = String(error.youtubeReason || error.reason || error.message || '').toLowerCase();
  if (error.status === 401 || reason.includes('invalid_grant')) return { code: 'AUTH_REQUIRED', retryable: false };
  if (reason.includes('quota') || error.status === 429 || reason.includes('ratelimit')) return { code: 'YOUTUBE_QUOTA_LIMIT', retryable: true };
  if (reason.includes('livestreamingnotenabled') || reason.includes('livepermissionblocked')) return { code: 'ACTION_REQUIRED', retryable: false };
  if (error.status >= 500 || reason.includes('network failure')) return { code: 'YOUTUBE_UNAVAILABLE', retryable: true };
  return { code: 'YOUTUBE_REJECTED', retryable: false };
}

export function publicBroadcastView(row) {
  if (!row) return null;
  return {
    showId: row.show_id,
    broadcastId: row.youtube_broadcast_id,
    streamId: row.youtube_stream_id,
    watchUrl: row.watch_url,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    lastError: row.last_error,
  };
}
