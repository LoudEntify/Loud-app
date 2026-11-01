// Every image native/app.json names has to exist on disk.
//
// Why this test exists: the Android build failed on staging with
// "resource drawable/splashscreen_logo not found". The splash plugin was
// configured with a background colour and a resize mode but no image, and
// the generated values.xml referenced a drawable that was therefore never
// written. Nothing in the JS tests touches app.json's asset paths, so the
// first sign of it was an eleven-minute Gradle failure. This is the cheap
// version of that check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'native');
const config = JSON.parse(readFileSync(resolve(NATIVE, 'app.json'), 'utf8')).expo;

/** Every './assets/…' path anywhere in the config, with the key that held it. */
function assetPaths(node, trail = 'expo', found = []) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) found.push([trail, node]);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => assetPaths(v, `${trail}[${i}]`, found));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) assetPaths(v, `${trail}.${k}`, found);
  }
  return found;
}

test('every asset path in native/app.json points at a file that exists', () => {
  const paths = assetPaths(config);
  assert.ok(paths.length > 0, 'app.json names no assets at all, which is how the splash drawable went missing');
  for (const [where, p] of paths) {
    assert.ok(existsSync(resolve(NATIVE, p)), `${where} names ${p}, which is not in the repo`);
  }
});

test('the three images Android needs are configured, not left to a default', () => {
  assert.ok(config.icon, 'expo.icon: the launcher icon');
  assert.ok(config.android?.adaptiveIcon?.foregroundImage, 'android.adaptiveIcon.foregroundImage');
  const splash = (config.plugins || []).find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
  assert.ok(splash, 'the expo-splash-screen plugin');
  assert.ok(splash[1]?.image, 'expo-splash-screen needs an image, or the build references a drawable it never writes');
});
