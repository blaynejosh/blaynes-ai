import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProposals } from '../server/brandKit/extraction/proposals.js';
import { finalizeDraft } from '../server/brandKit/extraction/finalizeDraft.js';

const VALID_ASSETS = new Set(['asset-guideline-1', 'asset-logo-1']);

test('applyProposals accepts a well-formed hex proposal and marks it unconfirmed', () => {
  const { kitFields, provenance, rejected } = applyProposals(
    [{ path: 'colors.primary', value: '#1A73E8', source_asset_id: 'asset-guideline-1', source_locator: 'page 3', confidence: 0.9 }],
    VALID_ASSETS,
    [],
  );
  assert.deepEqual(kitFields.colors.primary, { hex: '#1A73E8' });
  assert.equal(provenance['colors.primary'].confirmed, false);
  assert.equal(provenance['colors.primary'].method, 'extracted_llm');
  assert.equal(provenance['colors.primary'].source_locator, 'page 3');
  assert.equal(rejected.length, 0);
});

test('applyProposals normalizes a hex value missing its leading #', () => {
  const { kitFields } = applyProposals(
    [{ path: 'colors.primary', value: '1A73E8', source_asset_id: 'asset-guideline-1', confidence: 0.5 }],
    VALID_ASSETS,
    [],
  );
  assert.equal(kitFields.colors.primary.hex, '#1A73E8');
});

test('applyProposals rejects a malformed hex value', () => {
  const { kitFields, rejected } = applyProposals(
    [{ path: 'colors.primary', value: 'not-a-colour', source_asset_id: 'asset-guideline-1' }],
    VALID_ASSETS,
    [],
  );
  assert.equal(kitFields.colors, undefined);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /validation/);
});

test('applyProposals rejects a citation to an asset the model was never shown', () => {
  const { kitFields, rejected } = applyProposals(
    [{ path: 'colors.primary', value: '#1A73E8', source_asset_id: 'asset-from-a-different-org' }],
    VALID_ASSETS,
    [],
  );
  assert.equal(kitFields.colors, undefined);
  assert.match(rejected[0].reason, /not one of the assets/);
});

test('applyProposals rejects an unknown path rather than silently adding it', () => {
  const { rejected } = applyProposals(
    [{ path: 'colors.made_up_role', value: '#1A73E8', source_asset_id: 'asset-guideline-1' }],
    VALID_ASSETS,
    [],
  );
  assert.equal(rejected[0].reason, 'unknown path');
});

test('applyProposals wraps a hex_array into color-shaped entries', () => {
  const { kitFields } = applyProposals(
    [{ path: 'colors.chart_categorical', value: ['#111111', '#222222'], source_asset_id: 'asset-guideline-1' }],
    VALID_ASSETS,
    [],
  );
  assert.deepEqual(kitFields.colors.chart_categorical, [{ hex: '#111111' }, { hex: '#222222' }]);
});

test('applyProposals rejects an invalid voice.person enum value', () => {
  const { rejected } = applyProposals([{ path: 'voice.person', value: 'second_person', source_asset_id: 'asset-guideline-1' }], VALID_ASSETS, []);
  assert.equal(rejected.length, 1);
});

test('applyProposals accepts logos referencing a real uploaded logo asset', () => {
  const logoAssets = [{ id: 'asset-logo-1', mime_type: 'image/svg+xml', extracted: { format: 'svg' } }];
  const { kitFields } = applyProposals(
    [{ path: 'logos', value: [{ asset_id: 'asset-logo-1', variant: 'primary' }], source_asset_id: 'asset-logo-1' }],
    VALID_ASSETS,
    logoAssets,
  );
  assert.deepEqual(kitFields.logos, [{ asset_id: 'asset-logo-1', variant: 'primary', format: 'svg' }]);
});

test('applyProposals drops a logo entry referencing an asset id this org does not have', () => {
  const { kitFields, rejected } = applyProposals(
    [{ path: 'logos', value: [{ asset_id: 'not-a-real-logo', variant: 'primary' }], source_asset_id: 'asset-guideline-1' }],
    VALID_ASSETS,
    [],
  );
  assert.equal(kitFields.logos, undefined);
  assert.equal(rejected.length, 1);
});

// --- finalizeDraft ---------------------------------------------------------

