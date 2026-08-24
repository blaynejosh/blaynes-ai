import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import BlayneMark from '../BlayneMark.jsx';
import LegalDocument from '../legal/LegalDocument.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { supabase } from '../../lib/supabase.js';
import { SAFETY_ADDENDUM_MD } from '../../lib/legalContent.js';

/**
 * Blocking gate shown once per account, right after onboarding and before
 * the rest of the app: the Advanced AI Model Safety Addendum for the AI
 * models B.L.A.Y.N.E runs on. ProtectedRoute routes here whenever a
 * signed-in, onboarded account hasn't accepted it yet (see
 * ProtectedRoute.jsx); acceptance is recorded on the profile row so it
 * persists across devices and never shows again for that account.
 */
export default function SafetyAddendumGate() {
  const { session, profile, refreshProfile } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!session) return <Navigate to="/login" replace />;
  if (profile && !profile.onboarding_completed) return <Navigate to="/onboarding" replace />;
  if (profile?.safety_addendum_accepted) return <Navigate to="/" replace />;

  const accept = async () => {
    if (!checked) return;
    setBusy(true);
    setError(null);

    const { error: err } = await supabase
      .from('profiles')
      .update({
        safety_addendum_accepted: true,
        safety_addendum_accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.user.id);

    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    await refreshProfile();
  };

  return (
    <div className="flex min-h-svh flex-col items-center bg-delft px-6 py-14">
      <BlayneMark className="h-11 w-11" />
      <h1 className="mt-5 mb-1 text-center text-xl font-normal text-platinum">
        Advanced AI Model Safety Addendum
      </h1>
      <p className="m-0 mb-8 max-w-md text-center text-sm text-platinum/60">
        One last step. This covers the advanced AI models B.L.A.Y.N.E runs on — please read it
        before you start a session.
      </p>

      <div className="material-panel w-full max-w-xl rounded-3xl bg-white/[0.04] p-6 sm:p-8">
        <div className="max-h-[50vh] overflow-y-auto pr-1">
          <LegalDocument markdown={SAFETY_ADDENDUM_MD} />
        </div>

        <div className="mt-6 border-t border-jordy/15 pt-6">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-platinum/75">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-platinum/30 bg-white/10 accent-jordy"
            />
            I have read and agree to the Advanced AI Model Safety Addendum, and to the{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="text-jordy underline decoration-jordy/40 underline-offset-2 hover:decoration-jordy"
            >
              Terms of Use
            </a>{' '}
            and{' '}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-jordy underline decoration-jordy/40 underline-offset-2 hover:decoration-jordy"
            >
              Privacy Policy
            </a>
            .
          </label>

          {error && (
            <p role="alert" className="mt-4 mb-0 text-sm text-poppy">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={accept}
            disabled={!checked || busy}
            className="pressable mt-6 w-full rounded-full bg-jordy px-6 py-3.5 text-[15px] font-medium text-delft transition-colors hover:bg-jordy/85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'I have read and accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
