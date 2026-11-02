// The phone screens, checked without a device.
//
// Three things a bundler will not tell you and a device test finds the
// expensive way:
//
//   1. A component used in JSX that nobody imported. The sign-up screen
//      shipped in the 1 November APK with `<PasswordInput ...>` and no
//      import for it, so sign-up crashed the moment it rendered. Metro
//      bundles that happily; it is a ReferenceError at runtime, on the
//      screen a new person sees first.
//   2. A route pushed at that has no file behind it — a dead end in the
//      journey, which is the other half of what the device test found.
//   3. A screen still built out of the old ad-hoc styles rather than the
//      design system. The allowlist below is the list of screens left to
//      rebuild; it is meant to shrink to nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = resolve(ROOT, 'native/app');

/** Every screen file under native/app. */
function screens(dir = APP, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) screens(full, found);
    else if (entry.endsWith('.js')) found.push(full);
  }
  return found;
}

const FILES = screens();
const rel = (f) => relative(ROOT, f);

// ── 1. Nothing used in JSX is missing an import ──────────────────────────
//
// Deliberately narrow: a capitalised JSX tag that is neither imported,
// declared in the file, nor reached through a namespace (`<Icon.Eye/>`).

const JS_GLOBALS = new Set(['React', 'Fragment', 'Math', 'Object', 'Array', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Promise']);

function declaredNames(src) {
  const names = new Set();
  // import X, { a, b as c } from '...'
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    for (const part of clause.replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim().replace(/^\*\s*/, '');
      if (name && name !== 'import') names.add(name);
    }
  }
  // function Foo(), const Foo = ..., class Foo
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:function|class)\s+([A-Z]\w*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Z]\w*)/g)) names.add(m[1]);
  // Renamed out of an object, anywhere: `({ icon: Glyph }) => ...` in a
  // map callback is a component as much as an import is.
  for (const m of src.matchAll(/\w+\s*:\s*([A-Z]\w*)\s*[,}]/g)) names.add(m[1]);
  // Destructured too: `const [VideoTrack, setVideoTrack] = useState(null)`
  // is how a screen holds a component it loaded lazily.
  for (const m of src.matchAll(/(?:const|let|var)\s*[[{]([^\]}]+)[\]}]\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/[:=]/)[0].trim();
      if (/^[A-Z]\w*$/.test(name)) names.add(name);
    }
  }
  return names;
}

function usedTags(src) {
  const used = new Set();
  for (const m of src.matchAll(/<([A-Z]\w*)(?:\.\w+)?[\s/>]/g)) used.add(m[1]);
  return used;
}

test('every component a screen renders is imported or declared in that screen', () => {
  const missing = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    const have = declaredNames(src);
    for (const tag of usedTags(src)) {
      if (JS_GLOBALS.has(tag) || have.has(tag)) continue;
      missing.push(`${rel(file)}: <${tag}> is used but never imported`);
    }
  }
  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`);
});

// ── 2. Every route pushed at exists ──────────────────────────────────────

/** Expo Router maps a file path to a route; (groups) do not appear in the URL. */
function routeOf(file) {
  let r = rel(file).replace(/^native\/app/, '').replace(/\.js$/, '');
  r = r.replace(/\/\([^)]+\)/g, '').replace(/\/index$/, '') || '/';
  return r;
}
const ROUTES = new Set(FILES.map(routeOf));

/** `/artist/console/[id]` matches `/artist/console/${x}`. */
function routeExists(path) {
  const want = path.split('/').filter(Boolean);
  for (const route of ROUTES) {
    const have = route.split('/').filter(Boolean);
    if (have.length !== want.length) continue;
    if (have.every((seg, i) => seg.startsWith('[') || seg === want[i])) return true;
  }
  return false;
}

test('every route a screen navigates to has a file behind it', () => {
  const dead = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/router\.(?:push|replace|navigate)\(\s*([`'"])([^`'"]*)\1/g)) {
      const raw = m[2];
      if (!raw.startsWith('/')) continue;              // relative, or built from a variable
      // `/artist/console/${id}` is a real route with one filled segment;
      // substitute a stand-in so it matches the [id] file behind it.
      const path = raw.replace(/\$\{[^}]*\}/g, 'x').replace(/\?.*$/, '').replace(/\/$/, '') || '/';
      if (!routeExists(path)) dead.push(`${rel(file)} → ${raw}`);
    }
  }
  assert.deepEqual(dead, [], `\nThese go nowhere:\n${dead.join('\n')}\n`);
});

