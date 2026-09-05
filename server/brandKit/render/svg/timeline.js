import { escapeXml, wrapText, svgDocument } from '../layout.js';

export function renderTimeline(content, tokens, { width = 640 } = {}) {
  const events = content.events ?? [];
  const gap = events.length > 1 ? (width - 40) / (events.length - 1) : 0;
  const height = 140;
  const { colors, typography } = tokens;
  const lineY = 40;

  const line = `<line x1="20" y1="${lineY}" x2="${width - 20}" y2="${lineY}" stroke="${colors.surface.hairline}" stroke-width="2" />`;

  const body = events
    .map((ev, i) => {
      const x = 20 + gap * i;
      const r = ev.milestone ? 7 : 5;
      const dot = `<circle cx="${x}" cy="${lineY}" r="${r}" fill="${ev.milestone ? colors.primary : colors.surface.hairline}" stroke="${colors.surface.page}" stroke-width="2" />`;
      const whenText = `<text x="${x}" y="${lineY - 14}" text-anchor="middle" font-size="10" font-weight="600" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(ev.when)}</text>`;
      const labelLines = wrapText(ev.label, Math.max(gap - 10, 70), { sizePx: 11, family: typography.heading.family, weight: 600 }).slice(0, 2);
      const labelSpans = labelLines
        .map((l, li) => `<text x="${x}" y="${lineY + 20 + li * 14}" text-anchor="middle" font-size="11" font-weight="600" font-family="${escapeXml(typography.heading.family)}" fill="${colors.text.heading}">${escapeXml(l)}</text>`)
        .join('');
      return `${dot}${whenText}${labelSpans}`;
    })
    .join('');

  return svgDocument(width, height, line + body);
}
