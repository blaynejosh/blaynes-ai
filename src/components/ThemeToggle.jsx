import { useTheme } from '../context/ThemeContext.jsx';

/** Sun/moon toggle — sits next to AccountMenu everywhere that renders. */
export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`pressable material-chip flex h-9 w-9 items-center justify-center rounded-full bg-jordy/15 text-platinum ring-1 ring-jordy/25 transition-colors hover:bg-jordy/25 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none ${className}`}
    >
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.7" />
          <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M12 2.5v2.3M12 19.2v2.3M21.5 12h-2.3M4.8 12H2.5" />
            <path d="M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2L5.6 5.6" />
          </g>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
