import { useState } from 'react';
import { Link } from 'react-router-dom';
import HeroBackdrop from './HeroBackdrop.jsx';
import BlayneMark from './BlayneMark.jsx';
import NodePill from './NodePill.jsx';
import AccountMenu from './auth/AccountMenu.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import SearchBox from './SearchBox.jsx';
import { box, ink, u } from '../lib/stage.js';
import { HERO_NODES, PILL } from '../data/heroNodes.js';
import { MAP_SECTIONS } from '../data/productMap.js';

const itemLabel = (item) => (typeof item === 'string' ? item : item.label);

/** First few real items per category, for the hover/focus preview. */
const PREVIEW = Object.fromEntries(
  MAP_SECTIONS.map((s) => [s.id, s.items.slice(0, 3).map(itemLabel)]),
);

/** The centre gem, straight off Home.svg (`circle cx="754" cy="901" r="38"`). */
const GEM = { x: 754, y: 901, glow: 140 };

/*
 * Sizes are tuned so Inter's ink box lands on the outlined type in Home.svg:
 * cap height 11.4px for the category labels, 11.3px for the wordmark, with
 * tracking making up the per-glyph width difference between the two faces.
 * Every element measures within ~2px of the export on the 1440px artboard.
 */
const LABEL = { size: 15.2, tracking: '0.055em' };
const WORDMARK = { size: 15.1 };

/**
 * The hero exactly as drawn in Design/Website/Home.svg — a 1440 x 1024
 * artboard letterboxed into the viewport, with every coordinate taken
 * straight off the export. Desktop and tablet only; see HeroStacked for
 * narrow viewports, where this composition would shrink past legibility.
 */
export default function HeroStage() {
  const [hoveredId, setHoveredId] = useState(null);

  return (
    <section
      className="stage hidden shrink-0 md:block"
      aria-labelledby="hero-heading"
    >
      {/* Grid, brand glow, dendrite map and centre gem — straight from Home.svg */}
      <HeroBackdrop className="absolute inset-0 h-full w-full" />

      {/* Idle breathing glow behind the gem — additive overlay, doesn't touch
          the generated backdrop art. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full motion-safe:animate-[pulse_3.5s_ease-in-out_infinite]"
        style={{
          ...box(GEM.x - GEM.glow / 2, GEM.y - GEM.glow / 2, GEM.glow, GEM.glow),
          background:
            'radial-gradient(circle, color-mix(in srgb, var(--color-jordy) 35%, transparent), transparent 70%)',
          filter: 'blur(6px)',
        }}
      />

      {/* ---------------- header ---------------- */}
      <Link
        to="/"
        aria-label="BLAYNE home"
        style={box(215, 40, 47, 50)}
        className="pressable absolute transition-opacity duration-200 hover:opacity-80"
      >
        <BlayneMark className="h-full w-full" />
      </Link>

      <SearchBox variant="stage" />

      {/* Same header row as the logo and Search. Right-anchored (like
          SearchBox's own expansion) at the avatar's design-export right edge
          (1046 + 36 = 1082) so it grows leftward instead of overlapping
          Search — the signed-out Log in / Get started pair is wider than
          the signed-in avatar this slot was drawn for. */}
      <div
        style={{ position: 'absolute', top: u(45), right: u(1440 - 1082) }}
        className="flex items-center gap-2"
      >
        <ThemeToggle />
        <AccountMenu />
      </div>

      {/* ---------------- the four Product Map entry points ---------------- */}
      {HERO_NODES.map((node, i) => {
        const dimmed = hoveredId && hoveredId !== node.id;
        const focus = () => setHoveredId(node.id);
        const blur = () => setHoveredId((id) => (id === node.id ? null : id));

        return (
          <div
            key={node.id}
            className="node-in transition-opacity duration-300"
            style={{ animationDelay: `${i * 90}ms`, opacity: dimmed ? 0.35 : 1 }}
          >
            <span
              aria-hidden="true"
              style={{
                ...ink(node.labelAt.x, node.labelAt.y, LABEL.size),
                letterSpacing: LABEL.tracking,
              }}
              className="absolute leading-none whitespace-nowrap text-platinum/90"
            >
              {node.label}
            </span>

            <NodePill
              as={Link}
              to={node.to}
              aria-label={`Explore ${node.label.toLowerCase()}`}
              title={node.blurb}
              style={{ ...box(node.pill.x, node.pill.y), position: 'absolute' }}
              onMouseEnter={focus}
              onMouseLeave={blur}
              onFocus={focus}
              onBlur={blur}
            >
              Explore
            </NodePill>

            {/* Hover/focus preview: a couple of real items from that layer,
                not just the static title-attribute tooltip. */}
            <div
              aria-hidden="true"
              style={{
                ...box(node.pill.x, node.pill.y + PILL.h + 10, 210),
                position: 'absolute',
                opacity: hoveredId === node.id ? 1 : 0,
                transform: hoveredId === node.id ? 'translateY(0)' : 'translateY(-4px)',
                transition: 'opacity 200ms ease, transform 200ms ease',
              }}
              className="material-chip pointer-events-none rounded-xl bg-delft/90 px-3.5 py-3 shadow-xl ring-1 ring-jordy/25"
            >
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {PREVIEW[node.id].map((item) => (
                  <li
                    key={item}
                    className="truncate text-[11.5px] leading-snug text-platinum/75"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}

      {/* ---------------- centre wordmark ---------------- */}
      <span
        style={ink(714.8, 961.8, WORDMARK.size)}
        className="absolute leading-none whitespace-nowrap text-platinum"
      >
        B.L.A.Y.N.E
      </span>
    </section>
  );
}
