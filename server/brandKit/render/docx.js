/**
 * Assembles a real, editable .docx from Document IR + resolved tokens —
 * "real styles, real tables, real headings, not a page of images." Every
 * SVG-based exhibit (charts, infographics) is the one deliberate exception:
 * those get rasterized (render/svgToPng.js) and embedded as a real
 * ImageRun, because Word has no native equivalent for an arbitrary SVG
 * diagram — everything else (headings, paragraphs, lists, tables, quotes)
 * is a real Word primitive, editable in place.
 *
 * The docx-js gotchas from the brief, and where each is handled:
 *   - docx-js cannot open an existing file — irrelevant here, this module
 *     only ever creates.
 *   - Page size in DXA (render/dxa.js's PAGE_SIZE_DXA) — set explicitly on
 *     section.properties.page.size, never left at the library default.
 *   - Table columnWidths AND per-cell width, both DXA — buildTable() below.
 *   - ShadingType.CLEAR, never SOLID — every shaded cell/paragraph.
 *   - No literal bullet character — real numbering.config, not `"• " + text`.
 *   - A page break lives inside a paragraph — `new Paragraph({ children: [new PageBreak()] })`.
 *   - ImageRun needs an explicit `type` — always passed from the actual PNG.
 *   - A heavy display face must never also be bold — typography.rules.display_never_bold
 *     is checked everywhere a display-typeface run is built.
 */
import { Document, Packer, Paragraph, TextRun, PageBreak, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, LevelFormat, LevelSuffix, ImageRun, HeadingLevel, TableOfContents } from 'docx';
import { mmToDxa, ptToHalfPoints, PAGE_SIZE_DXA } from './dxa.js';
import { svgToPng } from './svgToPng.js';
import { renderExhibitToSvg, SVG_EXHIBIT_KINDS } from './exhibitToSvg.js';
import { assertQuoteConsent } from './guards.js';

const BULLET_REF = 'blayne-bullet-list';
const NUMBERED_REF = 'blayne-numbered-list';

