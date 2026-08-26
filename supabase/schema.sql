-- B.L.A.Y.N.E beta — database schema.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste this
-- whole file -> Run. Safe to re-run — every statement is idempotent.
--
-- Five tables:
--   profiles       one row per tester, extended with the beta signup fields
--                  and the company context the model learns in conversation
--   signup_events  append-only log of every registration, written by a
--                  trigger on auth.users so it captures a signup even if the
--                  person never finishes onboarding or never returns
--   usage_daily    per-user, per-day message count — what the quota reads
--   brand_assets   documents a tester has shared (brand manual, deck, etc.),
--                  stored in Anthropic's Files API and referenced by file_id
--   (auth.users is Supabase's own table; we don't touch it beyond the trigger)

-- ---------------------------------------------------------------------------
-- Baseline grants.
--
-- Row Level Security policies only take effect once a role already has the
-- underlying table-level GRANT — without it, Postgres denies the request
-- before RLS is ever evaluated ("permission denied for table ..."). Tables
-- created via the SQL Editor don't inherit these automatically the way ones
-- made through the Table Editor UI do, so they're stated explicitly here.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, anon, service_role;

-- The service role is what server/supabaseAdmin.js uses — it must bypass
-- RLS *and* hold the underlying grants, or every admin-side query 403s the
-- same way an ungranted `authenticated` query does. Broad on purpose: this
-- role's key never leaves the server (see .env.example).
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text not null,
  full_name             text default '' not null,
  phone                 text,
  has_company           boolean,
  company_name          text,
  company_size          text,          -- '1-10' | '11-50' | '51-200' | '201-1000' | '1000+'
  use_case              text,          -- free text: what they'd use B.L.A.Y.N.E for
  onboarding_completed  boolean default false not null,
  -- True once at least one brand_assets row exists (or the tester explicitly
  -- said they have nothing to share) — see buildSystem() in blaynePrompt.js.
  -- While false, the first message of a new session gets the "ask for brand
  -- materials first" instruction instead of going straight to work.
  brand_kit_completed   boolean default false not null,
  -- True once the account has accepted the Advanced AI Model Safety
  -- Addendum (src/lib/legalContent.js) — see SafetyAddendumGate.jsx and the
  -- gate in ProtectedRoute.jsx. Recorded per-account, not per-device, and
  -- re-shown only if we present a materially revised addendum.
  safety_addendum_accepted     boolean default false not null,
  safety_addendum_accepted_at  timestamptz,
  -- Company context the model has learned in conversation (not collected at
  -- onboarding) and saves via the `save_context` tool — see
  -- getCompanyContext()/saveContextField() in server/index.js — so future
  -- sessions don't have to ask again. company_url/company_brief are their
  -- own columns because they're named, well-defined facts; context_notes is
  -- a free-form bucket (industry, target_audience, competitors, brand_voice,
  -- ...) for anything else, so new fact types don't need a migration.
  --
  -- Beta note: available to every tester for now. Post-beta this is meant to
  -- become a paid-subscriber feature — gate it in getCompanyContext() (and
  -- decide what a free-trial session sees instead) once plan/billing exists;
  -- nothing here builds that gate speculatively ahead of time.
  company_url           text,
  company_brief         text,
  context_notes         jsonb default '{}'::jsonb not null,
  created_at            timestamptz default now() not null,
  updated_at            timestamptz default now() not null
);

-- Idempotent add for a profiles table that already existed before this
-- column was introduced — `create table if not exists` above is a no-op
-- once the table exists, so new columns need their own statement.
alter table public.profiles add column if not exists brand_kit_completed boolean default false not null;
alter table public.profiles add column if not exists safety_addendum_accepted boolean default false not null;
alter table public.profiles add column if not exists safety_addendum_accepted_at timestamptz;
alter table public.profiles add column if not exists company_url text;
alter table public.profiles add column if not exists company_brief text;
alter table public.profiles add column if not exists context_notes jsonb default '{}'::jsonb not null;

alter table public.profiles enable row level security;

-- Service role should bypass RLS outright (it's meant to be the trusted
-- admin path), but this project doesn't have that set at the role level —
-- same gap as the missing grants above — so it's granted explicitly per
-- table instead of assumed.
drop policy if exists "profiles_service_role_all" on public.profiles;
create policy "profiles_service_role_all" on public.profiles
  for all to service_role using (true) with check (true);

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Rows are normally created by the trigger below (SECURITY DEFINER, bypasses
-- RLS). This policy is a fallback only, so onboarding still works if a row is
-- ever missing.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

