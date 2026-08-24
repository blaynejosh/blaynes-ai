import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAP_SECTIONS } from '../data/productMap.js';
import { u } from '../lib/stage.js';

const itemLabel = (item) => (typeof item === 'string' ? item : item.label);

/** Every item across all four Product Map layers, flattened once at module load. */
const INDEX = MAP_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({
    categoryId: section.id,
    categoryTitle: section.title,
    label: itemLabel(item),
  })),
);

function search(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return INDEX.filter((entry) => entry.label.toLowerCase().includes(q)).slice(0, 8);
}

/**
 * The hero's collapsed Search pill, expanding on click into a text field that
 * searches every item across Features, Job Roles, Departments and Start Ups.
 * A result opens the matching chat page with that item pre-selected, via a
 * `?topic=` param ChatPage reads on load.
 *
 * `variant="stage"` (desktop hero) is positioned in artboard coordinates,
 * anchored to the same right edge the collapsed pill already sits on — see
 * lib/stage.js — so it grows left rather than off the side of the viewport.
 * `variant="inline"` (mobile hero) sits in the header's normal flex row and
 * anchors to its own right edge with a viewport-relative width instead.
 */
export default function SearchBox({ variant = 'stage' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();

  const results = useMemo(() => search(query), [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const go = (entry) => {
    navigate(`/${entry.categoryId}?topic=${encodeURIComponent(entry.label)}`);
    close();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      go(results[activeIndex]);
    }
  };

  // The original collapsed pill's box (Home.svg: x=1102 y=45 w=142 h=40) —
  // expansion keeps this same right edge fixed and grows the left edge only.
  const RIGHT_EDGE = 1102 + 142;
  const stageStyle =
    variant === 'stage'
      ? {
          position: 'absolute',
          top: u(45),
          right: u(1440 - RIGHT_EDGE),
          width: u(open ? 460 : 142),
          transition: 'width 220ms ease',
          zIndex: open ? 40 : 20,
        }
      : { zIndex: open ? 40 : 20 };

  return (
    <div
      ref={rootRef}
      style={stageStyle}
      className={variant === 'inline' ? 'relative' : undefined}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search the Product Map"
          className={
            variant === 'stage'
              ? 'pressable material-chip flex h-10 w-full items-center justify-between rounded-full bg-white/20 px-5 text-platinum no-underline transition-colors hover:bg-white/30 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none'
              : 'pressable material-chip flex items-center gap-3 rounded-full bg-white/20 px-4 py-2.5 text-sm text-platinum transition-colors hover:bg-white/30 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none'
          }
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-jordy" />
          {variant === 'stage' ? <span style={{ fontSize: u(15.8) }}>Search</span> : 'Search'}
        </button>
      ) : (
        <div
          className={`material-panel rounded-2xl shadow-2xl ${
            variant === 'inline' ? 'absolute top-0 right-0 w-[min(82vw,380px)]' : 'w-full'
          }`}
        >
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-jordy" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search features, roles, departments, start ups…"
              className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-platinum placeholder:text-platinum/45 focus:outline-none"
            />
            <button
              type="button"
              onClick={close}
              aria-label="Close search"
              className="pressable-text shrink-0 cursor-pointer border-0 bg-transparent text-platinum/50 hover:text-platinum"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 2l12 12M14 2 2 14" />
                </g>
              </svg>
            </button>
          </div>

          {query.trim() ? (
            <ul
              id={listId}
              role="listbox"
              className="m-0 max-h-72 list-none overflow-y-auto border-t border-jordy/15 p-1"
            >
              {results.length ? (
                results.map((entry, i) => (
                  <li key={`${entry.categoryId}-${entry.label}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => go(entry)}
                      className={`pressable-text flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-sm transition-colors ${
                        i === activeIndex ? 'bg-jordy/15 text-white' : 'text-platinum/85'
                      }`}
                    >
                      <span className="truncate">{entry.label}</span>
                      <span className="shrink-0 text-[11px] tracking-[0.08em] text-platinum/45 uppercase">
                        {entry.categoryTitle}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-3 text-sm text-platinum/50">
                  No matches. Try a different term.
                </li>
              )}
            </ul>
          ) : (
            <p className="m-0 border-t border-jordy/15 px-4 py-3 text-xs text-platinum/45">
              Search across Features, Job Roles, Departments and Start Ups.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
