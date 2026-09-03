import { useEffect } from 'react';
import { SITE_NAME, SITE_URL, DEFAULT_OG_IMAGE } from '../lib/seo.js';

const JSONLD_ID = 'blayne-page-jsonld';

function upsertMeta(attr, key, content) {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href) {
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * Nonce for any inline <script> this component creates — read from the meta
 * tag the server stamps into every HTML response (see server/index.js) so
 * page-specific JSON-LD still satisfies the app's `script-src 'nonce-…'` CSP
 * (see helmet config there) instead of silently getting blocked and logging
 * a CSP violation in the console.
 */
function cspNonce() {
  return document.querySelector('meta[name="csp-nonce"]')?.content ?? '';
}

function setJsonLd(data) {
  const existing = document.getElementById(JSONLD_ID);
  if (!data) {
    existing?.remove();
    return;
  }
  const json = JSON.stringify(data);
  if (existing) {
    if (existing.textContent !== json) existing.textContent = json;
    return;
  }
  // nonce + content are set before the element ever joins the document —
  // CSP nonce-matching is only reliable that way for a script inserted by JS.
  const el = document.createElement('script');
  el.type = 'application/ld+json';
  el.id = JSONLD_ID;
  el.nonce = cspNonce();
  el.textContent = json;
  document.head.appendChild(el);
}

/**
 * Per-page document head for this client-rendered SPA: title, description,
 * canonical, Open Graph / Twitter tags, a robots directive, and one
 * page-specific JSON-LD block. No react-helmet — direct DOM upserts are
 * enough here and avoid an extra dependency; Google indexes this app
 * post-render, same as any other client-rendered route.
 *
 * `path` is the route path (e.g. "/terms"), used to build the canonical and
 * og:url. `noindex` covers auth flows and gated app screens that have
 * nothing for a crawler to index. Render one <Seo> per page, near the top.
 */
export default function Seo({
  title,
  description,
  path = '/',
  image = DEFAULT_OG_IMAGE,
  noindex = false,
  jsonLd = null,
  // The home page's title is already the full brand + tagline string, not a
  // page name — pass rawTitle so it isn't suffixed into "… | B.L.A.Y.N.E AI".
  rawTitle,
}) {
  useEffect(() => {
    const fullTitle = rawTitle ?? (title ? `${title} | ${SITE_NAME}` : SITE_NAME);
    const url = `${SITE_URL}${path}`;

    document.title = fullTitle;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');
    upsertLink('canonical', url);

    upsertMeta('property', 'og:title', fullTitle);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', url);
    upsertMeta('property', 'og:image', image);
    upsertMeta('name', 'twitter:title', fullTitle);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', image);

    setJsonLd(jsonLd);
  }, [title, rawTitle, description, path, image, noindex, jsonLd]);

  return null;
}
