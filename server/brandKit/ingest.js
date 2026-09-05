/**
 * Asset ingestion orchestrator — Phase 1 of the Brand Kit brief. One
 * function, ingestAsset(), that every upload kind flows through: validate,
 * virus-scan (blocking — see virusScan.js), extract whatever is
 * deterministically extractable for that kind, store the original bytes,
 * store any derived bytes (a converted font, a rasterized guideline page,
 * a safely-derived white logo variant), and record one brand_kit_assets row
 * per real asset with its extraction result and provenance method.
 *
 * What this module deliberately does NOT do: call the model. Every
 * `extracted` value it produces is `method: 'extracted_deterministic'`.
 * Reading a guideline page and understanding "this colour is the primary"
 * is Phase 2's job, working from the text/page-images this module stores —
 * keeping the two apart is also why there's no prompt-injection surface
 * here yet: nothing in this file ever hands uploaded content to Claude.
 */
import { supabaseAdmin } from '../supabaseAdmin.js';
import { scanBuffer } from './virusScan.js';
import { storeBrandKitAsset, storeDerivedAsset } from './storage.js';
import { extractHexFromText, parseAse, extractDominantColors } from './extractors/color.js';
import { extractFontMetadata, convertToRenderableFormat } from './extractors/font.js';
import { analyzeLogo, deriveWhiteVariantFromSvg } from './extractors/logo.js';
import { analyzeSvgIcon, analyzeRasterIcon } from './extractors/icon.js';
import { extractPdf, extractDocx, extractPptx } from './extractors/document.js';
import sharp from 'sharp';

/**
 * Allowlist per upload kind — "file type allowlist, size caps" from the
 * brief, kind by kind rather than one blanket list, since a font upload and
 * a guideline upload have nothing in common. Extensions are checked
 * alongside MIME type because browsers/OSes are inconsistent about the
 * MIME type they report for less common formats (.ase has no registered
 * MIME type at all).
 */
const KIND_RULES = {
  guideline: {
    extensions: ['.pdf', '.docx', '.pptx'],
    maxBytes: 40 * 1024 * 1024,
  },
  corporate_profile: {
    extensions: ['.pdf', '.docx', '.pptx'],
    maxBytes: 40 * 1024 * 1024,
  },
  sample_document: {
    extensions: ['.pdf', '.docx', '.pptx'],
    maxBytes: 40 * 1024 * 1024,
  },
  logo: {
    extensions: ['.svg', '.png', '.jpg', '.jpeg'],
    maxBytes: 10 * 1024 * 1024,
  },
  palette: {
    extensions: ['.png', '.jpg', '.jpeg', '.ase', '.txt', '.csv', '.pdf'],
    maxBytes: 10 * 1024 * 1024,
  },
  font: {
    extensions: ['.ttf', '.otf', '.woff', '.woff2'],
    maxBytes: 15 * 1024 * 1024,
  },
  icon_set: {
    extensions: ['.svg', '.png', '.ttf', '.otf', '.woff', '.woff2'],
    maxBytes: 10 * 1024 * 1024,
  },
};

function extOf(fileName) {
  const i = fileName.lastIndexOf('.');
  return i === -1 ? '' : fileName.slice(i).toLowerCase();
}

function assertAllowed(kind, fileName, size) {
  const rules = KIND_RULES[kind];
  if (!rules) throw new Error(`Unknown Brand Kit asset kind "${kind}".`);
  const ext = extOf(fileName);
  if (!rules.extensions.includes(ext)) {
    throw new Error(`"${fileName}" isn't a supported file type for ${kind} — expected one of ${rules.extensions.join(', ')}.`);
  }
  if (size > rules.maxBytes) {
    throw new Error(`"${fileName}" is too large for ${kind} — the limit is ${Math.round(rules.maxBytes / (1024 * 1024))}MB.`);
  }
  return ext;
}

