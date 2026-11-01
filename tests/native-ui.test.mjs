// The native design system is checked against the boards, not against
// anyone's memory of them.
//
// Two things are tested here, and neither needs React Native to run:
//
//   1. The token values the kit is built from match design/DesignSystem.dc.html
//      and lib/design/tokens.js. A hex typed into a component by hand is the
//      way a rebuilt app drifts back into looking like two apps.
//   2. The contrast rule the board states in words — "Teal and orange are
//      fills, never text on a light background" — is arithmetic, so it is
//      checked as arithmetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, type, space, button, icon, gradient, surface, LOADING_GIVE_UP_MS } from '../lib/design/tokens.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const BOARD = read('design/DesignSystem.dc.html');

test('the five colour tokens are the five the board names', () => {
  for (const hex of ['#011627', '#fdfffc', '#2ec4b6', '#e71d36', '#ff9f1c']) {
    assert.ok(BOARD.includes(hex), `${hex} should appear on DesignSystem.dc.html`);
  }
  assert.deepEqual(
    [color.ink, color.porcelain, color.teal, color.red, color.orange],
    ['#011627', '#fdfffc', '#2ec4b6', '#e71d36', '#ff9f1c'],
  );
});

// Relative luminance and contrast, from WCAG 2.1.
const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the contrast rule the board states in words holds as arithmetic', () => {
  // "both fail contrast against Porcelain at roughly 2:1 where 4.5:1 is needed"
  assert.ok(contrast(color.teal, color.porcelain) < 4.5, 'teal text on porcelain must stay forbidden');
  assert.ok(contrast(color.orange, color.porcelain) < 4.5, 'orange text on porcelain must stay forbidden');
  // "Ink text on a teal or orange fill is fine, and so is teal text on Ink."
  assert.ok(contrast(color.ink, color.teal) >= 4.5, 'ink on teal is the main button');
  assert.ok(contrast(color.ink, color.orange) >= 4.5, 'ink on orange is the Fix button');
  assert.ok(contrast(color.teal, color.ink) >= 4.5, 'teal text on ink is allowed');
  // Everything the kit actually writes text in.
  assert.ok(contrast(color.ink, color.porcelain) >= 4.5, 'body text on a light screen');
  assert.ok(contrast(color.porcelain, color.ink) >= 4.5, 'body text on a dark screen');
  assert.ok(contrast(color.white, color.red) >= 4.5, 'white on red is the destructive button');
});

test('the type scale is two weights and never below 14', () => {
  const steps = Object.values(type);
  assert.ok(steps.length >= 6);
  for (const s of steps) {
    assert.ok(s.size >= 13, `${s.size} is below the floor`); // LABEL is the one 13
    assert.ok([400, 700].includes(s.weight), `weight ${s.weight} is not one of the two`);
  }
  assert.equal(type.supporting.size, 15, 'supporting text is 14–15, "never below 14"');
  assert.ok(type.label.uppercase && type.label.letterSpacing > 0, 'LABEL is uppercase and tracked');
});

test('spacing, radii and tap targets are the board\'s', () => {
  // "Spacing steps: 4, 8, 10, 12, 16, 20, 24." The screen edge is one of
  // them (16) rather than a step of its own, so compare the set.
  assert.deepEqual([...new Set(Object.values(space))].sort((a, b) => a - b), [4, 8, 10, 12, 16, 20, 24]);
  assert.equal(space.screenEdge, 16, 'screen edge is 16 on a phone');
  assert.equal(space.screenEdge, space.l, 'the screen edge is a step, not a value of its own');
  assert.equal(button.main.height, 52);
  assert.equal(button.main.radius, 26, 'buttons are fully round');
  for (const b of Object.values(button)) {
    assert.equal(b.radius * 2, b.height, `a ${b.height} button is not fully round at radius ${b.radius}`);
  }
  // "Nothing tappable under 44 by 44." The two smaller sizes are chips and
  // badges inside a larger row, so only the standalone sizes are checked.
  for (const name of ['main', 'medium']) assert.ok(button[name].height >= 44, `${name} is under the tap floor`);
  assert.equal(icon.stroke, 1.8);
  assert.deepEqual(icon.sizes, [20, 22, 24, 26]);
});

