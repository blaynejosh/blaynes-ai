/**
 * The one model call in the entire Brand Kit intake pipeline — everything
 * upstream (Phase 1's extractors) is deterministic, and everything
 * downstream (proposals.js, finalizeDraft.js) is a pure function. This
 * module is the seam: it shows the model what Phase 1 already extracted
 * (guideline/profile page text and images, sample-document text for voice,
 * the deterministic colour-candidate list, uploaded font/logo file names)
 * and asks it to do the one thing only a model can — read a guideline page
 * and understand *which* colour is the primary and which is a tint, pick
 * out tone-of-voice rules, name banned words — never to invent a value from
 * nothing.
 *
 * The model responds by calling propose_brand_kit_fields, never free text.
 * Every proposal still goes through applyProposals()'s validation (a
 * hallucinated source_asset_id or a malformed hex is dropped, not trusted)
 * before it becomes part of the draft.
 */
import crypto from 'node:crypto';
import { claudeClient, MODEL } from '../../claudeClient.js';
import { supabaseAdmin } from '../../supabaseAdmin.js';
import { readBrandKitAsset } from '../storage.js';
import { gatherCandidates } from './candidates.js';
import { applyProposals, PATH_SPECS } from './proposals.js';
import { finalizeDraft } from './finalizeDraft.js';
import { validateBrandKit } from '../schema.js';

/** Bounds both cost and latency — a 200-page guideline doesn't need every
 * page sent to the model, brand rules are near-universally concentrated in
 * the first section of a real brand manual. */
const MAX_PAGES_PER_ASSET = Number(process.env.BRAND_KIT_EXTRACTION_MAX_PAGES_PER_ASSET ?? 20);

const PROPOSE_FIELDS_TOOL = {
  name: 'propose_brand_kit_fields',
  description:
    'Propose Brand Kit field values found in the material you were shown. Call this once, with every field you can confidently support from the source material — never propose a field you cannot point to evidence for. Only propose paths from the allowed list; anything else is dropped. Every proposal must cite the asset_id it came from and, where the source is a paginated document, the page or slide number.',
  input_schema: {
    type: 'object',
    required: ['fields'],
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'value', 'source_asset_id', 'confidence'],
          properties: {
            path: { type: 'string', enum: Object.keys(PATH_SPECS) },
            value: {
              description:
                'A hex colour as "#RRGGBB", a plain string, an array of strings/hex colours, a boolean, or (for the "logos" path only) an array of {asset_id, variant} — matching whatever shape that path expects.',
            },
            source_asset_id: { type: 'string', description: 'The asset_id this value came from — must be one of the assets you were shown.' },
            source_locator: { type: 'string', description: 'Page or slide number the value appears on, if the source is paginated.' },
            confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Your honest confidence this value is correct, not just "did I find something."' },
          },
        },
      },
    },
  },
};

const EXTRACTION_SYSTEM_PROMPT = `You are extracting a structured Brand Kit from a tenant's own brand material for Blayne's Consulting's Document Engine.

Rules that matter more than completeness:
- Never invent a value. If the material does not state or clearly show something, do not propose that field at all — an unset field gets a safe system default, which is correct behaviour, not a failure on your part.
- A colour role (primary/secondary/accent) is a judgement call about what you SEE on the page — which swatch is used most prominently, which one the guideline calls "primary" — not something you read off a hex code alone. Prefer a hex value from the "known colour candidates" list you're given when one matches what you see; if the page clearly shows a colour with no candidate matching it, you may still propose the hex you observe, but say so at lower confidence.
- Tone-of-voice fields (voice.tone, voice.banned_words, voice.person, voice.spelling, voice.required_phrases) come only from what the material actually states about how the brand should sound — not from your own impression of the writing style.
- Every proposal must cite the real asset_id and, for a paginated document, the real page/slide number it came from. A citation to material you were not actually shown is worse than no proposal at all.
- confidence is your honest estimate that the VALUE is correct — not whether you found something. A guessed colour from a low-quality page image should score low.

Call propose_brand_kit_fields exactly once with everything you can support.`;

function buildAssetManifestText(assetsByKind, colorCandidates) {
  const lines = [];
  for (const [kind, assets] of Object.entries(assetsByKind)) {
    if (!assets.length) continue;
    lines.push(`\n## ${kind} assets`);
    for (const a of assets) {
      lines.push(`- asset_id: ${a.id} — file: "${a.file_name}"${a.page_count ? ` (${a.page_count} pages)` : ''}`);
    }
  }
  if (colorCandidates.length) {
    lines.push('\n## Known colour candidates (deterministically extracted — prefer these over a value you estimate yourself)');
    for (const c of colorCandidates) {
      lines.push(`- ${c.hex} (from asset ${c.sourceAssetId}, a ${c.sourceKind} file)`);
    }
  }
  return lines.join('\n');
}

/** Builds the actual Anthropic content blocks: page text, page images
 * (capped per asset), and sample-document text for voice. Returns the
 * blocks plus the set of asset ids actually shown, so proposals.js can
 * reject a citation to anything else. */