function numberingConfig() {
  return {
    config: [
      {
        reference: BULLET_REF,
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            suffix: LevelSuffix.SPACE, // without this the bullet sits a full tab away from its text
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
      {
        reference: NUMBERED_REF,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            suffix: LevelSuffix.SPACE,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  };
}

/**
 * "A heavy display face must not also be set bold, or the renderer
 * synthesises a second layer of weight and the type smears." tokens.js
 * lets typography.heading silently alias to typography.display when the
 * kit sets no separate heading face (see resolveTokens' fallback), so this
 * check is by FONT FAMILY, not by which role asked for it — any run that
 * happens to render in the display face is covered, whether it's the cover
 * title or a heading that fell back to the same face.
 */
function boldAllowed(tokens, fontFamily) {
  return !(tokens.typography.rules.display_never_bold && fontFamily === tokens.typography.display.family);
}

function displayRun(text, tokens, extra = {}) {
  const bold = boldAllowed(tokens, tokens.typography.display.family) ? (extra.bold ?? false) : false;
  return new TextRun({ text, font: tokens.typography.display.family, ...extra, bold });
}

function bodyRun(text, tokens, extra = {}) {
  const font = tokens.typography.body.family;
  const bold = boldAllowed(tokens, font) ? (extra.bold ?? false) : false;
  return new TextRun({ text, font, ...extra, bold });
}

function headingParagraph(block, tokens) {
  const level = Math.min(3, Math.max(1, block.level));
  const headingLevel = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 }[level];
  const sizePt = tokens.typography.scale[`h${level}`];
  const text = block.number ? `${block.number} ${block.text}` : block.text;
  const font = tokens.typography.heading.family;
  return new Paragraph({
    heading: headingLevel,
    children: [
      new TextRun({
        text,
        font,
        bold: boldAllowed(tokens, font),
        size: ptToHalfPoints(sizePt),
        color: tokens.colors.text.heading.replace('#', ''),
      }),
    ],
    spacing: { before: 240, after: 120 },
  });
}

function paragraphBlock(block, tokens) {
  const sizePt = block.emphasis === 'lead' ? tokens.typography.scale.body * 1.2 : block.emphasis === 'small' ? tokens.typography.scale.small : tokens.typography.scale.body;
  return new Paragraph({
    children: [bodyRun(block.text, tokens, { size: ptToHalfPoints(sizePt), color: tokens.colors.text.body.replace('#', '') })],
    spacing: { after: tokens.typography.rules.paragraph_spacing * 20 },
  });
}

function listParagraphs(block, tokens) {
  if (block.style === 'labelled') {
    return (block.items ?? []).map(
      (item) =>
        new Paragraph({
          children: [
            ...(item.label ? [bodyRun(`${item.label}: `, tokens, { bold: true })] : []),
            bodyRun(item.text, tokens),
          ],
          spacing: { after: 80 },
        }),
    );
  }
  const reference = block.style === 'numbered' ? NUMBERED_REF : BULLET_REF;
  return (block.items ?? []).map(
    (item) =>
      new Paragraph({
        numbering: { reference, level: 0 },
        children: [...(item.label ? [bodyRun(`${item.label}: `, tokens, { bold: true })] : []), bodyRun(item.text, tokens)],
      }),
  );
}

const CALLOUT_VARIANT_FILL = { warning: 'FDE68A', recommendation: 'DBEAFE' };

function calloutParagraphs(block, tokens) {
  const fill = CALLOUT_VARIANT_FILL[block.variant] ?? tokens.colors.surface.tint.replace('#', '');
  const paras = [];
  if (block.label) {
    paras.push(new Paragraph({ children: [bodyRun(block.label.toUpperCase(), tokens, { bold: true, size: ptToHalfPoints(tokens.typography.scale.small) })], shading: { type: ShadingType.CLEAR, fill } }));
  }
  for (const line of block.body ?? []) {
    paras.push(new Paragraph({ children: [bodyRun(line, tokens)], shading: { type: ShadingType.CLEAR, fill } }));
  }
  return paras;
}

/** Real Word table — widths in DXA on both the table (columnWidths) and
 * every cell (gotcha), header shaded with ShadingType.CLEAR. */
function buildTable(table, tokens, contentWidthDxa) {
  const weights = table.columns.map((c) => c.width_weight ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const columnWidths = weights.map((w) => Math.round((w / totalWeight) * contentWidthDxa));

  const headerFill = tokens.layout.table_style === 'dark_header_zebra' ? tokens.colors.surface.dark.replace('#', '') : tokens.colors.surface.tint.replace('#', '');
  const headerTextColor = tokens.layout.table_style === 'dark_header_zebra' ? tokens.colors.text.on_dark.replace('#', '') : tokens.colors.text.heading.replace('#', '');

  const headerRow = new TableRow({
    tableHeader: true,
    children: table.columns.map(
      (col, i) =>
        new TableCell({
          width: { size: columnWidths[i], type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: headerFill },
          children: [new Paragraph({ alignment: alignmentFor(col.align), children: [bodyRun(col.header, tokens, { bold: true, color: headerTextColor })] })],
        }),
    ),
  });

  const zebraFill = tokens.layout.table_style === 'dark_header_zebra' ? tokens.colors.surface.tint.replace('#', '') : null;

  const bodyRows = table.rows.map(
    (row, ri) =>
      new TableRow({
        children: row.map(
          (cellText, ci) =>
            new TableCell({
              width: { size: columnWidths[ci], type: WidthType.DXA },
              ...(zebraFill && ri % 2 === 1 ? { shading: { type: ShadingType.CLEAR, fill: zebraFill } } : {}),
              children: [new Paragraph({ alignment: alignmentFor(table.columns[ci]?.align), children: [bodyRun(String(cellText), tokens)] })],
            }),
        ),
      }),
  );

  return new Table({ width: { size: contentWidthDxa, type: WidthType.DXA }, columnWidths, rows: [headerRow, ...bodyRows] });
}

function alignmentFor(align) {
  return { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[align] ?? AlignmentType.LEFT;
}

async function svgExhibitToImageRun(content, tokens, contentWidthPx) {
  const svg = renderExhibitToSvg(content, tokens, { width: contentWidthPx });
  const { buffer, width, height } = await svgToPng(svg);
  const displayWidth = contentWidthPx;
  const displayHeight = Math.round((height / width) * displayWidth);
  return new ImageRun({ type: 'png', data: buffer, transformation: { width: displayWidth, height: displayHeight } });
}

async function exhibitContentParagraphs(content, tokens, ctx) {
  if (content.kind === 'table') {
    return [buildTable(content, tokens, ctx.contentWidthDxa)];
  }
  if (content.kind === 'quote') {
    assertQuoteConsent(content);
    const paras = [new Paragraph({ children: [bodyRun(`"${content.text}"`, tokens, { italics: true })] })];
    if (content.attribution) {
      paras.push(new Paragraph({ children: [bodyRun(`— ${content.attribution}${content.role ? `, ${content.role}` : ''}`, tokens, { size: ptToHalfPoints(tokens.typography.scale.small), color: tokens.colors.text.muted.replace('#', '') })] }));
    }
    return paras;
  }
  if (content.kind === 'image') {
    const asset = ctx.imageAssets.get(content.asset_id);
    if (!asset) throw new Error(`Image block references asset_id "${content.asset_id}" which was not resolved for this tenant.`);
    const widthFraction = { full: 1, half: 0.5, third: 0.33 }[content.width ?? 'full'];
    const displayWidth = Math.round(ctx.contentWidthPx * widthFraction);
    const displayHeight = Math.round((asset.height / asset.width) * displayWidth);
    const paras = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ type: asset.docxType, data: asset.buffer, transformation: { width: displayWidth, height: displayHeight } })],
      }),
    ];
    const isGenerated = content.origin === 'generated';
    const caption = [content.caption, isGenerated ? 'AI-generated image' : null].filter(Boolean).join(' — ');
    if (caption) {
      paras.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [bodyRun(caption, tokens, { italics: true, size: ptToHalfPoints(tokens.typography.scale.caption), color: tokens.colors.text.muted.replace('#', '') })] }));
    }
    return paras;
  }
  if (SVG_EXHIBIT_KINDS.has(content.kind)) {
    return [new Paragraph({ children: [await svgExhibitToImageRun(content, tokens, ctx.contentWidthPx)] })];
  }
  throw new Error(`No .docx renderer for exhibit content kind "${content.kind}".`);
}

