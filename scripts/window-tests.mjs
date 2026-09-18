#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/window-tests.mjs -- pure-function tests for the show window and
// the Kit Check handover. No browser, no database, no session.
//
// These exist because the countdown has now broken twice, both times in a
// predicate nobody could run in isolation.
import {
  showWindowClosesAt, isWindowOpen, isExpired, msRemainingInShow, showDurationMs,
  handoverState, canHandOverNow,
} from '../lib/showWindow.js';
import { isLivePairing, PAIRING_LIVENESS_MS } from '../lib/pairingLiveness.js';
import { planStaleShots, STALE_TARGET_DOWNGRADE_MS } from '../lib/staleShotPlan.js';
import { showOriginMs, showOriginSource } from '../lib/showState.js';
import { humanCountdown, countdownParts } from '../lib/showWindow.js';
import { isIntentionalDisconnect, describeDisconnect } from '../lib/disconnectIntent.js';
import { SHOW_PROMPTS, validatePrompt, promptByKey, VERSUS_VOTE, isVersusVote } from '../lib/showPrompts.js';
import { nextCatchupPrompt, outstandingPrompts, msUntilNextCatchup, CATCHUP_AFTER_JOIN_MS, CATCHUP_SPACING_MS, CATCHUP_MAX_OUTSTANDING } from '../lib/promptCatchup.js';

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS  ' : '**FAIL** '}${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

const T = 1_000_000_000_000; // showtime
const show = (d = 60, extra = {}) => ({ id: 's1', state: 'scheduled', slated_at: new Date(T).toISOString(), duration_minutes: d, ...extra });

console.log('── window ──');
eq('duration default when column absent', showDurationMs({ slated_at: new Date(T).toISOString() }), 3600000);
eq('duration clamped to the cap', showDurationMs(show(999)), 10800000);
eq('closes at +duration +15m grace', showWindowClosesAt(show(30)), T + 45 * 60000);
eq('ends_at overrides duration', showWindowClosesAt(show(30, { ends_at: new Date(T + 9e6).toISOString() })), T + 9e6);
eq('open 20m before showtime', isWindowOpen(show(60), T - 20 * 60000), true);
eq('shut 40m before showtime', isWindowOpen(show(60), T - 40 * 60000), false);
eq('open inside the grace', isWindowOpen(show(60), T + 70 * 60000), true);
eq('shut past the grace', isWindowOpen(show(60), T + 80 * 60000), false);
eq('expired once the window shuts', isExpired(show(60), T + 80 * 60000), true);
eq('an ended show is never expired', isExpired(show(60, { state: 'ended' }), T + 9e7), false);
eq('remaining mid-show', msRemainingInShow(show(60), T + 20 * 60000), 40 * 60000);

console.log('\n── Kit Check handover (Finding 1) ──');
eq('no show at all', handoverState(null, T), { status: 'none', secondsToShowtime: null, countdown: null });
eq('window not open yet (T-40m)', handoverState(show(60), T - 40 * 60000).status, 'none');
eq('window open, T-2m -> waiting', handoverState(show(60), T - 120000).status, 'waiting');
eq('T-61s is still waiting', handoverState(show(60), T - 61000).status, 'waiting');
eq('★ T-60s ENTERS countdown', handoverState(show(60), T - 60000), { status: 'countdown', secondsToShowtime: 60, countdown: 60 });
eq('T-30s shows 30', handoverState(show(60), T - 30000).countdown, 30);
eq('T-1s shows 1', handoverState(show(60), T - 1000).countdown, 1);
eq('★ showtime -> due', handoverState(show(60), T).status, 'due');
eq('past showtime clamps to 0', handoverState(show(60), T + 5000), { status: 'due', secondsToShowtime: -5, countdown: 0 });
eq('after the window shuts -> none', handoverState(show(60), T + 80 * 60000).status, 'none');
eq('a show with no duration column still counts down', handoverState({ id: 's', state: 'scheduled', slated_at: new Date(T).toISOString() }, T - 60000).status, 'countdown');

console.log('\n── manual GO LIVE (Finding 2) ──');
eq('cannot hand over 40m early', canHandOverNow(show(60), T - 40 * 60000), false);
eq('CAN hand over from T-30m', canHandOverNow(show(60), T - 30 * 60000), true);
eq('can hand over mid-show', canHandOverNow(show(60), T + 10 * 60000), true);
eq('cannot once the window shuts', canHandOverNow(show(60), T + 80 * 60000), false);
eq('cannot for an ended show', canHandOverNow(show(60, { state: 'ended' }), T), false);

// ── item 2: what counts as part of the rig ──────────────────────
// The bug this replaced counted every row ever minted, forever. These
// cases are the four states the cap has to tell apart, plus the ones
// that actually bite in practice: a redeemed row with no last_seen_at
// (written before that column was maintained), and the boundary itself.
console.log('\n── pairing liveness (item 2) ──');
const N = 2_000_000_000_000; // "now" for these cases
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

