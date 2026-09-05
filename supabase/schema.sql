-- B.L.A.Y.N.E beta — database schema.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste this
-- whole file -> Run. Safe to re-run — every statement is idempotent.
--
-- Core tables:
--   profiles                    one row per tester, extended with the beta signup fields
--                                and the company context the model learns in conversation
--   signup_events                append-only log of every registration, written by a
--                                trigger on auth.users so it captures a signup even if the
--                                person never finishes onboarding or never returns
--   usage_daily                  per-user, per-day message count — what the quota reads
--   brand_assets                 documents a tester has shared (brand manual, deck, etc.),
--                                stored in Cloud Storage and referenced by storage_path
--   (auth.users is Supabase's own table; we don't touch it beyond the trigger)
--
-- Service-routing tables (see server/catalogue/):
--   routing_state                per-thread state backing the recommendation frequency cap
--   routing_events                every routing decision/CTA click/guardrail repair, for Phase 6 observability
--   catalogue_alias_overrides     admin-tuned service aliases, editable without a deploy
--   catalogue_alias_audit         append-only audit trail for the table above, via trigger
--
-- Brand Kit / Document Engine tables (see server/brandKit/, brand-kit.schema.json):
--   organizations                 the tenant boundary — everything Brand Kit and document-related
--                                 hangs off org_id, not user_id (see the comment above the table
--                                 below for why this exists at all)
--   organization_members          who belongs to which org, and their role
--   brand_kits                    versioned per-org design systems, validated against
--                                 brand-kit.schema.json; only one 'active' kit per org at a time
--   brand_kit_assets              the tenant asset store brand_kits.kit_json's asset_id fields
--                                 resolve against — logos, fonts, icon sets, palettes, guidelines,
--                                 sample documents — distinct from brand_assets above, which is
--                                 the older, simpler "attach a file to this chat session" feature
--   documents                     Phase 4 — one row per document generation job (queued through
--                                 rendered), pinned to the exact brand_kits version that will
--                                 render it so a later brand change never rewrites history

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
-- The bytes live in Cloud Storage (server/uploadStorage.js), not here — this
-- row is just the pointer (storage_path) plus enough metadata to list and
-- manage it from the UI. Read back and sent to Claude as an inline content
-- block on every request (see server/index.js) — not uploaded once to an
-- Anthropic-hosted file, since Claude on Vertex AI has no Files API.
-- ---------------------------------------------------------------------------
create table if not exists public.brand_assets (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users (id) on delete cascade not null,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null,
  storage_path  text not null,
  created_at    timestamptz default now() not null
);

-- Migrating from the earlier Anthropic Files API-backed version of this
-- table: any pre-existing row only has an anthropic_file_id, pointing at a
-- file Vertex AI can't read — there's nothing to carry forward, so those
-- rows are dropped and the column retired. The tester just re-attaches from
-- the chat UI.
alter table public.brand_assets add column if not exists storage_path text;
delete from public.brand_assets where storage_path is null;
alter table public.brand_assets drop column if exists anthropic_file_id;
alter table public.brand_assets alter column storage_path set not null;

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
-- profiles.brand_kit_completed and cleans up the Cloud Storage object —
-- a direct client delete would orphan the object in the bucket.
--
-- Unrelated to the brand_kits table below, despite the similar name:
-- brand_kit_completed just means "this tester has attached at least one file
-- to chat" — a pre-existing column from before the Brand Kit / Document
-- Engine feature existed. Left as-is rather than renamed, since it's live
-- product behaviour (see needsBrandAsk in server/blaynePrompt.js).

