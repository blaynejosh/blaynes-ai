/**
 * Observability for the routing layer — Phase 6. This app has no existing
 * analytics pipeline (no GA4/BigQuery/Segment — grep confirms it; only
 * Cloud Logging via console.log/error, which is incidental to Cloud Run, not
 * a deliberate sink). routing_events is a new Supabase table rather than new
 * infrastructure, matching how usage_daily/profiles/brand_assets already
 * work — queryable straight from the Supabase dashboard for the one
 * question that matters commercially: how many conversations turn into
 * consultations, and from which category.
 *
 * Fire-and-forget: a logging failure must never break the chat turn it's
 * describing. Every call here catches and logs its own error.
 */
import { supabaseAdmin, hasSupabase } from '../supabaseAdmin.js';

/**
 * One row per routing decision (every search_blaynes_services call), whether
 * or not it produced a recommendation the user actually saw. Whether the
 * disclosure actually landed in the user-visible text isn't known yet at
 * this point in the turn (the model writes its answer *after* the tool
 * result) — see logGuardrailCheck, logged once the full turn's text exists.
 */
export async function logRoutingDecision({ threadId, userId, verdict, matches, frequencyCapped }) {
  if (!hasSupabase) return;
  const { error } = await supabaseAdmin.from('routing_events').insert({
    kind: 'decision',
    thread_id: threadId,
    user_id: userId,
    verdict,
    matched_service_ids: matches.map((m) => m.service_id),
    confidence_scores: matches.map((m) => m.confidence),
    recommendation_shown: verdict !== 'out_of_scope' && !frequencyCapped,
    frequency_capped: frequencyCapped,
  });
  if (error) console.error('[blayne] failed to log routing_events decision:', error.message);
}

/**
 * One row per turn where the guardrail pass (server/guardrails.js) actually
 * ran a repair — i.e. disclosure was required and/or a violation was
 * caught. Silent (no row) when the turn was clean, to keep this table
 * signal, not noise.
 */
export async function logGuardrailCheck({ threadId, disclosureRequired, disclosurePresentBeforeRepair, violations }) {
  if (!hasSupabase || !violations.length) return;
  const { error } = await supabaseAdmin.from('routing_events').insert({
    kind: 'guardrail_repair',
    thread_id: threadId,
    disclosure_required: disclosureRequired,
    disclosure_present: disclosurePresentBeforeRepair,
    violations,
  });
  if (error) console.error('[blayne] failed to log routing_events guardrail_repair:', error.message);
}

/** One row per CTA click — see the /api/cta/:serviceId redirect in index.js. */
export async function logCtaClick({ threadId, serviceId }) {
  if (!hasSupabase) return;
  const { error } = await supabaseAdmin.from('routing_events').insert({
    kind: 'cta_click',
    thread_id: threadId,
    matched_service_ids: [serviceId],
  });
  if (error) console.error('[blayne] failed to log routing_events cta_click:', error.message);
}
