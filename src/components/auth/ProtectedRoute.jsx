import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import BlayneMark from '../BlayneMark.jsx';

/**
 * Gates the chat product: no session -> /login; session but the onboarding
 * form hasn't been completed -> /onboarding; onboarded but the Advanced AI
 * Model Safety Addendum hasn't been accepted -> /safety-addendum.
 * `requireOnboarded` is false only on /onboarding itself, and
 * `requireSafetyAddendum` is false only on /safety-addendum itself — each
 * needs a session (and, for the addendum, a completed onboarding) but is
 * what satisfies its own gate.
 */
export default function ProtectedRoute({
  children,
  requireOnboarded = true,
  requireSafetyAddendum = true,
}) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-delft">
        <BlayneMark className="h-10 w-10 motion-safe:animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (requireOnboarded && profile && !profile.onboarding_completed) {
    return <Navigate to="/onboarding" replace />;
  }

  if (
    requireSafetyAddendum &&
    profile?.onboarding_completed &&
    !profile.safety_addendum_accepted
  ) {
    return <Navigate to="/safety-addendum" replace />;
  }

  return children;
}