-- ---------------------------------------------------------------------------
-- organizations / organization_members — the tenant boundary.
--
-- Everything before this point in the file is keyed on auth.users.id
-- directly: one tester, one account, no concept of a company above that.
-- The Brand Kit / Document Engine feature needs a real tenant boundary
-- (brand assets, fonts, generated documents, and signed URLs must all be
-- scoped to something a signed-in user can share with colleagues later, not
-- to one login), so this is new, additive infrastructure rather than a
-- Brand-Kit-specific table.
--
-- Every account gets a personal organization automatically at signup (see
-- handle_new_user() below) so nothing about the existing beta changes for a
-- current tester — they just now also own a one-member org. Multi-member
-- orgs (invite a colleague) aren't built yet; the shape here (a join table
-- with a role column) is deliberately ready for that without a schema
-- change when it arrives.
--
-- No insert/update/delete policy for authenticated on either table: an org
-- is created once, by the signup trigger, and membership changes (inviting
-- someone) would go through the server (service role) the same way
-- brand_assets writes do — there's no invite flow yet, so this is currently
-- write-once from the trigger's point of view.
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz default now() not null
);

alter table public.organizations enable row level security;

drop policy if exists "organizations_service_role_all" on public.organizations;
create policy "organizations_service_role_all" on public.organizations
  for all to service_role using (true) with check (true);

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member" on public.organizations
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = organizations.id and m.user_id = auth.uid()
    )
  );

grant select on public.organizations to authenticated;

create table if not exists public.organization_members (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'owner', -- 'owner' | 'admin' | 'member' — only 'owner' is ever set today
  created_at  timestamptz default now() not null,
  primary key (org_id, user_id)
);

alter table public.organization_members enable row level security;

drop policy if exists "organization_members_service_role_all" on public.organization_members;
create policy "organization_members_service_role_all" on public.organization_members
  for all to service_role using (true) with check (true);

drop policy if exists "organization_members_select_own" on public.organization_members;
create policy "organization_members_select_own" on public.organization_members
  for select using (user_id = auth.uid());

grant select on public.organization_members to authenticated;

