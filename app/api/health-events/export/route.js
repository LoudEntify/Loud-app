import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifyArtistAuth } from '../../../../lib/verifyArtistAuth';

// TASK 5 — the CSV you hand back.
//
// PRD: Live Show / reliability    S&I: Observability, Auth
//
//   GET /api/health-events/export?room=<room_name>[&since=<iso>][&types=a,b]
//
// AUTH MODEL: the verified artist who owns the show running in that room.
// Same check as the egress routes, and for the same reason: health_events
// rows describe a specific artist's show, including participant
// identities, and are nobody else's to read.
//
// ── WHY room_name AND NOT show_id ─────────────────────────────
// Because that is what the rows are keyed by. `health_events.show_id`
// holds the ROOM NAME, not `shows.id` — components/LiveDemo.jsx's
// initHealthLog passes `roomName`. Naming the parameter `room` says so
// rather than leaving someone to discover it from an empty result.
//
// ── CSV, NOT JSON ─────────────────────────────────────────────
// Because the point is to hand it to someone. A freeze investigation is
// a lot of eyes on a spreadsheet, sorting by timestamp and looking for
// the moment uplink fell off a cliff — and JSON is not that.
//
// `detail` is flattened into columns rather than dumped as one JSON
// blob: a column called `uplinkBps` can be plotted, a column containing
// `{"uplinkBps":...}` cannot.

const MAX_ROWS = 20000;

// The columns worth having in the order worth reading them: identity
// first, then the four hypotheses (uplink / encoder / send / layers),
// then the supporting detail. Anything in `detail` that is not named
// here still comes through in the trailing `extra` column, so a field
// added to the sampler later is never silently lost.
const DETAIL_COLUMNS = [
  'uplinkBps', 'availableOutgoingBitrate', 'targetBitrate',
  'framesEncodedDelta', 'framesSentDelta', 'framesNotSent',
  'fps', 'sourceFps', 'avgQp', 'qualityLimitationReason',
  'rid', 'activeLayers', 'layerCount',
  'width', 'height', 'sourceWidth', 'sourceHeight',
  'encoder', 'keyFramesEncoded',
  'nackCount', 'pliCount', 'firCount', 'packetsLost', 'jitter', 'rttSec',
  'retransmittedBytesSent',
  'from', 'to', 'reason', 'quality', 'source', 'sid', 'label',
];

const BASE_COLUMNS = ['created_at', 'client_ts', 'event_type', 'participant_identity', 'role', 'show_id'];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Quote if it could break a cell boundary. Doubling inner quotes is
  // the RFC 4180 escape, and it is what every spreadsheet expects.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request) {
  const auth = await verifyArtistAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const room = (searchParams.get('room') || '').trim();
  if (!room) {
    return NextResponse.json({ error: 'room is required (the show room_name, which is what health_events.show_id holds)' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Ownership, against the shows row for that room. Mirrors
  // lib/verifyShowOwner.js including its grandfather clause for rows
  // whose artist_id predates docs/ownership_migration.sql.
  const { data: show, error: showErr } = await admin
    .from('shows')
    .select('id, artist_id, room_name')
    .eq('room_name', room)
    .maybeSingle();

  if (showErr) return NextResponse.json({ error: 'Could not verify who owns this show.' }, { status: 503 });
  if (!show) return NextResponse.json({ error: 'No show found for that room.' }, { status: 404 });
  if (show.artist_id && show.artist_id !== auth.user.id) {
    return NextResponse.json({ error: 'This is not your show.' }, { status: 403 });
  }

  let query = admin
    .from('health_events')
    .select('created_at, client_ts, event_type, participant_identity, role, show_id, detail')
    .eq('show_id', room)
    .order('client_ts', { ascending: true })
    .limit(MAX_ROWS);

  const since = searchParams.get('since');
  if (since) query = query.gte('client_ts', since);

  const types = (searchParams.get('types') || '').split(',').map((t) => t.trim()).filter(Boolean);
  if (types.length) query = query.in('event_type', types);

  const { data, error } = await query;
  if (error) {
    console.error('[health-events/export] fetch failed:', error);
    return NextResponse.json({ error: 'Export failed', detail: error.message }, { status: 500 });
  }

  const rows = data || [];
  const header = [...BASE_COLUMNS, ...DETAIL_COLUMNS, 'extra'];
  const lines = [header.join(',')];

  for (const r of rows) {
    const detail = r.detail && typeof r.detail === 'object' ? r.detail : {};
    const known = new Set(DETAIL_COLUMNS);
    const extra = Object.fromEntries(Object.entries(detail).filter(([k]) => !known.has(k)));
    lines.push([
      ...BASE_COLUMNS.map((c) => csvCell(r[c])),
      ...DETAIL_COLUMNS.map((c) => csvCell(detail[c])),
      csvCell(Object.keys(extra).length ? extra : null),
    ].join(','));
  }

  // Row count in a header rather than a trailing line: a trailing
  // summary row would be indistinguishable from data once it is in a
  // spreadsheet, and someone would eventually plot it.
  const filename = `health-${room}-${rows.length}rows.csv`;
  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Row-Count': String(rows.length),
      // Said out loud, because a silently truncated export is a
      // conclusion drawn from half the evidence.
      'X-Truncated': rows.length >= MAX_ROWS ? 'true' : 'false',
    },
  });
}
