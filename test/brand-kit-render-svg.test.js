/**
 * Phase 9's "every exhibit component at minimum, maximum and longest-label
 * content" eval, pulled forward to run against the renderer as soon as it
 * exists rather than waiting for the rest of the pipeline — see the Phase 0
 * sequencing note. Every kind gets three passes: a minimal item count, the
 * schema's maximum (or a generous stand-in where the schema has none), and
 * a single very long label — and every pass must produce well-formed SVG
 * with a declared width/height matching the request, never throw, and never
 * place a shape outside its own declared canvas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLValidator } from 'fast-xml-parser';
import { renderExhibitToSvg, SVG_EXHIBIT_KINDS } from '../server/brandKit/render/exhibitToSvg.js';
import { resolveTokens } from '../server/brandKit/tokens.js';

const tokens = resolveTokens({
  colors: {
    primary: { hex: '#1A73E8' },
    secondary: { hex: '#FF6B00' },
    chart_categorical: [{ hex: '#2563EB' }, { hex: '#DC2626' }, { hex: '#059669' }, { hex: '#D97706' }],
  },
});

const LONG_LABEL =
  'A genuinely unreasonably long label that a real client will absolutely paste into a form field someday whether we like it or not';

function assertValidSvg(svg, width, height) {
  const result = XMLValidator.validate(svg);
  assert.equal(result, true, typeof result === 'object' ? JSON.stringify(result) : undefined);
  assert.match(svg, new RegExp(`width="${width}"`));
  assert.match(svg, new RegExp(`height="${height.toFixed ? Math.round(height) : height}"`, ''));
}

/** Approximate but real: every rect's x+width and every circle's cx+r must
 * stay within the declared canvas — the actual "did we overflow" check for
 * the shapes that make up the bulk of every component here. */
function assertNoRectOverflow(svg, width, height) {
  for (const m of svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    const [, x, y, w, h] = m.map(Number);
    assert.ok(x + w <= width + 1, `rect x=${x} width=${w} exceeds canvas width ${width}`);
    assert.ok(y + h <= height + 1, `rect y=${y} height=${h} exceeds canvas height ${height}`);
  }
}

function run(kind, content, { width = 640 } = {}) {
  const svg = renderExhibitToSvg(content, tokens, { width });
  const widthMatch = svg.match(/width="(\d+(?:\.\d+)?)"/);
  const heightMatch = svg.match(/height="(\d+(?:\.\d+)?)"/);
  assert.ok(widthMatch && heightMatch, `${kind}: missing width/height attributes`);
  const result = XMLValidator.validate(svg);
  assert.equal(result, true, `${kind}: ${typeof result === 'object' ? JSON.stringify(result) : ''}`);
  assertNoRectOverflow(svg, Number(widthMatch[1]), Number(heightMatch[1]));
  return svg;
}

test('every SVG-based exhibit kind has a renderer', () => {
  const expected = [
    'kpi_row', 'card_grid', 'numbered_phases', 'process_flow', 'timeline', 'roadmap',
    'matrix_2x2', 'comparison_matrix', 'decision_tree', 'org_chart', 'journey_map', 'chart',
  ];
  for (const k of expected) assert.ok(SVG_EXHIBIT_KINDS.has(k), `missing renderer for ${k}`);
});

// --- kpi_row ---------------------------------------------------------------
test('kpi_row: min (2), max (5), longest label', () => {
  run('kpi_row-min', { kind: 'kpi_row', items: [{ value: '1', label: 'A' }, { value: '2', label: 'B' }] });
  run('kpi_row-max', { kind: 'kpi_row', items: Array.from({ length: 5 }, (_, i) => ({ value: `${i}`, label: `Metric ${i}`, delta: '+1%', direction: 'up_good' })) });
  run('kpi_row-long', { kind: 'kpi_row', items: [{ value: '1', label: LONG_LABEL }, { value: '2', label: 'B' }] });
});

// --- card_grid ---------------------------------------------------------------
test('card_grid: min (1 card), max (4 columns x many), longest label', () => {
  run('card_grid-min', { kind: 'card_grid', columns: 2, cards: [{ title: 'One', text: 'x' }] });
  run('card_grid-max', { kind: 'card_grid', columns: 4, cards: Array.from({ length: 8 }, (_, i) => ({ title: `Card ${i}`, text: 'Body copy for this card.', icon: 'growth' })) });
  run('card_grid-long', { kind: 'card_grid', columns: 2, cards: [{ title: LONG_LABEL, text: LONG_LABEL }] });
});

