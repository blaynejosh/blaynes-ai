import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFontMetadata, convertToRenderableFormat } from '../server/brandKit/extractors/font.js';

/**
 * A real TTF fixture without adding a font file to the repo: pdfjs-dist (a
 * transitive dependency of pdf-parse, itself a direct dependency here)
 * ships Liberation Sans as its standard-fonts fallback — a stable,
 * npm-installed binary every `npm ci` already produces, so this test needs
 * no fixture file of its own and no network access. If a future pdfjs-dist
 * restructure moves this path, the test skips instead of failing CI on an
 * unrelated dependency change.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Regular.ttf');
const hasFixture = fs.existsSync(fixturePath);

test('extractFontMetadata reads the real internal family name, not a filename', { skip: !hasFixture }, () => {
  const buffer = fs.readFileSync(fixturePath);
  const meta = extractFontMetadata(buffer, 'totally-different-filename.ttf');
  assert.equal(meta.internal_family_name, 'Liberation Sans');
  assert.equal(meta.format, 'ttf');
  assert.equal(meta.method, 'extracted_deterministic');
});

test('extractFontMetadata reports OS/2 fsType when the table is present', { skip: !hasFixture }, () => {
  const buffer = fs.readFileSync(fixturePath);
  const meta = extractFontMetadata(buffer, 'font.ttf');
  assert.equal(meta.os2_table_present, true);
  assert.equal(typeof meta.fs_type.no_embedding, 'boolean');
});

test('convertToRenderableFormat is a no-op for an already-TTF file', { skip: !hasFixture }, async () => {
  const buffer = fs.readFileSync(fixturePath);
  const converted = await convertToRenderableFormat(buffer, 'font.ttf');
  assert.equal(converted, null);
});

test('convertToRenderableFormat turns a WOFF2 file into a real, re-readable TTF', { skip: !hasFixture }, async () => {
  const { createFont, woff2 } = await import('fonteditor-core');
  await woff2.init();

  const ttfBuffer = fs.readFileSync(fixturePath);
  const font = createFont(ttfBuffer, { type: 'ttf' });
  const woff2Buffer = font.write({ type: 'woff2' });

  const converted = await convertToRenderableFormat(woff2Buffer, 'font.woff2');
  assert.ok(converted);
  assert.equal(converted.format, 'ttf');

  // The converted bytes must themselves be a readable font with the same
  // family name — round-tripping through the conversion shouldn't lose the
  // one piece of metadata the whole pipeline exists to preserve.
  const metaAfter = extractFontMetadata(converted.buffer, 'font.ttf');
  assert.equal(metaAfter.internal_family_name, 'Liberation Sans');
});
