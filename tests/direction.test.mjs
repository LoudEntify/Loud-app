// Direction settings (lib/direction.js): defaults and normalisation, the
// technique gate the auto director obeys, the transition choice (grammar,
// then the artist's list, then taste), the show's look, and the egress's
// per-frame transition log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_DIRECTION, TECHNIQUES, normaliseDirection, directionToRow, directionFromRow, techniqueAllowed, allowedShots, chooseTransition, showLook, TRANSITION_CHOICES, LOOK_CHOICES } from '../lib/direction.js';
import { FakeEgress, transitionProgress } from '../lib/pipeline/egress.js';
import { composeLayout } from '../lib/pipeline/compositor.js';
import { TRANSITION_KEYS } from '../lib/pipeline/transitions.js';

test('normaliseDirection fills every field from the defaults and drops junk', () => {
  const d = normaliseDirection(undefined);
  assert.deepEqual(d, DEFAULT_DIRECTION);
  const n = normaliseDirection({ pace: 'frantic', techniques: { pan: false, nope: true }, transitions: ['whip', 'vhs', 'whip'], look: { lut: 'film', strength: 7 }, operator: { end: true }, extra: 1 });
  assert.equal(n.pace, 'balanced');
  assert.equal(n.techniques.pan, false); assert.equal(n.techniques.cut, true); assert.equal('nope' in n.techniques, false);
  assert.deepEqual(n.transitions, ['cut', 'whip']);          // cut is always on; unknown and duplicates dropped
  assert.deepEqual(n.look, { lut: 'film', strength: 1 });    // strength clamped
  assert.deepEqual(n.operator, { cut: true, prompts: true, end: true });
  assert.equal('extra' in n, false);
});

test('the row mapping round-trips and the catalogues match the modules they come from', () => {
  const row = directionToRow('artist-1', { pace: 'lively' });
  assert.equal(row.artist_id, 'artist-1'); assert.equal(row.settings.pace, 'lively'); assert.ok(row.updated_at);
  assert.equal(directionFromRow(row).pace, 'lively');
  assert.deepEqual(TRANSITION_CHOICES.map((t) => t.key), TRANSITION_KEYS);
  assert.ok(LOOK_CHOICES.some((l) => l.key === 'none') && LOOK_CHOICES.some((l) => l.key === 'film'));
  assert.equal(TECHNIQUES.length, 7);
});

test('techniqueAllowed: a switched-off move is never fired, a shot no switch governs always is', () => {
  const s = { techniques: { pan: false, broll: false } };
  assert.equal(techniqueAllowed(s, 'pan'), false);
  assert.equal(techniqueAllowed(s, 'bRoll'), false); assert.equal(techniqueAllowed(s, 'bRollClip'), false);
  assert.equal(techniqueAllowed(s, 'zoomIn'), true);
  assert.equal(techniqueAllowed(s, 'follow'), true);
  // close-ups off also removes mediumCU (both are "move in"), but the cut switch governs the framings
  assert.equal(techniqueAllowed({ techniques: { closeUp: false } }, 'mediumCU'), false);
  assert.equal(techniqueAllowed({ techniques: { cut: false } }, 'wide'), false);
  const shots = allowedShots(s, ['wide', 'pan', 'bRoll', 'zoomOut']);
  assert.deepEqual(shots, ['wide', 'zoomOut']);
});

test('chooseTransition: the grammar wins (cut-only shots stay cuts), then the artist list, then the taste rules; cues bypass taste', () => {
  const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  // a live zoom allows only a cut
  assert.equal(chooseTransition({ settings: { transitions: ['cut', 'whip'] }, fromShot: 'wide', toShot: 'zoomIn' }).type, 'cut');
  // cuts-only artist
  assert.equal(chooseTransition({ settings: { transitions: ['cut'] }, fromShot: 'wide', toShot: 'closeUp' }).type, 'cut');
  // the artist's list, taste allowing: whip gets a direction, and the direction comes from the dice
  const whip = chooseTransition({ settings: { transitions: ['cut', 'whip'] }, fromShot: 'wide', toShot: 'closeUp', random: seq([0, 0.6]) });
  assert.equal(whip.type, 'whip'); assert.equal(whip.direction, 'up'); assert.equal(whip.durationMs, 260);
  // too soon after the last shot change: back to a cut; a fade would still be fine
  assert.equal(chooseTransition({ settings: { transitions: ['cut', 'whip'] }, fromShot: 'wide', toShot: 'closeUp', sinceLastShotMs: 300 }).type, 'cut');
  assert.equal(chooseTransition({ settings: { transitions: ['cut', 'fade', 'whip'] }, fromShot: 'wide', toShot: 'closeUp', sinceLastShotMs: 300, random: seq([0]) }).type, 'fade');
  // a cue names glitch even though the artist's list lacks it and a transition just ran
  assert.equal(chooseTransition({ settings: { transitions: ['cut'] }, fromShot: 'wide', toShot: 'closeUp', cued: 'glitch', sinceLastTransitionMs: 100 }).type, 'glitch');
  // strength follows the setting
  assert.equal(chooseTransition({ settings: { transitions: ['cut', 'fade'], transitionStrength: 0.5 }, fromShot: 'wide', toShot: 'closeUp' }).strength, 0.5);
});

test('showLook: the show\'s own look wins over the artist\'s default, and both normalise', () => {
  assert.deepEqual(showLook({ look: { lut: 'mono', strength: 0.6 } }, { look: { lut: 'film' } }), { lut: 'mono', strength: 0.6 });
  assert.deepEqual(showLook({ look: null }, { look: { lut: 'film' } }), { lut: 'film', strength: 1 });
  assert.deepEqual(showLook({ look: { lut: 'vhs' } }, {}), { lut: 'none', strength: 1 });
});

test('transitionProgress and the egress log: u runs 0..1 over the transition and is null outside it; a cut logs nothing', async () => {
  const t = { type: 'swipe', direction: 'left', startedAtMs: 1000 };
  assert.equal(transitionProgress(t, 900), null);
  assert.deepEqual(transitionProgress(t, 1160), { type: 'swipe', direction: 'left', u: 0.5 });
  assert.equal(transitionProgress(t, 1400), null);
  assert.equal(transitionProgress({ type: 'nope' }, 0), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dir-egress-'));
  const eg = new FakeEgress({ rootDir: dir });
  await eg.start({ showId: 's', targets: [] });
  const layout = composeLayout({ mode: 'solo' });
  eg.pushFrame({ tMs: 1080, layout, transition: t });
  eg.pushFrame({ tMs: 2000, layout, transition: { type: 'cut' } });
  const lines = fs.readFileSync(path.join(dir, 's', 'recording.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[0].transition, { type: 'swipe', direction: 'left', u: 0.25 });
  assert.equal(lines[1].transition, null);
});
