import { Link } from 'react-router-dom';
import BlayneMark from '../BlayneMark.jsx';
import LegalDocument from './LegalDocument.jsx';
import Seo from '../Seo.jsx';
import Breadcrumbs from '../Breadcrumbs.jsx';
import { PRIVACY_POLICY_MD } from '../../lib/legalContent.js';

const TRAIL = [{ label: 'Privacy Policy', to: '/privacy' }];

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-svh bg-delft px-6 py-14">
      <Seo
        title="Privacy Policy"
        description="What personal information B.L.A.Y.N.E collects, how it's used, and the privacy rights you have over it."
        path="/privacy"
      />

      <div className="mx-auto max-w-2xl">
        <Link
          to="/"
          aria-label="BLAYNE home"
          className="pressable inline-flex items-center gap-3 no-underline transition-opacity hover:opacity-80"
        >
          <BlayneMark className="h-9 w-9" />
          <span className="text-[15px] tracking-[0.02em] text-platinum">B.L.A.Y.N.E</span>
        </Link>

        <Breadcrumbs trail={TRAIL} />

        <h1 className="mt-8 mb-1 text-2xl font-normal text-platinum">Privacy Policy</h1>
        <p className="m-0 mb-8 text-sm text-platinum/55">
          Also see the{' '}
          <Link to="/terms" className="text-jordy underline decoration-jordy/40 underline-offset-2 hover:decoration-jordy">
            Terms of Use
          </Link>{' '}
          and{' '}
          <Link
            to="/safety-addendum"
            className="text-jordy underline decoration-jordy/40 underline-offset-2 hover:decoration-jordy"
          >
            Advanced AI Model Safety Addendum
          </Link>
          .
        </p>

        <LegalDocument markdown={PRIVACY_POLICY_MD} />
      </div>
    </div>
  );
}
