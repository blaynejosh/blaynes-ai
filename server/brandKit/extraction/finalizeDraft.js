/**
 * Takes whatever applyProposals() (proposals.js) produced from the model —
 * possibly nothing at all, if the material didn't state a given role — and
 * fills every schema-required gap with a named, clearly-marked system
 * default, plus a deterministic (non-model) pass that links an uploaded
 * font asset to a typography role when its real internal family name
 * matches what was extracted.
 *
 * Pure function, no I/O — see test/brand-kit-proposals.test.js.
 */
const SYSTEM_DEFAULT_TEXT = {
  heading: '#111111',
  body: '#1F2937',
  muted: '#6B7280',
  on_dark: '#FFFFFF',
};
const SYSTEM_DEFAULT_SURFACE = {
  page: '#FFFFFF',
  dark: '#111111',
  tint: '#F5F5F5',
  hairline: '#E5E7EB',
};
const SYSTEM_DEFAULT_TYPEFACE = { family: 'Inter', fallback_stack: ['Helvetica', 'Arial', 'sans-serif'] };

function systemDefaultProvenance() {
  // Deliberately low confidence — not because the default value is
  // unreliable (it's a fixed, known-good fallback), but so it sorts to the
  // top of "low-confidence fields surfaced first" in the review UI: a
  // system default is exactly the kind of field that most needs a human's
  // actual input, precisely because the source material said nothing.
  //
  // No source_asset_id/source_locator — both are optional (`type: "string"`,
  // not nullable) in brand-kit.schema.json's provenance entries, so a
  // default with no real source omits them rather than setting null.
  return { method: 'system_default', confidence: 0.2, confirmed: false };
}

/**
 * @param {object} kitFields    From applyProposals().kitFields
 * @param {object} provenance   From applyProposals().provenance — mutated copy returned, not the input
 * @param {object[]} fontAssets  The org's font Brand Kit assets, for deterministic name-matching
 * @param {object[]} logoAssets  The org's logo Brand Kit assets
 * @param {string} orgFallbackName  Used only if nothing extracted identity.legal_name
 */
export function finalizeDraft({ kitFields, provenance, fontAssets, logoAssets, orgFallbackName }) {
  const kit = structuredClone(kitFields);
  const prov = { ...provenance };

  // --- identity.legal_name -------------------------------------------------
  kit.identity ??= {};
  if (!kit.identity.legal_name) {
    kit.identity.legal_name = orgFallbackName;
    prov['identity.legal_name'] = systemDefaultProvenance();
  }

  // --- colors: text / surface (schema-required) -----------------------------
  kit.colors ??= {};
  if (!kit.colors.primary) {
    kit.colors.primary = { hex: '#1A1A1A' };
    prov['colors.primary'] = systemDefaultProvenance();
  }
  if (!kit.colors.text) {
    kit.colors.text = Object.fromEntries(Object.entries(SYSTEM_DEFAULT_TEXT).map(([k, hex]) => [k, { hex }]));
    prov['colors.text'] = systemDefaultProvenance();
  }
  if (!kit.colors.surface) {
    kit.colors.surface = Object.fromEntries(Object.entries(SYSTEM_DEFAULT_SURFACE).map(([k, hex]) => [k, { hex }]));
    prov['colors.surface'] = systemDefaultProvenance();
  }

  // --- typography: display / body (schema-required) -------------------------
  kit.typography ??= {};
  if (!kit.typography.display) {
    kit.typography.display = { ...SYSTEM_DEFAULT_TYPEFACE };
    prov['typography.display'] = systemDefaultProvenance();
  }
  if (!kit.typography.body) {
    kit.typography.body = { ...SYSTEM_DEFAULT_TYPEFACE };
    prov['typography.body'] = systemDefaultProvenance();
  }

  // Deterministic (non-model) font-asset linking: if an uploaded font's real
  // internal family name matches a role's extracted (or defaulted) family
  // name, attach it — this never runs the other direction (the model never
  // names an asset_id itself for this), so a wrong match here is a data
  // problem (two different fonts sharing a family name), not a model guess.
  for (const role of ['display', 'heading', 'body', 'mono']) {
    const roleFamily = kit.typography[role]?.family;
    if (!roleFamily) continue;
    const match = fontAssets.find((a) => a.extracted?.internal_family_name?.toLowerCase() === roleFamily.toLowerCase());
    if (match && !kit.typography[role].font_files) {
      kit.typography[role].font_files = [
        {
          asset_id: match.id,
          weight: 400,
          style: 'normal',
          format: match.extracted?.renderable_format ?? match.extracted?.format ?? 'ttf',
          internal_family_name: match.extracted?.internal_family_name,
        },
      ];
    }
  }

  // --- logos (schema-required, minItems 1) -----------------------------------
  if (!kit.logos?.length) {
    if (!logoAssets.length) {
      throw new Error('At least one logo must be uploaded before a Brand Kit can be extracted.');
    }
    kit.logos = [
      {
        asset_id: logoAssets[0].id,
        variant: 'primary',
        format: logoAssets[0].extracted?.format === 'svg' ? 'svg' : logoAssets[0].mime_type === 'image/png' ? 'png' : 'jpg',
      },
    ];
    prov.logos = systemDefaultProvenance();
  }

  return { kit, provenance: prov };
}
