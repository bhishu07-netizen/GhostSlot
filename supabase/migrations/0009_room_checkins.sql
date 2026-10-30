-- GhostSlot 0.6: room check-in.
-- One row per person ONLY while they are checked into a room; checking out or
-- the time running out deletes it. No history is kept.
-- SECURITY: same as the other gs_ tables (RLS on, no policies, no grants for
-- anon/authenticated). Deleting an account deletes its check-in (cascade).

create table if not exists public.gs_checkins (
  user_id        uuid primary key references public.gs_users(id) on delete cascade,
  room_id        text not null check (room_id ~ '^[A-Za-z0-9-]{2,40}$'),
  method         text not null check (method in ('qr', 'tap')),
  checked_in_at  timestamptz not null,
  expires_at     timestamptz not null check (expires_at > checked_in_at)
);

create index if not exists gs_checkins_expires_idx on public.gs_checkins (expires_at);

alter table public.gs_checkins enable row level security;
alter table public.gs_checkins force row level security;
revoke all on public.gs_checkins from anon, authenticated;
