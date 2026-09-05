import { escapeXml, truncateToWidth, svgDocument } from '../layout.js';

export function renderMatrix2x2(content, tokens, { width = 640 } = {}) {
  const { colors, typography } = tokens;
  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = 420;
  const height = plotHeight + margin.top + margin.bottom;
  const items = content.items ?? [];
  const quadrantLabels = content.quadrant_labels ?? [];

  const toX = (x) => margin.left + x * plotWidth;
  const toY = (y) => margin.top + (1 - y) * plotHeight; // y=1 (high) plots near the top

  const quadrantFills = [
    { x: margin.left, y: margin.top, label: quadrantLabels[0] },
    { x: margin.left + plotWidth / 2, y: margin.top, label: quadrantLabels[1] },
    { x: margin.left, y: margin.top + plotHeight / 2, label: quadrantLabels[2] },
    { x: margin.left + plotWidth / 2, y: margin.top + plotHeight / 2, label: quadrantLabels[3] },
  ]
    .map(
      (q) => `
      <rect x="${q.x}" y="${q.y}" width="${plotWidth / 2}" height="${plotHeight / 2}" fill="${colors.surface.tint}" opacity="0.5" />
      ${q.label ? `<text x="${q.x + plotWidth / 4}" y="${q.y + 18}" text-anchor="middle" font-size="10" font-weight="600" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(q.label)}</text>` : ''}
    `,
    )
    .join('');

  const axisLines = `
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="${colors.text.muted}" stroke-width="1.5" />
    <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${margin.left + plotWidth}" y2="${margin.top + plotHeight}" stroke="${colors.text.muted}" stroke-width="1.5" />
  `;

  const axisLabels = `
    ${content.x_axis?.label ? `<text x="${margin.left + plotWidth / 2}" y="${height - 8}" text-anchor="middle" font-size="11" font-weight="600" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.heading}">${escapeXml(content.x_axis.label)}</text>` : ''}
    ${content.x_axis?.low ? `<text x="${margin.left}" y="${height - 8}" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(content.x_axis.low)}</text>` : ''}
    ${content.x_axis?.high ? `<text x="${margin.left + plotWidth}" y="${height - 8}" text-anchor="end" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(content.x_axis.high)}</text>` : ''}
    ${
      content.y_axis?.label
        ? `<text x="14" y="${margin.top + plotHeight / 2}" text-anchor="middle" font-size="11" font-weight="600" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.heading}" transform="rotate(-90 14 ${margin.top + plotHeight / 2})">${escapeXml(content.y_axis.label)}</text>`
        : ''
    }
  `;

  const points = items
    .map((item) => {
      const cx = toX(Math.max(0, Math.min(1, item.x)));
      const cy = toY(Math.max(0, Math.min(1, item.y)));
      const r = item.highlight ? 7 : 5;
      const fill = item.highlight ? colors.primary : colors.secondary;
      const label = truncateToWidth(item.label, 140, { sizePx: 10, family: typography.body.family });
      return `
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${colors.surface.page}" stroke-width="1.5" />
        <text x="${cx + r + 4}" y="${cy + 3}" font-size="10" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.body}">${escapeXml(label)}</text>
      `;
    })
    .join('');

  return svgDocument(width, height, quadrantFills + axisLines + axisLabels + points);
}
