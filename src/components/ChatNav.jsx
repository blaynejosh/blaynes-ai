import { NavLink, Link } from 'react-router-dom';
import BlayneMark from './BlayneMark.jsx';
import AccountMenu from './auth/AccountMenu.jsx';
import { MAP_SECTIONS } from '../data/productMap.js';

/**
 * Top bar of the chat surface, from "AI chat area - *.svg".
 *
 * The export marks the active tab with a fixed 83.5px white rule at y=101,
 * centred under the tab rather than matched to its width, lit by a white
 * drop shadow. Both are reproduced below.
 */
export default function ChatNav({ onToggleSidebar, sidebarOpen }) {
  /*
   * The export insets the header rather than running it full-bleed: the mark
   * sits at x=215 and the hairline spans 203.5 -> 1243.5 on the 1440 board,
   * the same treatment as the home hero. Those are kept as percentages of the
   * 1440 container so they hold at any width, and relaxed below lg.
   */
  return (
    <header className="relative">
      <div className="flex items-center gap-6 px-5 pb-0 sm:px-8 lg:pl-[14.93%] lg:pr-[13.65%]">
        <Link
          to="/"
          aria-label="BLAYNE home"
          className="pressable shrink-0 py-3 transition-opacity hover:opacity-80"
        >
          <BlayneMark className="h-11 w-11" />
        </Link>

        <button
          type="button"
          onClick={onToggleSidebar}
          aria-expanded={sidebarOpen}
          aria-controls="chat-sidebar"
          aria-label={sidebarOpen ? 'Hide list' : 'Show list'}
          className="pressable -mx-1 shrink-0 cursor-pointer rounded-md border-0 bg-transparent px-1 py-3 text-platinum transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
        >
          <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M0 1h28M0 10h28M0 19h28" />
            </g>
          </svg>
        </button>

        <nav aria-label="Product map" className="ml-auto min-w-0">
          <ul className="m-0 flex list-none items-stretch gap-6 overflow-x-auto p-0 [scrollbar-width:none] lg:gap-[74px] [&::-webkit-scrollbar]:hidden">
            {MAP_SECTIONS.map((s) => (
              <li key={s.id}>
                <NavLink
                  to={`/${s.id}`}
                  className={({ isActive }) =>
                    `relative flex h-full items-center whitespace-nowrap py-4 text-[15.2px] tracking-[0.055em] no-underline transition-colors focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none ${
                      isActive ? 'text-white' : 'text-platinum/70 hover:text-platinum'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {s.title}
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute -bottom-px left-1/2 h-px w-[83.5px] -translate-x-1/2 bg-white shadow-[0_0_11px_2px_rgba(255,255,255,0.75)]"
                        />
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <AccountMenu className="ml-2 shrink-0" />
      </div>

      <span
        aria-hidden="true"
        className="absolute inset-x-5 bottom-0 h-px bg-jordy/25 sm:inset-x-8 lg:right-[13.65%] lg:left-[14.13%]"
      />
    </header>
  );
}
