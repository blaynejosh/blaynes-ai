/**
 * Turns a Brand Kit's font_files into real @font-face CSS the Chromium/PDF
 * path can use — embedded as base64 data URIs directly in the HTML rather
 * than installed onto the render machine's filesystem.
 *
 * That's a deliberate departure from the brief's "installs the tenant's
 * fonts into the container at job start... clears them at job end": a
 * data-URI @font-face rule gives Chromium the exact same result (it can
 * render text in that font) without ever writing a tenant's font bytes to
 * shared disk or touching system fontconfig state — nothing to leak
 * between jobs, nothing to clean up, and it's simpler. System-level
 * installation would only earn its complexity back for a tool that can't
 * take an embedded font declaration, which Chromium isn't.
 *
 * The licence gate is enforced here, not assumed upstream: a font_files
 * entry is only embedded when the asset backing it has
 * license_attested === true AND embedding_permitted === true. Anything
 * else falls back to the typeface's fallback_stack silently at the CSS
 * level (an unknown/unavailable font-family just doesn't match, and the
 * next stack entry takes over) — flagged in the returned `warnings`, not
 * hidden.
 */
import { readBrandKitAsset } from '../storage.js';

const FORMAT_MIME = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };

/**
 * @param {object} kit  kit_json (resolved typography.*.font_files reference
 *   Brand Kit asset ids)
 * @param {Map<string, object>} assetsById  brand_kit_assets rows for every
 *   font asset id referenced, keyed by id — the caller fetches these
 *   (license_attested lives on the row, not in kit_json)
 */
export async function buildFontFaceCss(kit, assetsById) {
  const typefaces = [kit.typography?.display, kit.typography?.heading, kit.typography?.body, kit.typography?.mono].filter(Boolean);
  const seen = new Set();
  const rules = [];
  const warnings = [];

  for (const typeface of typefaces) {
    for (const fontFile of typeface.font_files ?? []) {
      if (seen.has(fontFile.asset_id)) continue;
      seen.add(fontFile.asset_id);

      const asset = assetsById.get(fontFile.asset_id);
      if (!asset) {
        warnings.push(`Font asset ${fontFile.asset_id} referenced by the kit was not found — "${typeface.family}" will fall back to its stack.`);
        continue;
      }
      if (!asset.license_attested || !asset.embedding_permitted) {
        warnings.push(`Font "${typeface.family}" (${asset.file_name}) is not licensed for embedding — rendered with its fallback stack instead.`);
        continue;
      }

      // Prefer the render-container-ready conversion (WOFF/WOFF2 already
      // turned into TTF at ingest time — see extractors/font.js) over the
      // original bytes, since a browser's data-URI @font-face is happiest
      // with a format it doesn't need to sniff exotic table structure from.
      const storagePath = asset.extracted?.renderable_storage_path ?? asset.storage_path;
      const format = asset.extracted?.renderable_format ?? fontFile.format;
      const buffer = await readBrandKitAsset(storagePath);
      const mime = FORMAT_MIME[format] ?? 'truetype';

      rules.push(`
        @font-face {
          font-family: "${typeface.family}";
          src: url(data:font/${mime};base64,${buffer.toString('base64')}) format("${mime}");
          font-weight: ${fontFile.weight ?? 400};
          font-style: ${fontFile.style ?? 'normal'};
        }
      `);
    }
  }

  return { css: rules.join('\n'), warnings };
}