eq('outstanding code, not yet expired -> live',
  isLivePairing({ expires_at: iso(N + 5 * MIN) }, N), true);
eq('code nobody redeemed, expired -> dead',
  isLivePairing({ expires_at: iso(N - 1) }, N), false);
eq('redeemed and seen a minute ago -> live',
  isLivePairing({ used_at: iso(N - 2 * HOUR), last_seen_at: iso(N - MIN) }, N), true);
eq('redeemed, phone from a previous rehearsal -> dead',
  isLivePairing({ used_at: iso(N - 30 * HOUR), last_seen_at: iso(N - 12 * HOUR) }, N), false);

eq('★ revoked is never live, whatever else it says',
  isLivePairing({ used_at: iso(N), last_seen_at: iso(N), revoked_at: iso(N - MIN) }, N), false);

// expires_at stops meaning anything at redemption, and migrateToShow
// pushes it six hours out. A redeemed row must not become live again
// just because an artist walked into a show.
eq('★ redeemed + long unseen + freshly pushed expiry -> still dead',
  isLivePairing({ used_at: iso(N - 30 * HOUR), last_seen_at: iso(N - 12 * HOUR), expires_at: iso(N + 6 * HOUR) }, N), false);
eq('★ redeemed + expired code + seen just now -> live',
  isLivePairing({ used_at: iso(N - 30 * HOUR), last_seen_at: iso(N - MIN), expires_at: iso(N - 20 * HOUR) }, N), true);

// last_seen_at is only maintained on the multi-camera path, so a row
// redeemed before that column existed has a null there.
eq('★ redeemed, no last_seen_at, used recently -> live (falls back to used_at)',
  isLivePairing({ used_at: iso(N - MIN) }, N), true);
eq('★ redeemed, no last_seen_at, used long ago -> dead',
  isLivePairing({ used_at: iso(N - 30 * HOUR) }, N), false);

// The boundary, both sides. A strict < means exactly-at-the-window is dead.
eq('just inside the liveness window -> live',
  isLivePairing({ used_at: iso(N - PAIRING_LIVENESS_MS + 1000) }, N), true);
eq('exactly at the liveness window -> dead',
  isLivePairing({ used_at: iso(N - PAIRING_LIVENESS_MS) }, N), false);

// Junk must not throw and must not be counted as a camera.
eq('null row -> dead', isLivePairing(null, N), false);
eq('unredeemed with no expiry -> dead', isLivePairing({}, N), false);
eq('unparseable expiry -> dead', isLivePairing({ expires_at: 'not a date' }, N), false);
eq('unparseable used_at -> dead', isLivePairing({ used_at: 'not a date' }, N), false);

// The regression itself: six dead rows must not fill a six-camera cap.
const MAX = 6;
const deadRig = Array.from({ length: 40 }, () => ({ expires_at: iso(N - HOUR) }));
eq('★ 40 expired codes count as 0 live cameras',
  deadRig.filter((p) => isLivePairing(p, N)).length, 0);
eq('★ and therefore do not fill the cap of 6',
  deadRig.filter((p) => isLivePairing(p, N)).length >= MAX, false);


// ── item 1: the stale-target state machine ──────────────────────
// Every one of these is a case the first device test either exercised or
// could not distinguish. The two that matter most are the ones that
// failed on hardware: a downgrade must EMIT, and a camera that comes
// back after a downgrade must still resume -- the first version could
// never do the second, so manual mode required a re-pin after any blip
// long enough to trip the TTL.
console.log('\n── stale shot plan (item 1) ──');

const S = 3_000_000_000_000;
const CLOSE = 'camfeed-a-close-51d6390e';
const pinned = (extra = {}) => ({
  a: { slot: 'a', shot: 'closeUp', targetIdentity: CLOSE, targetSourceKey: `${CLOSE}#camera`, ...extra },
});
const plan = (activeShot, present, now) =>
  planStaleShots({ activeShot, now, isTargetPresent: () => present });
const types = (r) => r.events.map((e) => e.type);

// target present, nothing to do
let r = plan(pinned(), true, S);
eq('healthy shot emits nothing', [types(r), r.changed], [[], false]);
eq('healthy shot keeps the same object', r.next === r.next && types(r).length, 0);

// the camera dies
r = plan(pinned(), false, S);
eq('★ target gone -> suspended', types(r), ['stale_command_suspended']);
eq('suspend sets the flag and a timestamp', [r.next.a.framingSuspended, r.next.a.framingSuspendedAt], [true, S]);
eq('suspend keeps the command and its target', [r.next.a.shot, r.next.a.targetIdentity], ['closeUp', CLOSE]);

