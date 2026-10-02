// The modules the native app imports from lib/ must load with no window,
// no document and no 'server-only'. This runs in plain node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('shared modules are DOM-free and importable by the native app', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const mods = ['../lib/design/tokens.js', '../lib/alignment.js', '../lib/guestPreview.js', '../lib/signupRules.js', '../lib/metering.js', '../lib/pipeline/compositor.js', '../lib/schedule.js', '../lib/pipeline/stageRequests.js', '../lib/player/layout.js'];
  for (const m of mods) { const mod = await import(m); assert.ok(Object.keys(mod).length > 0, m); }
  const { color, playerFrame } = await import('../lib/design/tokens.js');
  assert.equal(color.ink, '#011627'); assert.equal(playerFrame.min.w, 200);
});
