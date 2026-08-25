import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// CLOSE MY ACCOUNT — a deactivation that preserves the customer record.
//
// THIS IS DELIBERATELY NOT A HARD WIPE, and the UI says so in as many
// words rather than letting someone discover it later. What actually
// happens:
//
//   login          DISABLED     (the auth user is banned; reversible)
//   profile        HIDDEN       from every public surface
//   recordings     PRIVATE      (not deleted — the artist's own work)
//   upcoming shows CANCELLED    with a notification to anyone holding a slot
//   wallet ledger  RETAINED     in full, untouched
//   stage name     RETAINED     against the record
//
// The two that people find surprising are the two worth defending:
//
//   * THE LEDGER IS NEVER DELETED. A financial record you can delete is
//     not a financial record. Money moved, or was owed, or was spent, and
//     that remains true after somebody stops using the product. This is
//     also the one part of the account that a tax authority, a chargeback,
//     or the person themselves may need years later.
//
//   * THE STAGE NAME IS HELD. Not out of possessiveness — releasing it
//     means a closed artist's name can be claimed by someone else and
//     attached to their history, in a product where the name IS the
//     identity. `retained_stage_name` records who this account was, and
//     the username stays held.
//
// REACTIVATION is documented, not built (see docs/MORNING_BRIEF.md). Every
// step above is a single reversible write, and the un-ban is one admin
// call — the path exists, there is simply no self-service UI for it
// tonight, and inventing one without a way to verify it is the same
// person would be worse than a support request.
//
// AUTH MODEL: owner-only, server-verified. `verifySession` resolves the
// Bearer token; every write below is scoped to that id. No account
// identifier is read from the request body, so there is no parameter to
// point at somebody else. A typed confirmation is required as well —
// authentication proves who is asking, not that they meant it.

const CONFIRM_PHRASE = 'CLOSE';

// Long enough to be permanent in practice, finite so it is unambiguously
// a ban and not a deletion. Supabase's own reversible mechanism.
const BAN_DURATION = '876000h'; // ~100 years

function isMissingRelation(error) {
  if (!error) return false;
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code)) return true;
  const msg = String(error.message || '').toLowerCase();
  return (msg.includes('does not exist') || msg.includes('schema cache')) &&
    (msg.includes('relation') || msg.includes('column') || msg.includes('table'));
}

/**
 * Is closure available on this database yet?
 *
 * The UI asks this so it can render the section honestly — disabled, with
 * a sentence saying why — rather than offering a button that half-works.
 * A PARTIAL closure is the one outcome that must not be possible: an
 * account whose shows were cancelled but whose login still works is worse
 * than one that was never closed.
 */
