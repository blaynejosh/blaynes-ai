/**
 * The confirmation screen's preview panel — "a rendered preview, not a
 * form: a sample cover, a sample body page, a sample table, a sample
 * exhibit, all in the extracted brand" (Phase 2 brief).
 *
 * Driven entirely by resolveTokens()'s output (server/brandKit/tokens.js),
 * fetched from GET /api/brand-kit/drafts/:id — the same resolved-token
 * table the real renderer (Phase 3, not built yet) will consume. This
 * component reads tokens, never a raw Brand Kit field, for exactly the
 * reason server/brandKit/tokens.js's own header comment gives: nothing here
 * should ever need to know brand-kit.schema.json's shape directly.
 *
 * Genuinely a mockup, not the real document renderer — no docx/PDF output,
 * just enough fidelity (real colours, real fonts if the browser has them
 * installed via @font-face, real layout proportions) that a reviewer can
 * tell whether a colour or font choice looks right before confirming it.
 */
function fontFamilyCss(typeface) {
  if (!typeface) return 'inherit';
  return [`"${typeface.family}"`, ...(typeface.fallback_stack ?? [])].join(', ');
}

function Swatch({ hex, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-6 w-6 shrink-0 rounded-md ring-1 ring-black/10" style={{ background: hex }} />
      <span className="text-[11px] text-platinum/60">
        {label} <span className="font-mono">{hex}</span>
      </span>
    </div>
  );
}

export default function BrandKitPreview({ tokens, logoUrl, orgName }) {
  if (!tokens) return null;
  const { colors, typography, layout } = tokens;

  const coverIsDark = layout.cover_style === 'full_bleed_dark';
  const coverBg = coverIsDark ? colors.surface.dark : colors.surface.page;
  const coverFg = coverIsDark ? colors.text.on_dark : colors.text.heading;

  const tableIsDarkHeader = layout.table_style === 'dark_header_zebra';

  return (
    <div className="space-y-4">
      {/* Cover */}
      <div
        className="overflow-hidden rounded-2xl ring-1 ring-black/10"
        style={{ background: coverBg, fontFamily: fontFamilyCss(typography.display) }}
      >
        <div className="flex aspect-[4/3] flex-col justify-between p-8">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-8 max-w-[140px] object-contain" style={{ filter: coverIsDark ? 'none' : 'none' }} />
            ) : (
              <div className="h-8 w-24 rounded ring-1 ring-dashed" style={{ borderColor: coverFg, opacity: 0.4 }} />
            )}
            {layout.accent_bar && (
              <div className="flex h-1.5 flex-1 overflow-hidden rounded-full">
                {[colors.primary, colors.secondary, ...colors.accents].slice(0, 4).map((hex, i) => (
                  <span key={i} className="flex-1" style={{ background: hex }} />
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="m-0 mb-2 text-xs tracking-[0.2em] uppercase" style={{ color: colors.primary, opacity: coverIsDark ? 1 : 0.8 }}>
              Strategy Report
            </p>
            <h1 className="m-0 text-3xl leading-tight font-semibold" style={{ color: coverFg }}>
              Regulatory cost rises 40% <span style={{ color: colors.primary }}>by Q3</span>
            </h1>
            <p className="m-0 mt-2 text-sm" style={{ color: coverFg, opacity: 0.7 }}>
              Prepared for {orgName ?? 'the client'}
            </p>
          </div>
        </div>
      </div>

      {/* Body page: heading + paragraph + callout */}
      <div
        className="rounded-2xl p-6 ring-1 ring-black/10"
        style={{ background: colors.surface.page, fontFamily: fontFamilyCss(typography.body) }}
      >
        <h2
          className="m-0 mb-2 text-lg font-semibold"
          style={{ color: colors.text.heading, fontFamily: fontFamilyCss(typography.heading) }}
        >
          Compliance headcount must double before Q3
        </h2>
        <p className="m-0 text-sm leading-relaxed" style={{ color: colors.text.body }}>
          Sample body copy set in this Brand Kit's body typeface, so a reviewer can judge line length and colour contrast the same way it will
          read in a generated report — not the app's own interface font.
        </p>
        <div className="mt-4 rounded-lg p-3" style={{ background: colors.surface.tint }}>
          <p className="m-0 text-xs font-semibold" style={{ color: colors.text.heading }}>
            Key takeaway
          </p>
          <p className="m-0 mt-1 text-xs" style={{ color: colors.text.muted }}>
            A callout block, shaded with this kit's tint surface colour.
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl ring-1 ring-black/10" style={{ fontFamily: fontFamilyCss(typography.body) }}>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr style={{ background: tableIsDarkHeader ? colors.surface.dark : colors.surface.tint }}>
              {['Scenario', 'Cost impact', 'Confidence'].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 font-semibold"
                  style={{ color: tableIsDarkHeader ? colors.text.on_dark : colors.text.heading, borderBottom: `1px solid ${colors.surface.hairline}` }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ['Base case', '+18%', 'High'],
              ['Aggressive enforcement', '+40%', 'Medium'],
            ].map((row, i) => (
              <tr key={i} style={{ background: i % 2 ? colors.surface.tint : colors.surface.page }}>
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2" style={{ color: colors.text.body, borderBottom: `1px solid ${colors.surface.hairline}` }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Exhibit: KPI row */}
      <div className="rounded-2xl p-5 ring-1 ring-black/10" style={{ background: colors.surface.page, fontFamily: fontFamilyCss(typography.body) }}>
        <p className="m-0 mb-1 text-sm font-semibold" style={{ color: colors.text.heading }}>
          Exhibit 1 — Regulatory cost triples under aggressive enforcement
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[
            ['+40%', 'Cost, aggressive case'],
            ['18mo', 'Time to compliance'],
            ['3', 'New regulators involved'],
          ].map(([value, label]) => (
            <div key={label} className="rounded-lg p-3" style={{ background: colors.surface.tint }}>
              <p className="m-0 text-xl font-bold" style={{ color: colors.primary }}>
                {value}
              </p>
              <p className="m-0 text-[11px]" style={{ color: colors.text.muted }}>
                {label}
              </p>
            </div>
          ))}
        </div>
        <p className="m-0 mt-3 text-[11px] italic" style={{ color: colors.text.muted }}>
          So what: budget for the aggressive scenario now — the base case likely underestimates compliance headcount needs.
        </p>
      </div>

      {/* Resolved palette, for a quick "does this look right" scan */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-white/10 p-4 sm:grid-cols-3">
        <Swatch hex={colors.primary} label="Primary" />
        <Swatch hex={colors.secondary} label="Secondary" />
        <Swatch hex={colors.text.body} label="Body text" />
        <Swatch hex={colors.surface.page} label="Page" />
        <Swatch hex={colors.surface.tint} label="Tint" />
        <Swatch hex={colors.surface.dark} label="Dark surface" />
      </div>
    </div>
  );
}
