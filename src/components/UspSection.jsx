import { Link } from 'react-router-dom';
import ChatBackdrop from './ChatBackdrop.jsx';
import { FEATURES, DEPARTMENTS, JOB_ROLES, STARTUP_STAGES } from '../data/productMap.js';

/** The disciplines named in the supporting statement, as a scannable row. */
const DISCIPLINES = [
  'Brand',
  'Strategy',
  'Product',
  'Marketing',
  'Sales',
  'Finance',
  'and more',
];

/** Counted from the Product Map so the figures cannot drift from the sections. */
const PROOF = [
  { n: FEATURES.length, label: 'capability modules' },
  { n: DEPARTMENTS.length, label: 'departments' },
  { n: JOB_ROLES.length, label: 'job roles' },
  { n: STARTUP_STAGES.length, label: 'growth stages' },
];

export default function UspSection() {
  return (
    <section
      aria-labelledby="usp-heading"
      className="relative w-full overflow-hidden border-y border-jordy/15 bg-delft"
    >
      <ChatBackdrop
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-delft/55" />

      <div className="relative mx-auto max-w-[1160px] px-6 py-24 sm:px-10 lg:py-32">
        <p className="m-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">
          B.L.A.Y.N.E AI
        </p>

        <h2
          id="usp-heading"
          className="display-h1 mt-6 mb-0 max-w-4xl text-[clamp(2.5rem,6.5vw,5rem)] leading-[1.05] font-normal tracking-[-0.02em] text-platinum"
        >
          Your consulting team,
          <br />
          <span className="accent text-jordy">on demand.</span>
        </h2>

        <p className="mt-8 mb-0 max-w-2xl text-lg leading-relaxed text-platinum/75">
          Blayne answers with the exact expertise, and uses on real client work, brand,
          strategy, product, marketing, sales, finance, and more, instantly, not next week.
        </p>

        <ul className="mt-10 flex list-none flex-wrap gap-2.5 p-0">
          {DISCIPLINES.map((d) => (
            <li
              key={d}
              className="rounded-full bg-jordy/15 px-4 py-2 text-sm tracking-[0.03em] text-platinum/85"
            >
              {d}
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            to="/features"
            className="pressable rounded-full bg-jordy px-7 py-3.5 text-[15.5px] tracking-[0.02em] text-delft no-underline transition-colors hover:bg-jordy/85 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:ring-offset-2 focus-visible:ring-offset-delft focus-visible:outline-none"
          >
            Start a session
          </Link>
          <a
            href="#features"
            className="pressable rounded-full px-7 py-3.5 text-[15.5px] tracking-[0.02em] text-platinum no-underline ring-1 ring-jordy/40 transition-colors hover:bg-jordy/10 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
          >
            See the map
          </a>
        </div>

        <dl className="mt-16 grid grid-cols-2 gap-8 border-t border-jordy/15 pt-10 sm:grid-cols-4">
          {PROOF.map((p) => (
            <div key={p.label}>
              <dt className="sr-only">{p.label}</dt>
              <dd className="m-0">
                <span className="block text-4xl leading-none text-platinum tabular-nums">
                  {p.n}
                </span>
                <span className="mt-2 block text-sm text-platinum/55">{p.label}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
