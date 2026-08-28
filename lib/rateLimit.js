// lib/rateLimit.js
// ─────────────────────────────────────────────────────────────
// A fixed-window counter, held in the memory of one server instance.
//
// ── WHAT THIS IS AND IS NOT, SAID FIRST ───────────────────────
// It is NOT a distributed rate limit. Vercel runs many instances, each
// with its own copy of this map, so the effective ceiling is the
// configured limit multiplied by however many instances happen to be
// warm. A determined attacker who spreads requests across connections
// gets more through than the number below suggests.
//
// It is still worth having, and the reason is proportionality. The
// routes using it are open by design and write to tables nothing reads
// back into a user-facing surface. The realistic abuse is a script in a
// loop, and a script in a loop is exactly what a per-instance counter
// stops — it lands on one warm instance and hits the wall immediately.
//
// A real distributed limit needs shared state (Vercel KV, Upstash, a
// Postgres counter). That is a dependency and an operational cost, and
// taking it on for a diagnostics endpoint would be the wrong trade
// today. Written down here rather than discovered later: if these tables
// ever start feeding something users see, this needs replacing, and the
// replacement is a shared store, not a bigger map.
//
// Fixed window, not sliding: a sliding window needs a timestamp list per
// key, which is more memory and more bookkeeping than a throwaway
// counter deserves. The cost is that a burst can straddle a boundary and
// land 2x the limit. For this purpose that is fine.
// ─────────────────────────────────────────────────────────────

const buckets = new Map();

// Bounded so a spray of unique keys (spoofed forwarded-for headers) can
// never grow this without limit — that would turn a rate limiter into
// the memory-exhaustion bug it exists to prevent. On overflow the whole
// map is dropped: crude, self-healing, and cheaper than an LRU nobody
// will maintain.
const MAX_KEYS = 10000;

/**
 * @returns {{ ok: boolean, remaining: number, retryAfterSec: number }}
 */
export function rateLimit(key, { limit = 60, windowMs = 60000 } = {}) {
  const now = Date.now();

  if (buckets.size > MAX_KEYS) buckets.clear();

  const entry = buckets.get(key);
  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  entry.count += 1;
  const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  if (entry.count > limit) return { ok: false, remaining: 0, retryAfterSec };
  return { ok: true, remaining: limit - entry.count, retryAfterSec };
}

/**
 * Best-effort client identity for rate limiting.
 *
 * x-forwarded-for is client-controlled in general, but on Vercel the
 * platform sets x-real-ip / the leftmost forwarded entry itself. Treated
 * as a hint, never as an identity: nothing is authorised on the basis of
 * this, it only decides who shares a counter with whom.
 */
export function clientKey(request, salt = '') {
  const ip =
    request.headers.get('x-real-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown';
  return `${salt}:${ip}`;
}
