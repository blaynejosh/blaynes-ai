/**
 * Frequency-cap decision logic (decline-01/02/03 from test/golden-cases.mjs)
 * — tests computeCapped() directly, the pure function extracted from
 * routingState.js specifically so this doesn't need a Supabase connection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCapped } from '../server/catalogue/routingState.js';
import { DECLINE_CASES } from './golden-cases.mjs';

test('frequency cap decline cases', () => {
  for (const c of DECLINE_CASES) {
    const cappedAfterFirst = computeCapped([], c.firstMatches);
    assert.equal(cappedAfterFirst, false, `${c.id}: the first recommendation in a thread should never be capped`);

    const alreadyShown = c.firstMatches;
    const cappedOnSecond = computeCapped(alreadyShown, c.secondMatches);
    assert.equal(cappedOnSecond, c.expectSecondCapped, `${c.id}: ${c.note}`);
  }
});

test('no matches never counts as a shown recommendation', () => {
  assert.equal(computeCapped(['website-design-development'], []), false);
});
