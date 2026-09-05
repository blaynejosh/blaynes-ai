/**
 * Assembles a full HTML document from Document IR + resolved tokens, for
 * the .pdf path (render/index.js hands this to Playwright). Every colour,
 * font and spacing value comes from `tokens` (server/brandKit/tokens.js) —
 * this file never reads a Brand Kit field directly, the same rule every
 * SVG exhibit component follows.
 *
 * Two hard, non-negotiable gates live here, not upstream, because the
 * renderer is the last place before bytes leave the system:
 *   - An attributed quote with no recorded consent throws rather than
 *     rendering — "The IR blocks rendering of a named attributed quote
 *     without it."
 *   - A generated image always carries a visible "AI-generated" note in
 *     its caption — never left to whoever assembled the IR to remember.
 */
import { escapeXml } from './layout.js';
import { renderExhibitToSvg, SVG_EXHIBIT_KINDS } from './exhibitToSvg.js';
import { assertQuoteConsent } from './guards.js';

function mmToPx(mm) {
  // 96 CSS px per inch, 25.4mm per inch — the standard CSS px/mm ratio,
  // consistent with what Playwright's page.pdf() expects for @page margins
  // expressed via print CSS.
  return (mm / 25.4) * 96;
}

function typefaceCss(typeface) {
  return [`"${typeface.family}"`, ...(typeface.fallback_stack ?? [])].join(', ');
}

function documentStyles(tokens) {
  const { colors, typography, layout } = tokens;
  return `
    @page { size: ${layout.page_size === 'LETTER' ? 'letter' : 'A4'}; margin: ${mmToPx(layout.margins_mm.top)}px ${mmToPx(layout.margins_mm.right)}px ${mmToPx(layout.margins_mm.bottom)}px ${mmToPx(layout.margins_mm.left)}px; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ${typefaceCss(typography.body)}; font-size: ${typography.scale.body}pt; line-height: ${typography.rules.line_height_body}; color: ${colors.text.body}; background: ${colors.surface.page}; }
    h1, h2, h3 { font-family: ${typefaceCss(typography.heading)}; color: ${colors.text.heading}; margin: 0 0 8px; }
    h1 { font-size: ${typography.scale.h1}pt; }
    h2 { font-size: ${typography.scale.h2}pt; }
    h3 { font-size: ${typography.scale.h3}pt; }
    p { margin: 0 0 ${typography.rules.paragraph_spacing}pt; }
    .kicker { font-size: ${typography.scale.small}pt; letter-spacing: ${typography.rules.letterspacing_kicker}px; text-transform: uppercase; color: ${colors.primary}; }
    .cover { page-break-after: always; min-height: 100vh; display: flex; flex-direction: column; justify-content: space-between; padding: 48px; background: ${layout.cover_style === 'full_bleed_dark' ? colors.surface.dark : colors.surface.page}; color: ${layout.cover_style === 'full_bleed_dark' ? colors.text.on_dark : colors.text.heading}; }
    .cover h1 { font-family: ${typefaceCss(typography.display)}; font-size: ${typography.scale.cover_title}pt; color: inherit; }
    .part-divider { page-break-before: always; page-break-after: always; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; padding: 64px; background: ${colors.surface.dark}; color: ${colors.text.on_dark}; }
    .part-divider h1 { font-family: ${typefaceCss(typography.display)}; font-size: ${typography.scale.part_title}pt; color: inherit; }
    .callout { border-radius: 10px; padding: 14px 16px; margin: 12px 0; background: ${colors.surface.tint}; }
    .callout.warning { background: color-mix(in srgb, ${colors.semantic.caution} 12%, ${colors.surface.page}); }
    .callout.recommendation { background: color-mix(in srgb, ${colors.primary} 10%, ${colors.surface.page}); }
    .callout-label { font-size: ${typography.scale.small}pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: ${colors.text.muted}; margin-bottom: 4px; }
    .exhibit { margin: 16px 0; page-break-inside: avoid; }
    .exhibit-title { font-family: ${typefaceCss(typography.heading)}; font-weight: 600; font-size: ${typography.scale.h3}pt; color: ${colors.text.heading}; margin-bottom: 6px; }
    .exhibit-so-what { font-size: ${typography.scale.small}pt; font-style: italic; color: ${colors.text.muted}; margin-top: 6px; }
    .exhibit-sources { font-size: ${typography.scale.caption}pt; color: ${colors.text.muted}; margin-top: 2px; }
    table.ir-table { border-collapse: collapse; width: 100%; font-size: ${typography.scale.body}pt; }
    table.ir-table th, table.ir-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid ${colors.surface.hairline}; }
    table.ir-table thead th { background: ${layout.table_style === 'dark_header_zebra' ? colors.surface.dark : colors.surface.tint}; color: ${layout.table_style === 'dark_header_zebra' ? colors.text.on_dark : colors.text.heading}; }
    table.ir-table tbody tr:nth-child(even) { background: ${layout.table_style === 'dark_header_zebra' ? colors.surface.tint : 'transparent'}; }
    blockquote.ir-quote { border-left: 3px solid ${colors.primary}; margin: 16px 0; padding: 4px 16px; font-style: italic; color: ${colors.text.heading}; }
    .ir-quote cite { display: block; margin-top: 6px; font-style: normal; font-size: ${typography.scale.small}pt; color: ${colors.text.muted}; }
    .generated-note { font-size: ${typography.scale.caption}pt; color: ${colors.text.muted}; }
    .sources, .assumptions { font-size: ${typography.scale.small}pt; color: ${colors.text.body}; page-break-before: always; }
    .toc-entry { display: flex; justify-content: space-between; border-bottom: 1px dotted ${colors.surface.hairline}; padding: 4px 0; font-size: ${typography.scale.body}pt; }
  `;
}

