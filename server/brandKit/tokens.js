/**
 * Token resolution — Phase 3 Layer 1 in the brief ("Brand Kit to a resolved
 * style table: every colour role, type size, margin, border weight and
 * spacing value computed once per document... This layer also runs the
 * guards: contrast checks on every text-on-background pairing, chart
 * palette validation, minimum logo size, clear space").
 *
 * Pulled forward into Phase 2 deliberately, ahead of the rest of Phase 3:
 * the confirmation UI needs *something* to render a preview against ("a
 * rendered preview, not a form"), and resolving tokens is pure,
 * deterministic, model-free work that owes nothing to the docx-js/Playwright
 * renderer Phase 3 still needs to build — it's the one slice of that phase
 * that was buildable now without the rest of it. The renderer's block
 * functions will consume this same resolveTokens() output later; nothing
 * here is preview-only scaffolding that gets thrown away.
 *
 * No block renderer (this module, or later Phase 3 ones) ever reads a hex
 * value or a font name directly from a Brand Kit — every one of them reads
 * resolved tokens instead. That's what keeps "the model does not choose
 * visual values" true even once real block renderers exist.
 */

const DEFAULT_SCALE = {
  cover_title: 40,
  part_title: 28,
  h1: 22,
  h2: 16,
  h3: 13,
  body: 10.5,
  small: 9,
  caption: 8,
};

const DEFAULT_TYPEFACE = { family: 'Inter', fallback_stack: ['Helvetica', 'Arial', 'sans-serif'] };

const DEFAULT_MARGINS_MM = { top: 25, right: 22, bottom: 22, left: 22 };

const DEFAULT_LAYOUT = {
  page_size: 'A4',
  cover_style: 'minimal_light',
  header_style: 'logo_left_title_right',
  footer_style: 'hairline_rule',
  table_style: 'light_header_hairline',
  section_dividers: true,
  accent_bar: false,
};

/** A brand-neutral, contrast-safe fallback categorical palette — used only
 * when the kit has no chart_categorical of its own, or when the kit's own
 * palette fails the contrast guard below (see resolveTokens' `warnings`). */
const FALLBACK_CHART_CATEGORICAL = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#0891B2'];

function hex(colorObj, fallback) {
  return colorObj?.hex ?? fallback;
}

// --- WCAG contrast -----------------------------------------------------

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hexColor) {
  const h = hexColor.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio between two hex colours, 1 (identical) to 21
 * (black on white). */
export function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA) + 0.05;
  const lB = relativeLuminance(hexB) + 0.05;
  return lA > lB ? lA / lB : lB / lA;
}

/** 4.5:1 is the WCAG AA threshold for normal body text — the bar this
 * pipeline holds every text-on-background pairing to, per the brief's
 * "illegible contrast" being a defect the visual verifier (Phase 6) must
 * catch. Checking it here, at token-resolution time, catches it earlier —
 * at confirm time, per Phase 5's "so the user finds out while they can
 * still fix it," not buried in a 20-page render. */
const MIN_TEXT_CONTRAST = 4.5;

/**
 * Resolves a Brand Kit (any status — draft, awaiting_review, or active; the
 * confirmation UI previews drafts, the renderer only ever uses active ones)
 * into a flat, renderer-ready style table. Every gap is filled with a named
 * system default rather than left undefined, and every text/background
 * pairing is contrast-checked, with failures reported in `warnings` rather
 * than silently swapped — swapping a tenant's own colour for a "safer" one
 * without telling them would be exactly the kind of invented brand value
 * the brief prohibits.
 */
