// lib/broadcastDiagnosis.js
// ─────────────────────────────────────────────────────────────
// "Why was the broadcast black?" — answered from what the RECORDER
// logged, rather than from what anyone was watching at the time.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────
// Since 2 November the broadcast has reached YouTube as audio over a
// black frame. I built the console's full-screen stage to split the
// question — picture on the console and black on YouTube means the
// compositor; black on both means the room — and then asked Korey the
// same question five times across six days.
//
// That was the wrong move twice over. docs/CLAUDE.md §1 says to
// instrument before fixing and never to build on an unconfirmed
// hypothesis; and Korey is one person who cannot watch his own phone and
// a YouTube page at the same moment while performing. Asking him to be
// the instrument was asking him to do the one thing the situation makes
// impossible.
//
// The answer was already being recorded. components/EgressPage.jsx — the
// headless browser LiveKit loads to compose the picture — logs
// `egress_track_pool_changed` with the number of tracks it is subscribed
// to and whose they are. That single number settles it:
//
//   no egress events at all  the recorder never ran. The compositor was
//                            never asked for a picture, so EGRESS_MODE
//                            or the template URL is the fault, not the
//                            room and not the cameras.
//   events, pool always 0    the recorder ran and the room had nothing
//                            to show it. The cameras are not publishing
//                            into the room the recorder joined.
//   pool reached 1 or more   the recorder had pictures to compose. A
//                            black frame downstream of that is the
//                            compositor, the RTMP push or YouTube's
//                            ingest — not the room.
//
// ── WHAT THIS MODULE IS ───────────────────────────────────────
// A pure function over health_events rows. No database, no Next.js, so
// the verdicts can be tested against synthetic rows — which is the only
// way to be sure the sentence an artist reads is the right one, since
// the situation it describes is one we cannot reproduce on demand.
//
// Imports nothing, names no platform.
// ─────────────────────────────────────────────────────────────

/** The event the recorder logs whenever its subscription set changes. */
export const POOL_EVENT = 'egress_track_pool_changed';
export const RESELECT_EVENT = 'egress_reselect';
export const EGRESS_ROLE = 'egress';

export const VERDICTS = Object.freeze([
  'no_recorder',
  'room_empty',
  'room_had_video',
  'no_events',
]);

const isEgress = (row) => row?.role === EGRESS_ROLE;
const poolCount = (row) => {
  const n = Number(row?.detail?.trackCount);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The verdict for one show's room, from its health events.
 *
 * `rows` are health_events for this room, any order, any role. Only the
 * recorder's own events decide the verdict — a performer's device
 * logging happily tells us nothing about what the recorder could see,
 * which is the whole confusion this answers.
 */
export function diagnoseBroadcast(rows = []) {
  const all = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const egress = all.filter(isEgress);
  const pools = egress.filter((r) => r.event_type === POOL_EVENT);
  const counts = pools.map(poolCount).filter((n) => n !== null);
  const maxPool = counts.length ? Math.max(...counts) : 0;

  const identities = new Set();
  for (const r of pools) {
    for (const id of r?.detail?.identities || []) if (typeof id === 'string') identities.add(id);
  }

  const base = {
    egressEvents: egress.length,
    poolEvents: pools.length,
    maxPool,
    identities: [...identities],
    otherRoles: [...new Set(all.filter((r) => !isEgress(r)).map((r) => r.role).filter(Boolean))],
    reselects: egress.filter((r) => r.event_type === RESELECT_EVENT).length,
  };

  // Nothing at all: not even the performer's own device logged. The show
  // may never have started, so this is not a statement about the
  // recorder.
  if (!all.length) {
    return {
      ...base,
      verdict: 'no_events',
      line: 'Nothing was recorded about this show at all.',
      meaning: 'Either it never went live, or nothing could reach our logging. This does not tell us anything about the cameras yet.',
      next: 'Go live once more and check here straight afterwards.',
    };
  }

  // The performer's device logged and the recorder did not: the headless
  // browser never ran, so the compositor was never asked for a picture.
  // Nothing about the cameras is implicated.
  if (!egress.length) {
    return {
      ...base,
      verdict: 'no_recorder',
      line: 'The recorder never ran.',
      meaning: 'Your devices were logging, but the browser that composes the picture for YouTube never joined. So nothing ever composed a frame — this is the broadcast setup, not your cameras.',
      next: 'EGRESS_MODE and EGRESS_TEMPLATE_BASE_URL are what decide whether the recorder is started and where it loads from.',
    };
  }

  // The recorder ran and never had a single video track. The cameras are
  // not publishing into the room it joined.
  if (maxPool === 0) {
    return {
      ...base,
      verdict: 'room_empty',
      line: 'The recorder ran, and the room was empty of video.',
      meaning: 'The browser that composes the picture joined and never saw a single camera. So it had nothing to compose, and a black frame is exactly what it would send. Your phone may well have been showing you a picture — that is its own camera, locally, which is not the same as publishing into the room.',
      next: 'The cameras and the recorder have to be in the same room: that is the token each one is minted for.',
    };
  }

  return {
    ...base,
    verdict: 'room_had_video',
    line: `The recorder saw ${maxPool} camera${maxPool === 1 ? '' : 's'} and had pictures to compose.`,
    meaning: 'So the room and the cameras were working. A black frame on YouTube after this point is the composing, the push to YouTube, or YouTube’s own ingest — not your kit.',
    next: 'The next thing to read is the egress result itself rather than these events.',
  };
}

/** Which of the two halves of the question this verdict answers. */
export function blames(verdict) {
  switch (verdict) {
    case 'room_empty': return 'room';
    case 'room_had_video': return 'downstream';
    case 'no_recorder': return 'setup';
    default: return null;
  }
}

/**
 * One line for a screen, short enough to sit under a heading.
 *
 * Deliberately not a summary of the numbers: an artist reading this has
 * just come off a show that did not work, and what they need is which
 * half of the system to stop suspecting.
 */
export function summarise(diagnosis) {
  if (!diagnosis) return 'No diagnosis yet.';
  return diagnosis.line;
}
