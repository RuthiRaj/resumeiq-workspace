/**
 * Browser print fallback for the shared resume document.
 *
 * Chrome uses the document title as the default "Save as PDF" filename, so the
 * temporary title is exactly `<Name> - Resume`. The previous title is restored
 * after printing; the timeout covers browsers where `window.print()` is not
 * blocking and `afterprint` is unreliable.
 */
export function printResumeDocument(name: string): void {
  if (typeof window === "undefined") return;

  const previous = document.title;
  document.title = name ? `${name} - Resume` : "Resume";

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };

  window.addEventListener("afterprint", restore, { once: true });
  try {
    window.print();
  } finally {
    window.setTimeout(restore, 1_000);
  }
}
