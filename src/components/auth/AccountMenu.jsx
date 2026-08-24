import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Sign-out affordance. A standalone floating control rather than something
 * built into Hero/ChatNav's own markup — both of those are laid out from
 * exact design-export coordinates (see lib/stage.js), and this has no
 * equivalent in either export to anchor to.
 */
export default function AccountMenu({ className = '' }) {
  const { profile, user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const name = profile?.full_name || user?.email || '';
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="pressable material-chip flex h-9 w-9 items-center justify-center rounded-full bg-jordy/25 text-sm text-platinum ring-1 ring-jordy/30 focus-visible:ring-2 focus-visible:ring-jordy focus-visible:outline-none"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="material-panel absolute top-11 right-0 z-20 w-56 rounded-2xl p-2 shadow-2xl"
        >
          <div className="px-3 py-2">
            <p className="m-0 truncate text-sm text-platinum">{profile?.full_name || 'Tester'}</p>
            <p className="m-0 truncate text-xs text-platinum/50">{user?.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut()}
            className="pressable-text w-full cursor-pointer rounded-lg border-0 bg-transparent px-3 py-2 text-left text-sm text-platinum/85 hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
