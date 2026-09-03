import { Link } from 'react-router-dom';
import BlayneMark from './BlayneMark.jsx';
import SiteFooter from './SiteFooter.jsx';
import Seo from './Seo.jsx';

/**
 * Catch-all for any path React Router doesn't recognize. Rendered client-side
 * at HTTP 200 like every other route in this SPA, but the server marks the
 * response itself 404 for unrecognized paths (see the route allowlist in
 * server/index.js) so it still reads as a real not-found to crawlers/tools
 * that check status codes, not just body content.
 */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-full flex-col items-center bg-delft">
      <Seo
        title="Page not found"
        description="That page doesn't exist. Head back to B.L.A.Y.N.E's home page to find what you're looking for."
        path="/404"
        noindex
      />

      <div className="flex w-full flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <BlayneMark className="h-12 w-12 opacity-60" />
        <p className="mt-6 mb-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">404</p>
        <h1 className="mt-3 mb-0 text-[clamp(1.75rem,5vw,2.75rem)] leading-[1.1] font-normal tracking-[-0.02em] text-platinum">
          This page doesn&rsquo;t exist.
        </h1>
        <p className="mt-4 mb-8 max-w-md text-base leading-relaxed text-platinum/65">
          The link you followed may be broken, or the page may have moved.
        </p>
        <Link
          to="/"
          className="pressable material-chip inline-flex items-center rounded-full bg-jordy px-6 py-3 text-[15px] font-medium text-delft no-underline transition-opacity hover:opacity-90"
        >
          Back to home
        </Link>
      </div>

      <SiteFooter />
    </div>
  );
}
