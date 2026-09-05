/**
 * kpi_row exhibit — 2 to 5 stat tiles (schema-enforced minItems/maxItems),
 * each a value, a label, and an optional delta/direction.
 */
import { escapeXml, wrapText, svgDocument } from '../layout.js';

const DIRECTION_COLOR = {
  up_good: 'positive',
  down_good: 'positive',
  up_bad: 'negative',
  down_bad: 'negative',
  neutral: 'muted',
};
const DIRECTION_ARROW = { up_good: '▲', up_bad: '▲', down_good: '▼', down_bad: '▼', neutral: '' };

export function renderKpiRow(content, tokens, { width = 640 } = {}) {
  const items = content.items ?? [];
  const gap = 12;
  const tileWidth = (width - gap * (items.length - 1)) / items.length;
  const height = 110;
  const { colors, typography } = tokens;

  const tiles = items
    .map((item, i) => {
      const x = i * (tileWidth + gap);
      const labelLines = wrapText(item.label, tileWidth - 20, { sizePx: 11, family: typography.body.family });
      const deltaColorKey = DIRECTION_COLOR[item.direction] ?? 'muted';
      const deltaColor = colors.semantic[deltaColorKey] ?? colors.text.muted;
      const arrow = DIRECTION_ARROW[item.direction] ?? '';

      const labelSpans = labelLines
        .slice(0, 2)
        .map((line, li) => `<text x="${x + 12}" y="${72 + li * 14}" font-size="11" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(line)}</text>`)
        .join('');

      return `
        <rect x="${x}" y="0" width="${tileWidth}" height="${height}" rx="10" fill="${colors.surface.tint}" />
        <text x="${x + 12}" y="38" font-size="26" font-weight="700" font-family="${escapeXml(typography.display.family)}" fill="${colors.primary}">${escapeXml(item.value)}</text>
        ${labelSpans}
        ${
          item.delta
            ? `<text x="${x + tileWidth - 12}" y="20" text-anchor="end" font-size="11" font-weight="600" font-family="${escapeXml(typography.body.family)}" fill="${deltaColor}">${arrow} ${escapeXml(item.delta)}</text>`
            : ''
        }
      `;
    })
    .join('');

  return svgDocument(width, height, tiles);
}
