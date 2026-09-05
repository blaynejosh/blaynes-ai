import { escapeXml, wrapText, svgDocument } from '../layout.js';

export function renderProcessFlow(content, tokens, { width = 640 } = {}) {
  const steps = content.steps ?? [];
  const vertical = content.orientation === 'vertical';
  const { colors, typography } = tokens;

  if (vertical) {
    const rowHeight = 64;
    const height = steps.length * rowHeight;
    const boxWidth = width - 40;
    const body = steps
      .map((step, i) => {
        const y = i * rowHeight;
        const labelLines = wrapText(step.label, boxWidth - 24, { sizePx: 12, family: typography.heading.family, weight: 600 }).slice(0, 1);
        const detailLines = step.detail ? wrapText(step.detail, boxWidth - 24, { sizePx: 10, family: typography.body.family }).slice(0, 1) : [];
        const fill = step.terminal ? colors.primary : colors.surface.tint;
        const textFill = step.terminal ? colors.text.on_dark : colors.text.heading;
        const arrow = i < steps.length - 1 ? `<line x1="${20 + boxWidth / 2}" y1="${y + 44}" x2="${20 + boxWidth / 2}" y2="${y + rowHeight}" stroke="${colors.surface.hairline}" stroke-width="2" marker-end="url(#pf-arrow)" />` : '';
        return `
          <rect x="20" y="${y}" width="${boxWidth}" height="40" rx="8" fill="${fill}" />
          <text x="${20 + boxWidth / 2}" y="${y + 18}" text-anchor="middle" font-size="12" font-weight="600" font-family="${escapeXml(typography.heading.family)}" fill="${textFill}">${escapeXml(labelLines[0] ?? '')}</text>
          ${detailLines[0] ? `<text x="${20 + boxWidth / 2}" y="${y + 32}" text-anchor="middle" font-size="10" font-family="${escapeXml(typography.body.family)}" fill="${textFill}" opacity="0.8">${escapeXml(detailLines[0])}</text>` : ''}
          ${arrow}
        `;
      })
      .join('');
    return svgDocument(width, height, arrowMarkerDefs(colors) + body);
  }

  const gap = 28;
  const boxWidth = (width - gap * (steps.length - 1)) / steps.length;
  const height = 90;
  const body = steps
    .map((step, i) => {
      const x = i * (boxWidth + gap);
      const labelLines = wrapText(step.label, boxWidth - 16, { sizePx: 11, family: typography.heading.family, weight: 600 }).slice(0, 2);
      const fill = step.terminal ? colors.primary : colors.surface.tint;
      const textFill = step.terminal ? colors.text.on_dark : colors.text.heading;
      const labelSpans = labelLines
        .map((l, li) => `<text x="${x + boxWidth / 2}" y="${34 - (labelLines.length - 1) * 7 + li * 14}" text-anchor="middle" font-size="11" font-weight="600" font-family="${escapeXml(typography.heading.family)}" fill="${textFill}">${escapeXml(l)}</text>`)
        .join('');
      const arrow = i < steps.length - 1 ? `<line x1="${x + boxWidth}" y1="30" x2="${x + boxWidth + gap}" y2="30" stroke="${colors.surface.hairline}" stroke-width="2" marker-end="url(#pf-arrow)" />` : '';
      return `<rect x="${x}" y="0" width="${boxWidth}" height="60" rx="8" fill="${fill}" />${labelSpans}${arrow}`;
    })
    .join('');
  return svgDocument(width, height, arrowMarkerDefs(colors) + body);
}

function arrowMarkerDefs(colors) {
  return `<defs><marker id="pf-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${colors.surface.hairline}"/></marker></defs>`;
}
