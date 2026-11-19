# Latency-aware live interactions

Interaction data remains entirely in Loudentify. Nothing calls YouTube like,
comment, view, subscription, chat, or engagement APIs.

## Identity and duplicate prevention

Choice voting requires a server-minted interaction session scoped to one show.
The random bearer is returned once and only its SHA-256 hash is stored. Signed-in
viewers are keyed by account; anonymous viewers are keyed by the server session.
The unique `(prompt_id, voter_key)` index makes retries and changed choices an
update to one ballot instead of additional votes. Session minting and voting are
rate-limited. This prevents ordinary duplicate voting and raises the cost of
scripted voting; it is not proof of one biological person per vote.

The browser keeps the bearer in tab-scoped `sessionStorage`, so reconnects reuse
the same ballot identity without turning a YouTube view into an authenticated
Loudentify session.

## Authoritative windows and latency

The server stores `opens_at`, `closes_at`, and `latency_allowance_ms`. Its clock,
not a browser or LiveKit message, decides whether a ballot is accepted. Operator
close sets the authoritative close time. A bounded 30-second grace accepts votes
from viewers whose embedded YouTube playback is behind live; after that the
server returns `410`. Playback position and a bounded latency estimate may be
recorded for audit but never override the server window.

Open prompts are refreshed every five seconds for embedded viewers. Existing
operator aggregate results refresh every two seconds. Raw ballots remain behind
zero-policy RLS; only aggregate results are returned to the owning artist.
Opening, closing, accepted votes, rejected late votes, and session creation are
recorded in `interaction_audit_events`.

Voting does not depend on AI inference and continues if playback telemetry or
the health logger is unavailable.

## Reactions and competitions

Existing reactions remain Loudentify data and do not touch YouTube engagement.
Their current anonymous write path is suitable for expressive animation, not a
fraud-resistant competition result. Any prize-bearing competition must use the
new authoritative voter identity and window rather than reaction counts.

## Payments and policy dependencies

The existing wallet uses authenticated accounts, provider-hosted checkout,
server-defined token packs, signed webhooks, an append-only ledger, and
idempotency keys. No new checkout, tipping, paid voting, or prize flow is enabled
by this task.

Before enabling monetized interactions, Loudentify needs documented approval of:

- YouTube API policy review: interactions must be clearly labelled as
  Loudentify data, cannot manipulate or be represented as YouTube engagement,
  cannot gate playback, and cannot reward views or ad interaction.
- Product/legal review for consumer disclosures, refunds, chargebacks, creator
  payouts, tax/VAT treatment, age controls, gambling/prize-promotion rules, and
  the countries where the feature may operate.
- A transactional wallet debit. The current spend route documents a concurrent
  balance-check race and must not back paid competition outcomes until an atomic
  database debit replaces it.
- Clear separation from YouTube Super Chat, channel memberships, advertising,
  and YouTube Giving. Loudentify must not imply its own purchase is one of those
  YouTube products.

Run `docs/latency_aware_interactions.sql` before enabling the new voting path.
