/**
 * The one model call in the Document Engine's generation pipeline (Phase 4)
 * — this feature's counterpart to extraction/extractKit.js. Takes a brief
 * (whatever the client and Blayne worked out in chat, or a caller supplied
 * directly) plus the org's active Brand Kit's voice/identity fields, and
 * asks the model to write the *entire* document as one Document IR
 * (document-ir.schema.json) via a forced tool call — never free text, so
 * there's no prose-to-IR parsing step to get wrong.
 *
 * Unlike extraction's propose_brand_kit_fields (a flat list of small,
 * independently-droppable proposals), a Document IR is one large,
 * deeply-nested oneOf/$ref structure with no safe partial-acceptance path —
 * a hallucinated field can't just be dropped the way a bad colour proposal
 * can. So instead of applyProposals()'s "validate and discard", this module
 * validates and *retries*: a response that fails validateDocumentIr() gets
 * its exact ajv errors fed back as a tool_result, and the model is asked to
 * call the tool again with a corrected, complete document.
 *
 * input_schema is the actual document-ir.schema.json contract, reused
 * directly rather than hand-duplicated — the render pipeline and this
 * assembly step must never drift out of sync on what a valid IR looks like.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeClient, MODEL } from '../../claudeClient.js';
import { validateDocumentIr } from '../schema.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const irSchema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'document-ir.schema.json'), 'utf-8'));
// $schema/$id/title/description describe the *file* to a schema tool, not
// the tool call's arguments — everything else (type/required/properties/
// $defs) is exactly what emit_document_ir's input_schema should be.
const { $schema, $id, title, description, ...IR_INPUT_SCHEMA } = irSchema;

/** The exact set of documents this pipeline can produce — read from the
 * schema itself so routes.js/the chat tool's validation can never drift
 * from what meta.doc_type actually allows. */
export const DOC_TYPES = irSchema.properties.meta.properties.doc_type.enum;

/** Bounds retries on a genuinely broken generation, not normal usage — a
 * well-formed brief against a real Brand Kit should validate on the first
 * or second attempt. */
const MAX_ATTEMPTS = 3;

/** Exported for testing — asserts the tool's input_schema stays exactly
 * document-ir.schema.json's own shape, never a hand-duplicated copy that
 * could drift from it. */
export const EMIT_IR_TOOL = {
  name: 'emit_document_ir',
  description:
    'Emit the complete document as a single Document IR — the only output of this call. Call it exactly once, with the whole document already fully written: cover, every section and paragraph, every exhibit with real data, every citation and assumption. Never emit prose outside this tool call, and never call it more than once per turn.',
  input_schema: IR_INPUT_SCHEMA,
};