test('finalizeDraft fills every schema-required gap with a low-confidence system default', () => {
  const logoAssets = [{ id: 'logo-1', mime_type: 'image/png', extracted: {} }];
  const { kit, provenance } = finalizeDraft({ kitFields: {}, provenance: {}, fontAssets: [], logoAssets, orgFallbackName: "Acme's workspace" });

  assert.equal(kit.identity.legal_name, "Acme's workspace");
  assert.equal(provenance['identity.legal_name'].method, 'system_default');
  assert.equal(provenance['identity.legal_name'].confidence, 0.2);
  assert.ok(kit.colors.text);
  assert.ok(kit.colors.surface);
  assert.equal(kit.typography.display.family, 'Inter');
  assert.equal(kit.logos[0].asset_id, 'logo-1');
});

test('finalizeDraft never overwrites a value applyProposals already set', () => {
  const kitFields = { identity: { legal_name: 'Real Extracted Name' }, colors: { primary: { hex: '#1A73E8' } } };
  const logoAssets = [{ id: 'logo-1', mime_type: 'image/png', extracted: {} }];
  const { kit, provenance } = finalizeDraft({ kitFields, provenance: {}, fontAssets: [], logoAssets, orgFallbackName: 'Fallback' });

  assert.equal(kit.identity.legal_name, 'Real Extracted Name');
  assert.equal(provenance['identity.legal_name'], undefined);
  assert.equal(kit.colors.primary.hex, '#1A73E8');
});

test('finalizeDraft throws when there is no logo to fall back to', () => {
  assert.throws(() => finalizeDraft({ kitFields: {}, provenance: {}, fontAssets: [], logoAssets: [], orgFallbackName: 'x' }), /logo/i);
});

test('finalizeDraft links an uploaded font asset whose real family name matches the extracted role', () => {
  const kitFields = { typography: { body: { family: 'Montserrat' } } };
  const fontAssets = [{ id: 'font-1', extracted: { internal_family_name: 'Montserrat', format: 'ttf' } }];
  const logoAssets = [{ id: 'logo-1', mime_type: 'image/png', extracted: {} }];
  const { kit } = finalizeDraft({ kitFields, provenance: {}, fontAssets, logoAssets, orgFallbackName: 'x' });

  assert.equal(kit.typography.body.font_files[0].asset_id, 'font-1');
  assert.equal(kit.typography.body.font_files[0].internal_family_name, 'Montserrat');
});

test('finalizeDraft does not link a font whose family name does not match', () => {
  const kitFields = { typography: { body: { family: 'Montserrat' } } };
  const fontAssets = [{ id: 'font-1', extracted: { internal_family_name: 'Arial', format: 'ttf' } }];
  const logoAssets = [{ id: 'logo-1', mime_type: 'image/png', extracted: {} }];
  const { kit } = finalizeDraft({ kitFields, provenance: {}, fontAssets, logoAssets, orgFallbackName: 'x' });

  assert.equal(kit.typography.body.font_files, undefined);
});

// --- end-to-end: proposals -> finalize -> real schema validation -----------

test('a fully-populated extraction (proposals + defaults) validates against brand-kit.schema.json', async () => {
  const { validateBrandKit } = await import('../server/brandKit/schema.js');
  const assetIds = new Set(['g1', 'logo-1']);
  const logoAssets = [{ id: 'logo-1', mime_type: 'image/svg+xml', extracted: { format: 'svg' } }];

  const { kitFields, provenance } = applyProposals(
    [
      { path: 'identity.legal_name', value: 'Acme Consulting Ltd', source_asset_id: 'g1', source_locator: 'page 1', confidence: 0.95 },
      { path: 'colors.primary', value: '#1A73E8', source_asset_id: 'g1', source_locator: 'page 2', confidence: 0.8 },
      { path: 'voice.tone', value: ['confident', 'precise'], source_asset_id: 'g1', source_locator: 'page 4', confidence: 0.6 },
      { path: 'logos', value: [{ asset_id: 'logo-1', variant: 'primary' }], source_asset_id: 'g1', confidence: 0.9 },
    ],
    assetIds,
    logoAssets,
  );
  const { kit, provenance: finalProvenance } = finalizeDraft({
    kitFields,
    provenance,
    fontAssets: [],
    logoAssets,
    orgFallbackName: 'Fallback Org',
  });

  const fullKit = {
    kit_id: 'kit-1',
    tenant_id: 'org-1',
    version: 1,
    status: 'awaiting_review',
    identity: kit.identity,
    colors: kit.colors,
    typography: kit.typography,
    logos: kit.logos,
    voice: kit.voice,
    provenance: finalProvenance,
  };

  assert.doesNotThrow(() => validateBrandKit(fullKit));
  assert.equal(fullKit.identity.legal_name, 'Acme Consulting Ltd'); // real value won, not the fallback
});
