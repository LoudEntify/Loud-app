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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE = resolve(ROOT, 'native');
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

test('the app wears its own mark, not a stand-in letter', () => {
  // The launch screen drew a teal L out of two rectangles and set the
  // word "Loudentify" in type beneath it — the name twice, in two
  // letterforms, neither of them the brand — while the real artwork sat
  // unused in public/logo. The installed app wore the same L as its
  // icon.
  const mark = readFileSync(resolve(NATIVE, 'assets/wordmark-on-dark.png'));
  assert.ok(mark.length > 10_000, 'the real artwork ships with the app');
  const launch = readFileSync(resolve(NATIVE, 'app/index.js'), 'utf8');
  assert.match(launch, /<Wordmark/, 'and the first screen shows it');
  assert.ok(!/backgroundColor: color\.teal/.test(launch), 'the hand-drawn L is gone');
  assert.ok(!/>Loudentify</.test(launch), 'and the name is not also set in type beside it');

  // The icon is the whale in the O: square, so it survives Android's
  // round and squircle masks, where a 4.56:1 wordmark could not.
  for (const [file, label] of [['assets/icon.png', 'app icon'], ['assets/adaptive-icon.png', 'adaptive icon']]) {
    const png = readFileSync(resolve(NATIVE, file));
    const w = png.readUInt32BE(16); const h = png.readUInt32BE(20);
    assert.equal(w, 1024, `${label} is 1024 wide`);
    assert.equal(h, 1024, `${label} is square`);
  }
});

test('every place a logo belongs shows the logo, not the name in type', () => {
  // Launch was the obvious one. Login, signup and forgot-password each
  // set "Loudentify" in 17 or 19 point type exactly where a mark goes —
  // over the sheet and at the head of it — which is a label standing in
  // for artwork that ships with the app.
  const SPOTS = ['app/index.js', 'app/login.js', 'app/signup.js', 'app/forgot-password.js'];
  for (const file of SPOTS) {
    const src = readFileSync(resolve(NATIVE, file), 'utf8');
    assert.match(src, /<Wordmark/, `${file} shows the mark`);
    assert.ok(!/>Loudentify</.test(src), `${file} does not also set the name in type where the mark sits`);
  }
  // On ink it must be the porcelain file: onDark is the default, so the
  // mistake to guard is a light-sheet mark left on the default.
  for (const file of ['app/login.js', 'app/signup.js', 'app/forgot-password.js']) {
    const src = readFileSync(resolve(NATIVE, file), 'utf8');
    assert.match(src, /<Wordmark[^/]*onDark=\{false\}/, `${file}'s sheet is light, so the mark on it must be the ink one`);
  }
  // The mark is never asked for a size below the floor where the signal
  // arc stops resolving into three bands.
  const kit = readFileSync(resolve(NATIVE, 'src/ui/Wordmark.js'), 'utf8');
  assert.match(kit, /WORDMARK_MIN_HEIGHT = 32/);
  assert.match(kit, /Math\.max\(WORDMARK_MIN_HEIGHT, height\)/, 'and the floor is enforced, not just documented');
  assert.ok(!/width\s*=/.test(kit.split('export function Wordmark')[1] || ''), 'no width prop, so the mark cannot be stretched');
});

test('the database tool is pinned, and its config uses keys it still accepts', () => {
  // On 2 Nov the Supabase CLI released a version that rejects
  // [inbucket], and the staging deploy went red with no change of ours.
  // Mid-pilot, a production tool changing under a show is the failure
  // worth preventing, not the key.
  const config = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
  assert.ok(!/^\[inbucket\]/m.test(config), 'the dropped key is gone');
  assert.match(config, /^\[local_smtp\]/m, 'replaced by the one the CLI takes');
  for (const wf of ['.github/workflows/staging.yml', '.github/workflows/promote.yml']) {
    const src = readFileSync(resolve(ROOT, wf), 'utf8');
    assert.ok(!/version: latest/.test(src), `${wf} does not take whatever released today`);
    assert.match(src, /version: \d+\.\d+\.\d+/, `${wf} pins a version`);
  }
});
