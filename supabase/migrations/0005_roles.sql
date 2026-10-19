-- Roles: students, faculty and facilities staff.
--   student    : roll number. Finds/books rooms, views the twin.
--   faculty    : employee ID + department. Same access as students.
--   facilities : staff ID + team. Also logs energy/water readings and
--                acknowledges/resolves twin alerts. Self sign-up needs an
--                access code from the estate office (checked by the server).
-- Additive: existing accounts become students; older server code keeps working.

alter table public.gs_users
  add column if not exists role text not null default 'student'
    check (role in ('student', 'faculty', 'facilities')),
  add column if not exists department text
    check (department is null or char_length(department) between 2 and 40);

-- Readings typed in by facilities staff (meter rounds, spot checks).
alter table public.gs_twin_readings drop constraint if exists gs_twin_readings_source_check;
alter table public.gs_twin_readings add constraint gs_twin_readings_source_check
  check (source in ('simulated', 'sensor', 'manual'));
alter table public.gs_twin_readings
  add column if not exists logged_by uuid references public.gs_users(id) on delete set null;

alter table public.gs_twin_water drop constraint if exists gs_twin_water_source_check;
alter table public.gs_twin_water add constraint gs_twin_water_source_check
  check (source in ('simulated', 'sensor', 'manual'));
alter table public.gs_twin_water
  add column if not exists logged_by uuid references public.gs_users(id) on delete set null;

create index if not exists gs_twin_readings_manual_idx on public.gs_twin_readings(ts) where source = 'manual';
create index if not exists gs_twin_water_manual_idx on public.gs_twin_water(ts) where source = 'manual';