-- Backfill: every profiles row that predates this migration gets the same
-- "personal org" treatment the signup trigger now gives new accounts, so no
-- existing tester is left without an org_id to hang a Brand Kit off. Guarded
-- by "not exists a membership row yet" so re-running this file is a no-op
-- for anyone already backfilled (or created after this migration first ran).
with new_orgs as (
  insert into public.organizations (name, created_by)
  select coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)) || '''s workspace', p.id
  from public.profiles p
  where not exists (
    select 1 from public.organization_members m where m.user_id = p.id
  )
  returning id, created_by
)
insert into public.organization_members (org_id, user_id, role)
select id, created_by, 'owner' from new_orgs
on conflict (org_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- brand_kits — versioned per-org design systems (see brand-kit.schema.json
-- and server/brandKit/). kit_json is the full structure validated against
-- that schema; a kit change creates a new version rather than overwriting
-- one in place, so a document generated under version 3 keeps rendering
-- under version 3's tokens even after version 4 goes active — see
-- documents.brand_kit_id (Phase 4, not yet in this file).
--
-- Only one 'active' kit per org, enforced at the database level (the
-- partial unique index below), not just in application code — "a Brand Kit
-- is not usable until a human confirms it" is a correctness property, not a
-- UI nicety, and a race between two confirm clicks should fail loudly
-- rather than silently produce two active kits.
--
-- No insert/update policy for authenticated: draft creation, extraction, and
-- the confirm step (draft -> awaiting_review -> active) all go through the
-- server, same reasoning as brand_assets and organizations above.
-- ---------------------------------------------------------------------------
create table if not exists public.brand_kits (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  version       int not null,
  status        text not null default 'draft', -- 'draft' | 'awaiting_review' | 'active' | 'archived' — see brand-kit.schema.json
  kit_json      jsonb not null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz default now() not null,
  confirmed_at  timestamptz,
  confirmed_by  uuid references auth.users (id) on delete set null,
  unique (org_id, version)
);

create unique index if not exists brand_kits_one_active_per_org
  on public.brand_kits (org_id)
  where status = 'active';

alter table public.brand_kits enable row level security;

drop policy if exists "brand_kits_service_role_all" on public.brand_kits;
create policy "brand_kits_service_role_all" on public.brand_kits
  for all to service_role using (true) with check (true);

drop policy if exists "brand_kits_select_member" on public.brand_kits;
create policy "brand_kits_select_member" on public.brand_kits
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = brand_kits.org_id and m.user_id = auth.uid()
    )
  );

grant select on public.brand_kits to authenticated;

-- ---------------------------------------------------------------------------
-- brand_kit_assets — the tenant asset store. Every asset_id referenced
-- inside a brand_kits.kit_json (logos, font_files, custom_set_asset_ids,
-- sample_document_asset_ids, and Document IR image blocks later) resolves
-- against a row here. Distinct from brand_assets (see the note on that
-- table above): that table is loose files attached to a chat session by one
-- user; this table is the reviewed, org-scoped asset library the renderer
-- and extraction pipeline actually read from.
--
-- extracted holds whatever server/brandKit/extractors/* deterministically
-- pulled from the file at upload time (hex colours found, a font's internal
-- family name, image dimensions/transparency, SVG stroke weight, and so
-- on) — the draft Brand Kit's provenance map (see brand-kit.schema.json)
-- points back at this via source_asset_id, not the other way around.
--
-- license_attested and its companion columns are the font-licensing gate
-- from the brief: a font file's rows here start unattested, and
-- server/brandKit/* must refuse to let the renderer use one until an org
-- member has explicitly attested to holding a licence — recorded here with
-- who and when, never inferred from the family name matching some other
-- tenant's already-attested font.
-- ---------------------------------------------------------------------------
create table if not exists public.brand_kit_assets (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  kind                  text not null, -- 'guideline' | 'corporate_profile' | 'logo' | 'palette' | 'font' | 'icon_set' | 'sample_document'
  file_name             text not null,
  mime_type             text not null,
  size_bytes            bigint not null,
  storage_path          text not null,
  page_count            int,
  extracted             jsonb default '{}'::jsonb not null,
  license_attested      boolean default false not null,
  license_attested_by   uuid references auth.users (id) on delete set null,
  license_attested_at   timestamptz,
  license_type          text,
  embedding_permitted   boolean,
  virus_scan_status     text not null default 'pending', -- 'pending' | 'clean' | 'infected' | 'skipped_dev'
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz default now() not null
);

alter table public.brand_kit_assets enable row level security;

drop policy if exists "brand_kit_assets_service_role_all" on public.brand_kit_assets;
create policy "brand_kit_assets_service_role_all" on public.brand_kit_assets
  for all to service_role using (true) with check (true);

drop policy if exists "brand_kit_assets_select_member" on public.brand_kit_assets;
create policy "brand_kit_assets_select_member" on public.brand_kit_assets
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = brand_kit_assets.org_id and m.user_id = auth.uid()
    )
  );

grant select on public.brand_kit_assets to authenticated;
-- No insert/update/delete for authenticated — uploads, extraction, and
-- deletes all go through the server (service role), same reasoning as
-- brand_assets: a direct client delete would orphan the GCS object, and a
-- direct client write could bypass virus scanning or the license gate.

-- ---------------------------------------------------------------------------
-- New signup -> profile row + signup_events row + a personal organization
-- (see "Brand Kit / Document Engine tables" above for why every account
-- needs an org, not just a profile), all in one transaction with the
-- auth.users insert. Fires regardless of which sign-in method was used.
--
-- The org name is a placeholder ("<name>'s workspace") — company_name isn't
-- known yet at signup time, it's collected during onboarding. Nothing
-- currently lets a tester rename their org; that's fine for a single-member
-- workspace and becomes a real gap once team invites exist.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
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

  insert into public.organizations (name, created_by)
  values (
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1)
    ) || '''s workspace',
    new.id
  )
  returning id into v_org_id;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org_id, new.id, 'owner');

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
-- routing_state — the service-routing frequency cap's per-thread state (see
-- server/catalogue/routingState.js). thread_id is a client-generated id with
-- no other row anywhere referencing it — this app has no persisted
-- conversation history (the client resends full message history every
-- turn; see ChatPage.jsx), so this table exists solely to remember "has
-- this thread already gotten a recommendation for this need" without
-- trusting the model to track it across turns.
-- ---------------------------------------------------------------------------
create table if not exists public.routing_state (
  thread_id                  text primary key,
  user_id                    uuid references auth.users (id) on delete cascade,
  recommended_service_ids    jsonb default '[]'::jsonb not null,
  last_shown_at              timestamptz default now() not null
);

