import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { XMLValidator } from 'fast-xml-parser';
import sharp from 'sharp';
import { buildDocxDocument, renderDocxBuffer } from '../server/brandKit/render/docx.js';
import { buildHtmlDocument } from '../server/brandKit/render/html.js';
import { renderDocument } from '../server/brandKit/render/index.js';
import { resolveTokens } from '../server/brandKit/tokens.js';
import { Packer } from 'docx';

const tokens = resolveTokens({
  colors: {
    primary: { hex: '#1A73E8' },
    secondary: { hex: '#FF6B00' },
    chart_categorical: [{ hex: '#2563EB' }, { hex: '#DC2626' }, { hex: '#059669' }],
  },
  typography: { display: { family: 'Georgia' }, body: { family: 'Arial' }, rules: { display_never_bold: true } },
  layout: { page_size: 'A4', table_style: 'dark_header_zebra' },
});

function fullIr(overrides = {}) {
  return {
    ir_version: '1.0',
    meta: { title: 'Regulatory Cost Outlook', doc_type: 'strategy_report', audience: 'Board', governing_thought: 'Regulatory cost rises 40% by Q3.' },
    blocks: [
      { type: 'cover', kicker: 'Strategy Report', title: 'Regulatory cost rises', emphasis_word: '40% by Q3', subtitle: 'Prepared for the board' },
      { type: 'toc' },
      { type: 'part_divider', part_label: 'Part One', title: 'The finding', blurb: 'What changed and why it matters.' },
      { type: 'heading', level: 1, text: 'Compliance headcount must double before Q3' },
      { type: 'paragraph', text: 'Costs are rising sharply.', source_ids: ['s1'] },
      { type: 'paragraph', text: 'A lead paragraph.', emphasis: 'lead' },
      { type: 'list', style: 'bullet', items: [{ text: 'First point', source_ids: ['s1'] }, { text: 'Second point' }] },
      { type: 'list', style: 'numbered', items: [{ text: 'Step one' }, { text: 'Step two' }] },
      { type: 'list', style: 'labelled', items: [{ label: 'Risk', text: 'Regulatory exposure' }] },
      { type: 'callout', variant: 'key_takeaway', label: 'Key takeaway', body: ['Budget for the aggressive case.'] },
      {
        type: 'exhibit',
        exhibit_number: '1',
        action_title: 'Cost triples under aggressive enforcement',
        so_what: 'Budget accordingly.',
        source_ids: ['s1'],
        content: { kind: 'table', columns: [{ header: 'Scenario' }, { header: 'Cost', align: 'right' }], rows: [['Base', '+18%'], ['Aggressive', '+40%']] },
      },
      {
        type: 'exhibit',
        action_title: 'Regulatory cost by scenario',
        content: { kind: 'chart', chart_type: 'bar', categories: ['Base', 'Aggressive'], series: [{ name: 'Cost', values: [18, 40] }], is_estimate: true },
      },
      { type: 'exhibit', action_title: 'Compliance is a three-phase rollout', content: { kind: 'kpi_row', items: [{ value: '3', label: 'Phases' }, { value: '18mo', label: 'Duration' }] } },
      { type: 'exhibit', action_title: 'Leadership quoted on the risk', content: { kind: 'quote', text: 'We take this seriously.', attribution: 'Jane CFO', role: 'CFO', consent_recorded: true } },
      { type: 'page_break' },
      { type: 'spacer', size: 'l' },
      { type: 'heading', level: 2, text: 'Assumptions' },
      { type: 'paragraph', text: 'Modelled at current enforcement trends.', assumption_ids: ['a1'] },
    ],
    sources: [{ id: 's1', title: 'Regulator Filing 2026', accessed: '2026-09-01', source_type: 'primary_regulator' }],
    assumptions: [{ id: 'a1', statement: 'Enforcement trend holds', basis: 'Historical pattern', sensitivity: 'Cost could double if enforcement accelerates' }],
    ...overrides,
  };
}

// --- docx ------------------------------------------------------------------

test('buildDocxDocument assembles and packs a real .docx for the full block set', async () => {
  const doc = await buildDocxDocument(fullIr(), tokens, { imageAssets: new Map() });
  const buffer = await Packer.toBuffer(doc);
  assert.ok(buffer.length > 1000);

  const zip = new AdmZip(buffer);
  const documentXml = zip.getEntry('word/document.xml').getData().toString('utf-8');
  assert.match(documentXml, /Regulatory cost rises/);
  assert.match(documentXml, /Compliance headcount must double before Q3/);
  // Real table, not a rasterized image of one.
  assert.match(documentXml, /<w:tbl>/);
  // No literal bullet character in the actual document text content.
  assert.doesNotMatch(documentXml, /<w:t[^>]*>[^<]*•/);

  const numberingXml = zip.getEntry('word/numbering.xml')?.getData().toString('utf-8');
  assert.ok(numberingXml, 'numbering.xml must exist — lists use real numbering, not manual bullet text');
  assert.match(numberingXml, /w:val="bullet"/);
});

