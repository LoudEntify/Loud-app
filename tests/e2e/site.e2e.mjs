// tests/e2e/site.e2e.mjs — the public website (Phase 5) against the real
// app and database. Run by scripts/dev/e2e.sh after the viewer and artist
// suites. Proves: the home hero and live strip, reduced motion honoured,
// the cookie banner, What's on with its filters and states, the share
// page with Open Graph and a calendar file, pricing marked draft, the
// contact form writing a row (and the honeypot not), help search with its
// empty state, every legal page marked DRAFT, /privacy untouched, phone
// width without horizontal scroll, the app-link files, and basic
// accessibility (alt text, labelled buttons, one h1, 44px targets).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/loudentify_test';
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log(`✔ ${name}`); }
  catch (e) { results.push(['FAIL', name, e.message]); console.error(`✗ ${name}\n   ${e.message}`); }
}
const soloId = (await q(`select id from shows where room_name = 'synth-live-solo'`))[0]?.id;
const versusId = (await q(`select id from shows where room_name = 'synth-live-versus'`))[0]?.id;
const soonId = (await q(`select id from shows where room_name = 'synth-soon-2'`))[0]?.id;
assert.ok(soloId && versusId && soonId, 'seed the database first');

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const PAGES = ['/', '/whats-on', '/artists', '/fans', '/pricing', '/about', '/contact', '/help', '/get-app', '/legal/terms', '/legal/community-guidelines', '/legal/cookies', '/legal/artist-agreement', `/s/${soonId}`];

async function a11y(page, label) {
  const problems = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('img').forEach((i) => { if (i.getAttribute('alt') == null) out.push(`img without alt: ${i.src.slice(-40)}`); });
    document.querySelectorAll('button, a').forEach((b) => { const name = (b.getAttribute('aria-label') || b.textContent || '').trim(); if (!name && !b.querySelector('img[alt]')) out.push(`unnamed ${b.tagName.toLowerCase()}`); });
    if (document.querySelectorAll('h1').length !== 1) out.push(`${document.querySelectorAll('h1').length} h1 elements`);
    if (!document.querySelector('main')) out.push('no main landmark');
    return out;
  });
  assert.deepEqual(problems, [], `${label}: ${problems.join('; ')}`);
}

