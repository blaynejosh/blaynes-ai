/**
 * chart exhibit content — "A chart specification, never a rendered image
 * ... never chart code. The renderer owns the palette, axis treatment,
 * gridlines, label placement, legend, number formatting and
 * accessibility." This file is that ownership: every chart_type in
 * document-ir.schema.json's enum renders through here, reading only
 * resolved tokens (never a raw Brand Kit field) for every colour.
 *
 * is_estimate gets a real, visible treatment — a diagonal hatch fill and an
 * "ESTIMATE" badge — not just a note in a caption, per "a modelled figure
 * must never render as if it were measured."
 */
import { escapeXml, truncateToWidth, svgDocument } from '../layout.js';

const MARGIN = { top: 28, right: 20, bottom: 40, left: 48 };

function seriesColor(tokens, index, emphasis) {
  const palette = tokens.colors.chart_categorical;
  const base = palette[index % palette.length];
  return emphasis ? tokens.colors.primary : base;
}

function estimateBadge(width, isEstimate, colors, typography) {
  if (!isEstimate) return '';
  return `<text x="${width - 4}" y="12" text-anchor="end" font-size="9" font-weight="700" letter-spacing="0.5" font-family="${escapeXml(typography.body.family)}" fill="${colors.semantic.caution}">ESTIMATE</text>`;
}

function hatchDefs(id, color) {
  return `<pattern id="${id}" width="6" height="6" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="6" stroke="${color}" stroke-width="3" opacity="0.35" /></pattern>`;
}

function formatNumber(n, unit) {
  if (n === null || n === undefined) return '';
  const abs = Math.abs(n);
  const short = abs >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : abs >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  return unit ? `${short}${unit}` : short;
}

/** Shared cartesian frame (axes, gridlines, category labels) for every
 * bar/column/line/area variant — the one part of a chart that shouldn't
 * differ between chart_types. */
function cartesianFrame({ width, height, categories, yMax, yMin, colors, typography }) {
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const y = MARGIN.top + (plotHeight * i) / gridCount;
    const value = yMax - ((yMax - yMin) * i) / gridCount;
    return `
      <line x1="${MARGIN.left}" y1="${y}" x2="${width - MARGIN.right}" y2="${y}" stroke="${colors.surface.hairline}" stroke-width="1" />
      <text x="${MARGIN.left - 6}" y="${y + 3}" text-anchor="end" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${formatNumber(value)}</text>
    `;
  }).join('');

  const catWidth = plotWidth / Math.max(categories.length, 1);
  const catLabels = categories
    .map((c, i) => {
      const x = MARGIN.left + catWidth * i + catWidth / 2;
      const label = truncateToWidth(c, catWidth, { sizePx: 9, family: typography.body.family });
      return `<text x="${x}" y="${height - MARGIN.bottom + 14}" text-anchor="middle" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(label)}</text>`;
    })
    .join('');

  return { plotWidth, plotHeight, catWidth, gridLines, catLabels };
}

function seriesLegend({ series, width, colors, typography }) {
  let x = MARGIN.left;
  const y = 12;
  return series
    .map((s, i) => {
      const color = seriesColor({ colors }, i, s.emphasis);
      const label = s.name ?? `Series ${i + 1}`;
      const chip = `<rect x="${x}" y="${y - 8}" width="8" height="8" fill="${color}" /><text x="${x + 12}" y="${y}" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.body}">${escapeXml(label)}</text>`;
      x += 12 + label.length * 5.5 + 14;
      return chip;
    })
    .join('');
}

function allValues(series) {
  return series.flatMap((s) => s.values ?? []).filter((v) => v !== null && v !== undefined);
}

function niceMax(values, floorZero = true) {
  const max = values.length ? Math.max(...values) : 1;
  const min = floorZero ? Math.min(0, ...values) : Math.min(...values);
  return { yMax: max <= 0 ? 1 : max * 1.15, yMin: min };
}

