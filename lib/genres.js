// lib/genres.js
// ─────────────────────────────────────────────────────────────
// Canonical genre list -- Accounts & Identity Day 2, product-decision
// fold-in round. Fixed list, no free-typing this round: keeps data clean
// for genre-based discovery/contest matching later. An "other"/free-text
// escape hatch is explicitly deferred to a later round if this proves too
// restrictive in practice -- not a decision made here.
//
// Order here is also the default suggestion order in components/
// GenreSelect.jsx's autocomplete dropdown -- platform contest genres
// first, neighbours after, not alphabetical.
// ─────────────────────────────────────────────────────────────

export const GENRES = [
  'Afrobeats',
  'Amapiano',
  'R&B',
  'Rap',
  'Hip-Hop',
  'Gospel',
  'Pop',
  'Soul',
  'Jazz',
  'Reggae',
  'Dancehall',
  'Afro-fusion',
  'Alté',
  'Highlife',
  'Drill',
  'Grime',
  'Electronic',
  'House',
  'Rock',
  'Country',
  'Folk',
  'Classical',
];
