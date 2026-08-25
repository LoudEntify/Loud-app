import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';

// REQUEST MY DATA — the whole account, assembled server-side, streamed
// back as one JSON file.
//
// AUTH MODEL, stated because this route hands over everything we hold
// about a person:
//   * Owner-only, server-verified. `verifySession` resolves the Bearer
//     token to a user through the service-role client; every query below
//     is then filtered by THAT id. No id is ever read from the request
//     body — there is no parameter an attacker could point at somebody
//     else's account, because there is no parameter at all.
//   * Rate-limited to EXPORTS_PER_WINDOW per rolling window, counted from
//     rows in `account_requests`. Counted in the database, not in memory,
//     because serverless functions do not share memory and an in-process
//     counter is a limit that resets whenever the platform reschedules.
//   * Runs as service role, which is what lets it read tables the
//     browser's anon key deliberately cannot (show_slots has zero
//     policies; wallet_transactions is read-only to the owner and this
//     needs the full history).
//
// WHAT IS INCLUDED, and the one rule behind it: everything this person
// created or that describes them — and no file bytes. Recordings and
// B-roll are listed with their metadata and storage paths, not embedded.
// A JSON document with a 400MB video base64'd into it is not an export,
// it is a denial of service against the person who asked for it. The
// paths are enough to request the files themselves through the existing
// signed-URL route.
//
// WHAT IS DELIBERATELY EXCLUDED:
//   * Other people's data. Comments are transient (data-channel only) and
//     were never stored; where a row names another user (a slot claim, a
//     follower), only the fact of the relationship is included, never
//     that person's profile.
//   * Credentials of any kind — no tokens, no device secrets, no hashes.
//   * health_events. It is keyed by LiveKit participant identity rather
//     than user id, so filtering it to one person is not reliably
//     possible, and shipping a best-effort filter of a diagnostics table
//     would risk including someone else's session. Named here rather than
//     silently omitted, and reported in the export's own manifest.

// Three a day is generous for a genuine need and unattractive as an
// amplification vector. The window is rolling, not calendar-day: "you can
// do this again at 14:32" is a real answer, where "try again tomorrow"
// invites a midnight retry loop.
const EXPORTS_PER_WINDOW = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;

// In-process fallback for the pre-migration state only. Weaker by
// construction — it is per function instance — but a weak speed bump
// beats none while `account_requests` does not exist yet, and it
// disappears the moment the table does.
const memoryLimiter = new Map();

function memoryAllows(userId) {
  const now = Date.now();
  const hits = (memoryLimiter.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= EXPORTS_PER_WINDOW) return { ok: false, retryAt: hits[0] + WINDOW_MS };
  hits.push(now);
  memoryLimiter.set(userId, hits);
  return { ok: true };
}

function isMissingRelation(error) {
  if (!error) return false;
  if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code)) return true;
  const msg = String(error.message || '').toLowerCase();
  return (msg.includes('does not exist') || msg.includes('schema cache')) &&
    (msg.includes('relation') || msg.includes('column') || msg.includes('table'));
}

/**
 * Run one section. A section that cannot be read reports WHY, in the
 * export, rather than being silently missing — an export with a hole in
 * it that nobody mentions is worse than one that says "this part was
 * unavailable, here is the reason".
 */
async function section(name, run) {
  try {
    const { data, error } = await run();
    if (error) {
      return [name, { unavailable: isMissingRelation(error) ? 'not_yet_migrated' : 'read_failed', detail: error.message }];
    }
    return [name, data || []];
  } catch (err) {
    return [name, { unavailable: 'read_failed', detail: String(err?.message || err) }];
  }
}

