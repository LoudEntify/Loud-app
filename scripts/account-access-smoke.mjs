// Live integration check. Creates only unique temporary test users, sends no
// emails, and deletes those users (and their profiles) in finally.
// Requires the configured Supabase service-role key and a running local app.
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

nextEnv.loadEnvConfig(process.cwd());
const base = process.env.SMOKE_URL || 'http://localhost:3000';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anon) throw new Error('Missing Supabase configuration.');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const client = () => createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomBytes(4).toString('hex');
const created = [];
let browser;
let artistFixture = null;
const pass = text => console.log(`PASS: ${text}`);
const requireResult = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.code || result.error.status || 'request failed'}`);
  return result.data;
};

try {
  requireResult(await admin.from('profiles').select('id,role,display_name,genres,full_name,username,date_of_birth,country').limit(0), 'Account schema');
  const { error: versusSchemaError } = await admin.from('show_slots').select('id').limit(0);
  const versusReady = !versusSchemaError;
  const { error: followsSchemaError } = await admin.from('follows').select('artist_id').limit(0);
  const followsReady = !followsSchemaError;
  browser = await chromium.launch({ headless: true });
  for (const role of ['artist', 'viewer']) {
    const audience = role === 'artist' ? 'artist' : 'fan';
    const password = `A-${randomBytes(18).toString('hex')}!`;
    const email = `loud-access-${run}-${audience}@example.invalid`;
    const metadata = { role, display_name: `Access test ${audience}`, full_name: 'Temporary account test', username: `test_${run}_${role === 'artist' ? 'a' : 'f'}`, date_of_birth: '1990-01-01', country: 'GB', genres: [] };
    // Generate the same confirmation credential as email signup, without
    // dispatching an email or needing access to anyone's real mailbox.
    const generated = requireResult(await admin.auth.admin.generateLink({ type: 'signup', email, password, options: { data: metadata } }), 'Generate temporary signup');
    created.push(generated.user.id);
    const before = requireResult(await admin.from('profiles').select('id').eq('id', generated.user.id), 'Profile before confirmation');
    assert.equal(before.length, 0);
    const confirmed = requireResult(await client().auth.verifyOtp({ token_hash: generated.properties.hashed_token, type: 'signup' }), 'Verify signup confirmation');
    assert.ok(confirmed.session);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
    await context.addInitScript(({ storageKey, session }) => {
      // Seed once to reproduce arrival from email confirmation. Never overwrite
      // an established session after password recovery or sign-out.
      if (!sessionStorage.getItem('account-smoke-seeded')) {
        localStorage.setItem(storageKey, JSON.stringify(session));
        sessionStorage.setItem('account-smoke-seeded', '1');
      }
    }, { storageKey, session: confirmed.session });
    const page = await context.newPage();
    await page.goto(`${base}/auth/${audience}`);
    await page.waitForURL(`**/dashboard/${audience}`, { timeout: 30000 });
    await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
    await page.getByRole('banner').getByRole('link', { name: 'Loudentify home' }).waitFor();
    await page.getByRole('navigation', { name: 'Main navigation' }).waitFor();
    const profile = requireResult(await admin.from('profiles').select('*').eq('id', generated.user.id).single(), 'Profile after confirmation');
    if (role === 'artist') artistFixture = { id: generated.user.id, displayName: profile.display_name };
    assert.equal(profile.role, role); assert.equal(profile.date_of_birth, '1990-01-01'); assert.equal(profile.country, 'GB');
    pass(`${audience}: confirmation session initializes its profile and opens the correct dashboard`);
    const taken = await fetch(`${base}/api/auth/username?username=${metadata.username}`).then(r => r.json());
    assert.equal(taken.available, false);
    const free = await fetch(`${base}/api/auth/username?username=free_${run}`).then(r => r.json());
    assert.equal(free.available, true);
    pass(`${audience}: server checks detect taken handles without exposing profiles`);

    const wrong = role === 'artist' ? 'fan' : 'artist';
    await page.goto(`${base}/dashboard/${wrong}`);
    await page.waitForURL(`**/dashboard/${audience}`);
    pass(`${audience}: opposite dashboard resolves from the stored role`);
    await page.goto(`${base}/`);
    const studioLink = page.getByRole('link', { name: 'Open Studio', exact: true }).first();
    await studioLink.waitFor();
    await studioLink.click();
    await page.waitForURL(`**/dashboard/${audience}`);
    pass(`${audience}: public navbar recognizes the session and returns to the correct dashboard`);
    if (role === 'artist') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/`);
      const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
      await menuButton.click();
      assert.equal(await page.locator('#mobile-navigation').getAttribute('aria-hidden'), 'false');
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#mobile-navigation').getAttribute('aria-hidden'), 'true');
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${base}/dashboard/artist`);
      pass('mobile navbar locks background scroll and closes accessibly with Escape');
    }
    if (role === 'artist') {
      await page.getByRole('heading', { name: 'Get ready for your stage.' }).waitFor();
      await page.getByRole('link', { name: 'LIVE', exact: true }).click();
      await page.waitForURL('**/live');
      await page.getByRole('heading', { name: 'Your next live moment starts here.' }).waitFor();
      await page.getByRole('link', { name: 'Back to my profile', exact: false }).click();
      await page.waitForURL(`**/artist/${profile.id}`);
      await page.getByText('Profile not found', { exact: true }).waitFor({ state: 'hidden' });
      await page.goto(`${base}/dashboard/artist`);
      pass('artist Live navigation opens its studio and provides a working return to profile');

      await page.getByRole('link', { name: /Finish your artist profile/ }).waitFor();
      assert.ok(await page.getByRole('link', { name: /Open kit check/ }).isVisible());
      await page.screenshot({ path: process.env.ACCOUNT_SMOKE_SCREENSHOT || '/private/tmp/loud-artist-dashboard.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, undefined, { timeout: 5000 });
      await page.screenshot({ path: '/private/tmp/loud-artist-dashboard-mobile.png', fullPage: true });
      const overflow = await page.evaluate(() => ({width: innerWidth, actual: document.documentElement.scrollWidth, elements: Array.from(document.querySelectorAll('main *')).filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0,8).map(e => ({tag:e.tagName, class:e.className, right:e.getBoundingClientRect().right}))}));
      assert.ok(overflow.actual <= overflow.width, JSON.stringify(overflow));
      pass('artist dashboard has profile preparation, equipment access and no mobile overflow');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('link', { name: /Finish your artist profile/ }).click();
      await page.getByPlaceholder('Display name').fill('Temporary stage name');
      await page.getByPlaceholder('Bio', { exact: true }).fill('Temporary artist integration check.');
      const genre = page.getByPlaceholder('Add a genre…');
      await genre.fill('Afrobeats'); await genre.press('Enter'); await page.keyboard.press('Tab');
      await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
      await page.getByText('Saved.', { exact: true }).waitFor();
      await page.goto(`${base}/dashboard/artist`);
      await page.getByRole('link', { name: /Check your camera and sound/ }).waitFor();
      const saved = requireResult(await admin.from('profiles').select('display_name,bio,genres').eq('id', generated.user.id).single(), 'Saved artist details');
      assert.equal(saved.display_name, 'Temporary stage name');
      assert.ok(saved.genres.includes('Afrobeats')); assert.equal(saved.bio, 'Temporary artist integration check.');
      pass('artist profile edits persist and advance the dashboard to equipment preparation');

      const showTitle = `Smoke show ${run}`;
      const showDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      await page.goto(`${base}/schedule`);
      await page.getByRole('heading', { name: /Put your next/ }).waitFor();
      await page.getByRole('link', { name: 'SCHEDULE', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'VERSUS' }).isDisabled(), !versusReady);
      await page.getByPlaceholder('What are you calling this one?').fill(showTitle);
      await page.locator('input[type="date"]').fill(showDate);
      await page.locator('input[type="time"]').fill('12:00');
      await page.getByRole('button', { name: 'SCHEDULE SHOW' }).click();
      await page.getByText(showTitle, { exact: true }).waitFor();
      const scheduled = requireResult(await admin.from('shows').select('artist_id,state,duration_minutes,performance_mode').eq('artist_id', generated.user.id).eq('title', showTitle).single(), 'Scheduled show');
      assert.equal(scheduled.artist_id, generated.user.id);
      assert.equal(scheduled.state, 'scheduled');
      assert.equal(scheduled.duration_minutes, 60);
      assert.equal(scheduled.performance_mode, 'solo');
      pass('artist schedule page creates an owner-scoped show and keeps the sidebar visible');
      const editedTitle = `${showTitle} edited`;
      const editedDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      await page.getByRole('button', { name: 'EDIT SHOW' }).click();
      await page.getByLabel('EDIT SHOW TITLE').fill(editedTitle);
      await page.getByLabel('EDIT SHOW DATE').fill(editedDate);
      await page.getByLabel('EDIT SHOW TIME').fill('14:30');
      await page.getByLabel('EDIT SHOW DURATION').selectOption('90');
      await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
      await page.getByText(editedTitle, { exact: true }).waitFor();
      const edited = requireResult(await admin.from('shows').select('title,slated_at,duration_minutes').eq('artist_id', generated.user.id).eq('title', editedTitle).single(), 'Edited show');
      assert.equal(edited.duration_minutes, 90);
      assert.ok(edited.slated_at.startsWith(editedDate));
      pass('artist can reschedule and edit a show before it starts');
      await page.getByRole('button', { name: 'CANCEL SHOW' }).click();
      const [cancelResponse] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/shows/') && response.url().endsWith('/cancel')),
        page.getByRole('button', { name: 'YES, CANCEL' }).click(),
      ]);
      assert.equal(cancelResponse.status(), 200, await cancelResponse.text());
      await page.getByText(editedTitle, { exact: true }).waitFor({ state: 'hidden' });
      let cancelledShow = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        cancelledShow = requireResult(await admin.from('shows').select('state,cancelled_at,cancelled_reason,actual_started_at').eq('artist_id', generated.user.id).eq('title', editedTitle).single(), 'Cancelled show');
        if (cancelledShow.state === 'ended') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(cancelledShow.state, 'ended');
      assert.ok(cancelledShow.cancelled_at);
      assert.equal(cancelledShow.cancelled_reason, 'artist_cancelled');
      assert.equal(cancelledShow.actual_started_at, null);
      pass('artist can confirm cancellation without recording a false performance end');

    }
    if (role === 'viewer') {
      await page.goto(`${base}/dashboard/fan`);
      await page.getByRole('heading', { name: 'Your front row.' }).waitFor();
      if (followsReady) {
        assert.ok(artistFixture);
        requireResult(await admin.from('follows').insert({ follower_id: generated.user.id, artist_id: artistFixture.id }), 'Create temporary follow');
        const followedTitle = `Followed show ${run}`;
        const followedShow = requireResult(await admin.from('shows').insert({ artist_id: artistFixture.id, artist_name: artistFixture.displayName, room_name: `followed-${run}`, title: followedTitle, slated_at: new Date(Date.now() + 29 * 60000).toISOString(), duration_minutes: 60, performance_mode: 'solo', state: 'scheduled' }).select('id').single(), 'Create followed show');
        await page.reload();
        await page.getByText(followedTitle, { exact: true }).waitFor();
        let fanReminder = null;
        for (let reminderAttempt = 0; reminderAttempt < 10; reminderAttempt += 1) {
          const result = await admin.from('notifications').select('kind,href').eq('user_id', generated.user.id).eq('dedupe_key', `followed-show:${followedShow.id}:reminder:30`).maybeSingle();
          if (result.error) throw result.error;
          fanReminder = result.data;
          if (fanReminder) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(fanReminder?.kind, 'show_reminder');
        assert.equal(fanReminder?.href, `/live?show=${followedShow.id}`);
        pass('fan dashboard surfaces followed shows and creates a deduplicated fan reminder');
      } else {
        await page.getByRole('link', { name: /Find artists to follow/ }).waitFor();
        pass('fan dashboard degrades safely while the follows migration is pending');
      }
      requireResult(await admin.from('notifications').upsert({ user_id: generated.user.id, kind: 'system', body: `Notification badge ${run}`, href: '/dashboard/fan', dedupe_key: `account-smoke-badge:${run}` }, { onConflict: 'user_id,dedupe_key' }), 'Create badge notification');
      await page.reload();
      const notificationsLink = page.getByRole('link', { name: /NOTIFICATIONS/ });
      await notificationsLink.locator('[aria-label$=" unread"]').waitFor();
      await notificationsLink.click();
      await page.getByText(`Notification badge ${run}`, { exact: true }).waitFor();
      await notificationsLink.locator('[aria-label$=" unread"]').waitFor({ state: 'hidden' });
      pass('opening notifications renders new activity and clears the shared sidebar badge');
      await page.goto(`${base}/schedule`);
      await page.getByText('Artist scheduling only', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'SCHEDULE', exact: true }).count(), 0);
      pass('fan accounts cannot use artist scheduling or see its sidebar destination');
    }
    // Owner-only profiles: a second anonymous client cannot read the test row.
    const publicRows = requireResult(await client().from('profiles').select('id').eq('id', generated.user.id), 'Anonymous profile access');
    assert.equal(publicRows.length, 0);
    pass(`${audience}: private profile is hidden from anonymous clients`);
    await context.close();

    const loginContext = await browser.newContext();
    const loginPage = await loginContext.newPage();
    await loginPage.goto(`${base}/auth/${audience}`);
    await loginPage.getByLabel('EMAIL ADDRESS', { exact: true }).fill(email);
    await loginPage.getByLabel('PASSWORD', { exact: true }).fill(password);
    await loginPage.getByRole('button', { name: 'Step inside' }).click();
    await loginPage.waitForURL(`**/dashboard/${audience}`, { timeout: 30000 });
    pass(`${audience}: email/password sign-in works`);
    await loginPage.goto(`${base}/auth/${audience}?next=${encodeURIComponent('/settings')}`);
    await loginPage.waitForURL('**/settings');
    pass(`${audience}: signed-in return destination is preserved`);
    await loginContext.close();

    if (role === 'viewer') {
      const recovery = requireResult(await admin.auth.admin.generateLink({ type: 'recovery', email }), 'Generate recovery');
      const verified = requireResult(await client().auth.verifyOtp({ type: 'recovery', token_hash: recovery.properties.hashed_token }), 'Verify recovery');
      const recoveryContext = await browser.newContext();
      const recoveryPage = await recoveryContext.newPage();
      const hash = new URLSearchParams({ access_token: verified.session.access_token, refresh_token: verified.session.refresh_token, expires_in: '3600', token_type: 'bearer', type: 'recovery' });
      await recoveryPage.goto(`${base}/reset-password#${hash}`);
      await recoveryPage.getByLabel('NEW PASSWORD', { exact: true }).waitFor();
      const replacement = `B-${randomBytes(18).toString('hex')}!`;
      await recoveryPage.getByLabel('NEW PASSWORD', { exact: true }).fill(replacement);
      await recoveryPage.getByLabel('CONFIRM NEW PASSWORD', { exact: true }).fill('mismatch-123');
      await recoveryPage.getByRole('button', { name: 'Save new password' }).click();
      await recoveryPage.getByRole('alert').filter({ hasText: 'don’t match' }).waitFor();
      await recoveryPage.getByLabel('CONFIRM NEW PASSWORD', { exact: true }).fill(replacement);
      await recoveryPage.getByRole('button', { name: 'Save new password' }).click();
      await recoveryPage.getByRole('heading', { name: 'Your password is updated.' }).waitFor();
      const old = await client().auth.signInWithPassword({ email, password });
      assert.ok(old.error, 'Previous password must fail');
      requireResult(await client().auth.signInWithPassword({ email, password: replacement }), 'New password sign-in');
      pass('password recovery rejects mismatches, updates password, and invalidates the old password');
      await recoveryContext.close();
    }
  }
  const guest = await browser.newPage();
  await guest.goto(`${base}/dashboard/artist`);
  await guest.waitForURL('**/auth/artist?next=*');
  pass('anonymous artist dashboard access returns to artist sign-in with destination preserved');
  await guest.goto(`${base}/reset-password`);
  await guest.getByRole('alert').filter({ hasText: 'invalid or has expired' }).waitFor();
  pass('reset page rejects an absent recovery session');
  await guest.goto(`${base}/forgot-password`);
  let recoveryRequested = false;
  await guest.route('**/auth/v1/recover**', async route => {
    recoveryRequested = true;
    assert.ok(new URL(route.request().url()).searchParams.get('redirect_to')?.endsWith('/reset-password'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await guest.getByLabel('EMAIL ADDRESS', { exact: true }).fill(`request-${run}@example.invalid`);
  await guest.getByRole('button', { name: 'Send reset link' }).click();
  await guest.getByRole('heading', { name: 'Check your inbox.' }).waitFor();
  assert.ok(recoveryRequested);
  pass('forgot-password form requests the correct callback (email dispatch stubbed)');
  let signupRequested = false;
  await guest.route('**/auth/v1/signup**', async route => {
    signupRequested = true;
    await route.abort();
  });
  await guest.goto(`${base}/signup/fan`);
  await guest.waitForURL('**/early-access');
  assert.equal(signupRequested, false);
  await guest.goto(`${base}/auth/fan`);
  const waitlistLink = guest.getByRole('link', { name: /Join the waitlist/ });
  assert.ok(await waitlistLink.count() >= 1);
  for (const href of await waitlistLink.evaluateAll(links => links.map(link => link.getAttribute('href')))) assert.equal(href, '/early-access');
  pass('public signup routes are closed while sign-in points new visitors to the waitlist');
  await guest.close();
} catch (error) {
  // Never print recovery URLs, tokens, full responses, or test passwords.
  console.error(`FAIL: ${String(error.message).replace(/([#&?](?:access_token|refresh_token|token_hash|token)=)[^&\s]+/g, '$1[redacted]').slice(0, 650)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) { console.error(`CLEANUP REQUIRED: temporary account ${id} (${error.code || error.status})`); process.exitCode = 1; }
    else pass('temporary Auth user and its profile deleted');
  }
}
