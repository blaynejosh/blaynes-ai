/**
 * The renderer's entry point — "Input: document IR plus an active Brand
 * Kit. Output: .docx and .pdf." Everything upstream of this file
 * (tokens.js, exhibitToSvg.js, html.js, docx.js) is pure and format-layer
 * work; this module is the one place that does real I/O: reading a
 * tenant's logo/font/image bytes out of Cloud Storage and handing them to
 * the pure builders as already-resolved data.
 *
 * No model in the loop anywhere in this file or anything it calls —
 * "Deterministic, no model in the loop."
 */
import { chromium } from 'playwright';
import { resolveTokens } from '../tokens.js';
import { readBrandKitAsset } from '../storage.js';
import { validateIrForRendering } from './guards.js';
import { buildHtmlDocument } from './html.js';
import { renderDocxBuffer } from './docx.js';
import { buildFontFaceCss } from './fonts.js';

const IMAGE_MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const IMAGE_DOCX_TYPE = { png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', bmp: 'bmp' };

async function resolveLogoDataUri(tokens, assetsById) {
  const logoRef = tokens.logos?.[0];
  if (!logoRef) return null;
  const asset = assetsById.get(logoRef.asset_id);
  if (!asset) return null;
  const buffer = await readBrandKitAsset(asset.storage_path);
  const mime = IMAGE_MIME[logoRef.format] ?? asset.mime_type ?? 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Every `image` exhibit block's asset_id, resolved once up front — both
 * format adapters just read from this map, neither does its own GCS call.
 * A block referencing an asset_id outside this organization's own assets
 * throws here (assetsById is built only from this org's rows), which is
 * the cross-tenant guard the schema comment on `image.asset_id` calls for. */
async function resolveImageAssets(ir, assetsById) {
  const map = new Map();
  for (const block of ir.blocks ?? []) {
    if (block.type !== 'exhibit' || block.content?.kind !== 'image') continue;
    const asset = assetsById.get(block.content.asset_id);
    if (!asset) continue; // left unresolved — the format adapter throws a clear error when it's actually needed
    const buffer = await readBrandKitAsset(asset.storage_path);
    const format = asset.extracted?.format ?? (asset.mime_type?.split('/')[1] ?? 'png');
    const { default: sharp } = await import('sharp');
    const metadata = await sharp(buffer).metadata();
    map.set(block.content.asset_id, {
      buffer,
      width: metadata.width,
      height: metadata.height,
      dataUri: `data:${asset.mime_type};base64,${buffer.toString('base64')}`,
      docxType: IMAGE_DOCX_TYPE[format] ?? 'png',
    });
  }
  return map;
}

/**
 * @param {object} opts
 * @param {object} opts.ir  Document IR (document-ir.schema.json)
 * @param {object} opts.brandKit  brand_kits row's kit_json (must be an active kit — callers enforce that, this function trusts what it's given)
 * @param {object[]} opts.assets  brand_kit_assets rows for the same org (logos/fonts/images referenced by ir/brandKit resolve against these)
 * @param {'docx'|'pdf'} opts.format
 * @returns {Promise<{buffer: Buffer, warnings: string[]}>}
 */
export async function renderDocument({ ir, brandKit, assets, format }) {
  validateIrForRendering(ir);

  const tokens = resolveTokens(brandKit);
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const warnings = [...(tokens.warnings ?? []).map((w) => w.message)];

  const [logoDataUri, imageAssets] = await Promise.all([resolveLogoDataUri(tokens, assetsById), resolveImageAssets(ir, assetsById)]);

  if (format === 'docx') {
    const buffer = await renderDocxBuffer(ir, tokens, { imageAssets });
    return { buffer, warnings };
  }

  if (format === 'pdf') {
    const { css: fontFaceCss, warnings: fontWarnings } = await buildFontFaceCss(brandKit, assetsById);
    warnings.push(...fontWarnings);
    const html = buildHtmlDocument(ir, tokens, { imageAssets, logoDataUri, fontFaceCss });

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      const buffer = await page.pdf({
        width: tokens.layout.page_size === 'LETTER' ? '8.5in' : '210mm',
        height: tokens.layout.page_size === 'LETTER' ? '11in' : '297mm',
        printBackground: true,
      });
      return { buffer, warnings };
    } finally {
      await browser.close();
    }
  }

  throw new Error(`Unknown render format "${format}" — expected "docx" or "pdf".`);
}
