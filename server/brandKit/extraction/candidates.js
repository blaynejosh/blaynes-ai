/**
 * Gathers everything Phase 1's deterministic extractors already found for
 * an organization's ingested assets, shaped for the extraction model
 * (extractKit.js) to select and assign roles to — never to invent from.
 *
 * "Deterministic extraction... first" (Phase 2 brief) means this file's
 * output is the model's evidence, not its imagination: hex candidates come
 * from parsed palette files, logo dominant-colour sampling, and hex strings
 * literally present in guideline/profile text — every one of them already
 * verified against real bytes before the model ever sees them.
 */
import { listBrandKitAssets } from '../ingest.js';
import { extractHexFromText } from '../extractors/color.js';

const HEX_SOURCE_KINDS = new Set(['palette', 'logo']);

/**
 * @returns {{
 *   assetsByKind: Record<string, object[]>,
 *   colorCandidates: {hex: string, sourceAssetId: string, sourceKind: string}[],
 *   fontAssets: object[],
 *   logoAssets: object[],
 * }}
 */
export async function gatherCandidates(orgId) {
  const all = await listBrandKitAssets(orgId);

  const assetsByKind = {};
  for (const asset of all) {
    (assetsByKind[asset.kind] ??= []).push(asset);
  }

  const colorCandidates = [];
  const seen = new Set();
  const pushColor = (hex, sourceAssetId, sourceKind) => {
    const key = `${hex.toUpperCase()}|${sourceAssetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    colorCandidates.push({ hex: hex.toUpperCase(), sourceAssetId, sourceKind });
  };

  for (const asset of all) {
    if (!HEX_SOURCE_KINDS.has(asset.kind)) continue;
    const colors = asset.extracted?.colors ?? asset.extracted?.dominant_colors ?? [];
    for (const c of colors) {
      if (c?.hex) pushColor(c.hex, asset.id, asset.kind);
    }
  }

  // Hex strings literally written in a guideline/corporate profile's text —
  // ingest.js already stored per-page/per-slide text in `extracted`, so
  // this is a re-scan of already-extracted text, not a fresh file read.
  for (const kind of ['guideline', 'corporate_profile', 'sample_document']) {
    for (const asset of assetsByKind[kind] ?? []) {
      const pageTexts = (asset.extracted?.pages ?? asset.extracted?.slides ?? []).map((p) => p.text).filter(Boolean);
      for (const text of pageTexts) {
        for (const { hex } of extractHexFromText(text)) pushColor(hex, asset.id, kind);
      }
    }
  }

  return {
    assetsByKind,
    colorCandidates,
    fontAssets: assetsByKind.font ?? [],
    logoAssets: assetsByKind.logo ?? [],
  };
}
