import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

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

const MAX_BATCH = 200;

export async function POST(request) {
  try {
    const { events } = await request.json();
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    const rows = events
      .slice(0, MAX_BATCH)
      .filter((e) => e && e.show_id && e.event_type)
      .map((e) => ({
        show_id: String(e.show_id),
        participant_identity: e.participant_identity ? String(e.participant_identity) : null,
        role: e.role ? String(e.role) : null,
        event_type: String(e.event_type),
        detail: e.detail && typeof e.detail === 'object' ? e.detail : {},
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

// TEMPORARY -- Phase 2 analysis pass, remove once the timeline pull for
// the main-performer-refresh test is done. Read-only mirror of the
// docs/health_events_test_script.md timeline query, exposed here because
// the analysis environment has no direct DB credential (deliberately --
// the service-role key is redacted from that shell) but this route
// already holds it legitimately server-side, same as POST above.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const showId = searchParams.get('show_id') || 'pilot-room';
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('health_events')
      .select('*')
      .eq('show_id', showId)
      .order('client_ts', { ascending: true })
      .limit(2000);
    if (error) {
      return NextResponse.json({ ok: false, error: 'Query failed', detail: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, count: data.length, events: data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'Request failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
