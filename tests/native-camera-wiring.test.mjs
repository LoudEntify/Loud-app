// The camera screen must publish through the capturer the device tests paid
// for, not around it. These read the source, because the pieces they guard
// are native: the real proof is a phone, and these stop the silent ways the
// wiring comes undone between builds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const session = read('../native/src/cameraSession.js');
const screen = read('../native/app/camera.js');

test('the camera session starts the tested capturer, with every option named', () => {
  const call = session.match(/LoudCamera\.start\(\{([^}]*)\}/s);
  assert.ok(call, 'the session still starts LoudCamera');
  const sent = [...call[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  for (const key of ['facing', 'fps', 'fpsRange', 'frameSource', 'mirrorOutput']) {
    assert.ok(sent.includes(key), `LoudCamera.start is missing ${key}: ${sent.join(', ')}`);
  }
});

test('the session uses the device-settled rules rather than its own', () => {
  assert.match(session, /facingCapability/, 'the running camera decides what it can do');
  assert.match(session, /resolveFrameRate/, 'the rate is held to what the lens advertises');
  assert.match(session, /mirrorRule/, 'the front camera flip comes from the rule settled on a phone');
  assert.match(session, /orientationPlan/, 'the picture is upright for the show orientation');
  // the capability read must never be what stops a camera publishing (25 Oct)
  const use = session.indexOf('this.capability = facingCapability');
  assert.ok(use > -1, 'the session reads the running camera capability');
  assert.match(session.slice(use, use + 400), /catch/, 'the capability read is wrapped so it cannot stop the camera');
});

test('the preview renders only once the publication and its track exist', () => {
  // LiveKit's VideoTrack reads trackRef.publication.track unguarded; this crashed the
  // spike on 14 Oct when a preview mounted before the publication existed.
  const render = screen.slice(screen.indexOf('VideoTrack trackRef'));
  assert.ok(screen.includes('pub?.track'), 'the screen guards on the publication having a track');
  assert.ok(render.indexOf('publication: pub') > -1, 'it renders the publication it checked');
});

test('one camera owner at a time: the QR scanner only while unpaired', () => {
  const scanner = screen.match(/<CameraView[^>]*>/s);
  assert.ok(scanner, 'the scanner is still there');
  // the scanner lives in the false branch of `pairing ? … : …`
  const i = screen.indexOf('<CameraView');
  const branch = screen.slice(Math.max(0, i - 900), i);
  assert.match(branch, /pairing\s*\n?\s*\?/, 'the scanner shows only when not paired');
});
