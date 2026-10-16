import type { Session, SessionUser } from "./types";

/**
 * Minimal storage abstraction so session persistence is unit-testable
 * without a DOM. Defaults to `localStorage` in the browser.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SESSION_KEY = "riq.session";
export const USERS_KEY = "riq.mock-users";

export type StoredUser = SessionUser & {
  /** Mock only: plain-text stand-in. Real passwords live in Supabase Auth. */
  password: string | null;
};

function readJson<T>(storage: KeyValueStorage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadUsers(storage: KeyValueStorage): StoredUser[] {
  const users = readJson<StoredUser[]>(storage, USERS_KEY, []);
  return Array.isArray(users) ? users : [];
}

export function saveUsers(storage: KeyValueStorage, users: StoredUser[]): void {
  storage.setItem(USERS_KEY, JSON.stringify(users));
}

export function findUserByEmail(
  storage: KeyValueStorage,
  email: string,
): StoredUser | null {
  const needle = email.trim().toLowerCase();
  return loadUsers(storage).find((u) => u.email.toLowerCase() === needle) ?? null;
}

export function upsertUser(storage: KeyValueStorage, user: StoredUser): void {
  const users = loadUsers(storage).filter((u) => u.id !== user.id);
  users.push(user);
  saveUsers(storage, users);
}

export function loadSession(storage: KeyValueStorage): Session | null {
  const session = readJson<Session | null>(storage, SESSION_KEY, null);
  if (!session?.user || !session.token) return null;
  return session;
}

export function saveSession(storage: KeyValueStorage, session: Session): void {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(storage: KeyValueStorage): void {
  storage.removeItem(SESSION_KEY);
}

/** Browser `localStorage`, guarded for SSR / non-DOM runtimes. */
export function browserStorage(): KeyValueStorage | null {
  if (typeof window === "undefined" || !("localStorage" in window)) return null;
  return window.localStorage;
}

/** Deterministic mock ids/tokens for the MSW layer (no Math.random in handlers). */
export function mockUserId(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return `user-${hash.toString(36)}`;
}

export function mockToken(userId: string, createdAt: string): string {
  return `mock.${userId}.${createdAt}`;
}