function renderBarLike({ content, tokens, width, height, mode }) {
  const { colors, typography } = tokens;
  const categories = content.categories ?? [];
  const series = content.series ?? [];
  const { yMax, yMin } = niceMax(allValues(series));
  const frame = cartesianFrame({ width, height, categories, yMax, yMin, colors, typography });
  const zeroY = MARGIN.top + frame.plotHeight * (yMax / (yMax - yMin));

  const hatchId = 'chart-estimate-hatch';
  const defs = content.is_estimate ? `<defs>${hatchDefs(hatchId, colors.text.muted)}</defs>` : '';

  const groupCount = mode === 'grouped' ? series.length : 1;
  const barPad = frame.catWidth * 0.15;
  const groupWidth = frame.catWidth - barPad * 2;
  const barWidth = mode === 'grouped' ? groupWidth / groupCount - 4 : groupWidth;

  let bars = '';
  categories.forEach((_, ci) => {
    if (mode === 'stacked') {
      let stackedY = zeroY;
      series.forEach((s, si) => {
        const v = s.values[ci];
        if (v === null || v === undefined) return;
        const barHeight = (Math.abs(v) / (yMax - yMin)) * frame.plotHeight;
        const x = MARGIN.left + ci * frame.catWidth + barPad;
        const y = stackedY - barHeight;
        const fill = content.is_estimate ? `url(#${hatchId})` : seriesColor(tokens, si, s.emphasis);
        bars += `<rect x="${x}" y="${y}" width="${groupWidth}" height="${barHeight}" fill="${fill}" ${content.is_estimate ? `stroke="${seriesColor(tokens, si, s.emphasis)}" stroke-width="1"` : ''} />`;
        stackedY = y;
      });
    } else {
      series.forEach((s, si) => {
        const v = s.values[ci];
        if (v === null || v === undefined) return;
        const barHeight = (Math.abs(v) / (yMax - yMin)) * frame.plotHeight;
        const x = MARGIN.left + ci * frame.catWidth + barPad + (mode === 'grouped' ? si * (barWidth + 4) : 0);
        const y = v >= 0 ? zeroY - barHeight : zeroY;
        const fill = content.is_estimate ? `url(#${hatchId})` : seriesColor(tokens, si, s.emphasis);
        bars += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${fill}" ${content.is_estimate ? `stroke="${seriesColor(tokens, si, s.emphasis)}" stroke-width="1"` : ''} />`;
      });
    }
  });

  const legend = series.length > 1 ? seriesLegend({ series, width, colors, typography }) : '';
  return svgDocument(width, height, defs + frame.gridLines + bars + frame.catLabels + legend + estimateBadge(width, content.is_estimate, colors, typography));
}

function renderLineOrArea({ content, tokens, width, height, filled }) {
  const { colors, typography } = tokens;
  const categories = content.categories ?? [];
  const series = content.series ?? [];
  const { yMax, yMin } = niceMax(allValues(series), false);
  const frame = cartesianFrame({ width, height, categories, yMax, yMin, colors, typography });

  const toY = (v) => MARGIN.top + frame.plotHeight * (1 - (v - yMin) / (yMax - yMin));
  const toX = (i) => MARGIN.left + frame.catWidth * i + frame.catWidth / 2;

  const paths = series
    .map((s, si) => {
      const color = seriesColor(tokens, si, s.emphasis);
      const points = (s.values ?? []).map((v, i) => (v === null || v === undefined ? null : `${toX(i)},${toY(v)}`)).filter(Boolean);
      const linePath = `<path d="M${points.join(' L')}" fill="none" stroke="${color}" stroke-width="${s.emphasis ? 3 : 2}" />`;
      const areaPath = filled
        ? `<path d="M${points[0]} L${points.join(' L')} L${toX(s.values.length - 1)},${toY(yMin)} L${toX(0)},${toY(yMin)} Z" fill="${color}" opacity="0.15" />`
        : '';
      const dots = (s.values ?? []).map((v, i) => (v === null || v === undefined ? '' : `<circle cx="${toX(i)}" cy="${toY(v)}" r="2.5" fill="${color}" />`)).join('');
      return areaPath + linePath + dots;
    })
    .join('');

  const legend = series.length > 1 ? seriesLegend({ series, width, colors, typography }) : '';
  return svgDocument(width, height, frame.gridLines + paths + frame.catLabels + legend + estimateBadge(width, content.is_estimate, colors, typography));
}