async function buildContentBlocks({ assetsByKind }) {
  const blocks = [{ type: 'text', text: 'Source material for this organization\'s Brand Kit:' }];
  const shownAssetIds = new Set();

  for (const kind of ['guideline', 'corporate_profile', 'sample_document']) {
    for (const asset of assetsByKind[kind] ?? []) {
      shownAssetIds.add(asset.id);
      blocks.push({ type: 'text', text: `\n--- ${kind} asset_id=${asset.id} ("${asset.file_name}") ---` });

      const pages = asset.extracted?.pages ?? asset.extracted?.slides ?? [];
      const pageImages = asset.extracted?.page_images ?? [];
      const imageByPage = new Map(pageImages.map((p) => [p.pageNumber, p.storagePath]));

      const pagesToShow = pages.slice(0, MAX_PAGES_PER_ASSET);
      for (const page of pagesToShow) {
        const pageNum = page.pageNumber ?? page.slideNumber;
        blocks.push({ type: 'text', text: `[page ${pageNum}]\n${page.text ?? ''}` });

        const imagePath = imageByPage.get(pageNum);
        if (imagePath) {
          const imgBuffer = await readBrandKitAsset(imagePath);
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: imgBuffer.toString('base64') },
          });
        }
      }
      if (pages.length > MAX_PAGES_PER_ASSET) {
        blocks.push({ type: 'text', text: `[... ${pages.length - MAX_PAGES_PER_ASSET} further pages not shown ...]` });
      }
      if (!pages.length && asset.extracted?.fullText) {
        blocks.push({ type: 'text', text: asset.extracted.fullText });
      }
    }
  }

  for (const asset of assetsByKind.logo ?? []) shownAssetIds.add(asset.id);
  for (const asset of assetsByKind.font ?? []) shownAssetIds.add(asset.id);
  for (const asset of assetsByKind.palette ?? []) shownAssetIds.add(asset.id);

  return { blocks, shownAssetIds };
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

async function getOrgName(orgId) {
  const { data, error } = await supabaseAdmin.from('organizations').select('name').eq('id', orgId).maybeSingle();
  if (error) throw error;
  return data?.name ?? 'Untitled organization';
}

/**
 * Runs one extraction pass and stores the result as a new 'awaiting_review'
 * brand_kits row (never overwrites an existing active kit — only the
 * confirm endpoint does that, and only on explicit human action).
 */
export async function runExtraction({ orgId, userId }) {
  const { assetsByKind, colorCandidates, fontAssets, logoAssets } = await gatherCandidates(orgId);

  if (!logoAssets.length) {
    throw new Error('Upload at least one logo before running Brand Kit extraction.');
  }
  const hasTextMaterial = ['guideline', 'corporate_profile', 'sample_document'].some((k) => (assetsByKind[k] ?? []).length);
  if (!hasTextMaterial) {
    throw new Error('Upload a brand guideline, corporate profile, or sample document before running extraction — there is nothing to read yet.');
  }

  const { blocks, shownAssetIds } = await buildContentBlocks({ assetsByKind });
  const manifestText = buildAssetManifestText(assetsByKind, colorCandidates);
  blocks.unshift({ type: 'text', text: manifestText });

  const response = await claudeClient.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: [PROPOSE_FIELDS_TOOL],
    tool_choice: { type: 'tool', name: 'propose_brand_kit_fields' },
    messages: [{ role: 'user', content: blocks }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'propose_brand_kit_fields');
  const rawProposals = toolUse?.input?.fields ?? [];

  const { kitFields, provenance, rejected } = applyProposals(rawProposals, shownAssetIds, logoAssets);
  if (rejected.length) {
    console.warn(`[blayne] Brand Kit extraction (org ${orgId}): dropped ${rejected.length} invalid proposal(s):`, rejected);
  }

  const orgName = await getOrgName(orgId);
  const { kit: kitFieldsFinal, provenance: finalProvenance } = finalizeDraft({
    kitFields,
    provenance,
    fontAssets,
    logoAssets,
    orgFallbackName: orgName,
  });

  const version = await nextVersion(orgId);
  const now = new Date().toISOString();
  const kit = {
    kit_id: crypto.randomUUID(),
    tenant_id: orgId,
    version,
    status: 'awaiting_review',
    created_at: now,
    ...kitFieldsFinal,
    provenance: finalProvenance,
  };

  // Every required top-level field is guaranteed present by finalizeDraft's
  // defaults, so this should always pass — but assert it rather than trust
  // it, the same discipline as everywhere else a kit is stored.
  validateBrandKit(kit);

  const { data, error } = await supabaseAdmin
    .from('brand_kits')
    .insert({ id: kit.kit_id, org_id: orgId, version, status: 'awaiting_review', kit_json: kit, created_by: userId })
    .select()
    .single();
  if (error) throw error;

  return { brandKit: data, rejectedProposalCount: rejected.length };
}
