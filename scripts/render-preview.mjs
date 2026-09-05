/**
 * Renders a Document IR against a Brand Kit entirely locally — no
 * Supabase, no GCS, no Vertex — for exercising server/brandKit/render/
 * during development, and as the same code path a future Cloud Run Job
 * entrypoint would call once Phase 4's real pipeline exists.
 *
 *   node scripts/render-preview.mjs <ir.json> <brandKit.json> <out.pdf|out.docx>
 *
 * brandKit.json is a kit_json object (brand-kit.schema.json shape) — the
 * script doesn't care whether it came from a real 'active' row. Passing no
 * assets means a logo or image exhibit that references a real asset_id
 * simply won't resolve (render/index.js skips what it can't find rather
 * than trying to reach GCS for it) — fine for exercising text/table/chart
 * content, not a way to preview a real tenant's logo without real storage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderDocument } from '../server/brandKit/render/index.js';

const [, , irPath, kitPath, outPath] = process.argv;

if (!irPath || !kitPath || !outPath) {
  console.error('Usage: node scripts/render-preview.mjs <ir.json> <brandKit.json> <out.pdf|out.docx>');
  process.exit(1);
}

const ir = JSON.parse(fs.readFileSync(irPath, 'utf-8'));
const brandKit = JSON.parse(fs.readFileSync(kitPath, 'utf-8'));
const format = path.extname(outPath).slice(1) === 'docx' ? 'docx' : 'pdf';

const { buffer, warnings } = await renderDocument({ ir, brandKit, assets: [], format });
fs.writeFileSync(outPath, buffer);

console.log(`Wrote ${outPath} (${buffer.length} bytes, format=${format})`);
if (warnings.length) {
  console.warn('Render warnings:');
  for (const w of warnings) console.warn(`  - ${w}`);
}
