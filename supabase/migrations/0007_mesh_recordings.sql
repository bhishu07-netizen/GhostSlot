-- GhostSlot 0.5: labelled CSI mesh recordings for the people-count model.
--
-- One row = one 2-second window from the Demo Room boards, with the true
-- people count the operator set while recording. Render's free disk is wiped
-- on every deploy, so recordings live here instead.
--
-- SECURITY: same as the other gs_ tables. RLS on with no policies and no
-- grants for anon/authenticated: only the GhostSlot server (service-role key)
-- can read or write it through the Supabase API.

create table if not exists public.gs_mesh_rows (
  id         bigserial primary key,
  t          timestamptz not null,
  session    text not null check (session ~ '^[a-z0-9]{2,32}$'),
  label      text not null check (label in ('0', '1', '2', '3', '4', '5+')),
  source     text not null check (source in ('hardware', 'simulation')),
  features   real[] not null check (cardinality(features) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists gs_mesh_rows_t_idx on public.gs_mesh_rows (t);

alter table public.gs_mesh_rows enable row level security;
alter table public.gs_mesh_rows force row level security;
revoke all on public.gs_mesh_rows from anon, authenticated;
revoke all on sequence public.gs_mesh_rows_id_seq from anon, authenticated;
