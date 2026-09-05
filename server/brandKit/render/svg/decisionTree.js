import { escapeXml, wrapText, svgDocument } from '../layout.js';

const NODE_WIDTH = 150;
const NODE_HEIGHT = 44;
const H_GAP = 16;
const V_GAP = 56;

/** Computes each node's subtree width in "leaf units," recursively — the
 * layout equivalent of a simple reingold-tilford tree layout, sized down
 * for a document exhibit rather than an interactive diagram. */
function measureWidth(node) {
  const branches = node.branches ?? [];
  if (!branches.length) return 1;
  return branches.reduce((sum, b) => sum + measureWidth(b.node), 0);
}

function layout(node, depth, leftLeafIndex, positions, edges, tokens) {
  const branches = node.branches ?? [];
  const width = measureWidth(node);
  let childLeftIndex = leftLeafIndex;
  const childCenters = [];

  for (const branch of branches) {
    const childWidth = measureWidth(branch.node);
    layout(branch.node, depth + 1, childLeftIndex, positions, edges, tokens);
    const childCenterIndex = childLeftIndex + childWidth / 2;
    childCenters.push({ branch, centerIndex: childCenterIndex });
    childLeftIndex += childWidth;
  }

  const centerIndex = branches.length ? (childCenters[0].centerIndex + childCenters[childCenters.length - 1].centerIndex) / 2 : leftLeafIndex + width / 2;
  positions.push({ node, depth, centerIndex });

  for (const { branch, centerIndex: childCenterIndex } of childCenters) {
    edges.push({ fromDepth: depth, fromCenter: centerIndex, toDepth: depth + 1, toCenter: childCenterIndex, condition: branch.condition });
  }
}

export function renderDecisionTree(content, tokens, { width: totalWidth = 640 } = {}) {
  const { colors, typography } = tokens;
  const positions = [];
  const edges = [];
  layout(content.root, 0, 0, positions, edges, tokens);

  const leafUnits = measureWidth(content.root);
  const unitWidth = totalWidth / leafUnits;
  // See orgChart.js's identical fix: a wide tree must shrink its node boxes
  // to fit their allotted slot rather than overflow the declared canvas.
  const nodeWidth = Math.max(60, Math.min(NODE_WIDTH, unitWidth - H_GAP));
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
      const conditionLabel = e.condition ? `<text x="${(x1 + x2) / 2}" y="${midY - 4}" text-anchor="middle" font-size="9" font-family="${escapeXml(typography.body.family)}" fill="${colors.text.muted}">${escapeXml(e.condition)}</text>` : '';
      return `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" fill="none" stroke="${colors.surface.hairline}" stroke-width="1.5" />${conditionLabel}`;
    })
    .join('');

  const nodeSvg = positions
    .map(({ node, depth, centerIndex }) => {
      const y = toY(depth);
      const x = Math.max(0, Math.min(totalWidth - nodeWidth, toX(centerIndex) - nodeWidth / 2));
      const cx = x + nodeWidth / 2;
      const fill = node.is_outcome ? colors.primary : colors.surface.tint;
      const textFill = node.is_outcome ? colors.text.on_dark : colors.text.heading;
      const lines = wrapText(node.question_or_outcome, nodeWidth - 16, { sizePx: 11, family: typography.body.family }).slice(0, 3);
      const textSpans = lines
        .map((l, li) => `<text x="${cx}" y="${y + NODE_HEIGHT / 2 - (lines.length - 1) * 6 + li * 12 + 4}" text-anchor="middle" font-size="11" font-family="${escapeXml(typography.body.family)}" fill="${textFill}">${escapeXml(l)}</text>`)
        .join('');
      return `<rect x="${x}" y="${y}" width="${nodeWidth}" height="${NODE_HEIGHT}" rx="8" fill="${fill}" />${textSpans}`;
    })
    .join('');

  return svgDocument(totalWidth, height, edgeSvg + nodeSvg);
}
