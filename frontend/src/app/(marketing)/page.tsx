import Link from "next/link";
import { Hero } from "@/components/marketing/hero";
import { Narrative } from "@/components/marketing/narrative";
import { Trust } from "@/components/marketing/trust";
import { Faq } from "@/components/marketing/faq";
import { Button } from "@/components/ui/button";

/**
 * Cinematic landing (F1). The R3F hero is code-split and client-only;
 * everything else is static, semantic HTML.
 */
export default function LandingPage() {
  return (
    <main>
      <Hero />
      <Narrative />
      <Trust />
      <div id="faq" className="scroll-mt-16">
        <Faq />
      </div>

      <section aria-labelledby="cta-heading" className="relative overflow-hidden">
        <div aria-hidden="true" className="glow-cyan absolute left-1/2 top-0 h-[300px] w-[700px] -translate-x-1/2" />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-5 px-6 py-24 text-center">
          <h2 id="cta-heading" className="font-display text-4xl tracking-tight sm:text-5xl">
            Start with what&apos;s true.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-muted sm:text-base">
            Build your workspace once. Walk into every application with a
            resume you can defend — line by line.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg">Start your workspace</Button>
            </Link>
            <Link href="/signin">
              <Button size="lg" variant="secondary">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
