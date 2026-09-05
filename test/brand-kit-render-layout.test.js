import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureText, wrapText, truncateToWidth, escapeXml } from '../server/brandKit/render/layout.js';

const FONT = { sizePx: 16, family: 'sans-serif' };

test('measureText returns a positive width that grows with text length', () => {
  const short = measureText('Hi', FONT);
  const long = measureText('This is a much longer sentence', FONT);
  assert.ok(short > 0);
  assert.ok(long > short);
});

test('wrapText keeps a short string on one line', () => {
  const lines = wrapText('Short label', 400, FONT);
  assert.equal(lines.length, 1);
});

test('wrapText breaks a long string across multiple lines that each fit the width', () => {
  const text = 'Regulatory cost rises forty percent by the third quarter of the fiscal year';
  const maxWidth = 150;
  const lines = wrapText(text, maxWidth, FONT);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(measureText(line, FONT) <= maxWidth + 1); // +1 for float rounding
  }
  // No words lost in the wrap.
  assert.equal(lines.join(' '), text);
});

test('wrapText never drops a single word wider than maxWidth into an infinite loop', () => {
  const lines = wrapText('Supercalifragilisticexpialidocious', 10, FONT);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'Supercalifragilisticexpialidocious');
});

test('truncateToWidth leaves short text untouched', () => {
  assert.equal(truncateToWidth('Short', 400, FONT), 'Short');
});

test('truncateToWidth shortens long text and appends an ellipsis that still fits', () => {
  const result = truncateToWidth('A genuinely very long axis label that will not fit', 100, FONT);
  assert.ok(result.endsWith('…'));
  assert.ok(measureText(result, FONT) <= 100 + 1);
});

test('escapeXml neutralizes every reserved character', () => {
  assert.equal(escapeXml(`<script>alert('x') & "y"</script>`), '&lt;script&gt;alert(&apos;x&apos;) &amp; &quot;y&quot;&lt;/script&gt;');
});

test('escapeXml handles non-string input without throwing', () => {
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(42), '42');
});
