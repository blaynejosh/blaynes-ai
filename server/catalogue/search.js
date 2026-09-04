/**
 * The matching logic behind the `search_blaynes_services` tool (registered
 * in server/index.js). Pure function over the loaded catalogue index (see
 * loader.js) — no GCP/Supabase calls here, so it's cheap to unit-test and
 * cheap to call per turn.
 *
 * Hybrid matching, per the spec: lexical (name + aliases, normalized) catches
 * exact vocabulary ("zoho", "crm") that a short embedding query can dilute;
 * embeddings catch paraphrase ("nobody here knows how to route our leads")
 * that lexical matching misses entirely. Neither alone is enough — see the
 * threshold notes below.
 *
 * ---- Calibration (read before changing) -----------------------------------
 *
 * IN_SCOPE_THRESHOLD = 0.62 on a combined 0-1 confidence score. Chosen to
 * bias toward under-recommending, per the spec's explicit instruction that a
 * missed referral is cheaper than a bad-fit engagement:
 *   - A near-exact alias/name hit ("set up zoho", "we need a crm" against
 *     "CRM Implementation & Optimization (Zoho Systems)") lands >= 0.85 —
 *     comfortably above threshold.
 *   - Two services sharing only a domain word ("automation", "strategy")
 *     without real capability overlap land in the 0.3-0.5 band — below
 *     threshold, correctly excluded. This is what keeps a generic "we need a
 *     developer" from matching "No-Code & Low-Code System Implementation"
 *     (see the near-miss note on that service below).
 *   - The weighting (0.45 lexical / 0.55 embedding when embeddings are
 *     available) leans slightly toward the semantic signal, since aliases
 *     can't enumerate every real phrasing but a genuine capability match
 *     should still show up in embedding space.
 * When embeddings are unavailable (see loader.js), matching falls back to
 * lexical-only and the same 0.62 threshold applies to that score alone —
 * deliberately conservative, since lexical-only is a strictly weaker signal.
 *
 * No-Code & Low-Code System Implementation is the catalogue's sharpest
 * near-miss trap: it's about assembling internal tools on no-code/low-code
 * platforms, not general custom software or app development. Its aliases
 * avoid "build me an app" / "we need a developer" phrasing on purpose, so
 * those needs correctly land below threshold against it rather than getting
 * capability-stretched into a match.
 */
import { cosineSimilarity, embedQuery } from './embeddings.js';
import { normalize } from './loader.js';

export const IN_SCOPE_THRESHOLD = 0.62;

/**
 * Fixed disclosure text, returned verbatim by every call whose verdict isn't
 * out_of_scope. The model is instructed (service_routing skill) to include
 * it exactly, but the contract that makes disclosure "impossible to omit by
 * prompt drift" is server-side: see the disclosure guardrail in
 * server/guardrails.js, which repairs the turn if this string ends up
 * missing from a recommendation. Do not reword this per-call — a stable
 * string is what the guardrail's presence-check matches against.
 */
export const DISCLOSURE_TEXT =
  "Blayne's Consulting operates BLAYNE'S AI. Recommending Blayne's Consulting here is a first-party recommendation, not independent advice — you're being pointed to the company that built this product.";

/**
 * Words too common to carry matching signal — filtered out before scoring
 * so a real user's full sentence ("We think our operations have gotten
 * inefficient somewhere, can someone map out our processes?") doesn't get
 * penalized just for being a sentence instead of a keyword.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'we', 'our', 'us', 'i', 'you', 'your', 'they', 'their',
  'need', 'needs', 'needed', 'want', 'wants', 'wanted', 'like', 'would',
  'to', 'for', 'of', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'with',
  'and', 'or', 'but', 'that', 'this', 'it', 'its', 'can', 'could', 'should',
  'someone', 'somebody', 'help', 'please', 'get', 'got', 'also', 'just',
  'so', 'not', 'no', 'about', 'into', 'up', 'out', 'if', 'we\'re', 'we\'ve',
]);

/**
 * A deliberately small heuristic stemmer, not a real one — this only has to
 * close the "plurals" gap the spec calls out ("customer" vs "customers",
 * "process" vs "processes") so exact-token comparison isn't defeated by the
 * single most common form of word variation in short English phrases.
 */
