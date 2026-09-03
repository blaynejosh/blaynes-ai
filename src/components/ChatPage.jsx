import { useState, useId, useRef, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Navigate } from 'react-router-dom';
import ChatBackdrop from './ChatBackdrop.jsx';
import ChatNav from './ChatNav.jsx';
import ChatMessage from './ChatMessage.jsx';
import Seo from './Seo.jsx';
import { streamReply, fetchUsage } from '../lib/chat.js';
import { listBrandAssets, uploadBrandAssets, deleteBrandAsset } from '../lib/brandAssets.js';
import { MAP_SECTIONS } from '../data/productMap.js';

const itemLabel = (item) => (typeof item === 'string' ? item : item.label);
const itemMeta = (item) => (typeof item === 'string' ? null : item.meta);

// Matches ALLOWED_BRAND_MIME_TYPES in server/index.js — no binary Office
// formats: Claude's inline `document` content block (no Files API on Vertex
// AI) only reads PDF, images, and plain text, so a Word doc or deck needs
// exporting to PDF first.
const BRAND_FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv';
const BRAND_FILE_TYPES_LABEL = 'PDF, PNG, JPG, WebP, TXT, MD, or CSV — max 8MB each';

/**
 * The chat surface, from "AI chat area - *.svg": the category list on the
 * left, a translucent panel on the right with the composer pinned to its
 * foot, and the brand glow washing through from behind.
 *
 * The export is a 1440x1024 mock of an application screen rather than a
 * poster, so this reflows instead of letterboxing — the design's proportions
 * (360px list, 27px panel radius, 56px composer) are the desktop baseline and
 * the list collapses behind the nav's menu button on narrow viewports.
 *
 * Answers come from B.L.A.Y.N.E. via /api/chat, which calls Claude on Vertex
 * AI server-side and streams the reply back (see server/index.js).
 */
