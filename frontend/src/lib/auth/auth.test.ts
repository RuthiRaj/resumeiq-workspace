import { describe, expect, it } from "vitest";
import {
  ForgotPasswordSchema,
  SigninSchema,
  SignupSchema,
} from "./schemas";
import {
  clearSession,
  findUserByEmail,
  loadSession,
  loadUsers,
  mockToken,
  mockUserId,
  saveSession,
  saveUsers,
  upsertUser,
  type KeyValueStorage,
  type StoredUser,
} from "./store";

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage {
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

const USER: StoredUser = {
  id: "user-1",
  name: "Ada Example",
  email: "ada@example.com",
  provider: "password",
  createdAt: "2026-10-16T09:00:00.000Z",
  password: "secret123",
};

describe("auth schemas", () => {
  it("accepts a valid signup", () => {
    const res = SignupSchema.safeParse({
      name: "Ada Example",
      email: "ada@example.com",
      password: "secret123",
    });
    expect(res.success).toBe(true);
  });

  it("rejects short names, bad emails and weak passwords", () => {
    expect(SignupSchema.safeParse({ name: "A", email: "ada@example.com", password: "secret123" }).success).toBe(false);
    expect(SignupSchema.safeParse({ name: "Ada", email: "not-an-email", password: "secret123" }).success).toBe(false);
    expect(SignupSchema.safeParse({ name: "Ada", email: "ada@example.com", password: "short" }).success).toBe(false);
    expect(SignupSchema.safeParse({ name: "Ada", email: "ada@example.com", password: "allletters" }).success).toBe(false);
  });

  it("requires a non-empty password on signin (server decides validity)", () => {
    expect(SigninSchema.safeParse({ email: "ada@example.com", password: "" }).success).toBe(false);
    expect(SigninSchema.safeParse({ email: "ada@example.com", password: "wrong" }).success).toBe(true);
  });

  it("validates forgot-password email", () => {
    expect(ForgotPasswordSchema.safeParse({ email: "ada@example.com" }).success).toBe(true);
    expect(ForgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("mock user store", () => {
  it("starts empty and round-trips users", () => {
    const storage = memoryStorage();
    expect(loadUsers(storage)).toEqual([]);
    saveUsers(storage, [USER]);
    expect(loadUsers(storage)).toEqual([USER]);
  });

  it("finds users case-insensitively and tolerates corrupt JSON", () => {
    const storage = memoryStorage();
    saveUsers(storage, [USER]);
    expect(findUserByEmail(storage, "ADA@EXAMPLE.COM")?.id).toBe("user-1");
    expect(findUserByEmail(storage, "nobody@example.com")).toBeNull();
    expect(loadUsers(memoryStorage({ "riq.mock-users": "not-json{" }))).toEqual([]);
  });

  it("upserts by id without duplicating", () => {
    const storage = memoryStorage();
    upsertUser(storage, USER);
    upsertUser(storage, { ...USER, name: "Ada Updated" });
    const users = loadUsers(storage);
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Ada Updated");
  });
});

describe("mock session persistence", () => {
  it("persists across reloads (same storage) and clears on sign out", () => {
    const storage = memoryStorage();
    expect(loadSession(storage)).toBeNull();
    const session = { user: USER, token: "mock.token", createdAt: USER.createdAt };
    saveSession(storage, session);
    expect(loadSession(storage)).toEqual(session);
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
  });

  it("rejects malformed sessions", () => {
    const storage = memoryStorage({ "riq.session": JSON.stringify({ user: null }) });
    expect(loadSession(storage)).toBeNull();
  });
});

describe("mock identity helpers", () => {
  it("derives stable ids and tokens per email", () => {
    expect(mockUserId("ada@example.com")).toBe(mockUserId("ada@example.com"));
    expect(mockUserId("ada@example.com")).not.toBe(mockUserId("bob@example.com"));
    expect(mockToken("user-1", "2026-10-16T09:00:00.000Z")).toContain("user-1");
  });
});