alter table public.routing_state enable row level security;

drop policy if exists "routing_state_service_role_all" on public.routing_state;
create policy "routing_state_service_role_all" on public.routing_state
  for all to service_role using (true) with check (true);
-- No authenticated/anon policy — this is server-internal bookkeeping, never
-- read or written directly by the client.

-- ---------------------------------------------------------------------------
-- routing_events — Phase 6 observability for the service-routing layer (see
-- server/catalogue/events.js). One row per routing decision or CTA click;
-- this is a new table rather than new infrastructure (no GA4/BigQuery/
-- Segment exists in this app) — queryable directly from the Supabase
-- dashboard, same as usage_daily already is, for the one question that
-- matters commercially: how many conversations turn into consultations, and
-- from which service category.
-- ---------------------------------------------------------------------------
create table if not exists public.routing_events (
  id                          bigint generated always as identity primary key,
  kind                        text not null,   -- 'decision' | 'cta_click' | 'guardrail_repair'
  thread_id                   text,
  user_id                     uuid references auth.users (id) on delete set null,
  verdict                     text,            -- 'in_scope' | 'partly_in_scope' | 'out_of_scope'
  matched_service_ids         jsonb,
  confidence_scores           jsonb,
  recommendation_shown        boolean,
  frequency_capped            boolean,
  disclosure_required         boolean,
  disclosure_present          boolean,
  violations                  jsonb,
  created_at                  timestamptz default now() not null
);

alter table public.routing_events enable row level security;

drop policy if exists "routing_events_service_role_all" on public.routing_events;
create policy "routing_events_service_role_all" on public.routing_events
  for all to service_role using (true) with check (true);
-- No authenticated/anon policy, same reasoning as signup_events — this
-- table is for Blayne's Consulting, not the app's own client.

-- ---------------------------------------------------------------------------
-- catalogue_alias_overrides / catalogue_alias_audit — Phase 8's "no deploy
-- needed" alias tuning. The catalogue itself (name/description/outcome) stays
-- a reviewed, git-versioned file (catalogue/blaynes-services.json, uploaded
-- to GCS — see server/catalogue/loader.js); only aliases get a live-editable
-- layer here, because aliases are the one part of the catalogue that needs
-- constant tuning once real traffic arrives and shouldn't need an engineer.
--
-- Editing surface: the Supabase Table Editor directly on
-- catalogue_alias_overrides — deliberately not a bespoke internal UI (see
-- server/catalogue/aliasOverrides.js for the reasoning). The audit trail is
-- the trigger below, not application code, so it captures every insert/
-- delete regardless of what writes to this table.
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_alias_overrides (
  id            bigint generated always as identity primary key,
  service_id    text not null,   -- must match an id in catalogue/blaynes-services.json; not FK-enforced, since the catalogue lives in GCS, not Postgres
  alias         text not null,
  added_by      text,            -- free text: whoever edited the row noted their name/email
  created_at    timestamptz default now() not null,
  unique (service_id, alias)
);

alter table public.catalogue_alias_overrides enable row level security;

drop policy if exists "catalogue_alias_overrides_service_role_all" on public.catalogue_alias_overrides;
create policy "catalogue_alias_overrides_service_role_all" on public.catalogue_alias_overrides
  for all to service_role using (true) with check (true);