async function exhibitParagraphs(block, tokens, ctx) {
  const titleText = block.exhibit_number ? `Exhibit ${block.exhibit_number}: ${block.action_title}` : block.action_title;
  const paras = [
    new Paragraph({
      children: [bodyRun(titleText, tokens, { bold: true, color: tokens.colors.text.heading.replace('#', '') })],
      spacing: { before: 160, after: 80 },
    }),
    ...(await exhibitContentParagraphs(block.content, tokens, ctx)),
  ];
  if (block.so_what) {
    paras.push(new Paragraph({ children: [bodyRun(`So what: ${block.so_what}`, tokens, { italics: true, size: ptToHalfPoints(tokens.typography.scale.small), color: tokens.colors.text.muted.replace('#', '') })], spacing: { before: 80 } }));
  }
  return paras;
}

async function blockToParagraphs(block, tokens, ctx) {
  switch (block.type) {
    case 'cover':
      return [
        new Paragraph({ children: [bodyRun((block.kicker ?? '').toUpperCase(), tokens, { bold: true, color: tokens.colors.primary.replace('#', '') })] }),
        new Paragraph({
          children: [
            displayRun(block.title ?? '', tokens, { size: ptToHalfPoints(tokens.typography.scale.cover_title), color: tokens.colors.text.heading.replace('#', '') }),
            ...(block.emphasis_word ? [displayRun(` ${block.emphasis_word}`, tokens, { size: ptToHalfPoints(tokens.typography.scale.cover_title), color: tokens.colors.primary.replace('#', '') })] : []),
          ],
          spacing: { before: 120, after: 120 },
        }),
        ...(block.subtitle ? [new Paragraph({ children: [bodyRun(block.subtitle, tokens)] })] : []),
        new Paragraph({ children: [new PageBreak()] }),
      ];
    case 'toc':
      return [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [bodyRun('Contents', tokens)] }), new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }), new Paragraph({ children: [new PageBreak()] })];
    case 'part_divider':
      return [
        ...(block.part_label ? [new Paragraph({ children: [bodyRun(block.part_label.toUpperCase(), tokens, { bold: true, color: tokens.colors.primary.replace('#', '') })] })] : []),
        new Paragraph({ children: [displayRun(block.title, tokens, { size: ptToHalfPoints(tokens.typography.scale.part_title) })] }),
        ...(block.blurb ? [new Paragraph({ children: [bodyRun(block.blurb, tokens)] })] : []),
        new Paragraph({ children: [new PageBreak()] }),
      ];
    case 'heading':
      return [headingParagraph(block, tokens)];
    case 'paragraph':
      return [paragraphBlock(block, tokens)];
    case 'list':
      return listParagraphs(block, tokens);
    case 'callout':
      return calloutParagraphs(block, tokens);
    case 'exhibit':
      return exhibitParagraphs(block, tokens, ctx);
    case 'page_break':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'spacer':
      return [new Paragraph({ children: [], spacing: { after: { s: 80, m: 160, l: 320 }[block.size ?? 'm'] } })];
    default:
      throw new Error(`No .docx renderer for block type "${block.type}".`);
  }
}

