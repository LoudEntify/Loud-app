import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { verifySession } from '../../../lib/verifyArtistAuth';

// Where reactions are written down. NOT where they happen — see
// lib/reactions.js: the reaction itself travels over the LiveKit data
// channel and animates before this route is called at all.
//
// AUTH MODEL, and the one deliberate softness in it:
//   * An Authorization header is READ IF PRESENT and used to attribute
//     the reaction to an account. It is NOT REQUIRED.
//   * An unattributed reaction is still stored, with a null user_id.
//
// That is a decision, not an oversight. The value of this table is what
// it says about a MOMENT in a show, and requiring attribution would bias
// the data toward whoever happened to have a valid token in the tab —
// dropping exactly the reactions from people whose session had quietly
// expired mid-show. `reaction_events` grants nothing and reveals nothing;
// the worst a forged batch achieves is polluting a training set, which is
// what the per-request cap below is for.
//
// The same shape as app/api/health-events: batched, service-role behind
// an API route, and free to reject malformed input because the caller
// swallows every failure anyway.

const MAX_BATCH = 100;

export async function POST(request) {
  try {
    const { reactions } = await request.json();
    if (!Array.isArray(reactions) || reactions.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    // Optional attribution. A failed or absent token is not an error —
    // it just means this batch is anonymous.
    let userId = null;
    if ((request.headers.get('authorization') || '').startsWith('Bearer ')) {
      const auth = await verifySession(request);
      if (!auth.error) userId = auth.user.id;
    }

    const rows = reactions
      .slice(0, MAX_BATCH)
      .filter((r) => r && r.show_id && r.emoji)
      .map((r) => ({
        show_id: String(r.show_id),
        user_id: userId,
        // Capped to match the column's CHECK. An emoji with modifiers and
        // zero-width joiners is legitimately several code points — this
        // trims rather than rejects, so a family emoji is stored intact
        // and only genuine junk is cut.
        emoji: String(r.emoji).slice(0, 16),
        offset_ms: Number.isFinite(Number(r.offset_ms)) ? Math.max(0, Math.round(Number(r.offset_ms))) : null,
        tokens_spent: Number.isFinite(Number(r.tokens_spent)) ? Math.trunc(Number(r.tokens_spent)) : 0,
      }));

    if (rows.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

    const admin = getSupabaseAdmin();
    const { error } = await admin.from('reaction_events').insert(rows);
    if (error) {
      // Warn, not error: an unmigrated database means reactions still
      // work perfectly — they simply are not being recorded — and this
      // route's caller ignores the response either way.
      console.warn('[reactions] insert failed:', error.message);
      return NextResponse.json({ ok: false, error: 'Insert failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err) {
    console.warn('[reactions] request failed:', err);
    return NextResponse.json({ ok: false, error: 'Request failed' }, { status: 500 });
  }
}
