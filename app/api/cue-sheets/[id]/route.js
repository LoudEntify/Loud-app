import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';

// Cue-Sheet Director, Phase 1 (CD-2). Read-only fetch of one hand-written
// cue sheet, used by the dev-only ?cueSheet=<id> trigger in
// components/LiveDemo.jsx. Same shape as app/api/health-events/route.js:
// cue_sheets (docs/cue_sheets_migration.sql) has zero RLS policies, so
// only the service-role client may touch it -- this route is the only
// way in, including for reads (there is no anon-key path).

export async function GET(request, { params }) {
  const { id } = params;
  const sheetId = Number(id);
  if (!Number.isInteger(sheetId)) {
    return NextResponse.json({ error: 'Invalid cue sheet id' }, { status: 400 });
  }

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('cue_sheets')
      .select('id, show_id, slot, track_label, fallback_behaviour, cues, created_at')
      .eq('id', sheetId)
      .maybeSingle();

    if (error) {
      console.error('[cue-sheets] fetch failed:', error);
      return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Cue sheet not found' }, { status: 404 });
    }

    return NextResponse.json({ sheet: data });
  } catch (err) {
    console.error('[cue-sheets] request failed:', err);
    return NextResponse.json(
      { error: 'Request failed', detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
