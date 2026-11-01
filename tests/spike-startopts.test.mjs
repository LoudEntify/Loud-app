// The camera's start options must survive the JS wrapper. The wrapper rebuilds
// the object it hands to native, so an option it does not name is dropped in
// silence: that is what swallowed the front camera's flip and the frame-rate
// range on 25 Oct. This test reads the wrapper's own source and fails if the
// runtime sends an option the wrapper would not pass on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const wrapper = fs.readFileSync(new URL('../native/modules/loud-camera/index.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../native/src/spike/runtime.js', import.meta.url), 'utf8');

test('every option the runtime sends to LoudCamera.start is named by the wrapper', () => {
  const call = runtime.match(/LoudCamera\.start\(\{([^}]*)\}/s);
  assert.ok(call, 'the runtime still calls LoudCamera.start with an object');
  const sent = [...call[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  assert.ok(sent.includes('mirrorOutput') && sent.includes('fpsRange'), `the runtime sends ${sent.join(', ')}`);
  const sig = wrapper.match(/export async function start\(\{([^}]*)\}/s);
  assert.ok(sig, 'the wrapper still destructures its options');
  const accepted = [...sig[1].matchAll(/(\w+)\s*=/g)].map((m) => m[1]);
  for (const key of sent) assert.ok(accepted.includes(key), `LoudCamera.start drops "${key}": add it to the wrapper's parameters`);
});

test('the wrapper reports what native was given, so a dropped option shows in the log', () => {
  assert.match(wrapper, /sent: opts/);
});