export default function ChatPage() {
  const { category } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = MAP_SECTIONS.find((s) => s.id === category);

  const [selected, setSelected] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  // Open by default: on mobile this is an overlay drawer, on desktop it's the
  // static 360px column. Either way the toggle in ChatNav collapses it, and
  // selecting an item only auto-collapses the *mobile* overlay (see below) —
  // desktop stays open so picking another item doesn't hide the list.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [usage, setUsage] = useState(null); // { used, limit } — see server /api/usage
  const [brandAssets, setBrandAssets] = useState([]);
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandError, setBrandError] = useState(null);

  const inputId = useId();
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchUsage().then(setUsage);
  }, [category]);

  // Brand materials are account-wide, not per-category, so load once — the
  // route's :category param changes without remounting this component.
  useEffect(() => {
    listBrandAssets().then(setBrandAssets).catch(() => {});
  }, []);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setBrandBusy(true);
    setBrandError(null);
    try {
      const added = await uploadBrandAssets(files);
      setBrandAssets((prev) => [...prev, ...added]);
    } catch (err) {
      setBrandError(err.message);
    } finally {
      setBrandBusy(false);
    }
  };

  const removeAsset = async (id) => {
    setBrandError(null);
    const prev = brandAssets;
    setBrandAssets((list) => list.filter((a) => a.id !== id)); // optimistic
    try {
      await deleteBrandAsset(id);
    } catch (err) {
      setBrandAssets(prev); // roll back
      setBrandError(err.message);
    }
  };

  // Follow the answer as it streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Drop any in-flight request when the view changes or unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);

    // A search result arrives as /:category?topic=<label> — pre-select that
    // item, then drop the param so it doesn't linger in the address bar.
    const topicParam = searchParams.get('topic');
    const match = topicParam && section?.items.find((item) => itemLabel(item) === topicParam);
    setSelected(match ? itemLabel(match) : null);
    if (topicParam) setSearchParams({}, { replace: true });
    // Only re-run when the route's category segment changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const send = useCallback(
    async (text, topic) => {
      const history = [...messages, { role: 'user', content: text, topic }];
      setMessages([...history, { role: 'assistant', content: '' }]);
      setStreaming(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const append = (chunk) =>
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + chunk };
          return next;
        });

      try {
        const { refused, usage: nextUsage } = await streamReply({
          category,
          topic,
          messages: history.map(({ role, content }) => ({ role, content })),
          signal: controller.signal,
          onText: append,
        });
        if (refused) append(refused);
        if (nextUsage) setUsage(nextUsage);
      } catch (err) {
        if (err.name === 'AbortError') {
          // Drop the empty assistant turn the user cancelled.
          setMessages((prev) =>
            prev[prev.length - 1]?.content ? prev : prev.slice(0, -1),
          );
        } else {
          setError(err.message);
          setMessages((prev) => prev.slice(0, -1));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [category, messages],
  );

  if (!section) return <Navigate to="/features" replace />;

  const atLimit = usage && usage.used >= usage.limit;

  const submit = (e) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || streaming || atLimit) return;
    setPrompt('');
    send(text, selected);
  };

  return (
    <div className="relative flex h-svh flex-col overflow-hidden bg-delft">
      <Seo
        title={section.title}
        description={`Start a B.L.A.Y.N.E session for ${section.title.toLowerCase()} — ${section.intro}`}
        path={`/${category}`}
        noindex
      />

      <ChatBackdrop
        className="pointer-events-none fixed inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      />

      <div className="relative mx-auto flex h-full w-full max-w-[1440px] flex-col">
        <div className="shrink-0">
          <ChatNav
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
          />
        </div>

        {/*
          Body insets follow the export at 1440: list text at x=72, panel from
          x=508 to x=1358, 55px below the header rule, 48px clear of the foot.
        */}
        <div className="flex min-h-0 flex-1 gap-6 px-5 pt-6 pb-8 sm:px-8 lg:gap-[76px] lg:pt-[55px] lg:pr-[5.7%] lg:pb-12 lg:pl-[5%]">
          {/* ------------------------- category list ------------------------- */}
          <aside
            id="chat-sidebar"
            aria-label={`${section.title} list`}
            className={`${
              sidebarOpen ? 'flex' : 'hidden'
            } material-sheet scrollbar-hidden absolute inset-x-5 top-20 z-10 max-h-[70svh] min-h-0 flex-col overflow-y-auto rounded-2xl p-4 shadow-2xl ring-1 ring-jordy/20 md:static md:z-auto md:h-full md:min-h-0 md:w-[360px] md:shrink-0 md:p-0 md:shadow-none md:ring-0 ${
              sidebarOpen ? 'md:flex' : 'md:hidden'
            }`}
          >
            <h1 className="sr-only">{section.title}</h1>
            <ul className="m-0 flex list-none flex-col gap-px p-0 md:gap-0">
              {section.items.map((item) => {
                const label = itemLabel(item);
                const meta = itemMeta(item);
                const active = selected === label;
                return (
                  <li key={label}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(active ? null : label);
                        // Only the mobile overlay should auto-close on pick;
                        // the desktop column stays open across selections.
                        if (window.matchMedia('(max-width: 767px)').matches) {
                          setSidebarOpen(false);
                        }
                      }}
                      aria-pressed={active}
                      className={`pressable w-full cursor-pointer rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[15.5px] tracking-[0.048em] transition-colors focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none md:px-2 md:py-[6px] ${
                        active
                          ? 'bg-jordy/20 text-platinum'
                          : 'text-platinum/85 hover:bg-jordy/10 hover:text-platinum'
                      }`}
                    >
                      {label}
                      {meta && (
                        <span className="mt-0.5 block text-xs tracking-normal text-platinum/50">
                          {meta}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* ----------------------------- panel ----------------------------- */}
          <section
            aria-label="Conversation"
            className="material-panel flex min-h-0 min-w-0 flex-1 flex-col rounded-[27px] p-5 sm:p-8"
          >
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              {messages.length === 0 ? (
                <p className="m-0 max-w-md text-sm leading-relaxed text-platinum/55">
                  {selected
                    ? `${selected} selected. Add a prompt below to brief B.L.A.Y.N.E.`
                    : `Pick from the ${section.title.toLowerCase()} list, or type a prompt straight into the composer.`}
                </p>
              ) : (
                <ul
                  aria-live="polite"
                  aria-busy={streaming}
                  className="m-0 flex list-none flex-col gap-6 p-0"
                >
                  {messages.map((m, i) => (
                    <ChatMessage
                      key={i}
                      role={m.role}
                      topic={m.topic}
                      content={m.content}
                      pending={streaming && i === messages.length - 1}
                    />
                  ))}
                </ul>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-4 mb-0 rounded-xl bg-poppy/15 px-4 py-3 text-sm text-platinum"
                >
                  {error}
                </p>
              )}
            </div>

            {/* --------------------------- brand materials --------------------------- */}
            {(brandAssets.length > 0 || brandBusy) && (
              <ul className="m-0 mb-3 flex list-none flex-wrap gap-2 p-0">
                {brandAssets.map((asset) => (
                  <li
                    key={asset.id}
                    className="flex items-center gap-2 rounded-full bg-jordy/10 py-1.5 pr-1.5 pl-3 text-xs text-platinum/80"
                  >
                    <span className="max-w-[160px] truncate">{asset.file_name}</span>
                    <button
                      type="button"
                      onClick={() => removeAsset(asset.id)}
                      aria-label={`Remove ${asset.file_name}`}
                      className="pressable grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-platinum/50 hover:text-platinum"
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {brandBusy && (
                  <li className="rounded-full bg-jordy/10 px-3 py-1.5 text-xs text-platinum/55">
                    Uploading…
                  </li>
                )}
              </ul>
            )}
            {brandError && (
              <p role="alert" className="m-0 mb-3 text-xs text-poppy">
                {brandError}
              </p>
            )}

            <form onSubmit={submit} className="mt-6 shrink-0">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <label htmlFor={inputId} className="text-[15.5px] text-platinum/75">
                  {atLimit
                    ? "You've used today's messages"
                    : selected
                      ? `Briefing B.L.A.Y.N.E on ${selected}`
                      : 'Select a feature from the left or input your prompt here'}
                </label>
                {usage && (
                  <span className="shrink-0 text-xs text-platinum/45 tabular-nums">
                    {usage.used}/{usage.limit} today
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 rounded-[13px] bg-delft py-2 pr-2 pl-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={BRAND_FILE_ACCEPT}
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={brandBusy}
                  aria-label="Attach brand or business documents"
                  title="Attach brand or business documents"
                  className="pressable grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-platinum/60 transition-colors hover:bg-platinum/8 hover:text-platinum focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path
                      d="M12.5 6.5 7 12a2.5 2.5 0 1 1-3.5-3.5L9 3a1.7 1.7 0 1 1 2.5 2.5L6 11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <input
                  id={inputId}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={streaming || atLimit}
                  placeholder={
                    atLimit
                      ? 'Come back tomorrow for 25 more messages.'
                      : "Type in your prompt, I'll do the heavy work."
                  }
                  className="min-w-0 flex-1 border-0 bg-transparent py-2 text-[15.5px] text-platinum placeholder:text-platinum/45 focus:outline-none disabled:opacity-60"
                />
                {streaming ? (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    aria-label="Stop generating"
                    className="pressable grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-platinum transition-colors hover:bg-platinum/12 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
                  >
                    <span className="block h-3 w-3 rounded-[2px] bg-current" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={atLimit}
                    aria-label="Send prompt"
                    className="pressable grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-platinum transition-colors hover:bg-platinum/12 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M9 1v16M17 9H1" />
                      </g>
                    </svg>
                  </button>
                )}
              </div>
              <p className="mt-2 mb-0 text-xs text-platinum/40">
                Attach brand materials as {BRAND_FILE_TYPES_LABEL}.
              </p>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
