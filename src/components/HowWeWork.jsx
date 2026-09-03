import { Link } from 'react-router-dom';
import ChatBackdrop from './ChatBackdrop.jsx';
import BlayneMark from './BlayneMark.jsx';
import AccountMenu from './auth/AccountMenu.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import SiteFooter from './SiteFooter.jsx';
import Seo from './Seo.jsx';
import { MAP_SECTIONS } from '../data/productMap.js';
import { STEPS } from '../data/howWeWork.js';

const METHODOLOGY = [
  { phase: '01', name: 'Discovery & Deep Dive' },
  { phase: '02', name: 'Research & Strategy Development' },
  { phase: '03', name: 'Planning & Creative Development' },
  { phase: '04', name: 'Implementation & Launch' },
  { phase: '05', name: 'Optimisation & Growth' },
  { phase: '06', name: 'Sustained Success & Scaling' },
];

const EXPERTISE = [
  'Strategic consulting, in the register of a McKinsey or BCG engagement',
  'Brand and visual identity',
  'Product management and UX research',
  'Market sizing and competitor intelligence',
  'Sales enablement, built on SPIN and Challenger methodology',
  'Investor narrative and fundraising materials',
  'Technology and solutions architecture',
  'Regulatory and compliance research, checked against primary sources',
  'Technical documentation, to IEEE and ISO standards',
  'Executive communication and editorial polish',
];

