// tests/publishing.test.mjs
// ─────────────────────────────────────────────────────────────
// Being in the show: the phases and the sentences, shared by the phone
// and the web console.
//
// The rule these tests mostly protect: a WARNING IS NOT A FAILURE. The
// camera saying the phone is on its side, or that it could not hold a
// frame rate, must not read as "you are not live" — the camera is
// running, and an artist who thinks they are off air behaves very
// differently from one who knows they are on.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IDLE, STARTING, LIVE, FAILED, PHASES,
  isPublishing, canRetry, nextPhase, joinFailureMessage, describePublishing,
} from '../lib/publishing.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('a warning leaves the phase alone, from every phase', () => {
  // The whole point. A frame-rate notice mid-performance must not move
  // an artist from "live" to anything else.
  for (const phase of PHASES) {
    assert.equal(nextPhase(phase, 'warning'), phase, `${phase} must survive a warning`);
  }
  assert.equal(nextPhase(LIVE, 'warning'), LIVE);
  assert.equal(isPublishing(nextPhase(LIVE, 'warning')), true);
});

test('the phases move only on the events that mean them', () => {
  assert.equal(nextPhase(IDLE, 'starting'), STARTING);
  assert.equal(nextPhase(STARTING, 'published'), LIVE);
  assert.equal(nextPhase(LIVE, 'stopped'), IDLE);
  assert.equal(nextPhase(STARTING, 'failed'), FAILED);
  assert.equal(nextPhase(LIVE, 'failed'), FAILED, 'a live camera can still fail');
  // An unknown event changes nothing rather than guessing.
  assert.equal(nextPhase(LIVE, 'nonsense'), LIVE);
  assert.equal(nextPhase(LIVE, undefined), LIVE);
});

test('only a failure offers a retry, and only "live" counts as in the show', () => {
  assert.equal(canRetry(FAILED), true);
  for (const phase of [IDLE, STARTING, LIVE]) assert.equal(canRetry(phase), false);
  assert.equal(isPublishing(LIVE), true);
  for (const phase of [IDLE, STARTING, FAILED]) assert.equal(isPublishing(phase), false);
});

test("the route's own refusal wins, because it knows why", () => {
  // join-show knows whether the window has not opened, has closed, or
  // is not this artist's show. Those sentences beat anything invented.
  assert.equal(joinFailureMessage('Your show window has not opened yet.'), 'Your show window has not opened yet.');
  assert.equal(joinFailureMessage('  trimmed  '), 'trimmed');

  // No message means no answer — a transport failure — and that gets a
  // sentence about the connection rather than a shrug.
  for (const nothing of [null, undefined, '', '   ', 42, {}]) {
    assert.match(joinFailureMessage(nothing), /connection may have dropped/);
  }
});

test('the status line says what IS, except while starting', () => {
  assert.match(describePublishing(LIVE), /are in the show/);
  assert.match(describePublishing(IDLE), /not in the show/);
  // Starting is the one moment an artist needs to know something is
  // happening and nothing has gone wrong yet.
  assert.match(describePublishing(STARTING), /Putting your camera/);
  // A failure shows the reason it was given, not a generic line.
  assert.equal(describePublishing(FAILED, { error: 'Too early.' }), 'Too early.');
  assert.match(describePublishing(FAILED), /connection may have dropped/);
});

