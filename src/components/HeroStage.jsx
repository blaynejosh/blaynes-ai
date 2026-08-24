import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import HeroBackdrop from './HeroBackdrop.jsx';
import BlayneMark from './BlayneMark.jsx';
import NodePill from './NodePill.jsx';
import AccountMenu from './auth/AccountMenu.jsx';
import SearchBox from './SearchBox.jsx';
import { box, ink } from '../lib/stage.js';
import { HERO_NODES } from '../data/heroNodes.js';

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
  return (
    <section
      className="stage hidden shrink-0 md:block"
      aria-labelledby="hero-heading"
    >
      {/* Grid, brand glow, dendrite map and centre gem — straight from Home.svg */}
      <HeroBackdrop className="absolute inset-0 h-full w-full" />

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

      {/* Same header row as the logo and Search — sits inside the design's
          established right margin (the pill's right edge already meets it),
          so the avatar goes just left of Search rather than past it. */}
      <div style={{ ...box(1046, 45), position: 'absolute' }}>
        <AccountMenu />
      </div>

      {/* ---------------- the four Product Map entry points ---------------- */}
      {HERO_NODES.map((node) => (
        <Fragment key={node.id}>
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
          >
            Explore
          </NodePill>
        </Fragment>
      ))}

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
