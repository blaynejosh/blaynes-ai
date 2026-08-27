import { Link } from 'react-router-dom';
import { STEPS } from '../data/howWeWork.js';

/** Condensed version of the full breakdown at /how-we-work. */
export default function ProcessSection() {
  return (
    <section aria-labelledby="process-heading" className="w-full border-t border-jordy/15 bg-delft">
      <div className="mx-auto max-w-[1160px] px-6 py-24 sm:px-10 lg:py-32">
        <p className="m-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">How it works</p>
        <h2
          id="process-heading"
          className="mt-6 mb-0 max-w-2xl text-[clamp(1.75rem,4vw,3rem)] leading-[1.1] font-normal tracking-[-0.02em] text-platinum"
        >
          From sign-in to an answer you can act on.
        </h2>

        <ol className="m-0 mt-12 grid list-none gap-3 p-0 sm:grid-cols-2">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="material-chip flex gap-4 rounded-2xl bg-jordy/10 px-5 py-5"
            >
              <span className="shrink-0 text-sm text-jordy/70 tabular-nums">{step.n}</span>
              <div>
                <h3 className="m-0 text-[15px] font-normal text-white">{step.title}</h3>
                <p className="mt-1.5 mb-0 text-sm leading-relaxed text-platinum/70">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <Link
          to="/how-we-work"
          className="pressable-text mt-8 inline-flex items-center gap-2 text-sm text-jordy no-underline hover:text-jordy/80"
        >
          See exactly what shapes every answer
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
