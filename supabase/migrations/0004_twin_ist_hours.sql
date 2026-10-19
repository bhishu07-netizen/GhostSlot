-- Fix: a simulated class filled a UTC hour, so in IST classes ran
-- xx:30–xx:30. Draw occupancy per IST clock hour instead, then rewrite the
-- simulated history in place (real sensor rows, source='sensor', are untouched).
create or replace function public.gs_twin_generate(p_from timestamptz, p_to timestamptz)
returns integer language plpgsql as $$
declare n1 int; n2 int;
begin
  if p_to - p_from > interval '31 days' then raise exception 'range too large'; end if;

  insert into public.gs_twin_readings (room_id, ts, occupants, power_kw, source)
  select r.id, t,
         case when occ then greatest(1, round(r.capacity * (0.40 + 0.55 * public.gs_rand(r.id || t::text || 'n'))))::int else 0 end,
         round((case
                  when occ   then r.rated_kw * (0.65 + 0.30 * public.gs_rand(r.id || t::text || 'p'))
                  when waste then r.rated_kw * (0.62 + 0.15 * public.gs_rand(r.id || t::text || 'w'))
                  else            r.rated_kw * 0.03
                end)::numeric, 3),
         'simulated'
  from public.gs_twin_rooms r
  cross join generate_series(date_bin('15 minutes', p_from, timestamptz '2000-01-01'), p_to, interval '15 minutes') as t
  cross join lateral (
    select extract(hour   from t at time zone 'Asia/Kolkata')::int as h,
           extract(isodow from t at time zone 'Asia/Kolkata')::int as dow,
           (t at time zone 'Asia/Kolkata')::date as d
  ) l
  cross join lateral (
    select case
             when l.dow = 7 then 0
             when l.dow = 6 then case when l.h between 10 and 12 then 0.15 * r.base_util else 0 end
             when l.h between 9 and 12 or l.h between 14 and 16 then least(0.95, r.base_util * 1.15)
             when l.h = 13 then r.base_util * 0.5
             when l.h in (8, 17) then r.base_util * 0.25
             else 0
           end as p_occ
  ) p
  cross join lateral (
    -- a class fills a whole hour, so the draw is per room per hour
    select public.gs_rand(r.id || date_trunc('hour', t at time zone 'Asia/Kolkata')::text) < p.p_occ as occ
  ) o
  cross join lateral (
    select not o.occ and (
             -- lights/AC left on for a 3-hour block after people leave
             (l.h between 8 and 21 and public.gs_rand(r.id || l.d::text || 'w' || (l.h / 3)::text) < 0.10)
             -- forgotten overnight
          or ((l.h >= 18 or l.h < 7) and public.gs_rand(r.id || l.d::text || 'night') < 0.06)
           ) as waste
  ) w
  on conflict do nothing;
  get diagnostics n1 = row_count;

  insert into public.gs_twin_water (building_id, ts, litres, source)
  select b.id, t,
         round((b.base_l15 * prof * (0.85 + 0.30 * public.gs_rand(b.id || t::text))
                + case when leak then b.base_l15 * (0.55 + 0.25 * public.gs_rand(b.id || t::text || 'l')) else 0 end)::numeric, 1),
         'simulated'
  from public.gs_twin_buildings b
  cross join generate_series(date_bin('15 minutes', p_from, timestamptz '2000-01-01'), p_to, interval '15 minutes') as t
  cross join lateral (
    select extract(hour   from t at time zone 'Asia/Kolkata')::int as h,
           extract(isodow from t at time zone 'Asia/Kolkata')::int as dow,
           (t at time zone 'Asia/Kolkata')::date as d
  ) l
  cross join lateral (
    select case
             when l.dow >= 6 then case when l.h between 8 and 20 then 0.30 else 0.05 end
             when l.h between 8 and 17 then 1.0
             when l.h between 6 and 7 or l.h between 18 and 21 then 0.40
             else 0.06
           end as prof,
           -- a leaking tap / running cistern, 1 to 5 AM on some nights
           (l.h between 1 and 4 and public.gs_rand(b.id || l.d::text || 'leak') < 0.08) as leak
  ) x
  on conflict do nothing;
  get diagnostics n2 = row_count;

  return n1 + n2;
end $$;

alter function public.gs_twin_generate(timestamptz, timestamptz) set search_path = '';
revoke execute on function public.gs_twin_generate(timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.gs_twin_generate(timestamptz, timestamptz) to service_role;

-- Rewrite existing simulated room readings with IST-hour classes.
update public.gs_twin_readings g
set occupants = s.occupants, power_kw = s.power_kw
from (
  select r.id as room_id, t as ts,
         case when occ then greatest(1, round(r.capacity * (0.40 + 0.55 * public.gs_rand(r.id || t::text || 'n'))))::int else 0 end as occupants,
         round((case
                  when occ   then r.rated_kw * (0.65 + 0.30 * public.gs_rand(r.id || t::text || 'p'))
                  when waste then r.rated_kw * (0.62 + 0.15 * public.gs_rand(r.id || t::text || 'w'))
                  else            r.rated_kw * 0.03
                end)::numeric, 3) as power_kw
  from public.gs_twin_rooms r
  cross join generate_series(date_bin('15 minutes', now() - interval '15 days', timestamptz '2000-01-01'), now(), interval '15 minutes') as t
  cross join lateral (
    select extract(hour   from t at time zone 'Asia/Kolkata')::int as h,
           extract(isodow from t at time zone 'Asia/Kolkata')::int as dow,
           (t at time zone 'Asia/Kolkata')::date as d
  ) l
  cross join lateral (
    select case
             when l.dow = 7 then 0
             when l.dow = 6 then case when l.h between 10 and 12 then 0.15 * r.base_util else 0 end
             when l.h between 9 and 12 or l.h between 14 and 16 then least(0.95, r.base_util * 1.15)
             when l.h = 13 then r.base_util * 0.5
             when l.h in (8, 17) then r.base_util * 0.25
             else 0
           end as p_occ
  ) p
  cross join lateral (
    select public.gs_rand(r.id || date_trunc('hour', t at time zone 'Asia/Kolkata')::text) < p.p_occ as occ
  ) o
  cross join lateral (
    select not o.occ and (
             (l.h between 8 and 21 and public.gs_rand(r.id || l.d::text || 'w' || (l.h / 3)::text) < 0.10)
          or ((l.h >= 18 or l.h < 7) and public.gs_rand(r.id || l.d::text || 'night') < 0.06)
           ) as waste
  ) w
) s
where g.room_id = s.room_id and g.ts = s.ts and g.source = 'simulated';