test('the journey has the screens the designs link together', () => {
  // The spine from design/README.md and the board links: launch, the two
  // ways in, the refusal, the taste picker, and the four tabs.
  for (const r of ['/', '/login', '/signup', '/under-age', '/onboarding/genres', '/discover', '/live', '/create', '/profile']) {
    assert.ok(ROUTES.has(r) || routeExists(r), `the journey needs a screen at ${r}`);
  }
});

// ── 3. The rebuild, as a shrinking list ──────────────────────────────────

/**
 * Screens still built out of native/src/theme.js rather than the design
 * system. Every name removed from here is one screen rebuilt against
 * design/; when the list is empty the old kit can be deleted. Adding a
 * name back is not allowed — that is the blend returning.
 */
const NOT_YET_REBUILT = new Set([
  'native/app/spike/zoom.js',   // the device-zoom spike: a developer tool, deleted with the spike
]);

test('a rebuilt screen never falls back to the old styles', () => {
  const strays = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    const old = /from '[^']*src\/theme'/.test(src) || /from '[^']*src\/PasswordInput'/.test(src);
    if (old && !NOT_YET_REBUILT.has(rel(file))) strays.push(rel(file));
  }
  assert.deepEqual(strays, [], `\nThese were rebuilt but still import the old kit:\n${strays.join('\n')}\n`);
});

test('the not-yet-rebuilt list names real files, and is not growing', () => {
  for (const name of NOT_YET_REBUILT) {
    assert.ok(existsSync(resolve(ROOT, name)), `${name} is on the rebuild list but does not exist — remove it from the list`);
  }
  // A ceiling, so the list can only come down. Lower it as screens land.
  assert.ok(NOT_YET_REBUILT.size <= 1, `the rebuild list has grown to ${NOT_YET_REBUILT.size}`);
});

// ── 4. A name imported from the kit is a name the kit exports ────────────
//
// The check above proves a component was imported; it cannot tell that the
// import resolved to anything. `import { IconButton } from '../src/ui'`
// when the kit never exported it is undefined at render, which React
// reports as "type is invalid" from inside the screen rather than at the
// import, so it is easy to ship.

/** Everything native/src/ui/index.js re-exports, followed one level down. */
function kitExports() {
  const UI = resolve(ROOT, 'native/src/ui');
  const index = readFileSync(join(UI, 'index.js'), 'utf8');
  const names = new Set();
  for (const m of index.matchAll(/export\s+\{([^}]+)\}\s+from\s+'\.\/([\w.]+)'/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  // `export * as Icon from './Icon'` and `export * from './tokens'`
  for (const m of index.matchAll(/export\s+\*\s+as\s+(\w+)\s+from/g)) names.add(m[1]);
  for (const m of index.matchAll(/export\s+\*\s+from\s+'\.\/([\w.]+)'/g)) {
    const src = readFileSync(join(UI, `${m[1].replace(/\.js$/, '')}.js`), 'utf8');
    for (const e of src.matchAll(/export\s+(?:const|function|class|let)\s+(\w+)/g)) names.add(e[1]);
    for (const e of src.matchAll(/export\s+\{([^}]+)\}/g)) {
      for (const part of e[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) names.add(name);
      }
    }
  }
  return names;
}