test('renderDocxBuffer produces the same thing end-to-end', async () => {
  const buffer = await renderDocxBuffer(fullIr(), tokens, { imageAssets: new Map() });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1000);
});

test('docx: an attributed quote with no consent throws before packing', async () => {
  const ir = fullIr({ blocks: [{ type: 'exhibit', action_title: 'x', content: { kind: 'quote', text: 'x', attribution: 'Someone' } }] });
  await assert.rejects(() => buildDocxDocument(ir, tokens, { imageAssets: new Map() }), /consent/i);
});

test('docx: display_never_bold means the cover title run is never bold even when requested', async () => {
  const doc = await buildDocxDocument(fullIr(), tokens, { imageAssets: new Map() });
  const buffer = await Packer.toBuffer(doc);
  const zip = new AdmZip(buffer);
  const documentXml = zip.getEntry('word/document.xml').getData().toString('utf-8');
  // The cover title run uses the display font — assert no <w:b/> immediately
  // scoped to a run carrying the display font name.
  const displayRunBlocks = [...documentXml.matchAll(/<w:r>(?:(?!<w:r>).)*?Georgia(?:(?!<w:r>).)*?<\/w:r>/gs)];
  assert.ok(displayRunBlocks.length > 0, 'expected at least one run using the display font');
  for (const block of displayRunBlocks) {
    assert.doesNotMatch(block[0], /<w:b\/>|<w:b w:val="(true|1)"/);
  }
});

test('docx: an embedded chart exhibit produces a real image relationship, not just text', async () => {
  const buffer = await renderDocxBuffer(fullIr(), tokens, { imageAssets: new Map() });
  const zip = new AdmZip(buffer);
  const mediaFiles = zip.getEntries().filter((e) => e.entryName.startsWith('word/media/'));
  assert.ok(mediaFiles.length >= 2, 'expected at least the chart and kpi_row exhibits to embed as images');
});

// --- html --------------------------------------------------------------

test('buildHtmlDocument produces valid, well-formed HTML for the full block set', () => {
  const html = buildHtmlDocument(fullIr(), tokens, { imageAssets: new Map() });
  assert.match(html, /Regulatory cost rises/);
  assert.match(html, /<table class="ir-table">/);
  assert.match(html, /<svg/); // the chart/kpi_row exhibits embed inline SVG
  // Loose well-formedness check on the body content (full HTML documents
  // aren't valid standalone XML because of <!doctype>, so check the body).
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  const result = XMLValidator.validate(`<root>${bodyMatch[1]}</root>`);
  assert.equal(result, true, typeof result === 'object' ? JSON.stringify(result) : undefined);
});

test('html: an attributed quote with no consent throws', () => {
  const ir = fullIr({ blocks: [{ type: 'exhibit', action_title: 'x', content: { kind: 'quote', text: 'x', attribution: 'Someone' } }] });
  assert.throws(() => buildHtmlDocument(ir, tokens, { imageAssets: new Map() }), /consent/i);
});

test('html: a generated image always carries the AI-generated note', async () => {
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  const imageAssets = new Map([['img1', { dataUri: `data:image/png;base64,${png.toString('base64')}` }]]);
  const ir = fullIr({ blocks: [{ type: 'exhibit', action_title: 'x', content: { kind: 'image', asset_id: 'img1', origin: 'generated', caption: 'A chart' } }] });
  const html = buildHtmlDocument(ir, tokens, { imageAssets });
  assert.match(html, /AI-generated image/);
});

test('html: an image block referencing an unresolved asset_id throws rather than silently omitting it', () => {
  const ir = fullIr({ blocks: [{ type: 'exhibit', action_title: 'x', content: { kind: 'image', asset_id: 'not-a-real-asset' } }] });
  assert.throws(() => buildHtmlDocument(ir, tokens, { imageAssets: new Map() }), /not resolved/);
});

// --- full pipeline (real Playwright PDF) -----------------------------------

test('renderDocument produces a real, multi-page PDF end-to-end', async () => {
  const brandKit = { colors: tokens.colors, typography: tokens.typography, layout: tokens.layout, logos: [] };
  const { buffer, warnings } = await renderDocument({ ir: fullIr(), brandKit, assets: [], format: 'pdf' });
  assert.ok(buffer.length > 5000);
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(Array.isArray(warnings));

  // Round-trip through our own PDF text extractor as a real "is this a
  // legible document" check, not just "did bytes come out."
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    assert.ok(info.total >= 2);
    const text = await parser.getText();
    assert.match(text.text, /Regulatory cost rises/);
  } finally {
    await parser.destroy();
  }
});

test('renderDocument produces a real .docx end-to-end through the same orchestrator', async () => {
  const brandKit = { colors: tokens.colors, typography: tokens.typography, layout: tokens.layout, logos: [] };
  const { buffer } = await renderDocument({ ir: fullIr(), brandKit, assets: [], format: 'docx' });
  assert.ok(buffer.length > 1000);
  const zip = new AdmZip(buffer);
  assert.ok(zip.getEntry('word/document.xml'));
});
