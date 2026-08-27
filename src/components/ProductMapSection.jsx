import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MAP_SECTIONS } from '../data/productMap.js';

const itemLabel = (item) => (typeof item === 'string' ? item : item.label);
const itemMeta = (item) => (typeof item === 'string' ? null : item.meta);

/**
 * All four Product Map layers as one section: a tab per layer plus
 * prev/next stepping, showing that layer's items as a card grid — replaces
 * the four full-height fan sections (MapStage/MapStacked) to cut the
 * homepage's scroll length.
 *
 * Keeps the `id="features"` anchor other pages already link to
 * (SiteFooter, UspSection, HowWeWork all point at `#features` as
 * "jump to the Product Map").
 */
export default function ProductMapSection() {
  const [active, setActive] = useState(0);
  const section = MAP_SECTIONS[active];
  const last = MAP_SECTIONS.length - 1;

  const go = (delta) => setActive((i) => (i + delta + MAP_SECTIONS.length) % MAP_SECTIONS.length);

  return (
    <section id="features" aria-labelledby="map-heading" className="w-full border-t border-jordy/15 bg-delft">
      <div className="mx-auto max-w-[1160px] px-6 py-24 sm:px-10 lg:py-32">
        <p className="m-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">The product map</p>
        <h2
          id="map-heading"
          className="display-h1 mt-6 mb-0 max-w-2xl text-[clamp(1.75rem,4vw,3rem)] leading-[1.1] font-normal tracking-[-0.02em] text-platinum"
        >
          Every layer, one place to start.
        </h2>

        <div role="tablist" aria-label="Product Map layer" className="mt-10 flex flex-wrap gap-2">
          {MAP_SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`pressable rounded-full px-4 py-2 text-sm tracking-[0.03em] transition-colors ${
                i === active
                  ? 'bg-jordy text-delft'
                  : 'bg-jordy/10 text-platinum/75 hover:bg-jordy/20'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>

        <div aria-live="polite" className="mt-10">
          <p className="m-0 max-w-xl text-base leading-relaxed text-platinum/70">
            {section.intro}
          </p>

          <Link
            to={`/${section.id}`}
            className="pressable mt-4 inline-flex items-center gap-2 rounded-full bg-jordy/15 px-4 py-2 text-sm text-platinum no-underline transition-colors hover:bg-jordy/25 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
          >
            Open in BLAYNE
            <span aria-hidden="true">→</span>
          </Link>

          <ul className="m-0 mt-8 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item, i) => (
              <li
                key={itemLabel(item)}
                className="material-chip flex items-baseline gap-3 rounded-xl bg-platinum/5 px-4 py-3"
              >
                <span className="w-6 shrink-0 text-xs text-jordy/60 tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-platinum">{itemLabel(item)}</span>
                  {itemMeta(item) && (
                    <span className="mt-0.5 block text-xs text-platinum/55">
                      {itemMeta(item)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-10 flex items-center gap-4">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous layer"
            className="pressable flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-jordy/30 text-platinum transition-colors hover:bg-jordy/10 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
          >
            <span aria-hidden="true">←</span>
          </button>
          <span className="text-xs tracking-[0.1em] text-platinum/50 tabular-nums">
            {active + 1} / {last + 1}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next layer"
            className="pressable flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-jordy/30 text-platinum transition-colors hover:bg-jordy/10 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