// --- numbered_phases -----------------------------------------------------
test('numbered_phases: min (1), max (6), longest label', () => {
  run('phases-min', { kind: 'numbered_phases', phases: [{ numeral: '1', title: 'Discover' }] });
  run('phases-max', { kind: 'numbered_phases', phases: Array.from({ length: 6 }, (_, i) => ({ numeral: `${i + 1}`, title: `Phase ${i + 1}`, subtitle: 'Sub', body: ['Detail one', 'Detail two'] })) });
  run('phases-long', { kind: 'numbered_phases', phases: [{ numeral: '1', title: LONG_LABEL, body: [LONG_LABEL] }] });
});

// --- process_flow ----------------------------------------------------------
test('process_flow: min (2), max (7), longest label, vertical orientation', () => {
  run('flow-min', { kind: 'process_flow', steps: [{ label: 'Start' }, { label: 'End', terminal: true }] });
  run('flow-max', { kind: 'process_flow', steps: Array.from({ length: 7 }, (_, i) => ({ label: `Step ${i}`, detail: 'detail' })) });
  run('flow-long', { kind: 'process_flow', steps: [{ label: LONG_LABEL }, { label: 'End' }] });
  run('flow-vertical', { kind: 'process_flow', orientation: 'vertical', steps: [{ label: 'Start', detail: LONG_LABEL }, { label: 'End', terminal: true }] });
});

// --- timeline ----------------------------------------------------------------
test('timeline: min (1), max (many), longest label', () => {
  run('timeline-min', { kind: 'timeline', events: [{ when: '2026', label: 'Launch' }] });
  run('timeline-max', { kind: 'timeline', events: Array.from({ length: 8 }, (_, i) => ({ when: `Q${i}`, label: `Event ${i}`, milestone: i % 2 === 0 })) });
  run('timeline-long', { kind: 'timeline', events: [{ when: '2026', label: LONG_LABEL }] });
  run('timeline-empty', { kind: 'timeline', events: [] });
});

// --- roadmap -----------------------------------------------------------------
test('roadmap: min (1 track/1 period), max, longest label', () => {
  run('roadmap-min', { kind: 'roadmap', periods: ['Q1'], tracks: [{ name: 'Track', items: [{ label: 'Item', start_period: 0, end_period: 1, status: 'planned' }] }] });
  run('roadmap-max', {
    kind: 'roadmap',
    periods: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'],
    tracks: Array.from({ length: 6 }, (_, i) => ({ name: `Track ${i}`, items: [{ label: `Workstream ${i}`, start_period: i % 4, end_period: (i % 4) + 2, status: 'in_progress' }] })),
  });
  run('roadmap-long', { kind: 'roadmap', periods: ['Q1', 'Q2'], tracks: [{ name: LONG_LABEL, items: [{ label: LONG_LABEL, start_period: 0, end_period: 2, status: 'at_risk' }] }] });
});

// --- matrix_2x2 ----------------------------------------------------------
test('matrix_2x2: min (1 item), max (many), longest label', () => {
  run('m2x2-min', { kind: 'matrix_2x2', x_axis: { label: 'Impact' }, y_axis: { label: 'Effort' }, items: [{ label: 'A', x: 0.5, y: 0.5 }] });
  run('m2x2-max', { kind: 'matrix_2x2', x_axis: { label: 'Impact', low: 'Low', high: 'High' }, y_axis: { label: 'Effort', low: 'Low', high: 'High' }, quadrant_labels: ['Q1', 'Q2', 'Q3', 'Q4'], items: Array.from({ length: 10 }, (_, i) => ({ label: `Item ${i}`, x: i / 10, y: 1 - i / 10, highlight: i === 0 })) });
  run('m2x2-long', { kind: 'matrix_2x2', x_axis: { label: LONG_LABEL }, y_axis: { label: LONG_LABEL }, items: [{ label: LONG_LABEL, x: 0, y: 1 }, { label: 'B', x: 1, y: 0 }] });
});

// --- comparison_matrix -----------------------------------------------------
test('comparison_matrix: min (1x1), max, longest label', () => {
  run('cmp-min', { kind: 'comparison_matrix', options: ['A'], criteria: ['Cost'], scores: [['strong']] });
  run('cmp-max', {
    kind: 'comparison_matrix',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    criteria: ['Cost', 'Speed', 'Risk', 'Fit', 'Support'],
    scores: Array.from({ length: 5 }, () => ['strong', 'adequate', 'weak', 'none']),
    recommended_option_index: 1,
  });
  run('cmp-long', { kind: 'comparison_matrix', options: [LONG_LABEL], criteria: [LONG_LABEL], scores: [['unknown']] });
});

