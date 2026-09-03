import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import BlayneMark from '../BlayneMark.jsx';
import Seo from '../Seo.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { supabase } from '../../lib/supabase.js';

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'];

const FIELD =
  'w-full rounded-2xl bg-platinum/8 px-5 py-3.5 text-[15px] text-platinum placeholder:text-platinum/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-jordy';

function Toggle({ options, value, onChange }) {
  return (
    <div className="flex gap-2">
      {options.map(({ label, val }) => (
        <button
          key={String(val)}
          type="button"
          onClick={() => onChange(val)}
          aria-pressed={value === val}
          className={`pressable rounded-full px-5 py-2.5 text-sm transition-colors ${
            value === val
              ? 'bg-jordy text-delft'
              : 'bg-platinum/8 text-platinum/75 hover:bg-platinum/12'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * One required screen between first sign-in and the rest of the app. The row
 * already exists (created by the database trigger on signup — see
 * supabase/schema.sql) so this is always an update, keyed on the signed-in
 * user's own id, which Row Level Security restricts to their own row.
 */
export default function OnboardingForm() {
  const { session, profile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [hasCompany, setHasCompany] = useState(profile?.has_company ?? null);
  const [companyName, setCompanyName] = useState(profile?.company_name ?? '');
  const [companySize, setCompanySize] = useState(profile?.company_size ?? '');
  const [useCase, setUseCase] = useState(profile?.use_case ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!session) return <Navigate to="/login" replace />;
  if (profile?.onboarding_completed) return <Navigate to="/" replace />;

  const valid =
    fullName.trim() &&
    phone.trim() &&
    hasCompany !== null &&
    (hasCompany === false || (companyName.trim() && companySize)) &&
    useCase.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);

    // Upsert, not update: an account created before the signup trigger
    // existed (see supabase/schema.sql) has no row yet, and a plain update
    // against a missing row succeeds with zero rows changed — no error, no
    // effect, which is exactly the stuck-on-this-screen bug this replaces.
    const { error: err } = await supabase.from('profiles').upsert(
      {
        id: session.user.id,
        email: session.user.email,
        full_name: fullName.trim(),
        phone: phone.trim(),
        has_company: hasCompany,
        company_name: hasCompany ? companyName.trim() : null,
        company_size: hasCompany ? companySize : null,
        use_case: useCase.trim(),
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    await refreshProfile();
  };

  return (
    <div className="flex min-h-svh flex-col items-center bg-delft px-6 py-14">
      <Seo title="Tell us about yourself" path="/onboarding" noindex />

      <BlayneMark className="h-11 w-11" />
      <h1 className="mt-5 mb-1 text-xl font-normal text-platinum">Tell us about yourself</h1>
      <p className="m-0 mb-8 max-w-sm text-center text-sm text-platinum/60">
        A few details before you start. This is what shapes how we follow up during the beta.
      </p>

      <form onSubmit={submit} className="flex w-full max-w-md flex-col gap-5">
        <label className="flex flex-col gap-2 text-sm text-platinum/70">
          Full name
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ada Lovelace"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-2 text-sm text-platinum/70">
          Email
          <input value={session.user.email ?? ''} disabled className={`${FIELD} opacity-60`} />
        </label>

        <label className="flex flex-col gap-2 text-sm text-platinum/70">
          Phone number
          <input
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 010 1234"
            className={FIELD}
          />
        </label>

        <div className="flex flex-col gap-2 text-sm text-platinum/70">
          Do you have a company?
          <Toggle
            value={hasCompany}
            onChange={setHasCompany}
            options={[
              { label: 'Yes', val: true },
              { label: 'No', val: false },
            ]}
          />
        </div>

        {hasCompany && (
          <>
            <label className="flex flex-col gap-2 text-sm text-platinum/70">
              Company name
              <input
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc."
                className={FIELD}
              />
            </label>

            <div className="flex flex-col gap-2 text-sm text-platinum/70">
              Company size
              <div className="flex flex-wrap gap-2">
                {COMPANY_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setCompanySize(size)}
                    aria-pressed={companySize === size}
                    className={`pressable rounded-full px-4 py-2 text-sm transition-colors ${
                      companySize === size
                        ? 'bg-jordy text-delft'
                        : 'bg-platinum/8 text-platinum/75 hover:bg-platinum/12'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <label className="flex flex-col gap-2 text-sm text-platinum/70">
          What would you use B.L.A.Y.N.E for?
          <textarea
            required
            rows={3}
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
            placeholder="e.g. drafting client proposals, market research, sales enablement…"
            className={`${FIELD} resize-none`}
          />
        </label>

        {error && (
          <p role="alert" className="m-0 text-sm text-poppy">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!valid || busy}
          className="pressable mt-2 rounded-full bg-jordy px-6 py-3.5 text-[15px] font-medium text-delft transition-colors hover:bg-jordy/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
