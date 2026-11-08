// tests/shot-direction.test.mjs
// ─────────────────────────────────────────────────────────────
// What an artist may cut to, from the web.
//
// These rules spent their life as useCallbacks in the middle of
// components/LiveDemo.jsx (6,591 lines), where nothing else could use
// them and no test could reach them. That is why the new web console's
// "Director: Auto" chip is dead markup and an artist performing from a
// browser cannot take a manual cut — docs/ONE_JOURNEY.md step 2.
//
// They are lib/shotDirection.js now, and these pin the three judgements
// that matter: a muted camera is not a cut, a clip is not a camera, and
// an auto director with nothing to cut between is suspended rather than
// firing at feeds that are not there.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  shotForDirectPick, tracksForSlot, candidatesForSlot, availableRoles,
  resolveDirectPick, autoDirectorState, DIRECTOR_MODES, DEFAULT_DIRECTOR_MODE,
} from '../lib/shotDirection.js';
import { BROLL_TRACK_NAME } from '../lib/trackSources.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Tracks as LiveKit hands them over, with the identity grammar
// lib/trackSources.js actually parses: `contestant-<slot>` is the
// performer's own camera, `camfeed-<slot>-<role>` is a paired phone.
const cam = (identity, { muted = false, name = 'camera' } = {}) => ({
  participant: { identity },
  publication: { isMuted: muted, trackName: name },
  source: 'camera',
});
const broll = (identity) => cam(identity, { name: BROLL_TRACK_NAME });

test('a direct pick is a cut to the nearest shot for that camera, and never nothing', () => {
  // Picking out of the feed strip is not a separate mechanism: LiveDemo's
  // own comment records that the old untracked 'active-camera' message
  // meant direct picks never reached the flywheel while every other cut
  // did.
  assert.equal(typeof shotForDirectPick('close'), 'string');
  assert.equal(typeof shotForDirectPick('side'), 'string');

  // A full-frame main IS the wide shot when no dedicated wide camera
  // exists, which is why that is the fallback rather than null.
  assert.equal(shotForDirectPick(null), 'wide');
  assert.equal(shotForDirectPick(undefined), 'wide');
  assert.equal(shotForDirectPick('not-a-role'), 'wide');
});

test('a muted camera is not something to cut to', () => {
  const tracks = [
    cam('contestant-a'),
    cam('camfeed-a-close', { muted: true }),
    cam('camfeed-a-side'),
  ];
  const live = tracksForSlot(tracks, 'a');
  assert.equal(live.length, 2);
  assert.ok(!live.some((t) => t.participant.identity === 'camfeed-a-close'));

  // The track exists and the camera is not sending, so offering it as a
  // cut is offering a black frame — docs/CLAUDE.md §5: camera healthy
  // means frames keep arriving, not that it connected.
  assert.ok(!availableRoles(tracks, 'a').includes('close'));
  assert.deepEqual(availableRoles(tracks, 'a').sort(), ['main', 'side']);
});

test('one slot never sees another slot\'s cameras', () => {
  const tracks = [cam('contestant-a'), cam('camfeed-b-close'), cam('contestant-b')];
  assert.equal(tracksForSlot(tracks, 'a').length, 1);
  assert.deepEqual(availableRoles(tracks, 'b').sort(), ['close', 'main']);

  // Any slot letter is a plain lookup: there is nothing special about a and b.
  assert.deepEqual(tracksForSlot([cam('camfeed-c-wide')], 'c').length, 1);
  assert.equal(tracksForSlot(tracks, 'z').length, 0);
});

test('a clip is never offered as a camera', () => {
  // The trap lib/trackSources.js warns about: b-roll published by the
  // performer's OWN participant. Its identity says contestant-a, so
  // anything parsing the identity would call it the artist's face.
  const tracks = [cam('contestant-a'), broll('contestant-a')];

  assert.equal(tracksForSlot(tracks, 'a').length, 2, 'the clip does belong to the slot');
  assert.equal(candidatesForSlot(tracks, 'a').length, 1, 'but the camera picker shows cameras');
  assert.equal(candidatesForSlot(tracks, 'a')[0].publication.trackName, 'camera');
});

test('picking a camera that left fires nothing', () => {
  const tracks = [cam('contestant-a'), cam('camfeed-a-close')];

  const ok = resolveDirectPick(tracks, 'a', 'camfeed-a-close');
  assert.equal(ok.role, 'close');
  assert.ok(ok.track && ok.shotKey && ok.sourceKey);
  assert.match(ok.sourceKey, /#camera$/, 'the target says camera, so it cannot resolve to a clip');

  // A phone that dropped between the strip rendering and the tap landing.
  const gone = resolveDirectPick(tracks, 'a', 'camfeed-a-wide');
  assert.equal(gone.track, null);
  assert.equal(gone.shotKey, null, 'nothing to fire');
  assert.equal(gone.sourceKey, null);

  // And a clip cannot be picked even if its identity is passed.
  const clip = resolveDirectPick([broll('contestant-a')], 'a', 'contestant-a');
  assert.equal(clip.track, null);
});

test('an auto director with nothing to cut between is suspended, not firing', () => {
  const two = [cam('contestant-a'), cam('camfeed-a-close')];
  const one = [cam('contestant-a')];

  assert.equal(autoDirectorState({ mode: 'auto', tracks: two, slot: 'a' }), 'running');
  // One camera is not a failure, it is a single-camera show: the degrade
  // order in docs/CLAUDE.md §4 ends in one camera long before it ends a
  // show. What it must not do is cut, because there is nothing to cut to.
  assert.equal(autoDirectorState({ mode: 'auto', tracks: one, slot: 'a' }), 'suspended');
  assert.equal(autoDirectorState({ mode: 'auto', tracks: [], slot: 'a' }), 'suspended');

  // Manual is the artist's choice and says nothing about the cameras.
  assert.equal(autoDirectorState({ mode: 'manual', tracks: two, slot: 'a' }), 'off');
  assert.equal(autoDirectorState({}), 'suspended');

  assert.ok(DIRECTOR_MODES.includes(DEFAULT_DIRECTOR_MODE));
});

test('lib/shotDirection.js decides, and talks to nothing', () => {
  const src = readFileSync(resolve(ROOT, 'lib/shotDirection.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  // No room, no React, no command building: lib/shotCommands.js and
  // lib/shotTypes.js own those and keep owning them. A second place that
  // builds a command is a second grammar.
  for (const word of ['livekit', 'react', 'useState', 'useCallback', 'buildShotCommand', 'broadcastShotCommand', 'window.', 'document.']) {
    assert.ok(!src.toLowerCase().includes(word.toLowerCase()), `lib/shotDirection.js names ${word}`);
  }

  // It may only import the two modules that hold the grammar and the
  // track vocabulary, so it stays testable without a room.
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['./shotTypes.js', './trackSources.js']);
});
