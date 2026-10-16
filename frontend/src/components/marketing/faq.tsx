import { FaqAccordion } from "@/components/marketing/faq-accordion";

/** FAQ section (server): headings SSR statically; behaviour is an island. */
export function Faq() {
  return (
    <section aria-labelledby="faq-heading" className="relative">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
          Questions
        </p>
        <h2 id="faq-heading" className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">
          Frequently asked
        </h2>
        <FaqAccordion />
      </div>
    </section>
  );
}
