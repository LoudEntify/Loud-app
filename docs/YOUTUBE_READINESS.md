# YouTube channel readiness

`GET /api/youtube/readiness` is an artist-authenticated, server-only readiness check. It never returns OAuth tokens or ingestion credentials.

## Evidence model

The YouTube Channels resource does **not** expose a complete “may broadcast now” flag. `status.isLinked` and `status.longUploadsStatus` are supporting context only and are never treated as proof of live-stream eligibility.

The readiness service refreshes the artist's OAuth access token, retrieves the authorized channel identity, and calls `liveStreams.list` with `mine=true`. YouTube documents `liveStreamingNotEnabled` as an error for that method. A successful authorized response is therefore the evidence used for `READY`. No broadcast or stream is created by this check.

## Statuses

- `NOT_CONNECTED`: no artist-owned YouTube connection exists.
- `AUTH_REQUIRED`: authorization is missing, revoked, expired, or lacks the required scope. The artist must reconnect.
- `ACTION_REQUIRED`: YouTube returned `liveStreamingNotEnabled` or `livePermissionBlocked`.
- `READY`: the authorized `liveStreams.list` eligibility request succeeded.
- `UNKNOWN`: YouTube did not provide enough evidence, including quota and rate-limit responses.
- `ERROR`: the service, network, database, or server configuration prevented the check.

`READY` means YouTube accepted the documented eligibility request at `checkedAt`. It is not a promise that YouTube will accept every future broadcast; restrictions can change outside Loudentify.

## Caching

Only non-sensitive results are cached in `youtube_connections`:

- status, safe reason code and summary;
- channel ID/title already shown to the artist;
- evidence labels and non-sensitive counts/flags;
- checked and expiry timestamps.

Definitive results (`READY`, `ACTION_REQUIRED`, `AUTH_REQUIRED`) cache for six hours. `UNKNOWN` and `ERROR` cache for five minutes. `?refresh=1` bypasses the cache for the explicit “Check again” action.

Refresh tokens remain AES-256-GCM encrypted and are never placed in the readiness cache or response.

## Manual activation guidance

When readiness is not verified, the dashboard explains how to open YouTube Studio → Settings → Channel → Feature eligibility, enable live streaming, complete verification, allow the documented activation delay, and resolve any restrictions shown by YouTube.

## Quota behavior

Quota and rate-limit responses map to `UNKNOWN`, not `READY` and not a permanent failure. This prevents temporary API limits from being misrepresented as channel ineligibility.
