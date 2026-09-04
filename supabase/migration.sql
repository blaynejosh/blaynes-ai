-- Service-routing layer — standalone Supabase migration.
--
-- Paste this whole file into the Supabase dashboard: SQL Editor -> New
-- query -> paste -> Run. Safe to re-run — every statement is idempotent.
-- Purely additive: four new tables, nothing here touches or reads any
-- existing table (profiles, usage_daily, brand_assets, signup_events).
--
-- This is a standalone extraction of the same block that lives in
-- supabase/schema.sql (search that file for "routing_state" to find it) —
-- schema.sql is the canonical, full-database source of truth; this file
-- exists only so this one addition can be copied and run on its own without
-- re-running (or diffing against) the rest of the schema. If the two ever
-- drift, schema.sql wins — re-sync this file from it, not the other way
-- around.
--
-- What each table is for:
--   routing_state              per-thread state backing the recommendation frequency cap
--                               (server/catalogue/routingState.js) — "don't recommend the
--                               same thing twice in one conversation"
--   routing_events              every routing decision / CTA click / guardrail repair,
--                               for Phase 6 observability (server/catalogue/events.js) —
--                               query this to see conversations -> consultations by category
--   catalogue_alias_overrides   admin-tuned service aliases, editable right here in the
--                               Table Editor without a deploy (server/catalogue/aliasOverrides.js)
--   catalogue_alias_audit       append-only audit trail for the table above, via trigger —
--                               populated automatically, never write to this one directly

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
