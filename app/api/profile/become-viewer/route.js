import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// Artist → viewer downgrade. Symmetric with become-artist, and
// deliberately more careful, because this one destroys visibility rather
// than granting capability.
//
// THE RULING THIS IMPLEMENTS, and the reasoning kept with it:
//
//   Recordings  → PRIVATE. Nothing stays public without an active artist
//                 identity behind it. Not deleted: the footage is
//                 theirs, and re-upgrading should hand it back intact.
//   Future shows→ CANCELLED, with a notification. A scheduled show
//                 nobody can perform is worse than no show -- an
//                 audience would arrive to nothing. Slot-B holders are
//                 notified too: someone accepted an invite to a show
//                 that is no longer happening, and finding that out by
//                 turning up is unacceptable.
//   Wallet      → RETAINED, untouched. Money is money.
//   Stage name  → RETAINED. Re-upgrade should restore their identity as
//                 they left it, not hand them a stranger's page.
//   B-roll/cues → RETAINED. Working material, invisible to the public
//                 either way, and nothing is gained by destroying it.
//
// Reversible by design: everything above is a visibility or state
// change, not a deletion, so the same Become-an-Artist path restores the
// console with their work as they left it.
export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, display_name')
      .eq('id', auth.user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: 'No profile found for this account.' }, { status: 404 });
    }
    if (profile.role !== 'artist') {
      return NextResponse.json({ ok: true, alreadyViewer: true });
    }

    // 1. Recordings go private. Counted so the response can tell the
    //    artist exactly what changed rather than claiming vaguely.
    const { data: hidden } = await admin
      .from('recordings')
      .update({ visibility: 'private' })
      .eq('artist_id', auth.user.id)
      .eq('visibility', 'public')
      .select('id');

    // 2. Future shows cancelled. 'ended' is the schema's terminal state --
    //    there is no separate 'cancelled', and inventing one would mean a
    //    CHECK-constraint migration for a distinction nothing reads.
    const nowIso = new Date().toISOString();
    const { data: cancelled } = await admin
      .from('shows')
      .update({ state: 'ended' })
      .eq('artist_id', auth.user.id)
      .neq('state', 'ended')
      .gte('slated_at', nowIso)
      .select('id, title, slated_at');

    // 3. Notify. The artist, and anyone holding a slot on a show that
    //    just stopped existing.
    const notifications = [];
    for (const show of cancelled || []) {
      notifications.push({
        user_id: auth.user.id,
        kind: 'system',
        body: `“${show.title || 'Untitled show'}” was cancelled when you switched to a viewer account.`,
        dedupe_key: `downgrade:${show.id}:owner`,
      });

      const { data: slots } = await admin
        .from('show_slots')
        .select('claimed_by_user_id')
        .eq('show_id', show.id)
        .not('claimed_by_user_id', 'is', null);

      for (const slot of slots || []) {
        if (slot.claimed_by_user_id === auth.user.id) continue;
        notifications.push({
          user_id: slot.claimed_by_user_id,
          kind: 'system',
          body: `“${show.title || 'Untitled show'}” was cancelled by the host.`,
          dedupe_key: `downgrade:${show.id}:${slot.claimed_by_user_id}`,
        });
      }
    }
    if (notifications.length) {
      const { error: notifyErr } = await admin
        .from('notifications')
        .upsert(notifications, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
      // Not fatal: a missed notification must not block the downgrade
      // itself, which the artist explicitly asked for.
      if (notifyErr) console.error('[become-viewer] notify failed:', notifyErr);
    }

    // 4. Flip the role LAST. If anything above failed we have not yet
    //    taken their console away, so a retry is clean rather than
    //    landing them half-downgraded.
    const { error: roleErr } = await admin
      .from('profiles')
      .update({ role: 'viewer' })
      .eq('id', auth.user.id);
    if (roleErr) {
      console.error('[become-viewer] role update failed:', roleErr);
      return NextResponse.json({ error: `Could not switch your account — ${roleErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      role: 'viewer',
      recordingsHidden: (hidden || []).length,
      showsCancelled: (cancelled || []).length,
    });
  } catch (err) {
    console.error('[become-viewer] request failed:', err);
    return NextResponse.json({ error: `Request failed — ${String(err?.message || err)}` }, { status: 500 });
  }
}