export async function POST(request) {
  try {
    const auth = await verifySession(request);
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const userId = auth.user.id;
    const admin = getSupabaseAdmin();

    // ── Rate limit ────────────────────────────────────────────
    let limitBackend = 'database';
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data: recent, error: limitErr } = await admin
      .from('account_requests')
      .select('created_at')
      .eq('user_id', userId)
      .eq('kind', 'data_export')
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (limitErr && isMissingRelation(limitErr)) {
      limitBackend = 'memory';
      const mem = memoryAllows(userId);
      if (!mem.ok) {
        return NextResponse.json(
          { error: 'You have already requested your data three times today.', retryAt: new Date(mem.retryAt).toISOString() },
          { status: 429 }
        );
      }
    } else if (!limitErr && (recent || []).length >= EXPORTS_PER_WINDOW) {
      const retryAt = new Date(new Date(recent[0].created_at).getTime() + WINDOW_MS).toISOString();
      return NextResponse.json(
        { error: 'You have already requested your data three times today.', retryAt },
        { status: 429 }
      );
    }

    // ── Assemble ──────────────────────────────────────────────
    // Every query is filtered by the verified user id. Nothing here reads
    // an identifier from the request.
    const email = auth.user.email || null;

    const parts = await Promise.all([
      section('profile', () => admin.from('profiles').select('*').eq('id', userId).maybeSingle()),
      section('shows', () => admin.from('shows').select('*').eq('artist_id', userId).order('slated_at', { ascending: false })),
      section('recordings', () =>
        admin.from('recordings')
          .select('id, show_id, storage_path, title, recorded_at, visibility, created_at')
          .eq('artist_id', userId)
          .order('recorded_at', { ascending: false })),
      section('wallet_transactions', () =>
        admin.from('wallet_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false })),
      section('notifications', () =>
        admin.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false })),
      section('follows_i_made', () => admin.from('follows').select('artist_id, created_at').eq('follower_id', userId)),
      section('broll_clips', () =>
        admin.from('broll_clips').select('id, storage_path, title, size_bytes, duration_ms, created_at').eq('artist_id', userId)),
      section('cue_sheets', () => admin.from('cue_sheets').select('*').eq('artist_id', userId)),
      section('slots_i_claimed', () =>
        admin.from('show_slots').select('show_id, slot, invited_username, invite_accepted_at').eq('claimed_by_user_id', userId)),
      section('account_requests', () =>
        admin.from('account_requests').select('kind, status, detail, created_at, completed_at').eq('user_id', userId)),
      // Keyed by email rather than user id — this is the pre-accounts
      // mailing-list table, and email is the only join it has.
      email
        ? section('show_signups', () => admin.from('participants').select('*').eq('email', email))
        : Promise.resolve(['show_signups', { unavailable: 'no_email_on_account' }]),
    ]);

    const sections = Object.fromEntries(parts);

    const payload = {
      // A manifest first, so the file is readable by a person and not
      // only by a parser. Someone opening this wants to know what they
      // are looking at before they scroll 4,000 lines.
      manifest: {
        product: 'Loudentify',
        export_version: 1,
        generated_at: new Date().toISOString(),
        account: { id: userId, email },
        sections: Object.keys(sections),
        excluded: {
          file_contents:
            'Recordings and B-roll are listed with metadata and storage paths. The media itself is not embedded — request individual files through the app.',
          health_events:
            'Diagnostic telemetry is keyed by LiveKit participant identity rather than account id, so it cannot be filtered to one person reliably. Excluded rather than approximated.',
          other_peoples_data:
            'Where a record names another account, only the relationship is included — never their profile.',
          credentials:
            'No passwords, tokens, device secrets or hashes are included, in this or any other section.',
        },
      },
      ...sections,
    };

    const body = JSON.stringify(payload, null, 2);

    // Logged AFTER a successful assembly, so a failed export does not
    // spend the person's daily allowance.
    if (limitBackend === 'database') {
      await admin.from('account_requests').insert({
        user_id: userId,
        kind: 'data_export',
        status: 'completed',
        detail: { bytes: body.length, sections: Object.keys(sections) },
        completed_at: new Date().toISOString(),
      });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="loudentify-export-${stamp}.json"`,
        // This is a person's entire account. It must never sit in a
        // shared cache, a CDN, or a browser's disk cache.
        'Cache-Control': 'no-store, private',
      },
    });
  } catch (err) {
    console.error('[account/export] failed:', err);
    return NextResponse.json({ error: 'Could not build your export.' }, { status: 500 });
  }
}
