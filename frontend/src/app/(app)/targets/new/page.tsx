import { TargetForm } from "@/features/targets/target-form";

/**
 * `/targets/new` (PRD §6.4 JD-1). The intake form and the consent gate; the
 * analysis itself starts on `/targets/[id]`.
 */
export const instant = false;

export default function NewTargetPage() {
  return (
    <div className="flex flex-col gap-6 py-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
          New job target
        </p>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
          What are you applying for?
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          Paste the posting as it was written. We quote its wording back to you,
          match each requirement against your own evidence, and mark anything
          you&apos;d need to build before claiming it.
        </p>
      </header>
      <TargetForm />
    </div>
  );
}