-- Intentionally no authenticated/anon policy: this table is edited from the
-- Supabase dashboard by the Blayne's Consulting team (governed by their own
-- Supabase project access), not from the deployed app.

create table if not exists public.catalogue_alias_audit (
  id            bigint generated always as identity primary key,
  action        text not null,   -- 'insert' | 'delete'
  service_id    text not null,
  alias         text not null,
  changed_by    text,
  changed_at    timestamptz default now() not null
);

alter table public.catalogue_alias_audit enable row level security;

drop policy if exists "catalogue_alias_audit_service_role_all" on public.catalogue_alias_audit;
create policy "catalogue_alias_audit_service_role_all" on public.catalogue_alias_audit
  for all to service_role using (true) with check (true);
-- Append-only from the trigger below; no update/delete policy for anyone —
-- same "this is the record, not a working table" shape as signup_events.

create or replace function public.log_catalogue_alias_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.catalogue_alias_audit (action, service_id, alias, changed_by)
    values ('insert', new.service_id, new.alias, new.added_by);
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.catalogue_alias_audit (action, service_id, alias, changed_by)
    values ('delete', old.service_id, old.alias, old.added_by);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists catalogue_alias_overrides_audit on public.catalogue_alias_overrides;
create trigger catalogue_alias_overrides_audit
  after insert or delete on public.catalogue_alias_overrides
  for each row execute function public.log_catalogue_alias_change();

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

-- ---------------------------------------------------------------------------
-- documents — Phase 4's generation-job table (server/brandKit/documents/).
-- One row per attempt to turn a brief into a rendered file: created
-- 'queued' by enqueueDocument(), then walked through
-- 'assembling' (the one model call, assembleIr.js) -> 'rendering' (the
-- deterministic Phase 3 renderer, reused as-is) -> 'complete' or 'failed'
-- by an in-process background job (jobs.js's processDocument()) — see that
-- file's doc comment for why this is deliberately not yet the real "Cloud
-- Run Jobs + Cloud Tasks" dispatch called out as undecided in
-- Dockerfile.render and render/index.js.
--
-- brand_kit_id is "on delete restrict", not cascade: a document must keep
-- pointing at the exact Brand Kit version that rendered it even after a
-- newer version goes active (see the "Phase 4 documents will record which
-- kit version rendered them" note on brand_kits above and on the
-- DELETE /drafts/:id route in server/brandKit/routes.js) — restrict makes
-- that a database-level guarantee, not just app-code discipline.
--
-- No insert/update/delete for authenticated: a document is created only via
-- the generate_document chat tool or POST /api/brand-kit/documents, both of
-- which run as the server (service role) — same reasoning as brand_kits.
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  brand_kit_id  uuid not null references public.brand_kits (id) on delete restrict,
  doc_type      text not null, -- one of document-ir.schema.json's meta.doc_type enum values
  title         text not null,
  format        text not null, -- 'pdf' | 'docx'
  brief         text not null, -- whatever the client and Blayne worked out in chat — the model's only input besides the Brand Kit
  status        text not null default 'queued', -- 'queued' | 'assembling' | 'rendering' | 'complete' | 'failed'
  ir_json       jsonb,
  storage_path  text,
  warnings      jsonb default '[]'::jsonb not null,
  error         text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz default now() not null,
  completed_at  timestamptz
);

create index if not exists documents_org_created_at on public.documents (org_id, created_at desc);

alter table public.documents enable row level security;

drop policy if exists "documents_service_role_all" on public.documents;
create policy "documents_service_role_all" on public.documents
  for all to service_role using (true) with check (true);

drop policy if exists "documents_select_member" on public.documents;
create policy "documents_select_member" on public.documents
  for select using (
    exists (
      select 1 from public.organization_members m
      where m.org_id = documents.org_id and m.user_id = auth.uid()
    )
  );

grant select on public.documents to authenticated;
