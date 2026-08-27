import { Link } from 'react-router-dom';
import HeroBackdrop from './HeroBackdrop.jsx';
import BlayneMark from './BlayneMark.jsx';
import AccountMenu from './auth/AccountMenu.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import SearchBox from './SearchBox.jsx';
import { HERO_NODES } from '../data/heroNodes.js';

/**
 * Narrow-viewport hero.
 *
 * The artboard composition arranges the four entry points in an arc around a
 * 1440px-wide dendrite map; below ~768px that arc would shrink the type past
 * legibility, so the same content reflows to a single column. The artwork
 * stays as an ambient backdrop, cropped to the centre of the map.
 */
export default function HeroStacked() {
  return (
    <section
      className="relative flex min-h-svh w-full flex-col overflow-hidden bg-delft px-6 pt-6 pb-10 md:hidden"
      aria-labelledby="hero-heading"
    >
      <HeroBackdrop
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      />
      {/* The dendrite map is dense at this crop — hold it back behind the copy. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-delft/70"
      />

      <div className="relative flex items-center justify-between">
        <Link
          to="/"
          aria-label="BLAYNE home"
          className="pressable transition-opacity duration-200 hover:opacity-80"
        >
          <BlayneMark className="h-11 w-11" />
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <SearchBox variant="inline" />
          <AccountMenu />
        </div>
      </div>

      <div className="relative mt-14 flex flex-col items-center text-center">
        <BlayneMark className="h-20 w-20" />
        <span className="mt-4 text-base tracking-[0.02em] text-platinum">
          B.L.A.Y.N.E
        </span>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-platinum/70">
          Business Leading Agent Yielding Next-Gen Enterprise Strategies.
        </p>
      </div>

      <ul className="relative mt-12 flex flex-col gap-3">
        {HERO_NODES.map((node, i) => (
          <li key={node.id} className="node-in" style={{ animationDelay: `${i * 90}ms` }}>
            <Link
              to={node.to}
              aria-label={`Explore ${node.label.toLowerCase()}`}
              className="group pressable flex items-center gap-4 rounded-2xl bg-jordy/15 px-5 py-4 no-underline transition-colors hover:bg-jordy/25 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-jordy transition-transform motion-safe:group-hover:scale-125" />
              <span className="min-w-0">
                <span className="block text-sm tracking-[0.055em] text-platinum">
                  {node.label}
                </span>
                <span className="mt-1 block text-xs leading-snug text-platinum/60">
                  {node.blurb}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="ml-auto shrink-0 text-platinum/50 transition-transform motion-safe:group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
