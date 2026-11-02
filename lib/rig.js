// lib/rig.js — the artist's rig: which device does what.
//
// ── WHAT A RIG IS ─────────────────────────────────────────────
// A rig is the set of devices an artist performs with, and the job each
// one holds. Until now there was no such thing. A phone was paired into
// a camera role and that was the whole model: nothing said which device
// was the artist's own, nothing could be a control panel, and there was
// no saved arrangement to come back to — every show started from an
// empty rig and a fresh code.
//
// Korey's ruling (2 Nov) sets two routes to the same rig:
//
//   SETTINGS    the saved rig. Set it up once: which phone is the main
//               camera, which is the control panel for a human
//               director, and what the rest are. It persists until the
//               artist edits it.
//   KIT CHECK   per show, and it WINS. An artist who has set up in
//               Settings sees indicators that each device is working
//               and a button to edit; only an artist who wants to
//               change something sees the whole arrangement.
//
// ── THE ARTIST'S OWN PHONE ────────────────────────────────────
// It is a device in the rig like any other, and it holds `main` unless
// the artist hands that to a paired phone. It has no pairing row —
// there is nothing to pair, it is the handset running the app — so it
// is represented here rather than in the database, and the console
// merges it with what the server knows.
//
// ── ROLE NAMES ────────────────────────────────────────────────
// The stored values are the ones camfeed_pairings already holds:
// 'wide', 'close', 'side', plus 'director'. 'wide' is shown as "Main"
// because that is what the console's cut is called (lib/liveCuts.js)
// and an artist should not have to translate. Renaming the stored value
// would mean a migration and three call sites for a word.

/** Every job a device can hold, in the order the set-up offers them. */
export const RIG_ROLES = Object.freeze([
  {
    role: 'wide',
    label: 'Main camera',
    note: 'The one you perform to: the whole stage, from the back.',
    cut: 'main',
    publishes: true,
  },
  {
    role: 'close',
    label: 'Close camera',
    note: 'Tight on your hands or your face.',
    cut: 'close',
    publishes: true,
  },
  {
    role: 'side',
    label: 'Side camera',
    note: 'Off to one side of you.',
    cut: 'side',
    publishes: true,
  },
  {
    role: 'director',
    label: 'Control panel',
    note: 'A screen someone else runs your show from. It sends no picture.',
    cut: null,
    publishes: false,
  },
]);

export const RIG_ROLE_NAMES = RIG_ROLES.map((r) => r.role);
/** The roles that put a picture in the show. A control panel does not. */
export const CAMERA_RIG_ROLES = RIG_ROLES.filter((r) => r.publishes).map((r) => r.role);
export const roleMeta = (role) => RIG_ROLES.find((r) => r.role === role) || null;
export const isCameraRole = (role) => CAMERA_RIG_ROLES.includes(role);

/** One role per job: two main cameras is two pictures claiming one cut. */
export const EXCLUSIVE_ROLES = Object.freeze(['wide', 'director']);

/**
 * What a device holding this role may do in the room.
 *
 * A camera publishes video and does not need to see anything: it sits
 * on a stand. A control panel is the reverse — it must see every feed
 * and send shot commands, and must never publish a picture, because a
 * laptop on a table is not a camera angle. Least access, by role.
 */
export function roleGrants(role) {
  if (role === 'director') return { canPublishVideo: false, canSubscribe: true, canPublishData: true };
  if (isCameraRole(role)) return { canPublishVideo: true, canSubscribe: false, canPublishData: false };
  return { canPublishVideo: false, canSubscribe: false, canPublishData: false };
}

/**
 * The rig as the artist should see it: this phone, then every paired
 * device, each with its job and whether it is working.
 *
 * `own` is the handset running the app. It is always present and always
 * a camera; it takes `wide` unless a paired device already holds it,
 * and `side` otherwise, because a second camera pointed at the same
 * angle as the first is not a second angle.
 */
export function describeRig({ pairings = [], ownLive = false, now = Date.now(), isLive } = {}) {
  const live = isLive || (() => true);
  const devices = [];
  const taken = new Set();
  for (const p of pairings) {
    if (!p || p.revoked_at) continue;
    const meta = roleMeta(p.role);
    if (!meta) continue;
    const ready = Boolean(p.used_at) && live(p, now);
    devices.push({
      id: p.id,
      role: p.role,
      label: meta.label,
      publishes: meta.publishes,
      paired: Boolean(p.used_at),
      ready,
      own: false,
      // An unscanned code is a device that does not exist yet, and
      // saying "offline" about a phone nobody has picked up is a lie.
      status: !p.used_at ? 'waiting' : ready ? 'ready' : 'offline',
    });
    if (p.used_at) taken.add(p.role);
  }
  const ownRole = taken.has('wide') ? 'side' : 'wide';
  devices.unshift({
    id: 'own',
    role: ownRole,
    label: `${roleMeta(ownRole).label} · this phone`,
    publishes: true,
    paired: true,
    ready: Boolean(ownLive),
    own: true,
    status: ownLive ? 'ready' : 'offline',
  });
  return devices;
}

/** Is the rig good enough to run a show: at least one camera sending. */
export function rigReady(devices = []) {
  return devices.some((d) => d.publishes && d.ready);
}

/**
 * One line for Kit Check, which shows the state of the rig rather than
 * the rig itself: an artist who has already set up should see that it
 * works, not the whole arrangement again.
 */
export function rigSummary(devices = []) {
  const cameras = devices.filter((d) => d.publishes);
  const ready = cameras.filter((d) => d.ready).length;
  const waiting = cameras.filter((d) => d.status === 'waiting').length;
  if (!cameras.length) return 'No cameras yet.';
  if (ready === cameras.length) return `${ready} camera${ready === 1 ? '' : 's'} ready.`;
  if (waiting) return `${ready} of ${cameras.length} ready, ${waiting} waiting to be scanned.`;
  return `${ready} of ${cameras.length} cameras ready.`;
}