// ── computer, 1440 wide ───────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await step('Home: hero, live strip with real live shows first, footer legal links, cookie banner', async () => {
    await page.goto(`${BASE}/`);
    await page.waitForSelector('[data-testid="hero"]');
    assert.ok((await page.textContent('h1')).includes('A production crew in your pocket'));
    const cards = page.locator('[data-testid="live-card"]');
    assert.ok((await cards.count()) >= 2, 'at least two cards in the strip');
    assert.equal(await cards.first().getAttribute('data-state'), 'live');
    const href = await cards.first().getAttribute('href');
    assert.ok(href.startsWith('/show/'), `a live card goes to the show screen, got ${href}`);
    for (const t of ['Terms and Conditions', 'Community Guidelines', 'Privacy', 'Cookies']) assert.ok(await page.locator(`footer >> text=${t}`).isVisible(), t);
    await page.waitForSelector('[data-testid="cookie-banner"]');
    await page.click('[data-testid="cookie-banner"] >> text=Necessary only');
    await page.waitForSelector('[data-testid="cookie-banner"]', { state: 'detached' });
    await page.reload();
    await page.waitForSelector('[data-testid="hero"]');
    assert.equal(await page.locator('[data-testid="cookie-banner"]').count(), 0, 'the choice is remembered');
    await a11y(page, 'home');
  });

  await step('Reduced motion: the hero animates only when the device allows it', async () => {
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.w-orb')).animationName);
    assert.notEqual(anim, 'none', 'animates by default');
    const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p2 = await rm.newPage(); await p2.goto(`${BASE}/`); await p2.waitForSelector('.w-orb');
    assert.equal(await p2.evaluate(() => getComputedStyle(document.querySelector('.w-orb')).animationName), 'none', 'still with reduced motion');
    await rm.close();
  });

  await step('Nav marks the current page; header CTA and Log in for a guest', async () => {
    await page.goto(`${BASE}/artists`);
    assert.equal(await page.locator('nav[aria-label="Main"] a[aria-current="page"]').textContent(), 'For artists');
    assert.ok(await page.locator('header >> text=Log in').isVisible());
    assert.equal(await page.locator('[data-testid="header-cta"]').textContent(), 'Start performing');
    await a11y(page, 'artists');
  });

  await step('What’s on: live now, day sections with local times, Versus filter, Remind me sends a guest to sign-up', async () => {
    await page.goto(`${BASE}/whats-on`);
    await page.waitForSelector('[data-testid="live-now"]');
    assert.ok((await page.locator('[data-testid="live-now"] [data-testid="live-card"]').count()) >= 2);
    assert.ok((await page.locator('[data-testid="day-section"]').count()) >= 2, 'Today and a later day');
    const t = await page.locator('[data-testid="schedule-row"] time').first().textContent();
    assert.match(t, /^\d{2}:\d{2}$/, `local time rendered, got ${t}`);
    await page.goto(`${BASE}/whats-on?mode=versus`);
    await page.waitForSelector('[data-testid="live-now"]');
    const n = await page.locator('[data-testid="live-card"]').count();
    assert.ok(n >= 1);
    for (let i = 0; i < n; i++) assert.ok(await page.locator('[data-testid="live-card"]').nth(i).locator('text=VERSUS').isVisible(), 'only Versus');
    await page.goto(`${BASE}/whats-on`);
    await a11y(page, 'whats-on');
    await page.click('[data-testid="remind"] >> nth=0');
    await page.waitForURL(/\/signup\?trigger=remind/);
  });

  await step('Share page: Open Graph tags, countdown, watch link, share URL, calendar file; live and missing states', async () => {
    await page.goto(`${BASE}/s/${soonId}`);
    await page.waitForSelector('[data-testid="share-page"][data-state="scheduled"]');
    const og = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')].map((m) => [m.getAttribute('property'), m.content])));
    assert.ok(og['og:title']?.includes('Tobi Grace'), `og:title ${og['og:title']}`);
    assert.ok(og['og:image'], 'og:image'); assert.ok(og['og:url']?.endsWith(`/s/${soonId}`), 'og:url');
    assert.equal(await page.getAttribute('[data-testid="countdown"]', 'data-state'), 'upcoming');
    await page.waitForFunction(() => /^\d{2}:\d{2}:\d{2}$/.test(document.querySelector('.w-timer')?.textContent || ''));
    assert.equal(await page.getAttribute('[data-testid="watch-cta"]', 'href'), `/show/${soonId}`);
    assert.ok((await page.textContent('[data-testid="share-url"]')).endsWith(`/s/${soonId}`));
    assert.ok(await page.locator('[data-testid="artist-card"] >> text=Tobi Grace').isVisible());
    await a11y(page, 'share');
    const ics = await page.request.get(`${BASE}/s/${soonId}/calendar.ics`);
    assert.equal(ics.status(), 200); assert.ok(ics.headers()['content-type'].includes('text/calendar'));
    assert.match(await ics.text(), /DTSTART:\d{8}T\d{6}Z/);
    await page.goto(`${BASE}/s/${soloId}`);
    await page.waitForSelector('[data-testid="countdown"][data-state="live"]');
    assert.equal(await page.textContent('[data-testid="watch-cta"]'), 'Watch now, free');
    await page.goto(`${BASE}/s/00000000-0000-4000-8000-00000000dead`);
    await page.waitForSelector('[data-testid="share-missing"]');
  });

  await step('Pricing: watching is free, artist figures marked DRAFT until set', async () => {
    await page.goto(`${BASE}/pricing`);
    await page.waitForSelector('[data-testid="pricing-fans"]');
    assert.ok(await page.locator('[data-testid="pricing-fans"] >> text=£0').isVisible());
    assert.ok(await page.locator('[data-testid="pricing-unset"] >> text=DRAFT').isVisible());
    assert.ok(await page.locator('text=Tokens from £1.99').isVisible());
    await a11y(page, 'pricing');
  });

  await step('Contact: validation, a sent message lands in site_messages, the honeypot does not', async () => {
    await page.goto(`${BASE}/contact?topic=press`);
    await page.waitForSelector('[data-testid="contact-form"]');
    assert.equal(await page.getAttribute('button:has-text("Press")', 'aria-pressed'), 'true');
    await page.fill('input[name="name"]', 'E2E Reporter'); await page.fill('input[name="email"]', 'e2e-press@example.com'); await page.fill('textarea[name="message"]', 'Hello from the site suite');
    await page.click('button:has-text("Send message")');
    await page.waitForSelector('[data-testid="contact-sent"]');
    const rows = await q(`select topic, name, correlation_id from site_messages where email = 'e2e-press@example.com'`);
    assert.equal(rows.length, 1); assert.equal(rows[0].topic, 'press'); assert.ok(rows[0].correlation_id, 'correlation id stored');
    const bad = await page.request.post(`${BASE}/api/site/contact`, { data: { topic: 'general', name: '', email: 'nope', message: '' } });
    assert.equal(bad.status(), 400); assert.deepEqual(Object.keys((await bad.json()).errors).sort(), ['email', 'message', 'name']);
    const bot = await page.request.post(`${BASE}/api/site/contact`, { data: { topic: 'general', name: 'Bot', email: 'bot@example.com', message: 'spam', website: 'x' } });
    assert.equal(bot.status(), 200);
    assert.equal((await q(`select 1 from site_messages where email = 'bot@example.com'`)).length, 0, 'honeypot row not stored');
    await a11y(page, 'contact');
  });

  await step('Help: search finds an answer, shows the empty state, and an article renders', async () => {
    await page.goto(`${BASE}/help`);
    await page.fill('[data-testid="help-search"]', 'mic');
    await page.waitForSelector('[data-testid="help-results"] a');
    await page.fill('[data-testid="help-search"]', 'zzzz-nothing');
    await page.waitForSelector('[data-testid="help-empty"]');
    await page.click('[data-testid="help-most-asked"] a >> nth=0');
    await page.waitForSelector('[data-testid="help-article"]');
    await a11y(page, 'help article');
  });

  await step('Legal: Terms, Guidelines, Cookies and the Artist agreement are marked DRAFT; /privacy still serves', async () => {
    for (const p of ['/legal/terms', '/legal/community-guidelines', '/legal/cookies', '/legal/artist-agreement']) {
      await page.goto(`${BASE}${p}`);
      await page.waitForSelector('[data-testid="draft-notice"]');
      assert.ok(await page.locator('[data-testid="draft-notice"] >> text=DRAFT').isVisible(), p);
      assert.equal(await page.locator('nav[aria-label="Legal documents"] a[aria-current="page"]').count(), 1, `${p} current in side nav`);
    }
    await page.goto(`${BASE}/legal/cookies`);
    await page.click('[data-testid="cookie-choices"] >> text=Allow the player and analytics');
    const c = await page.evaluate(() => JSON.parse(localStorage.getItem('loudentify.cookieConsent')));
    assert.equal(c.embed, true);
    const priv = await page.request.get(`${BASE}/privacy`);
    assert.equal(priv.status(), 200); assert.ok((await priv.text()).includes('Privacy'));
  });

  await step('App-link files are served as JSON', async () => {
    for (const p of ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json']) {
      const r = await page.request.get(`${BASE}${p}`);
      assert.equal(r.status(), 200, p); assert.ok(r.headers()['content-type'].includes('application/json'), `${p} ${r.headers()['content-type']}`);
      JSON.parse(await r.text());
    }
  });
  await ctx.close();
}

// ── phone width ───────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await step('Phone (390): every page fits without horizontal scroll, the menu opens, header targets are 44px', async () => {
    for (const p of PAGES) {
      await page.goto(`${BASE}${p}`);
      await page.waitForSelector('main');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `${p} scrolls sideways by ${over}px`);
    }
    await page.goto(`${BASE}/`);
    await page.click('.w-menu summary');
    assert.ok(await page.locator('.w-menu-list >> text=For fans').isVisible());
    const small = await page.evaluate(() => [...document.querySelectorAll('header a, header button, header summary')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height < 44; }).map((el) => el.textContent.trim() || el.tagName));
    assert.deepEqual(small, [], `targets under 44px: ${small.join(', ')}`);
  });
  await ctx.close();
}

await browser.close(); await pool.end();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} site e2e steps passed`);
process.exit(failed.length ? 1 : 0);