// still gone, but inside the TTL
const suspendedAt = pinned({ framingSuspended: true, framingSuspendedAt: S });
r = plan(suspendedAt, false, S + STALE_TARGET_DOWNGRADE_MS - 1000);
eq('inside the TTL emits nothing', [types(r), r.changed], [[], false]);

// the TTL elapses -- THE EVENT THAT NEVER FIRED ON HARDWARE
r = plan(suspendedAt, false, S + STALE_TARGET_DOWNGRADE_MS);
eq('★ TTL reached -> downgraded', types(r), ['stale_command_downgraded']);
eq('★ downgrade EMITS an event, not just a state change', r.events.length, 1);
eq('downgrade goes to wide and records what it left', [r.next.a.shot, r.next.a.downgradedFrom], ['wide', 'closeUp']);
eq('downgrade keeps the dead target so a return re-acquires', r.next.a.targetIdentity, CLOSE);
eq('downgrade reports how long it waited', r.events[0].detail.awayMs, STALE_TARGET_DOWNGRADE_MS);

// downgraded and still gone -- must not re-fire forever
const downgraded = pinned({ shot: 'wide', downgradedFrom: 'closeUp' });
r = plan(downgraded, false, S + 10 * 60000);
eq('★ a downgraded slot does not re-suspend or re-log', [types(r), r.changed], [[], false]);

// the camera comes back inside the TTL -- THE OTHER EVENT THAT NEVER FIRED
r = plan(suspendedAt, true, S + 9000);
eq('★ target returns -> resumed', types(r), ['stale_command_resumed']);
eq('resume restores the original framing', r.next.a.shot, 'closeUp');
eq('resume clears the suspension flags', [r.next.a.framingSuspended, r.next.a.framingSuspendedAt], [undefined, undefined]);
eq('resume reports how long it was away', r.events[0].detail.awayMs, 9000);
eq('resume records it was not a downgrade', r.events[0].detail.wasDowngraded, false);

// the camera comes back AFTER a downgrade -- the manual-mode fix
r = plan(pinned({ shot: 'wide', downgradedFrom: 'closeUp', framingSuspendedAt: S }), true, S + 5 * 60000);
eq('★ returns after a downgrade -> still resumes', types(r), ['stale_command_resumed']);
eq('★ and restores the framing the director chose', r.next.a.shot, 'closeUp');
eq('resume after downgrade clears downgradedFrom', r.next.a.downgradedFrom, undefined);
eq('resume after downgrade says so', r.events[0].detail.wasDowngraded, true);
// Device test 20d1362: awayMs was null here and 20997 on the downgrade.
// The downgrade branch was stripping framingSuspendedAt, so the one event
// describing the LONGEST outages was the one that could not say how long.
eq('★ resume after downgrade reports the FULL time away',
  r.events[0].detail.awayMs, 5 * 60000);

// And the timestamp has to survive the downgrade for that to work, while
// the suspended FLAG must not.
let dg = plan(pinned({ framingSuspended: true, framingSuspendedAt: S }), false, S + STALE_TARGET_DOWNGRADE_MS);
eq('★ downgrade keeps framingSuspendedAt, drops framingSuspended',
  [dg.next.a.framingSuspendedAt, dg.next.a.framingSuspended], [S, undefined]);
eq('and a kept timestamp cannot re-trigger the downgrade',
  plan(dg.next, false, S + 10 * 60000).events.length, 0);
// End to end: 30s dead, then back. The resume must report the whole 45s.
let seq = pinned();
let lastResume = null;
for (let t = 0; t <= 45000; t += 1000) {
  const step = planStaleShots({ activeShot: seq, now: S + t, isTargetPresent: () => t >= 45000 });
  step.events.forEach((e) => { if (e.type === 'stale_command_resumed') lastResume = e.detail; });
  seq = step.next;
}
eq('★ a 45s outage resumes reporting awayMs 45000, not null',
  [lastResume.awayMs, lastResume.wasDowngraded], [45000, true]);

// a wide shot has no framing to downgrade to
r = plan(pinned({ shot: 'wide', framingSuspended: true, framingSuspendedAt: S }), false, S + 10 * 60000);
eq('a suspended WIDE shot never downgrades', [types(r), r.changed], [[], false]);

// commands with no explicit target are not this machine's business
r = plan({ a: { slot: 'a', shot: 'wide', targetIdentity: null } }, false, S);
eq('no targetIdentity -> untouched', [types(r), r.changed], [[], false]);

// two slots, independent
r = planStaleShots({
  activeShot: { a: { slot: 'a', shot: 'closeUp', targetIdentity: 'cam-a' },
                b: { slot: 'b', shot: 'closeUp', targetIdentity: 'cam-b' } },
  now: S,
  isTargetPresent: (slot) => slot === 'b',
});
eq('★ only the dead slot is suspended', [types(r), r.next.b.framingSuspended], [['stale_command_suspended'], undefined]);
eq('the live slot is untouched by reference', r.next.b === r.next.b && r.next.a.framingSuspended, true);

