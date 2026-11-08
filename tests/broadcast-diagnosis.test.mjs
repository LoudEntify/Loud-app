// tests/broadcast-diagnosis.test.mjs
// ─────────────────────────────────────────────────────────────
// The verdict on a black broadcast, tested against synthetic rows.
//
// This is the only way to be sure the sentence an artist reads is the
// right one, because the situation it describes is not reproducible on
// demand — which is exactly why it went unanswered for six days while I
// asked a person to watch two screens at once.
//
// The distinction every test here protects: the recorder's events are
// the only ones that say anything about what the recorder could see. A
// performer's device logging happily says nothing at all, and conflating
// the two is the confusion this module exists to end.
// ─────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  diagnoseBroadcast, blames, summarise, VERDICTS, POOL_EVENT, EGRESS_ROLE,
} from '../lib/broadcastDiagnosis.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const pool = (trackCount, identities = []) => ({
  role: EGRESS_ROLE, event_type: POOL_EVENT, detail: { trackCount, identities },
});
const performer = (event_type = 'camera_started') => ({ role: 'performer', event_type, detail: {} });

test('no events at all says nothing about the cameras, and says so', () => {
  const d = diagnoseBroadcast([]);
  assert.equal(d.verdict, 'no_events');
  assert.equal(blames(d.verdict), null, 'nothing is blamed yet');
  assert.match(d.meaning, /does not tell us anything about the cameras/);
  assert.equal(diagnoseBroadcast().verdict, 'no_events');
  assert.equal(diagnoseBroadcast(null).verdict, 'no_events');
  assert.equal(diagnoseBroadcast([null, undefined]).verdict, 'no_events');
});

test('the performer logging is not evidence that the recorder ran', () => {
  // The trap this module exists to avoid. Devices logging busily looks
  // like a working show, and tells us nothing about what the browser
  // composing the picture could see.
  const d = diagnoseBroadcast([performer(), performer('mic_level'), performer()]);
  assert.equal(d.verdict, 'no_recorder');
  assert.equal(blames(d.verdict), 'setup');
  assert.equal(d.egressEvents, 0);
  assert.deepEqual(d.otherRoles, ['performer']);
  assert.match(d.meaning, /never joined/);
  // And it points at the two settings that decide it, rather than at the kit.
  assert.match(d.next, /EGRESS_MODE/);
});

test('the recorder running with an empty room is the room, and the phone showing a picture is not a contradiction', () => {
  const d = diagnoseBroadcast([performer(), pool(0), pool(0, [])]);
  assert.equal(d.verdict, 'room_empty');
  assert.equal(blames(d.verdict), 'room');
  assert.equal(d.maxPool, 0);
  assert.equal(d.poolEvents, 2);
  // The sentence has to pre-empt the obvious objection, because the
  // artist WAS looking at a picture on their own phone.
  assert.match(d.meaning, /its own camera, locally/);
});

test('one camera is enough to move the blame downstream', () => {
  const d = diagnoseBroadcast([pool(0), pool(1, ['camfeed-a-wide-1111']), pool(0)]);
  assert.equal(d.verdict, 'room_had_video');
  assert.equal(blames(d.verdict), 'downstream');
  // The MAXIMUM matters, not the latest: a camera that joined and then
  // dropped still proves the room and the cameras worked.
  assert.equal(d.maxPool, 1);
  assert.match(d.line, /1 camera\b/);
  assert.deepEqual(d.identities, ['camfeed-a-wide-1111']);
  assert.match(d.meaning, /not your kit/);
});

test('the count reads as a count, and the identities are gathered across events', () => {
  const d = diagnoseBroadcast([
    pool(1, ['camfeed-a-wide-1111']),
    pool(3, ['camfeed-a-wide-1111', 'camfeed-a-close-2222', 'camfeed-a-side-3333']),
  ]);
  assert.equal(d.maxPool, 3);
  assert.match(d.line, /3 cameras\b/);
  assert.equal(d.identities.length, 3, 'de-duplicated across events');
});

test('a malformed count is ignored rather than read as zero', () => {
  // A row whose detail is missing or wrong must not vote. Treating it as
  // zero would accuse the room on the strength of a logging bug.
  const d = diagnoseBroadcast([
    { role: EGRESS_ROLE, event_type: POOL_EVENT, detail: {} },
    { role: EGRESS_ROLE, event_type: POOL_EVENT },
    pool(2, ['camfeed-a-wide-1111']),
  ]);
  assert.equal(d.verdict, 'room_had_video');
  assert.equal(d.maxPool, 2);

  // And when every row is malformed, the recorder still ran but saw
  // nothing countable — which reads as an empty room, the honest
  // reading of "it was there and reported no tracks".
  const blind = diagnoseBroadcast([{ role: EGRESS_ROLE, event_type: POOL_EVENT, detail: { trackCount: 'lots' } }]);
  assert.equal(blind.verdict, 'room_empty');
  assert.equal(blind.maxPool, 0);
});

test('every verdict carries a line, a meaning and a next step', () => {
  const cases = [
    diagnoseBroadcast([]),
    diagnoseBroadcast([performer()]),
    diagnoseBroadcast([pool(0)]),
    diagnoseBroadcast([pool(2)]),
  ];
  const seen = new Set();
  for (const d of cases) {
    assert.ok(VERDICTS.includes(d.verdict), `${d.verdict} is not a known verdict`);
    seen.add(d.verdict);
    for (const field of ['line', 'meaning', 'next']) {
      assert.ok(d[field] && d[field].length > 0, `${d.verdict} has no ${field}`);
    }
    assert.equal(summarise(d), d.line);
  }
  assert.equal(seen.size, 4, 'all four verdicts are reachable');
  assert.equal(summarise(null), 'No diagnosis yet.');
});

test('lib/broadcastDiagnosis.js names no platform', () => {
  const src = readFileSync(resolve(ROOT, 'lib/broadcastDiagnosis.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const word of ['next/', 'react', 'supabase', 'livekit', 'process.env']) {
    assert.ok(!src.toLowerCase().includes(word.toLowerCase()), `it names ${word}`);
  }
  assert.ok(!/from\s+'/.test(src), 'it imports nothing');
});

test('the recorder still logs the event this reads, so the verdict cannot go stale', () => {
  // If EgressPage stops logging the pool, every show would read as
  // "the recorder never ran" and the diagnosis would be confidently
  // wrong. This is the link between the two halves.
  const egress = readFileSync(resolve(ROOT, 'components/EgressPage.jsx'), 'utf8');
  assert.match(egress, new RegExp(`logHealthEvent\\('${POOL_EVENT}'`), 'the recorder must still log its pool');
  assert.match(egress, /trackCount: tracks\.length/, 'with a count');
  assert.match(egress, /role: 'egress'/, 'under the role this module filters on');
});
