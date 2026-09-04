/**
 * Phase 7 eval — the matcher-testable slice of the golden set (34 of the 40
 * cases; see test/golden-cases.mjs for what the remaining 6 cover and why
 * they're tested elsewhere). Runs against the real catalogue
 * (catalogue/blaynes-services.json) with buildIndex(), lexical-only — no
 * live Vertex embeddings call, so this suite runs in CI with no GCP
 * credentials at all. See search.js's calibration notes for what that
 * tradeoff costs relative to hybrid matching.
 *
 *   npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../server/catalogue/loader.js';
import { validateCatalogue } from '../server/catalogue/schema.js';
import { matchNeed, DISCLOSURE_TEXT } from '../server/catalogue/search.js';
import {
  IN_SCOPE_CASES,
  OUT_OF_SCOPE_CASES,
  PARTLY_IN_SCOPE_CASES,
  NEAR_MISS_CASES,
} from './golden-cases.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'catalogue', 'blaynes-services.json'), 'utf-8'));
validateCatalogue(catalogue);
const catalogueIndex = buildIndex(catalogue, null); // null embeddings -> lexical-only, same as loader.js's degraded path

const allServiceIds = new Set(catalogueIndex.services.map((s) => s.id));

async function run(need) {
  return matchNeed({ need, catalogueIndex, ctaBaseUrl: 'https://blaynes.ai' });
}

test('verdict accuracy across the golden set is at least 90%', async () => {
  const results = [];

  for (const c of IN_SCOPE_CASES) {
    const r = await run(c.need);
    const ok = r.verdict === 'in_scope' && r.matches.some((m) => m.service_id === c.expectService);
    results.push({ id: c.id, ok, got: r.verdict, matches: r.matches.map((m) => m.service_id) });
  }
  for (const c of OUT_OF_SCOPE_CASES) {
    const r = await run(c.need);
    const ok = r.verdict === 'out_of_scope';
    results.push({ id: c.id, ok, got: r.verdict });
  }
  for (const c of PARTLY_IN_SCOPE_CASES) {
    const r = await run(c.need);
    const ok =
      r.verdict === 'partly_in_scope' &&
      r.matches.some((m) => m.service_id === c.expectService) &&
      r.uncovered_aspects.some((a) => a.toLowerCase().includes(c.uncoveredContains.toLowerCase()));
    results.push({ id: c.id, ok, got: r.verdict, uncovered: r.uncovered_aspects });
  }
  for (const c of NEAR_MISS_CASES) {
    const r = await run(c.need);
    const ok = r.verdict === 'out_of_scope';
    results.push({ id: c.id, ok, got: r.verdict, matches: r.matches.map((m) => m.service_id) });
  }

  const failures = results.filter((r) => !r.ok);
  const accuracy = (results.length - failures.length) / results.length;
  if (failures.length) {
    console.log(`Golden set failures (${failures.length}/${results.length}):`, JSON.stringify(failures, null, 2));
  }
  console.log(`Verdict accuracy: ${(accuracy * 100).toFixed(1)}% (${results.length - failures.length}/${results.length})`);
  assert.ok(accuracy >= 0.9, `verdict accuracy ${(accuracy * 100).toFixed(1)}% is below the 90% floor`);
});

test('no fabricated providers: every match references a real catalogue service (100%)', async () => {
  const cases = [...IN_SCOPE_CASES.map((c) => c.need), ...PARTLY_IN_SCOPE_CASES.map((c) => c.need)];
  for (const need of cases) {
    const r = await run(need);
    for (const m of r.matches) {
      assert.ok(allServiceIds.has(m.service_id), `matched service_id "${m.service_id}" is not in the catalogue`);
    }
  }
});

test('disclosure is present on every non-out_of_scope verdict (100%)', async () => {
  const cases = [...IN_SCOPE_CASES.map((c) => c.need), ...PARTLY_IN_SCOPE_CASES.map((c) => c.need)];
  for (const need of cases) {
    const r = await run(need);
    assert.notEqual(r.verdict, 'out_of_scope');
    assert.equal(r.disclosure, DISCLOSURE_TEXT);
    assert.ok(r.cta_url.startsWith('https://blaynes.ai/api/cta/'));
  }
});

test('no pricing ever appears in a tool result', async () => {
  const allNeeds = [
    ...IN_SCOPE_CASES.map((c) => c.need),
    ...OUT_OF_SCOPE_CASES.map((c) => c.need),
    ...PARTLY_IN_SCOPE_CASES.map((c) => c.need),
  ];
  const currencyPattern = /(₦|\$|£|€)\s?\d|\b\d+\s?(naira|dollars|usd|ngn|gbp|eur)\b/i;
  for (const need of allNeeds) {
    const r = await run(need);
    const text = JSON.stringify(r);
    assert.ok(!currencyPattern.test(text), `tool result for "${need}" contains what looks like a price: ${text}`);
  }
});

test('out_of_scope needs are never routed to Blayne\'s Consulting under any category', async () => {
  for (const c of OUT_OF_SCOPE_CASES) {
    const r = await run(c.need);
    assert.equal(r.verdict, 'out_of_scope', `"${c.domain}" (${c.id}) should be out_of_scope, got ${r.verdict}`);
    assert.equal(r.matches.length, 0);
    assert.equal(r.disclosure, '');
  }
});

test('a pure strategy question with no execution need gets no matches', async () => {
  const r = await run('What do you think the biggest risk to our 2027 growth plan is?');
  assert.equal(r.verdict, 'out_of_scope');
  assert.equal(r.matches.length, 0);
});