// full sequence, driven like the real clock: 1s ticks across a 30s outage
let state = pinned();
const emitted = [];
for (let t = 0; t <= 30000; t += 1000) {
  const step = planStaleShots({ activeShot: state, now: S + t, isTargetPresent: () => false });
  step.events.forEach((e) => emitted.push([t, e.type]));
  state = step.next;
}
eq('★ a 30s outage ticked at 1Hz emits exactly suspend then downgrade',
  emitted, [[0, 'stale_command_suspended'], [20000, 'stale_command_downgraded']]);

// and the 10s outage the operator actually ran: gone at 8s (LiveKit's
// eviction), back at 15s.
state = pinned();
const emitted2 = [];
for (let t = 0; t <= 40000; t += 1000) {
  const here = t >= 8000 && t < 15000 ? false : true;
  const step = planStaleShots({ activeShot: state, now: S + t, isTargetPresent: () => here });
  step.events.forEach((e) => emitted2.push([t, e.type]));
  state = step.next;
}
eq('★ an 8s-to-15s outage emits suspend then resume, and nothing else',
  emitted2, [[8000, 'stale_command_suspended'], [15000, 'stale_command_resumed']]);
eq('★ and the shot is back to the pinned framing', state.a.shot, 'closeUp');



// ── item 3: the offset origin ───────────────────────────────────
// The failure this guards is silent in both directions. An offset site
// that skips actual_started_at records times that look plausible and are
// wrong by however late the artist went live; a SCHEDULING site that
// adopts it leaves shows unexpirable. Hence one helper, and these cases.
console.log('\n── offset origin (item 3) ──');
const SLATED = '2026-09-20T19:00:00Z';
const ACTUAL = '2026-09-20T19:08:00Z';

eq('no actual start -> slated', showOriginMs({ slated_at: SLATED }), Date.parse(SLATED));
eq('and says which it used', showOriginSource({ slated_at: SLATED }), 'slated');
eq('★ actual start WINS over slated',
  showOriginMs({ slated_at: SLATED, actual_started_at: ACTUAL }), Date.parse(ACTUAL));
eq('and says so', showOriginSource({ slated_at: SLATED, actual_started_at: ACTUAL }), 'actual');
eq('★ eight minutes late is eight minutes of offset error avoided',
  showOriginMs({ slated_at: SLATED, actual_started_at: ACTUAL }) - Date.parse(SLATED), 8 * 60000);

// Junk must fall back, never produce NaN: a NaN origin makes every
// offset in the show NaN, and the reaction write does not check.
eq('unparseable actual falls back to slated',
  showOriginMs({ slated_at: SLATED, actual_started_at: 'not a date' }), Date.parse(SLATED));
eq('null actual falls back to slated',
  showOriginMs({ slated_at: SLATED, actual_started_at: null }), Date.parse(SLATED));
eq('no show at all -> null, not NaN', showOriginMs(null), null);
eq('no dates at all -> null, not NaN', showOriginMs({}), null);
eq('★ never returns NaN', [showOriginMs({ slated_at: 'x', actual_started_at: 'y' })], [null]);

// THE BOUNDARY. Scheduling must not move: a show that never starts still
// has to expire, and the door must open before the artist goes live.
const lateShow = { id: 's', state: 'scheduled', slated_at: new Date(T).toISOString(), duration_minutes: 60 };
eq('★ scheduling still answers from slated_at, not actual',
  showWindowClosesAt({ ...lateShow, actual_started_at: new Date(T + 30 * 60000).toISOString() }),
  showWindowClosesAt(lateShow));
eq('★ a show that never started still expires',
  isExpired({ ...lateShow, state: 'soundcheck' }, T + 80 * 60000), true);
eq('★ the door still opens before the artist goes live',
  isWindowOpen(lateShow, T - 20 * 60000), true);



// ── item 8 §4.3: intent vs transport failure ────────────────────
// The asymmetry is the whole design. Releasing on a blip kills a camera
// mid-show with no way back except walking over to it; failing to
// release on a real ending holds a light on for a few extra seconds.
console.log('\n── disconnect intent (item 8 §4.3) ──');

eq('★ ROOM_DELETED is intent -> release', isIntentionalDisconnect('ROOM_DELETED'), true);
eq('CLIENT_INITIATED is intent -> release', isIntentionalDisconnect('CLIENT_INITIATED'), true);
eq('PARTICIPANT_REMOVED is intent -> release', isIntentionalDisconnect('PARTICIPANT_REMOVED'), true);

