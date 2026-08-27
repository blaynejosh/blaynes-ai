import Hero from './Hero.jsx';
import UspSection from './UspSection.jsx';
import StorySection from './StorySection.jsx';
import MapSection from './MapSection.jsx';
import DemoStripSection from './DemoStripSection.jsx';
import ProcessSection from './ProcessSection.jsx';
import FaqSection from './FaqSection.jsx';
import GetStartedSection from './GetStartedSection.jsx';
import SiteFooter from './SiteFooter.jsx';
import { MAP_SECTIONS } from '../data/productMap.js';

/**
 * Home page: hero -> value statement -> narrative -> one section per layer
 * of the Product Map -> illustrative demo strip -> process -> FAQ -> access
 * CTA -> footer.
 *
 * The hero's four Explore pills open the chat surface for that layer; the
 * map sections below are the scrollable explanation of what each layer
 * contains, each with its own way in.
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

      {MAP_SECTIONS.map((section) => (
        <MapSection key={section.id} {...section} />
      ))}

      <DemoStripSection />
      <ProcessSection />
      <FaqSection />
      <GetStartedSection />

      <SiteFooter />
    </div>
  );
}
