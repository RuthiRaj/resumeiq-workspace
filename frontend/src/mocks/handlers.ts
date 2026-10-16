import { http, HttpResponse } from "msw";
import { fixtureItems, fixtureWorkspaceVersion } from "./fixtures";
import {
  clearSession,
  findUserByEmail,
  loadSession,
  mockToken,
  mockUserId,
  saveSession,
  upsertUser,
  type StoredUser,
} from "@/lib/auth/store";
import { EmailSchema, NameSchema, OAuthProviderSchema } from "@/lib/auth/schemas";
import {
  AI_PROVIDER_DISCLOSURE,
  clearConsent as clearConsentRecord,
  loadConsent,
  saveConsent,
} from "@/lib/privacy/consent";
import { z } from "zod";

/**
 * MSW handlers implementing the same endpoints the FastAPI backend will
 * expose later (PRD §8.3), so no UI rewrite is needed at integration (B7).
 * F2 adds: mock auth (signup/signin/OAuth/reset/session/signout) + AI
 * consent. State lives in localStorage so the mock session persists across
 * reloads; handlers add ~350ms latency so loading states are exercisable.
 */

const SIGNUP_TIME = "2026-10-16T09:00:00.000Z";

function storage(): Storage {
  // Handlers run in the browser worker; localStorage is always available.
  return window.localStorage;
}

const SignupBody = z.object({
  name: NameSchema,
  email: EmailSchema,
  password: z.string().min(8).max(128),
});

const SigninBody = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

const OAuthBody = z.object({ provider: OAuthProviderSchema });

const ResetBody = z.object({ email: EmailSchema });

const ConsentBody = z.object({ aiProcessing: z.boolean() });

async function latency(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
}

function sessionResponse(user: StoredUser) {
  return {
    session: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        provider: user.provider,
        createdAt: user.createdAt,
      },
      token: mockToken(user.id, user.createdAt),
      createdAt: user.createdAt,
    },
  };
}

export const authHandlers = [
  http.post("/api/v1/auth/signup", async ({ request }) => {
    await latency();
    const parsed = SignupBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Check the highlighted fields and try again." }, { status: 400 });
    }
    const { name, email, password } = parsed.data;
    const store = storage();
    if (findUserByEmail(store, email)) {
      return HttpResponse.json(
        { error: "An account with this email already exists. Try signing in." },
        { status: 409 },
      );
    }
    const user: StoredUser = {
      id: mockUserId(email.trim().toLowerCase()),
      name: name.trim(),
      email: email.trim(),
      provider: "password",
      createdAt: SIGNUP_TIME,
      password,
    };
    upsertUser(store, user);
    const body = sessionResponse(user);
    saveSession(store, body.session);
    return HttpResponse.json(body, { status: 201 });
  }),

  http.post("/api/v1/auth/signin", async ({ request }) => {
    await latency();
    const parsed = SigninBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Check the highlighted fields and try again." }, { status: 400 });
    }
    const store = storage();
    const user = findUserByEmail(store, parsed.data.email);
    if (!user || user.password !== parsed.data.password) {
      return HttpResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    const body = sessionResponse(user);
    saveSession(store, body.session);
    return HttpResponse.json(body);
  }),

  // Mocked OAuth: deterministic per-provider demo identity (F2 only).
  http.post("/api/v1/auth/oauth", async ({ request }) => {
    await latency();
    const parsed = OAuthBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Unknown provider." }, { status: 400 });
    }
    const store = storage();
    const email = `demo.${parsed.data.provider}@example.com`;
    const existing = findUserByEmail(store, email);
    const user: StoredUser = existing ?? {
      id: mockUserId(email),
      name: "Demo User",
      email,
      provider: parsed.data.provider,
      createdAt: SIGNUP_TIME,
      password: null,
    };
    upsertUser(store, user);
    const body = sessionResponse(user);
    saveSession(store, body.session);
    return HttpResponse.json(body);
  }),

  // Always succeeds (avoids account enumeration); mock only.
  http.post("/api/v1/auth/password-reset", async ({ request }) => {
    await latency();
    const parsed = ResetBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    return HttpResponse.json({
      message: `If an account exists for ${parsed.data.email.trim()}, a reset link is on its way.`,
    });
  }),

  http.get("/api/v1/auth/session", async () => {
    const session = loadSession(storage());
    if (!session) {
      return HttpResponse.json({ error: "No active session." }, { status: 401 });
    }
    const user = findUserByEmail(storage(), session.user.email);
    if (!user) {
      clearSession(storage());
      return HttpResponse.json({ error: "No active session." }, { status: 401 });
    }
    return HttpResponse.json(sessionResponse(user));
  }),

  http.post("/api/v1/auth/signout", async () => {
    await latency();
    clearSession(storage());
    return HttpResponse.json({ ok: true });
  }),

  http.get("/api/v1/privacy/consent", async () => {
    return HttpResponse.json({ consent: loadConsent(storage()) });
  }),

  http.post("/api/v1/privacy/consent", async ({ request }) => {
    await latency();
    const parsed = ConsentBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Consent choice is required." }, { status: 400 });
    }
    const consent = saveConsent(storage(), {
      aiProcessing: parsed.data.aiProcessing,
      provider: AI_PROVIDER_DISCLOSURE,
      recordedAt: SIGNUP_TIME,
    });
    return HttpResponse.json({ consent });
  }),

  http.delete("/api/v1/privacy/consent", async () => {
    clearConsentRecord(storage());
    return HttpResponse.json({ consent: null });
  }),
];

export const handlers = [
  http.get("/api/v1/workspace", () =>
    HttpResponse.json({
      version: fixtureWorkspaceVersion,
      items: fixtureItems,
      updatedAt: SIGNUP_TIME,
    }),
  ),

  http.get("/api/v1/resume/standard", () =>
    HttpResponse.json({
      id: "resume-standard",
      kind: "standard",
      workspaceVersion: fixtureWorkspaceVersion,
      stale: false,
      sections: [],
      createdAt: SIGNUP_TIME,
      updatedAt: SIGNUP_TIME,
    }),
  ),

  ...authHandlers,
];
