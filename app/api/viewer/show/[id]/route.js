// GET /api/viewer/show/:id — the public show payload for the show screen.
// Open and rate-limited; a signed-in caller also gets their own vote.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../../lib/rateLimit';
import { correlationFrom, withCorrelation } from '../../../../../lib/correlation';
import { optionalSession } from '../../../../../lib/viewerAuth';
import { loadShowForViewer, viewerCount, openPrompt } from '../../../../../lib/showPayload';

export async function GET(request, { params }) {
  const cid = correlationFrom(request);
  const gate = rateLimit(clientKey(request, 'viewer-show'), { limit: 240, windowMs: 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Rate limited' }, { status: 429 }), cid);
  const admin = getSupabaseAdmin();
  const { show, error } = await loadShowForViewer(admin, params.id);
  if (error) return withCorrelation(NextResponse.json({ error: 'Could not load this show.' }, { status: 503 }), cid);
  if (!show) return withCorrelation(NextResponse.json({ error: 'No such show.' }, { status: 404 }), cid);
  const [count, prompt, session] = await Promise.all([viewerCount(admin, show.id), openPrompt(admin, show), optionalSession(request)]);
  let myVote = null;
  if (prompt && session.user) {
    const { data } = await admin.from('prompt_responses').select('choice_index, text_body').eq('prompt_id', prompt.id).eq('user_id', session.user.id).maybeSingle();
    myVote = data || null;
  }
  let following = false;
  let reminded = false;
  if (session.user) {
    const [{ data: f }, { data: r }] = await Promise.all([
      admin.from('follows').select('artist_id').eq('follower_id', session.user.id).eq('artist_id', show.artist_id).maybeSingle(),
      admin.from('show_reminders').select('show_id').eq('user_id', session.user.id).eq('show_id', show.id).maybeSingle(),
    ]);
    following = Boolean(f); reminded = Boolean(r);
  }
  const { data: nextShow } = await admin.from('shows').select('id, title, slated_at').eq('artist_id', show.artist_id).gt('slated_at', new Date().toISOString()).is('cancelled_at', null).neq('id', show.id).order('slated_at').limit(1).maybeSingle();
  return withCorrelation(NextResponse.json({ show, viewers: count, prompt, myVote, following, reminded, nextShow: nextShow || null, serverNow: new Date().toISOString() }), cid);
}
