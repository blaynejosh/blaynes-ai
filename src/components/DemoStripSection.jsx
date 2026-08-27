/**
 * Illustrative examples, one per Product Map category — a mocked prompt and
 * answer opening, not a transcript of a real session. Scroll-snaps
 * horizontally so it reads the same whether there's room for four columns
 * or one.
 */
const DEMOS = [
  {
    id: 'features',
    label: 'Features',
    tone: 'var(--color-jordy)',
    prompt: 'Draft a Proposal & SOW for a 6-week brand refresh.',
    answer:
      'Fixed six-week scope, three milestones — discovery, concept, final delivery — priced as one line item, not a rate card.',
  },
  {
    id: 'job-roles',
    label: 'Job Roles',
    tone: 'var(--color-tangerine)',
    prompt: "I'm a Head of Strategy — model our market-entry risk for Southeast Asia.",
    answer:
      'Three tiers of risk mapped against entry speed — regulatory, currency, channel access — and which one actually gates the timeline.',
  },
  {
    id: 'departments',
    label: 'Departments',
    tone: 'var(--color-icterine)',
    prompt: 'As Marketing, brief a Q3 campaign plan.',
    answer:
      'One channel carries most of the budget, on purpose — here is why, and the two numbers that tell you by week four if it is working.',
  },
  {
    id: 'startups',
    label: 'Start Ups',
    tone: 'var(--color-poppy)',
    prompt: "We're Series A — which of the 12 departments do we need first?",
    answer:
      'Not the one you are thinking of. Here is the org chart compressed to your headcount, and the one hire that unblocks the next two.',
  },
];

export default function DemoStripSection() {
  return (
    <section aria-labelledby="demo-heading" className="w-full border-t border-jordy/15 bg-delft">
      <div className="mx-auto max-w-[1160px] px-6 py-24 sm:px-10 lg:py-32">
        <p className="m-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">See it work</p>
        <h2
          id="demo-heading"
          className="display-h1 mt-6 mb-0 max-w-2xl text-[clamp(1.75rem,4vw,3rem)] leading-[1.1] font-normal tracking-[-0.02em] text-platinum"
        >
          One brief, four ways in.
        </h2>
        <p className="mt-5 mb-0 max-w-xl text-base leading-relaxed text-platinum/70">
          Illustrative examples of what a first message looks like from each entry point —
          not a real transcript, just the shape of the answer.
        </p>
      </div>

      <div className="mx-auto max-w-[1160px]">
        <div className="scrollbar-hidden -mt-4 flex gap-4 overflow-x-auto px-6 pb-4 sm:px-10">
          {DEMOS.map((d) => (
            <article
              key={d.id}
              className="material-chip w-[300px] shrink-0 overflow-hidden rounded-2xl border border-platinum/10 bg-platinum/8 sm:w-[340px]"
            >
              <header
                className="flex items-center gap-2 border-b border-platinum/10 px-4 py-3"
                style={{ borderBottomColor: d.tone, borderBottomWidth: 2 }}
              >
                <span className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2 w-2 rounded-full bg-platinum/20" />
                  <span className="h-2 w-2 rounded-full bg-platinum/20" />
                  <span className="h-2 w-2 rounded-full bg-platinum/20" />
                </span>
                <span className="ml-auto text-[10px] font-semibold tracking-[0.14em] text-platinum/45 uppercase">
                  {d.label}
                </span>
              </header>

              <div className="flex flex-col gap-3 p-4">
                <p className="m-0 rounded-lg border border-platinum/10 bg-platinum/5 px-3 py-2.5 text-[12.5px] leading-relaxed text-platinum/80">
                  {d.prompt}
                </p>
                <p className="m-0 text-[13px] leading-relaxed text-platinum/60">{d.answer}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