test('the gradients carry the same stops as the CSS the web uses', () => {
  assert.deepEqual(gradient.tealButton.colors, ['#2ec4b6', '#8fe6dd', '#2ec4b6']);
  assert.deepEqual(gradient.tealButton.locations, [0, 0.48, 1]);
  assert.deepEqual(gradient.inkButton.colors, ['#011627', '#123f57', '#011627']);
  assert.equal(gradient.base.dark, color.ink);
  assert.equal(gradient.base.light, '#f6f9f6');
  // Each silk is three washes, matching the three radial layers in the CSS.
  assert.equal(gradient.darkSilk.length, 3);
  assert.equal(gradient.lightSilk.length, 3);
  for (const g of [...gradient.darkSilk, ...gradient.lightSilk, ...gradient.mediaTile]) {
    assert.equal(g.colors.length, 2, 'a wash fades one colour to nothing');
    assert.match(g.colors[1], /, ?0\)$/, 'a wash must end fully transparent');
  }
});

test('loading gives up at ten seconds, as the states board says', () => {
  assert.equal(LOADING_GIVE_UP_MS, 10_000);
  assert.ok(readFileSync(resolve(ROOT, 'design/StatesPatterns.dc.html'), 'utf8').includes('10 seconds'));
});

test('the kit exports what a screen needs, and screens import only the kit', () => {
  const index = read('native/src/ui/index.js');
  for (const name of ['Screen', 'Card', 'MediaTile', 'Sheet', 'Button', 'Chip', 'Badge', 'Toggle', 'Field', 'Row', 'Section', 'ScreenHeader', 'Skeleton', 'Empty', 'ErrorPanel', 'OfflineBar']) {
    assert.ok(index.includes(name), `the kit should export ${name}`);
  }
});

test('no component types a colour of its own', () => {
  // tokens.js re-exports the shared file and Icon.js carries traced paths;
  // every other file in the kit must reach for a token.
  const files = ['Surface.js', 'Button.js', 'Field.js', 'Layout.js', 'states.js'];
  for (const f of files) {
    const src = read(`native/src/ui/${f}`);
    const hexes = src.match(/#[0-9a-fA-F]{6}\b/g) || [];
    assert.deepEqual(hexes, [], `${f} writes a raw hex: ${hexes.join(', ')}. Use a token.`);
  }
});

test('the surfaces are the four the board names', () => {
  assert.equal(surface.card, 'rgba(255,255,255,0.72)', 'Card is "White at 72% over the page wash"');
  assert.equal(surface.scrim, 'rgba(1,22,39,0.45)');
  assert.equal(surface.quiet, 'rgba(1,22,39,0.07)', 'the quiet button fill');
  assert.ok(BOARD.includes('0.72') && BOARD.includes('0.07'));
});

test('a control drawn under 44 reaches 44 with hitSlop', () => {
  // "Nothing tappable under 44 by 44." The chip and the two smallest button
  // sizes are drawn smaller than that on the boards, so they widen their
  // touch area rather than their box. Without it a filter row is a row a
  // thumb cannot reliably hit, which reads as the app ignoring taps.
  const src = read('native/src/ui/Button.js');
  const chipSrc = src.slice(src.indexOf('export function Chip'));
  const buttonSrc = src.slice(src.indexOf('export function Button'), src.indexOf('export function Chip'));
  assert.match(chipSrc, /hitSlop=/, 'Chip is drawn 36 high and needs hitSlop');
  assert.match(buttonSrc, /hitSlop=/, 'the small button sizes need hitSlop');
  for (const name of ['chip', 'tiny', 'small']) {
    assert.ok(button[name].height < 44, `${name} is drawn under 44, which is what the hitSlop is for`);
  }
});
