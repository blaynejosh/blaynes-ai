import { escapeXml, wrapText, svgDocument } from '../layout.js';

export function renderNumberedPhases(content, tokens, { width = 640 } = {}) {
  const phases = content.phases ?? [];
  const gap = 16;
  const colWidth = (width - gap * (phases.length - 1)) / phases.length;
  const height = 170;
  const { colors, typography } = tokens;

  const body = phases
    .map((phase, i) => {
      const x = i * (colWidth + gap);
      const titleLines = wrapText(phase.title, colWidth - 8, { sizePx: 12, family: typography.heading.family, weight: 600 }).slice(0, 2);
      const subtitleLines = phase.subtitle ? wrapText(phase.subtitle, colWidth - 8, { sizePx: 10, family: typography.body.family }).slice(0, 2) : [];
      const bodyLines = (phase.body ?? []).flatMap((b) => wrapText(b, colWidth - 8, { sizePx: 10, family: typography.body.family })).slice(0, 3);

      let y = 74;
      const titleSpans = titleLines.map((l) => `<text x="${x}" y="${(y += 15) - 15}" font-size="12" font-weight="600" font-family="${escapeXml(typography.heading.family)}" fill="${colors.text.heading}">${escapeXml(l)}</text>`).join('');
      const subtitleSpans = subtitleLines.map((l) => `<text x="${x}" y="${(y += 13) - 13}" font-size="10" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(l)}</text>`).join('');
      const bodySpans = bodyLines.map((l) => `<text x="${x}" y="${(y += 13) - 13}" font-size="10" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.body}">${escapeXml(l)}</text>`).join('');

      const connector = i < phases.length - 1 ? `<line x1="${x + colWidth + gap / 2 - 8}" y1="30" x2="${x + colWidth + gap / 2 + 8}" y2="30" stroke="${colors.surface.hairline}" stroke-width="2" />` : '';

      return `
        <circle cx="${x + 22}" cy="30" r="20" fill="${colors.primary}" />
        <text x="${x + 22}" y="36" text-anchor="middle" font-size="16" font-weight="700" font-family="${escapeXml(typography.display.family)}" fill="${colors.text.on_dark}">${escapeXml(phase.numeral)}</text>
        ${connector}
        ${titleSpans}${subtitleSpans}${bodySpans}
      `;
    })
    .join('');

  return svgDocument(width, height, body);
}