export default function HowWeWork() {
  return (
    <div className="flex min-h-full flex-col items-center bg-delft">
      <Seo
        title="How We Work"
        description="B.L.A.Y.N.E answers the way a senior consultant would: it asks what matters, shows its reasoning, and is explicit about how much weight to put on its answer."
        path="/how-we-work"
        noindex
      />

      <header className="w-full">
        <div className="mx-auto flex max-w-[1160px] items-center justify-between px-6 py-6 sm:px-10">
          <Link
            to="/"
            aria-label="BLAYNE home"
            className="pressable inline-flex items-center gap-3 no-underline transition-opacity hover:opacity-80"
          >
            <BlayneMark className="h-9 w-9" />
            <span className="text-[15px] tracking-[0.02em] text-platinum">B.L.A.Y.N.E</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      {/* -------------------------------- intro -------------------------------- */}
      <section className="relative w-full overflow-hidden">
        <ChatBackdrop
          className="pointer-events-none absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid slice"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-delft/60" />

        <div className="relative mx-auto max-w-[820px] px-6 py-16 sm:px-10 sm:py-24">
          <p className="m-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">How we work</p>
          <h1 className="mt-6 mb-0 text-[clamp(2rem,5.5vw,3.5rem)] leading-[1.08] font-normal tracking-[-0.02em] text-platinum">
            A senior consultant, not a search box.
          </h1>
          <p className="mt-6 mb-0 max-w-2xl text-lg leading-relaxed text-platinum/75">
            B.L.A.Y.N.E answers the way a good consultant would: it asks what actually
            matters, shows its reasoning, and tells you plainly how much weight to put on
            what it just said. Here is exactly what happens between you signing in and
            getting an answer.
          </p>
        </div>
      </section>

      {/* -------------------------------- steps -------------------------------- */}
      <section className="w-full">
        <div className="mx-auto max-w-[820px] px-6 py-16 sm:px-10">
          <h2 className="m-0 text-xl font-normal text-platinum">From sign-in to answer</h2>
          <ol className="m-0 mt-8 flex list-none flex-col gap-3 p-0">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="material-chip flex gap-5 rounded-2xl bg-jordy/10 px-5 py-5 sm:px-6"
              >
                <span className="shrink-0 text-sm text-jordy/70 tabular-nums">{step.n}</span>
                <div>
                  <h3 className="m-0 text-[15.5px] font-normal text-platinum">{step.title}</h3>
                  <p className="mt-1.5 mb-0 text-sm leading-relaxed text-platinum/70">
                    {step.body}
                  </p>
                  {step.n === '03' && (
                    <ul className="m-0 mt-4 flex list-none flex-wrap gap-2 p-0">
                      {MAP_SECTIONS.map((s) => (
                        <li key={s.id}>
                          <Link
                            to={`/${s.id}`}
                            title={s.intro}
                            className="pressable-text rounded-full bg-jordy/15 px-3.5 py-1.5 text-xs tracking-[0.03em] text-platinum/85 no-underline hover:bg-jordy/25 hover:text-platinum"
                          >
                            {s.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ----------------------------- methodology ------------------------------ */}
      <section className="w-full border-t border-jordy/15">
        <div className="mx-auto max-w-[820px] px-6 py-16 sm:px-10">
          <h2 className="m-0 text-xl font-normal text-platinum">What shapes every answer</h2>
          <p className="mt-3 mb-0 max-w-xl text-sm leading-relaxed text-platinum/65">
            Client-facing work — a proposal, an engagement roadmap, a project plan — is
            structured around Blayne&rsquo;s own six-phase methodology, the same one a human
            consultant here would use.
          </p>

          <ol className="m-0 mt-8 grid list-none grid-cols-1 gap-px overflow-hidden rounded-2xl bg-jordy/15 p-0 sm:grid-cols-2">
            {METHODOLOGY.map((m) => (
              <li key={m.phase} className="flex items-baseline gap-3 bg-delft px-5 py-4">
                <span className="text-xs text-jordy/60 tabular-nums">{m.phase}</span>
                <span className="text-sm text-platinum/85">{m.name}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------- expertise ------------------------------- */}
      <section className="w-full border-t border-jordy/15">
        <div className="mx-auto max-w-[820px] px-6 py-16 sm:px-10">
          <h2 className="m-0 text-xl font-normal text-platinum">The expertise behind it</h2>
          <p className="mt-3 mb-0 max-w-xl text-sm leading-relaxed text-platinum/65">
            Not one generalist model — a set of specialists, each grounded in the
            frameworks and standards of its discipline, coordinated into one voice.
          </p>

          <ul className="m-0 mt-8 flex list-none flex-wrap gap-2.5 p-0">
            {EXPERTISE.map((e) => (
              <li
                key={e}
                className="rounded-full bg-jordy/10 px-4 py-2 text-sm text-platinum/80"
              >
                {e}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* -------------------------------- honesty -------------------------------- */}
      <section className="w-full border-t border-jordy/15">
        <div className="mx-auto max-w-[820px] px-6 py-16 sm:px-10">
          <h2 className="m-0 text-xl font-normal text-platinum">
            What it will and won&rsquo;t do
          </h2>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="m-0 text-[15px] font-normal text-platinum">It will</h3>
              <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0 text-sm leading-relaxed text-platinum/70">
                <li>Say plainly when it isn&rsquo;t confident, and what would resolve it</li>
                <li>Flag a decision that needs a human at Blayne&rsquo;s Consulting</li>
                <li>
                  Verify regulatory or compliance detail against a current source rather
                  than recite it from memory
                </li>
                <li>Disagree with your framing when the evidence points elsewhere</li>
              </ul>
            </div>
            <div>
              <h3 className="m-0 text-[15px] font-normal text-platinum">It won&rsquo;t</h3>
              <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0 text-sm leading-relaxed text-platinum/70">
                <li>Present a judgement call as settled fact</li>
                <li>Guarantee an outcome, or treat an estimate as a commitment</li>
                <li>Claim to be a licensed lawyer, accountant, or financial adviser</li>
                <li>Agree with you just to be agreeable</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------- beta --------------------------------- */}
      <section className="w-full border-t border-jordy/15">
        <div className="mx-auto max-w-[820px] px-6 py-16 sm:px-10">
          <div className="material-panel rounded-2xl px-6 py-6 sm:px-8">
            <h2 className="m-0 text-[15.5px] font-normal text-platinum">
              You&rsquo;re on the beta
            </h2>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-platinum/70">
              Each tester gets 25 messages a day while we scale up capacity — your
              composer shows how many you have left. Everything else — every feature,
              every layer of the Product Map — is open to every tester.
            </p>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              to="/features"
              className="pressable rounded-full bg-jordy px-7 py-3.5 text-[15.5px] tracking-[0.02em] text-delft no-underline transition-colors hover:bg-jordy/85 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:ring-offset-2 focus-visible:ring-offset-delft focus-visible:outline-none"
            >
              Start a session
            </Link>
            <Link
              to="/#features"
              className="pressable rounded-full px-7 py-3.5 text-[15.5px] tracking-[0.02em] text-platinum no-underline ring-1 ring-jordy/40 transition-colors hover:bg-jordy/10 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
            >
              See the Product Map
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
