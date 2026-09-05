/**
 * Compiles brand-kit.schema.json and document-ir.schema.json (repo root)
 * once, for both the Brand Kit intake pipeline (this file's immediate use)
 * and the Document Engine's IR assembly stage (Phase 4/5, not built yet —
 * validateDocumentIr is exported now so that stage has a ready-made,
 * already-tested entry point instead of a second ajv setup later).
 *
 * These two files are THE contract described in the brief — "the model
 * emits a structured document IR... document-ir.schema.json in the repo is
 * the contract" — so validation against them, not against some looser
 * hand-rolled check, is what a draft kit or an assembled IR must pass
 * before anything downstream (confirmation UI, renderer) trusts it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

function loadSchema(fileName) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, fileName), 'utf-8'));
}

const brandKitValidator = ajv.compile(loadSchema('brand-kit.schema.json'));
const documentIrValidator = ajv.compile(loadSchema('document-ir.schema.json'));

/** Throws with every validation error joined into one message, not just the first. */
function assertValid(validator, data, label) {
  if (validator(data)) return data;
  const detail = (validator.errors ?? [])
    .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
    .join('; ');
  throw new Error(`${label} failed schema validation: ${detail}`);
}

export function validateBrandKit(kit) {
  return assertValid(brandKitValidator, kit, 'Brand Kit');
}

export function validateDocumentIr(ir) {
  return assertValid(documentIrValidator, ir, 'Document IR');
}

/**
 * Non-throwing version, for a kit that's expected to be incomplete — a
 * fresh extraction draft, mid-review. Used by the confirmation UI to show
 * "still missing" against the schema itself rather than a hand-maintained
 * duplicate checklist, and by the confirm-to-active transition to refuse
 * with a precise reason instead of a generic ajv error dump.
 */
export function checkBrandKitCompleteness(kit) {
  const valid = brandKitValidator(kit);
  return {
    complete: valid,
    errors: valid ? [] : (brandKitValidator.errors ?? []).map((e) => ({ path: e.instancePath || '(root)', message: e.message })),
  };
}