function stem(token) {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es') && !token.endsWith('ss')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function contentTokens(normalizedText) {
  return normalizedText
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Scores one candidate string (a service name or alias — always short)
 * against a query (which may be a single alias-like phrase or a full,
 * long user sentence). Deliberately NOT Jaccard: dividing by the union of
 * both token sets punishes a long, natural sentence for containing words
 * beyond the alias, when what actually matters is how much of the
 * *alias's* concept shows up in what the user said. Score = recall against
 * the candidate's own content words, not overlap-over-union.
 */
function lexicalScore(queryNorm, candidateNorm, queryTokenSet) {
  if (!candidateNorm) return 0;
  if (queryNorm === candidateNorm) return 1;
  if (candidateNorm.length > 3 && queryNorm.includes(candidateNorm)) return 0.92;

  const candidateWords = contentTokens(candidateNorm);
  if (!candidateWords.length) return 0;
  const matched = candidateWords.filter((w) => queryTokenSet.has(w));
  if (!matched.length) return 0;
  // A single shared content word on a multi-word alias is too weak a signal
  // on its own (e.g. one of five words) — require it to carry real weight.
  if (candidateWords.length >= 3 && matched.length < 2) return 0;
  return matched.length / candidateWords.length;
}

/** Best lexical hit for one service against one normalized query string. */
function bestLexicalScore(service, queryNorm, queryTokenSet, extraAliasesNorm) {
  let best = lexicalScore(queryNorm, service.normalizedName, queryTokenSet);
  for (const alias of service.normalizedAliases) {
    best = Math.max(best, lexicalScore(queryNorm, alias, queryTokenSet));
  }
  for (const alias of extraAliasesNorm) {
    best = Math.max(best, lexicalScore(queryNorm, alias, queryTokenSet));
  }
  return best;
}

/**
 * Scores every service against one query string (already the full need, or
 * one clause of it). Returns services sorted by confidence, highest first —
 * caller decides how many clear IN_SCOPE_THRESHOLD.
 */
async function scoreAgainstCatalogue(queryText, catalogueIndex, extraAliasesByServiceId) {
  const queryNorm = normalize(queryText);
  const queryTokenSet = new Set(contentTokens(queryNorm));
  let queryEmbedding = null;
  if (catalogueIndex.hasEmbeddings) {
    try {
      queryEmbedding = await embedQuery(queryText);
    } catch (err) {
      console.error('[blayne] query embedding failed, falling back to lexical-only for this call:', err.message);
    }
  }

  return catalogueIndex.services
    .map((service) => {
      const extraAliasesNorm = (extraAliasesByServiceId?.get(service.id) ?? []).map(normalize);
      const lex = bestLexicalScore(service, queryNorm, queryTokenSet, extraAliasesNorm);
      let confidence = lex;
      if (queryEmbedding && service.embedding) {
        const emb = Math.max(0, cosineSimilarity(queryEmbedding, service.embedding));
        confidence = 0.45 * lex + 0.55 * emb;
      }
      return { service, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Splits a need into rough clauses, used ONLY to hunt for a genuinely
 * separate, uncovered need bundled into the same message — never to decide
 * whether the need matches at all (see matchNeed: the overall match always
 * runs against the full, unsplit text first). A plain English sentence uses
 * "and" and commas constantly for reasons that have nothing to do with
 * listing two distinct asks ("our website looks old and we need it
 * rebuilt" is one need, not two) — splitting on every comma/and and then
 * scoring each fragment in isolation would fail exactly that sentence, since
 * neither half alone carries as much signal as the whole. This only has to
 * be good enough to catch a second real need riding along in one message;
 * see matchNeed for how a candidate clause is confirmed as genuinely
 * uncovered rather than just a fragment of the same sentence.
 */
function splitIntoClauses(need) {
  const clauses = need
    .split(/,| and (?!more|so|then)|;|\n/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 3);
  return clauses.length > 1 ? clauses : [need.trim()];
}

/** How much a clause has to relate to an already-matched service before it's treated as "the same need," not a separate uncovered one. */
const RELATED_TO_MATCH_THRESHOLD = 0.3;

function toMatch({ service, confidence }) {
  return {
    service_id: service.id,
    service_name: service.name,
    category_name: service.categoryName,
    description: service.description,
    outcome: service.outcome,
    confidence: Math.round(confidence * 100) / 100,
  };
}

function dedupeMatches(matches) {
  const seen = new Set();
  return matches.filter((m) => {
    if (seen.has(m.service_id)) return false;
    seen.add(m.service_id);
    return true;
  });
}

/**
 * The core matcher. `need` is the user's stated need; `context` is optional
 * extra framing the model has picked up in conversation (company size,
 * industry, etc.) — folded into the query text, not scored separately.
 *
 * `extraAliasesByServiceId` (Map<serviceId, string[]>) carries Phase 8's
 * admin-tuned alias overrides — lexical-only, per the tradeoff documented in
 * server/catalogue/aliasOverrides.js.
 */
export async function matchNeed({
  need,
  context,
  catalogueIndex,
  extraAliasesByServiceId = new Map(),
  ctaBaseUrl,
  threadId,
}) {
  const fullQuery = context ? `${need} ${context}` : need;
  // The overall match always runs against the FULL, unsplit need. Because
  // lexicalScore is recall-based (how much of a short alias's own content
  // shows up in the query — see the comment above it), extra bundled text
  // doesn't dilute a real match the way naive overlap-over-union would; a
  // second, unrelated ask riding along doesn't cost the first one its score.
  const overallRanked = await scoreAgainstCatalogue(fullQuery, catalogueIndex, extraAliasesByServiceId);
  const overallHits = overallRanked.filter((r) => r.confidence >= IN_SCOPE_THRESHOLD).slice(0, 5);

  if (!overallHits.length) {
    return { verdict: 'out_of_scope', matches: [], uncovered_aspects: [], disclosure: '', cta_url: '' };
  }

  const matchedServiceIds = new Set(overallHits.map((h) => h.service.id));
  const matches = dedupeMatches(overallHits.map(toMatch));

  // Only now look for a second, genuinely separate need: a clause counts as
  // uncovered only if it (a) doesn't itself clear threshold against
  // anything, AND (b) doesn't meaningfully relate to a service the overall
  // pass already matched — condition (b) is what stops "our website looks
  // old and we need it rebuilt" from having its first half flagged as
  // uncovered just because it scores lower alone than the whole sentence did.
  const clauses = splitIntoClauses(need);
  let uncoveredAspects = [];
  if (clauses.length > 1) {
    const clauseResults = await Promise.all(
      clauses.map(async (clause) => ({
        clause,
        ranked: await scoreAgainstCatalogue(clause, catalogueIndex, extraAliasesByServiceId),
      })),
    );
    for (const { clause, ranked } of clauseResults) {
      // A bare trailing fragment left over from splitting on "and"/commas
      // ("structure.", "we do not know why.") isn't a second need — it's
      // just where the sentence got cut. Require enough real content for a
      // clause to even be a candidate uncovered aspect.
      if (contentTokens(normalize(clause)).length < 4) continue;

      const top = ranked[0];
      const clearsAnything = top && top.confidence >= IN_SCOPE_THRESHOLD;
      const relatedToMatch = ranked.some(
        (r) => matchedServiceIds.has(r.service.id) && r.confidence >= RELATED_TO_MATCH_THRESHOLD,
      );
      if (!clearsAnything && !relatedToMatch) uncoveredAspects.push(clause);
    }
  }

  const verdict = uncoveredAspects.length ? 'partly_in_scope' : 'in_scope';

  const primaryServiceId = matches[0]?.service_id ?? 'general';
  const ctaUrl = new URL(`/api/cta/${primaryServiceId}`, ctaBaseUrl);
  if (threadId) ctaUrl.searchParams.set('thread', threadId);

  // verdict here is always 'in_scope' or 'partly_in_scope' — the
  // out_of_scope case already returned above.
  return {
    verdict,
    matches,
    uncovered_aspects: verdict === 'partly_in_scope' ? uncoveredAspects : [],
    disclosure: DISCLOSURE_TEXT,
    cta_url: ctaUrl.toString(),
  };
}
