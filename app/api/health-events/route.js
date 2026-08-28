import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../lib/rateLimit';

// Phase 2 diagnostic instrumentation. Batched writes from
// lib/healthLog.js land here. Same shape as app/api/participants/route.js:
// health_events (docs/health_events_migration.sql) has zero RLS policies,
// so only the service-role client may touch it -- this route is the only
// way in.
//
// This must never become part of the show's critical path: any failure
// here is swallowed by the caller (lib/healthLog.js drops the batch and
// moves on), so this route is free to reject/500 on malformed input
// without any special care beyond not crashing.

// ── AUTH MODEL: DELIBERATELY OPEN, RATE-LIMITED ───────────────
//
// Security round finding 7 (docs/SECURITY_AUDIT_2026-08-28.md). This
// route takes no session, and the reasoning for keeping it that way is
// specific rather than lazy:
//
//   1. THE DEVICES THAT NEED IT MOST HAVE NO ACCOUNT. A paired camfeed
//      phone is a DEVICE, not a person — that is the whole design of
//      camera pairing. It authenticates with a device secret against a
//      pairing row, and has no Supabase session to present. Requiring
//      one here would silently drop exactly the telemetry that has
//      diagnosed the hardest bugs in this codebase: the screen-locked
//      phone, the frozen feed, the camera rotate.
//
//   2. THE OBVIOUS ALTERNATIVE GUARD IS WORSE THAN NONE. "Require
//      show_id to resolve to a real show" sounds right and is a trap:
//      `health_events.show_id` holds the ROOM NAME, not `shows.id`
//      (components/LiveDemo.jsx's initHealthLog passes `roomName`), and
//      rehearsal rooms — `rehearsal-{userId}` — have no `shows` row at
//      all. That guard would throw away every Kit Check diagnostic, and
//      it would do it silently, which is the failure mode this table
//      exists to prevent.
//
//   3. THE BLAST RADIUS IS A TABLE NOBODY READS. `health_events` has RLS
//      on with zero policies, so only the service role can see it, and
//      nothing surfaces it to any user. The realistic abuse is volume,
//      not disclosure.
//
// So the guard is proportionate to the actual risk: a rate limit, and
// tighter bounds on what one request can contain. See lib/rateLimit.js
// for the honest limits of a per-instance counter.
//
// Generous on purpose. A real show is one flush per second per client,
// and a versus show with three camfeeds behind one venue NAT is several
// clients on one IP. This has to sit well above legitimate traffic or it
// becomes a diagnostics outage during exactly the shows worth
// diagnosing.
const RATE_LIMIT = { limit: 240, windowMs: 60000 };

const MAX_BATCH = 200;
// A detail blob is a diagnostic, not a payload. Anything larger than
// this is a bug or an abuse, and truncating beats rejecting a whole
// batch of otherwise-good rows for one oversized entry.
const MAX_DETAIL_BYTES = 4000;
const MAX_STRING = 200;

function boundedString(value, max = MAX_STRING) {
  return String(value).slice(0, max);
}

function boundedDetail(detail) {
  if (!detail || typeof detail !== 'object') return {};
  try {
    const json = JSON.stringify(detail);
    if (json.length <= MAX_DETAIL_BYTES) return detail;
    return { _truncated: true, _originalBytes: json.length, preview: json.slice(0, 500) };
  } catch {
    return { _unserializable: true };
  }
}

export async function POST(request) {
  try {
    const gate = rateLimit(clientKey(request, 'health'), RATE_LIMIT);
    if (!gate.ok) {
      // 429 with Retry-After rather than a silent drop: the caller
      // (lib/healthLog.js) discards the batch either way, but a status
      // code means a flood is visible in the logs as a flood.
      return NextResponse.json(
        { ok: false, error: 'Rate limited' },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } }
      );
    }

    const { events } = await request.json();
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    const rows = events
      .slice(0, MAX_BATCH)
      .filter((e) => e && e.show_id && e.event_type)
      .map((e) => ({
        show_id: boundedString(e.show_id),
        participant_identity: e.participant_identity ? boundedString(e.participant_identity) : null,
        role: e.role ? boundedString(e.role, 40) : null,
        event_type: boundedString(e.event_type, 80),
        detail: boundedDetail(e.detail),
        client_ts: e.client_ts ? new Date(e.client_ts).toISOString() : new Date().toISOString(),
      }));

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin.from('health_events').insert(rows);
    if (error) {
      console.warn('[health-events] insert failed:', error);
      return NextResponse.json({ ok: false, error: 'Insert failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.warn('[health-events] request failed:', err);
    return NextResponse.json(
      { ok: false, error: 'Request failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
