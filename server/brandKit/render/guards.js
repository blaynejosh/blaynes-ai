/**
 * Hard, format-independent rendering gates — checked by both html.js and
 * docx.js (defense in depth: neither format's assembler trusts that the
 * other already checked), and again up front by render/index.js's
 * orchestrator so a bad IR fails fast, before any Playwright/docx-js work
 * happens at all.
 */

/** "The IR blocks rendering of a named attributed quote without it." */
export function assertQuoteConsent(content) {
  if (content.attribution && !content.consent_recorded) {
    throw new Error(
      `Refusing to render an attributed quote from "${content.attribution}" with no recorded consent — see quote.consent_recorded in document-ir.schema.json.`,
    );
  }
}

/** Walks every block/exhibit in the IR and runs every hard gate once,
 * before either format adapter starts real work. */
export function validateIrForRendering(ir) {
  for (const block of ir.blocks ?? []) {
    if (block.type === 'exhibit' && block.content?.kind === 'quote') {
      assertQuoteConsent(block.content);
    }
  }
}
