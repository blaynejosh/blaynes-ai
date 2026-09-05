import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHexFromText, parseAse, extractDominantColors } from '../server/brandKit/extractors/color.js';
import sharp from 'sharp';

test('extractHexFromText finds and normalizes 3- and 6-digit hex', () => {
  const found = extractHexFromText('Primary is #1A73E8, secondary #f60, ignore #zzzzzz');
  const hexes = found.map((f) => f.hex);
  assert.ok(hexes.includes('#1A73E8'));
  assert.ok(hexes.includes('#FF6600'));
  assert.equal(hexes.filter((h) => h === '#zzzzzz'.toUpperCase()).length, 0);
});

test('extractHexFromText de-duplicates repeated colours', () => {
  const found = extractHexFromText('#1A73E8 appears twice: #1a73e8');
  assert.equal(found.length, 1);
});

test('every extracted colour is method extracted_deterministic', () => {
  const found = extractHexFromText('#111111');
  assert.equal(found[0].method, 'extracted_deterministic');
});

// --- .ase (Adobe Swatch Exchange) -------------------------------------------

/** Builds a minimal, spec-correct .ase buffer with one RGB and one Gray
 * colour entry, so parseAse() can be tested without a real fixture file. */
function buildAse(entries) {
  const nameBuf = (name) => {
    const utf16be = Buffer.alloc((name.length + 1) * 2);
    for (let i = 0; i < name.length; i += 1) utf16be.writeUInt16BE(name.charCodeAt(i), i * 2);
    // null terminator already zero from Buffer.alloc
    return utf16be;
  };

  const blocks = entries.map(({ name, model, values }) => {
    const nameBytes = nameBuf(name);
    const modelBytes = Buffer.from(model.padEnd(4, ' '), 'ascii');
    const valueBytes = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => valueBytes.writeFloatBE(v, i * 4));
    const colorTypeBytes = Buffer.from([0x00, 0x00]);

    const nameLenBytes = Buffer.alloc(2);
    nameLenBytes.writeUInt16BE(name.length + 1, 0);

    const data = Buffer.concat([nameLenBytes, nameBytes, modelBytes, valueBytes, colorTypeBytes]);
    const header = Buffer.alloc(6);
    header.writeUInt16BE(0x0001, 0); // color entry
    header.writeUInt32BE(data.length, 2);
    return Buffer.concat([header, data]);
  });

  const header = Buffer.alloc(12);
  header.write('ASEF', 0, 'ascii');
  header.writeUInt16BE(1, 4); // major version
  header.writeUInt16BE(0, 6); // minor version
  header.writeUInt32BE(entries.length, 8);

  return Buffer.concat([header, ...blocks]);
}

test('parseAse reads an RGB entry back as the expected hex', () => {
  const buf = buildAse([{ name: 'Brand Blue', model: 'RGB', values: [26 / 255, 115 / 255, 232 / 255] }]);
  const colors = parseAse(buf);
  assert.equal(colors.length, 1);
  assert.equal(colors[0].hex, '#1A73E8');
  assert.equal(colors[0].name, 'Brand Blue');
  assert.equal(colors[0].method, 'extracted_deterministic');
});

test('parseAse reads a Gray entry as a neutral hex', () => {
  const buf = buildAse([{ name: 'Mid Gray', model: 'Gray', values: [0.5] }]);
  const colors = parseAse(buf);
  assert.equal(colors[0].hex, '#808080');
});

test('parseAse rejects a file with a bad signature', () => {
  assert.throws(() => parseAse(Buffer.from('not an ase file at all')), /ASEF/);
});

// --- swatch image dominant-colour sampling ---------------------------------

test('extractDominantColors finds a solid colour fill', async () => {
  const png = await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 26, g: 115, b: 232 } },
  })
    .png()
    .toBuffer();

  const colors = await extractDominantColors(png);
  assert.equal(colors.length, 1);
  assert.equal(colors[0].hex, '#1A73E8');
});

test('extractDominantColors separates two clearly distinct swatches', async () => {
  const left = await sharp({ create: { width: 20, height: 40, channels: 3, background: { r: 26, g: 115, b: 232 } } }).png().toBuffer();
  const right = await sharp({ create: { width: 20, height: 40, channels: 3, background: { r: 255, g: 107, b: 0 } } }).png().toBuffer();
  const composite = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: 20, top: 0 }])
    .png()
    .toBuffer();

  const colors = await extractDominantColors(composite);
  const hexes = colors.map((c) => c.hex);
  assert.ok(hexes.includes('#1A73E8'));
  assert.ok(hexes.includes('#FF6B00'));
});
