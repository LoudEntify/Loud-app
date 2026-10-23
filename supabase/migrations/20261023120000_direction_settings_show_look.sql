-- Direction settings per artist and the look per show.
--
-- PRD rows 15, 16, 139. docs/CLAUDE.md §5: the director's moves are
-- individually switchable by the artist; the look on screen is a
-- show-level fact (like versus_view), chosen by the artist and copied
-- onto the show at booking from their default (docs/DECISIONS.md
-- 2026-10-14 and 2026-10-23: the look is applied in the compositor only
-- and logged per frame).
--
-- Ritual (docs/CLAUDE.md §3): shows.id is uuid (phase 2); auth.users.id
-- is uuid; direction_settings keys on the artist's user id, one row per
-- artist. information_schema check and verification queries at the end.

-- ── direction_settings: one row per artist ──────────────────────────
-- `settings` is the whole object lib/direction.js normalises (autoDirector,
-- pace, showManualCuts, techniques, transitions, transitionStrength, look,
-- versusPicker, operator). One jsonb column rather than twenty, because
-- the shape follows the approved screen and the screen will grow; the
-- normaliser is the schema and fills every missing field with its default.
create table if not exists direction_settings (
  artist_id   uuid primary key references auth.users(id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table direction_settings enable row level security;
-- The artist reads their own row from the client; writes go through
-- /api/artist/direction (service role) so every change is audited.
create policy "direction_settings_select_own" on direction_settings
  for select using (artist_id = auth.uid());

-- ── shows.look: the look on screen for this show ────────────────────
-- { lut: <built-in name or null>, strength: 0..1 }. Null until booked
-- under the new flow; the tick route treats null as the artist's default.
alter table shows add column if not exists look jsonb;

insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('direction_settings', 'settings', 'personal', 'contract', 'life of the account', true, true, 'the artist''s director preferences; no third-party data'),
  ('shows', 'look', 'public', 'contract', 'life of the show record', true, true, 'the grade applied to the broadcast; visible to every viewer')
on conflict (table_name, column_name) do nothing;

-- ── verification (run against staging after apply; results in the PR) ──
-- select column_name, data_type from information_schema.columns where table_name = 'direction_settings' order by ordinal_position;
--   → artist_id uuid, settings jsonb, created_at timestamptz, updated_at timestamptz
-- select column_name, data_type from information_schema.columns where table_name = 'shows' and column_name = 'look';
--   → look jsonb
-- select policyname, cmd from pg_policies where tablename = 'direction_settings';
--   → direction_settings_select_own SELECT (and nothing else: no client writes)
-- set role authenticated; set request.jwt.claims = '{"sub":"<other artist>"}';
-- select count(*) from direction_settings where artist_id = '<this artist>';  → 0 (a non-owner sees nothing)

notify pgrst, 'reload schema';
