import { describe, expect, it } from "vitest";
import { sessionFromSupabase } from "./supabase";

/**
 * The live adapter's pure mapping. No network and no Supabase client is
 * created, so these assertions also prove the module can be imported without
 * a configured project.
 */

describe("sessionFromSupabase", () => {
  it("maps a password session and keeps the access token opaque", () => {
    const session = {
      access_token: "header.payload.signature",
      expires_at: 1_900_000_000,
      user: {
        id: "user-1",
        email: "ada@example.com",
        created_at: "2026-10-01T09:00:00.000Z",
        app_metadata: { provider: "email" },
        user_metadata: { name: "Ada Lovelace" },
      },
    };

    const mapped = sessionFromSupabase(session as never);

    expect(mapped).toEqual({
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        provider: "password",
        createdAt: "2026-10-01T09:00:00.000Z",
      },
      token: "header.payload.signature",
      createdAt: "2026-10-01T09:00:00.000Z",
    });
  });

  it("uses an OAuth provider when Supabase reports one", () => {
    const mapped = sessionFromSupabase({
      access_token: "token",
      user: {
        id: "user-2",
        email: "grace@example.com",
        created_at: "2026-10-01T09:00:00.000Z",
        app_metadata: { provider: "github" },
        user_metadata: {},
      },
    } as never);

    expect(mapped?.user.provider).toBe("github");
    expect(mapped?.user.name).toBe("grace");
  });

  it("returns null when the session has no token", () => {
    expect(
      sessionFromSupabase({ access_token: "", user: { id: "u" } } as never),
    ).toBeNull();
  });
});
