import { randomBytes, createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { verifySession } from '../../../../lib/verifyArtistAuth';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { hashInteractionToken } from '../../../../lib/interactions.mjs';

const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

// AUTH MODEL: public, abuse-resistant session minting. Signed-in callers
// are bound to their account; anonymous callers receive a random bearer
// stored only as a hash. Rate limit plus a coarse request fingerprint
// limits session farming without turning a YouTube view into signup.
export async function POST(request) {
  const gate = rateLimit(clientKey(request, 'interaction-session'), RATE_LIMIT);
  if (!gate.ok) return NextResponse.json({ error: 'Too many interaction sessions.' }, { status: 429 });
  const { showId } = await request.json().catch(() => ({}));
  if (!showId) return NextResponse.json({ error: 'showId is required' }, { status: 400 });
  const admin = getSupabaseAdmin();
  const { data: show } = await admin.from('shows').select('id,state').eq('id', showId).maybeSingle();
  if (!show || show.state === 'ended') return NextResponse.json({ error: 'This show is not accepting interactions.' }, { status: 409 });
  let userId = null;
  if ((request.headers.get('authorization') || '').startsWith('Bearer ')) {
    const auth = await verifySession(request);
    if (!auth.error) userId = auth.user.id;
  }
  const token = randomBytes(32).toString('base64url');
  const fingerprint = createHash('sha256').update(`${clientKey(request, 'interaction-fingerprint')}|${request.headers.get('user-agent') || ''}`).digest('hex');
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from('interaction_sessions').insert({ show_id: show.id, user_id: userId, token_hash: hashInteractionToken(token), fingerprint_hash: fingerprint, expires_at: expiresAt }).select('id').single();
  if (error) return NextResponse.json({ error: 'Interactions are not available.' }, { status: 503 });
  await admin.from('interaction_audit_events').insert({ show_id: show.id, interaction_session_id: data.id, event_type: 'SESSION_CREATED', detail: { authenticated: !!userId } });
  return NextResponse.json({ token, expiresAt });
}