test('lib/publishing.js names no platform', () => {
  const src = read('lib/publishing.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['livekit', 'react', 'expo-', 'window.', 'navigator.']) {
    assert.ok(!src.toLowerCase().includes(word.toLowerCase()), `it names ${word}`);
  }
  assert.ok(!/from\s+'/.test(src), 'it imports nothing');
});

test('the web console now publishes, and publishes the PROCESSED microphone', () => {
  const pub = read('lib/artistPublish.js');

  // The finding from 7 November: nothing in components/artist/ joined a
  // room. This is the web half of native/src/ownCamera.js.
  assert.match(pub, /from 'livekit-client'/);
  assert.match(pub, /'\/api\/performer\/join-show'/, 'the same route the phone uses');

  // The published microphone is the chain's output, not the raw stream:
  // what viewers hear is what the artist tuned.
  assert.match(pub, /createPilotAudioTrack\(\)/);
  assert.match(pub, /publishTrack\(handle\.processedTrack/);
  assert.ok(!/publishTrack\(handle\.rawStream/.test(pub), 'never the raw stream');

  // The graph is handed to the host rather than held in the hook, so the
  // capability panels outlive a remount — the lesson audioHost.js
  // records and that the phone had to relearn this morning.
  assert.match(pub, /adoptAudioGraph\(handle\)/);
  assert.match(pub, /releaseAudioHost\(/);

  // Camera before chain: a performer with sound and no picture is worse
  // than one with a picture and no sound.
  const camera = pub.indexOf('setCameraEnabled(true)');
  const chain = pub.indexOf('createPilotAudioTrack()');
  assert.ok(camera > 0 && camera < chain, 'the camera goes out first');

  // A failed start closes everything it opened. A half-joined room
  // leaves a participant in the show with nothing to publish, and the
  // egress would compose a slot for it.
  assert.match(pub, /rawStream\?\.getTracks\?\.\(\)\.forEach/);
  assert.match(pub, /audioContext\?\.close\?\.\(\)/);
  assert.match(pub, /room\.disconnect\(\)/);

  // And the phases come from the shared module rather than a second set.
  assert.match(pub, /from '\.\/publishing'/);
  assert.ok(!/const (IDLE|LIVE|FAILED) = '/.test(pub), 'no second definition of the phases');
});

test('the console SHOWS the publishing status, not just computes it', () => {
  // #65 imported describePublishing, canRetry and isPublishing and
  // rendered none of them: the edit was anchored on markup that lives
  // in KitCheckScreen.jsx, so the replacement silently did nothing, and
  // the check I ran grepped a pattern the import itself satisfied.
  //
  // So this asserts the status is RENDERED, which is the thing a claim
  // about it means. An import is not a feature.
  const console_ = read('components/artist/ConsoleScreen.jsx');
  assert.match(console_, /data-testid="publish-status"/);
  assert.match(console_, /describePublishing\(publish\.phase, \{ error: publish\.error \}\)/);
  assert.match(console_, /canRetry\(publish\.phase\)/);
  assert.match(console_, /isPublishing\(publish\.phase\)/);
  assert.match(console_, /onClick=\{publish\.retry\}/, 'and the retry actually retries');

  // Every import from lib/publishing is used in the markup, so the next
  // silently-dropped edit fails here rather than shipping.
  const imported = console_.match(/import \{([^}]+)\} from '\.\.\/\.\.\/lib\/publishing'/);
  assert.ok(imported, 'the console imports from lib/publishing');
  for (const name of imported[1].split(',').map((n) => n.trim()).filter(Boolean)) {
    const uses = (console_.match(new RegExp(`\\b${name}\\(`, 'g')) || []).length;
    assert.ok(uses > 0, `${name} is imported and never called`);
  }
});

test('the sound deck opens over the console, not inside its scrolling column', () => {
  // The console's own comment: "the composed frame shrinks so the
  // controls below it always fit the phone (a hidden End show button is
  // not acceptable)". The frame's width is calc()'d against a constant
  // reserve, so anything tall placed in that column pushes End show past
  // the bottom of a 390x844 phone instead of shrinking the frame.
  //
  // The first version of this panel was inline in the column, and the
  // e2e suite's press-and-hold then had nothing under the cursor: the
  // button existed, below the fold, and the show never ended. So the
  // deck belongs in a sheet over the console, like FixSheet.
  const src = read('components/artist/ConsoleScreen.jsx');
  const column = src.indexOf('data-testid="console"');
  const deck = src.indexOf('<AudioDeckPanel');
  const dialog = src.lastIndexOf('role="dialog"', deck);
  assert.ok(column > 0 && deck > 0, 'the console column and the deck are both there');
  assert.ok(dialog > column, 'the deck renders inside a dialog over the console, not in its column');
  assert.match(src.slice(dialog, deck), /position: 'absolute'/, 'and that dialog is positioned over it');
});
