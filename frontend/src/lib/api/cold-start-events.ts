/**
 * Simple event emitter for cold-start retry state.
 * Allows the API client to notify UI components of retry progress.
 */

type ColdStartEvent = "retry" | "success" | "exhausted";

const listeners = new Map<ColdStartEvent, Set<() => void>>();

export function onColdStart(event: ColdStartEvent, listener: () => void): () => void {
  const set = listeners.get(event) ?? new Set();
  set.add(listener);
  listeners.set(event, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(event);
  };
}

export function emitColdStart(event: ColdStartEvent): void {
  const set = listeners.get(event);
  if (set) {
    set.forEach((listener) => listener());
  }
}

export function clearColdStartListeners(): void {
  listeners.clear();
}