test('every name a screen imports from the design system is one it exports', () => {
  const kit = kitExports();
  const missing = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+'[^']*src\/ui'/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name && !kit.has(name)) missing.push(`${rel(file)}: the kit does not export ${name}`);
      }
    }
  }
  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`);
});

test('no screen is the website in a frame', () => {
  // The WebView wrapper is gone. Settings, Earnings and Kit check were the
  // three screens that opened loudentify.app inside the app, and a web page
  // inside an app announces itself: the keyboard behaves differently, the
  // back gesture does the wrong thing, and the scroll bounces twice. That
  // is most of what read as a blend of two apps on 1 November.
  assert.ok(!existsSync(resolve(ROOT, 'native/app/web.js')), 'native/app/web.js is back');
  const offenders = [];
  for (const file of FILES) {
    const src = readFileSync(file, 'utf8');
    if (/from 'react-native-webview'/.test(src)) offenders.push(`${rel(file)} imports WebView`);
    if (/['"`]\/web\?/.test(src)) offenders.push(`${rel(file)} pushes a /web route`);
  }
  assert.deepEqual(offenders, [], `\n${offenders.join('\n')}\n`);
});

test('a screen begins with its header and its imports, not with stray markup', () => {
  // A JSX expression at the top level of a module is legal JavaScript, so
  // Metro bundles it, nothing throws, and no other test notices — but it
  // builds an element on every import and it means an edit landed in the
  // wrong place. One did, in live.js, on 1 November: a duplicated card sat
  // above the file's own header comment for an hour.
  const strays = [];
  for (const file of FILES) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
      if (t.startsWith('<')) strays.push(`${rel(file)} starts with markup: ${t.slice(0, 48)}`);
      break;                       // only the first line of real code matters
    }
  }
  assert.deepEqual(strays, [], `\n${strays.join('\n')}\n`);
});

