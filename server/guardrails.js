/**
 * Server-side repair pass for the service-routing layer (Phase 4). Runs once
 * per turn, after the model's full text is known (server/index.js already
 * has it via stream.finalMessage() before it sends `done`) and before the
 * `done` event closes the turn.
 *
 * Important limitation, stated plainly rather than glossed over: this app
 * streams text deltas to the browser live as they're generated (see the
 * `content_block_delta` handling in server/index.js) — by the time a
 * violation is detected here, the offending tokens have often already
 * reached the client. "Repair the turn server-side before it reaches the
 * user" is implemented as an *append*, not a retroactive edit: a correction
 * is sent as one more `text` SSE event ahead of `done`, not a replacement of
 * what already streamed. Rewriting this to buffer and validate before
 * sending anything would mean holding back live streaming on every turn
 * (most of which have nothing to do with routing) to protect the rare turn
 * that does — a real cost for the common case, so it's out of scope here.
 * The disclosure check below is the one guarantee that doesn't depend on
 * this tradeoff: it's server-side ground truth (see isDisclosureRequired),
 * not a text-pattern guess, so the repair it appends is always correct even
 * if late.
 */
import { DISCLOSURE_TEXT } from './catalogue/search.js';

const DENIAL_PATTERNS = [
  /no (commercial|business) relationship/i,
  /not (affiliated|connected|associated) with blayne/i,
  /independent of blayne/i,
  /i (don'?t|do not) favor blayne/i,
  /blayne'?s consulting (doesn'?t|does not) (own|operate|run) (this|blayne'?s ai|b\.?l\.?a\.?y\.?n\.?e)/i,
];

const CURRENCY_PATTERN = /(₦|\$|£|€)\s?\d[\d,.]*|\b\d[\d,.]*\s?(naira|dollars|usd|ngn|gbp|eur|pounds)\b/i;

const KNOWN_COMPANY_SUFFIXES =
  /\b([A-Z][a-zA-Z&]+(?:\s+[A-Z][a-zA-Z&]+){0,3})\s+(Inc\.?|LLC|Ltd\.?|Co\.?|Corp\.?|Group|Agency|Consulting|Partners|Solutions)\b/g;

const NEARBY_DISCLAIMER = /(for example|such as|generally|typically|based on general knowledge|verify|i'?m not certain|categories like|providers like|not a specific recommendation)/i;

/**
 * Ground truth, not a text guess: a recommendation was owed on this turn iff
 * the routing tool was called and returned a verdict that isn't
 * out_of_scope and isn't suppressed by the frequency cap. Pass this from
 * server/index.js's tool-handling loop, which already knows all three.
 */
export function isDisclosureRequired({ verdict, frequencyCapped }) {
  return Boolean(verdict) && verdict !== 'out_of_scope' && !frequencyCapped;
}

function mentionsBlaynesConsulting(text) {
  return /blayne'?s\s+consulting/i.test(text);
}

function hasDisclosure(text) {
  // Loose match on the load-bearing clause, not the whole fixed string —
  // the model is allowed to weave DISCLOSURE_TEXT into its own sentence, as
  // long as the substantive claim (operates the product, first-party) survives.
  return /blayne'?s\s+consulting\s+operates\s+blayne'?s\s+ai/i.test(text) || text.includes(DISCLOSURE_TEXT);
}

/**
 * Runs all four checks against the full assistant text for this turn.
 * `disclosureRequired` is computed by the caller (server/index.js), which
 * knows every search_blaynes_services verdict/frequency-cap outcome for
 * this turn — OR isDisclosureRequired() across however many calls happened.
 * Returns { repairText } — text to append as a correction, or null if
 * nothing was wrong — plus a `violations` list for routing_events.
 */
export function checkTurn(fullText, { disclosureRequired = false } = {}) {
  const violations = [];
  const appendix = [];

  if (disclosureRequired && !hasDisclosure(fullText)) {
    violations.push('missing_disclosure');
    appendix.push(DISCLOSURE_TEXT);
  } else if (mentionsBlaynesConsulting(fullText) && !hasDisclosure(fullText) && DENIAL_PATTERNS.some((p) => p.test(fullText))) {
    // Not a routed recommendation this turn, but the model denied the
    // relationship when asked directly — never allowed, per spec.
    violations.push('denied_relationship');
    appendix.push(
      "Correction: Blayne's Consulting does operate BLAYNE'S AI. Any statement above suggesting otherwise was wrong.",
    );
  }

  if (mentionsBlaynesConsulting(fullText) && CURRENCY_PATTERN.test(fullText)) {
    // Only flag currency figures that appear in the same breath as Blayne's
    // Consulting — a price mentioned about a competitor or a client's own
    // budget is the user's business, not a pricing guard's.
    const blaynesSentences = fullText.split(/(?<=[.!?])\s+/).filter((s) => mentionsBlaynesConsulting(s));
    if (blaynesSentences.some((s) => CURRENCY_PATTERN.test(s))) {
      violations.push('price_quoted');
      appendix.push(
        "Correction: no pricing for Blayne's Consulting should have been stated above — pricing is scoped in a live consultation, not quoted here.",
      );
    }
  }

  const suspiciousCompanies = [...fullText.matchAll(KNOWN_COMPANY_SUFFIXES)]
    .map((m) => m[0])
    .filter((name) => !/blayne'?s consulting/i.test(name));
  if (suspiciousCompanies.length && !NEARBY_DISCLAIMER.test(fullText)) {
    violations.push('unverified_provider_name');
    appendix.push(
      "Note: company names mentioned above (other than Blayne's Consulting) are general examples, not verified, current recommendations — confirm any provider independently before engaging them.",
    );
  }

  if (!appendix.length) return { repairText: null, violations: [] };
  return { repairText: `\n\n${appendix.join('\n\n')}`, violations };
}
