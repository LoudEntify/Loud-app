// lib/player/layout.js
// ─────────────────────────────────────────────────────────────
// The resizing show layout, as pure geometry.
//
// PRD row 99: "Phone default about 304 x 540 with 44px side buttons. Bigger
// gives about 340 x 604 and chat collapses to one line. A vote sheet
// shrinks the picture to 270 wide. Guest sign-up uses 200 x 356. Fold and
// tablet use the 768 layout. Computer: 405 x 720 frame between info and
// chat."
//
// Everything that decides where the player and the things around it go is
// here, with no DOM, so tests/layout.test.mjs can prove the two rules that
// matter at every width and in every mode:
//   1. nothing overlaps the player (docs/CLAUDE.md §6: "Nothing may ever
//      overlay the YouTube player frame");
//   2. the player is never smaller than 200 x 200.
// The React component (components/viewer/ShowLayout.jsx) only applies the
// rects this returns.
// ─────────────────────────────────────────────────────────────
import { breakpoint, playerFrame, size } from '../design/tokens.js';

export const MODES = ['default', 'bigger', 'vote', 'guest', 'waiting'];

const ASPECT = 16 / 9;
const PHONE_HEADER_H = 104;   // top bar + safe area at 390 x 844
const PHONE_SIDE_W = 56;      // the 44px button column plus its label
const PHONE_GUTTER = 12;

function clampFrame(spec, maxW, maxH) {
  // Shrink to fit while keeping 9:16, never below the YouTube minimum.
  let w = Math.min(spec.w, maxW);
  let h = Math.round(w * ASPECT);
  if (h > maxH) {
    h = maxH;
    w = Math.round(h / ASPECT);
  }
  w = Math.max(w, playerFrame.min.w);
  h = Math.max(h, playerFrame.min.h);
  return { w, h };
}

/**
 * @param {{ width:number, height:number, mode?:string, isVersus?:boolean }} env
 * @returns {{ tier:string, player:Rect, regions:Record<string,Rect>, chatCollapsed:boolean }}
 *   Every Rect is { x, y, w, h } in CSS pixels from the top-left of the viewport.
 */
export function computeShowLayout({ width, height, mode = 'default' }) {
  if (!MODES.includes(mode)) mode = 'default';
  if (width >= breakpoint.computer) return computerLayout(width, height, mode);
  if (width >= breakpoint.fold) return foldLayout(width, height, mode);
  return phoneLayout(width, height, mode);
}

function phoneLayout(width, height, mode) {
  const regions = {};
  let player;
  let chatCollapsed = false;

  if (mode === 'guest') {
    // Player shrinks to the minimum beside the intro text; the sheet takes the rest.
    const sheetTop = Math.max(428, Math.min(height * 0.5, height - 380));
    player = { x: 16, y: 56, ...clampFrame(playerFrame.guest, 200, sheetTop - 56 - 16) };
    regions.intro = { x: player.x + player.w + 16, y: 56, w: width - (player.x + player.w + 16) - 16, h: player.h };
    regions.sheet = { x: 0, y: sheetTop, w: width, h: height - sheetTop };
    return { tier: 'phone', mode, player, regions, chatCollapsed: true };
  }

  if (mode === 'vote') {
    const sheetTop = Math.max(PHONE_HEADER_H + playerFrame.min.h + 12, Math.round(height * 0.706)); // 596 at 844
    const maxW = width - PHONE_GUTTER * 2 - PHONE_SIDE_W - 6;
    player = { x: PHONE_GUTTER, y: PHONE_HEADER_H, ...clampFrame(playerFrame.vote, maxW, sheetTop - PHONE_HEADER_H - 12) };
    regions.side = { x: player.x + player.w + 6, y: PHONE_HEADER_H, w: PHONE_SIDE_W, h: 4 * 44 + 3 * 10 + 4 * 15 };
    regions.sheet = { x: 0, y: sheetTop, w: width, h: height - sheetTop };
    regions.header = { x: 0, y: 0, w: width, h: PHONE_HEADER_H - 8 };
    return { tier: 'phone', mode, player, regions, chatCollapsed: true };
  }

  if (mode === 'bigger') {
    chatCollapsed = true;
    const composerBlock = 24 + size.touch + 10 + 36 + 6; // actions row + one-line chat
    const maxH = height - PHONE_HEADER_H - composerBlock - 8;
    const maxW = width - 2 * 25;
    const f = clampFrame(playerFrame.bigger, maxW, maxH);
    player = { x: Math.round((width - f.w) / 2), y: PHONE_HEADER_H, w: f.w, h: f.h };
    const chatY = player.y + player.h + 8;
    regions.chatLine = { x: PHONE_GUTTER, y: chatY, w: width - 2 * PHONE_GUTTER, h: 36 };
    regions.actions = { x: PHONE_GUTTER, y: chatY + 42, w: width - 2 * PHONE_GUTTER, h: size.touch };
    regions.header = { x: 0, y: 0, w: width, h: PHONE_HEADER_H - 8 };
    return { tier: 'phone', mode, player, regions, chatCollapsed };
  }

  // default and waiting
  const bottomBlock = 24 + size.composer + 6 + 52 + 6 + (mode === 'waiting' ? 72 : 56) + 8; // composer, comments, card
  const maxH = height - PHONE_HEADER_H - bottomBlock;
  const maxW = width - PHONE_GUTTER * 2 - PHONE_SIDE_W - 6;
  const f = clampFrame(playerFrame.phone, maxW, maxH);
  player = { x: PHONE_GUTTER, y: PHONE_HEADER_H, w: f.w, h: f.h };
  regions.header = { x: 0, y: 0, w: width, h: PHONE_HEADER_H - 8 };
  regions.side = { x: player.x + player.w + 6, y: PHONE_HEADER_H, w: PHONE_SIDE_W, h: 4 * 44 + 3 * 10 + 4 * 15 };
  const cardY = player.y + player.h + 8;
  const cardH = mode === 'waiting' ? 72 : 56;
  regions.card = { x: PHONE_GUTTER, y: cardY, w: width - 2 * PHONE_GUTTER, h: cardH };
  const composerY = height - 24 - size.composer;
  regions.composer = { x: PHONE_GUTTER, y: composerY, w: width - 2 * PHONE_GUTTER, h: size.composer };
  const commentsY = cardY + cardH + 6;
  regions.comments = { x: PHONE_GUTTER, y: commentsY, w: width - 2 * PHONE_GUTTER, h: Math.max(0, composerY - 6 - commentsY) };
  return { tier: 'phone', mode, player, regions, chatCollapsed };
}

