import { escapeXml, wrapText, svgDocument } from '../layout.js';

export function renderJourneyMap(content, tokens, { width = 640 } = {}) {
  const { colors, typography } = tokens;
  const stages = content.stages ?? [];
  const lanes = content.lanes ?? [];
  const laneColWidth = 90;
  const stageColWidth = stages.length ? (width - laneColWidth) / stages.length : 0;
  const sentimentRowHeight = 36;
  const laneRowHeight = 56;
  const headerHeight = 22;
  const height = headerHeight + sentimentRowHeight + lanes.length * laneRowHeight;

  const stageHeaders = stages
    .map((s, i) => {
      const x = laneColWidth + i * stageColWidth;
      const label = wrapText(s.name, stageColWidth - 8, { sizePx: 10, family: typography.heading.family, weight: 600 }).slice(0, 1)[0] ?? '';
      return `<text x="${x + stageColWidth / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" font-family="${escapeXml(typography.heading.family)}" fill="${colors.text.heading}">${escapeXml(label)}</text>`;
    })
    .join('');

  // A simple sentiment "curve" as connected points, coloured by sign.
  const sentimentY = (s) => headerHeight + sentimentRowHeight / 2 - (s ?? 0) * (sentimentRowHeight / 2 - 6);
  const sentimentPoints = stages.map((s, i) => ({ x: laneColWidth + i * stageColWidth + stageColWidth / 2, y: sentimentY(s.sentiment) }));
  const sentimentPath = sentimentPoints.length
    ? `<path d="M${sentimentPoints.map((p) => `${p.x},${p.y}`).join(' L')}" fill="none" stroke="${colors.primary}" stroke-width="2" />` +
      sentimentPoints.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${colors.primary}" />`).join('')
    : '';
  const sentimentMidline = `<line x1="${laneColWidth}" y1="${headerHeight + sentimentRowHeight / 2}" x2="${width}" y2="${headerHeight + sentimentRowHeight / 2}" stroke="${colors.surface.hairline}" stroke-width="1" stroke-dasharray="2,2" />`;

  const laneRows = lanes
    .map((laneName, li) => {
      const y = headerHeight + sentimentRowHeight + li * laneRowHeight;
      const laneLabel = `<text x="0" y="${y + laneRowHeight / 2 + 3}" font-size="10" font-weight="600" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(laneName)}</text>`;
      const cells = stages
        .map((s, si) => {
          const x = laneColWidth + si * stageColWidth;
          const cellText = s.cells?.[li] ?? '';
          const lines = wrapText(cellText, stageColWidth - 12, { sizePx: 9, family: typography.body.family }).slice(0, 4);
          const spans = lines
            .map((l, i) => `<text x="${x + 6}" y="${y + 16 + i * 11}" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.body}">${escapeXml(l)}</text>`)
            .join('');
          return `<rect x="${x}" y="${y}" width="${stageColWidth - 2}" height="${laneRowHeight - 2}" fill="${colors.surface.page}" stroke="${colors.surface.hairline}" stroke-width="0.5" />${spans}`;
        })
        .join('');
      return laneLabel + cells;
    })
    .join('');

  return svgDocument(width, height, stageHeaders + sentimentMidline + sentimentPath + laneRows);
}
