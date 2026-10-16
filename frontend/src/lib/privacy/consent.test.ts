import { describe, expect, it } from "vitest";
import {
  clearConsent,
  hasGrantedConsent,
  loadConsent,
  saveConsent,
} from "./consent";

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStorage(seed: Record<string, string> = {}): MemoryStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("consent record", () => {
  it("starts empty and is not granted", () => {
    const storage = memoryStorage();
    expect(loadConsent(storage)).toBeNull();
    expect(hasGrantedConsent(null)).toBe(false);
  });

  it("round-trips a granted consent with provider disclosure", () => {
    const storage = memoryStorage();
    const consent = saveConsent(storage, {
      aiProcessing: true,
      recordedAt: "2026-10-16T09:00:00.000Z",
    });
    expect(consent.version).toBe(1);
    expect(consent.provider.length).toBeGreaterThan(0);
    expect(loadConsent(storage)).toEqual(consent);
    expect(hasGrantedConsent(loadConsent(storage))).toBe(true);
  });

  it("distinguishes declined consent from missing consent", () => {
    const storage = memoryStorage();
    saveConsent(storage, { aiProcessing: false, recordedAt: "2026-10-16T09:00:00.000Z" });
    const loaded = loadConsent(storage);
    expect(loaded?.aiProcessing).toBe(false);
    expect(hasGrantedConsent(loaded)).toBe(false);
  });

  it("rejects corrupt or wrong-version records and clears cleanly", () => {
    const corrupt = memoryStorage({ "riq.consent": "not-json{" });
    expect(loadConsent(corrupt)).toBeNull();
    const wrongVersion = memoryStorage({
      "riq.consent": JSON.stringify({
        aiProcessing: true,
        provider: "x",
        recordedAt: "2026-10-16T09:00:00.000Z",
        version: 99,
      }),
    });
    expect(loadConsent(wrongVersion)).toBeNull();

    const storage = memoryStorage();
    saveConsent(storage, { aiProcessing: true, recordedAt: "2026-10-16T09:00:00.000Z" });
    clearConsent(storage);
    expect(loadConsent(storage)).toBeNull();
  });
});