function foldLayout(width, height, mode) {
  // YT-FoldShow: player 360 x 640 at (24, 84); actions below it; chat panel
  // from x = 424 to the right edge. Sheets (vote/guest) sit inside the chat
  // panel column, never over the player.
  const regions = {};
  const headerH = 76;
  const actionsH = 48;
  const maxH = height - headerH - 8 - actionsH - 16 - 24;
  const f = clampFrame(playerFrame.foldTablet, Math.round(width * 0.5) - 24, maxH);
  const player = { x: 24, y: headerH + 8, w: f.w, h: f.h };
  regions.header = { x: 12, y: 20, w: width - 24, h: 56 };
  regions.actions = { x: 24, y: player.y + player.h + 16, w: f.w + 20, h: actionsH };
  const panelX = player.x + player.w + 40;
  regions.panel = { x: panelX, y: headerH + 8, w: width - panelX - 24, h: height - headerH - 8 - 24 };
  if (mode === 'vote' || mode === 'guest') regions.sheet = { ...regions.panel };
  return { tier: width >= breakpoint.tablet ? 'tablet' : 'fold', mode, player, regions, chatCollapsed: false };
}

function computerLayout(width, height, mode) {
  // WebYT-Show: header 72; info column 440; player 405 x 720; chat fills the rest.
  const regions = {};
  const headerH = 72;
  const pad = 28;
  const infoW = 440;
  const gap = 28;
  const maxH = height - headerH - 2 * 24;
  const f = clampFrame(playerFrame.computer, width - pad * 2 - infoW - gap * 2 - 320, maxH);
  const player = { x: pad + infoW + gap, y: headerH + 24, w: f.w, h: f.h };
  regions.header = { x: 0, y: 0, w: width, h: headerH };
  regions.info = { x: pad, y: headerH + 24, w: infoW, h: f.h };
  const chatX = player.x + player.w + gap;
  regions.panel = { x: chatX, y: headerH + 24, w: width - chatX - pad, h: f.h };
  if (mode === 'vote' || mode === 'guest') regions.sheet = { ...regions.info };
  return { tier: 'computer', mode, player, regions, chatCollapsed: false };
}

/** True if two rects share any area (touching edges is not overlap). */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The two invariants, checked for one layout. Returns a list of violations (empty = ok). */
export function layoutViolations(layout) {
  const out = [];
  const { player, regions } = layout;
  if (player.w < playerFrame.min.w || player.h < playerFrame.min.h) {
    out.push(`player ${player.w}x${player.h} is under the ${playerFrame.min.w}x${playerFrame.min.h} minimum`);
  }
  for (const [name, r] of Object.entries(regions)) {
    if (rectsOverlap(player, r)) out.push(`region "${name}" overlaps the player`);
  }
  return out;
}
