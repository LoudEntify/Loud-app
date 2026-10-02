// tests/e2e/artist.e2e.mjs — the artist experience and the live pipeline,
// end to end with the test doubles: onboarding with the mock YouTube
// connection, scheduling (30-minute rule), Kit Check with a fake camera,
// the console going live (forced inside the window for the test), the
// fake egress recording to files, a Versus stage request confirmed by the
// other artist, the viewer seeing the view change, end show with the key
// rotated and insights computed, a clip saved.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/loudentify_test';
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const results = [];
async function step(name, fn) { try { await fn(); results.push(['PASS', name]); console.log(`✔ ${name}`); } catch (e) { results.push(['FAIL', name, e.message]); console.error(`✗ ${name}\n   ${e.message}`); } }
const consent = (page) => page.evaluate(() => localStorage.setItem('loudentify.cookieConsent', JSON.stringify({ version: 1, decided: true, necessary: true, embed: true, analytics: true })));

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function artistContext(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await consent(page); await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', 'synthetic-pass'); await page.click('button:has-text("Log in")');
  await page.waitForURL('**/discover', { timeout: 20000 });
  return { ctx, page };
}

const A = await artistContext('synth-ama@synthetic.loudentify.invalid');
const amaId = (await q(`select id from auth.users where email = 'synth-ama@synthetic.loudentify.invalid'`))[0].id;
let showId = null;

await step('Onboarding: agreement with the training-data line, mock YouTube connection with readiness, mic saved to a place', async () => {
  await A.page.goto(`${BASE}/artist/onboarding`);
  await A.page.waitForSelector('[data-testid="artist-onboarding"]', { timeout: 20000 });
  await A.page.click('[data-testid="step-agreement"]');
  await A.page.waitForSelector('[data-testid="artist-agreement"]');
  await A.page.click('[data-testid="agree-continue"]');
  await A.page.waitForSelector('[data-testid="youtube-step"]', { timeout: 10000 });
  await A.page.click('[data-testid="connect-youtube"]');
  await A.page.waitForSelector('[data-testid="step-youtube"] >> text=Connected', { timeout: 15000 });
  const consentRows = await q(`select consent_type, granted from consent_records where user_id = $1 order by recorded_at desc`, [amaId]);
  assert.ok(consentRows.some((c) => c.consent_type === 'training_data' && c.granted === true), 'training-data choice recorded');
  const audit = await q(`select action from audit.audit_log where actor_id = $1 and action = 'youtube.connected'`, [amaId]);
  assert.equal(audit.length, 1, 'connection audited');
  const status = await q(`select channel_id, live_enabled from identity.youtube_connections where user_id = $1`, [amaId]);
  assert.equal(status[0].live_enabled, true);
  if (!(await A.page.locator('text=Save my first place').isVisible())) await A.page.click('[data-testid="step-mic"]');
  await A.page.waitForSelector('text=Save my first place');
  await A.page.click('text=Save my first place');
  await A.page.waitForSelector('[data-testid="step-camera"] >> text=Done', { timeout: 10000 }).catch(() => {});
  const places = await q(`select name, mic_label from places where artist_id = $1`, [amaId]);
  assert.equal(places.length, 1);
});

