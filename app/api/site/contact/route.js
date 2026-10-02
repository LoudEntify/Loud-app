// POST /api/site/contact — the website's contact form (design/WebContact).
// Public: nobody has an account before they write in. Rate-limited per
// client (5 per 10 minutes), fields validated here, the row written with
// the service role (RLS has no policies, by design), and the event logged
// with its correlation id so a reply can cite it. Nothing is emailed yet:
// the mail provider is Korey's (docs/NEEDS_KOREY.md).
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation, logEvent } from '../../../../lib/correlation';
import { optionalSession } from '../../../../lib/viewerAuth';
import { validateContact } from '../../../../lib/site/contact';

export async function POST(request) {
  const cid = correlationFrom(request);
  const key = clientKey(request, 'contact');
  const gate = rateLimit(key, { limit: 5, windowMs: 10 * 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Too many messages in a row. Try again in a few minutes.' }, { status: 429 }), cid);
  let body = null; try { body = await request.json(); } catch { body = null; }
  const v = validateContact(body);
  if (!v.ok) return withCorrelation(NextResponse.json({ error: 'Check the form', errors: v.errors }, { status: v.errors.website ? 200 : 400 }), cid);
  const session = await optionalSession(request).catch(() => null);
  const admin = getSupabaseAdmin();
  const { error } = await admin.from('site_messages').insert({ ...v.values, client_hash: key, user_id: session?.user?.id || null, correlation_id: cid });
  if (error) { logEvent('site.contact.failed', { cid, error: error.message }); return withCorrelation(NextResponse.json({ error: 'We could not save your message. Please try again.' }, { status: 500 }), cid); }
  logEvent('site.contact.received', { cid, topic: v.values.topic });
  return withCorrelation(NextResponse.json({ ok: true, correlationId: cid }), cid);
}
