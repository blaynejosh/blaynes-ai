import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, resolveTokens } from '../server/brandKit/tokens.js';

test('contrastRatio of black on white is the textbook 21:1', () => {
  assert.ok(Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 0.01);
});

test('contrastRatio is symmetric regardless of argument order', () => {
  assert.ok(Math.abs(contrastRatio('#1A73E8', '#FFFFFF') - contrastRatio('#FFFFFF', '#1A73E8')) < 0.001);
});

test('resolveTokens fills every gap in an empty kit with a named default', () => {
  const resolved = resolveTokens({});
  assert.equal(resolved.colors.surface.page, '#FFFFFF');
  assert.equal(resolved.typography.body.family, 'Inter');
  assert.equal(resolved.layout.page_size, 'A4');
  assert.equal(resolved.colors.chart_categorical_is_fallback, true);
});

test('resolveTokens never overrides a value the kit actually sets', () => {
  const resolved = resolveTokens({
    colors: { primary: { hex: '#1A73E8' }, surface: { page: { hex: '#FAFAF8' } } },
    typography: { body: { family: 'Georgia' } },
  });
  assert.equal(resolved.colors.primary, '#1A73E8');
  assert.equal(resolved.colors.surface.page, '#FAFAF8');
  assert.equal(resolved.typography.body.family, 'Georgia');
});

test('resolveTokens flags a low-contrast text/background pairing instead of silently swapping it', () => {
  const resolved = resolveTokens({
    colors: { text: { body: { hex: '#CCCCCC' } }, surface: { page: { hex: '#FFFFFF' } } },
  });
  // Not silently corrected — the tenant's actual (bad) colour is preserved...
  assert.equal(resolved.colors.text.body, '#CCCCCC');
  // ...but flagged so a human catches it before it ships.
  assert.ok(resolved.warnings.some((w) => w.type === 'contrast' && w.message.includes('body text on page')));
});

test('resolveTokens does not warn when a real chart_categorical palette is set', () => {
  const resolved = resolveTokens({
    colors: { chart_categorical: [{ hex: '#2563EB' }, { hex: '#DC2626' }, { hex: '#059669' }] },
  });
  assert.equal(resolved.colors.chart_categorical_is_fallback, false);
  assert.equal(resolved.warnings.some((w) => w.type === 'chart_palette_fallback'), false);
});
