-- A show is portrait or landscape, chosen by the artist when they book it
-- (lib/orientation.js).
--
-- PRD rows 99, 139, 143. Why a column rather than a setting: the shape is a
-- fact about one show, like its length or its Versus view, not a standing
-- preference. An artist plays a vertical set for the feed one week and a
-- wide set for a festival page the next, and both recordings must keep the
-- shape they were filmed in.
--
-- Ritual (docs/CLAUDE.md section 3): shows.id is uuid (phase 2, unchanged);
-- no foreign key added; the default makes every existing row portrait,
-- which is what they were composed as, so nothing already recorded changes
-- meaning. Verification queries at the foot; notify pgrst last.

alter table shows add column if not exists orientation text not null default 'portrait';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shows_orientation_check') then
    alter table shows add constraint shows_orientation_check check (orientation in ('portrait', 'landscape'));
  end if;
end $$;

comment on column shows.orientation is
  'portrait (9:16) or landscape (16:9): the shape of the composed broadcast, chosen at booking. Read by the compositor, the player box and the camera phones.';

insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('shows', 'orientation', 'public', 'contract', 'life of the show record', true, true, 'the shape of the broadcast; visible to every viewer')
on conflict (table_name, column_name) do nothing;

-- ── verification (run against staging after apply; results in the PR) ──
-- select column_name, data_type, column_default, is_nullable from information_schema.columns where table_name = 'shows' and column_name = 'orientation';
--   → orientation text 'portrait'::text NO
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'shows_orientation_check';
--   → check (orientation = any (array['portrait','landscape']))
-- select orientation, count(*) from shows group by orientation;
--   → every existing row portrait, which is what they were composed as

notify pgrst, 'reload schema';
