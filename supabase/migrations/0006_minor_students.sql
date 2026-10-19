-- Under-18 students with verifiable parent/guardian consent (DPDP Act 2023 s.9,
-- DPDP Rules 2025 r.10).
--
-- Flow: an under-18 STUDENT signs up -> the details wait in gs_pending_minors
-- (expires after 48 h, then deleted) -> a parent/guardian opens the consent
-- link, confirms they are an adult and approves -> the account is created.
-- Faculty and facilities accounts stay 18+ only (enforced by the server and
-- by the CHECK below: a minor account must be a student with recorded consent).
-- No date of birth is stored, for the student or the guardian.

alter table public.gs_users
  add column if not exists is_minor boolean not null default false,
  add column if not exists guardian_name text check (guardian_name is null or char_length(guardian_name) between 2 and 60),
  add column if not exists guardian_relation text check (guardian_relation is null or guardian_relation in ('Parent', 'Legal guardian')),
  add column if not exists guardian_consent_at timestamptz,
  add column if not exists guardian_token_hash text unique check (guardian_token_hash is null or char_length(guardian_token_hash) = 64);

alter table public.gs_users drop constraint if exists gs_users_age_verified_adult_check;
alter table public.gs_users add constraint gs_users_age_or_guardian_check check (
  (age_verified_adult = true and is_minor = false)
  or (age_verified_adult = false and is_minor = true and role = 'student'
      and guardian_consent_at is not null and guardian_name is not null and guardian_token_hash is not null)
);

create table if not exists public.gs_pending_minors (
  code_hash      text primary key check (char_length(code_hash) = 64),
  roll           text not null check (roll ~ '^[A-Za-z0-9]{6,15}$'),
  roll_lower     text not null,
  name           text not null check (char_length(name) between 2 and 60),
  password_hash  text not null check (password_hash like 'scrypt$%'),
  age_checked_at timestamptz not null,
  consent_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);
create index if not exists gs_pending_minors_expiry_idx on public.gs_pending_minors(expires_at);

alter table public.gs_pending_minors enable row level security;
alter table public.gs_pending_minors force row level security;
revoke all on public.gs_pending_minors from anon, authenticated;
