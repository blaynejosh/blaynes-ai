/**
 * Rasterizes an exhibit's SVG (render/svg/*.js) to PNG for the .docx path —
 * "Build the chart renderer to produce SVG, then embed the SVG in the PDF
 * path and a rasterized copy in the .docx path," extended here to every
 * SVG-based exhibit, not just charts (see exhibitToSvg.js's doc comment for
 * why table/image/quote are excluded from this — they render natively
 * instead).
 *
 * @napi-rs/canvas has no SVG rasterizer built in (it draws paths/text you
 * hand it, not markup), so this goes through sharp — sharp bundles
 * librsvg — rather than round-tripping through Playwright for what's a
 * cheap, synchronous conversion.
 */
import sharp from 'sharp';

/** scale: 2 = render at 2x the SVG's own pixel dimensions, so an embedded
 * exhibit stays crisp on a printed/exported page instead of looking like a
 * blown-up screenshot. */
export async function svgToPng(svgString, { scale = 2 } = {}) {
  const image = sharp(Buffer.from(svgString)).png();
  if (scale !== 1) {
    const metadata = await sharp(Buffer.from(svgString)).metadata();
    if (metadata.width && metadata.height) {
      image.resize(Math.round(metadata.width * scale), Math.round(metadata.height * scale));
    }
  }
  const buffer = await image.toBuffer();
  const { width, height } = await sharp(buffer).metadata();
  return { buffer, width, height };
}
