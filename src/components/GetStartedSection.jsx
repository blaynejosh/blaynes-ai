import { Link } from 'react-router-dom';

/** Where SkillTree runs pricing tiers — BLAYNE has no tiers yet, just open beta access. */
export default function GetStartedSection() {
  return (
    <section aria-labelledby="start-heading" className="w-full border-t border-jordy/15 bg-delft">
      <div className="mx-auto max-w-[1160px] px-6 py-24 sm:px-10 lg:py-32">
        <p className="m-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">Get started</p>
        <h2
          id="start-heading"
          className="display-h1 mt-6 mb-0 text-[clamp(1.75rem,4vw,3rem)] leading-[1.1] font-normal tracking-[-0.02em] text-platinum"
        >
          No tiers. No waitlist. Just sign in.
        </h2>

        <div className="material-panel mt-10 max-w-lg rounded-2xl px-6 py-6 sm:px-8">
          <h3 className="m-0 text-[15.5px] font-normal text-platinum">You&rsquo;re on the beta</h3>
          <p className="mt-2 mb-0 text-sm leading-relaxed text-platinum/70">
            Each tester gets 25 messages a day while we scale up capacity — your composer
            shows how many you have left. Everything else — every feature, every layer of
            the Product Map — is open to every tester.
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
            to="/how-we-work"
            className="pressable rounded-full px-7 py-3.5 text-[15.5px] tracking-[0.02em] text-platinum no-underline ring-1 ring-jordy/40 transition-colors hover:bg-jordy/10 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
          >
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}