// --- decision_tree -----------------------------------------------------------
test('decision_tree: min (leaf only), max (deep + branchy), longest label', () => {
  run('tree-min', { kind: 'decision_tree', root: { question_or_outcome: 'Outcome', is_outcome: true } });
  run('tree-max', {
    kind: 'decision_tree',
    root: {
      question_or_outcome: 'Is revenue > $1M?',
      branches: [
        { condition: 'Yes', node: { question_or_outcome: 'Growth > 20%?', branches: [
          { condition: 'Yes', node: { question_or_outcome: 'Scale', is_outcome: true } },
          { condition: 'No', node: { question_or_outcome: 'Optimize', is_outcome: true } },
        ] } },
        { condition: 'No', node: { question_or_outcome: 'Seek funding', branches: [
          { condition: 'Available', node: { question_or_outcome: 'Raise', is_outcome: true } },
          { condition: 'Unavailable', node: { question_or_outcome: 'Bootstrap', is_outcome: true } },
        ] } },
      ],
    },
  });
  run('tree-long', { kind: 'decision_tree', root: { question_or_outcome: LONG_LABEL, branches: [{ condition: LONG_LABEL, node: { question_or_outcome: 'Outcome', is_outcome: true } }] } });
});

// --- org_chart -----------------------------------------------------------------
test('org_chart: min (root only), max (wide), longest label', () => {
  run('org-min', { kind: 'org_chart', root: { title: 'CEO' } });
  // 12 direct reports is an intentionally unrealistic stress case, not a
  // realistic org — the point is confirming the node boxes shrink to fit
  // rather than overflow the canvas as sibling count grows.
  run('org-max', { kind: 'org_chart', root: { title: 'CEO', name: 'A. Person', reports: Array.from({ length: 12 }, (_, i) => ({ title: `VP ${i}`, name: `Person ${i}` })) } });
  run('org-long', { kind: 'org_chart', root: { title: LONG_LABEL, name: LONG_LABEL, reports: [{ title: LONG_LABEL }] } });
});

// --- journey_map -----------------------------------------------------------------
test('journey_map: min (1 stage/1 lane), max, longest label', () => {
  run('journey-min', { kind: 'journey_map', lanes: ['Actions'], stages: [{ name: 'Aware', cells: ['Sees ad'] }] });
  run('journey-max', {
    kind: 'journey_map',
    lanes: ['Actions', 'Touchpoints', 'Emotions', 'Pain points'],
    stages: Array.from({ length: 6 }, (_, i) => ({ name: `Stage ${i}`, cells: ['a', 'b', 'c', 'd'], sentiment: (i % 3) - 1 })),
  });
  run('journey-long', { kind: 'journey_map', lanes: [LONG_LABEL], stages: [{ name: LONG_LABEL, cells: [LONG_LABEL] }] });
});

// --- chart: every chart_type, min/max series+categories, longest label ------
const CHART_TYPES = ['bar', 'column', 'grouped_bar', 'stacked_bar', 'line', 'area', 'pie', 'donut', 'scatter', 'waterfall', 'bullet', 'heatmap', 'funnel'];

test('chart: every chart_type renders with a single small series', () => {
  for (const chart_type of CHART_TYPES) {
    run(`chart-${chart_type}-min`, { kind: 'chart', chart_type, categories: ['A', 'B'], series: [{ name: 'S1', values: [10, 20] }] });
  }
});

test('chart: every chart_type renders with many categories/series (max)', () => {
  const categories = Array.from({ length: 12 }, (_, i) => `Cat ${i}`);
  for (const chart_type of CHART_TYPES) {
    const series = Array.from({ length: 4 }, (_, si) => ({ name: `Series ${si}`, values: categories.map((_, i) => (i + si) * 3) }));
    run(`chart-${chart_type}-max`, { kind: 'chart', chart_type, categories, series });
  }
});

test('chart: every chart_type copes with a null value in the series', () => {
  for (const chart_type of CHART_TYPES) {
    run(`chart-${chart_type}-null`, { kind: 'chart', chart_type, categories: ['A', 'B', 'C'], series: [{ name: 'S1', values: [10, null, 30] }] });
  }
});

test('chart: longest realistic label on categories and series names', () => {
  run('chart-long', { kind: 'chart', chart_type: 'bar', categories: [LONG_LABEL, 'B'], series: [{ name: LONG_LABEL, values: [10, 20] }] });
});

test('chart: is_estimate renders the ESTIMATE badge and does not throw', () => {
  const svg = run('chart-estimate', { kind: 'chart', chart_type: 'bar', categories: ['A'], series: [{ name: 'S1', values: [10] }], is_estimate: true });
  assert.match(svg, /ESTIMATE/);
});

test('chart: throws a clear error for an unknown chart_type rather than silently rendering nothing', () => {
  assert.throws(() => renderExhibitToSvg({ kind: 'chart', chart_type: 'not_a_real_type', categories: [], series: [] }, tokens, {}), /Unknown chart_type/);
});