function citationMarkers(sourceIds, assumptionIds, sourceIndexById, assumptionIndexById) {
  const marks = [
    ...(sourceIds ?? []).map((id) => sourceIndexById.get(id)).filter(Boolean).map((n) => `S${n}`),
    ...(assumptionIds ?? []).map((id) => assumptionIndexById.get(id)).filter(Boolean).map((n) => `A${n}`),
  ];
  return marks.length ? `<sup>[${marks.join(', ')}]</sup>` : '';
}

function renderList(block, ctx) {
  const tag = block.style === 'numbered' ? 'ol' : 'ul';
  const items = (block.items ?? [])
    .map(
      (item) =>
        `<li>${item.label ? `<strong>${escapeXml(item.label)}: </strong>` : ''}${escapeXml(item.text)}${citationMarkers(item.source_ids, null, ctx.sourceIndexById, ctx.assumptionIndexById)}</li>`,
    )
    .join('');
  return `<${tag}>${items}</${tag}>`;
}

function renderTableBlock(table, tokens) {
  const head = `<thead><tr>${table.columns.map((c) => `<th style="text-align:${c.align ?? 'left'}">${escapeXml(c.header)}</th>`).join('')}</tr></thead>`;
  const body = table.rows
    .map((row) => `<tr>${row.map((cell, i) => `<td style="text-align:${table.columns[i]?.align ?? 'left'}">${escapeXml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="ir-table">${head}<tbody>${body}</tbody></table>`;
}

function renderQuote(content) {
  assertQuoteConsent(content);
  return `<blockquote class="ir-quote">"${escapeXml(content.text)}"${
    content.attribution ? `<cite>— ${escapeXml(content.attribution)}${content.role ? `, ${escapeXml(content.role)}` : ''}</cite>` : ''
  }</blockquote>`;
}

function renderImage(content, ctx) {
  const asset = ctx.imageAssets.get(content.asset_id);
  if (!asset) throw new Error(`Image block references asset_id "${content.asset_id}" which was not resolved for this tenant.`);
  const widthPct = { full: 100, half: 50, third: 33 }[content.width ?? 'full'];
  const isGenerated = content.origin === 'generated';
  const caption = [content.caption, isGenerated ? 'AI-generated image' : null].filter(Boolean).join(' — ');
  return `
    <div style="width:${widthPct}%; margin: 0 auto;">
      <img src="${asset.dataUri}" alt="${escapeXml(content.alt ?? '')}" style="width:100%; display:block; border-radius:8px;" />
      ${caption ? `<p class="generated-note">${escapeXml(caption)}</p>` : ''}
    </div>
  `;
}

function renderExhibitContent(content, tokens, ctx) {
  if (content.kind === 'table') return renderTableBlock(content, tokens);
  if (content.kind === 'quote') return renderQuote(content);
  if (content.kind === 'image') return renderImage(content, ctx);
  if (SVG_EXHIBIT_KINDS.has(content.kind)) {
    return renderExhibitToSvg(content, tokens, { width: ctx.contentWidthPx });
  }
  throw new Error(`No HTML renderer for exhibit content kind "${content.kind}".`);
}

function renderExhibit(block, tokens, ctx) {
  const sourceMarks = citationMarkers(block.source_ids, block.assumption_ids, ctx.sourceIndexById, ctx.assumptionIndexById);
  return `
    <div class="exhibit">
      <div class="exhibit-title">${block.exhibit_number ? `Exhibit ${escapeXml(block.exhibit_number)}: ` : ''}${escapeXml(block.action_title)}${sourceMarks}</div>
      ${renderExhibitContent(block.content, tokens, ctx)}
      ${block.so_what ? `<div class="exhibit-so-what">So what: ${escapeXml(block.so_what)}</div>` : ''}
    </div>
  `;
}

function renderBlock(block, tokens, ctx) {
  switch (block.type) {
    case 'cover':
      return `
        <div class="cover">
          <div>${ctx.logoDataUri ? `<img src="${ctx.logoDataUri}" alt="" style="max-height:32px;" />` : ''}</div>
          <div>
            ${block.kicker ? `<p class="kicker">${escapeXml(block.kicker)}</p>` : ''}
            <h1>${escapeXml(block.title ?? '')}${block.emphasis_word ? ` <span style="color:${tokens.colors.primary}">${escapeXml(block.emphasis_word)}</span>` : ''}</h1>
            ${block.subtitle ? `<p>${escapeXml(block.subtitle)}</p>` : ''}
          </div>
          <p>${escapeXml(block.footer ?? '')}</p>
        </div>
      `;
    case 'toc':
      return `<div class="toc"><h2>Contents</h2>${ctx.tocEntries.map((e) => `<div class="toc-entry"><span>${escapeXml(e)}</span></div>`).join('')}</div>`;
    case 'part_divider':
      return `<div class="part-divider">${block.part_label ? `<p class="kicker">${escapeXml(block.part_label)}</p>` : ''}<h1>${escapeXml(block.title)}</h1>${block.blurb ? `<p>${escapeXml(block.blurb)}</p>` : ''}</div>`;
    case 'heading': {
      const tag = `h${Math.min(3, Math.max(1, block.level))}`;
      return `<${tag}>${block.number ? `${escapeXml(block.number)} ` : ''}${escapeXml(block.text)}</${tag}>`;
    }
    case 'paragraph': {
      const style = block.emphasis === 'lead' ? `font-size:${tokens.typography.scale.body * 1.2}pt;` : block.emphasis === 'small' ? `font-size:${tokens.typography.scale.small}pt;` : '';
      return `<p style="${style}">${escapeXml(block.text)}${citationMarkers(block.source_ids, block.assumption_ids, ctx.sourceIndexById, ctx.assumptionIndexById)}</p>`;
    }
    case 'list':
      return renderList(block, ctx);
    case 'callout':
      return `<div class="callout ${block.variant ?? 'key_takeaway'}">${block.label ? `<div class="callout-label">${escapeXml(block.label)}</div>` : ''}${(block.body ?? []).map((b) => `<p>${escapeXml(b)}</p>`).join('')}</div>`;
    case 'exhibit':
      return renderExhibit(block, tokens, ctx);
    case 'page_break':
      return `<div style="page-break-after: always;"></div>`;
    case 'spacer':
      return `<div style="height: ${{ s: 8, m: 16, l: 32 }[block.size ?? 'm']}px;"></div>`;
    default:
      throw new Error(`No HTML renderer for block type "${block.type}".`);
  }
}

function renderSourcesAndAssumptions(ir, sourceIndexById, assumptionIndexById) {
  const sources = ir.sources?.length
    ? `<div class="sources"><h2>Sources</h2><ol>${ir.sources.map((s) => `<li id="src-${sourceIndexById.get(s.id)}">${escapeXml(s.title)}${s.publisher ? `, ${escapeXml(s.publisher)}` : ''}${s.published ? ` (${escapeXml(s.published)})` : ''} — accessed ${escapeXml(s.accessed)}${s.url ? `. <span style="word-break:break-all;">${escapeXml(s.url)}</span>` : ''}</li>`).join('')}</ol></div>`
    : '';
  const assumptions = ir.assumptions?.length
    ? `<div class="assumptions"><h2>Assumptions register</h2><ol>${ir.assumptions.map((a) => `<li id="asm-${assumptionIndexById.get(a.id)}"><strong>${escapeXml(a.statement)}</strong><br/>Basis: ${escapeXml(a.basis)}<br/>Sensitivity: ${escapeXml(a.sensitivity)}</li>`).join('')}</ol></div>`
    : '';
  return sources + assumptions;
}

/**
 * @param {object} ir  Document IR (document-ir.schema.json)
 * @param {object} tokens  resolveTokens() output
 * @param {object} ctx
 * @param {Map<string,{dataUri:string}>} ctx.imageAssets  every image block's asset_id resolved to a data URI up front
 * @param {string} [ctx.logoDataUri]
 * @param {string} [ctx.fontFaceCss]  from render/fonts.js
 */
export function buildHtmlDocument(ir, tokens, ctx = {}) {
  const sourceIndexById = new Map((ir.sources ?? []).map((s, i) => [s.id, i + 1]));
  const assumptionIndexById = new Map((ir.assumptions ?? []).map((a, i) => [a.id, i + 1]));
  const tocEntries = ir.blocks.filter((b) => b.type === 'heading' && b.level === 1).map((b) => b.text);
  const contentWidthPx = 640;

  const blockCtx = { sourceIndexById, assumptionIndexById, tocEntries, imageAssets: ctx.imageAssets ?? new Map(), logoDataUri: ctx.logoDataUri, contentWidthPx };
  const bodyHtml = ir.blocks.map((block) => renderBlock(block, tokens, blockCtx)).join('\n');
  const backMatter = renderSourcesAndAssumptions(ir, sourceIndexById, assumptionIndexById);

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeXml(ir.meta?.title ?? 'Document')}</title>
<style>${ctx.fontFaceCss ?? ''}${documentStyles(tokens)}</style>
</head><body>
<div class="content" style="padding: 0 8px;">${bodyHtml}</div>
${backMatter}
</body></html>`;
}
