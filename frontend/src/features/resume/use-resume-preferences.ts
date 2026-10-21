"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_RESUME_PREFERENCES,
  RESUME_PREFERENCES_KEY,
  loadResumePreferences,
  saveResumePreferences,
  type ResumePreferences,
} from "./resume-preferences";

/**
 * Standard-resume presentation preferences, kept in localStorage but exposed
 * through `useSyncExternalStore`. That gives the server a deterministic default
 * and lets an edit paint immediately without a setState-in-effect cascade.
 */

const UPDATE_EVENT = "riq:resume-preferences-updated";
let cache: ResumePreferences | null = null;

function getSnapshot(): ResumePreferences {
  if (!cache) cache = loadResumePreferences();
  return cache;
}

function getServerSnapshot(): ResumePreferences {
  return DEFAULT_RESUME_PREFERENCES;
}

function subscribe(onChange: () => void): () => void {
  const onLocalUpdate = () => onChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== RESUME_PREFERENCES_KEY) return;
    cache = null;
    onChange();
  };
  window.addEventListener(UPDATE_EVENT, onLocalUpdate);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(UPDATE_EVENT, onLocalUpdate);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: ResumePreferences): void {
  cache = next;
  saveResumePreferences(next);
  window.dispatchEvent(new Event(UPDATE_EVENT));
}

export function useResumePreferences() {
  const preferences = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const update = useCallback((patch: Partial<ResumePreferences>) => {
    write({ ...getSnapshot(), ...patch });
  }, []);

  const reset = useCallback(() => {
    write(DEFAULT_RESUME_PREFERENCES);
  }, []);

  return { preferences, update, reset };
}
