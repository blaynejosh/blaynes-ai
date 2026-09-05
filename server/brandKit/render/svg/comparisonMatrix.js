import { escapeXml, truncateToWidth, svgDocument } from '../layout.js';

const RATING_GLYPH = { strong: '●', adequate: '◐', weak: '○', none: '—', unknown: '?' };
const RATING_ROLE = { strong: 'positive', adequate: 'caution', weak: 'negative', none: 'muted', unknown: 'muted' };

export function renderComparisonMatrix(content, tokens, { width = 640 } = {}) {
  const { colors, typography } = tokens;
  const options = content.options ?? [];
  const criteria = content.criteria ?? [];
  const scores = content.scores ?? [];
  const criteriaColWidth = 150;
  const optionColWidth = options.length ? (width - criteriaColWidth) / options.length : 0;
  const rowHeight = 32;
  const headerHeight = 40;
  const height = headerHeight + criteria.length * rowHeight + 4;

  const headerCells = options
    .map((opt, i) => {
      const x = criteriaColWidth + i * optionColWidth;
      const isRecommended = content.recommended_option_index === i;
      const label = truncateToWidth(opt, optionColWidth - 10, { sizePx: 10, family: typography.heading.family, weight: 600 });
      return `
        ${isRecommended ? `<rect x="${x + 2}" y="0" width="${optionColWidth - 4}" height="${height - 2}" rx="6" fill="${colors.surface.tint}" />` : ''}
        <text x="${x + optionColWidth / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" font-family="${escapeXml(typography.heading.family)}" fill="${colors.text.heading}">${escapeXml(label)}</text>
        ${isRecommended ? `<text x="${x + optionColWidth / 2}" y="30" text-anchor="middle" font-size="8" font-weight="700" font-family="${escapeXml(typography.body.family)}" fill="${colors.primary}">RECOMMENDED</text>` : ''}
      `;
    })
    .join('');

  const rows = criteria
    .map((criterion, ci) => {
      const y = headerHeight + ci * rowHeight;
      const label = truncateToWidth(criterion, criteriaColWidth - 8, { sizePx: 10, family: typography.body.family });
      const cells = options
        .map((_, oi) => {
          const rating = scores[ci]?.[oi] ?? 'unknown';
          const roleKey = RATING_ROLE[rating] ?? 'muted';
          const fill = roleKey === 'muted' ? colors.text.muted : colors.semantic[roleKey];
          const x = criteriaColWidth + oi * optionColWidth + optionColWidth / 2;
          return `<text x="${x}" y="${y + rowHeight / 2 + 5}" text-anchor="middle" font-size="14" fill="${fill}">${RATING_GLYPH[rating] ?? '?'}</text>`;
        })
        .join('');
      return `
        <line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${colors.surface.hairline}" stroke-width="1" />
        <text x="0" y="${y + rowHeight / 2 + 4}" font-size="10" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.heading}">${escapeXml(label)}</text>
        ${cells}
      `;
    })
    .join('');

  return svgDocument(width, height, headerCells + rows);
}
