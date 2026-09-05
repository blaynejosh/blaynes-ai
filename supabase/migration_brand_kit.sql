-- Brand Kit / Document Engine, Phase 1 — standalone Supabase migration.
--
-- Paste this whole file into the Supabase dashboard: SQL Editor -> New
-- query -> paste -> Run. Safe to re-run — every statement is idempotent.
--
-- This is a standalone extraction of the same block that lives in
-- supabase/schema.sql (search that file for "organizations" to find it) —
-- schema.sql is the canonical, full-database source of truth; this file
-- exists only so this one addition can be copied and run on its own without
-- re-running (or diffing against) the rest of the schema. If the two ever
-- drift, schema.sql wins — re-sync this file from it, not the other way
-- around.
--
-- Unlike supabase/migration.sql (the routing-layer addition), this one is
-- NOT purely additive: it replaces public.handle_new_user() so every new
-- signup also gets a personal organization, and it backfills one for every
-- existing profiles row. Nothing existing is dropped or renamed.
--
-- What each table is for:
--   organizations         the tenant boundary — see the long comment in
--                          schema.sql for why this exists (short version:
--                          everything before this migration was keyed on
--                          auth.users.id directly, with no concept of a
--                          company above one login, and Brand Kit needs one)
--   organization_members   who belongs to which org, and their role. Every
--                          account gets a personal, one-member org
--                          automatically; multi-member orgs (inviting a
--                          colleague) aren't built yet — this table's shape
--                          is just ready for it
--   brand_kits             versioned per-org design systems, validated
--                          against brand-kit.schema.json in the repo root.
--                          Only one 'active' kit per org at a time, enforced
--                          by a partial unique index, not just app code
--   brand_kit_assets       the tenant asset store — logos, fonts, icon
--                          sets, palettes, guidelines, sample documents —
--                          that brand_kits.kit_json's asset_id fields
--                          resolve against. Distinct from the existing
--                          brand_assets table (loose chat attachments)

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- organizations / organization_members
-- ---------------------------------------------------------------------------
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
  role        text not null default 'owner',
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

-- Backfill for every profiles row that predates this migration. Guarded by
-- "not exists a membership row yet", so re-running is a no-op once applied.
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
-- brand_kits
-- ---------------------------------------------------------------------------
create table if not exists public.brand_kits (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  version       int not null,
  status        text not null default 'draft',
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
-- brand_kit_assets
-- ---------------------------------------------------------------------------
create table if not exists public.brand_kit_assets (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id) on delete cascade,
  kind                  text not null,
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
  virus_scan_status     text not null default 'pending',
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

-- ---------------------------------------------------------------------------
-- handle_new_user() — replaces the existing trigger function so every new
-- signup also gets a personal organization. The trigger itself
-- (on_auth_user_created) already exists and doesn't need recreating; this
-- CREATE OR REPLACE is what changes its behaviour.
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
