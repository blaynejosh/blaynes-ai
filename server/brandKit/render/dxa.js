/**
 * DXA (twentieths of a point) conversions for the .docx adapter —
 * "Page size defaults to A4. For US Letter set the page size explicitly in
 * DXA, where 1440 equals one inch" and "Tables need widths in two places:
 * columnWidths on the table and width on every cell, both in DXA."
 */
const DXA_PER_INCH = 1440;
const MM_PER_INCH = 25.4;

export function mmToDxa(mm) {
  return Math.round((mm / MM_PER_INCH) * DXA_PER_INCH);
}

export function ptToDxa(pt) {
  return Math.round(pt * 20);
}

/** Word/half-point font sizes (docx-js's `size` on a run is in half-points). */
export function ptToHalfPoints(pt) {
  return Math.round(pt * 2);
}

export const PAGE_SIZE_DXA = {
  A4: { width: 11906, height: 16838 }, // 210mm x 297mm
  LETTER: { width: 12240, height: 15840 }, // 8.5in x 11in
};
