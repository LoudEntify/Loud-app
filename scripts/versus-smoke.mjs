import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { getAdjacentLiveShows, showHref, switchToLiveShow, targetForDiscoverySwipe } from '../lib/liveShowDiscovery.js';

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.SMOKE_URL || 'http://localhost:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const liveStreamingReady = Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
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

  const liveTitle = `Live discovery ${run}`;
  const liveShow = await admin.from('shows').insert({ artist_id: guest.id, artist_name: guest.displayName, room_name: `discovery-${run}`, title: liveTitle, slated_at: new Date(Date.now() - 60000).toISOString(), duration_minutes: 60, performance_mode: 'solo', state: 'soundcheck' }).select('id').single();
  if (liveShow.error) throw liveShow.error;
  const discovered = await getAdjacentLiveShows(show.data.id);
  assert.ok(discovered.some((item) => item.id === liveShow.data.id && item.showTitle === liveTitle));
  assert.equal(showHref(liveShow.data.id), `/live?show=${liveShow.data.id}`);
  let navigatedTo = '';
  assert.equal(switchToLiveShow(liveShow.data.id, (href) => { navigatedTo = href; }), true);
  assert.equal(navigatedTo, `/live?show=${liveShow.data.id}`);
  assert.equal(targetForDiscoverySwipe(discovered, { dx: -90, dy: 8, elapsedMs: 300 })?.id, discovered[0].id);
  assert.equal(targetForDiscoverySwipe(discovered, { dx: -30, dy: 2, elapsedMs: 200 }), null);
  assert.equal(targetForDiscoverySwipe(discovered, { dx: -100, dy: 100, elapsedMs: 200 }), null);
  pass('live discovery returns active shows and routes viewers to the selected stage');

  const earlyHostJoin = await api('/api/performer/join-show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.session.access_token}` },
    body: JSON.stringify({ show_id: show.data.id }),
  });
  assert.equal(earlyHostJoin.response.status, 403, JSON.stringify(earlyHostJoin.body));
  assert.ok(earlyHostJoin.body.error?.startsWith('Too early'));
  pass('server enforces the live window before checking streaming infrastructure');

  const invited = await api('/api/performer/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.session.access_token}` },
    body: JSON.stringify({ show_id: show.data.id, invited_user_id: guest.id }),
  });
  assert.equal(invited.response.status, 200, JSON.stringify(invited.body));
  assert.equal(invited.body.notified, true);
  assert.ok(invited.body.inviteToken);
  let inviteToken = invited.body.inviteToken;
  pass('host can target a Versus invitation to another artist');

  const guestNotice = await admin.from('notifications').select('body,href').eq('user_id', guest.id).single();
  if (guestNotice.error) throw guestNotice.error;
  assert.ok(guestNotice.data.href?.includes(`/join/${inviteToken}`));
  pass('targeted artist receives an in-app invitation');

  const preview = await api(`/api/performer/invite?token=${encodeURIComponent(inviteToken)}`);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.showId, show.data.id);
  pass('invitation preview is readable before joining the live room');

  const declined = await api('/api/performer/accept-invite', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest.session.access_token}` },
    body: JSON.stringify({ invite_token: inviteToken }),
  });
  assert.equal(declined.response.status, 200, JSON.stringify(declined.body));
  const declinedPreview = await api(`/api/performer/invite?token=${encodeURIComponent(inviteToken)}`);
  assert.equal(declinedPreview.response.status, 404);
  const declinedInviteNotice = await admin.from('notifications').select('body,href,read_at').eq('user_id', guest.id).eq('dedupe_key', `versus_invite:${show.data.id}`).single();
  if (declinedInviteNotice.error) throw declinedInviteNotice.error;
  assert.ok(declinedInviteNotice.data.body.startsWith('You declined'));
  assert.equal(declinedInviteNotice.data.href, '/dashboard/artist');
  assert.ok(declinedInviteNotice.data.read_at);
  const declineNotice = await admin.from('notifications').select('id').eq('user_id', host.id).eq('dedupe_key', `show-invite-declined:${show.data.id}:${guest.id}`).single();
  if (declineNotice.error) throw declineNotice.error;
  pass('invited artist can decline and release slot B back to the host');

  const afterDeclineInvite = await api('/api/performer/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.session.access_token}` },
    body: JSON.stringify({ show_id: show.data.id, invited_user_id: guest.id }),
  });
  assert.equal(afterDeclineInvite.response.status, 200, JSON.stringify(afterDeclineInvite.body));
  inviteToken = afterDeclineInvite.body.inviteToken;

  const withdrawn = await api(`/api/performer/show-lineup?show_id=${encodeURIComponent(show.data.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${host.session.access_token}` } });
  assert.equal(withdrawn.response.status, 200, JSON.stringify(withdrawn.body));
  const withdrawnPreview = await api(`/api/performer/invite?token=${encodeURIComponent(inviteToken)}`);
  assert.equal(withdrawnPreview.response.status, 404);
  const withdrawalNotice = await admin.from('notifications').select('body,href,read_at').eq('user_id', guest.id).eq('dedupe_key', `versus_invite:${show.data.id}`).single();
  if (withdrawalNotice.error) throw withdrawalNotice.error;
  assert.ok(withdrawalNotice.data.body.includes('withdrawn'));
  assert.equal(withdrawalNotice.data.href, '/dashboard/artist');
  assert.equal(withdrawalNotice.data.read_at, null);
  pass('host can withdraw a pending invite and invalidate its token');

  const reinvited = await api('/api/performer/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.session.access_token}` },
    body: JSON.stringify({ show_id: show.data.id, invited_user_id: guest.id }),
  });
  assert.equal(reinvited.response.status, 200, JSON.stringify(reinvited.body));
  inviteToken = reinvited.body.inviteToken;
  assert.ok(inviteToken);
  pass('host can choose a performer again after withdrawing an invite');

  browser = await chromium.launch({ headless: true });
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const acceptContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await acceptContext.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: storageKey, session: guest.session });
  const acceptPage = await acceptContext.newPage();
  await acceptPage.goto(`${base}/dashboard/artist`);
  await acceptPage.getByText('INVITATIONS', { exact: true }).waitFor();
  await acceptPage.getByText(show.data.title, { exact: true }).waitFor();
  await acceptPage.getByRole('button', { name: 'ACCEPT', exact: true }).click();
  await acceptPage.getByText('YOU ARE PERFORMING IN', { exact: true }).waitFor();
  pass('guest can accept a pending invitation directly from the artist dashboard');
  await acceptContext.close();

  const slot = await admin.from('show_slots').select('slot,claimed_by_user_id,invite_token,invite_accepted_at').eq('show_id', show.data.id).eq('slot', 'b').single();
  if (slot.error) throw slot.error;
  assert.equal(slot.data.claimed_by_user_id, guest.id);
  assert.equal(slot.data.invite_token, null);
  assert.ok(slot.data.invite_accepted_at);
  const acceptedNotice = await admin.from('notifications').select('body,href,read_at').eq('user_id', guest.id).eq('dedupe_key', `versus_invite:${show.data.id}`).single();
  if (acceptedNotice.error) throw acceptedNotice.error;
  assert.ok(acceptedNotice.data.body.startsWith('You accepted'));
  assert.equal(acceptedNotice.data.href, '/dashboard/artist');
  assert.ok(acceptedNotice.data.read_at);
  pass('guest accepts early without opening LiveKit and permanently claims slot B');

  const mine = await api('/api/performer/my-slots', { headers: { Authorization: `Bearer ${guest.session.access_token}` } });
  assert.equal(mine.response.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.slots?.[0]?.status, 'claimed');
  assert.equal(mine.body.slots?.[0]?.show?.id, show.data.id);
  pass('accepted Versus show appears in the guest artist’s own schedule');

  const updatedTitle = `Updated Versus ${run}`;
  const updatedSlatedAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const rescheduled = await api(`/api/shows/${show.data.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.session.access_token}` },
    body: JSON.stringify({ title: updatedTitle, slated_at: updatedSlatedAt, duration_minutes: 90 }),
  });
  assert.equal(rescheduled.response.status, 200, JSON.stringify(rescheduled.body));
  const updateNotice = await admin.from('notifications').select('body,href,read_at').eq('user_id', guest.id).eq('dedupe_key', `show-updated:${show.data.id}:${guest.id}`).single();
  if (updateNotice.error) throw updateNotice.error;
  assert.ok(updateNotice.data.body.includes(updatedTitle));
  assert.equal(updateNotice.data.read_at, null);
  const updatedMine = await api('/api/performer/my-slots', { headers: { Authorization: `Bearer ${guest.session.access_token}` } });
  assert.equal(updatedMine.body.slots?.[0]?.show?.title, updatedTitle);
  assert.equal(updatedMine.body.slots?.[0]?.show?.durationMinutes, 90);
  show.data.title = updatedTitle;
  show.data.slated_at = updatedSlatedAt;
  pass('rescheduling notifies the guest and updates their own calendar');

  const lineup = await api(`/api/performer/show-lineup?show_id=${encodeURIComponent(show.data.id)}`, { headers: { Authorization: `Bearer ${host.session.access_token}` } });
  assert.equal(lineup.response.status, 200, JSON.stringify(lineup.body));
  assert.equal(lineup.body.status, 'claimed');
  assert.equal(lineup.body.artist?.id, guest.id);
  pass('host line-up endpoint persists the confirmed slot-B artist');

  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await hostContext.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: storageKey, session: host.session });
  const hostPage = await hostContext.newPage();
  await hostPage.goto(`${base}/schedule`);
  if (!liveStreamingReady) await hostPage.getByText('Live streaming setup is pending.').waitFor();
  await hostPage.getByText('LINE-UP CONFIRMED', { exact: true }).waitFor();
  await hostPage.getByText(guest.displayName, { exact: false }).waitFor();
  assert.equal(await hostPage.getByPlaceholder('Search for the other artist').count(), 0);
  pass('host schedule remembers the accepted performer after a fresh page load');

  if (!liveStreamingReady) {
    await hostPage.goto(`${base}/kit-check`);
    await hostPage.getByText('STREAMING SETUP PENDING', { exact: true }).waitFor();
    const goLiveButton = hostPage.getByRole('button', { name: 'GO LIVE NOW', exact: true });
    await goLiveButton.waitFor();
    assert.equal(await goLiveButton.isDisabled(), true);
    pass('Kit Check stays usable but cannot hand off to an unconfigured live stage');
  }
  await hostContext.close();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: storageKey, session: guest.session });
  const page = await context.newPage();
  await page.goto(`${base}/dashboard/artist`);
  await page.getByText('YOU ARE PERFORMING IN', { exact: true }).waitFor();
  await page.getByText(show.data.title, { exact: true }).waitFor();
  pass('confirmed guest performance is visible on the main artist dashboard');

  const cancelled = await api(`/api/shows/${show.data.id}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${host.session.access_token}` } });
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
  const cancelNotice = await admin.from('notifications').select('body,href,read_at').eq('user_id', guest.id).eq('dedupe_key', `show-cancelled:${show.data.id}:${guest.id}`).single();
  if (cancelNotice.error) throw cancelNotice.error;
  assert.equal(cancelNotice.data.href, '/dashboard/artist');
  assert.equal(cancelNotice.data.read_at, null);
  const afterCancel = await api('/api/performer/my-slots', { headers: { Authorization: `Bearer ${guest.session.access_token}` } });
  assert.deepEqual(afterCancel.body.slots, []);
  await page.reload();
  await page.getByText(show.data.title, { exact: true }).waitFor({ state: 'hidden' });
  pass('cancelling a confirmed show notifies the guest and removes it from their dashboard');
  await context.close();

  const reused = await api('/api/performer/accept-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest.session.access_token}` },
    body: JSON.stringify({ invite_token: inviteToken }),
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
