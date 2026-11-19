# YouTube broadcast management

This module prepares and manages artist-owned YouTube broadcasts. It does not
encode video or start Loudentify's media egress.

## Architecture

- `youtubeBroadcastProvider.js` implements YouTube `liveBroadcasts` and
  `liveStreams` HTTP operations.
- `youtubeBroadcastManager.mjs` owns orchestration, validation, idempotency and
  state transitions through injected provider/repository interfaces.
- `youtubeBroadcastService.js` is the server-only composition root. It loads an
  artist's encrypted OAuth token, refreshes access and connects Supabase to the
  provider.

Every operation first loads the show and requires an exact, non-null
`shows.artist_id` match. The service-role database client never weakens that
check.

## Idempotency and credentials

`youtube_broadcasts.show_id` is the database idempotency key. A stable
`[Loudentify show:<uuid>]` marker is also placed in YouTube descriptions. Before
creating either resource, the manager searches for that marker, allowing a
retry to recover a resource created immediately before an interrupted database
write.

YouTube's ingestion address, backup address and stream name are serialized and
AES-256-GCM encrypted into `ingestion_credentials_ciphertext`. They are not
included in status responses or structured logs. Only the future server-side
encoder integration should decrypt them.

## Lifecycle

1. Create or recover a `liveBroadcast`.
2. Select a compatible reusable stream or create an RTMP/RTMPS-capable stream.
3. Persist each returned resource ID immediately.
4. Bind the broadcast and stream and mark the row `prepared`.
5. Check the stream is `active` before transitioning to `testing` or `live`.
6. Transition to `complete` when the show ends.

Supported privacy values are `private`, `unlisted`, and `public`. Scheduled
broadcasts use the show's `slated_at`; immediate broadcasts use a near-future
start time and YouTube auto-start. Metadata updates preserve the stable show
marker.

Quota/rate-limit, authorization, channel activation and upstream failures are
classified without storing raw provider responses or credentials. Tests use a
mock provider and cover ownership, resource creation/binding, encrypted-secret
handling, status, metadata, transitions and retry deduplication.
