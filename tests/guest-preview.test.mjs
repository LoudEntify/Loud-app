import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreviewMeter, PREVIEW_LIMIT_MS, PREVIEW_CHIP_AT_MS } from '../lib/guestPreview.js';

test('counts only while playing, across videos, chip at 50s, sign-up at 60s', () => {
  let t = 0;
  const m = new PreviewMeter({ now: () => t });
  m.onPlayerState('playing'); t = 20_000;
  m.onPlayerState('paused'); t = 40_000;             // pause does not count
  assert.equal(m.totalMs(), 20_000);
  m.onPlayerState('playing'); t = 60_000;            // a different video, same device
  assert.equal(m.totalMs(), 40_000);
  assert.equal(m.chipDue(), false);
  t = 72_000; assert.equal(m.totalMs(), 52_000); assert.equal(m.chipDue(), true); assert.equal(m.expired(), false);
  t = 80_000; assert.equal(m.expired(), true); assert.equal(m.remainingMs(), 0);
  assert.equal(PREVIEW_CHIP_AT_MS < PREVIEW_LIMIT_MS, true);
});

test('a returning device resumes from its saved total', () => {
  const m = new PreviewMeter({ watchedMs: 59_000, now: () => 0 });
  assert.equal(m.expired(), false);
  const m2 = new PreviewMeter({ watchedMs: 60_000, now: () => 0 });
  assert.equal(m2.expired(), true);
});
