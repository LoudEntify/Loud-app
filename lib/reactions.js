'use client';

// lib/reactions.js
// ─────────────────────────────────────────────────────────────
// Tap-to-react. PRD row 54.
//
// THE SHAPE OF THIS FEATURE IS THE POINT: the tap goes out over the
// LiveKit data channel and animates on every screen in the room within a
// frame or two. Nothing waits for a server. Writing it to a database
// first would put a round trip between a tap and the moment it is
// reacting to, which is the one place a round trip must not be.
//
// The database write happens too, batched and fire-and-forget, for the
// reasons in docs/overnight2_11_reaction_events.sql — training data and a
// future spend point. It is not allowed to be a dependency of the
// feature: every function here is fail-silent by construction, in the
// same shape as lib/healthLog.js, and a dead network costs a log line
// rather than a reaction.
// ─────────────────────────────────────────────────────────────

// Native emoji, deliberately — not custom artwork.
//
// Custom stickers are a real design job and this is not it. Native emoji
// render everywhere, need no assets, need no loading state, and read
// identically on the artist's laptop and a viewer's phone. Six of them,
// because a picker is a decision and a reaction should be a reflex.
export const REACTION_EMOJI = ['🔥', '❤️', '👏', '😂', '🙌', '🎧'];

// ── THE SPEND SWITCH ──────────────────────────────────────────
// Reactions are FREE tonight, and this is why they are free rather than
// why they are not built: charging a token for a tap that a person makes
// reflexively, without a price anywhere on screen, is a way to make
// somebody feel robbed by a feature they enjoyed.
//
// The spend path is fully wired underneath (app/api/wallet/spend accepts
// action 'reaction', the ledger kind exists, reaction_events.tokens_spent
// is the column). Turning it on is this constant plus the price being
// shown on the tap bar — a one-line change and a design decision, not a
// feature.
export const REACTIONS_COST_TOKENS = false;

// A reflex, not a machine gun. Fast enough that enthusiastic tapping
// feels responsive, slow enough that one person cannot fill everybody
// else's screen — which is the actual failure mode of a reaction feature.
export const REACTION_MIN_INTERVAL_MS = 150;

const ENDPOINT = '/api/reactions';
const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE = 100;

let queue = [];
let flushTimer = null;
let listenersAttached = false;

function ensureTimers() {
  if (typeof window === 'undefined') return;
  if (!flushTimer) flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  if (!listenersAttached) {
    listenersAttached = true;
    // A show ends and the tab closes; the last few reactions of the last
    // song are the ones most worth having.
    window.addEventListener('pagehide', flushViaBeacon);
  }
}

/**
 * Record a reaction for later. Never throws, never blocks, never returns
 * anything the caller has to check.
 */
export function logReaction({ showId, emoji, offsetMs, tokensSpent = 0 }) {
  try {
    if (!showId || !emoji) return;
    ensureTimers();
    queue.push({
      show_id: String(showId),
      emoji: String(emoji).slice(0, 16),
      offset_ms: Number.isFinite(offsetMs) ? Math.max(0, Math.round(offsetMs)) : null,
      tokens_spent: Number(tokensSpent) || 0,
    });
    // Bounded: a long outage drops the OLDEST, because during a live show
    // the most recent reactions are the ones still worth having.
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  } catch {
    // never let a log call throw into the show path
  }
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reactions: batch }),
      keepalive: true,
    });
  } catch {
    // Dropped, never re-queued. Retrying risks unbounded growth during
    // exactly the kind of outage that produced the failure.
  }
}

function flushViaBeacon() {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const blob = new Blob([JSON.stringify({ reactions: batch })], { type: 'application/json' });
    if (!navigator.sendBeacon?.(ENDPOINT, blob)) {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reactions: batch }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

/**
 * Attempt the token charge for one reaction.
 *
 * Returns whatever happened, and the CALLER IGNORES IT — see
 * components/ReactionLayer.jsx. That is deliberate: a viewer tapping a
 * reaction during a song must never have their tap swallowed by a wallet
 * round trip, and must never see an error card over the performance
 * because they ran out of tokens. The reaction animates either way; only
 * the ledger row differs.
 */
export async function chargeReaction({ accessToken, showId, emoji, idempotencyKey }) {
  if (!REACTIONS_COST_TOKENS || !accessToken) return { charged: false, skipped: true };
  try {
    const res = await fetch('/api/wallet/spend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: 'reaction', showId, target: emoji, idempotencyKey }),
    });
    if (!res.ok) return { charged: false };
    const body = await res.json().catch(() => ({}));
    return { charged: !!body.charged, balance: body.balance };
  } catch {
    return { charged: false };
  }
}
