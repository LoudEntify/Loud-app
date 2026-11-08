// tests/pilot-journey.test.mjs
// ─────────────────────────────────────────────────────────────
// "I can see that some pages on teh web app is showing some old pilot
// pages which should not be." — Korey, 5 Nov.
//
// Two separate faults were behind that, and the second is the one that
// mattered: the pilot journey still routed, AND the product itself
// linked to it. ScheduleShow, InvitedShows and Onboarding all sent an
// artist to `/kit-check` — the pilot's Kit Check — rather than
// `/artist/kit-check`. So an artist following the product's own buttons
// arrived in the previous product, which is why this kept happening
// without anyone typing an old URL.
//
// Closing routes would not have fixed that on its own. It would have
// turned three working buttons into three 404s.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { PILOT_PATHS, isPilotPath, showPathFor, pilotReachable } from '../lib/pilotJourney.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('the retired paths are named, and the product journey is not among them', () => {
  assert.deepEqual([...PILOT_PATHS], ['/kit-check', '/pilot', '/pilot/live']);

  for (const p of PILOT_PATHS) assert.equal(isPilotPath(p), true);
  assert.equal(isPilotPath('/kit-check/'), true, 'a trailing slash is the same page');

  // The product's own routes must never match, or gating would close the
  // app rather than the pilot.
  for (const p of ['/artist/kit-check', '/show/abc', '/live', '/', '/artist/console/1']) {
    assert.equal(isPilotPath(p), false, `${p} is the product`);
  }
  // And nothing merely starting with a pilot path is caught.
  assert.equal(isPilotPath('/pilot-programme'), false);
  assert.equal(isPilotPath('/kit-checklist'), false);
  assert.equal(isPilotPath(''), false);
  assert.equal(isPilotPath(null), false);
});

test('every pilot page refuses to render in production, and renders everywhere else', () => {
  // Decided on the SERVER, before anything renders, so the URL is a
  // plain 404 and the page's code is never sent to a browser. Same gate
  // the spike controller already used, so there is one idea of "this is
  // a harness, not the product".
  for (const page of ['app/kit-check/page.js', 'app/pilot/page.js', 'app/pilot/live/page.js']) {
    const code = codeOf(read(page));
    assert.match(code, /notFound/, `${page} does not 404`);
    assert.match(
      code,
      /if\s*\(!pilotReachable\(process\.env\.VERCEL_ENV === 'production'\)\)\s*notFound\(\)/,
      `${page} must refuse before it renders`,
    );
    // NOT devHarnessAllowed: that is "dev payment provider AND not
    // production", and a staging deployment carrying a Stripe key would
    // have had the pilot journey closed on it — see below for why that
    // would have been bad.
    assert.ok(!/devHarnessAllowed/.test(code), `${page} must not gate on the payment provider`);
  }
  assert.equal(pilotReachable(false), true, 'anywhere that is not production');
  assert.equal(pilotReachable(true), false, 'and never production');
});

test('nothing in the product links to the pilot journey', () => {
  // This is the test that would have caught it. Swept across every
  // tracked component and page rather than the files I happened to open,
  // because the next such link will be written somewhere I am not
  // looking — which is how these three survived the rebuild.
  const files = execFileSync('git', ['ls-files', 'app/*.js', 'app/**/*.js', 'components/**/*.jsx', 'components/*.jsx'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    // The pilot's own pages and components may of course mention it.
    .filter((p) => !p.startsWith('app/pilot/') && p !== 'app/kit-check/page.js');

  const offenders = [];
  for (const f of files) {
    const code = codeOf(read(f));
    // A link or a navigation to a retired path, exactly: '/kit-check'
    // but not '/artist/kit-check'.
    for (const m of code.matchAll(/['"`](\/(?:kit-check|pilot(?:\/live)?))['"`]/g)) {
      offenders.push(`${f} → ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `the product still links to the pilot journey:\n${offenders.join('\n')}`);
});

test('an old pilot share link lands on the show the product has', () => {
  assert.equal(showPathFor('abc123'), '/show/abc123');

  const mw = codeOf(read('middleware.js'));
  assert.match(mw, /showPathFor\(show\)/, 'the middleware uses the shared path');
  // A redirect, not a rewrite: the address bar then shows where the
  // person actually is, so the next link they copy is the real one.
  assert.match(mw, /NextResponse\.redirect/);
  assert.ok(!/pathname = '\/pilot\/live'/.test(mw), 'and never into the pilot again');
  // The stale query is dropped, so /show/<id>?show=<id> cannot happen.
  assert.match(mw, /searchParams\.delete\('show'\)/);
});

test('the new web console publishes, so the pilot journey is no longer the only performer position', () => {
  // Written on 7 November as "nothing in components/artist/ publishes",
  // with a message telling whoever read it to move the performer test
  // to the new console. On 8 November the console does publish
  // (lib/artistPublish.js), so the claim is inverted here rather than
  // left reading as it did.
  //
  // It also showed up a weakness in the original: it searched for an
  // `import livekit-client` in components/artist/, and the console
  // publishes through a hook in lib/ — so the test would have kept
  // passing while its premise became false. It now checks the
  // CAPABILITY, which is what anyone reading it cares about.
  const consoleScreen = codeOf(read('components/artist/ConsoleScreen.jsx'));
  assert.match(consoleScreen, /useArtistPublish\(/, 'the console joins the room and publishes');

  const publisher = codeOf(read('lib/artistPublish.js'));
  assert.match(publisher, /from 'livekit-client'/);
  assert.match(publisher, /publishTrack\(handle\.processedTrack/, 'with the processed microphone');

  // The pilot journey stays REACHABLE on staging all the same, and the
  // reason has changed: not because it is the only way to perform, but
  // because its capability panels — the audio deck, the cue editor, the
  // shot console — are still not behind the new console. ONE_JOURNEY
  // step 2c retires it when they are.
  assert.match(read('components/LiveDemo.jsx'), /livekit-client/);
});

test('the pilot components are still here, because they are still the specification', () => {
  // docs/ONE_JOURNEY.md §7 retires the journey AFTER its capability
  // panels are lifted behind the new screens. Deleting them now would
  // delete the only working version of cueing a backing track, the audio
  // deck, the shot console and cue sheets — the mistake §3 records.
  for (const c of [
    'components/KitCheck.jsx',
    'components/LiveDemo.jsx',
    'components/BackingTrackPanel.jsx',
    'components/AudioDeckPanel.jsx',
    'components/DirectorShotPanel.jsx',
    'components/CueEditorPanel.jsx',
    'components/CalibrateSyncPanel.jsx',
  ]) {
    assert.ok(read(c).length > 0, `${c} must stay until its capability is reused`);
  }
});

test('lib/pilotJourney.js knows no framework', () => {
  const code = codeOf(read('lib/pilotJourney.js'));
  for (const word of ['next/', 'react', 'NextResponse', 'process.env']) {
    assert.ok(!code.includes(word), `lib/pilotJourney.js names ${word}`);
  }
  assert.ok(!/from\s+'/.test(code), 'it imports nothing');
});