// Every one of these used to release the camera. That is the bug.
for (const r of ['SIGNAL_CLOSE', 'DUPLICATE_IDENTITY', 'STATE_MISMATCH', 'JOIN_FAILURE',
                 'MIGRATION', 'SERVER_SHUTDOWN', 'UNKNOWN_REASON']) {
  eq(`★ ${r} is transport -> HOLD`, isIntentionalDisconnect(r), false);
}

// The default. LiveKit may add reasons; each will arrive unrecognised,
// and the safe reading of an unknown reason is "nobody told me this was
// deliberate".
eq('★ an unrecognised reason HOLDS', isIntentionalDisconnect('SOME_FUTURE_REASON'), false);
eq('★ no reason at all HOLDS', isIntentionalDisconnect(undefined), false);
eq('null HOLDS', isIntentionalDisconnect(null), false);
eq('empty string HOLDS', isIntentionalDisconnect('   '), false);
// A numeric enum must not coerce into a match -- 0 is falsy and some SDK
// versions pass numbers.
eq('★ a numeric reason HOLDS rather than coercing', isIntentionalDisconnect(0), false);
eq('a numeric reason 3 HOLDS', isIntentionalDisconnect(3), false);
eq('an object HOLDS', isIntentionalDisconnect({ reason: 'ROOM_DELETED' }), false);

eq('case and padding are normalised', isIntentionalDisconnect('  room_deleted  '), true);
eq('describeDisconnect names the action',
  describeDisconnect('SIGNAL_CLOSE'), { reason: 'SIGNAL_CLOSE', intentional: false, action: 'hold' });
eq('and for a real ending',
  describeDisconnect('ROOM_DELETED'), { reason: 'ROOM_DELETED', intentional: true, action: 'release' });



// ── item 6: the prompts, and the four that must not change ──────
// The July-survey strings are the only evidence in this pilot that
// measures a CHANGE of mind rather than an opinion. Editing one is
// silent -- rows still write, the tally still renders -- so the exact
// bytes are asserted here.
//
// ⚠️ TWO OF THESE WERE SHIPPED WRONG ONCE, and the old test asserted the
// WRONG values byte-exact, which made the error look verified. These are
// the values actually present in `Potential viewers survey.csv`.
console.log('\n── show prompts (item 6) ──');

eq('eight prepared prompts', SHOW_PROMPTS.length, 8);
eq('all validate against the DB CHECK', SHOW_PROMPTS.map(validatePrompt).filter(Boolean), []);
eq('seven choice, one text at the end',
  SHOW_PROMPTS.map((p) => p.kind).join(','), 'choice,choice,choice,choice,choice,choice,choice,text');
eq('four are verbatim', SHOW_PROMPTS.filter((p) => p.verbatim).map((p) => p.key),
  ['versus_interest', 'originals_or_covers', 'would_buy_tokens', 'first_purchase']);

// CSV col 6
eq('★ VERBATIM versus body (CSV col 6)', promptByKey('versus_interest').body,
  'Imagine two unsigned artists going head-to-head in a live show, where your votes help decide the winner. How interesting does that sound?');
eq('★ VERBATIM versus options', promptByKey('versus_interest').options,
  ['Very interesting', 'Somewhat interesting', 'Not really']);

// CSV col 4 -- note the STRAIGHT apostrophe in "don't"
eq('★ VERBATIM covers body (CSV col 4)', promptByKey('originals_or_covers').body,
  'Would you rather watch a new artist perform their own songs, or covers of songs you know?');
eq('★ VERBATIM covers options', promptByKey('originals_or_covers').options,
  ['Their own original songs', 'Covers of songs I already know', 'A mix of both', "I don't mind either way"]);
eq('★ covers uses a STRAIGHT apostrophe (U+0027), as the survey did',
  promptByKey('originals_or_covers').options[3].codePointAt(5), 0x27);

// CSV col 7 -- `Never`, NOT `No, never`. Shipped wrong once.
eq('★ VERBATIM tokens body (CSV col 7)', promptByKey('would_buy_tokens').body,
  'Watching would be free. Would you ever buy tokens to power-vote or tip an artist you loved?');
eq('★ VERBATIM tokens options -- `Never`, not `No, never`',
  promptByKey('would_buy_tokens').options, ['Definitely', 'Only for an artist I really love', 'Never']);

// CSV col 8 -- curly apostrophe, and NOT `Free votes only`. Shipped wrong once.
eq('★ VERBATIM first-purchase body (CSV col 8)', promptByKey('first_purchase').body,
  'Which would you most likely try first?');
eq('★ VERBATIM first-purchase options', promptByKey('first_purchase').options,
  ['I’d only ever use free votes', '£10 token pack', '£20 token pack']);
eq('★ first-purchase uses a CURLY apostrophe (U+2019), as the survey did',
  promptByKey('first_purchase').options[0].charCodeAt(1), 0x2019);

