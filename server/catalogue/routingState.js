/**
 * The frequency cap ("one recommendation per thread unless the user asks
 * again or raises a new need") as real per-thread state — not a rule the
 * model is trusted to remember across a long conversation. See
 * routing_state in supabase/schema.sql.
 *
 * There is no conversation/thread persistence anywhere else in this app
 * (server/index.js resends the full message history from client state every
 * turn — see ChatPage.jsx) — thread_id is a new, minimal concept introduced
 * just for this: the client generates one crypto.randomUUID() per chat
 * session (src/lib/chat.js) and sends it on every /api/chat call. This table
 * is the only thing that needs it; it deliberately does not become a general
 * conversation-history store.
 *
 * "Raises a new need" is judged by service_id overlap: if the newly matched
 * services aren't a subset of what's already been shown in this thread, it's
 * a new need and the cap doesn't block it. A literal repeat of the same
 * need's services is what gets suppressed. This can't perfectly detect "the
 * user is asking again" in words (that's left to the model, which sees the
 * full conversation) — it only guarantees the mechanical floor: the exact
 * same recommendation never fires twice in one thread without a reason.
 */
import { supabaseAdmin, hasSupabase } from '../supabaseAdmin.js';

async function getState(threadId) {
  if (!hasSupabase || !threadId) return null;
  const { data, error } = await supabaseAdmin
    .from('routing_state')
    .select('recommended_service_ids')
    .eq('thread_id', threadId)
    .maybeSingle();
  if (error) {
    console.error('[blayne] routing_state lookup failed:', error.message);
    return null;
  }
  return data;
}

/**
 * Pure decision logic, split out from the Supabase lookup so it's testable
 * without a database — see test/routing-state.test.js. "New need" = at
 * least one matched service wasn't already shown in this thread.
 */
export function computeCapped(alreadyShownServiceIds, matchedServiceIds) {
  if (!matchedServiceIds.length) return false;
  const alreadyShown = new Set(alreadyShownServiceIds);
  if (!alreadyShown.size) return false;
  const isNewNeed = matchedServiceIds.some((id) => !alreadyShown.has(id));
  return !isNewNeed;
}

/**
 * Decides whether this match set is blocked by the cap, without writing
 * anything — call recordShown() separately once the model's turn actually
 * includes the recommendation (not just because the tool was called; a
 * call doesn't guarantee the model surfaces it verbatim).
 */
export async function checkFrequencyCap(threadId, matchedServiceIds) {
  const state = await getState(threadId);
  return { capped: computeCapped(state?.recommended_service_ids ?? [], matchedServiceIds) };
}

/** Records that this thread has now seen a recommendation for these services. */
export async function recordShown(threadId, userId, matchedServiceIds) {
  if (!hasSupabase || !threadId || !matchedServiceIds.length) return;
  const state = await getState(threadId);
  const merged = Array.from(new Set([...(state?.recommended_service_ids ?? []), ...matchedServiceIds]));

  const { error } = await supabaseAdmin
    .from('routing_state')
    .upsert(
      { thread_id: threadId, user_id: userId, recommended_service_ids: merged, last_shown_at: new Date().toISOString() },
      { onConflict: 'thread_id' },
    );
  if (error) console.error('[blayne] could not record routing_state:', error.message);
}
