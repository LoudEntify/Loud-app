// tests/e2e/viewer.e2e.mjs
// ─────────────────────────────────────────────────────────────
// End-to-end checks of the viewer experience against the real app, the
// real migrations and real RLS (scripts/dev/e2e.sh starts everything).
// Run: BASE_URL=http://localhost:3000 DATABASE_URL=... node tests/e2e/viewer.e2e.mjs
//
// What it proves, in plain words: a guest can open Discover and a show,
// the player is never covered and never under 200x200 at phone, Fold and
// computer sizes, the guest gate opens sign-up on the first action and at
// 60 seconds, sign-up refuses under-18s without storing the date, a
// signed-in viewer can vote, chat and Support (a double tap pays once),
// and every screen has its loading, empty, error and offline states.
// ─────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/loudentify_test';
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log(`✔ ${name}`); }
  catch (e) { results.push(['FAIL', name, e.message]); console.error(`✗ ${name}\n   ${e.message}`); }
}

/** Every point sampled inside the player rect must resolve to an element INSIDE the player frame. */
async function assertNothingOverPlayer(page, label) {
  const bad = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="player-frame"]');
    if (!frame) return ['no player frame'];
    const r = frame.getBoundingClientRect();
    if (r.width < 200 || r.height < 200) return [`player ${Math.round(r.width)}x${Math.round(r.height)} under 200x200`];
    const out = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      const x = r.left + 1 + (r.width - 2) * (i / 10); const y = r.top + 1 + (r.height - 2) * (j / 10);
      const el = document.elementFromPoint(x, y);
      if (el && !frame.contains(el)) out.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}@${Math.round(x)},${Math.round(y)}`);
    }
    return [...new Set(out)];
  });
  assert.deepEqual(bad, [], `${label}: something sits over the player: ${bad.join(' ')}`);
}

const q = async (sql, params) => (await pool.query(sql, params)).rows;
const soloId = (await q(`select id from shows where room_name = 'synth-live-solo'`))[0]?.id;
const versusId = (await q(`select id from shows where room_name = 'synth-live-versus'`))[0]?.id;
const ytId = (await q(`select id from shows where room_name = 'synth-live-youtube'`))[0]?.id;
const soonId = (await q(`select id from shows where room_name = 'synth-soon-1'`))[0]?.id;
assert.ok(soloId && versusId && ytId && soonId, 'seed the database first (scripts/db/seed.sh)');
// The seeded prompts close on a timer; keep them open for the length of this run.
await q(`update show_prompts set closed_at = now() + interval '30 minutes' where show_id in ($1, $2)`, [soloId, versusId]);

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const consent = async (page) => { await page.evaluate(() => localStorage.setItem('loudentify.cookieConsent', JSON.stringify({ version: 1, decided: true, necessary: true, embed: true, analytics: true, decidedAt: new Date().toISOString() }))); };

// ── guest on a phone ──────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await step('Discover loads for a guest with a live card first and a cookie banner', async () => {
    await page.goto(`${BASE}/discover`);
    await page.waitForSelector('[data-testid="feed-card"]', { timeout: 20000 });
    assert.equal(await page.locator('[data-testid="feed-card"]').first().getAttribute('data-kind'), 'live');
    await page.waitForSelector('[data-testid="cookie-banner"]');
    await page.click('text=Allow the player and analytics');
    assert.equal(await page.locator('[data-testid="cookie-banner"]').count(), 0);
  });
  await step('Show screen (phone): player playing, >=200x200, nothing over it, chat and vote card shown', async () => {
    await page.goto(`${BASE}/show/${soloId}`);
    await page.waitForSelector('[data-testid="player-frame"][data-player-state="playing"]', { timeout: 20000 });
    await assertNothingOverPlayer(page, 'phone default');
    const r = await page.locator('[data-testid="player-frame"]').boundingBox();
    assert.equal(Math.round(r.width), 304); assert.equal(Math.round(r.height), 540);
    await page.waitForSelector('[data-testid="comments"] >> text=this band is tight');
    await page.waitForSelector('[data-testid="vote-open"]');
    assert.ok(await page.locator('[data-testid="follow"]').isVisible());
  });
  await step('Bigger: 340x604, chat collapses to one line, nothing over the player', async () => {
    await page.click('[data-testid="bigger"]');
    await page.waitForTimeout(300);
    const r = await page.locator('[data-testid="player-frame"]').boundingBox();
    assert.equal(Math.round(r.width), 340); assert.equal(Math.round(r.height), 604);
    await assertNothingOverPlayer(page, 'phone bigger');
    await page.click('text=Open chat');
  });
  await step('Guest gate: tapping Vote opens sign-up and the player shrinks to 200x356, still uncovered', async () => {
    await page.click('[data-testid="vote-open"]');
    await page.waitForSelector('[data-testid="signup-sheet"]');
    const r = await page.locator('[data-testid="player-frame"]').boundingBox();
    assert.equal(Math.round(r.width), 200); assert.equal(Math.round(r.height), 356);
    await assertNothingOverPlayer(page, 'phone guest');
  });
  await step('Under-18 sign-up shows the kind stop screen and stores nothing', async () => {
    const stamp = Date.now();
    await page.fill('input[placeholder="First name"]', 'Kid');
    await page.fill('input[placeholder="@yourname"]', `kid_${stamp}`);
    await page.fill('input[placeholder="DD / MM / YYYY"]', '01/01/2015');
    await page.fill('input[placeholder="City"]', 'Leeds');
    await page.fill('input[type="email"]', `kid${stamp}@test.invalid`);
    await page.fill('input[type="password"]', 'password-123');
    await page.check('input[type="checkbox"]');
    await page.click('[data-testid="signup-submit"]');
    await page.waitForSelector('[data-testid="under-age"]');
    const rows = await q(`select 1 from auth.users where email = $1`, [`kid${stamp}@test.invalid`]);
    assert.equal(rows.length, 0, 'no account for an under-18');
    const dob = await q(`select 1 from profiles where date_of_birth = '2015-01-01'`);
    assert.equal(dob.length, 0, 'the date was not stored');
    await page.click('text=I entered the wrong date');
  });
  await step('Sixty-second guest preview opens sign-up by itself', async () => {
    await page.evaluate(() => localStorage.setItem('loudentify.guestPreviewMs', '59500'));
    await page.goto(`${BASE}/show/${soloId}`);
    await page.waitForSelector('[data-testid="player-frame"][data-player-state="playing"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="signup-sheet"]', { timeout: 15000 });
    assert.ok((await page.locator('text=Your free minute is up').count()) > 0);
    await assertNothingOverPlayer(page, 'phone timer gate');
    await page.evaluate(() => localStorage.setItem('loudentify.guestPreviewMs', '0'));
  });
  const email = `fan${Date.now()}@test.invalid`;
  let userId = null;
  await step('A guest signs up on the sheet, lands back in the show signed in', async () => {
    await page.goto(`${BASE}/show/${soloId}`);
    await page.waitForSelector('[data-testid="player-frame"][data-player-state="playing"]', { timeout: 20000 });
    await page.click('[data-testid="vote-open"]');
    await page.waitForSelector('[data-testid="signup-sheet"]');
    await page.fill('input[placeholder="First name"]', 'Fan');
    await page.fill('input[placeholder="@yourname"]', `fan_${Date.now().toString(36)}`);
    await page.fill('input[placeholder="DD / MM / YYYY"]', '02/10/1990');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'password-123');
    await page.check('input[type="checkbox"]');
    await page.click('[data-testid="signup-submit"]');
    await page.waitForSelector('[data-testid="signup-sheet"]', { state: 'detached', timeout: 20000 });
    const rows = await q(`select id from auth.users where email = $1`, [email]);
    assert.equal(rows.length, 1); userId = rows[0].id;
    const consentRows = await q(`select consent_type, granted, document_version from consent_records where user_id = $1`, [userId]);
    assert.deepEqual(consentRows.map((c) => c.consent_type), ['terms']);
    const audit = await q(`select action from audit.audit_log where actor_id = $1 and action = 'account.created'`, [userId]);
    assert.equal(audit.length, 1, 'account creation is audited');
  });
  await step('Signed in: vote lands with a playback position, comment posts, follow works', async () => {
    await page.waitForSelector('[data-testid="vote-open"]');
    await page.click('[data-testid="vote-open"]');
    await page.waitForSelector('[data-testid="vote-sheet"]');
    await page.click('[data-testid="vote-sheet"] button:has-text("The banger")');
    await page.waitForSelector('[data-testid="vote-sheet"]', { state: 'detached', timeout: 10000 });
    const votes = await q(`select choice_index, playback_position_ms from prompt_responses where user_id = $1`, [userId]);
    assert.equal(votes.length, 1); assert.equal(votes[0].choice_index, 1); assert.ok(votes[0].playback_position_ms >= 0, 'stamped with playback position');
    await page.fill('input[aria-label="Write a comment"]', 'hello from the e2e');
    await page.click('button[aria-label="Send"]');
    await page.waitForSelector('[data-testid="comments"] >> text=hello from the e2e');
    const c = await q(`select playback_position_ms from show_comments where user_id = $1`, [userId]);
    assert.equal(c.length, 1); assert.ok(c[0].playback_position_ms >= 0);
    await page.click('[data-testid="follow"]');
    await page.waitForSelector('[data-testid="follow"]:has-text("Following")');
  });
  await step('Support: a double tap pays once, 72.5% to the artist, audited', async () => {
    const group = (await q(`select gen_random_uuid() as g`))[0].g;
    await q(`insert into wallet_transactions (user_id, system_account, amount_tokens, kind, description, idempotency_key, entry_group_id, is_legacy_single_leg) values
             ($1, null, 500, 'purchase', 'e2e tokens', $2, $4, false), (null, 'platform_float', -500, 'purchase', 'e2e tokens', $3, $4, false)`,
      [userId, `e2e-${userId}:user`, `e2e-${userId}:float`, group]);
    await page.click('[data-testid="support"]');
    await page.waitForSelector('[data-testid="support-sheet"] >> text=You have');
    await page.waitForSelector('text=500 tokens');
    await page.locator('[data-testid="support-send"]').dblclick();
    await page.waitForSelector('[data-testid="toast"]', { timeout: 10000 });
    await page.waitForTimeout(1500);
    const s = await q(`select amount_tokens, artist_tokens, artist_share_bp, playback_position_ms from support_events where from_user_id = $1`, [userId]);
    assert.equal(s.length, 1, 'exactly one support for a double tap');
    assert.equal(s[0].amount_tokens, 25); assert.equal(s[0].artist_tokens, 18); assert.equal(s[0].artist_share_bp, 7250);
    const legs = await q(`select coalesce(sum(amount_tokens),0)::int as total from wallet_transactions where entry_group_id = (select entry_group_id from support_events where from_user_id = $1)`, [userId]);
    assert.equal(legs[0].total, 0, 'legs sum to zero');
    const bal = await q(`select coalesce(sum(amount_tokens),0)::int as b from wallet_transactions where user_id = $1`, [userId]);
    assert.equal(bal[0].b, 475);
    const audit = await q(`select 1 from audit.audit_log where actor_id = $1 and action = 'support.sent'`, [userId]);
    assert.equal(audit.length, 1);
  });
  await step('Wallet shows the balance and the support in history', async () => {
    await page.goto(`${BASE}/wallet`);
    await page.waitForSelector('[data-testid="wallet-balance"]:has-text("475")', { timeout: 15000 });
    await page.waitForSelector('[data-testid="wallet-history"] >> text=Supported');
    assert.ok((await page.locator('text=Test mode').count()) > 0, 'token purchase is labelled test mode');
  });
  await step('Versus show: A vs B header and "Who moved you" vote with the artists as options', async () => {
    await page.goto(`${BASE}/show/${versusId}`);
    await page.waitForSelector('[data-testid="player-frame"][data-player-state="playing"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="show-header"] >> text=VS');
    await page.waitForSelector('section[aria-label="Pick a side"] >> text=Who moved you this round?');
    await page.click('section[aria-label="Pick a side"] >> button:has-text("Nia Okafor")');
    await page.waitForSelector('section[aria-label="Pick a side"] button[aria-pressed="true"]:has-text("Nia Okafor")');
    await assertNothingOverPlayer(page, 'versus');
  });
  await step('Waiting room: countdown, chat open early, Remind me', async () => {
    await page.goto(`${BASE}/show/${soonId}`);
    await page.waitForSelector('[data-testid="countdown"] >> text=Starts in', { timeout: 20000 });
    await page.waitForSelector('text=Chat is open early');
    await page.click('[data-testid="remind"]');
    await page.waitForSelector('[data-testid="remind"]:has-text("Reminded")');
    const r = await q(`select 1 from show_reminders where user_id = $1 and show_id = $2`, [userId, soonId]);
    assert.equal(r.length, 1);
    await assertNothingOverPlayer(page, 'waiting');
  });
  await step('YouTube delivery without embed consent shows the consent card inside the frame, never an iframe', async () => {
    await page.evaluate(() => localStorage.removeItem('loudentify.cookieConsent'));
    await page.goto(`${BASE}/show/${ytId}`);
    await page.waitForSelector('[data-testid="embed-consent"]', { timeout: 20000 });
    assert.equal(await page.locator('[data-testid="player-frame"] iframe').count(), 0);
    const r = await page.locator('[data-testid="player-frame"]').boundingBox();
    assert.ok(r.width >= 200 && r.height >= 200);
    await assertNothingOverPlayer(page, 'youtube consent');
    await consent(page);
  });
  await step('Error state: an unknown show says so in plain words', async () => {
    await page.goto(`${BASE}/show/00000000-0000-4000-8000-000000000000`);
    await page.waitForSelector('text=We couldn\'t find this show', { timeout: 15000 });
  });
  await step('Empty state: search with no results offers a near spelling', async () => {
    await page.goto(`${BASE}/search?q=Afrobeatz`);
    await page.waitForSelector('text=Did you mean Afrobeats', { timeout: 15000 });
  });
  await step('Offline state: a bar across the top, the screen stays readable', async () => {
    await page.goto(`${BASE}/live`);
    await page.waitForSelector('[data-testid="live-grid"]', { timeout: 15000 });
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('[data-testid="offline-bar"]');
    assert.ok(await page.locator('[data-testid="live-grid"]').isVisible(), 'already-loaded content stays');
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('[data-testid="offline-bar"]', { state: 'detached' });
  });
  await step('Public profile by @username shows only public fields', async () => {
    await page.goto(`${BASE}/@synth_ama`);
    await page.waitForSelector('[data-testid="public-profile"] >> text=Ama Serwaa', { timeout: 15000 });
    const html = await page.content();
    assert.equal(html.includes('1996-04-12'), false, 'date of birth never reaches the page');
  });
  await step('Journey and metering events were recorded pseudonymously', async () => {
    await page.waitForTimeout(2500);
    const j = await q(`select count(*)::int as n from journey_events where event in ('show.joined','signup.started','signup.completed')`);
    assert.ok(j[0].n >= 3, `journey events recorded (${j[0].n})`);
    const m = await q(`select count(*)::int as n from metering_events where show_id = $1 and event in ('play','heartbeat','counted')`, [soloId]);
    assert.ok(m[0].n >= 1, 'metering events recorded');
    const leak = await q(`select count(*)::int as n from journey_events where props::text ilike '%@test.invalid%'`);
    assert.equal(leak[0].n, 0, 'no email in journey props');
  });
  await ctx.close();
}

// ── Fold and computer widths ──────────────────────────────────
for (const [w, h, label, expectW] of [[768, 844, 'fold', 360], [1440, 900, 'computer', 405]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await step(`${label} (${w}x${h}): player ${expectW} wide, chat beside it, nothing over the player, sheets stay beside`, async () => {
    await page.goto(`${BASE}/show/${soloId}`);
    await consent(page);
    await page.goto(`${BASE}/show/${soloId}`);
    await page.waitForSelector('[data-testid="player-frame"][data-player-state="playing"]', { timeout: 20000 });
    const r = await page.locator('[data-testid="player-frame"]').boundingBox();
    assert.equal(Math.round(r.width), expectW);
    await assertNothingOverPlayer(page, label);
    await page.waitForSelector('[data-testid="comments"] >> text=this band is tight');
    // the Fold panel shows the vote card with a Vote button; the computer info column shows the options inline
    if (label === 'computer') await page.click('button:has-text("The banger")'); else await page.click('[data-testid="vote-open"]');
    await page.waitForSelector('[data-testid="signup-sheet"]');
    await assertNothingOverPlayer(page, `${label} guest sheet`);
  });
  await ctx.close();
}

await browser.close();
await pool.end();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed`);
if (failed.length) process.exit(1);