grant select, insert, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- signup_events — append-only, never exposed to clients (requirement:
-- "all sign ups should be collected, always"). Read it from the Supabase
-- Table Editor, or with the service role key.
-- ---------------------------------------------------------------------------
create table if not exists public.signup_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  email       text,
  provider    text,
  created_at  timestamptz default now() not null
);

alter table public.signup_events enable row level security;

-- No policy for authenticated/anon: RLS with zero policies for a role denies
-- it entirely, which is intentional — this table is for you, not the app.
drop policy if exists "signup_events_service_role_all" on public.signup_events;
create policy "signup_events_service_role_all" on public.signup_events
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- usage_daily — the 25-messages/day quota. Only ever written through
-- check_and_increment_usage() below, so a client can't reset its own count.
-- ---------------------------------------------------------------------------
create table if not exists public.usage_daily (
  user_id        uuid references auth.users (id) on delete cascade,
  day            date default current_date not null,
  message_count  int default 0 not null,
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;

drop policy if exists "usage_daily_service_role_all" on public.usage_daily;
create policy "usage_daily_service_role_all" on public.usage_daily
  for all to service_role using (true) with check (true);

drop policy if exists "usage_select_own" on public.usage_daily;
create policy "usage_select_own" on public.usage_daily
  for select using (auth.uid() = user_id);

grant select on public.usage_daily to authenticated;

-- ---------------------------------------------------------------------------
-- brand_assets — documents a tester shares (brand manual, deck, logo, …).
--
-- The file itself lives in Anthropic's Files API, not here — this row is
-- just the pointer (anthropic_file_id) plus enough metadata to list and
-- manage it from the UI. Uploaded once, reused on every request afterwards
-- (see server/index.js), matching "saved once, reused automatically."
-- ---------------------------------------------------------------------------
create table if not exists public.brand_assets (
  id                bigint generated always as identity primary key,
  user_id           uuid references auth.users (id) on delete cascade not null,
  file_name         text not null,
  mime_type         text not null,
  size_bytes        bigint not null,
  anthropic_file_id text not null,
  created_at        timestamptz default now() not null
);

alter table public.brand_assets enable row level security;

drop policy if exists "brand_assets_service_role_all" on public.brand_assets;
create policy "brand_assets_service_role_all" on public.brand_assets
  for all to service_role using (true) with check (true);

drop policy if exists "brand_assets_select_own" on public.brand_assets;
create policy "brand_assets_select_own" on public.brand_assets
  for select using (auth.uid() = user_id);

grant select on public.brand_assets to authenticated;
-- No insert/update/delete for authenticated: uploads and deletes go through
-- the server (service role) so every add/remove also updates
-- profiles.brand_kit_completed and cleans up the Anthropic-side file —
-- a direct client delete would orphan the file on Anthropic's side.

-- ---------------------------------------------------------------------------
-- New signup -> profile row + signup_events row, in one transaction with the
-- auth.users insert. Fires regardless of which sign-in method was used.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do nothing;

  insert into public.signup_events (user_id, email, provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_app_meta_data ->> 'provider', 'email')
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- check_and_increment_usage — atomic check-then-increment (row-locked via
-- FOR UPDATE), so two concurrent requests from the same tester can't both
-- slip through at message 25. Call from the server, never from the client.
-- ---------------------------------------------------------------------------
create or replace function public.check_and_increment_usage(p_user_id uuid, p_limit int)
returns table (allowed boolean, message_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.usage_daily (user_id, day, message_count)
  values (p_user_id, current_date, 0)
  on conflict (user_id, day) do nothing;

  select u.message_count into v_count
  from public.usage_daily u
  where u.user_id = p_user_id and u.day = current_date
  for update;

  if v_count >= p_limit then
    return query select false, v_count;
  end if;

  update public.usage_daily u
  set message_count = u.message_count + 1
  where u.user_id = p_user_id and u.day = current_date
  returning u.message_count into v_count;

  return query select true, v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_context_note — atomically sets one key in profiles.context_notes
-- without clobbering the others. Used by saveContextField() in
-- server/index.js for the `save_context` tool's free-form facts (structured
-- ones — company_url, company_brief — go through a plain update instead).
-- A single jsonb `||` update, not a read-modify-write from Node, so two
-- concurrent save_context calls in the same turn can't drop one write.
-- ---------------------------------------------------------------------------
create or replace function public.merge_context_note(p_user_id uuid, p_field text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set context_notes = context_notes || jsonb_build_object(p_field, p_value),
      updated_at = now()
  where id = p_user_id;
end;
$$;
