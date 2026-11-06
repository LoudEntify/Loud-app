// tests/kit-check.test.mjs
// ─────────────────────────────────────────────────────────────
// The camera list is devices, and the Ready band is a verdict.
//
// Both are regressions with a named reporter. Korey, 5 Nov: the camera
// list "just flops the current camera", and Kit Check "leaves the user
// going in resultless circles". The first test below is the one that
// would have failed against the old CAMERAS array; the last ones are the
// circles.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeRig } from '../lib/rig.js';
import {
  cameraTiles, defaultTile, tileDetail, kitBlocker, readyState, FACINGS,
} from '../lib/kitCheck.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const used = (id, role, lastSeen) => ({ id, role, used_at: '2026-11-06T10:00:00Z', last_seen_at: lastSeen });

test('the camera list is the devices in the rig, not the lenses of one phone', () => {
  // Two phones paired and sending, plus the handset: three tiles.
  const now = Date.parse('2026-11-06T10:00:10Z');
  const devices = describeRig({
    pairings: [used('p1', 'wide', '2026-11-06T10:00:09Z'), used('p2', 'close', '2026-11-06T10:00:09Z')],
    ownLive: true,
    now,
  });
  const cameras = [
    { identity: 'camfeed-a-wide-1111', role: 'wide' },
    { identity: 'camfeed-a-close-2222', role: 'close' },
  ];
  const tiles = cameraTiles({ devices, cameras });

  assert.equal(tiles.length, 3, 'three devices, three tiles');
  // The old bug in one assertion: a tile may never be a lens.
  for (const t of tiles) {
    assert.ok(!/^(Main|Side)$/.test(t.chip) || t.own, 'a chip must name a device');
    assert.ok(!('facing' in t), 'a tile has no facing of its own');
  }
  // This phone is first and carries the lens choice, because it is the
  // only phone whose lens can be turned around from this screen.
  assert.equal(tiles[0].own, true);
  assert.deepEqual(tiles[0].facings, FACINGS);
  assert.equal(tiles[1].facings, null);
  assert.equal(tiles[2].facings, null);
});

test("this phone shows its own preview; a paired phone shows that phone's feed", () => {
  const now = Date.parse('2026-11-06T10:00:10Z');
  const devices = describeRig({ pairings: [used('p1', 'wide', '2026-11-06T10:00:09Z')], ownLive: true, now });
  const feed = { identity: 'camfeed-a-wide-1111', role: 'wide', publication: { sid: 'TR_1' } };
  const tiles = cameraTiles({ devices, cameras: [feed] });

  const own = tiles.find((t) => t.own);
  const paired = tiles.find((t) => !t.own);

  // The whole fix: selecting the other phone shows the OTHER PHONE.
  assert.equal(own.showing, 'preview');
  assert.equal(own.feed, null, 'this phone draws locally, not through the room');
  assert.equal(paired.showing, 'feed');
  assert.equal(paired.feed, feed);
  assert.equal(paired.feed.publication.sid, 'TR_1');
});

test('a code nobody has scanned is waiting, and a phone that stopped is offline, and the two never share a sentence', () => {
  const now = Date.parse('2026-11-06T10:05:00Z');
  const devices = describeRig({
    pairings: [
      { id: 'p1', role: 'close', used_at: null },                                  // minted, never scanned
      used('p2', 'side', '2026-11-06T10:00:00Z'),                                  // scanned, long silent
    ],
    ownLive: true,
    now,
  });
  const tiles = cameraTiles({ devices, cameras: [] });
  const waiting = tiles.find((t) => t.role === 'close');
  const offline = tiles.find((t) => t.role === 'side');

  assert.equal(waiting.showing, 'waiting');
  assert.equal(offline.showing, 'offline');
  assert.match(tileDetail(waiting), /not scanned yet/i);
  assert.match(tileDetail(offline), /stopped sending/i);
  assert.notEqual(tileDetail(waiting), tileDetail(offline));
});

test('a tile knows which console button shows it, so the rig and the cuts stop being two vocabularies', () => {
  const now = Date.parse('2026-11-06T10:00:10Z');
  const devices = describeRig({
    pairings: [used('p1', 'wide', '2026-11-06T10:00:09Z'), used('p2', 'close', '2026-11-06T10:00:09Z'), used('p3', 'side', '2026-11-06T10:00:09Z')],
    ownLive: true,
    now,
  });
  const cuts = cameraTiles({ devices, cameras: [] }).map((t) => t.cut);
  // wide → main: the same camera described from two ends.
  assert.ok(cuts.includes('main'));
  assert.ok(cuts.includes('close'));
  assert.ok(cuts.includes('side'));
});

test('the screen opens on this phone, which is the camera that is certainly there', () => {
  const devices = describeRig({ pairings: [], ownLive: false });
  const tiles = cameraTiles({ devices, cameras: [] });
  assert.equal(defaultTile(tiles).own, true);
  assert.equal(defaultTile([]), null);
});

test('every row ends in a result or an action: the Ready band gives one blocker, not a list', () => {
  const devices = describeRig({ pairings: [], ownLive: false, now: Date.now() });
  // Nothing sending and three rows unanswered. The artist is told the
  // first thing to do, not handed four problems to rank.
  const state = readyState({
    devices,
    checks: { connection: { status: 'fix' }, mic_signal: { status: 'skipped' }, dnd: { status: 'fix' } },
  });
  assert.equal(state.ready, false);
  assert.match(state.line, /No camera is sending/);
  assert.equal(state.action, 'Add a camera');
  assert.ok(!state.line.includes(','), 'the blocker is one thing, not a list');
});

test('a measurement still running is not a failure', () => {
  const now = Date.parse('2026-11-06T10:00:10Z');
  const devices = describeRig({ pairings: [used('p1', 'wide', '2026-11-06T10:00:09Z')], ownLive: true, now });
  const checks = { connection: { status: 'checking' }, mic_signal: { status: 'ready' }, charging: { status: 'ready' }, dnd: { status: 'ready' }, headphones: { status: 'ready' } };

  assert.equal(kitBlocker({ devices, checks }), null, 'checking is not a blocker');
  const state = readyState({ devices, checks });
  assert.equal(state.ready, false);
  assert.equal(state.waiting, true);
  assert.equal(state.line, 'Still checking.');
});

test('ready is a verdict, with no count of how many rows passed', () => {
  const now = Date.parse('2026-11-06T10:00:10Z');
  const devices = describeRig({ pairings: [used('p1', 'wide', '2026-11-06T10:00:09Z')], ownLive: true, now });
  const state = readyState({
    devices,
    checks: { connection: { status: 'ready' }, mic_signal: { status: 'ready' }, charging: { status: 'ready' }, dnd: { status: 'ready' }, headphones: { status: 'ready' } },
  });
  assert.deepEqual(state, { ready: true, waiting: false, line: 'Ready to go live.', action: null, blocker: null });
  assert.ok(!/\d/.test(state.line), 'no "4 of 7": an artist in a venue needs a verdict');
});

test('lib/kitCheck.js knows no platform', () => {
  const src = readFileSync(resolve(ROOT, 'lib/kitCheck.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['react', 'expo-', 'livekit', 'window.', 'document.']) {
    assert.ok(!src.toLowerCase().includes(word), `lib/kitCheck.js names ${word}`);
  }
  for (const [, spec] of src.matchAll(/from\s+'([^']+)'/g)) {
    assert.ok(spec.startsWith('./'), `lib/kitCheck.js imports outside lib/: ${spec}`);
  }
});
