import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSvgIcon, analyzeRasterIcon } from '../server/brandKit/extractors/icon.js';

test('analyzeSvgIcon reads viewBox and stroke weight from a line icon', () => {
  const svg = `<svg viewBox="0 0 24 24"><path stroke="#000" stroke-width="1.5" fill="none" d="M1 1L2 2"/></svg>`;
  const result = analyzeSvgIcon(svg);
  assert.deepEqual(result.view_box, { minX: 0, minY: 0, width: 24, height: 24 });
  assert.equal(result.stroke_weight, 1.5);
  assert.equal(result.style, 'line');
});

test('analyzeSvgIcon classifies a filled icon as solid', () => {
  const svg = `<svg viewBox="0 0 24 24"><path fill="#000" d="M1 1L2 2Z"/></svg>`;
  const result = analyzeSvgIcon(svg);
  assert.equal(result.style, 'solid');
});

test('analyzeSvgIcon classifies fill+stroke together as mixed', () => {
  const svg = `<svg viewBox="0 0 24 24"><path fill="#000" stroke="#fff" stroke-width="2" d="M1 1L2 2Z"/></svg>`;
  const result = analyzeSvgIcon(svg);
  assert.equal(result.style, 'mixed');
});

test('analyzeSvgIcon does not treat stroke="none"/fill="none" as present', () => {
  const svg = `<svg viewBox="0 0 24 24"><path fill="none" stroke="none" d="M1 1L2 2Z"/></svg>`;
  const result = analyzeSvgIcon(svg);
  assert.equal(result.style, 'unknown');
});

test('analyzeSvgIcon copes with a missing viewBox', () => {
  const result = analyzeSvgIcon('<svg><path fill="#000" d="M0 0Z"/></svg>');
  assert.equal(result.view_box, null);
});

test('analyzeRasterIcon flags itself as not normalized to SVG', () => {
  const result = analyzeRasterIcon({ format: 'png', width: 64, height: 64 });
  assert.equal(result.normalized_to_svg, false);
  assert.equal(result.width_px, 64);
});
