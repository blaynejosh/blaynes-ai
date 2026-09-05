/**
 * The manual Brand Kit path — "a user with no brand guideline should be
 * able to enter a name, pick two colours, upload a logo, choose from a
 * small set of layout styles, and have a working kit in two minutes."
 *
 * Unlike the extraction path (Phase 2, not built yet), every value here is
 * either something the user just typed (method: user_entered) or an
 * explicit, clearly-labelled system default (method: system_default) —
 * never a guess. That's what makes it safe to skip the awaiting_review step
 * entirely and go straight to active: there's nothing here for a human to
 * double-check that they didn't just enter themselves.
 *
 * Only one 'active' kit per org (enforced at the database level — see
 * brand_kits_one_active_per_org in schema.sql), so creating a new manual
 * kit archives whatever was active before it, the same lifecycle a
 * confirmed extraction result will go through in Phase 2.
 */
import crypto from 'node:crypto';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { validateBrandKit } from './schema.js';

const HEX_RE = /^#?[0-9A-Fa-f]{6}$/;

function normalizeHex(hex) {
  if (!HEX_RE.test(hex)) throw new Error(`"${hex}" isn't a valid 6-digit hex colour.`);
  return hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
}

/** A small, fixed set of layout presets — "choose from a small set of
 * layout styles," not a free-form layout builder. Each maps onto real
 * enum values from brand-kit.schema.json's `layout` object. */
const LAYOUT_PRESETS = {
  minimal_light: {
    cover_style: 'minimal_light',
    header_style: 'logo_left_title_right',
    footer_style: 'hairline_rule',
    table_style: 'light_header_hairline',
    accent_bar: false,
  },
  bold_dark: {
    cover_style: 'full_bleed_dark',
    header_style: 'logo_left_title_right',
    footer_style: 'dark_bar_with_page_badge',
    table_style: 'dark_header_zebra',
    accent_bar: true,
  },
  corporate_classic: {
    cover_style: 'split',
    header_style: 'logo_only',
    footer_style: 'hairline_rule',
    table_style: 'minimal',
    accent_bar: false,
  },
};

const SYSTEM_DEFAULT_TYPEFACE = {
  family: 'Inter',
  fallback_stack: ['Helvetica', 'Arial', 'sans-serif'],
};

// source_asset_id/source_locator are optional in the schema (`type:
// "string"`, not nullable) — omitted entirely for a manually-entered value
// rather than set to null, which ajv would reject.
function provenanceEntry(method, userId, confidence = 1) {
  return { method, confidence, confirmed: true };
}

async function nextVersion(orgId) {
  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .select('version')
    .eq('org_id', orgId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.version ?? 0) + 1;
}

/** Shared with routes.js's confirm-a-draft endpoint — activating any kit
 * (manual or extracted) archives whatever was active before it the same way. */
export async function archiveActiveKit(orgId) {
  const { error } = await supabaseAdmin
    .from('brand_kits')
    .update({ status: 'archived' })
    .eq('org_id', orgId)
    .eq('status', 'active');
  if (error) throw error;
}

/**
 * @param {object} opts
 * @param {string} opts.orgId
 * @param {string} opts.userId
 * @param {string} opts.name              Company/brand display name
 * @param {string} opts.primaryHex
 * @param {string} opts.secondaryHex
 * @param {{asset_id: string, format: 'svg'|'png'|'jpg', variant?: string}[]} opts.logos
 *        Already-ingested Brand Kit assets (see ingest.js) — this function
 *        does not upload files itself, it only assembles the kit document.
 * @param {'minimal_light'|'bold_dark'|'corporate_classic'} opts.layoutStyle
 */
export async function createManualBrandKit({ orgId, userId, name, primaryHex, secondaryHex, logos, layoutStyle }) {
  if (!name?.trim()) throw new Error('A brand/company name is required.');
  if (!logos?.length) throw new Error('At least one logo is required.');
  const preset = LAYOUT_PRESETS[layoutStyle];
  if (!preset) throw new Error(`Unknown layout style "${layoutStyle}" — choose one of ${Object.keys(LAYOUT_PRESETS).join(', ')}.`);

  const primary = normalizeHex(primaryHex);
  const secondary = normalizeHex(secondaryHex);
  const now = new Date().toISOString();
  const version = await nextVersion(orgId);
  const kitId = crypto.randomUUID();

  const kit = {
    kit_id: kitId,
    tenant_id: orgId,
    version,
    status: 'active',
    created_at: now,
    confirmed_at: now,
    confirmed_by: userId,
    identity: { legal_name: name.trim() },
    colors: {
      primary: { hex: primary },
      secondary: { hex: secondary },
      text: {
        // System defaults: a manual two-colour pick says nothing about
        // body-text contrast, so this never repurposes the brand colours
        // themselves as text colour without evidence they're readable at
        // body size — see "never invent brand values."
        heading: { hex: '#1A1A1A' },
        body: { hex: '#1A1A1A' },
        muted: { hex: '#6B7280' },
        on_dark: { hex: '#FFFFFF' },
      },
      surface: { page: { hex: '#FFFFFF' }, dark: { hex: '#111111' }, tint: { hex: '#F5F5F5' }, hairline: { hex: '#E5E7EB' } },
    },
    typography: { display: SYSTEM_DEFAULT_TYPEFACE, heading: SYSTEM_DEFAULT_TYPEFACE, body: SYSTEM_DEFAULT_TYPEFACE },
    logos: logos.map((l) => ({ asset_id: l.asset_id, variant: l.variant ?? 'primary', format: l.format })),
    layout: { page_size: 'A4', ...preset },
    provenance: {
      'identity.legal_name': provenanceEntry('user_entered', userId),
      'colors.primary': provenanceEntry('user_entered', userId),
      'colors.secondary': provenanceEntry('user_entered', userId),
      'colors.text': provenanceEntry('system_default', userId),
      'colors.surface': provenanceEntry('system_default', userId),
      'typography': provenanceEntry('system_default', userId),
      'logos': provenanceEntry('user_entered', userId),
      'layout': provenanceEntry('user_entered', userId, 1), // the preset choice itself was user_entered, even though its values are fixed
    },
  };

  validateBrandKit(kit);

  await archiveActiveKit(orgId);

  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .insert({
      id: kitId,
      org_id: orgId,
      version,
      status: 'active',
      kit_json: kit,
      created_by: userId,
      confirmed_at: now,
      confirmed_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getActiveBrandKit(orgId) {
  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Any kit (draft, awaiting_review, active, or archived) by id, scoped to
 * the org — the confirmation UI reads a specific draft this way, not just
 * whatever's currently active. */
export async function getBrandKitById(orgId, kitId) {
  const { data, error } = await supabaseAdmin.from('brand_kits').select('*').eq('org_id', orgId).eq('id', kitId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listBrandKits(orgId) {
  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .select('*')
    .eq('org_id', orgId)
    .order('version', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function updateBrandKit(orgId, kitId, patch) {
  const { data, error } = await supabaseAdmin.from('brand_kits').update(patch).eq('org_id', orgId).eq('id', kitId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBrandKit(orgId, kitId) {
  const { error } = await supabaseAdmin.from('brand_kits').delete().eq('org_id', orgId).eq('id', kitId);
  if (error) throw error;
}