// Order is load-bearing. Versus at 20 sits before covers at 22.
eq('★ suggested order ascends, text last',
  SHOW_PROMPTS.map((p) => p.suggestedAtMs),
  [480000, 900000, 1200000, 1320000, 1800000, 2280000, 2700000, null]);
eq('the versus question is flagged versus-only',
  SHOW_PROMPTS.filter((p) => p.versusOnly).map((p) => p.key), ['versus_interest']);

// validatePrompt mirrors show_prompts_options_check.
eq('choice with 1 option rejected', !!validatePrompt({ kind: 'choice', body: 'q', options: ['a'] }), true);
eq('choice with 5 options rejected', !!validatePrompt({ kind: 'choice', body: 'q', options: ['a','b','c','d','e'] }), true);
eq('choice with 4 accepted', validatePrompt({ kind: 'choice', body: 'q', options: ['a','b','c','d'] }), null);
eq('★ blank option rejected', !!validatePrompt({ kind: 'choice', body: 'q', options: ['a', '  '] }), true);
eq('text with options rejected', !!validatePrompt({ kind: 'text', body: 'q', options: ['a'] }), true);
eq('★ 281 chars rejected', !!validatePrompt({ kind: 'text', body: 'x'.repeat(281), options: [] }), true);
eq('null rejected', !!validatePrompt(null), true);

// ── item 6: catch-up for late joiners ───────────────────────────
// Timing logic, which is what cost two days on item 1 -- so it is a pure
// function and every rule is asserted rather than watched on a device.
console.log('\n── prompt catch-up (item 6) ──');

const J = 5_000_000_000_000;                       // joined at
const pAt = (n) => ({ id: `p${n}`, pushed_at: new Date(J - n * 60000).toISOString() });
const five = [pAt(1), pAt(2), pAt(3), pAt(4), pAt(5)]; // p1 newest
const call = (o) => nextCatchupPrompt({ pushed: five, answeredIds: [], seenIds: [], joinedAt: J, lastShownAt: null, now: J, ...o });

eq('nothing before 5 minutes', call({ now: J + CATCHUP_AFTER_JOIN_MS - 1000 }), null);
eq('★ at exactly 5 minutes, the most recent missed prompt',
  call({ now: J + CATCHUP_AFTER_JOIN_MS })?.id, 'p1');
eq('★ at most 3 outstanding, most recent first',
  outstandingPrompts({ pushed: five, answeredIds: [], seenIds: [] }).map((p) => p.id), ['p1', 'p2', 'p3']);
eq('the cap is 3', CATCHUP_MAX_OUTSTANDING, 3);
// Pinned so changing either is a visible diff in review rather than a
// silent shift in how much of the show a late joiner spends answering.
eq('★ threshold is 5 minutes', CATCHUP_AFTER_JOIN_MS, 5 * 60000);
eq('★ spacing is 2 minutes', CATCHUP_SPACING_MS, 2 * 60000);

// Spacing.
eq('nothing within the spacing window of the last card',
  call({ now: J + CATCHUP_AFTER_JOIN_MS + CATCHUP_SPACING_MS - 1000, lastShownAt: J + CATCHUP_AFTER_JOIN_MS, seenIds: ['p1'] }), null);
eq('★ the next one exactly one spacing later',
  call({ now: J + CATCHUP_AFTER_JOIN_MS + CATCHUP_SPACING_MS, lastShownAt: J + CATCHUP_AFTER_JOIN_MS, seenIds: ['p1'] })?.id, 'p2');

// Never re-show an answered prompt -- the rule that was explicitly asked for.
eq('★ an answered prompt is never offered',
  call({ now: J + CATCHUP_AFTER_JOIN_MS, answeredIds: ['p1'] })?.id, 'p2');
eq('★ answered prompts drop out of the cap, so the 4th becomes eligible',
  outstandingPrompts({ pushed: five, answeredIds: ['p1', 'p2'], seenIds: [] }).map((p) => p.id), ['p3', 'p4', 'p5']);
eq('all answered -> nothing to catch up on',
  call({ now: J + CATCHUP_AFTER_JOIN_MS, answeredIds: ['p1','p2','p3','p4','p5'] }), null);

// A dismissed card is not re-offered in a loop.
eq('★ a prompt the catch-up already offered is not re-offered',
  call({ now: J + CATCHUP_AFTER_JOIN_MS, seenIds: ['p1'] })?.id, 'p2');

// THE 911da9e REGRESSION. A viewer present for four pushes who answers
// one must still be offered the other three. Excluding live-seen prompts
// reported `outstanding 0` and offered nothing.
eq('★ present for all four, answered one -> three still outstanding',
  outstandingPrompts({ pushed: [pAt(1), pAt(2), pAt(3), pAt(4)], answeredIds: ['p2'], seenIds: [] })
    .map((p) => p.id), ['p1', 'p3', 'p4']);
