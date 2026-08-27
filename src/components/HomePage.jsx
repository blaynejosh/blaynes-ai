import Hero from './Hero.jsx';
import UspSection from './UspSection.jsx';
import StorySection from './StorySection.jsx';
import ProductMapSection from './ProductMapSection.jsx';
import DemoStripSection from './DemoStripSection.jsx';
import ProcessSection from './ProcessSection.jsx';
import FaqSection from './FaqSection.jsx';
import GetStartedSection from './GetStartedSection.jsx';
import SiteFooter from './SiteFooter.jsx';

/**
 * Home page: hero -> value statement -> narrative -> the Product Map (one
 * tabbed section for all four layers) -> illustrative demo strip -> process
 * -> FAQ -> access CTA -> footer.
 *
 * The hero's four Explore pills open the chat surface for that layer
 * directly; ProductMapSection is the scrollable explanation of what each
 * layer contains, reached by scrolling or via the `#features` anchor.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-full flex-col items-center bg-delft">
      {/* Both hero layouts point their aria-labelledby at this. */}
      <h1 id="hero-heading" className="sr-only">
        BLAYNE — your consulting team, on demand
      </h1>

      <Hero />
      <UspSection />
      <StorySection />
      <ProductMapSection />
      <DemoStripSection />
      <ProcessSection />
      <FaqSection />
      <GetStartedSection />

      <SiteFooter />
    </div>
  );
}
