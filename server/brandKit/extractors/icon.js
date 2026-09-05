/**
 * Icon set analysis — "normalise to SVG where possible, record stroke
 * weight and style."
 *
 * Three real cases: an SVG icon (record its own stroke weight/style
 * directly — nothing to normalise, it's already SVG), a raster icon
 * (PNG/JPG — recorded as-is; tracing a raster icon to a vector is out of
 * scope, same reasoning as logo.js's refusal to derive variants from
 * anti-aliased raster edges), and an icon font (a single TTF/WOFF file
 * where each glyph is one icon — delegated to extractors/font.js for
 * metadata, since it's a font file first and an icon set second).
 */
const VIEWBOX_RE = /viewBox\s*=\s*["']\s*([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s+([\d.\-]+)\s*["']/i;
const STROKE_WIDTH_RE = /stroke-width\s*[:=]\s*["']?([\d.]+)/i;
const HAS_STROKE_RE = /\bstroke\s*[:=]\s*["']?(?!none\b)[^"';\s)]/i;
const HAS_FILL_RE = /\bfill\s*[:=]\s*["']?(?!none\b)[^"';\s)]/i;

/**
 * style is a best-effort call, not a hard classification: 'line' (stroke
 * present, no meaningful fill — the common "outline icon" shape), 'solid'
 * (filled, no stroke), or 'duotone'/'mixed' when both are present — the
 * confirmation UI (Phase 2) is where a human corrects a wrong guess, same
 * as every other extracted_deterministic field.
 */
export function analyzeSvgIcon(svgText) {
  const viewBoxMatch = svgText.match(VIEWBOX_RE);
  const strokeWidthMatch = svgText.match(STROKE_WIDTH_RE);
  const hasStroke = HAS_STROKE_RE.test(svgText);
  const hasFill = HAS_FILL_RE.test(svgText);

  let style = 'unknown';
  if (hasStroke && !hasFill) style = 'line';
  else if (hasFill && !hasStroke) style = 'solid';
  else if (hasStroke && hasFill) style = 'mixed';

  return {
    view_box: viewBoxMatch
      ? { minX: Number(viewBoxMatch[1]), minY: Number(viewBoxMatch[2]), width: Number(viewBoxMatch[3]), height: Number(viewBoxMatch[4]) }
      : null,
    stroke_weight: strokeWidthMatch ? Number(strokeWidthMatch[1]) : null,
    style,
    method: 'extracted_deterministic',
  };
}

export function analyzeRasterIcon(metadata) {
  return {
    format: metadata.format,
    width_px: metadata.width ?? null,
    height_px: metadata.height ?? null,
    normalized_to_svg: false,
    note: 'Raster icon — not traced to a vector. Provide an SVG source for a normalized icon set.',
    method: 'extracted_deterministic',
  };
}