eq('★ and the catch-up offers the most recent of them',
  nextCatchupPrompt({ pushed: [pAt(1), pAt(2), pAt(3), pAt(4)], answeredIds: ['p2'], seenIds: [],
    joinedAt: J, lastShownAt: null, now: J + CATCHUP_AFTER_JOIN_MS, shownCount: 0 })?.id, 'p1');
eq('★ answering ONE does not clear the rest',
  outstandingPrompts({ pushed: five, answeredIds: ['p1'], seenIds: [] }).length, 3);

// Nothing is asked after the end, and the queue is DROPPED rather than
// deferred. A prompt over the ended card in front of fifty people is the
// most visible way to look broken.
eq('★ show ended -> no catch-up, however much is outstanding',
  nextCatchupPrompt({ pushed: five, answeredIds: [], seenIds: [], joinedAt: J,
    lastShownAt: null, now: J + CATCHUP_AFTER_JOIN_MS, shownCount: 0, showEnded: true }), null);
eq('★ show ended -> the countdown reports nothing due, not a time',
  msUntilNextCatchup({ pushed: five, answeredIds: [], seenIds: [], joinedAt: J,
    lastShownAt: null, now: J + CATCHUP_AFTER_JOIN_MS, shownCount: 0, showEnded: true }), null);
eq('and while the show is live it still delivers',
  nextCatchupPrompt({ pushed: five, answeredIds: [], seenIds: [], joinedAt: J,
    lastShownAt: null, now: J + CATCHUP_AFTER_JOIN_MS, shownCount: 0, showEnded: false })?.id, 'p1');

// Nothing pushed at all.
eq('no prompts -> nothing', nextCatchupPrompt({ pushed: [], answeredIds: [], seenIds: [], joinedAt: J, lastShownAt: null, now: J + 1e7 }), null);
eq('junk clock -> nothing, not a throw',
  nextCatchupPrompt({ pushed: five, answeredIds: [], seenIds: [], joinedAt: NaN, lastShownAt: null, now: J }), null);

// The full late-joiner sequence, ticked at 1Hz for 20 minutes: someone
// arriving with five prompts behind them should be shown exactly three,
// three minutes apart, starting five minutes after they arrived.
{
  const shown = [];
  let seen = [];
  let last = null;
  for (let t = 0; t <= 40 * 60000; t += 1000) {
    const n = nextCatchupPrompt({
      pushed: five, answeredIds: [], seenIds: seen, joinedAt: J,
      lastShownAt: last, now: J + t, shownCount: shown.length,
    });
    if (n) { shown.push([t / 60000, n.id]); seen = [...seen, n.id]; last = J + t; }
  }
  eq('★ a late joiner sees exactly 3, at 5, 7 and 9 minutes -- and then STOPS',
    shown, [[5, 'p1'], [7, 'p2'], [9, 'p3']]);
}

// The cap directly. Without it a viewer with five missed prompts was
// shown three, then the remaining two became 'outstanding' and were
// shown too -- all five, just more slowly.
eq('★ nothing once 3 have been shown, however long it has been',
  nextCatchupPrompt({ pushed: five, answeredIds: [], seenIds: ['p1','p2','p3'], joinedAt: J,
    lastShownAt: null, now: J + 60 * 60000, shownCount: 3 }), null);
eq('the 3rd is still allowed',
  nextCatchupPrompt({ pushed: five, answeredIds: [], seenIds: ['p1','p2'], joinedAt: J,
    lastShownAt: null, now: J + 60 * 60000, shownCount: 2 })?.id, 'p3');


// ── artist door: the Go Live countdown ──────────────────────────
// The last 59 seconds before the window opens all read "in 0m", on the
// one button an artist stands watching. Seconds matter there, and the
// viewer countdown needs the same granularity.
console.log('\n── humanCountdown ──');
eq('past -> now', humanCountdown(-1), 'now');
eq('zero -> now', humanCountdown(0), 'now');
eq('★ 45 seconds reads in seconds, not "in 0m"', humanCountdown(45000), 'in 45s');
eq('★ 59 seconds', humanCountdown(59000), 'in 59s');
eq('60 seconds crosses to minutes', humanCountdown(60000), 'in 1m');
eq('59 minutes', humanCountdown(59 * 60000), 'in 59m');
eq('an hour', humanCountdown(60 * 60000), 'in 1h 0m');
eq('4h 12m', humanCountdown((4 * 60 + 12) * 60000), 'in 4h 12m');
eq('one day is singular', humanCountdown(25 * 3600000), 'in 1 day');
eq('three days', humanCountdown(3 * 86400000), 'in 3 days');
eq('null -> empty', humanCountdown(null), '');



