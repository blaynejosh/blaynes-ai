/**
 * Font metadata extraction and format conversion — "read the internal name
 * table for the real family name; the filename lies often enough to
 * matter" and "convert WOFF and WOFF2 to TTF or OTF for server-side
 * rendering."
 *
 * Two libraries, deliberately: fontkit (read-only) for everything about
 * *reading* a font accurately — name table, OS/2, fsType — because its API
 * for that is clean and it can already parse TTF/OTF/WOFF/WOFF2 directly
 * without a conversion step. fonteditor-core (read+write) only for the one
 * thing fontkit can't do: re-serializing WOFF/WOFF2 bytes as a real TTF the
 * render container's Chromium/LibreOffice can actually install as a system
 * font — Chromium and LibreOffice don't load WOFF as an installed font file
 * the way a browser's @font-face does.
 *
 * Conversion always targets TTF, never OTF: fonteditor-core's own docs say
 * OTF is "read and convert to ttf" only, not a real write target — so an
 * already-OTF upload is left as OTF (no conversion needed, it's already
 * usable), and a WOFF/WOFF2 upload converts to TTF, never OTF.
 */
import * as fontkit from 'fontkit';
import { createFont, woff2 as woff2Module } from 'fonteditor-core';
import zlib from 'node:zlib';

let woff2Ready = null;
function ensureWoff2() {
  if (!woff2Ready) woff2Ready = woff2Module.init();
  return woff2Ready;
}

const FORMAT_BY_EXT = { '.ttf': 'ttf', '.otf': 'otf', '.woff': 'woff', '.woff2': 'woff2' };

function detectFormat(fileName, buffer) {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  if (FORMAT_BY_EXT[ext]) return FORMAT_BY_EXT[ext];
  // Fall back to magic bytes if the extension is missing/wrong — a
  // mislabeled font file shouldn't just fail outright.
  const magic = buffer.toString('ascii', 0, 4);
  if (magic === 'wOFF') return 'woff';
  if (magic === 'wOF2') return 'woff2';
  if (magic === 'OTTO') return 'otf';
  return 'ttf'; // covers 0x00010000 and 'true'/'typ1' sfnt signatures
}

/**
 * Reads everything the brief asks for: internal family name (never the
 * filename), weight/style, and whether the OS/2 table is readable plus what
 * fsType permits. A font with no OS/2 table (some hand-built icon fonts
 * omit it) is reported as such rather than assumed permissive — the
 * license-attestation gate in ingest.js treats "can't determine fsType" the
 * same as "restrictive," never as "assume it's fine."
 */
export function extractFontMetadata(buffer, fileName) {
  const font = fontkit.create(buffer);
  const os2 = font['OS/2'] ?? null;

  return {
    format: detectFormat(fileName, buffer),
    internal_family_name: font.familyName ?? null,
    full_name: font.fullName ?? null,
    subfamily_name: font.subfamilyName ?? null, // typically weight/style, e.g. "Bold Italic"
    postscript_name: font.postscriptName ?? null,
    units_per_em: font.unitsPerEm ?? null,
    os2_table_present: Boolean(os2),
    fs_type: os2
      ? {
          no_embedding: Boolean(os2.fsType?.noEmbedding),
          view_only: Boolean(os2.fsType?.viewOnly),
          editable: Boolean(os2.fsType?.editable),
          no_subsetting: Boolean(os2.fsType?.noSubsetting),
          bitmap_only: Boolean(os2.fsType?.bitmapOnly),
        }
      : null,
    method: 'extracted_deterministic',
  };
}

/**
 * Converts WOFF/WOFF2 bytes to a real TTF buffer for the render container.
 * Returns { buffer, format: 'ttf' } for woff/woff2 input, or null for
 * ttf/otf input (already usable as-is, nothing to convert).
 */
export async function convertToRenderableFormat(buffer, fileName) {
  const format = detectFormat(fileName, buffer);
  if (format === 'ttf' || format === 'otf') return null;

  if (format === 'woff2') await ensureWoff2();

  const inflate = (data) => zlib.inflateSync(Buffer.from(data));
  const font = createFont(buffer, { type: format, inflate });
  const ttfBuffer = font.write({ type: 'ttf' });
  return { buffer: ttfBuffer, format: 'ttf' };
}