function renderPieOrDonut({ content, tokens, width, height, donut }) {
  const { colors, typography } = tokens;
  const series = content.series?.[0];
  const values = (series?.values ?? []).map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = width * 0.32;
  const cy = height / 2;
  const r = Math.min(cx, height / 2) - 10;
  const innerR = donut ? r * 0.55 : 0;

  let angle = -Math.PI / 2;
  const slices = values
    .map((v, i) => {
      const frac = v / total;
      const startAngle = angle;
      const endAngle = angle + frac * Math.PI * 2;
      angle = endAngle;
      const large = frac > 0.5 ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const color = seriesColor(tokens, i, false);
      if (donut) {
        const ix1 = cx + innerR * Math.cos(startAngle);
        const iy1 = cy + innerR * Math.sin(startAngle);
        const ix2 = cx + innerR * Math.cos(endAngle);
        const iy2 = cy + innerR * Math.sin(endAngle);
        return `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${ix2},${iy2} A${innerR},${innerR} 0 ${large} 0 ${ix1},${iy1} Z" fill="${color}" />`;
      }
      return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${color}" />`;
    })
    .join('');

  const legend = (content.categories ?? []).map((c, i) => {
    const ly = 20 + i * 16;
    const lx = width * 0.62;
    const pct = ((values[i] / total) * 100).toFixed(0);
    return `<rect x="${lx}" y="${ly - 8}" width="8" height="8" fill="${seriesColor(tokens, i, false)}" /><text x="${lx + 12}" y="${ly}" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.body}">${escapeXml(truncateToWidth(c, width * 0.34, { sizePx: 9, family: typography.body.family }))} (${pct}%)</text>`;
  }).join('');

  return svgDocument(width, height, slices + legend + estimateBadge(width, content.is_estimate, colors, typography));
}

function renderScatter({ content, tokens, width, height }) {
  const { colors, typography } = tokens;
  const series = content.series ?? [];
  const allX = series.flatMap((s) => (s.values ?? []).map((_, i) => i));
  const allY = allValues(series);
  const { yMax, yMin } = niceMax(allY, false);
  const frame = cartesianFrame({ width, height, categories: content.categories ?? [], yMax, yMin, colors, typography });
  const toY = (v) => MARGIN.top + frame.plotHeight * (1 - (v - yMin) / (yMax - yMin));
  const toX = (i, n) => MARGIN.left + frame.plotWidth * (n <= 1 ? 0.5 : i / (n - 1));

  const points = series
    .map((s, si) => {
      const color = seriesColor(tokens, si, s.emphasis);
      return (s.values ?? [])
        .map((v, i) => (v === null || v === undefined ? '' : `<circle cx="${toX(i, s.values.length)}" cy="${toY(v)}" r="4" fill="${color}" opacity="0.8" />`))
        .join('');
    })
    .join('');

  return svgDocument(width, height, frame.gridLines + points + estimateBadge(width, content.is_estimate, colors, typography));
}