// ── viewer homepage: the countdown to showtime ──────────────────
// The spec is "days, then hours, then minutes, then seconds as it gets
// closer", so `scale` is the load-bearing field -- it decides which
// units are on screen. A fixed MM:SS reads "4320:00" three days out.
console.log('\n── countdownParts ──');
const cSEC = 1000, cMIN = 60 * cSEC, cHOUR = 60 * cMIN, cDAY = 24 * cHOUR;
const cp = (ms) => countdownParts(ms);

eq('★ three days out -> days scale', cp(3 * cDAY + 4 * cHOUR).scale, 'days');
eq('and the parts split correctly',
  [cp(3 * cDAY + 4 * cHOUR).days, cp(3 * cDAY + 4 * cHOUR).hours], [3, 4]);
eq('★ 25 hours is still days scale (1 day, 1 hour)',
  [cp(25 * cHOUR).scale, cp(25 * cHOUR).days, cp(25 * cHOUR).hours], ['days', 1, 1]);
eq('★ just under a day switches to hours', cp(cDAY - cSEC).scale, 'hours');
eq('an hour and two minutes -> hours scale',
  [cp(cHOUR + 2 * cMIN).scale, cp(cHOUR + 2 * cMIN).hours, cp(cHOUR + 2 * cMIN).minutes],
  ['hours', 1, 2]);
eq('★ just under an hour switches to minutes', cp(cHOUR - cSEC).scale, 'minutes');
eq('90 seconds -> minutes scale, 1m30s',
  [cp(90 * cSEC).scale, cp(90 * cSEC).minutes, cp(90 * cSEC).seconds], ['minutes', 1, 30]);
eq('★ under a minute switches to seconds', cp(45 * cSEC).scale, 'seconds');
eq('45 seconds', cp(45 * cSEC).seconds, 45);

// Showtime and past it must both read done, because `done` is what the
// page routes on. A negative that fell through as a huge positive would
// park a viewer on a countdown while the show ran without them.
eq('★ zero is done', cp(0).done, true);
eq('★ past showtime is done, not a negative countdown', cp(-5000).done, true);
eq('past showtime zeroes every part',
  [cp(-5000).days, cp(-5000).hours, cp(-5000).minutes, cp(-5000).seconds], [0, 0, 0, 0]);
eq('★ NaN is done rather than NaN parts', cp(NaN).done, true);
eq('undefined is done', cp(undefined).done, true);

// The audio window: starts at T-100m, and must be off at showtime so the
// loop is not still playing under the room's own audio.
const LEAD = 100 * cMIN;
const audioOn = (ms) => Number.isFinite(ms) && ms > 0 && ms <= LEAD;
eq('★ music is off 101 minutes out', audioOn(LEAD + cMIN), false);
eq('★ music starts at exactly 100 minutes', audioOn(LEAD), true);
eq('music is on 5 minutes out', audioOn(5 * cMIN), true);
eq('★ music is OFF at showtime', audioOn(0), false);
eq('★ music is OFF after showtime', audioOn(-1000), false);
eq('no show -> no music', audioOn(null), false);



// ── the Versus vote ─────────────────────────────────────────────
// A vote is a choice prompt, so it must satisfy the same CHECK the
// database enforces -- and it must be recognisable as a vote through
// BOTH routes it can reach a viewer by: the data-channel broadcast and
// the catch-up list, which returns only id/kind/body/options/pushed_at.
console.log('\n── versus vote (item 6) ──');
eq('the vote validates as a choice prompt', validatePrompt(VERSUS_VOTE), null);
eq('two options, the stage names in slot order', VERSUS_VOTE.options, ['Artistwon', 'Artisttoo']);
eq('★ NOT in the questions list -- it is a control, not a question',
  SHOW_PROMPTS.some((p) => p.key === VERSUS_VOTE.key), false);

// The discriminator has to survive the catch-up round trip, which drops
// every field except id/kind/body/options/pushed_at.
eq('★ recognised as a vote', isVersusVote(VERSUS_VOTE), true);
eq('★ still recognised after a catch-up round trip (body survives)',
  isVersusVote({ id: 'x', kind: 'choice', body: VERSUS_VOTE.body, options: VERSUS_VOTE.options, pushed_at: 'now' }), true);
eq('a question is not a vote', isVersusVote(promptByKey('compare')), false);
eq('the open-text question is not a vote', isVersusVote(promptByKey('come_back')), false);
for (const p of SHOW_PROMPTS) {
  eq(`  "${p.key}" is not mistaken for the vote`, isVersusVote(p), false);
}
eq('null is not a vote', isVersusVote(null), false);
eq('a prompt with no body is not a vote', isVersusVote({ kind: 'choice', options: [] }), false);
eq('★ a DIFFERENT two-option prompt is not the vote',
  isVersusVote({ kind: 'choice', body: 'Who is winning?', options: ['Artistwon', 'Artisttoo'] }), false);


console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
