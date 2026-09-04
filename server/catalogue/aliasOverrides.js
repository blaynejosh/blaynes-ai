/**
 * Admin-tuned alias overrides (Phase 8) — the "no deploy needed" layer on
 * top of the reviewed catalogue/blaynes-services.json.
 *
 * Editing surface: the Supabase Table Editor, directly on
 * catalogue_alias_overrides (see supabase/schema.sql) — already an
 * internal-only surface (it's the same Supabase project dashboard the team
 * uses for everything else) gated by the team's own Supabase project
 * access, so this deliberately does not add a bespoke internal admin UI on
 * top of it (the task's own instruction: no user-facing UI beyond what a
 * recommendation needs). Every insert/delete on that table is captured by a
 * trigger into catalogue_alias_audit, which is the audit trail the spec
 * asks for — automatic regardless of whether a row was added via the Table
 * Editor or anything else that writes to it later.
 *
 * Scope: lexical matching only, not embeddings. Re-embedding on every alias
 * edit would mean an admin's aliases tweak has to wait on a Vertex AI call
 * before it can help matching, and would quietly reintroduce a "needs an
 * engineer to run a script" step into a feature whose entire point is that
 * it doesn't. An override alias is exactly the phrase an admin has seen
 * users type and knows should hit a service — matching it verbatim (see
 * bestLexicalScore in search.js) is what closes that gap. The embedding
 * layer already covers unanticipated paraphrase; overrides cover known,
 * observed misses.
 *
 * Cached with a short TTL (not per-request, not process-lifetime like
 * skills/uploads) — long enough that this isn't a Supabase round trip on
 * every /api/chat call, short enough that an admin's edit takes effect
 * within a few minutes without a restart.
 */
import { supabaseAdmin, hasSupabase } from '../supabaseAdmin.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null;
let cachedAt = 0;

async function fetchOverrides() {
  const { data, error } = await supabaseAdmin
    .from('catalogue_alias_overrides')
    .select('service_id, alias');
  if (error) throw error;

  const map = new Map();
  for (const row of data ?? []) {
    if (!map.has(row.service_id)) map.set(row.service_id, []);
    map.get(row.service_id).push(row.alias);
  }
  return map;
}

/** Returns Map<service_id, string[]> — empty map if Supabase isn't configured or the fetch fails. */
export async function getAliasOverrides() {
  if (!hasSupabase) return new Map();

  const age = Date.now() - cachedAt;
  if (cache && age < CACHE_TTL_MS) return cache;

  try {
    cache = await fetchOverrides();
    cachedAt = Date.now();
  } catch (err) {
    console.error('[blayne] could not load catalogue alias overrides, using last known set:', err.message);
    if (!cache) cache = new Map();
  }
  return cache;
}
