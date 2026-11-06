// lib/kitCheck.js
// ─────────────────────────────────────────────────────────────
// What Kit Check shows, as a decision rather than a layout.
//
// ── THE FAULT THIS FIXES ──────────────────────────────────────
// Korey, 5 Nov: "I need the camera list below the feed screen to read as
// the extra camera devices. I noticed that when I click side it just
// flops the current camera."
//
// He is describing this, in native/app/artist/kit-check.js:
//
//   const CAMERAS = [
//     { key: 'camera_main', chip: 'Main', facing: 'back' },
//     { key: 'camera_side', chip: 'Side', facing: 'front' },
//   ];
//
// "Side" was the FRONT LENS OF THE SAME PHONE. The words came off the
// design board; the model behind them did not. So an artist with three
// phones paired saw two chips, neither of which was any of them, and
// pressing one turned their own handset around.
//
// A camera is a DEVICE. Front and back is a setting on a device, and it
// belongs inside that device's own tile — which is also the only place it
// means anything, since you cannot turn someone else's phone around from
// here.
//
// ── WHY THIS IS A SHARED MODULE ───────────────────────────────
// Because the web twin (components/artist/KitCheckScreen.jsx) has to
// agree about it. The same mistake is one copy-paste away on the other
// platform, and "the camera list" is a decision — which devices exist,
// what each one is called, which one is showing, what is stopping the
// show — not a rendering. The rendering differs; none of this does.
//
// Imports only lib/. No React, no React Native, no LiveKit. Same rule as
// lib/rig.js, lib/audio/chain.js and lib/camera/.
// ─────────────────────────────────────────────────────────────

import { CUT_FOR_PAIRING_ROLE } from './rigCameras.js';
import { rigReady } from './rig.js';

/** The front/back control, which exists for this phone and nothing else. */
export const FACINGS = Object.freeze(['back', 'front']);
export const FACING_LABEL = Object.freeze({ back: 'Back', front: 'Front' });

/**
 * One tile per camera device, in rig order (this phone first).
 *
 * `devices` is lib/rig.js describeRig() — the paired phones plus this
 * handset. `cameras` is what is actually publishing in the room, each
 * carrying the `role` its identity encodes. The two are joined by role,
 * which is the only thing they share: a pairing row knows where a phone
 * is standing, a LiveKit publication knows a phone is sending, and the
 * tile needs both to say anything true.
 *
 * Each tile gets:
 *   cut       which console button shows this camera (wide → main)
 *   feed      the publication to render, or null
 *   showing   what to draw: 'preview' for this phone (its own lens,
 *             locally, with no round trip through the room), 'feed' for
 *             a paired phone that is sending, 'waiting' for a code
 *             nobody has scanned, 'offline' for a phone that stopped
 *   facings    the lens choices, only on this phone
 */
export function cameraTiles({ devices = [], cameras = [] } = {}) {
  const byRole = new Map();
  for (const c of cameras) {
    if (!c?.role) continue;
    // A role should publish once. If two claim it, the first wins and
    // the tile stays on one picture rather than flickering between them.
    if (!byRole.has(c.role)) byRole.set(c.role, c);
  }

  return devices.filter((d) => d.publishes).map((d) => {
    const feed = d.own ? null : byRole.get(d.role) || null;
    const showing = d.own
      ? 'preview'
      : d.status === 'waiting' ? 'waiting'
      : feed ? 'feed'
      : 'offline';
    return {
      key: d.own ? 'own' : `device-${d.id}`,
      deviceId: d.id,
      role: d.role,
      cut: CUT_FOR_PAIRING_ROLE[d.role] || null,
      // The chip reads as the device, which is the whole point: "Wide ·
      // this phone", "Close", "Side" — never a lens.
      chip: d.label,
      own: Boolean(d.own),
      status: d.status,
      ready: Boolean(d.ready),
      feed,
      showing,
      facings: d.own ? FACINGS : null,
    };
  });
}

/** The tile to show when a screen opens: this phone, because it is the one that is certainly there. */
export function defaultTile(tiles = []) {
  return tiles.find((t) => t.own) || tiles.find((t) => t.showing === 'feed') || tiles[0] || null;
}

/** The one line under a tile. Never a statement about the build. */
export function tileDetail(tile) {
  if (!tile) return 'No cameras yet.';
  if (tile.own) return 'This phone. Your own picture, before it leaves the handset.';
  switch (tile.showing) {
    case 'feed': return 'Sending. This is what the show will cut to.';
    case 'waiting': return 'Paired, not scanned yet. Open the link on that phone.';
    default: return 'This phone stopped sending. Wake it and reopen the camera page.';
  }
}

/**
 * What is stopping the show, as one sentence, or null when nothing is.
 *
 * The rule from docs/ONE_JOURNEY.md section 6: every row ends in a result
 * or an action, never in a statement about the build. So this returns ONE
 * blocker — the first in the order below — with the action that clears
 * it. A screen that lists six problems has told the artist to go round in
 * a circle deciding which to care about; the pilot's Kit Check told them
 * the next thing to do.
 *
 * `checks` is the screen's own row state, `{ key: { status } }`. A row
 * that is 'checking' is not a blocker: it has not finished, and calling
 * an unfinished measurement a failure is how the screen came to feel
 * like an exam.
 */
export const BLOCKERS = Object.freeze([
  { key: 'rig', line: 'No camera is sending yet.', action: 'Add a camera' },
  { key: 'connection', line: 'Your connection is not strong enough to stream.', action: 'Check connection' },
  { key: 'mic_signal', line: 'Your mic has not been checked.', action: 'Check mic' },
  { key: 'charging', line: 'A device is not plugged in.', action: 'Plug it in' },
  { key: 'dnd', line: 'Calls could interrupt your show.', action: 'Turn on Do Not Disturb' },
  { key: 'headphones', line: 'Your headphones have not been confirmed.', action: 'Confirm headphones' },
]);

export function kitBlocker({ devices = [], checks = {} } = {}) {
  for (const b of BLOCKERS) {
    if (b.key === 'rig') {
      if (!rigReady(devices)) return b;
      continue;
    }
    const status = checks[b.key]?.status;
    if (status === 'fix' || status === 'skipped') return b;
  }
  return null;
}

/**
 * The Ready band: either ready with the button, or the single thing
 * stopping it. Nothing in between, and no count of how many rows passed —
 * an artist standing in a venue needs a verdict.
 */
export function readyState({ devices = [], checks = {} } = {}) {
  const blocker = kitBlocker({ devices, checks });
  const waiting = Object.values(checks).some((c) => c?.status === 'checking');
  if (blocker) return { ready: false, waiting: false, line: blocker.line, action: blocker.action, blocker: blocker.key };
  if (waiting) return { ready: false, waiting: true, line: 'Still checking.', action: null, blocker: null };
  return { ready: true, waiting: false, line: 'Ready to go live.', action: null, blocker: null };
}
