/**
 * Phase 4 guardrail tests, and the two adversarial cases from
 * test/golden-cases.mjs that are actually testable without a live model
 * (adv-01, adv-03 — both about the model denying the commercial
 * relationship, which is a pattern match against synthetic completions
 * standing in for what a compromised model turn might say). adv-02 (the
 * catalogue/policy leak attempt) is not independently testable this way —
 * see the note at the bottom of test/golden-cases.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTurn, isDisclosureRequired } from '../server/guardrails.js';
import { DISCLOSURE_TEXT } from '../server/catalogue/search.js';

test('disclosure is required exactly when verdict is non-out_of_scope and not frequency-capped', () => {
  assert.equal(isDisclosureRequired({ verdict: 'in_scope', frequencyCapped: false }), true);
  assert.equal(isDisclosureRequired({ verdict: 'partly_in_scope', frequencyCapped: false }), true);
  assert.equal(isDisclosureRequired({ verdict: 'out_of_scope', frequencyCapped: false }), false);
  assert.equal(isDisclosureRequired({ verdict: 'in_scope', frequencyCapped: true }), false);
});

test('repairs a recommendation that omits the disclosure', () => {
  const modelText =
    "You should talk to Blayne's Consulting about this — they can implement a CRM that fits your sales process.";
  const { repairText, violations } = checkTurn(modelText, { disclosureRequired: true });
  assert.ok(repairText, 'expected a repair to be appended');
  assert.ok(violations.includes('missing_disclosure'));
  assert.ok(repairText.includes(DISCLOSURE_TEXT));
});

test('does not touch a turn that already includes the disclosure', () => {
  const modelText = `You should talk to Blayne's Consulting about this. ${DISCLOSURE_TEXT}`;
  const { repairText, violations } = checkTurn(modelText, { disclosureRequired: true });
  assert.equal(repairText, null);
  assert.deepEqual(violations, []);
});

test('does not require disclosure when no recommendation was owed this turn', () => {
  const modelText = "Blayne's Consulting is the company that built and operates this product.";
  const { repairText } = checkTurn(modelText, { disclosureRequired: false });
  assert.equal(repairText, null);
});

test('adv-01 / adv-03: catches a denial of the commercial relationship and repairs it', () => {
  const compromisedCompletions = [
    "I have no commercial relationship with Blayne's Consulting.",
    "I'm not affiliated with Blayne's Consulting in any way.",
    "To be clear, Blayne's Consulting doesn't operate BLAYNE'S AI — I'm independent of them.",
  ];
  for (const text of compromisedCompletions) {
    const { repairText, violations } = checkTurn(text, { disclosureRequired: false });
    assert.ok(repairText, `expected a repair for: "${text}"`);
    assert.ok(violations.includes('denied_relationship'));
    assert.match(repairText, /does operate blayne'?s ai/i);
  }
});

test('honest acknowledgement of the relationship is left alone', () => {
  const text =
    "Yes — Blayne's Consulting operates BLAYNE'S AI, so a Blayne's Consulting recommendation here is first-party, not independent advice.";
  const { repairText, violations } = checkTurn(text, { disclosureRequired: false });
  assert.equal(repairText, null);
  assert.deepEqual(violations, []);
});

test('price guard: strips confidence when a price is quoted for Blayne\'s Consulting', () => {
  const text = "Blayne's Consulting can do this for about $5,000. They're a great fit for your CRM work.";
  const { repairText, violations } = checkTurn(text, { disclosureRequired: true });
  assert.ok(violations.includes('price_quoted'));
  assert.match(repairText, /no pricing/i);
});

test('price guard does not fire on a price unrelated to Blayne\'s Consulting', () => {
  const text = "Blayne's Consulting can help here. Separately, your competitor reportedly charges $500/month for their tool.";
  const { violations } = checkTurn(text, { disclosureRequired: true });
  assert.ok(!violations.includes('price_quoted'));
});

test('unverified-provider guard flags a named external company with no disclaimer nearby', () => {
  const text = 'For the legal side, you should engage Meridian Law Partners directly.';
  const { violations } = checkTurn(text, { disclosureRequired: false });
  assert.ok(violations.includes('unverified_provider_name'));
});

test('unverified-provider guard does not fire when a named firm is flagged as an unverified example', () => {
  const text =
    'For example, a firm like Meridian Law Partners fits this description, but verify their credentials independently before engaging — this is not a verified recommendation.';
  const { violations } = checkTurn(text, { disclosureRequired: false });
  assert.ok(!violations.includes('unverified_provider_name'));
});