async function insertAssetRow({ orgId, userId, kind, fileName, mimeType, size, storagePath, pageCount, extracted, virusScanStatus }) {
  const { data, error } = await supabaseAdmin
    .from('brand_kit_assets')
    .insert({
      org_id: orgId,
      kind,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: size,
      storage_path: storagePath,
      page_count: pageCount ?? null,
      extracted: extracted ?? {},
      virus_scan_status: virusScanStatus,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function extractForKind(kind, ext, buffer, fileName) {
  // --- Guideline / corporate profile / sample document: text + (PDF only) page images ---
  if (kind === 'guideline' || kind === 'corporate_profile' || kind === 'sample_document') {
    if (ext === '.pdf') {
      const result = await extractPdf(buffer);
      return {
        pageCount: result.pageCount,
        extracted: {
          method: 'extracted_deterministic',
          truncated: result.truncated,
          pages: result.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text, hasImage: Boolean(p.image) })),
        },
        derivedPageImages: result.pages.filter((p) => p.image).map((p) => ({ pageNumber: p.pageNumber, buffer: p.image.buffer })),
        fullText: result.fullText,
      };
    }
    if (ext === '.docx') {
      const result = await extractDocx(buffer);
      return { pageCount: null, extracted: { method: 'extracted_deterministic', warnings: result.warnings }, fullText: result.fullText };
    }
    if (ext === '.pptx') {
      const result = await extractPptx(buffer);
      return {
        pageCount: result.slideCount,
        extracted: { method: 'extracted_deterministic', slides: result.slides.map((s) => ({ slideNumber: s.slideNumber, text: s.text })) },
        fullText: result.fullText,
      };
    }
  }

  // --- Logo ---
  if (kind === 'logo') {
    if (ext === '.svg') {
      const svgText = buffer.toString('utf-8');
      const raster = await sharp(Buffer.from(svgText)).png().toBuffer();
      const [analysis, dominantColors] = await Promise.all([analyzeLogo(raster), extractDominantColors(raster, { maxColors: 4 })]);
      return { extracted: { ...analysis, format: 'svg', svg_source: true, dominant_colors: dominantColors } };
    }
    // The mark itself is very often where a tenant's actual brand colour
    // lives — feeding these into Phase 2's colour-candidate set means the
    // extraction model can propose "primary = the colour of your own logo"
    // instead of needing that colour spelled out in guideline text too.
    const [analysis, dominantColors] = await Promise.all([analyzeLogo(buffer), extractDominantColors(buffer, { maxColors: 4 })]);
    return { extracted: { ...analysis, dominant_colors: dominantColors } };
  }

  // --- Palette ---
  if (kind === 'palette') {
    if (ext === '.ase') {
      return { extracted: { method: 'extracted_deterministic', colors: parseAse(buffer) } };
    }
    if (ext === '.txt' || ext === '.csv') {
      return { extracted: { method: 'extracted_deterministic', colors: extractHexFromText(buffer.toString('utf-8')) } };
    }
    if (ext === '.pdf') {
      const result = await extractPdf(buffer);
      return { extracted: { method: 'extracted_deterministic', colors: extractHexFromText(result.fullText) } };
    }
    // Image swatch.
    const colors = await extractDominantColors(buffer);
    return { extracted: { method: 'extracted_deterministic', colors } };
  }

  // --- Font ---
  if (kind === 'font') {
    const metadata = extractFontMetadata(buffer, fileName);
    const converted = await convertToRenderableFormat(buffer, fileName);
    return { extracted: metadata, converted };
  }

  // --- Icon set ---
  if (kind === 'icon_set') {
    if (ext === '.svg') {
      return { extracted: analyzeSvgIcon(buffer.toString('utf-8')) };
    }
    if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
      return { extracted: { ...extractFontMetadata(buffer, fileName), is_icon_font: true } };
    }
    const metadata = await sharp(buffer).metadata();
    return { extracted: analyzeRasterIcon(metadata) };
  }

  throw new Error(`No extractor wired up for kind "${kind}" with extension "${ext}".`);
}

