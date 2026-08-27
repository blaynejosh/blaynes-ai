import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import BlayneMark from '../BlayneMark.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Open signup: anyone can arrive here and create an account. Google is one
 * tap; email is a magic link, so there's no password to manage for either
 * side during the beta.
 */
export default function LoginPage() {
  const { session, signInWithGoogle, signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Always back to the home page, never the feature page that redirected
  // here — /, /onboarding and /safety-addendum each forward on to the next
  // required step, so this converges on / once every gate is satisfied.
  if (session) return <Navigate to="/" replace />;

  const withGoogle = async () => {
    setError(null);
    setBusy(true);
    const { error: err } = await signInWithGoogle();
    if (err) {
      setError(err.message);
      setBusy(false);
    }
    // On success the browser navigates to Google, so there's nothing else to do here.
  };

  const withEmail = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await signInWithEmail(email.trim());
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-delft px-6 py-16">
      <BlayneMark className="h-14 w-14" />
      <h1 className="mt-6 mb-0 text-2xl font-normal text-platinum">B.L.A.Y.N.E</h1>
      <p className="mt-2 mb-10 max-w-xs text-center text-sm text-platinum/60">
        Your consulting team, on demand. Sign in to start a session.
      </p>

      <div className="w-full max-w-sm">
        <button
          type="button"
          onClick={withGoogle}
          disabled={busy}
          className="pressable material-chip flex w-full items-center justify-center gap-3 rounded-full bg-white/95 px-6 py-3.5 text-[15px] font-medium text-delft no-underline transition-colors hover:bg-white disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
            />
            <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59A8.53 8.53 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-platinum/40">
          <span className="h-px flex-1 bg-jordy/15" />
          or
          <span className="h-px flex-1 bg-jordy/15" />
        </div>

        {sent ? (
          <p className="m-0 rounded-2xl bg-jordy/10 px-5 py-4 text-center text-sm text-platinum/85">
            Check <span className="text-platinum">{email}</span> for a sign-in link.
          </p>
        ) : (
          <form onSubmit={withEmail} className="flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="rounded-full bg-platinum/8 px-5 py-3.5 text-[15px] text-platinum placeholder:text-platinum/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-jordy"
            />
            <button
              type="submit"
              disabled={busy}
              className="pressable rounded-full bg-jordy px-6 py-3.5 text-[15px] font-medium text-delft transition-colors hover:bg-jordy/85 disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Continue with email'}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 mb-0 text-center text-sm text-poppy">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
