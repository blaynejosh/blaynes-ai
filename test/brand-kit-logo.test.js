import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { analyzeLogo, deriveWhiteVariantFromSvg } from '../server/brandKit/extractors/logo.js';

test('analyzeLogo calls a dark solid fill "dark"', async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
  const result = await analyzeLogo(png);
  assert.equal(result.tone, 'dark');
  assert.equal(result.width_px, 100);
  assert.equal(result.height_px, 100);
});

test('analyzeLogo calls a light solid fill "light"', async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 250, g: 250, b: 250 } } }).png().toBuffer();
  const result = await analyzeLogo(png);
  assert.equal(result.tone, 'light');
});

test('analyzeLogo detects transparency', async () => {
  const png = await sharp({
    create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const result = await analyzeLogo(png);
  assert.equal(result.has_transparency, true);
});

test('analyzeLogo detects an opaque image as having no transparency', async () => {
  const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const result = await analyzeLogo(png);
  assert.equal(result.has_transparency, false);
});

test('deriveWhiteVariantFromSvg rewrites a single-colour mark to white', () => {
  const svg = `<svg><path fill="#1A73E8" d="M0 0Z"/><circle stroke="#1A73E8" cx="1" cy="1" r="1"/></svg>`;
  const white = deriveWhiteVariantFromSvg(svg);
  assert.ok(white);
  assert.doesNotMatch(white, /#1A73E8/i);
  assert.match(white, /#ffffff/i);
});

test('deriveWhiteVariantFromSvg refuses a multi-colour mark', () => {
  const svg = `<svg><path fill="#1A73E8" d="M0 0Z"/><path fill="#FF6B00" d="M1 1Z"/></svg>`;
  assert.equal(deriveWhiteVariantFromSvg(svg), null);
});

test('deriveWhiteVariantFromSvg refuses a mark with no colour references at all', () => {
  assert.equal(deriveWhiteVariantFromSvg('<svg><path d="M0 0Z"/></svg>'), null);
});
