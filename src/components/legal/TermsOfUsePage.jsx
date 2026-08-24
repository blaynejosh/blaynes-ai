import { Link } from 'react-router-dom';
import BlayneMark from '../BlayneMark.jsx';
import LegalDocument from './LegalDocument.jsx';
import { TERMS_OF_USE_MD } from '../../lib/legalContent.js';

export default function TermsOfUsePage() {
  return (
    <div className="min-h-svh bg-delft px-6 py-14">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/"
          aria-label="BLAYNE home"
          className="pressable inline-flex items-center gap-3 no-underline transition-opacity hover:opacity-80"
        >
          <BlayneMark className="h-9 w-9" />
          <span className="text-[15px] tracking-[0.02em] text-platinum">B.L.A.Y.N.E</span>
        </Link>

        <h1 className="mt-8 mb-1 text-2xl font-normal text-platinum">Terms of Use</h1>
        <p className="m-0 mb-8 text-sm text-platinum/55">
          Also see the{' '}
          <Link to="/privacy" className="text-jordy underline decoration-jordy/40 underline-offset-2 hover:decoration-jordy">
            Privacy Policy
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

        <LegalDocument markdown={TERMS_OF_USE_MD} />
      </div>
    </div>
  );
}
