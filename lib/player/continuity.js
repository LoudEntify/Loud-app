// lib/player/continuity.js — keeping a viewer watching, without asking them
// to do anything.
//
// The pilot's viewer had a "tap to reconnect audio" button. It existed
// because a browser will not start sound without a gesture, and because two
// separate WebRTC tracks could lose audio while the picture stayed. YouTube
// delivery removes the second problem (one composed stream: the sound
// cannot go missing on its own) and leaves the first, which is a browser
// rule and not ours to repeal.
//
// So the job splits in two, and this file holds the thinking for both:
//
//   soundPolicy()  the first unmute. A viewer who tapped a show inside the
//                  app has already made the gesture the browser wants, and
//                  in a single-page app that activation is still good when
//                  the player mounts, so we unmute at once and nobody is
//                  asked anything. A viewer who opened a link cold has made
//                  no gesture, so sound waits for their first touch
//                  anywhere, with a small chip saying so. Never a modal,
//                  never a button in the way of the picture.
//
//   watchdogStep() everything after that. A stall, a pause nobody asked
//                  for, a tab coming back from the background, a viewer who
//                  has drifted behind the live edge: each has an action the
//                  player can take itself. The rule is to act, not to ask,
//                  and to stop acting when acting is not helping.
//
// Pure functions over samples, so the awkward cases can be tested rather
// than argued about.
//
// PRD rows 139, 143. S&I: Real-time media.

/** How far behind the live edge a viewer may drift before we pull them back (ms). */
export const LIVE_DRIFT_MS = 20_000;
/** A buffering spell longer than this is a stall, not a hiccup (ms). */
export const STALL_MS = 8_000;
/** Never act more often than this: a player fighting a watchdog recovers from neither (ms). */
export const ACTION_GAP_MS = 5_000;
/** This many recoveries inside the window means the nudges are not working. */
export const GIVE_UP_AFTER = 3;
export const GIVE_UP_WINDOW_MS = 60_000;

export const ACTIONS = ['none', 'play', 'seekLive', 'reload'];

/**
 * What to do about the sound, given how the viewer arrived.
 *
 * `hasUserActivation` is the browser's own answer (navigator.userActivation
 * .hasBeenActive) when it has one: true means a gesture has happened in this
 * document, which is exactly what an autoplay policy asks for.
 *
 * Returns { startMuted, unmuteNow, prompt, reason }:
 *   startMuted  always true. The picture must never wait for a decision
 *               about sound; a muted autoplay is allowed everywhere.
 *   unmuteNow   unmute as soon as the player is playing.
 *   prompt      show the quiet "Tap for sound" chip, because sound is
 *               waiting for a touch we have not had yet.
 */
export function soundPolicy({ hasUserActivation = false, prefersMuted = false } = {}) {
  if (prefersMuted) return { startMuted: true, unmuteNow: false, prompt: false, reason: 'this viewer chose muted' };
  if (hasUserActivation) return { startMuted: true, unmuteNow: true, prompt: false, reason: 'they tapped to get here, so the browser will allow sound' };
  return { startMuted: true, unmuteNow: true, prompt: true, reason: 'opened cold with no gesture: try anyway, and ask for a touch only if the browser refuses' };
}

/**
 * One step of the watchdog.
 *
 * `sample` is what the player can tell us now:
 *   { state, positionMs, liveEdgeMs, atMs, visible, userPaused }
 * `memory` is what the last step left behind (pass {} the first time).
 *
 * Returns { action, reason, memory } where action is one of ACTIONS. The
 * caller performs the action; everything else here is bookkeeping.
 */
export function watchdogStep(sample, memory = {}) {
  const now = Number.isFinite(sample?.atMs) ? sample.atMs : Date.now();
  const m = {
    bufferingSince: memory.bufferingSince ?? null,
    lastActionAt: memory.lastActionAt ?? 0,
    recoveries: Array.isArray(memory.recoveries) ? memory.recoveries.filter((t) => now - t < GIVE_UP_WINDOW_MS) : [],
    wasHidden: memory.wasHidden ?? false,
    gaveUp: memory.gaveUp ?? false,
  };
  const keep = (action, reason, extra = {}) => ({ action, reason, memory: { ...m, ...extra } });
  const act = (action, reason, extra = {}) => ({
    action, reason,
    memory: { ...m, lastActionAt: now, recoveries: [...m.recoveries, now], bufferingSince: null, ...extra },
  });

  // A viewer who went away and came back is the commonest case of all, and the
  // one where asking would be most insulting: resume and put them back on the
  // live edge, because a live show they are 90 seconds behind is not the show.
  const visible = sample?.visible !== false;
  if (!visible) return keep('none', 'the tab is in the background; nothing to do until it returns', { wasHidden: true });
  if (m.wasHidden) return act('seekLive', 'back from the background: resume at the live edge', { wasHidden: false });

  // A pause the viewer asked for is theirs to undo. Anything else that is
  // paused is the browser or the network, and is ours.
  if (sample?.userPaused) return keep('none', 'the viewer paused it themselves');

  if (m.gaveUp) return keep('none', 'already reported: nudging is not helping');
  if (now - m.lastActionAt < ACTION_GAP_MS) return keep('none', 'just acted; give the player a moment');

  // Too many recoveries in a minute means the nudges are not working: one
  // reload of the player, then stop and let the screen say something honest.
  if (m.recoveries.length >= GIVE_UP_AFTER) {
    return { action: 'reload', reason: `${m.recoveries.length} recoveries in a minute: reload the player once`, memory: { ...m, lastActionAt: now, recoveries: [], gaveUp: true, bufferingSince: null } };
  }

  if (sample?.state === 'error') return act('reload', 'the player reported an error');

  if (sample?.state === 'buffering') {
    const since = m.bufferingSince ?? now;
    if (now - since >= STALL_MS) return act('seekLive', `buffering for ${Math.round((now - since) / 1000)}s: jump to the live edge`);
    return keep('none', 'buffering, still within its grace', { bufferingSince: since });
  }

  if (sample?.state === 'paused' || sample?.state === 'ended') return act('play', `the player is ${sample.state} and nobody asked for that`);

  if (sample?.state === 'playing') {
    const behind = Number.isFinite(sample?.liveEdgeMs) && Number.isFinite(sample?.positionMs) ? sample.liveEdgeMs - sample.positionMs : null;
    if (behind != null && behind > LIVE_DRIFT_MS) return act('seekLive', `${Math.round(behind / 1000)}s behind live: pull back to the edge`);
    return keep('none', 'playing at the live edge', { bufferingSince: null, recoveries: m.recoveries });
  }

  return keep('none', `nothing to do in state ${sample?.state ?? 'unknown'}`, { bufferingSince: null });
}

/** What the screen says when the watchdog has stopped trying. Honest, and never a dead end. */
export const GIVE_UP_MESSAGE = 'The picture keeps stopping on this connection. The show is still running: it will pick up again on its own, or reload the page.';