function renderWaterfall({ content, tokens, width, height }) {
  const { colors, typography } = tokens;
  const categories = content.categories ?? [];
  const values = content.series?.[0]?.values ?? [];
  let cumulative = 0;
  const running = values.map((v) => {
    const start = cumulative;
    cumulative += v ?? 0;
    return { start, end: cumulative };
  });
  const allEdges = running.flatMap((r) => [r.start, r.end]);
  const { yMax, yMin } = niceMax(allEdges, false);
  const frame = cartesianFrame({ width, height, categories, yMax, yMin, colors, typography });
  const toY = (v) => MARGIN.top + frame.plotHeight * (1 - (v - yMin) / (yMax - yMin));

  const bars = running
    .map((r, i) => {
      const v = values[i] ?? 0;
      const x = MARGIN.left + i * frame.catWidth + frame.catWidth * 0.15;
      const barWidth = frame.catWidth * 0.7;
      const top = toY(Math.max(r.start, r.end));
      const barHeight = Math.abs(toY(r.start) - toY(r.end));
      const color = v >= 0 ? colors.semantic.positive : colors.semantic.negative;
      return `<rect x="${x}" y="${top}" width="${barWidth}" height="${Math.max(barHeight, 1)}" fill="${color}" />`;
    })
    .join('');

  return svgDocument(width, height, frame.gridLines + bars + frame.catLabels + estimateBadge(width, content.is_estimate, colors, typography));
}

function renderFunnel({ content, tokens, width, height }) {
  const { colors, typography } = tokens;
  const categories = content.categories ?? [];
  const values = content.series?.[0]?.values ?? [];
  const max = Math.max(...values.filter((v) => v != null), 1);
  const rowHeight = (height - 20) / Math.max(values.length, 1);

  const rows = values
    .map((v, i) => {
      const frac = (v ?? 0) / max;
      const barWidth = width * 0.6 * frac;
      const x = (width - barWidth) / 2;
      const y = 10 + i * rowHeight;
      const color = seriesColor(tokens, i, false);
      const label = `${categories[i] ?? ''} — ${formatNumber(v)}`;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${rowHeight - 6}" fill="${color}" />
        <text x="${width / 2}" y="${y + rowHeight / 2}" text-anchor="middle" font-size="10" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.on_dark}">${escapeXml(label)}</text>
      `;
    })
    .join('');

  return svgDocument(width, height, rows + estimateBadge(width, content.is_estimate, colors, typography));
}

function renderBullet({ content, tokens, width, height }) {
  const { colors, typography } = tokens;
  const series = content.series ?? [];
  const rowHeight = Math.min(40, (height - 10) / Math.max(series.length, 1));
  const plotLeft = 100;
  const plotWidth = width - plotLeft - 20;
  const allVals = allValues(series);
  const max = Math.max(...allVals, 1) * 1.1;

  const rows = series
    .map((s, i) => {
      const y = 8 + i * rowHeight;
      const value = s.values?.[0] ?? 0;
      const target = s.values?.[1]; // convention: values[1] is the target/benchmark, if provided
      const barWidth = (value / max) * plotWidth;
      const color = seriesColor(tokens, i, s.emphasis);
      const label = truncateToWidth(s.name ?? '', plotLeft - 10, { sizePx: 10, family: typography.body.family });
      return `
        <text x="0" y="${y + rowHeight / 2 - 4}" font-size="10" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.body}">${escapeXml(label)}</text>
        <rect x="${plotLeft}" y="${y}" width="${plotWidth}" height="${rowHeight - 16}" fill="${colors.surface.tint}" />
        <rect x="${plotLeft}" y="${y}" width="${barWidth}" height="${rowHeight - 16}" fill="${color}" />
        ${target != null ? `<line x1="${plotLeft + (target / max) * plotWidth}" y1="${y - 3}" x2="${plotLeft + (target / max) * plotWidth}" y2="${y + rowHeight - 13}" stroke="${colors.text.heading}" stroke-width="2" />` : ''}
      `;
    })
    .join('');

  return svgDocument(width, height, rows + estimateBadge(width, content.is_estimate, colors, typography));
}

function renderHeatmap({ content, tokens, width, height }) {
  const { colors, typography } = tokens;
  const categories = content.categories ?? [];
  const series = content.series ?? [];
  const rowLabelWidth = 100;
  const colWidth = categories.length ? (width - rowLabelWidth) / categories.length : 0;
  const rowHeight = series.length ? (height - 20) / series.length : 0;
  const allVals = allValues(series);
  const max = Math.max(...allVals, 1);
  const min = Math.min(...allVals, 0);
  const seqPalette = tokens.colors.chart_sequential?.length ? tokens.colors.chart_sequential : [colors.surface.tint, colors.primary];

  function colorForValue(v) {
    if (v === null || v === undefined) return colors.surface.hairline;
    const t = max === min ? 0 : (v - min) / (max - min);
    const idx = Math.min(seqPalette.length - 1, Math.round(t * (seqPalette.length - 1)));
    return seqPalette[idx];
  }

  const header = categories
    .map((c, i) => `<text x="${rowLabelWidth + i * colWidth + colWidth / 2}" y="14" text-anchor="middle" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(truncateToWidth(c, colWidth, { sizePx: 9, family: typography.body.family }))}</text>`)
    .join('');

  const rows = series
    .map((s, ri) => {
      const y = 18 + ri * rowHeight;
      const label = `<text x="0" y="${y + rowHeight / 2 + 3}" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.body}">${escapeXml(truncateToWidth(s.name ?? '', rowLabelWidth - 8, { sizePx: 9, family: typography.body.family }))}</text>`;
      const cells = (s.values ?? [])
        .map((v, ci) => {
          const x = rowLabelWidth + ci * colWidth;
          return `<rect x="${x}" y="${y}" width="${colWidth - 1}" height="${rowHeight - 1}" fill="${colorForValue(v)}" />`;
        })
        .join('');
      return label + cells;
    })
    .join('');

  return svgDocument(width, height, header + rows + estimateBadge(width, content.is_estimate, colors, typography));
}

