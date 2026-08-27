/**
 * The narrative case for BLAYNE, sitting right under the hero/USP: not a
 * feature list, but why an on-demand consulting team beats the queue a
 * traditional engagement puts you in.
 */
const OLD_WAY = [
  'A scoping call before you get an actual answer',
  'Each discipline is its own hire, its own ramp-up time',
  'Turnaround measured in days, once resourcing is confirmed',
  'You get the conclusion — the reasoning stays with the consultant',
];

const WITH_BLAYNE = [
  'Brief it and the answer starts streaming back immediately',
  'One place, every discipline — brand, strategy, product, marketing, sales, finance',
  'Available the moment you need it, day or night',
  'Reasoning shown alongside the answer, confidence stated plainly',
];

export default function StorySection() {
  return (
    <section
      id="story"
      aria-labelledby="story-heading"
      className="w-full border-t border-jordy/15 bg-delft"
    >
      <div className="mx-auto max-w-[1160px] px-6 py-24 sm:px-10 lg:py-32">
        <p className="m-0 text-xs tracking-[0.22em] text-jordy/80 uppercase">The story</p>

        <h2
          id="story-heading"
          className="display-h1 mt-6 mb-0 max-w-3xl text-[clamp(2rem,5vw,3.75rem)] leading-[1.08] font-normal tracking-[-0.02em] text-platinum"
        >
          Consulting used to mean a queue.
          <br />
          <span className="accent text-jordy">BLAYNE means an answer now.</span>
        </h2>

        <p className="mt-8 mb-0 max-w-2xl text-lg leading-relaxed text-platinum/75">
          Every department of a fully staffed company, distilled into one place you can
          talk to. No scoping call, no ramp-up, no handoff between specialists — brief it
          once and BLAYNE answers with the framework a senior consultant in that
          discipline would actually use.
        </p>

        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          <div className="material-chip rounded-2xl bg-platinum/5 p-6 sm:p-8">
            <h3 className="m-0 text-[15px] font-normal text-platinum/60">The old way</h3>
            <ul className="m-0 mt-5 flex list-none flex-col gap-3 p-0">
              {OLD_WAY.map((line) => (
                <li
                  key={line}
                  className="flex gap-3 text-sm leading-relaxed text-platinum/70"
                >
                  <span aria-hidden="true" className="text-platinum/30">
                    –
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="material-chip rounded-2xl bg-jordy/10 p-6 sm:p-8">
            <h3 className="m-0 text-[15px] font-normal text-platinum">With BLAYNE</h3>
            <ul className="m-0 mt-5 flex list-none flex-col gap-3 p-0">
              {WITH_BLAYNE.map((line) => (
                <li key={line} className="flex gap-3 text-sm leading-relaxed text-platinum/85">
                  <span aria-hidden="true" className="text-jordy">
                    +
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
