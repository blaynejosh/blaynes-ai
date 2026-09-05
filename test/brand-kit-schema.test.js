import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBrandKit, validateDocumentIr } from '../server/brandKit/schema.js';

function baseKit(overrides = {}) {
  return {
    kit_id: 'kit-1',
    tenant_id: 'org-1',
    version: 1,
    status: 'active',
    identity: { legal_name: 'Acme Consulting' },
    colors: {
      primary: { hex: '#1A73E8' },
      text: { body: { hex: '#1A1A1A' } },
      surface: { page: { hex: '#FFFFFF' } },
    },
    typography: {
      display: { family: 'Inter' },
      body: { family: 'Inter' },
    },
    logos: [{ asset_id: 'asset-1', variant: 'primary', format: 'svg' }],
    ...overrides,
  };
}

test('a well-formed Brand Kit validates', () => {
  assert.doesNotThrow(() => validateBrandKit(baseKit()));
});

test('rejects a kit missing tenant_id', () => {
  const kit = baseKit();
  delete kit.tenant_id;
  assert.throws(() => validateBrandKit(kit), /tenant_id/);
});

test('rejects an invalid status enum value', () => {
  assert.throws(() => validateBrandKit(baseKit({ status: 'published' })), /status/);
});

test('rejects a kit with zero logos', () => {
  assert.throws(() => validateBrandKit(baseKit({ logos: [] })), /logos/);
});

test('rejects a colour with a malformed hex value', () => {
  const kit = baseKit();
  kit.colors.primary.hex = 'not-a-hex';
  assert.throws(() => validateBrandKit(kit), /hex/);
});

test('rejects a font_files entry missing license_attested-adjacent required fields', () => {
  const kit = baseKit();
  kit.typography.body.font_files = [{ asset_id: 'a1' }]; // missing weight/style/format
  assert.throws(() => validateBrandKit(kit));
});

// --- document-ir.schema.json -------------------------------------------

function baseIr(overrides = {}) {
  return {
    ir_version: '1.0',
    meta: { title: 'Market Study', doc_type: 'market_study', audience: 'Board of Directors' },
    blocks: [{ type: 'heading', level: 1, text: 'Demand rises 20% by Q3' }],
    ...overrides,
  };
}

test('a well-formed Document IR validates', () => {
  assert.doesNotThrow(() => validateDocumentIr(baseIr()));
});

test('rejects an unknown doc_type', () => {
  const ir = baseIr();
  ir.meta.doc_type = 'meeting_notes';
  assert.throws(() => validateDocumentIr(ir), /doc_type/);
});

test('rejects an exhibit block with no action_title', () => {
  const ir = baseIr({
    blocks: [{ type: 'exhibit', content: { kind: 'kpi_row', items: [{ value: '20%', label: 'Growth' }, { value: '5', label: 'Markets' }] } }],
  });
  assert.throws(() => validateDocumentIr(ir), /action_title/);
});

test('rejects a kpi_row with fewer than 2 items', () => {
  const ir = baseIr({
    blocks: [{ type: 'exhibit', action_title: 'x', content: { kind: 'kpi_row', items: [{ value: '1', label: 'a' }] } }],
  });
  assert.throws(() => validateDocumentIr(ir));
});

test('accepts a chart block marked is_estimate', () => {
  const ir = baseIr({
    blocks: [
      {
        type: 'exhibit',
        action_title: 'Revenue could triple under the aggressive scenario',
        content: { kind: 'chart', chart_type: 'bar', categories: ['2026', '2027'], series: [{ name: 'Revenue', values: [1, 3] }], is_estimate: true },
      },
    ],
  });
  assert.doesNotThrow(() => validateDocumentIr(ir));
});