const CATEGORICAL_HEIGHT = 260;
const CIRCULAR_HEIGHT = 220;

export function renderChart(content, tokens, { width = 640 } = {}) {
  switch (content.chart_type) {
    case 'bar':
    case 'column':
      return renderBarLike({ content, tokens, width, height: CATEGORICAL_HEIGHT, mode: 'single' });
    case 'grouped_bar':
      return renderBarLike({ content, tokens, width, height: CATEGORICAL_HEIGHT, mode: 'grouped' });
    case 'stacked_bar':
      return renderBarLike({ content, tokens, width, height: CATEGORICAL_HEIGHT, mode: 'stacked' });
    case 'line':
      return renderLineOrArea({ content, tokens, width, height: CATEGORICAL_HEIGHT, filled: false });
    case 'area':
      return renderLineOrArea({ content, tokens, width, height: CATEGORICAL_HEIGHT, filled: true });
    case 'pie':
      return renderPieOrDonut({ content, tokens, width, height: CIRCULAR_HEIGHT, donut: false });
    case 'donut':
      return renderPieOrDonut({ content, tokens, width, height: CIRCULAR_HEIGHT, donut: true });
    case 'scatter':
      return renderScatter({ content, tokens, width, height: CATEGORICAL_HEIGHT });
    case 'waterfall':
      return renderWaterfall({ content, tokens, width, height: CATEGORICAL_HEIGHT });
    case 'funnel':
      return renderFunnel({ content, tokens, width, height: Math.max(160, (content.series?.[0]?.values?.length ?? 3) * 40) });
    case 'bullet':
      return renderBullet({ content, tokens, width, height: Math.max(60, (content.series?.length ?? 1) * 40) });
    case 'heatmap':
      return renderHeatmap({ content, tokens, width, height: Math.max(120, (content.series?.length ?? 3) * 36) });
    default:
      throw new Error(`Unknown chart_type "${content.chart_type}".`);
  }
}