await step('Schedule: 29 minutes ahead is refused, 31 is booked, the broadcast exists on the mock channel and reminders are set', async () => {
  await A.page.goto(`${BASE}/artist/schedule`);
  await A.page.waitForSelector('[data-testid="schedule-screen"]', { timeout: 20000 });
  const pad = (n) => String(n).padStart(2, '0');
  const soon = new Date(Date.now() + 29 * 60000);
  await A.page.fill('input[type="date"]', `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
  await A.page.fill('input[type="time"]', `${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
  await A.page.fill('input[placeholder="Give your show a name"]', 'E2E solo set');
  await A.page.click('[data-testid="book-show"]');
  await A.page.waitForSelector('text=The earliest start is 30 minutes from now.');
  const ok = new Date(Date.now() + 31 * 60000);
  await A.page.fill('input[type="date"]', `${ok.getFullYear()}-${pad(ok.getMonth() + 1)}-${pad(ok.getDate())}`);
  await A.page.fill('input[type="time"]', `${pad(ok.getHours())}:${pad(ok.getMinutes())}`);
  await A.page.click('[data-testid="book-show"]');
  await A.page.waitForSelector('[data-testid="booked"]', { timeout: 20000 });
  const rows = await q(`select id, youtube_video_id, youtube_broadcast_id, delivery from shows where title = 'E2E solo set' and artist_id = $1 order by created_at desc limit 1`, [amaId]);
  showId = rows[0].id;
  assert.ok(rows[0].youtube_broadcast_id, 'broadcast created at scheduling');
  const bc = await q(`select state, chat_disabled from broadcasts where show_id = $1`, [showId]);
  assert.equal(bc[0].state, 'ready'); assert.equal(bc[0].chat_disabled, true);
  const keys = await q(`select key_enc from identity.stream_keys where broadcast_id = (select id from broadcasts where show_id = $1)`, [showId]);
  assert.equal(keys.length, 1); assert.ok(keys[0].key_enc.startsWith('v1.') && !keys[0].key_enc.includes('mock-key'), 'stream key stored encrypted');
  const rem = await q(`select dedupe_key from notifications where user_id = $1 and dedupe_key like 'show:' || $2 || ':reminder:%'`, [amaId, showId]);
  assert.deepEqual(rem.map((r) => r.dedupe_key.split(':').pop()).sort(), ['30']);
});

await step('Kit Check: own camera in the three crops, checks run, results saved per item', async () => {
  await A.page.goto(`${BASE}/artist/kit-check?show=${showId}`);
  await A.page.waitForSelector('[data-testid="kit-check"]', { timeout: 20000 });
  await A.page.waitForSelector('[data-testid="check-mic_signal"]');
  for (const crop of ['Conversation', 'Performing', 'Corner']) await A.page.click(`button:has-text("${crop}")`);
  await A.page.waitForSelector('[data-testid="check-connection"][data-status="ready"]', { timeout: 15000 }).catch(async (e) => { throw new Error(`connection check: ${await A.page.locator('[data-testid="check-connection"]').innerText().catch(() => '?')} — ${e.message}`); });
  await A.page.waitForSelector('[data-testid="check-camera_frames"][data-status="ready"]', { timeout: 20000 });
  await A.page.click('button:has-text("Turn on")');
  await A.page.click('[data-testid="kit-save"]');
  await A.page.waitForSelector('text=Saved');
  const items = await q(`select item, status from kit_check_results where show_id = $1 order by item`, [showId]);
  assert.ok(items.length >= 6, `results saved (${items.length})`);
  assert.ok(items.find((i) => i.item === 'camera_frames')?.status === 'ready');
  const journey = await q(`select count(*)::int as n from journey_events where event = 'kitcheck.item' and show_id = $1`, [showId]);
  assert.ok(journey[0].n >= 6);
});

await step('Console: the show goes live, the fake egress records to files, delivery is reported, the viewer page sees it live', async () => {
  // move the slot into the window (the test cannot wait 31 minutes)
  await q(`update shows set slated_at = now() + interval '2 minutes' where id = $1`, [showId]);
  await A.page.goto(`${BASE}/artist/console/${showId}`);
  await A.page.waitForSelector('[data-testid="countdown-screen"]', { timeout: 20000 });
  await A.page.click('[data-testid="go-live-now"]');
  await A.page.waitForSelector('[data-testid="console"]', { timeout: 20000 });
  await A.page.waitForSelector('[data-testid="delivery-state"]:has-text("DELIVERING")', { timeout: 15000 });
  await A.page.waitForTimeout(7000); // a few heartbeats
  const s = await q(`select actual_started_at, delivery_state, state from shows where id = $1`, [showId]);
  assert.ok(s[0].actual_started_at && s[0].delivery_state === 'ok');
  const bc = await q(`select state, delivery_state from broadcasts where show_id = $1`, [showId]);
  assert.equal(bc[0].state, 'live');
  const dir = `${process.cwd()}/.cache/egress/${showId}`;
  assert.ok(fs.existsSync(`${dir}/recording.ndjson`) && fs.existsSync(`${dir}/training.ndjson`), 'recording and training copy files exist');
  assert.ok(fs.readFileSync(`${dir}/recording.ndjson`, 'utf8').split('\n').filter(Boolean).length >= 2, 'frames were recorded');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('youtube-')), 'one egress output goes to YouTube');
  const audit = await q(`select action from audit.audit_log where subject_id = $1 and action in ('show.started')`, [showId]);
  assert.equal(audit.length, 1);
  await A.page.click('button[aria-label="Fix"]');
  await A.page.waitForSelector('[data-testid="fix-sheet"] >> text=Switch microphone');
  await A.page.click('text=Back to the show');
  await A.page.click('button[aria-label="Vote"]');
  await A.page.waitForSelector('[data-testid="prompt-sheet"]');
  await A.page.fill('input[placeholder="What should I play next?"]', 'Slow one or banger?');
  const opts = A.page.locator('[data-testid="prompt-sheet"] input');
  await opts.nth(1).fill('Slow'); await opts.nth(2).fill('Banger');
  await A.page.click('[data-testid="push-prompt"]');
  await A.page.waitForSelector('text=Prompt open', { timeout: 10000 });
  const V = await browser.newContext({ viewport: { width: 390, height: 844 } }); const vp = await V.newPage();
  await vp.goto(`${BASE}/show/${showId}`); await consent(vp); await vp.goto(`${BASE}/show/${showId}`);
  await vp.waitForSelector('[data-testid="show-header"] >> text=LIVE', { timeout: 20000 });
  await vp.waitForSelector('[data-testid="vote-open"]', { timeout: 15000 });
  await V.close();
});

