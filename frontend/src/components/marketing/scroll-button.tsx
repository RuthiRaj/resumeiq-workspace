"use client";

import { Button } from "@/components/ui/button";
import { scrollToSection } from "@/components/marketing/smooth-scroll";

/** Secondary hero CTA: smooth-scrolls to the narrative (falls back to native). */
export function ScrollButton() {
  return (
    <Button
      size="lg"
      variant="secondary"
      onClick={() => scrollToSection("how-it-works")}
    >
      See how it works
    </Button>
  );
}