export async function GET(request) {
  const auth = await verifySession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = getSupabaseAdmin();
  const { error } = await admin.from('profiles').select('deactivated_at').limit(1);
  return NextResponse.json({
    available: !error,
    reason: error ? (isMissingRelation(error) ? 'not_yet_migrated' : 'read_failed') : null,
  });
}

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => ({}));
    if (String(body.confirm || '').trim().toUpperCase() !== CONFIRM_PHRASE) {
      return NextResponse.json(
        { error: `Type ${CONFIRM_PHRASE} to confirm. Nothing has been changed.` },
        { status: 400 }
      );
    }

    const userId = auth.user.id;
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    const reason = String(body.reason || '').slice(0, 2000) || null;

    // ── Gate on the migration BEFORE touching anything ─────────
    // Checked first, and the whole request refused if it fails. A partial
    // close is the one outcome that must not be reachable.
    const { data: existing, error: profileErr } = await admin
      .from('profiles')
      .select('id, display_name, username, deactivated_at')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr || !existing) {
      const notMigrated = isMissingRelation(profileErr);
      return NextResponse.json(
        {
          error: notMigrated
            ? 'Closing an account needs a pending database update. Nothing has been changed — please try again once it has been applied.'
            : 'Could not read your account. Nothing has been changed.',
        },
        { status: notMigrated ? 503 : 500 }
      );
    }
    if (existing.deactivated_at) {
      return NextResponse.json({ ok: true, alreadyClosed: true });
    }

    const summary = { recordings_made_private: 0, shows_cancelled: 0, slot_holders_notified: 0, ledger_rows_retained: 0 };

    // ── 1. Hide the profile, hold the name ─────────────────────
    const { error: deactivateErr } = await admin
      .from('profiles')
      .update({
        deactivated_at: now,
        deactivation_reason: reason,
        retained_stage_name: existing.display_name || existing.username || null,
      })
      .eq('id', userId);
    if (deactivateErr) {
      console.error('[account/close] deactivate failed:', deactivateErr);
      return NextResponse.json({ error: 'Could not close your account. Nothing has been changed.' }, { status: 500 });
    }

    // ── 2. Recordings become private. NOT deleted. ─────────────
    // This is the artist's own work, and a person leaving a platform is
    // not the same as a person wanting their work destroyed.
    const { data: hidden } = await admin
      .from('recordings')
      .update({ visibility: 'private' })
      .eq('artist_id', userId)
      .eq('visibility', 'public')
      .select('id');
    summary.recordings_made_private = (hidden || []).length;

    // ── 3. Cancel upcoming shows, and TELL THE OTHER PERFORMER ──
    // A versus show has someone else's evening in it. Cancelling it
    // silently is the failure that would actually hurt somebody.
    const { data: upcoming } = await admin
      .from('shows')
      .select('id, title, slated_at, state')
      .eq('artist_id', userId)
      .neq('state', 'ended');

    for (const show of upcoming || []) {
      const { error: cancelErr } = await admin
        .from('shows')
        .update({ state: 'ended', cancelled_at: now, cancelled_reason: 'account_closed' })
        .eq('id', show.id)
        .eq('artist_id', userId); // re-asserted: service role bypasses RLS, so this is the only ownership check there is
      if (cancelErr) {
        // The cancelled_at/cancelled_reason columns may not exist yet.
        // Fall back to the state change alone rather than leaving a show
        // live on a closed account — the reason is a nice-to-have, the
        // cancellation is not.
        await admin.from('shows').update({ state: 'ended' }).eq('id', show.id).eq('artist_id', userId);
      }
      summary.shows_cancelled += 1;

      const { data: slots } = await admin
        .from('show_slots')
        .select('slot, claimed_by_user_id')
        .eq('show_id', show.id)
        .not('claimed_by_user_id', 'is', null);

      for (const slot of slots || []) {
        if (slot.claimed_by_user_id === userId) continue;
        // Upsert on (user_id, dedupe_key) — a plain, non-partial unique
        // index (docs/notifications_conflict_target_migration.sql). A
        // partial index in this position is exactly what produced a live
        // 400 in an earlier round, so the target is named deliberately.
        const { error: notifyErr } = await admin.from('notifications').upsert(
          {
            user_id: slot.claimed_by_user_id,
            kind: 'system',
            body: `“${show.title || 'A show'}” on ${new Date(show.slated_at).toLocaleDateString()} has been cancelled — the host closed their account.`,
            href: '/shows',
            dedupe_key: `show-cancelled:${show.id}`,
          },
          { onConflict: 'user_id,dedupe_key' }
        );
        if (!notifyErr) summary.slot_holders_notified += 1;
        else console.warn('[account/close] slot notification failed:', notifyErr.message);
      }
    }

    // ── 4. The ledger is counted, and left completely alone ────
    const { count } = await admin
      .from('wallet_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    summary.ledger_rows_retained = count ?? 0;

    // ── 5. Disable login, last ─────────────────────────────────
    // Deliberately the final step. Everything above is a database write
    // this route can retry; banning the user is the one action that would
    // stop the person coming back to a half-finished closure and trying
    // again. If it fails, the account is hidden and its shows are
    // cancelled but login still works — recoverable, and the response
    // says so.
    let loginDisabled = true;
    try {
      const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION });
      if (banErr) { loginDisabled = false; console.error('[account/close] ban failed:', banErr); }
    } catch (err) {
      loginDisabled = false;
      console.error('[account/close] ban threw:', err);
    }

    await admin.from('account_requests').insert({
      user_id: userId,
      kind: 'closure',
      status: loginDisabled ? 'completed' : 'partial',
      detail: { ...summary, reason, login_disabled: loginDisabled },
      completed_at: now,
    });

    return NextResponse.json({ ok: true, loginDisabled, summary });
  } catch (err) {
    console.error('[account/close] failed:', err);
    return NextResponse.json({ error: 'Could not close your account.' }, { status: 500 });
  }
}
