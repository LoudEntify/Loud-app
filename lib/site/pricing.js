// lib/site/pricing.js — the figures the pricing page shows. The artist
// allowance and pack sizes are an open v2 decision (docs/ARCHITECTURE.md:
// "viewer-hours lose their cost basis"), so they are null here and the
// page prints "to be set" rather than inventing numbers. Korey fills these
// in (docs/NEEDS_KOREY.md); the page needs no other change.
import { TOKEN_PACKS } from '../tokens';

export const ARTIST_SHARE = '72.5%';
export const FREE_TIER = { viewerHours: null, showSlots: null, cameras: null };
export const PACKS = [
  { key: 'pack', eyebrow: 'Pack', priceMinor: null, viewerHours: null, showSlots: null, popular: true, notes: ['Never expires', 'Buy only when you need it'] },
  { key: 'bigger', eyebrow: 'Bigger pack', priceMinor: null, viewerHours: null, showSlots: null, popular: false, notes: ['Better value per hour', 'For artists with a crowd'] },
];
export const TOKENS_FROM_MINOR = Math.min(...TOKEN_PACKS.map((p) => p.amountMinor));

export const pounds = (minor) => (minor == null ? 'to be set' : `£${(minor / 100).toFixed(2).replace(/\.00$/, '')}`);
export const count = (n, unit) => (n == null ? `Viewer-hours to be set` : `${n} ${unit}`);
