# Live show orchestration

The orchestration state is deliberately separate from `shows.state`. The
existing public product model (`scheduled`, `soundcheck`, `ended`) drives
scheduling and discovery; replacing it would change existing behavior. The
server-only `show_orchestrations` row coordinates infrastructure using:

`DRAFT → SCHEDULED → PREPARING → READY → STARTING → LIVE → ENDING → COMPLETED`

Any active phase may enter `FAILED`. Recovery can re-enter preparation,
starting, or ending according to the persisted `failed_phase`.

## Ordering guarantees

Start performs these operations in order:

1. Check camera and audio readiness.
2. Ensure the LiveKit room and assign paired cameras.
3. Prepare the director and YouTube resources.
4. Start the media-output worker.
5. Wait for YouTube to report active ingest.
6. Transition YouTube to live.
7. Start the director and enable viewer interaction.
8. Commit `LIVE` and the existing show's actual start time.

Starting output is not treated as proof that YouTube is live.

Stop first commits `ENDING`, then disables live interaction, completes the
YouTube broadcast, stops output and director services, releases cameras,
closes the room, and commits both orchestration and existing show completion.

## Concurrency, recovery, and audit

`acquire_show_orchestration_lease` atomically acquires a database lease for a
single show. Leases expire after a bounded period so a crashed worker cannot
block recovery forever. State writes additionally compare the expected state
and version. Repeated start/stop calls return without repeating side effects
once the target state is reached.

Checkpoints record resource IDs and completed phases. Errors store only a safe
code/message and the failed phase. Reconciliation polls room, output, YouTube,
and director adapters, marks a live show failed if output disappeared, resumes
an interrupted start after rechecking output and ingest, and can finish
interrupted cleanup. Every lease, readiness check, transition, failure,
recovery, cancellation, and reconciliation is appended to
`show_orchestration_events`.

## Adapter boundary

`createShowOrchestrator` receives explicit adapters for room, readiness,
YouTube, output, director, interactions, and cameras. Task 04 supplies the
YouTube operations. The repository currently has recording-oriented LiveKit
egress but no server-side RTMP encoder-worker API, and its rules director is
client-resident. Those components must implement these adapter contracts
before production activation; the orchestration service does not misrepresent
recording egress as YouTube delivery.

Run `docs/show_orchestration.sql` in Supabase, then run
`npm run check:orchestration`. Tests use in-memory persistent-repository and
mock infrastructure adapters to exercise successful lifecycle, call ordering,
unready media, concurrent start refusal, partial-stop recovery, cancellation,
idempotent retries, and audit events.
