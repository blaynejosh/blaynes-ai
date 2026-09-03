import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SITE_URL } from '../lib/seo.js';

const JSONLD_ID = 'blayne-breadcrumb-jsonld';

/**
 * Visible breadcrumb trail plus its BreadcrumbList JSON-LD, for any page
 * that isn't the home page itself. `trail` is an ordered list of
 * `{ label, to }` — the last entry should be the current page and is
 * rendered unlinked, matching aria current-page convention.
 *
 * The JSON-LD ships as its own <script>, separate from Seo.jsx's per-page
 * block, nonced the same way (see the CSP note in Seo.jsx) so it survives
 * the app's strict script-src.
 */
export default function Breadcrumbs({ trail }) {
  useEffect(() => {
    const nonce = document.querySelector('meta[name="csp-nonce"]')?.content ?? '';
    const data = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [{ label: 'Home', to: '/' }, ...trail].map((step, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: step.label,
        item: `${SITE_URL}${step.to}`,
      })),
    };
    const json = JSON.stringify(data);

    let el = document.getElementById(JSONLD_ID);
    if (el) {
      if (el.textContent !== json) el.textContent = json;
    } else {
      el = document.createElement('script');
      el.type = 'application/ld+json';
      el.id = JSONLD_ID;
      el.nonce = nonce;
      el.textContent = json;
      document.head.appendChild(el);
    }

    return () => el?.remove();
  }, [trail]);

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-xs text-platinum/50">
        <li>
          <Link to="/" className="pressable-text text-platinum/50 no-underline hover:text-platinum/80">
            Home
          </Link>
        </li>
        {trail.map((step, i) => {
          const isLast = i === trail.length - 1;
          return (
            <li key={step.to} className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              {isLast ? (
                <span aria-current="page" className="text-platinum/75">
                  {step.label}
                </span>
              ) : (
                <Link to={step.to} className="pressable-text text-platinum/50 no-underline hover:text-platinum/80">
                  {step.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
