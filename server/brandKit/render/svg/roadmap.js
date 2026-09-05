import { escapeXml, truncateToWidth, svgDocument } from '../layout.js';

const STATUS_COLOR_ROLE = { planned: 'muted', in_progress: 'primary', done: 'positive', at_risk: 'negative' };

export function renderRoadmap(content, tokens, { width = 640 } = {}) {
  const periods = content.periods ?? [];
  const tracks = content.tracks ?? [];
  const { colors, typography } = tokens;
  const labelColWidth = 120;
  const chartWidth = width - labelColWidth;
  const periodCount = Math.max(periods.length, 1);
  const periodWidth = chartWidth / periodCount;
  const rowHeight = 34;
  const headerHeight = 24;
  const height = headerHeight + tracks.length * rowHeight;

  const headerCells = periods
    .map((p, i) => `<text x="${labelColWidth + i * periodWidth + periodWidth / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(truncateToWidth(p, periodWidth - 4, { sizePx: 10, family: typography.body.family }))}</text>`)
    .join('');

  const gridLines = periods
    .map((_, i) => `<line x1="${labelColWidth + i * periodWidth}" y1="${headerHeight}" x2="${labelColWidth + i * periodWidth}" y2="${height}" stroke="${colors.surface.hairline}" stroke-width="1" />`)
    .join('');

  const rows = tracks
    .map((track, ti) => {
      const y = headerHeight + ti * rowHeight;
      const label = `<text x="0" y="${y + rowHeight / 2 + 4}" font-size="11" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.heading}">${escapeXml(truncateToWidth(track.name, labelColWidth - 8, { sizePx: 11, family: typography.body.family }))}</text>`;
      const bars = (track.items ?? [])
        .map((item) => {
          const start = Math.max(0, Math.min(item.start_period, periodCount));
          const end = Math.max(start, Math.min(item.end_period, periodCount));
          const x = labelColWidth + start * periodWidth;
          const barWidth = Math.max((end - start) * periodWidth, periodWidth * 0.5);
          const colorKey = STATUS_COLOR_ROLE[item.status] ?? 'primary';
          const fill = colorKey === 'primary' ? colors.primary : colors.semantic[colorKey];
          const barLabel = truncateToWidth(item.label, barWidth - 10, { sizePx: 9, family: typography.body.family });
          return `
            <rect x="${x}" y="${y + 6}" width="${barWidth}" height="${rowHeight - 12}" rx="5" fill="${fill}" />
            <text x="${x + 6}" y="${y + rowHeight / 2 + 3}" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.on_dark}">${escapeXml(barLabel)}</text>
          `;
        })
        .join('');
      return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${colors.surface.hairline}" stroke-width="1" />${label}${bars}`;
    })
    .join('');

  return svgDocument(width, height, headerCells + gridLines + rows);
}
