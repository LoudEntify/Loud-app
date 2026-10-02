// POST /api/viewer/support — Support with tokens (PRD row 107). The logic
// and its properties live in lib/support.js; this route only authenticates
// and wires the real store. Requires a session; idempotent by client key.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { correlationFrom, withCorrelation, logEvent } from '../../../../lib/correlation';
import { requireSession } from '../../../../lib/viewerAuth';
import { sendSupport, supabaseSupportStore } from '../../../../lib/support';
import { readBalance, appendLedger } from '../../../../lib/ledger';
import { recordAuditEvent } from '../../../../lib/audit';
import { rowEnv } from '../../../../lib/rowEnv';

export async function POST(request) {
  const cid = correlationFrom(request);
  const session = await requireSession(request);
  if (session.error) return withCorrelation(NextResponse.json({ error: session.error }, { status: session.status }), cid);
  let body; try { body = await request.json(); } catch { body = {}; }
  const admin = getSupabaseAdmin();
  const store = supabaseSupportStore(admin, { recordAuditEvent, readBalance, appendLedger });
  const result = await sendSupport(store, {
    userId: session.user.id, showId: String(body.showId || ''), amountTokens: body.amountTokens, message: body.message,
    idempotencyKey: body.idempotencyKey, playbackPositionMs: body.playbackPositionMs, correlationId: cid, env: rowEnv(),
  });
  if (result.status >= 500) logEvent('error', 'support.failed', { correlationId: cid, status: result.status });
  return withCorrelation(NextResponse.json(result.body, { status: result.status }), cid);
}
