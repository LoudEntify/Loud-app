import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RIG_ROLES, RIG_ROLE_NAMES, CAMERA_RIG_ROLES, roleMeta, isCameraRole,
  roleGrants, describeRig, rigReady, rigSummary, EXCLUSIVE_ROLES,
} from '../lib/rig.js';
import { isLivePairing } from '../lib/pairingLiveness.js';

// A rig is the set of devices an artist performs with and the job each
// one holds. There was no such thing before: a phone was paired into a
// camera role and that was the model — nothing said which device was
// the artist's own, nothing could be a control panel, and every show
// started from an empty rig and a fresh code.

test('a control panel sees everything, sends commands, and publishes no picture', () => {
  // One grant served both jobs, so giving a director the data channel
  // would have meant giving every camera on a stand the same.
  const dir = roleGrants('director');
  assert.equal(dir.canPublishVideo, false, 'a laptop on a table is not a camera angle');
  assert.equal(dir.canSubscribe, true, 'it has to see the feeds it is cutting between');
  assert.equal(dir.canPublishData, true, 'and send the shot commands');

  const cam = roleGrants('wide');
  assert.equal(cam.canPublishVideo, true);
  assert.equal(cam.canSubscribe, false, 'a camera on a stand needs to see nothing');
  assert.equal(cam.canPublishData, false);

  // An unknown role gets nothing rather than a camera's rights.
  assert.deepEqual(roleGrants('nonsense'), { canPublishVideo: false, canSubscribe: false, canPublishData: false });
});

test('the control panel is not a camera, and the cuts know it', () => {
  assert.ok(RIG_ROLE_NAMES.includes('director'));
  assert.equal(isCameraRole('director'), false);
  assert.deepEqual(CAMERA_RIG_ROLES, ['wide', 'close', 'side']);
  assert.equal(roleMeta('director').cut, null, 'there is no cut to a control panel');
  assert.equal(roleMeta('wide').cut, 'main', "and the main camera is the console's Main cut");
  assert.deepEqual(EXCLUSIVE_ROLES, ['wide', 'director'], 'two main cameras is two pictures claiming one cut');
});

test("the artist's own phone is in the rig, and holds Main unless a paired phone does", () => {
  // It has no pairing row — there is nothing to pair, it is the handset
  // running the app — so it is described here rather than stored.
  const alone = describeRig({ ownLive: true, isLive: () => true });
  assert.equal(alone.length, 1);
  assert.equal(alone[0].own, true);
  assert.equal(alone[0].role, 'wide', 'one phone is the main camera');
  assert.equal(alone[0].status, 'ready');

  const withMain = describeRig({
    pairings: [{ id: 'p1', role: 'wide', used_at: 'x' }],
    ownLive: true,
    isLive: () => true,
  });
  assert.equal(withMain[0].role, 'side', 'a second camera at the same angle is not a second angle');
  assert.equal(withMain[0].own, true, 'and this phone is still first in the list');
});

test('a code nobody has scanned is waiting, not offline', () => {
  // "Offline" about a phone nobody has picked up is a lie, and it sends
  // an artist looking for a fault that does not exist.
  const now = Date.parse('2026-11-02T20:00:00Z');
  const rig = describeRig({
    pairings: [
      { id: 'p1', role: 'close', used_at: null, expires_at: '2026-11-02T20:05:00Z' },
      { id: 'p2', role: 'side', used_at: '2026-11-01T09:00:00Z', last_seen_at: '2026-11-01T09:00:00Z' },
      { id: 'p3', role: 'wide', used_at: '2026-11-02T19:58:00Z', last_seen_at: '2026-11-02T19:58:00Z' },
    ],
    ownLive: false,
    now,
    isLive: isLivePairing,
  });
  const by = Object.fromEntries(rig.filter((d) => !d.own).map((d) => [d.role, d]));
  assert.equal(by.close.status, 'waiting');
  assert.equal(by.side.status, 'offline', 'a phone last heard from yesterday has stopped');
  assert.equal(by.wide.status, 'ready');
  assert.equal(rigReady(rig), true, 'one camera sending is enough to run a show');
});

test('a revoked device and an unknown role are not in the rig at all', () => {
  const rig = describeRig({
    pairings: [
      { id: 'p1', role: 'close', used_at: 'x', revoked_at: 'y' },
      { id: 'p2', role: 'nonsense', used_at: 'x' },
    ],
    isLive: () => true,
  });
  assert.equal(rig.filter((d) => !d.own).length, 0);
});

test('Kit Check gets a line about the rig, not the rig again', () => {
  // An artist who has already set up should see that it works, not the
  // whole arrangement a second time.
  const ready = describeRig({ pairings: [{ id: 'p1', role: 'close', used_at: 'x' }], ownLive: true, isLive: () => true });
  assert.equal(rigSummary(ready), '2 cameras ready.');

  const waiting = describeRig({
    pairings: [{ id: 'p1', role: 'close', used_at: null, expires_at: '2099-01-01T00:00:00Z' }],
    ownLive: true,
    isLive: () => true,
  });
  assert.match(rigSummary(waiting), /waiting to be scanned/);

  // A control panel is not counted as a camera, because it sends none.
  const withDirector = describeRig({ pairings: [{ id: 'p1', role: 'director', used_at: 'x' }], ownLive: true, isLive: () => true });
  assert.equal(rigSummary(withDirector), '1 camera ready.');
  assert.equal(rigReady(withDirector), true);

  // And a rig of nothing but a control panel cannot run a show.
  const onlyDirector = describeRig({ pairings: [{ id: 'p1', role: 'director', used_at: 'x' }], ownLive: false, isLive: () => true });
  assert.equal(rigReady(onlyDirector), false);
});

test('every role the set-up offers has a label and a note an artist can act on', () => {
  for (const r of RIG_ROLES) {
    assert.ok(r.label && r.label.length < 24, `${r.role} has a short label`);
    assert.ok(r.note && /[.]$/.test(r.note), `${r.role}'s note is a sentence`);
    assert.equal(typeof r.publishes, 'boolean');
  }
});
