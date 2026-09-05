/**
 * Deterministic colour extraction — "deterministic extraction first, model
 * extraction only as fallback" (Phase 1 table). Three sources this module
 * handles directly: hex strings in plain text/SVG, Adobe Swatch Exchange
 * (.ase) binary files, and dominant-colour sampling from a swatch image.
 * PDF/docx guideline text also gets fed through extractHexFromText() —
 * that's the "parse hex strings" half of the brief's colour row; picking
 * out *which* extracted colour is the primary vs. a tint is the model's job
 * (Phase 2), not this module's.
 *
 * Every function here returns plain { hex, source } candidates with no
 * opinion on role (primary/secondary/accent) — that's Phase 2's provenance
 * layer to assign, this module only ever produces `extracted_deterministic`
 * material.
 */
import sharp from 'sharp';

const HEX_RE = /#?\b([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function normalizeHex(raw) {
  let h = raw.replace('#', '').toUpperCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

/** Pulls every plausible hex colour out of free text (guideline body text,
 * SVG source, CSS-like snippets). Bare 3/6-digit hex runs inside ordinary
 * prose (a product code, a hash fragment) are an accepted false-positive
 * risk here — Phase 2's confirmation UI is exactly where a human filters
 * these, and "confirmed: false by default" already protects against one
 * slipping into a generated document unreviewed. */
export function extractHexFromText(text) {
  const found = new Map(); // hex -> first-match context
  for (const match of text.matchAll(HEX_RE)) {
    const hex = normalizeHex(match[1]);
    if (!found.has(hex)) {
      const start = Math.max(0, match.index - 24);
      found.set(hex, text.slice(start, match.index + match[0].length + 24).trim());
    }
  }
  return [...found.entries()].map(([hex, context]) => ({ hex, context, method: 'extracted_deterministic' }));
}

// --- Adobe Swatch Exchange (.ase) ------------------------------------------

function labToHex(L, a, b) {
  // Lab -> XYZ (D65) -> linear sRGB -> gamma-corrected sRGB, standard path.
  const y = (L + 16) / 116;
  const x = a / 500 + y;
  const z = y - b / 200;
  const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = 0.95047 * f(x);
  const Y = 1.0 * f(y);
  const Z = 1.08883 * f(z);

  let r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
  let g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
  let bl = X * 0.0557 + Y * -0.204 + Z * 1.057;
  const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  r = gamma(r);
  g = gamma(g);
  bl = gamma(bl);

  const clamp8 = (c) => Math.max(0, Math.min(255, Math.round(c * 255)));
  return rgbToHex(clamp8(r), clamp8(g), clamp8(bl));
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

function cmykToHex(c, m, y, k) {
  const r = 255 * (1 - c) * (1 - k);
  const g = 255 * (1 - m) * (1 - k);
  const b = 255 * (1 - y) * (1 - k);
  return rgbToHex(Math.round(r), Math.round(g), Math.round(b));
}

/**
 * Parses an .ase file's colour entries (flat or nested in groups — groups
 * are just skipped as structure, their child colours still yielded). Throws
 * on a bad signature/version rather than returning an empty, misleadingly
 * "successful" result — an .ase upload that fails to parse should surface
 * as an error to the user, not silently produce zero colours.
 */
export function parseAse(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'ASEF') {
    throw new Error('Not a valid .ase (Adobe Swatch Exchange) file — missing ASEF signature.');
  }
  const blockCount = buffer.readUInt32BE(8);
  const colors = [];
  let offset = 12;

  for (let i = 0; i < blockCount && offset < buffer.length; i += 1) {
    const blockType = buffer.readUInt16BE(offset);
    const blockLength = buffer.readUInt32BE(offset + 2);
    const blockStart = offset + 6;

    if (blockType === 0x0001) {
      let p = blockStart;
      const nameLen = buffer.readUInt16BE(p);
      p += 2;
      // ASE names are UTF-16BE; Node has no native BE-UTF16 decoder, so swap
      // byte pairs before reading as utf16le rather than mis-decoding.
      const nameBytes = buffer.subarray(p, p + (nameLen - 1) * 2);
      const swapped = Buffer.alloc(nameBytes.length);
      for (let j = 0; j + 1 < nameBytes.length; j += 2) {
        swapped[j] = nameBytes[j + 1];
        swapped[j + 1] = nameBytes[j];
      }
      const realName = swapped.toString('utf16le');
      p += nameLen * 2;

      const model = buffer.toString('ascii', p, p + 4).trim();
      p += 4;

      let hex = null;
      if (model === 'RGB') {
        const r = buffer.readFloatBE(p);
        const g = buffer.readFloatBE(p + 4);
        const b = buffer.readFloatBE(p + 8);
        hex = rgbToHex(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255));
        p += 12;
      } else if (model === 'CMYK') {
        const c = buffer.readFloatBE(p);
        const m = buffer.readFloatBE(p + 4);
        const y = buffer.readFloatBE(p + 8);
        const k = buffer.readFloatBE(p + 12);
        hex = cmykToHex(c, m, y, k);
        p += 16;
      } else if (model === 'LAB') {
        const L = buffer.readFloatBE(p) * 100;
        const a = buffer.readFloatBE(p + 4);
        const b = buffer.readFloatBE(p + 8);
        hex = labToHex(L, a, b);
        p += 12;
      } else if (model === 'Gray') {
        const g = buffer.readFloatBE(p);
        const v = Math.round(g * 255);
        hex = rgbToHex(v, v, v);
        p += 4;
      }

      if (hex) {
        colors.push({ hex, name: realName || null, method: 'extracted_deterministic' });
      }
    }

    offset = blockStart + blockLength;
  }

  return colors;
}

// --- Swatch / palette image sampling ----------------------------------------

function colorDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/**
 * Dominant-colour extraction for a generic palette/swatch image: downsample
 * heavily (cheap, and swatches are large flat fields so detail loss doesn't
 * matter), bucket pixels, then greedily merge buckets closer than
 * mergeThreshold in RGB space so a swatch's anti-aliased edge pixels don't
 * each register as their own colour. This is intentionally generic rather
 * than assuming a known grid layout — "sample swatch centres" from the
 * brief assumes a regular grid the caller doesn't have here; this is the
 * layout-agnostic equivalent of the same idea.
 */
export async function extractDominantColors(buffer, { maxColors = 12, mergeThreshold = 24 } = {}) {
  const { data, info } = await sharp(buffer)
    .resize(64, 64, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const counts = new Map();
  for (let i = 0; i < data.length; i += info.channels) {
    const alpha = info.channels === 4 ? data[i + 3] : 255;
    if (alpha < 16) continue; // skip transparent pixels
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = [...counts.entries()]
    .map(([key, count]) => ({ rgb: key.split(',').map(Number), count }))
    .sort((a, b) => b.count - a.count);

  const clusters = [];
  for (const { rgb, count } of sorted) {
    const near = clusters.find((c) => colorDistance(c.rgb, rgb) < mergeThreshold);
    if (near) {
      near.count += count;
    } else {
      clusters.push({ rgb, count });
      if (clusters.length >= maxColors) break;
    }
  }

  return clusters
    .sort((a, b) => b.count - a.count)
    .map(({ rgb, count }) => ({
      hex: rgbToHex(rgb[0], rgb[1], rgb[2]),
      pixelShare: count,
      method: 'extracted_deterministic',
    }));
}
