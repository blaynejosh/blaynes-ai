import { Link } from 'react-router-dom';
import BlayneMark from './BlayneMark.jsx';
import { MAP_SECTIONS } from '../data/productMap.js';

/* Contact details as published on Blayne's Consulting document footers. */
const SITE = 'www.blaynesconsulting.com';
const EMAIL = 'team@blaynes.consulting';

const COMPANY = [
  { label: 'How we work', to: '/how-we-work' },
  { label: 'The Product Map', href: '#features' },
  { label: 'Start a session', to: '/features' },
];

export default function SiteFooter() {
  return (
    <footer className="w-full border-t border-jordy/15 bg-delft">
      <div className="mx-auto max-w-[1160px] px-6 py-16 sm:px-10">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          {/* ---------------------------- identity ---------------------------- */}
          <div>
            <Link
              to="/"
              aria-label="BLAYNE home"
              className="pressable inline-flex items-center gap-3 no-underline transition-opacity hover:opacity-80"
            >
              <BlayneMark className="h-10 w-10" />
              <span className="text-[15.5px] tracking-[0.02em] text-platinum">
                B.L.A.Y.N.E
              </span>
            </Link>
            <p className="mt-5 mb-0 max-w-xs text-sm leading-relaxed text-platinum/60">
              Business Leading Agent Yielding Next-Gen Enterprise Strategies.
            </p>
          </div>

          {/* ---------------------------- product ----------------------------- */}
          <nav aria-labelledby="footer-product">
            <h2
              id="footer-product"
              className="m-0 text-xs tracking-[0.18em] text-platinum/45 uppercase"
            >
              Product Map
            </h2>
            <ul className="mt-5 flex list-none flex-col gap-3 p-0">
              {MAP_SECTIONS.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/${s.id}`}
                    className="pressable-text text-sm text-platinum/75 no-underline transition-colors hover:text-platinum"
                  >
                    {s.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* ---------------------------- company ----------------------------- */}
          <nav aria-labelledby="footer-company">
            <h2
              id="footer-company"
              className="m-0 text-xs tracking-[0.18em] text-platinum/45 uppercase"
            >
              Company
            </h2>
            <ul className="mt-5 flex list-none flex-col gap-3 p-0">
              {COMPANY.map((l) => (
                <li key={l.label}>
                  {l.to ? (
                    <Link
                      to={l.to}
                      className="pressable-text text-sm text-platinum/75 no-underline transition-colors hover:text-platinum"
                    >
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      href={l.href}
                      className="pressable-text text-sm text-platinum/75 no-underline transition-colors hover:text-platinum"
                    >
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>

          {/* ---------------------------- contact ----------------------------- */}
          <div>
            <h2 className="m-0 text-xs tracking-[0.18em] text-platinum/45 uppercase">
              Contact
            </h2>
            <ul className="mt-5 flex list-none flex-col gap-3 p-0">
              <li>
                <a
                  href={`mailto:${EMAIL}`}
                  className="pressable-text text-sm break-all text-platinum/75 no-underline transition-colors hover:text-platinum"
                >
                  {EMAIL}
                </a>
              </li>
              <li>
                <a
                  href={`https://${SITE}`}
                  className="pressable-text text-sm text-platinum/75 no-underline transition-colors hover:text-platinum"
                >
                  {SITE}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-jordy/15 pt-8 text-xs text-platinum/45 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0">
            © {new Date().getFullYear()} Blayne&rsquo;s Consulting. All rights reserved.
          </p>
          <nav aria-label="Legal" className="flex items-center gap-5">
            <Link to="/terms" className="pressable-text no-underline transition-colors hover:text-platinum/75">
              Terms of Use
            </Link>
            <Link to="/privacy" className="pressable-text no-underline transition-colors hover:text-platinum/75">
              Privacy Policy
            </Link>
            <Link
              to="/safety-addendum"
              className="pressable-text no-underline transition-colors hover:text-platinum/75"
            >
              AI Safety Addendum
            </Link>
          </nav>
          <p className="m-0">B.L.A.Y.N.E AI</p>
        </div>
      </div>
    </footer>
  );
}
