/**
 * Text and page-image extraction for brand guidelines, corporate profiles,
 * capability decks and past reports — "page-by-page parse, text plus
 * rendered page images... the colour and type rules are usually stated
 * visually, not written out, so vision matters here."
 *
 * PDF gets the full treatment (real per-page text AND real rendered page
 * images) via pdf-parse v2, which renders through pdfjs-dist + @napi-rs/canvas
 * — a pure-JS/native-addon path with prebuilt binaries for linux-musl
 * (Alpine), not a shell-out to poppler/pdftoppm. That was a real, deliberate
 * choice: it means this ingestion pipeline needs no new system package in
 * the container, unlike Phase 3's render path, which does need Chromium and
 * LibreOffice as real OS-level dependencies.
 *
 * DOCX and PPTX get text only in this phase, not page images. Rendering a
 * Word page or a slide to a faithful image needs a real layout engine
 * (LibreOffice, in practice) — that's the Phase 3 render container's
 * dependency, and standing up a second LibreOffice install just for
 * ingestion isn't worth it before that container exists. A tenant who wants
 * vision-based layout analysis of a docx/pptx guideline should export it to
 * PDF first; this is a real, temporary capability gap, not an oversight —
 * flagged here so it's a deliberate, revisitable decision.
 */
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

/** Hard cap so a single ingestion request can't hang on a 300-page PDF —
 * ingestion runs synchronously inside the upload request in this phase (see
 * the Phase 1 report), unlike full document generation, which is a job. */
const MAX_PDF_PAGES = Number(process.env.BRAND_KIT_MAX_PDF_PAGES ?? 60);

export async function extractPdf(buffer, { renderScale = 1.5 } = {}) {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const totalPages = info.total;
    const pagesToRender = Math.min(totalPages, MAX_PDF_PAGES);
    const partial = Array.from({ length: pagesToRender }, (_, i) => i + 1);

    const [textResult, screenshotResult] = await Promise.all([
      parser.getText({ partial }),
      parser.getScreenshot({ partial, scale: renderScale, imageDataUrl: false }),
    ]);

    const imageByPage = new Map(screenshotResult.pages.map((p) => [p.pageNumber, p]));

    return {
      pageCount: totalPages,
      truncated: totalPages > pagesToRender,
      pages: textResult.pages.map((p) => ({
        pageNumber: p.num,
        text: p.text,
        image: imageByPage.has(p.num)
          ? { buffer: imageByPage.get(p.num).data, width: imageByPage.get(p.num).width, height: imageByPage.get(p.num).height }
          : null,
      })),
      fullText: textResult.text,
    };
  } finally {
    await parser.destroy();
  }
}

export async function extractDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return {
    fullText: result.value,
    warnings: result.messages.filter((m) => m.type === 'warning').map((m) => m.message),
  };
}

const pptxXmlParser = new XMLParser({ ignoreAttributes: true, textNodeName: '#text' });

/** Recursively pulls every DrawingML text run (`<a:t>`) out of a parsed
 * slide, in document order — slide XML nests text arbitrarily deep inside
 * shape/group/table structures, so this walks the whole tree rather than
 * assuming a fixed shape. */
function collectRunText(node, out) {
  if (node == null) return;
  if (typeof node === 'string') {
    if (node.trim()) out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectRunText(n, out));
    return;
  }
  if (typeof node === 'object') {
    if ('a:t' in node) collectRunText(node['a:t'], out);
    for (const key of Object.keys(node)) {
      if (key === 'a:t') continue;
      collectRunText(node[key], out);
    }
  }
}

function slideNumber(entryName) {
  return Number(entryName.match(/slide(\d+)\.xml$/)[1]);
}

export async function extractPptx(buffer) {
  const zip = new AdmZip(buffer);
  const slideEntries = zip
    .getEntries()
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => slideNumber(a.entryName) - slideNumber(b.entryName));

  const slides = slideEntries.map((entry) => {
    const parsed = pptxXmlParser.parse(entry.getData().toString('utf-8'));
    const runs = [];
    collectRunText(parsed, runs);
    return { slideNumber: slideNumber(entry.entryName), text: runs.join('\n') };
  });

  return {
    slideCount: slides.length,
    slides,
    fullText: slides.map((s) => s.text).join('\n\n'),
  };
}
