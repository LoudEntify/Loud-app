export const YOUTUBE_READINESS = Object.freeze({
  NOT_CONNECTED: 'NOT_CONNECTED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  READY: 'READY',
  UNKNOWN: 'UNKNOWN',
  ERROR: 'ERROR',
});

export const YOUTUBE_ACTIVATION_STEPS = Object.freeze([
  'Open YouTube Studio and select the connected channel.',
  'Open Settings, then Channel, then Feature eligibility.',
  'Enable live streaming and complete phone verification if YouTube asks for it.',
  'Newly enabled channels may need up to 24 hours before live streaming becomes available.',
  'Resolve any live-streaming restrictions or Community Guidelines blocks shown by YouTube.',
]);

const QUOTA_REASONS = new Set([
  'quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRequestsExceedRateLimit',
]);

function reasonOf(error) {
  return String(error?.reason || error?.youtubeReason || error?.message || '');
}

export function classifyYouTubeReadinessError(error) {
  const reason = reasonOf(error);
  const status = Number(error?.status || 0);
  if (status === 400 && /invalid_grant|revoked|expired/i.test(reason)) {
    return { status: YOUTUBE_READINESS.AUTH_REQUIRED, code: 'AUTHORIZATION_INVALID' };
  }
  if (/liveStreamingNotEnabled|livePermissionBlocked/i.test(reason)) {
    return { status: YOUTUBE_READINESS.ACTION_REQUIRED, code: 'LIVE_STREAMING_NOT_ENABLED' };
  }
  if (/insufficientLivePermissions|insufficientPermissions/i.test(reason)) {
    return { status: YOUTUBE_READINESS.AUTH_REQUIRED, code: 'INSUFFICIENT_AUTHORIZATION' };
  }
  if (status === 429 || [...QUOTA_REASONS].some((item) => reason.includes(item))) {
    return { status: YOUTUBE_READINESS.UNKNOWN, code: 'YOUTUBE_QUOTA_LIMIT' };
  }
  if (status >= 500 || /network failure/i.test(reason)) {
    return { status: YOUTUBE_READINESS.ERROR, code: 'YOUTUBE_UNAVAILABLE' };
  }
  return { status: YOUTUBE_READINESS.UNKNOWN, code: 'ELIGIBILITY_UNCONFIRMED' };
}

export function readinessMessage(status, code) {
  if (status === YOUTUBE_READINESS.NOT_CONNECTED) return 'Connect the YouTube channel you own before checking broadcast readiness.';
  if (status === YOUTUBE_READINESS.AUTH_REQUIRED) return 'YouTube authorization is missing, expired or no longer has the required permission. Reconnect the channel.';
  if (status === YOUTUBE_READINESS.ACTION_REQUIRED) return 'YouTube reports that live streaming is not enabled or is currently blocked for this channel.';
  if (status === YOUTUBE_READINESS.READY) return 'YouTube accepted an authorized live-stream eligibility request for this channel.';
  if (status === YOUTUBE_READINESS.ERROR) return 'YouTube readiness could not be checked because the service or network request failed.';
  if (code === 'YOUTUBE_QUOTA_LIMIT') return 'YouTube’s quota or request limit prevented a fresh readiness check. Try again later.';
  return 'YouTube did not provide enough evidence to verify broadcast readiness.';
}

export function readinessCacheTtlMs(status) {
  if ([YOUTUBE_READINESS.READY, YOUTUBE_READINESS.ACTION_REQUIRED, YOUTUBE_READINESS.AUTH_REQUIRED].includes(status)) return 6 * 60 * 60 * 1000;
  return 5 * 60 * 1000;
}
