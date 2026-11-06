// tests/camera-shared.test.mjs
// ─────────────────────────────────────────────────────────────
// The camera, technique and colour decisions are shared, and this is the
// test that keeps them shared.
//
// They were not missing from the artist journey. They were written,
// tested and working — in native/src/spike/, where only the spike route
// could reach them, while the web imported them across the boundary with
// '../../native/src/spike/proMode.js'. That import is why the web and the
// phone could not be told to behave the same way: one of them owned the
// file.
//
// So: lib/camera/ holds the decisions, both platforms import it the same
// way, and the two assertions below are the ones that would have caught
// the original mistake — nothing in lib/camera may know what platform it
// is on, and nothing outside native/ may reach into native/.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CAMERA = join(ROOT, 'lib', 'camera');

const files = readdirSync(CAMERA).filter((f) => f.endsWith('.js'));

/** Source with comments removed: a header that NAMES what it avoids is the explanation, not the offence. */
const codeOf = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('lib/camera holds the modules the journey needs, not a subset', () => {
  // Named rather than counted, so deleting one is a failure rather than a
  // smaller number nobody reads.
  for (const want of [
    'proMode.js',      // colour: ISO, shutter, white balance, exposure, locks
    'zoomPlan.js',     // camera: device zoom, pan, bop, the step schedule
    'survey.js',       // camera: what a lens can actually do
    'facing.js',       // camera: front/back capability and the mirror rule
    'frameRate.js',
    'region.js',
    'orientation.js',
    'commands.js',     // techniques: the wire protocol the director speaks
    'clock.js',
    'capture.js',
  ]) assert.ok(files.includes(want), `lib/camera/${want} is missing`);
});

test('nothing in lib/camera knows which platform it is on', () => {
  const forbidden = [
    'react-native', 'expo-', 'livekit-client', 'next/',
    'AudioContext', 'document.', 'window.', 'loud-camera',
  ];
  for (const f of files) {
    const code = codeOf(readFileSync(join(CAMERA, f), 'utf8'));
    for (const word of forbidden) {
      assert.ok(!code.includes(word), `lib/camera/${f} names ${word}`);
    }
    // Imports may only reach other shared code, never upward into a platform.
    for (const [, spec] of code.matchAll(/from\s+'([^']+)'/g)) {
      assert.ok(
        spec.startsWith('./') || spec.startsWith('../'),
        `lib/camera/${f} imports a package: ${spec}`,
      );
      assert.ok(
        !spec.includes('native/') && !spec.includes('components/') && !spec.includes('app/'),
        `lib/camera/${f} imports out of shared space: ${spec}`,
      );
    }
  }
});

test('no file outside native/ reaches into native/', () => {
  // The import that started this. Checked across the whole repository
  // rather than the files I happened to touch, because the next one will
  // be written somewhere I am not looking.
  const tracked = execFileSync('git', ['ls-files', '*.js', '*.jsx', '*.mjs'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((p) => !p.startsWith('native/') && !p.startsWith('tests/') && !p.startsWith('scripts/'));

  const offenders = [];
  for (const p of tracked) {
    const code = codeOf(readFileSync(join(ROOT, p), 'utf8'));
    for (const [, spec] of code.matchAll(/from\s+'([^']+)'/g)) {
      if (spec.includes('native/src') || spec.includes('native/modules')) offenders.push(`${p} → ${spec}`);
    }
  }
  assert.deepEqual(offenders, [], `shared or web code importing from native/:\n${offenders.join('\n')}`);
});

test('the one definition rule: orientation is not defined twice', async () => {
  // lib/orientation.js says what an orientation IS (a show is shot
  // portrait or landscape). lib/camera/orientation.js is the device layer
  // — rotation, gravity, mount. Both need the word, so the camera module
  // re-exports it instead of agreeing with it.
  const code = codeOf(readFileSync(join(CAMERA, 'orientation.js'), 'utf8'));
  assert.ok(
    /export\s*\{[^}]*normaliseOrientation[^}]*\}\s*from\s*'\.\.\/orientation\.js'/.test(code),
    'lib/camera/orientation.js must re-export normaliseOrientation, not define it',
  );

  const show = await import('../lib/orientation.js');
  const device = await import('../lib/camera/orientation.js');
  assert.equal(device.normaliseOrientation, show.normaliseOrientation);
  assert.equal(device.DEFAULT_ORIENTATION, show.DEFAULT_ORIENTATION);
  // And the behaviour both sides depended on is unchanged.
  assert.equal(device.normaliseOrientation('landscape'), 'landscape');
  assert.equal(device.normaliseOrientation('nonsense'), 'portrait');
  assert.equal(device.normaliseOrientation(undefined), 'portrait');
});

test('the colour controls are a shared list with ranges, so two platforms cannot offer different knobs', async () => {
  const { PRO_CONTROLS, KELVIN_RANGE, clampPro, proSupport } = await import('../lib/camera/proMode.js');

  for (const c of ['iso', 'shutter', 'wb', 'focus', 'ev']) {
    assert.ok(PRO_CONTROLS.includes(c), `${c} is not a pro control`);
  }
  assert.deepEqual(KELVIN_RANGE, [2000, 10000]);

  // A phone that cannot do manual exposure says so, with a reason, rather
  // than offering a control that silently does nothing.
  const poor = proSupport({ hardwareLevel: 'legacy', manualSensor: false });
  assert.equal(poor.iso.supported, false);
  assert.ok(poor.iso.reason && poor.iso.reason.length > 0, 'an unsupported control must carry a reason');

  // And a value out of range is clamped rather than sent to the camera.
  // A capable phone: manual sensor AND an AE mode of OFF, because manual
  // ISO on a camera that insists on running auto-exposure is not manual.
  const capable = { hardwareLevel: 'full', manualSensor: true, isoRange: [50, 3200], aeModes: ['on', 'off'] };
  assert.equal(proSupport(capable).iso.supported, true);
  const hot = clampPro('iso', 999999, capable);
  assert.ok(hot.value <= 3200, 'ISO must be clamped to what the sensor advertises');
  assert.ok(hot.clamped, 'a clamped value must say it was clamped');
});
