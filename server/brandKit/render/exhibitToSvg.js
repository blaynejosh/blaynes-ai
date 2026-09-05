/**
 * Dispatches an exhibit's `content` (document-ir.schema.json's
 * exhibit_content union) to its SVG component. table/image/quote are
 * deliberately absent — they render natively per format instead (a real
 * editable Word table, a real embedded image, styled text) rather than as
 * a rasterized graphic; see server/brandKit/render/docx.js and html.js.
 */
import { renderKpiRow } from './svg/kpiRow.js';
import { renderCardGrid } from './svg/cardGrid.js';
import { renderNumberedPhases } from './svg/numberedPhases.js';
import { renderProcessFlow } from './svg/processFlow.js';
import { renderTimeline } from './svg/timeline.js';
import { renderRoadmap } from './svg/roadmap.js';
import { renderMatrix2x2 } from './svg/matrix2x2.js';
import { renderComparisonMatrix } from './svg/comparisonMatrix.js';
import { renderDecisionTree } from './svg/decisionTree.js';
import { renderOrgChart } from './svg/orgChart.js';
import { renderJourneyMap } from './svg/journeyMap.js';
import { renderChart } from './svg/chart.js';

const RENDERERS = {
  kpi_row: renderKpiRow,
  card_grid: renderCardGrid,
  numbered_phases: renderNumberedPhases,
  process_flow: renderProcessFlow,
  timeline: renderTimeline,
  roadmap: renderRoadmap,
  matrix_2x2: renderMatrix2x2,
  comparison_matrix: renderComparisonMatrix,
  decision_tree: renderDecisionTree,
  org_chart: renderOrgChart,
  journey_map: renderJourneyMap,
  chart: renderChart,
};

export const SVG_EXHIBIT_KINDS = new Set(Object.keys(RENDERERS));

export function renderExhibitToSvg(content, tokens, options) {
  const renderer = RENDERERS[content.kind];
  if (!renderer) throw new Error(`No SVG renderer for exhibit content kind "${content.kind}".`);
  return renderer(content, tokens, options);
}