function sourcesAndAssumptionsParagraphs(ir, tokens) {
  const paras = [];
  if (ir.sources?.length) {
    paras.push(new Paragraph({ children: [new PageBreak()] }));
    paras.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [bodyRun('Sources', tokens)] }));
    ir.sources.forEach((s, i) => {
      const text = `${i + 1}. ${s.title}${s.publisher ? `, ${s.publisher}` : ''}${s.published ? ` (${s.published})` : ''} — accessed ${s.accessed}${s.url ? `. ${s.url}` : ''}`;
      paras.push(new Paragraph({ children: [bodyRun(text, tokens, { size: ptToHalfPoints(tokens.typography.scale.small) })] }));
    });
  }
  if (ir.assumptions?.length) {
    paras.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [bodyRun('Assumptions register', tokens)], spacing: { before: 240 } }));
    ir.assumptions.forEach((a, i) => {
      paras.push(new Paragraph({ children: [bodyRun(`${i + 1}. ${a.statement}`, tokens, { bold: true, size: ptToHalfPoints(tokens.typography.scale.small) })] }));
      paras.push(new Paragraph({ children: [bodyRun(`Basis: ${a.basis}`, tokens, { size: ptToHalfPoints(tokens.typography.scale.small) })] }));
      paras.push(new Paragraph({ children: [bodyRun(`Sensitivity: ${a.sensitivity}`, tokens, { size: ptToHalfPoints(tokens.typography.scale.small) })] }));
    });
  }
  return paras;
}

/**
 * @param {object} ir
 * @param {object} tokens  resolveTokens() output
 * @param {object} ctx
 * @param {Map<string,{buffer:Buffer,width:number,height:number,docxType:'png'|'jpg'|'gif'|'bmp'}>} ctx.imageAssets
 */
export async function buildDocxDocument(ir, tokens, ctx = {}) {
  const pageSize = PAGE_SIZE_DXA[tokens.layout.page_size] ?? PAGE_SIZE_DXA.A4;
  const margin = {
    top: mmToDxa(tokens.layout.margins_mm.top),
    right: mmToDxa(tokens.layout.margins_mm.right),
    bottom: mmToDxa(tokens.layout.margins_mm.bottom),
    left: mmToDxa(tokens.layout.margins_mm.left),
  };
  const contentWidthDxa = pageSize.width - margin.left - margin.right;
  const contentWidthPx = Math.round((contentWidthDxa / 1440) * 96);

  const blockCtx = { imageAssets: ctx.imageAssets ?? new Map(), contentWidthDxa, contentWidthPx };

  const bodyParagraphs = [];
  for (const block of ir.blocks ?? []) {
    bodyParagraphs.push(...(await blockToParagraphs(block, tokens, blockCtx)));
  }
  bodyParagraphs.push(...sourcesAndAssumptionsParagraphs(ir, tokens));

  return new Document({
    title: ir.meta?.title,
    numbering: numberingConfig(),
    sections: [
      {
        properties: { page: { size: { width: pageSize.width, height: pageSize.height }, margin } },
        children: bodyParagraphs,
      },
    ],
  });
}

export async function renderDocxBuffer(ir, tokens, ctx) {
  const doc = await buildDocxDocument(ir, tokens, ctx);
  return Packer.toBuffer(doc);
}
