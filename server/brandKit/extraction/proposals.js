/**
 * Pure assembly logic for turning the extraction model's field proposals
 * into a schema-valid Brand Kit draft. Deliberately separate from
 * extractKit.js (which makes the actual Claude call): everything here is a
 * plain function over plain data, so it's testable without Supabase, GCS,
 * or a live model — see test/brand-kit-proposals.test.js.
 *
 * Two independent trust boundaries enforced here, matching the brief's
 * non-negotiables:
 *   1. "Never invent brand values" — every field lands in the provenance
 *      map with confirmed: false. Nothing this module produces is usable in
 *      a document until a human confirms it (enforced at the confirm
 *      endpoint, not here, but the false starts here).
 *   2. Citation integrity — a proposal citing a source_asset_id this
 *      organization doesn't actually own (or that wasn't part of what the
 *      model was shown) is dropped rather than trusted. A model citing a
 *      source it doesn't really have is worse than citing none.
 */
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  const withHash = v.startsWith('#') ? v : `#${v}`;
  return HEX_RE.test(withHash) ? withHash.toUpperCase() : null;
}

const LOGO_VARIANTS = new Set(['primary', 'on_dark', 'on_light', 'monochrome', 'icon', 'wordmark', 'high_res']);
const VOICE_PERSON = new Set(['first_plural', 'first_singular', 'third']);
const VOICE_SPELLING = new Set(['en-GB', 'en-US', 'en-NG']);

/** Every path the extraction model is allowed to propose a value for, and
 * how to validate/shape that value. Anything not listed here is dropped —
 * an unrecognized path is treated as noise, not as a new schema field. */
const PATH_SPECS = {
  'identity.legal_name': { kind: 'string' },
  'identity.display_name': { kind: 'string' },
  'identity.tagline': { kind: 'string' },
  'identity.website': { kind: 'string' },
  'identity.industry': { kind: 'string' },
  'identity.hq_location': { kind: 'string' },
  'identity.about': { kind: 'string' },
  'identity.registration_details': { kind: 'string' },
  'identity.markets': { kind: 'string_array' },

  'colors.primary': { kind: 'hex' },
  'colors.secondary': { kind: 'hex' },
  'colors.accents': { kind: 'hex_array' },
  'colors.text.heading': { kind: 'hex' },
  'colors.text.body': { kind: 'hex' },
  'colors.text.muted': { kind: 'hex' },
  'colors.text.on_dark': { kind: 'hex' },
  'colors.surface.page': { kind: 'hex' },
  'colors.surface.dark': { kind: 'hex' },
  'colors.surface.tint': { kind: 'hex' },
  'colors.surface.hairline': { kind: 'hex' },
  'colors.semantic.positive': { kind: 'hex' },
  'colors.semantic.caution': { kind: 'hex' },
  'colors.semantic.negative': { kind: 'hex' },
  'colors.chart_categorical': { kind: 'hex_array' },
  'colors.chart_sequential': { kind: 'hex_array' },

  'typography.display.family': { kind: 'string' },
  'typography.heading.family': { kind: 'string' },
  'typography.body.family': { kind: 'string' },
  'typography.mono.family': { kind: 'string' },
  'typography.rules.display_never_bold': { kind: 'boolean' },

  'voice.tone': { kind: 'string_array' },
  'voice.person': { kind: 'string', enum: VOICE_PERSON },
  'voice.spelling': { kind: 'string', enum: VOICE_SPELLING },
  'voice.banned_words': { kind: 'string_array' },
  'voice.banned_punctuation': { kind: 'string_array' },
  'voice.required_phrases': { kind: 'string_array' },
  'voice.reading_level': { kind: 'string' },

  'boilerplate.confidentiality_line': { kind: 'string' },
  'boilerplate.footer_text': { kind: 'string' },
  'boilerplate.legal_disclaimer': { kind: 'string' },
  'boilerplate.copyright_line': { kind: 'string' },
  'boilerplate.contact_block': { kind: 'string' },

  logos: { kind: 'logo_array' },
};

