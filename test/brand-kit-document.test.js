import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { extractPdf, extractDocx, extractPptx } from '../server/brandKit/extractors/document.js';

/** Builds a minimal, valid multi-page PDF by hand — one Helvetica text run
 * per page — so extractPdf() can be tested without a binary fixture file. */
function buildPdf(pageTexts) {
  const escape = (s) => s.replace(/[()\\]/g, (c) => `\\${c}`);
  const objs = [];
  objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const pageObjNums = pageTexts.map((_, i) => 3 + i * 2);
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(' ');
  objs.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>\nendobj\n`);

  pageTexts.forEach((text, i) => {
    const pageNum = pageObjNums[i];
    const contentNum = pageNum + 1;
    objs.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${2 + pageObjNums.length * 0 + 1} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentNum} 0 R >>\nendobj\n`,
    );
    const content = `BT /F1 24 Tf 72 700 Td (${escape(text)}) Tj ET`;
    objs.push(`${contentNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const fontObjNum = pageObjNums[pageObjNums.length - 1] + 2;
  objs.push(`${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  // Every page references font object 1-past-the-content-objects; fix the
  // font reference to the real object number now that it's known.
  for (let i = 0; i < objs.length; i += 1) {
    objs[i] = objs[i].replace(/\/F1 \d+ 0 R/, `/F1 ${fontObjNum} 0 R`);
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets.slice(1)) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'binary');
}

test('extractPdf reads per-page text from a two-page PDF', async () => {
  const buf = buildPdf(['Brand Guideline Cover', 'Colour Palette Page']);
  const result = await extractPdf(buf);
  assert.equal(result.pageCount, 2);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.match(result.pages[0].text, /Brand Guideline Cover/);
  assert.match(result.pages[1].text, /Colour Palette Page/);
});

test('extractPdf renders a page image for every page', async () => {
  const buf = buildPdf(['Only Page']);
  const result = await extractPdf(buf);
  assert.equal(result.pages[0].image !== null, true);
  assert.ok(result.pages[0].image.buffer.length > 0);
  assert.ok(result.pages[0].image.width > 0);
});

test('extractPdf reports fullText concatenated across pages', async () => {
  const buf = buildPdf(['First', 'Second']);
  const result = await extractPdf(buf);
  assert.match(result.fullText, /First/);
  assert.match(result.fullText, /Second/);
});

// --- docx --------------------------------------------------------------

function buildDocx(paragraphs) {
  const zip = new AdmZip();
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes));
  zip.addFile('_rels/.rels', Buffer.from(rootRels));
  zip.addFile('word/document.xml', Buffer.from(documentXml));
  return zip.toBuffer();
}

test('extractDocx pulls plain text out of a minimal .docx', async () => {
  const buf = buildDocx(['Our brand voice is confident and precise.', 'Primary colour: #1A73E8']);
  const result = await extractDocx(buf);
  assert.match(result.fullText, /confident and precise/);
  assert.match(result.fullText, /#1A73E8/);
});

// --- pptx ----------------------------------------------------------------

function buildPptx(slideTexts) {
  const zip = new AdmZip();
  slideTexts.forEach((texts, i) => {
    const runs = texts.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('');
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>${runs}</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;
    zip.addFile(`ppt/slides/slide${i + 1}.xml`, Buffer.from(slideXml));
  });
  return zip.toBuffer();
}

test('extractPptx reads per-slide text in slide order (numeric, not lexicographic)', async () => {
  const slides = Array.from({ length: 11 }, (_, i) => [`Slide number ${i + 1}`]);
  const buf = buildPptx(slides);
  const result = await extractPptx(buf);
  assert.equal(result.slideCount, 11);
  assert.equal(result.slides[1].slideNumber, 2);
  assert.match(result.slides[9].text, /Slide number 10/);
  assert.match(result.slides[10].text, /Slide number 11/);
});

test('extractPptx joins multiple text runs on one slide', async () => {
  const buf = buildPptx([['Corporate Profile', 'Founded 2015 in Lagos.']]);
  const result = await extractPptx(buf);
  assert.match(result.slides[0].text, /Corporate Profile/);
  assert.match(result.slides[0].text, /Founded 2015 in Lagos\./);
});
