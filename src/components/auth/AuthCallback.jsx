import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Seo from '../Seo.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Landing point for both Google OAuth and the email magic link — supabase-js
 * reads the token out of the URL automatically (`detectSessionInUrl`), which
 * is what populates `session` in AuthContext. This just waits for that, then
 * routes on: new signups go to onboarding, everyone else goes home.
 */
export default function AuthCallback() {
  const { session, profile, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  if (session && !loading) {
    return <Navigate to={profile?.onboarding_completed ? '/' : '/onboarding'} replace />;
  }

  if (timedOut) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-delft">
      <Seo title="Signing in" path="/auth/callback" noindex />
      <h1 className="sr-only">Signing in</h1>
      <p className="text-sm text-platinum/60">Signing you in…</p>
    </div>
  );
}
