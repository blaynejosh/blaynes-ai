import { escapeXml, truncateToWidth, svgDocument } from '../layout.js';

const NODE_WIDTH = 140;
const NODE_HEIGHT = 48;
const V_GAP = 40;

function measureWidth(node) {
  const reports = node.reports ?? [];
  if (!reports.length) return 1;
  return reports.reduce((sum, r) => sum + measureWidth(r), 0);
}

function layout(node, depth, leftLeafIndex, positions, edges) {
  const reports = node.reports ?? [];
  let childLeftIndex = leftLeafIndex;
  const childCenters = [];

  for (const child of reports) {
    const childWidth = measureWidth(child);
    layout(child, depth + 1, childLeftIndex, positions, edges);
    childCenters.push(childLeftIndex + childWidth / 2);
    childLeftIndex += childWidth;
  }

  const width = measureWidth(node);
  const centerIndex = reports.length ? (childCenters[0] + childCenters[childCenters.length - 1]) / 2 : leftLeafIndex + width / 2;
  positions.push({ node, depth, centerIndex });
  for (const c of childCenters) edges.push({ fromDepth: depth, fromCenter: centerIndex, toDepth: depth + 1, toCenter: c });
}

export function renderOrgChart(content, tokens, { width: totalWidth = 640 } = {}) {
  const { colors, typography } = tokens;
  const positions = [];
  const edges = [];
  layout(content.root, 0, 0, positions, edges);

  const leafUnits = measureWidth(content.root);
  const unitWidth = totalWidth / leafUnits;
  // A wide tree (many siblings) must not overflow the declared canvas —
  // shrink the node box to fit its allotted slot rather than let a fixed
  // width push the rightmost nodes past the edge. Caught by
  // test/brand-kit-render-svg.test.js's overflow check at 6+ siblings.
  const nodeWidth = Math.max(60, Math.min(NODE_WIDTH, unitWidth - 8));
  const maxDepth = Math.max(...positions.map((p) => p.depth));
  const height = (maxDepth + 1) * (NODE_HEIGHT + V_GAP) - V_GAP + 10;

  const toX = (centerIndex) => centerIndex * unitWidth;
  const toY = (depth) => depth * (NODE_HEIGHT + V_GAP) + 10;

  const edgeSvg = edges
    .map((e) => {
      const x1 = toX(e.fromCenter);
      const y1 = toY(e.fromDepth) + NODE_HEIGHT;
      const x2 = toX(e.toCenter);
      const y2 = toY(e.toDepth);
      const midY = (y1 + y2) / 2;
      return `<path d="M${x1},${y1} L${x1},${midY} L${x2},${midY} L${x2},${y2}" fill="none" stroke="${colors.surface.hairline}" stroke-width="1.5" />`;
    })
    .join('');

  const nodeSvg = positions
    .map(({ node, depth, centerIndex }) => {
      const y = toY(depth);
      const x = Math.max(0, Math.min(totalWidth - nodeWidth, toX(centerIndex) - nodeWidth / 2));
      const cx = x + nodeWidth / 2; // re-centered on the (possibly clamped) box, not the unclamped layout position
      const title = truncateToWidth(node.title, nodeWidth - 16, { sizePx: 11, family: typography.heading.family, weight: 600 });
      const name = node.name ? truncateToWidth(node.name, nodeWidth - 16, { sizePx: 10, family: typography.body.family }) : null;
      return `
        <rect x="${x}" y="${y}" width="${nodeWidth}" height="${NODE_HEIGHT}" rx="8" fill="${colors.surface.page}" stroke="${colors.surface.hairline}" />
        <text x="${cx}" y="${y + (name ? 19 : 27)}" text-anchor="middle" font-size="11" font-weight="600" font-family="${escapeXml(typography.heading.family)}" fill="${colors.text.heading}">${escapeXml(title)}</text>
        ${name ? `<text x="${cx}" y="${y + 34}" text-anchor="middle" font-size="10" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(name)}</text>` : ''}
      `;
    })
    .join('');

  return svgDocument(totalWidth, height, edgeSvg + nodeSvg);
}
