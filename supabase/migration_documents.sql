-- Brand Kit / Document Engine, Phase 4 — standalone Supabase migration.
--
-- Paste this whole file into the Supabase dashboard: SQL Editor -> New
-- query -> paste -> Run. Safe to re-run — every statement is idempotent.
-- Requires supabase/migration_brand_kit.sql (organizations, brand_kits) to
-- already be applied — this migration references both.
--
-- This is a standalone extraction of the same block that lives in
-- supabase/schema.sql (search that file for "documents —" to find it) —
-- schema.sql is the canonical, full-database source of truth; this file
-- exists only so this one addition can be copied and run on its own. If the
-- two ever drift, schema.sql wins — re-sync this file from it.
--
-- documents — one row per document generation job, from 'queued' through
-- 'assembling' (the model call that writes the Document IR), 'rendering'
-- (the deterministic Phase 3 renderer), to 'complete' or 'failed'. Pinned
-- to the exact brand_kits version that rendered it ("on delete restrict")
-- so a later brand change never rewrites a past document's history. See
-- server/brandKit/documents/ for the pipeline that reads and writes it.

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  brand_kit_id  uuid not null references public.brand_kits (id) on delete restrict,
  doc_type      text not null,
  title         text not null,
  format        text not null,
  brief         text not null,
  status        text not null default 'queued',
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
