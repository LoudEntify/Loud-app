// POST /api/viewer/signup — the one-page sign-up (PRD rows 91, 92).
//
// Server-side so three things are guaranteed, not hoped for:
//   1. an under-18 date of birth is refused BEFORE any row exists, and the
//      date never reaches the database (lib/signupRules.js);
//   2. the consent record (terms + community guidelines, and for performers
//      the separate training-data line) and the audit entry are written in
//      the same request as the account;
//   3. a performer becomes an organisation of one at creation.
// Open by design (nobody has a session before they sign up) and
// rate-limited per client. Returns no session: the client signs in with
// the password it just set, through Supabase Auth as normal.
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../lib/supabaseAdmin';
import { rateLimit, clientKey } from '../../../../lib/rateLimit';
import { correlationFrom, withCorrelation, logEvent } from '../../../../lib/correlation';
import { validateSignup, TERMS_VERSION } from '../../../../lib/signupRules';
import { recordAuditEvent } from '../../../../lib/audit';

export async function POST(request) {
  const cid = correlationFrom(request);
  const gate = rateLimit(clientKey(request, 'signup'), { limit: 10, windowMs: 10 * 60000 });
  if (!gate.ok) return withCorrelation(NextResponse.json({ error: 'Too many sign-ups from this connection. Try again in a few minutes.' }, { status: 429 }), cid);
  let input; try { input = await request.json(); } catch { input = {}; }
  const v = validateSignup(input);
  if (v.underage) return withCorrelation(NextResponse.json({ underage: true }, { status: 200 }), cid);
  if (!v.ok) return withCorrelation(NextResponse.json({ errors: v.errors }, { status: 400 }), cid);
  const { values } = v;
  const admin = getSupabaseAdmin();

  const { data: taken } = await admin.from('profiles').select('id').eq('username', values.username).maybeSingle();
  if (taken) return withCorrelation(NextResponse.json({ errors: { username: 'That username is taken.' } }, { status: 409 }), cid);

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: values.email, password: values.password, email_confirm: true,
    user_metadata: { role: values.role, display_name: values.displayName, username: values.username, full_name: values.fullName, country: values.country },
  });
  if (createErr || !created?.user) {
    const msg = /already/i.test(createErr?.message || '') ? 'There is already an account with that email. Log in instead.' : 'Could not create the account. Try again.';
    return withCorrelation(NextResponse.json({ errors: { email: msg } }, { status: /already/i.test(createErr?.message || '') ? 409 : 500 }), cid);
  }
  const userId = created.user.id;
  const profile = {
    id: userId, role: values.role, display_name: values.displayName, full_name: values.fullName, username: values.username,
    date_of_birth: values.dateOfBirth, country: values.country, city: values.city, genres: [],
    onboarding: { version: 2, started_at: new Date().toISOString(), trigger: input.trigger || null },
  };
  const { error: pErr } = await admin.from('profiles').insert(profile);
  if (pErr) {
    logEvent('error', 'signup.profile_failed', { correlationId: cid, code: pErr.code });
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return withCorrelation(NextResponse.json({ errors: { form: 'Could not finish the account. Nothing was saved. Try again.' } }, { status: 500 }), cid);
  }
  const consents = [{ user_id: userId, consent_type: 'terms', granted: true, source: 'signup', document_version: TERMS_VERSION }];
  if (values.role === 'artist') consents.push({ user_id: userId, consent_type: 'training_data', granted: !values.trainingDataOptOut, source: 'signup', document_version: TERMS_VERSION });
  await admin.from('consent_records').insert(consents);
  if (values.role === 'artist') {
    const { data: org } = await admin.from('organisations').insert({ name: values.displayName, kind: 'solo' }).select('id').single();
    if (org) await admin.from('organisation_members').insert({ organisation_id: org.id, user_id: userId, role: 'owner' });
  }
  await recordAuditEvent(admin, { actorType: values.role, actorId: userId, action: 'account.created', subjectType: 'profiles', subjectId: userId, correlationId: cid, after: { role: values.role, trigger: input.trigger || null } });
  return withCorrelation(NextResponse.json({ ok: true, userId }), cid);
}
