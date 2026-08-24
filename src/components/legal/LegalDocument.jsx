import ReactMarkdown from 'react-markdown';

/**
 * Shared prose layout for the legal surfaces (Safety Addendum, Terms of Use,
 * Privacy Policy). Markdown lives in src/lib/legalContent.js; this just
 * renders it with consistent typography against the app's palette.
 */
export default function LegalDocument({ markdown }) {
  return (
    <div
      className="
        [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-[15px] [&_h3]:font-medium [&_h3]:tracking-[0.01em] [&_h3]:text-platinum
        [&_p]:my-3 [&_p]:text-[14.5px] [&_p]:leading-relaxed [&_p]:text-platinum/75
        [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5
        [&_li]:my-1.5 [&_li]:text-[14.5px] [&_li]:leading-relaxed [&_li]:text-platinum/75
        [&_strong]:font-medium [&_strong]:text-platinum
        [&_em]:not-italic [&_em]:text-platinum/55
        [&_a]:text-jordy [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-jordy/40 hover:[&_a]:decoration-jordy
        [&_h3:first-child]:mt-0
      "
    >
      <ReactMarkdown>{markdown}</ReactMarkdown>
    </div>
  );
}
