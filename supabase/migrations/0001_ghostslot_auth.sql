-- GhostSlot accounts + sessions for Supabase (Postgres).
-- Run once in the Supabase SQL editor, then set SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY in server/.env.
--
-- Privacy by design:
--   • No date of birth column. The server checks age once at signup and
--     stores only that the person is a verified adult (DPDP Act 2023).
--   • The CHECK constraint makes it impossible to insert an account that
--     didn't pass the age gate, even by mistake.
--   • Row Level Security is ON with no policies, and anon/authenticated
--     roles get no grants: the public Supabase API can't read or write these
--     tables. Only the GhostSlot server (service-role key) can.

create extension if not exists pgcrypto;

create table if not exists public.gs_users (
  id                 uuid primary key default gen_random_uuid(),
  roll               text not null check (roll ~ '^[A-Za-z0-9]{6,15}$'),
  roll_lower         text not null unique,
  name               text not null check (char_length(name) between 2 and 60),
  password_hash      text not null check (password_hash like 'scrypt$%'),
  age_verified_adult boolean not null check (age_verified_adult = true),
  age_checked_at     timestamptz not null,
  consent_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  last_login_at      timestamptz
);

create table if not exists public.gs_sessions (
  token_hash  text primary key check (char_length(token_hash) = 64),
  user_id     uuid not null references public.gs_users(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  user_agent  text
);

create index if not exists gs_sessions_user_idx on public.gs_sessions(user_id);
create index if not exists gs_sessions_expiry_idx on public.gs_sessions(expires_at);

alter table public.gs_users    enable row level security;
alter table public.gs_sessions enable row level security;
alter table public.gs_users    force row level security;
alter table public.gs_sessions force row level security;

revoke all on public.gs_users, public.gs_sessions from anon, authenticated;