/** Exported for testing — pure string-building, no model or I/O involved. */
export function buildSystemPrompt(brandKit) {
  const voice = brandKit?.voice ?? {};
  const identity = brandKit?.identity ?? {};

  const voiceLines = [];
  if (voice.tone?.length) voiceLines.push(`- Tone: ${voice.tone.join(', ')}`);
  if (voice.person) voiceLines.push(`- Person: ${voice.person.replace('_', ' ')}`);
  if (voice.spelling) voiceLines.push(`- Spelling: ${voice.spelling}`);
  if (voice.reading_level) voiceLines.push(`- Reading level: ${voice.reading_level}`);
  if (voice.banned_words?.length) voiceLines.push(`- Never use these words/phrases: ${voice.banned_words.join(', ')}`);
  if (voice.banned_punctuation?.length) voiceLines.push(`- Never use: ${voice.banned_punctuation.join(', ')}`);
  if (voice.required_phrases?.length) voiceLines.push(`- Work these phrases in naturally where relevant: ${voice.required_phrases.join(', ')}`);

  return `You are Blayne's Consulting's Document Engine, writing a real, client-ready deliverable — not a summary or an outline. The renderer that turns your output into a .docx/.pdf owns every visual decision (colours, fonts, layout); you supply structure and content only, as a single Document IR.

Writing standards, non-negotiable:
- meta.governing_thought is the single sentence the whole document exists to support. Write the document to prove it, not to survey the topic.
- Every level-1/level-2 heading in an analytical document is an action title — a finding, not a topic label ("Regulatory cost will rise 40% by Q3", never "Regulatory environment").
- Every exhibit's action_title states what it proves, not what it shows, and every exhibit needs a so_what.
- Cite a real source_id (added to the top-level "sources" array) for every claim that could be sourced, and a real assumption_id (added to "assumptions") for every modelled or estimated number. Never fabricate a source — if you don't have one, mark the figure as an assumption or an estimate (chart.is_estimate: true) instead of inventing a citation.
- Do not use an "image" exhibit — no image assets are available to this generation job. Use table/kpi_row/card_grid/chart/process_flow/timeline/roadmap/matrix_2x2/comparison_matrix/decision_tree/org_chart/journey_map instead, whichever actually fits the point being made.
- Do not use an attributed "quote" exhibit (a named real person's words) — there is no consent-recording step in this pipeline yet, and the renderer refuses to render one without it.
- Write the whole document now, completely, in this one call. Do not leave placeholders like "[insert data here]" or "TBD" — if a real figure isn't available, say so in prose or mark it as an explicit assumption instead of faking specificity.
${identity.legal_name ? `\nThe client organization is "${identity.legal_name}"${identity.about ? ` — ${identity.about}` : ''}. Use this as meta.prepared_by / meta.prepared_for context as appropriate; do not invent other facts about the organization beyond what you're told in the brief.` : ''}
${voiceLines.length ? `\nHouse voice for this organization:\n${voiceLines.join('\n')}` : ''}

Call emit_document_ir exactly once, with the complete document.`;
}

function buildBriefContent({ docType, title, format, brief }) {
  return `Write a "${docType}" document titled "${title}", to be rendered as a ${format === 'docx' ? 'Word document' : 'PDF'}.

Brief (from the conversation with the client):
${brief}`;
}

/** Turns a validateDocumentIr() failure into the next turn's correction
 * request — exact ajv errors, not a vague "try again", so the retry fixes
 * the actual problem instead of guessing. */
function buildRepairMessage(toolUseId, validationError) {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        is_error: true,
        content: `That document did not pass schema validation: ${validationError.message}\n\nCall emit_document_ir again with the complete, corrected document — fix what's wrong, keep everything else that was already right.`,
      },
    ],
  };
}

/**
 * @param {object} opts
 * @param {object} opts.brandKit  The org's active brand_kits row's kit_json — voice/identity only; colours/fonts never reach the model (see document-ir.schema.json's top-level description).
 * @param {string} opts.docType  One of meta.doc_type's enum values.
 * @param {string} opts.title
 * @param {'pdf'|'docx'} opts.format
 * @param {string} opts.brief  Free text: audience, scope, decision this document supports, and any facts already established in conversation.
 * @returns {Promise<object>} A Document IR that has already passed validateDocumentIr().
 */
export async function assembleDocumentIr({ brandKit, docType, title, format, brief }) {
  const system = buildSystemPrompt(brandKit);
  const messages = [{ role: 'user', content: buildBriefContent({ docType, title, format, brief }) }];

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await claudeClient.messages.create({
      model: MODEL,
      max_tokens: 32000,
      system,
      tools: [EMIT_IR_TOOL],
      tool_choice: { type: 'tool', name: 'emit_document_ir' },
      messages,
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'emit_document_ir');
    if (!toolUse) {
      lastError = new Error('The model did not call emit_document_ir.');
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: 'Call emit_document_ir now, with the complete document.' });
      continue;
    }

    try {
      validateDocumentIr(toolUse.input);
      return toolUse.input;
    } catch (err) {
      lastError = err;
      messages.push({ role: 'assistant', content: response.content });
      messages.push(buildRepairMessage(toolUse.id, err));
    }
  }

  throw new Error(`Document IR assembly failed after ${MAX_ATTEMPTS} attempt(s): ${lastError?.message}`);
}