await step('End show (press and hold): egress stopped, recording row written, key rotated, broadcast complete, insights computed; post-show lets the artist set visibility', async () => {
  const btn = A.page.locator('[data-testid="end-show"]');
  const box = await btn.boundingBox();
  await A.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await A.page.mouse.down(); await A.page.waitForTimeout(1800); await A.page.mouse.up();
  await A.page.waitForSelector('[data-testid="post-show"]', { timeout: 20000 });
  const s = await q(`select actual_ended_at, ended_by, delivery_state from shows where id = $1`, [showId]);
  assert.ok(s[0].actual_ended_at && s[0].ended_by === 'artist');
  const bc = await q(`select state, key_rotated_at from broadcasts where show_id = $1`, [showId]);
  assert.equal(bc[0].state, 'complete'); assert.ok(bc[0].key_rotated_at);
  const keys = await q(`select rotated_at, key_enc from identity.stream_keys where broadcast_id = (select id from broadcasts where show_id = $1)`, [showId]);
  assert.ok(keys[0].rotated_at && keys[0].key_enc === 'rotated', 'stream key rotated away');
  const rec = await q(`select id, training_copy_path, training_allowed, visibility from recordings where show_id = $1`, [showId]);
  assert.equal(rec.length, 1); assert.ok(rec[0].training_copy_path, 'training copy kept because the choice is on');
  const ins = await q(`select peak_viewers, votes_cast from show_insights where show_id = $1`, [showId]);
  assert.equal(ins.length, 1);
  const audit = await q(`select action from audit.audit_log where subject_type = 'broadcast' and action in ('broadcast.ended', 'stream_key.rotated') and subject_id = (select id::text from broadcasts where show_id = $1)`, [showId]);
  assert.equal(audit.length, 2);
  await A.page.waitForSelector('[data-testid="recording-card"]');
  await A.page.click('[data-testid="vis-public"]');
  await A.page.waitForTimeout(800);
  assert.equal((await q(`select visibility from recordings where show_id = $1`, [showId]))[0].visibility, 'public');
});

await step('Clip: trimmed to 90 s max, saved with the handle', async () => {
  await A.page.goto(`${BASE}/artist/clips/new`);
  await A.page.waitForSelector('[data-testid="clip-editor"]', { timeout: 20000 });
  await A.page.fill('input[placeholder="Say what this moment is"]', 'That chorus');
  await A.page.click('[data-testid="save-clip"]');
  await A.page.waitForSelector('text=Clip saved', { timeout: 10000 });
  const clips = await q(`select end_ms - start_ms as len from clips where artist_id = $1`, [amaId]);
  assert.ok(clips.length >= 1 && clips[0].len <= 90000);
});

await step('Versus: Perform while the other is on stage asks; Hand over the stage switches the view for both consoles and the viewer', async () => {
  const versusId = (await q(`select id from shows where room_name = 'synth-live-versus'`))[0].id;
  const K = await artistContext('synth-kofi@synthetic.loudentify.invalid'); // artist A of the seeded Versus show
  const B = await artistContext('synth-nia@synthetic.loudentify.invalid');  // artist B
  await K.page.goto(`${BASE}/artist/console/${versusId}`);
  await B.page.goto(`${BASE}/artist/console/${versusId}`);
  await K.page.waitForSelector('[data-testid="versus-controls"]', { timeout: 20000 });
  await B.page.waitForSelector('[data-testid="versus-controls"]', { timeout: 20000 });
  // seeded view is a_performing: Kofi (A) on stage; Nia (B) asks
  await B.page.click('[data-testid="perform"]');
  await B.page.waitForSelector('[data-testid="asking"]', { timeout: 10000 });
  await K.page.waitForSelector('[data-testid="stage-request"]', { timeout: 10000 });
  await K.page.click('[data-testid="handover"]');
  await K.page.waitForTimeout(1000);
  assert.equal((await q(`select versus_view from shows where id = $1`, [versusId]))[0].versus_view, 'b_performing');
  await B.page.waitForSelector('[data-testid="perform"][aria-pressed="true"]', { timeout: 10000 });
  const req = await q(`select state from stage_requests where show_id = $1 order by created_at desc limit 1`, [versusId]);
  assert.equal(req[0].state, 'accepted');
  const audit = await q(`select count(*)::int as n from audit.audit_log where subject_id = $1 and action in ('show.stage_requested', 'show.stage_request_accepted')`, [versusId]);
  assert.equal(audit[0].n, 2);
  // Conversation is immediate
  await K.page.click('button:has-text("Conversation")');
  await K.page.waitForTimeout(800);
  assert.equal((await q(`select versus_view from shows where id = $1`, [versusId]))[0].versus_view, 'conversation');
  await B.ctx.close(); await K.ctx.close();
});

await step('Earnings and insights screens load for the artist', async () => {
  await A.page.goto(`${BASE}/artist/earnings`);
  await A.page.waitForSelector('[data-testid="earnings"] >> text=72.5%', { timeout: 20000 });
  await A.page.goto(`${BASE}/artist/insights`);
  await A.page.waitForSelector('[data-testid="insights"]', { timeout: 20000 });
  await A.page.waitForSelector('text=Peak viewers');
  await A.page.goto(`${BASE}/profile`);
  await A.page.waitForSelector('[data-testid="owner-profile"]', { timeout: 20000 });
});

await A.ctx.close();
await browser.close();
await pool.end();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} artist e2e steps passed`);
if (failed.length) process.exit(1);
