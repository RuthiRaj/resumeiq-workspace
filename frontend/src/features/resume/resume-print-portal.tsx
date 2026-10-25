"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * The only body child that print CSS keeps. Rendering the sheet through a
 * portal lets us hide the whole app shell with one rule, so browser chrome,
 * notices, counters and controls can never leak into the printed page.
 */
export function ResumePrintPortal({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    document.body.classList.add("has-resume-print-root");
    return () => {
      document.body.classList.remove("has-resume-print-root");
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="resume-print-root"
      data-testid="resume-print-root"
      style={{ display: "none" }}
    >
      {children}
    </div>,
    document.body,
  );
}