function coerceValue(spec, rawValue, logoAssetsById) {
  switch (spec.kind) {
    case 'hex':
      return normalizeHex(rawValue);
    case 'hex_array': {
      if (!Array.isArray(rawValue)) return null;
      const hexes = rawValue.map(normalizeHex).filter(Boolean);
      return hexes.length ? hexes : null;
    }
    case 'string':
      if (typeof rawValue !== 'string' || !rawValue.trim()) return null;
      if (spec.enum && !spec.enum.has(rawValue)) return null;
      return rawValue.trim();
    case 'string_array': {
      if (!Array.isArray(rawValue)) return null;
      const strs = rawValue.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
      return strs.length ? strs : null;
    }
    case 'boolean':
      return typeof rawValue === 'boolean' ? rawValue : null;
    case 'logo_array': {
      if (!Array.isArray(rawValue)) return null;
      const logos = rawValue
        .filter((l) => l && typeof l.asset_id === 'string' && logoAssetsById.has(l.asset_id))
        .map((l) => {
          const asset = logoAssetsById.get(l.asset_id);
          return {
            asset_id: l.asset_id,
            variant: LOGO_VARIANTS.has(l.variant) ? l.variant : 'primary',
            format: asset.extracted?.format === 'svg' ? 'svg' : asset.mime_type === 'image/png' ? 'png' : 'jpg',
          };
        });
      return logos.length ? logos : null;
    }
    default:
      return null;
  }
}

function setPath(obj, dotPath, value) {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur[parts[i]] ??= {};
    cur = cur[parts[i]];
  }
  const leaf = parts[parts.length - 1];
  cur[leaf] = value;
}

/** Wraps a raw hex string (or array of them) into the `{hex}` shape
 * brand-kit.schema.json's $defs/color requires. */
function toColorShape(value, isArray) {
  return isArray ? value.map((hex) => ({ hex })) : { hex: value };
}

const HEX_PATH_KINDS = new Set(['hex', 'hex_array']);

/**
 * @param {object[]} proposals   Raw {path, value, source_asset_id, source_locator, confidence} from the model
 * @param {Set<string>} validAssetIds   Asset ids actually shown to the model this run — anything else is a hallucinated citation
 * @param {object[]} logoAssets   The org's logo Brand Kit assets (for logo_array validation)
 * @returns {{kitFields: object, provenance: object, rejected: {path:string, reason:string}[]}}
 */
export function applyProposals(proposals, validAssetIds, logoAssets) {
  const logoAssetsById = new Map(logoAssets.map((a) => [a.id, a]));
  const kitFields = {};
  const provenance = {};
  const rejected = [];

  for (const raw of proposals ?? []) {
    const path = raw?.path;
    const spec = PATH_SPECS[path];
    if (!spec) {
      rejected.push({ path: String(path), reason: 'unknown path' });
      continue;
    }
    if (!raw.source_asset_id || !validAssetIds.has(raw.source_asset_id)) {
      rejected.push({ path, reason: 'source_asset_id was not one of the assets shown to the model' });
      continue;
    }

    const coerced = coerceValue(spec, raw.value, logoAssetsById);
    if (coerced === null) {
      rejected.push({ path, reason: 'value failed validation for this field' });
      continue;
    }

    const shaped = HEX_PATH_KINDS.has(spec.kind) ? toColorShape(coerced, spec.kind === 'hex_array') : coerced;
    setPath(kitFields, path, shaped);

    // source_locator omitted (not null) when absent — see the note on
    // systemDefaultProvenance() in finalizeDraft.js for why null isn't safe
    // here: the schema's provenance fields are optional strings, not
    // nullable ones.
    provenance[path] = {
      source_asset_id: raw.source_asset_id,
      ...(typeof raw.source_locator === 'string' ? { source_locator: raw.source_locator } : {}),
      method: 'extracted_llm',
      confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
      confirmed: false,
    };
  }

  return { kitFields, provenance, rejected };
}

/**
 * The same validate-and-shape step applyProposals() uses per field, exposed
 * for the confirmation UI's manual field-edit endpoint (routes.js) — a
 * human typing a corrected hex value goes through the identical hex-format
 * check a model proposal does, so "#zzz" is rejected the same way either
 * way.
 */
export function coerceAndShapeField(path, rawValue, logoAssets) {
  const spec = PATH_SPECS[path];
  if (!spec) return { ok: false, reason: 'unknown path' };
  const logoAssetsById = new Map((logoAssets ?? []).map((a) => [a.id, a]));
  const coerced = coerceValue(spec, rawValue, logoAssetsById);
  if (coerced === null) return { ok: false, reason: 'value failed validation for this field' };
  return { ok: true, value: HEX_PATH_KINDS.has(spec.kind) ? toColorShape(coerced, spec.kind === 'hex_array') : coerced };
}

export { PATH_SPECS, setPath };
