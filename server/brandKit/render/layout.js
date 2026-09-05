/**
 * The shared layout engine every SVG exhibit component (render/svg/*.js)
 * is built on — "Build them as SVG components with a shared layout engine
 * so text length changes do not break them... Overflowing text in an
 * exhibit is the single most common way a generated document looks
 * amateur."
 *
 * Real text measurement (@napi-rs/canvas — the same native-binding library
 * pdf-parse already depends on for PDF page rendering, now a direct
 * dependency since this module leans on it explicitly), not a guessed
 * average-character-width heuristic: wrapping decisions and "does this
 * still fit" checks are only as good as the width numbers behind them.
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const measureCanvas = createCanvas(10, 10);
const measureCtx = measureCanvas.getContext('2d');

/** Registers a tenant's font file with @napi-rs/canvas so measurements
 * (and, eventually, canvas-based rasterization) use the real metrics
 * instead of falling back to a generic sans-serif substitute. Safe to call
 * more than once — GlobalFonts.registerFromPath is idempotent per file. */
export function registerFontForMeasurement(filePath, familyName) {
  try {
    GlobalFonts.registerFromPath(filePath, familyName);
  } catch (err) {
    console.warn(`[blayne] could not register font "${familyName}" for layout measurement:`, err.message);
  }
}

function cssFont(sizePx, family, weight = 400) {
  return `${weight} ${sizePx}px "${family}"`;
}

export function measureText(text, { sizePx, family, weight = 400 }) {
  measureCtx.font = cssFont(sizePx, family, weight);
  return measureCtx.measureText(text).width;
}

/**
 * Greedy word wrap against a real pixel width, returning the lines. This is
 * what keeps every SVG exhibit component honest about how much text
 * actually fits — a caller asking "how many lines will this take" or "does
 * this overflow N lines" builds on this rather than guessing.
 */
export function wrapText(text, maxWidthPx, { sizePx, family, weight = 400 }) {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureText(candidate, { sizePx, family, weight }) <= maxWidthPx || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Truncates a single line to fit maxWidthPx, appending an ellipsis — for
 * labels that must stay on one line (axis ticks, legend entries) rather
 * than wrap. Returns the original text unchanged if it already fits.
 */
export function truncateToWidth(text, maxWidthPx, { sizePx, family, weight = 400 }) {
  if (measureText(text, { sizePx, family, weight }) <= maxWidthPx) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}…`;
    if (measureText(candidate, { sizePx, family, weight }) <= maxWidthPx) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '…' : `${text.slice(0, lo)}…`;
}

/** XML-escapes text for safe interpolation into an SVG/HTML string —
 * every SVG component in render/svg/ must run label/body text through this
 * before interpolating, since IR text comes from the model and, upstream of
 * that, from a tenant's own uploaded material. */
export function escapeXml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}

/** Common SVG chrome every exhibit component wraps its content in. */
export function svgDocument(width, height, innerContent, { background } = {}) {
  const bg = background ? `<rect width="${width}" height="${height}" fill="${escapeXml(background)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}${innerContent}</svg>`;
}
