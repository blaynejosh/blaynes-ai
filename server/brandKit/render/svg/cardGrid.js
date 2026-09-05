import { escapeXml, wrapText, svgDocument } from '../layout.js';

const ICON_GLYPH = { speed: '⚡', risk: '⚠', growth: '↗', cost: '$', time: '⏱', people: '☺', quality: '✓' };

export function renderCardGrid(content, tokens, { width = 640 } = {}) {
  const columns = content.columns ?? 2;
  const cards = content.cards ?? [];
  const gap = 14;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = 100;
  const rows = Math.ceil(cards.length / columns);
  const height = rows * cardHeight + (rows - 1) * gap;
  const { colors, typography } = tokens;

  const body = cards
    .map((card, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = col * (cardWidth + gap);
      const y = row * (cardHeight + gap);
      const titleLines = wrapText(card.title, cardWidth - 24, { sizePx: 13, family: typography.heading.family, weight: 600 }).slice(0, 2);
      const textLines = wrapText(card.text, cardWidth - 24, { sizePx: 11, family: typography.body.family }).slice(0, 3);
      const glyph = ICON_GLYPH[card.icon] ?? '';

      const titleSpans = titleLines
        .map((line, li) => `<text x="${x + 14}" y="${y + 24 + li * 16}" font-size="13" font-weight="600" font-family="${escapeXml(typography.heading.family)}" fill="${colors.text.heading}">${escapeXml(line)}</text>`)
        .join('');
      const textSpans = textLines
        .map((line, li) => `<text x="${x + 14}" y="${y + 24 + titleLines.length * 16 + 14 + li * 14}" font-size="11" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.body}">${escapeXml(line)}</text>`)
        .join('');

      return `
        <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="10" fill="${colors.surface.page}" stroke="${colors.surface.hairline}" />
        ${glyph ? `<text x="${x + cardWidth - 16}" y="${y + 24}" text-anchor="end" font-size="16" fill="${colors.primary}">${glyph}</text>` : ''}
        ${titleSpans}
        ${textSpans}
      `;
    })
    .join('');

  return svgDocument(width, height, body);
}
