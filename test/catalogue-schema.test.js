/**
 * Acceptance criterion: "Removing the catalogue file causes a clean, logged
 * startup failure rather than silent degradation." validateCatalogue() is
 * the hard-fail check server/catalogue/loader.js runs at boot — this tests
 * that check directly (the GCS-fetch failure path in loader.js's
 * initCatalogue() isn't exercised here, since mocking GCS is out of scope
 * for this suite; validateCatalogue() throwing is what turns "missing or
 * broken" into a boot failure either way).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalogue } from '../server/catalogue/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'catalogue', 'blaynes-services.json'), 'utf-8'));

test('the real catalogue file validates cleanly', () => {
  assert.doesNotThrow(() => validateCatalogue(catalogue));
});

test('rejects a missing categories array', () => {
  assert.throws(() => validateCatalogue({ version: '1.0.0', source_url: 'x', last_verified: '2026-01-01' }));
});

test('rejects a service missing required fields', () => {
  const broken = structuredClone(catalogue);
  delete broken.categories[0].services[0].outcome;
  assert.throws(() => validateCatalogue(broken), /outcome/);
});

test('rejects a service with an empty aliases array', () => {
  const broken = structuredClone(catalogue);
  broken.categories[0].services[0].aliases = [];
  assert.throws(() => validateCatalogue(broken), /aliases/);
});

test('rejects a duplicate service id across categories', () => {
  const broken = structuredClone(catalogue);
  broken.categories[1].services[0].id = broken.categories[0].services[0].id;
  assert.throws(() => validateCatalogue(broken), /duplicate/);
});

test('rejects an unparseable last_verified date', () => {
  const broken = structuredClone(catalogue);
  broken.last_verified = 'not-a-date';
  assert.throws(() => validateCatalogue(broken), /last_verified/);
});

test('rejects null/undefined entirely', () => {
  assert.throws(() => validateCatalogue(null));
  assert.throws(() => validateCatalogue(undefined));
});
