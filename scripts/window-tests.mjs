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

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
