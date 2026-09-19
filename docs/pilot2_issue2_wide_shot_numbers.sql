-- pilot2_issue2_wide_shot_numbers.sql
-- ISSUE 2 — Artisttoo's wide shot looks softer and more zoomed than
-- Artistwon's. The actual numbers, side by side, from the same window.
--
-- READ-ONLY.
--
-- ⚠️ REPLACE 'REHEARSAL_ROOM' with the rehearsal's room_name.
--
-- ── WHAT I CAN ALREADY RULE OUT FROM THE CODE ─────────────────
-- It is NOT a crop. SHOT_TYPES.wide.transform is `null`
-- (lib/shotTypes.js), so a wide shot applies no scale at all. Item 1's
-- downgrade sets shot:'wide' for exactly that reason, and a SUSPENDED
-- command renders scale(1). There is no path in the shot system that
-- puts a transform on a wide shot, for either slot.
--
-- Q3 below proves that from the data rather than from my reading: if
-- Artisttoo's slot ever carried a stale crop it would appear there.
--
-- ── WHAT IT MORE LIKELY IS ────────────────────────────────────
-- "More zoomed AND blurred" together is the signature of one of two
-- things, and Q1/Q2 separate them:
--
--   a LOWER simulcast layer being upscaled into the same panel
--     -> Q1 shows a smaller width/height and a lower bitrate for the
--        same moment, and qualityLimitationReason says why
--
--   a PORTRAIT source filling a landscape panel
--     -> object-fit cover crops the sides, which reads as zoomed, and
--        the upscale reads as soft. Q2 compares sourceWidth/sourceHeight
--        for the two publishers.

-- ══════════════════════════════════════════════════════════════
-- Q1 · ENCODER STATS, BOTH ARTISTS, SAME WINDOW.
--
-- The numbers you asked for. One row per publisher per sample.
-- Compare width/height, fps and bitrate at the same client_ts.
-- ══════════════════════════════════════════════════════════════

select
  h.client_ts,
  h.participant_identity,
  case
    when h.participant_identity like 'contestant-a-%' then 'Artistwon (slot a)'
    when h.participant_identity like 'contestant-b-%' then 'Artisttoo (slot b)'
    else h.participant_identity
  end                                              as who,
  (h.detail->>'width')::int                        as width,
  (h.detail->>'height')::int                       as height,
  (h.detail->>'sourceWidth')::int                  as source_width,
  (h.detail->>'sourceHeight')::int                 as source_height,
  (h.detail->>'fps')::numeric                      as fps,
  (h.detail->>'sourceFps')::numeric                as source_fps,
  round((h.detail->>'uplinkBps')::numeric / 1000)  as kbps,
  (h.detail->>'avgQp')::numeric                    as avg_qp,
  h.detail->>'qualityLimitationReason'             as limitation,
  (h.detail->>'activeLayers')::int                 as active_layers,
  (h.detail->>'layerCount')::int                   as layer_count
from health_events h
where h.show_id = 'REHEARSAL_ROOM'
  and h.participant_identity like 'contestant-%'
  and h.detail ? 'width'
order by h.client_ts desc, who
limit 60;

-- ══════════════════════════════════════════════════════════════
-- Q2 · THE SUMMARY, one row each. This is the comparison to read first.
--
-- A meaningfully smaller median width on one side IS the blur: the panel
-- is the same size on screen, so a smaller encode is upscaled into it.
--
-- portrait_source tells you whether the frame is being cropped to fit
-- rather than scaled -- that is the "more zoomed" half, and it is a
-- camera orientation difference, not a bug.
-- ══════════════════════════════════════════════════════════════

select
  case
    when h.participant_identity like 'contestant-a-%' then 'Artistwon (slot a)'
    when h.participant_identity like 'contestant-b-%' then 'Artisttoo (slot b)'
  end                                                        as who,
  count(*)                                                   as samples,
  round(percentile_cont(0.5) within group (order by (h.detail->>'width')::int))   as median_width,
  round(percentile_cont(0.5) within group (order by (h.detail->>'height')::int))  as median_height,
  round(percentile_cont(0.5) within group (order by (h.detail->>'fps')::numeric), 1) as median_fps,
  round(percentile_cont(0.5) within group (order by (h.detail->>'uplinkBps')::numeric) / 1000) as median_kbps,
  round(percentile_cont(0.5) within group (order by (h.detail->>'avgQp')::numeric), 1) as median_qp,
  bool_or((h.detail->>'sourceHeight')::int > (h.detail->>'sourceWidth')::int)     as portrait_source,
  count(*) filter (where h.detail->>'qualityLimitationReason' = 'cpu')            as cpu_limited_samples,
  count(*) filter (where h.detail->>'qualityLimitationReason' = 'bandwidth')      as bandwidth_limited_samples
from health_events h
where h.show_id = 'REHEARSAL_ROOM'
  and h.participant_identity like 'contestant-%'
  and h.detail ? 'width'
group by who
order by who;

-- ══════════════════════════════════════════════════════════════
-- Q3 · DID EITHER SLOT CARRY A STALE COMMAND?
--
-- This is the transform question, answered from the data. If Artisttoo's
-- slot was left SUSPENDED or DOWNGRADED from earlier testing it shows
-- here.
--
-- EXPECT: either nothing, or suspends that were followed by a resume.
-- A `stale_command_downgraded` with no later `stale_command_resumed`
-- means that slot finished the rehearsal pinned to wide -- which still
-- applies NO crop, but would explain a framing that never changed.
-- ══════════════════════════════════════════════════════════════

select h.client_ts,
       h.event_type,
       h.detail->>'slot'          as slot,
       h.detail->>'shot'          as shot,
       h.detail->>'fromShot'      as from_shot,
       h.detail->>'fallback'      as fallback,
       h.detail->>'awayMs'        as away_ms
  from health_events h
 where h.show_id = 'REHEARSAL_ROOM'
   and h.event_type like 'stale_command_%'
 order by h.client_ts;

-- ══════════════════════════════════════════════════════════════
-- Q4 · WHAT WAS ACTUALLY ON AIR, per slot.
--
-- shot_commands records every cut. If slot b sat on a different shot
-- from slot a for most of the rehearsal, the difference is editorial
-- rather than technical -- e.g. one was on closeUp (scale 1.4) while you
-- were comparing it to the other's wide.
-- ══════════════════════════════════════════════════════════════

select slot,
       shot,
       count(*) as cuts,
       min(created_at) as first_cut,
       max(created_at) as last_cut
  from shot_commands
 where show_id = 'REHEARSAL_ROOM'
 group by slot, shot
 order by slot, cuts desc;