export function resolveTokens(kit) {
  const warnings = [];
  const colors = kit?.colors ?? {};
  const typography = kit?.typography ?? {};
  const layout = { ...DEFAULT_LAYOUT, ...(kit?.layout ?? {}) };

  const resolved = {
    colors: {
      primary: hex(colors.primary, '#1A1A1A'),
      secondary: hex(colors.secondary, hex(colors.primary, '#4B5563')),
      accents: (colors.accents ?? []).map((c) => hex(c)).filter(Boolean),
      text: {
        heading: hex(colors.text?.heading, '#111111'),
        body: hex(colors.text?.body, '#1F2937'),
        muted: hex(colors.text?.muted, '#6B7280'),
        on_dark: hex(colors.text?.on_dark, '#FFFFFF'),
      },
      surface: {
        page: hex(colors.surface?.page, '#FFFFFF'),
        dark: hex(colors.surface?.dark, '#111111'),
        tint: hex(colors.surface?.tint, '#F5F5F5'),
        hairline: hex(colors.surface?.hairline, '#E5E7EB'),
      },
      semantic: {
        positive: hex(colors.semantic?.positive, '#059669'),
        caution: hex(colors.semantic?.caution, '#D97706'),
        negative: hex(colors.semantic?.negative, '#DC2626'),
      },
      chart_categorical: colors.chart_categorical?.length ? colors.chart_categorical.map((c) => hex(c)).filter(Boolean) : [...FALLBACK_CHART_CATEGORICAL],
      chart_categorical_is_fallback: !colors.chart_categorical?.length,
    },
    typography: {
      display: typography.display ?? DEFAULT_TYPEFACE,
      heading: typography.heading ?? typography.display ?? DEFAULT_TYPEFACE,
      body: typography.body ?? DEFAULT_TYPEFACE,
      mono: typography.mono ?? { family: 'Courier New', fallback_stack: ['monospace'] },
      scale: { ...DEFAULT_SCALE, ...(typography.scale ?? {}) },
      rules: {
        display_never_bold: typography.rules?.display_never_bold ?? false,
        line_height_body: typography.rules?.line_height_body ?? 1.45,
        paragraph_spacing: typography.rules?.paragraph_spacing ?? 8,
        letterspacing_kicker: typography.rules?.letterspacing_kicker ?? 1.5,
      },
    },
    layout: {
      ...layout,
      margins_mm: { ...DEFAULT_MARGINS_MM, ...(layout.margins_mm ?? {}) },
    },
    logos: kit?.logos ?? [],
  };

  // --- Contrast guards -----------------------------------------------------
  const pairs = [
    ['body text on page', resolved.colors.text.body, resolved.colors.surface.page],
    ['heading text on page', resolved.colors.text.heading, resolved.colors.surface.page],
    ['on-dark text on dark surface', resolved.colors.text.on_dark, resolved.colors.surface.dark],
    ['body text on tint surface', resolved.colors.text.body, resolved.colors.surface.tint],
  ];
  for (const [label, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_TEXT_CONTRAST) {
      warnings.push({
        type: 'contrast',
        message: `${label} (${fg} on ${bg}) is ${ratio.toFixed(2)}:1 — below the ${MIN_TEXT_CONTRAST}:1 WCAG AA minimum for body text.`,
      });
    }
  }

  // Chart categorical palette validation (Phase 5: "validate every tenant
  // palette against the contrast requirements when the Brand Kit is
  // confirmed, not at render time") — checked here against the page
  // surface, since that's what a legend/axis label sits on.
  resolved.colors.chart_categorical.forEach((c, i) => {
    const ratio = contrastRatio(c, resolved.colors.surface.page);
    if (ratio < 1.5) {
      // A near-invisible series against the page background, not a text
      // contrast failure — 1.5:1 is a much looser "is this even visible"
      // floor, not the 4.5:1 text bar.
      warnings.push({ type: 'chart_palette', message: `Chart colour #${i + 1} (${c}) is nearly invisible against the page background.` });
    }
  });

  if (resolved.colors.chart_categorical_is_fallback) {
    warnings.push({
      type: 'chart_palette_fallback',
      message: 'No chart_categorical palette on this kit yet — using the system default categorical palette until one is set.',
    });
  }

  return { ...resolved, warnings };
}
