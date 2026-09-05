/**
 * Logo analysis — "detect transparency, dimensions, and whether the mark is
 * light or dark. Derive missing variants where safe (a white version from a
 * solid single-colour SVG); never invent a variant from a raster logo with
 * anti-aliased edges."
 */
import sharp from 'sharp';

/**
 * Dimensions, transparency, and a light/dark call based on the average
 * luminance of non-transparent pixels (down-sampled for speed — a logo is a
 * flat-enough image that this doesn't need full resolution).
 */
export async function analyzeLogo(buffer) {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  const { data, info } = await image
    .clone()
    .resize(48, 48, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let luminanceSum = 0;
  let opaquePixels = 0;
  let hasTransparency = false;

  for (let i = 0; i < data.length; i += info.channels) {
    const alpha = info.channels === 4 ? data[i + 3] : 255;
    if (alpha < 250) hasTransparency = true;
    if (alpha < 16) continue;
    // Standard relative luminance weights.
    luminanceSum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    opaquePixels += 1;
  }

  const avgLuminance = opaquePixels ? luminanceSum / opaquePixels : 255;

  return {
    format: metadata.format,
    width_px: metadata.width ?? null,
    height_px: metadata.height ?? null,
    // Whether any pixel is actually translucent — not whether the file
    // format merely carries an alpha channel. An RGBA PNG exported fully
    // opaque (metadata.hasAlpha === true) must not be reported as
    // transparent; only real transparent/translucent pixels count.
    has_transparency: hasTransparency,
    // "Light" mark (works on a dark background) vs. "dark" mark (works on a
    // light background) — 128 is the standard 8-bit luminance midpoint.
    tone: avgLuminance < 128 ? 'dark' : 'light',
    avg_luminance: Math.round(avgLuminance),
    method: 'extracted_deterministic',
  };
}

// --- SVG single-colour variant derivation -----------------------------------

// {6} must come before {3} in the alternation — regex alternation takes the
// first branch that matches at all, not the longest, so #1A73E8 against
// {3}|{6} would wrongly stop after "1A7" (the trailing optional quote group
// still matches empty, so nothing forces backtracking into the {6} branch).
const FILL_OR_STROKE_HEX = /((?:fill|stroke)\s*[:=]\s*["']?)#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(["']?)/g;

/** Every distinct hex colour a fill/stroke attribute or style declaration
 * references, ignoring 'none'/'currentColor'/url(#...) references. */
function distinctSvgColors(svgText) {
  const colors = new Set();
  for (const match of svgText.matchAll(FILL_OR_STROKE_HEX)) {
    colors.add(match[2].toLowerCase());
  }
  return colors;
}

/**
 * Produces a white-on-transparent variant, but only when it's actually
 * safe: an SVG whose only colour references are a single hex value. Two or
 * more distinct colours means this is a multi-tone mark where "make it
 * white" would destroy real information (e.g. a wordmark plus a differently
 * coloured icon) — refuse rather than guess which parts should turn white.
 * Returns null when derivation isn't safe; callers must not fall back to
 * doing it anyway.
 */
export function deriveWhiteVariantFromSvg(svgText) {
  const colors = distinctSvgColors(svgText);
  if (colors.size !== 1) return null;

  const [only] = colors;
  const hexPattern = new RegExp(`#${only}\\b`, 'gi');
  return svgText.replace(hexPattern, '#ffffff');
}
