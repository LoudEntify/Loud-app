import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.SMOKE_URL || 'http://localhost:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) throw new Error('Missing Supabase configuration.');

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomBytes(4).toString('hex');
const created = [];
let browser;
const pass = message => console.log(`PASS: ${message}`);

async function artist(suffix) {
  const email = `versus-${run}-${suffix}@example.invalid`;
  const password = `V-${randomBytes(18).toString('hex')}!`;
  const username = `vs_${run}_${suffix}`;
  const displayName = suffix === 'host' ? 'Versus Host' : 'Versus Guest';
  const generated = await admin.auth.admin.generateLink({ type: 'signup', email, password, options: { data: { role: 'artist', username, display_name: displayName } } });
  if (generated.error) throw generated.error;
  created.push(generated.data.user.id);
  const verified = await anon().auth.verifyOtp({ type: 'signup', token_hash: generated.data.properties.hashed_token });
  if (verified.error || !verified.data.session) throw verified.error || new Error('Could not verify temporary artist.');
  const { error: profileError } = await admin.from('profiles').insert({ id: generated.data.user.id, role: 'artist', display_name: displayName, full_name: displayName, username, date_of_birth: '1990-01-01', country: 'GB', genres: [] });
  if (profileError) throw profileError;
  return { id: generated.data.user.id, email, username, displayName, session: verified.data.session };
}

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

try {
  const host = await artist('host');
  const guest = await artist('guest');
  const slatedAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const show = await admin.from('shows').insert({ artist_id: host.id, artist_name: host.displayName, room_name: `versus-${run}`, title: `Versus test ${run}`, slated_at: slatedAt, duration_minutes: 60, performance_mode: 'versus', state: 'scheduled' }).select('*').single();
  if (show.error) throw show.error;

  const invited = await api('/api/performer/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.session.access_token}` },
    body: JSON.stringify({ show_id: show.data.id, invited_user_id: guest.id }),
  });
  assert.equal(invited.response.status, 200, JSON.stringify(invited.body));
  assert.equal(invited.body.notified, true);
  assert.ok(invited.body.inviteToken);
  pass('host can target a Versus invitation to another artist');

  const guestNotice = await admin.from('notifications').select('body,href').eq('user_id', guest.id).single();
  if (guestNotice.error) throw guestNotice.error;
  assert.ok(guestNotice.data.href?.includes(`/join/${invited.body.inviteToken}`));
  pass('targeted artist receives an in-app invitation');

  const preview = await api(`/api/performer/invite?token=${encodeURIComponent(invited.body.inviteToken)}`);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.showId, show.data.id);
  pass('invitation preview is readable before joining the live room');

  const accepted = await api('/api/performer/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest.session.access_token}` },
    body: JSON.stringify({ invite_token: invited.body.inviteToken }),
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.showId, show.data.id);

  const slot = await admin.from('show_slots').select('slot,claimed_by_user_id,invite_token,invite_accepted_at').eq('show_id', show.data.id).eq('slot', 'b').single();
  if (slot.error) throw slot.error;
  assert.equal(slot.data.claimed_by_user_id, guest.id);
  assert.equal(slot.data.invite_token, null);
  assert.ok(slot.data.invite_accepted_at);
  pass('guest accepts early without opening LiveKit and permanently claims slot B');

  const mine = await api('/api/performer/my-slots', { headers: { Authorization: `Bearer ${guest.session.access_token}` } });
  assert.equal(mine.response.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.slots?.[0]?.status, 'claimed');
  assert.equal(mine.body.slots?.[0]?.show?.id, show.data.id);
  pass('accepted Versus show appears in the guest artist’s own schedule');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: storageKey, session: guest.session });
  const page = await context.newPage();
  await page.goto(`${base}/dashboard/artist`);
  await page.getByText('YOU ARE PERFORMING IN', { exact: true }).waitFor();
  await page.getByText(show.data.title, { exact: true }).waitFor();
  pass('confirmed guest performance is visible on the main artist dashboard');
  await context.close();

  const reused = await api('/api/performer/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest.session.access_token}` },
    body: JSON.stringify({ invite_token: invited.body.inviteToken }),
  });
  assert.equal(reused.response.status, 404);
  pass('accepted invitation token cannot be reused');
} finally {
  await browser?.close();
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.error('CLEANUP ERROR: temporary Versus user could not be deleted');
    else pass('temporary Versus artist deleted');
  }
}