test('a performer can withdraw the training-data consent from Settings', () => {
  // docs/ARCHITECTURE.md: the training-data choice is a separate line at
  // sign-up for performers, "switchable any time, every change audited".
  // The basis is legitimate interests, which only holds while leaving is
  // easy. The table, its policies and its audit trigger have existed since
  // the first migration, and for a fortnight no screen offered it: a
  // performer who agreed at sign-up had no way back. None of the twelve
  // settings boards draws it, so this test is the thing that keeps it.
  const src = readFileSync(resolve(ROOT, 'native/app/settings/account.js'), 'utf8');
  assert.match(src, /consent_records/, 'the consent is read and written where it lives');
  assert.match(src, /training_data/, 'by its own consent type');
  assert.match(src, /<Toggle/, 'and offered as a switch, not as a sentence');
  // Append-only: a change is a new row, never an update of the old one.
  assert.ok(!/consent_records'\)\s*\n?\s*\.update\(/.test(src), 'consent is append-only: insert a new row, never update');
});

test('a performer can connect and disconnect YouTube from Settings', () => {
  // The privacy policy promises an artist can disconnect YouTube in
  // Settings at any time and that we then delete the tokens. For a day
  // the phone could not keep that promise: the WebView wrapper was the
  // only route to the web Settings page, where the Connect and
  // Disconnect buttons live, and removing the wrapper took the whole
  // control with it. An artist whose connection expired — which it does
  // weekly while the Google consent screen is under review — had no way
  // back inside the app. None of the twelve settings boards draws this,
  // so this test is the thing that keeps it.
  const src = readFileSync(resolve(ROOT, 'native/app/settings/youtube.js'), 'utf8');
  assert.match(src, /artist\/youtube\/status/, 'it reads the real connection');
  assert.match(src, /artist\/youtube\/connect/, 'connecting starts the real OAuth flow');
  assert.match(src, /artist\/youtube\/disconnect/, 'and disconnecting deletes the tokens');
  assert.match(src, /Linking\.openURL/, 'consent happens in the system browser, not a web view');
  assert.match(src, /AppState/, 'and coming back re-reads the status without a refresh press');
  const hub = readFileSync(resolve(ROOT, 'native/app/settings/index.js'), 'utf8');
  assert.match(hub, /\/settings\/youtube/, 'and the settings hub has a row that reaches it');
});

test('an artist can get a pairing code for a second camera', () => {
  // DevicesSettings.dc.html draws a QR code inside "Add a camera". The
  // native rebuild kept the instruction and lost the code: the row
  // pointed at /camera, which is the SCANNER — the screen the second
  // phone sits on. Both phones offered to scan, neither offered anything
  // to scan, and there was no way to add a camera from the app at all.
  const src = readFileSync(resolve(ROOT, 'native/app/settings/pair.js'), 'utf8');
  assert.match(src, /camfeed\/pair/, 'it mints a real code');
  assert.match(src, /action: 'invite'/, 'through the invite action, not the legacy shape');
  assert.match(src, /<QRCode/, 'and draws it as a picture');
  assert.match(src, /cam\/pair\?code=/, 'encoding the same URL the web panel encodes');
  assert.match(src, /pair-code/, 'with the code in readable characters too, for a phone that will not scan');
  const devices = readFileSync(resolve(ROOT, 'native/app/settings/devices.js'), 'utf8');
  assert.match(devices, /\/settings\/pair/, 'and "Show the pairing code" reaches it');
  assert.ok(!/title="Show the pairing code"[\s\S]{0,200}router\.push\('\/camera'\)/.test(devices), 'rather than opening the scanner');
});

test('the console is told which cameras are paired', () => {
  // The screen read data.cameras from the first day; the endpoint never
  // sent it, so the fallback — one camera called main — was the only
  // answer there ever was, and three of the four cut buttons could not
  // be pressed on any show.
  const route = readFileSync(resolve(ROOT, 'app/api/artist/shows/[id]/console/route.js'), 'utf8');
  assert.match(route, /camfeed_pairings/, 'the rig is read');
  assert.match(route, /rigCameras\(/, 'and mapped from pairing roles to cuts');
  assert.match(route, /direction_settings/, 'the shot settings too, so a cut switched off says so');
  assert.match(route, /broll_clips/, 'and the clip count, so B-roll knows whether it has anything');
  const screen = readFileSync(resolve(ROOT, 'native/app/artist/console/[id].js'), 'utf8');
  assert.match(screen, /data\?\.cameras \?\? \{ main/, 'an unreadable rig still leaves Main working, rather than refusing every cut');
});

test('a keyboard never covers the field being typed into', () => {
  // Every screen with a field used behavior={ios ? 'padding' : undefined},
  // and undefined means KeyboardAvoidingView does nothing. On Android the
  // keyboard opened straight over the login form: an artist typing a
  // password could not see the field.
  const SCREENS = ['native/app/login.js', 'native/app/signup.js', 'native/app/forgot-password.js', 'native/app/show/[id].js', 'native/app/recording/[id].js'];
  for (const f of SCREENS) {
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    assert.match(src, /behavior=\{KEYBOARD_BEHAVIOR\}/, `${f} uses the shared behaviour`);
    assert.ok(!/'ios' \? 'padding' : undefined/.test(src), `${f} no longer does nothing on Android`);
  }
  const kit = readFileSync(resolve(ROOT, 'native/src/ui/keyboard.js'), 'utf8');
  assert.match(kit, /Platform\.OS === 'ios' \? 'padding' : 'height'/, "and 'height' is the Android answer");
  // 'height' only works while the window itself resizes, so the mode is
  // pinned rather than left to a default that could change under us.
  const app = JSON.parse(readFileSync(resolve(ROOT, 'native/app.json'), 'utf8')).expo;
  assert.equal(app.android.softwareKeyboardLayoutMode, 'resize');
});

test('an artist can answer their own audience', () => {
  // The console polled comments and drew them, and offered no way to
  // reply: somebody asks a question in front of an audience and the
  // person it is addressed to has no field to type into.
  const src = readFileSync(resolve(ROOT, 'native/app/artist/console/[id].js'), 'utf8');
  assert.match(src, /<TextInput/, 'there is somewhere to type');
  assert.match(src, /'\/api\/viewer\/comments', \{ method: 'POST'/, 'and it posts through the same route a viewer uses');
  assert.match(src, /console-comment-send/, 'with a Send the thumb can reach');
});

test('a message on the live screen covers what it sits on', () => {
  // The console drew errors with ErrorPanel, whose surface is twelve per
  // cent of a red: over the four actions and the Go live button, words
  // and buttons printed on top of each other, and the buttons underneath
  // stayed pressable through the sentence saying something had failed.
  const notice = readFileSync(resolve(ROOT, 'native/src/ui/LiveNotice.js'), 'utf8');
  assert.match(notice, /backgroundColor: color\.ink/, 'the panel is opaque');
  assert.match(notice, /pointerEvents=\{shown \? 'auto' : 'none'\}/, 'and swallows the taps aimed at what is under it');
  assert.match(notice, /Animated\.timing/, 'fading rather than blinking into existence over a live show');
  assert.ok(!/setTimeout/.test(notice), 'and it waits for a dismiss: nothing on a live screen times out on its own');
  const console_ = readFileSync(resolve(ROOT, 'native/app/artist/console/[id].js'), 'utf8');
  assert.match(console_, /<LiveNotice message=\{err\}/, 'the console uses it');
  assert.ok(!/<ErrorPanel title="That did not work"/.test(console_), 'in place of the translucent panel');
});

test("the artist's own phone is a camera in their own show", () => {
  // THE reason nothing broadcast. The console never joined the LiveKit
  // room and its "You" tile was a MediaTile with nothing behind it, so a
  // solo artist's room was empty: nothing to compose, nothing to send,
  // and no preview anywhere in the artist app. The compositor was ready
  // and would have rendered a blank page.
  const hook = readFileSync(resolve(ROOT, 'native/src/ownCamera.js'), 'utf8');
  assert.match(hook, /\/api\/performer\/join-show/, 'it takes a token from the route the web performer uses');
  assert.match(hook, /new CameraSession/, 'and publishes with the session the spike proved out');
  assert.ok(!/new AccessToken|addGrant/.test(hook), 'the phone never mints or widens its own grant');
  assert.match(hook, /starting\.current/, 'two sessions against one native camera is the black-preview bug');
  assert.match(hook, /AppState/, 'and a camera Android reclaimed in the background comes back');

  const console_ = readFileSync(resolve(ROOT, 'native/app/artist/console/[id].js'), 'utf8');
  assert.match(console_, /useOwnCamera\(/, 'the console starts it');
  assert.match(console_, /<OwnCameraView/, 'and shows the real picture in the You window');
  assert.ok(!/<MediaTile\s+label="You"/.test(console_), 'in place of the empty tile that stood there');
  assert.match(console_, /ownCamera\.phase === OWN_CAMERA_LIVE \? \{ live: true, own: true \}/, 'and Main counts as a camera once this phone is publishing');

  // VideoTrack reads publication.track without a guard; that crashed the
  // spike on 14 Oct.
  const view = readFileSync(resolve(ROOT, 'native/src/ui/OwnCameraView.js'), 'utf8');
  assert.match(view, /pub\?\.track/, 'nothing renders before the publication and its track exist');
  assert.match(view, /OWN_CAMERA_FAILED/, 'and a camera that is not sending says so rather than showing a black box');
});
test('there are two routes to the rig, and they describe it the same way', () => {
  // Korey's ruling (2 Nov): Settings holds the saved arrangement, Kit
  // Check shows it per show and takes precedence there. An artist who
  // has already set up sees indicators and a way in to change it, not
  // the whole arrangement again before every gig.
  const settings = readFileSync(resolve(ROOT, 'native/app/settings/devices.js'), 'utf8');
  const kit = readFileSync(resolve(ROOT, 'native/app/artist/kit-check.js'), 'utf8');
  for (const [src, where] of [[settings, 'Settings'], [kit, 'Kit Check']]) {
    assert.match(src, /describeRig\(/, `${where} describes the rig from lib/rig.js`);
    assert.match(src, /isLivePairing/, `${where} uses the one definition of a live device`);
  }
  assert.match(settings, /Your rig/, 'Settings is where the arrangement lives');
  assert.match(kit, /kit-rig-edit/, 'and Kit Check has the way in to change it');
  assert.match(kit, /rigSummary\(/, 'showing the state of the rig rather than the rig');
  // Neither screen may keep its own idea of what the roles are.
  assert.ok(!/ROLE_LABEL = \{/.test(settings), 'no second table of role names in Settings');
  const pair = readFileSync(resolve(ROOT, 'native/app/settings/pair.js'), 'utf8');
  assert.match(pair, /RIG_ROLES\.map/, 'and the pairing screen offers the roles the model defines');
});

test('a control panel is paired like a camera and granted nothing like one', () => {
  // One grant served both jobs. Giving a director the data channel it
  // needs would have meant giving every camera on a stand the same.
  const pairing = readFileSync(resolve(ROOT, 'lib/camfeedPairing.js'), 'utf8');
  assert.match(pairing, /roleGrants\(role\)/, 'the grant is decided by the job');
  assert.match(pairing, /CAMERA_ROLES = RIG_ROLE_NAMES/, 'and the roles the route accepts come from the model');
  const pair = readFileSync(resolve(ROOT, 'native/app/settings/pair.js'), 'utf8');
  assert.match(pair, /It sends no picture; it sees yours/, 'the screen says what a control panel does');
});

test('an artist can put a clip or a track in their library from the phone', () => {
  // Studio Library listed and deleted and could not upload: picking a
  // file needed a document picker the build did not carry, so every
  // clip and backing track had to come from a laptop, and an artist
  // standing in a venue could not add one.
  const up = readFileSync(resolve(ROOT, 'native/src/upload.js'), 'utf8');
  assert.match(up, /upload-url/, 'it asks the server where to put the file');
  assert.match(up, /\/register/, 'and registers it afterwards');
  assert.match(up, /XMLHttpRequest/, 'with XHR, because fetch has no upload progress');
  assert.match(up, /xhr\.timeout/, 'and a timeout, so a dead transfer is a stated failure rather than a spinner');
  assert.ok(!/fetch\(/.test(up), 'the big transfer never goes through our own server');

  const studio = readFileSync(resolve(ROOT, 'native/app/settings/studio.js'), 'utf8');
  assert.match(studio, /studio-upload-/, 'the board\'s Upload button is drawn now');
  assert.match(studio, /startUpload\('track'\)|startUpload\(tab === 'tracks' \? 'track' : 'broll'\)/, 'for both tracks and B-roll');
  assert.ok(!/Uploading from the phone is not in this build/.test(studio), 'and the line saying it could not is gone');
});

test('the performing phone sends sound, and says so when it cannot', () => {
  // The capturer is video only and nothing ever enabled the microphone,
  // so a show would have gone out silent: a music platform broadcasting
  // a picture of someone playing and no playing.
  const cam = readFileSync(resolve(ROOT, 'native/src/cameraSession.js'), 'utf8');
  assert.match(cam, /setMicrophoneEnabled\(true\)/, 'the microphone is published');
  assert.match(cam, /this\.withAudio = Boolean\(withAudio\)/, 'and only by the phone told to carry the sound');
  assert.match(cam, /withAudio = false/, 'a paired camera on a stand is silent by default: room noise and echo');
  // A failure must never take the camera down with it.
  assert.match(cam, /Your microphone is not going out/, 'a mic that fails is a warning, not the end of the show');

  const own = readFileSync(resolve(ROOT, 'native/src/ownCamera.js'), 'utf8');
  assert.match(own, /withAudio: true/, "the artist's own phone carries the sound");
  const console_ = readFileSync(resolve(ROOT, 'native/app/artist/console/[id].js'), 'utf8');
  assert.match(console_, /NO SOUND/, 'and the console says so while the artist can still fix it');
});
