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


console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
