const FAQS = [
  {
    q: 'Is BLAYNE really AI, or a team of people relaying answers?',
    a: 'BLAYNE runs on Claude, Anthropic’s model family, served through Google Cloud Vertex AI. No one relays or edits your message — the model answers directly, grounded in the frameworks and standards named on the How We Work page.',
  },
  {
    q: 'What happens to what I share with it?',
    a: 'Brand documents you upload are stored in a private cloud bucket tied to this project, not a shared third-party file store. Chat content is sent to Claude to generate your answer and is not used to train models.',
  },
  {
    q: 'How many messages do I get?',
    a: "You're on the beta, so every tester gets 25 messages a day while capacity scales up — the composer shows how many you have left. Every feature and every layer of the Product Map is open to every tester, no separate tier.",
  },
  {
    q: 'Will it replace my lawyer, accountant, or actual consultants?',
    a: "No. BLAYNE will flag when a decision needs a human at Blayne's Consulting and verify regulatory or compliance detail against a current source rather than recite it from memory — but it won't claim to be a licensed lawyer, accountant, or financial adviser, or guarantee an outcome.",
  },
  {
    q: 'How do I get access?',
    a: 'Sign-up is open now — Google or an email magic link, no waitlist. A short first-time form asks about your company and what you’d use BLAYNE for; after that you’re straight into the Product Map.',
  },
];

export default function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="w-full border-t border-jordy/15 bg-delft">
      <div className="mx-auto max-w-[820px] px-6 py-24 sm:px-10 lg:py-32">
        <p className="m-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">FAQ</p>
        <h2
          id="faq-heading"
          className="mt-6 mb-0 text-[clamp(1.75rem,4vw,3rem)] leading-[1.1] font-normal tracking-[-0.02em] text-platinum"
        >
          Questions worth answering upfront.
        </h2>

        <div className="mt-12 flex flex-col gap-3">
          {FAQS.map((item) => (
            <details
              key={item.q}
              className="material-chip group rounded-2xl bg-white/5 px-5 py-4 open:bg-white/[0.07] sm:px-6"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-normal text-platinum [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  aria-hidden="true"
                  className="shrink-0 text-platinum/40 transition-transform duration-200 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 mb-0 text-sm leading-relaxed text-platinum/70">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