/**
 * @param {object} opts
 * @param {string} opts.orgId
 * @param {string} opts.userId
 * @param {'guideline'|'corporate_profile'|'logo'|'palette'|'font'|'icon_set'|'sample_document'} opts.kind
 * @param {Buffer} opts.buffer
 * @param {string} opts.fileName
 * @param {string} opts.mimeType
 */
export async function ingestAsset({ orgId, userId, kind, buffer, fileName, mimeType }) {
  const ext = assertAllowed(kind, fileName, buffer.length);

  // Blocking — see virusScan.js. Throws (never returns "infected" as data)
  // so a caller can't accidentally continue past a failed scan.
  const scan = await scanBuffer(buffer, fileName);

  const { pageCount, extracted, derivedPageImages, converted } = await extractForKind(kind, ext, buffer, fileName);

  const storagePath = await storeBrandKitAsset(orgId, buffer, fileName);

  const row = await insertAssetRow({
    orgId,
    userId,
    kind,
    fileName,
    mimeType,
    size: buffer.length,
    storagePath,
    pageCount,
    extracted,
    virusScanStatus: scan.scanned ? 'clean' : 'skipped_dev',
  });

  const derived = [];

  // Rendered guideline pages, for Phase 2's vision-based extraction and its
  // side-by-side "here's the source page" confirmation view.
  if (derivedPageImages?.length) {
    const pagePaths = await Promise.all(
      derivedPageImages.map(({ pageNumber, buffer: pageBuf }) =>
        storeDerivedAsset(orgId, pageBuf, `${row.id}/page-${pageNumber}.png`).then((path) => ({ pageNumber, storagePath: path })),
      ),
    );
    await supabaseAdmin
      .from('brand_kit_assets')
      .update({ extracted: { ...extracted, page_images: pagePaths } })
      .eq('id', row.id);
    row.extracted = { ...extracted, page_images: pagePaths };
  }

  // A font converted to a render-container-usable TTF.
  if (converted) {
    const derivedPath = await storeDerivedAsset(orgId, converted.buffer, `${row.id}/renderable.${converted.format}`);
    await supabaseAdmin
      .from('brand_kit_assets')
      .update({ extracted: { ...extracted, renderable_storage_path: derivedPath, renderable_format: converted.format } })
      .eq('id', row.id);
    row.extracted = { ...extracted, renderable_storage_path: derivedPath, renderable_format: converted.format };
  }

  // A safely-derived white/on-dark logo variant — only ever attempted for a
  // single-colour SVG (see deriveWhiteVariantFromSvg's own doc comment for
  // why raster logos never go through this path).
  if (kind === 'logo' && ext === '.svg') {
    const whiteSvg = deriveWhiteVariantFromSvg(buffer.toString('utf-8'));
    if (whiteSvg) {
      const whiteBuffer = Buffer.from(whiteSvg, 'utf-8');
      const whiteRaster = await sharp(whiteBuffer).png().toBuffer();
      const whiteAnalysis = await analyzeLogo(whiteRaster);
      const whiteStoragePath = await storeBrandKitAsset(orgId, whiteBuffer, fileName.replace(/\.svg$/i, '.on-dark.svg'));
      const whiteRow = await insertAssetRow({
        orgId,
        userId,
        kind: 'logo',
        fileName: fileName.replace(/\.svg$/i, '.on-dark.svg'),
        mimeType: 'image/svg+xml',
        size: whiteBuffer.length,
        storagePath: whiteStoragePath,
        pageCount: null,
        extracted: { ...whiteAnalysis, format: 'svg', svg_source: true, derived_from_asset_id: row.id, derived_variant: 'on_dark' },
        virusScanStatus: scan.scanned ? 'clean' : 'skipped_dev', // derived from an already-scanned buffer, not a fresh upload
      });
      derived.push(whiteRow);
    }
  }

  return { asset: row, derived };
}

export async function listBrandKitAssets(orgId) {
  const { data, error } = await supabaseAdmin
    .from('brand_kit_assets')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getBrandKitAsset(orgId, assetId) {
  const { data, error } = await supabaseAdmin
    .from('brand_kit_assets')
    .select('*')
    .eq('org_id', orgId)
    .eq('id', assetId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
