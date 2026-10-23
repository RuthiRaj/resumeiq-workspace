import { http, HttpResponse } from "msw";
import {
  addItem,
  deriveStandardResume,
  loadWorkspace,
  personaOf,
  reorderItems,
  restoreItem,
  setPersona,
  softDeleteItem,
  updateItem,
} from "./workspace-store";
import {
  currentFailureScope,
  failuresEnabled,
  setFailures,
  type FailureScope,
} from "./dev-state";
import {
  currentUserId,
  failIfEnabled,
  latency,
  storage,
  workspaceBody,
} from "./context";
import { importHandlers } from "./import-handlers";
import { privacyHandlers } from "./privacy-handlers";
import { resumeHandlers } from "./resume-handlers";
import { targetHandlers } from "./target-handlers";
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
import {
  WorkspaceItemSchema,
  WorkspacePersonaSchema,
  WorkspaceReorderInputSchema,
} from "@/lib/schemas";
import { z } from "zod";

/**
 * MSW handlers implementing the same endpoints the FastAPI backend will
 * expose later (PRD §8.3), so no UI rewrite is needed at integration (B7).
 * F2 adds: mock auth (signup/signin/OAuth/reset/session/signout) + AI
 * consent. F3 adds: the persistent workspace (versioning, change log, soft
 * delete/restore, reorder) and the derived standard resume. State lives in
 * localStorage so it survives reloads; handlers add ~350ms latency so loading
 * and sync states are exercisable (PRD §8.4: sync within 500ms).
 */

const SIGNUP_TIME = "2026-10-16T09:00:00.000Z";

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

const PasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

const ProfileBody = z.object({ name: NameSchema });

const ConsentBody = z.object({ aiProcessing: z.boolean() });

const CreateItemBody = WorkspaceItemSchema.omit({
  id: true,
  order: true,
  deletedAt: true,
});

const UpdateItemBody = WorkspaceItemSchema.omit({ id: true }).partial();

const PersonaBody = z.object({ persona: WorkspacePersonaSchema });
const FailuresBody = z.object({
  enabled: z.boolean(),
  scope: z.enum(["all", "capabilities", "export"]).default("all"),
});

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

  /**
   * Password change (settings). The mock keeps a plain-text stand-in, so this
   * is the only place the current password is compared; live mode re-verifies
   * with Supabase before calling `updateUser`.
   */
  http.post("/api/v1/auth/password", async ({ request }) => {
    await latency();
    const parsed = PasswordBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json(
        { error: "Check the password fields and try again." },
        { status: 400 },
      );
    }
    const store = storage();
    const session = loadSession(store);
    const user = session ? findUserByEmail(store, session.user.email) : null;
    if (!user) {
      return HttpResponse.json({ error: "Sign in again to change your password." }, { status: 401 });
    }
    if (!user.password) {
      return HttpResponse.json(
        { error: "This account signs in with a provider, so it has no password to change." },
        { status: 400 },
      );
    }
    if (user.password !== parsed.data.currentPassword) {
      return HttpResponse.json(
        { error: "Current password is incorrect. Nothing was changed." },
        { status: 400 },
      );
    }
    upsertUser(store, { ...user, password: parsed.data.newPassword });
    return HttpResponse.json({ ok: true });
  }),

  http.patch("/api/v1/auth/profile", async ({ request }) => {
    await latency();
    const parsed = ProfileBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Enter a name up to 80 characters." }, { status: 400 });
    }
    const store = storage();
    const session = loadSession(store);
    const user = session ? findUserByEmail(store, session.user.email) : null;
    if (!session || !user) {
      return HttpResponse.json({ error: "Sign in again to change your profile." }, { status: 401 });
    }
    const next: StoredUser = { ...user, name: parsed.data.name.trim() };
    upsertUser(store, next);
    const body = sessionResponse(next);
    saveSession(store, body.session);
    return HttpResponse.json(body);
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

export const workspaceHandlers = [
  http.get("/api/v1/workspace", async () => {
    await latency();
    return failIfEnabled() ?? HttpResponse.json(workspaceBody(currentUserId()));
  }),

  http.get("/api/v1/workspace/changelog", async () => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    const ws = loadWorkspace(storage(), currentUserId());
    // Newest first: the dashboard "recent changes" list reads top-down.
    return HttpResponse.json([...ws.changelog].sort((a, b) => b.seq - a.seq));
  }),

  http.post("/api/v1/workspace/items", async ({ request }) => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    const parsed = CreateItemBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json(
        { error: "Some fields need attention before this item can be saved." },
        { status: 422 },
      );
    }
    const userId = currentUserId();
    const ws = addItem(storage(), userId, { ...parsed.data, order: 0 });
    const createdId = [...ws.changelog].reverse().find((entry) => entry.op === "add")?.itemId;
    const created = ws.items.find((item) => item.id === createdId);
    return HttpResponse.json(created ?? { error: "not found" }, { status: 201 });
  }),

  http.patch("/api/v1/workspace/items/:id", async ({ request, params }) => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    const parsed = UpdateItemBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json(
        { error: "Some fields need attention before this item can be saved." },
        { status: 422 },
      );
    }
    try {
      const ws = updateItem(storage(), currentUserId(), String(params.id), parsed.data);
      const updated = ws.items.find((item) => item.id === params.id);
      return HttpResponse.json(updated);
    } catch {
      return HttpResponse.json({ error: "That workspace item no longer exists." }, { status: 404 });
    }
  }),

  http.delete("/api/v1/workspace/items/:id", async ({ params }) => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    try {
      softDeleteItem(storage(), currentUserId(), String(params.id));
      return new HttpResponse(null, { status: 204 });
    } catch {
      return HttpResponse.json({ error: "That workspace item no longer exists." }, { status: 404 });
    }
  }),

  http.post("/api/v1/workspace/items/:id/restore", async ({ params }) => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    try {
      const ws = restoreItem(storage(), currentUserId(), String(params.id));
      return HttpResponse.json(ws.items.find((item) => item.id === params.id));
    } catch {
      return HttpResponse.json({ error: "That workspace item no longer exists." }, { status: 404 });
    }
  }),

  http.post("/api/v1/workspace/reorder", async ({ request }) => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    const parsed = WorkspaceReorderInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Reorder request was malformed." }, { status: 422 });
    }
    const userId = currentUserId();
    reorderItems(storage(), userId, parsed.data);
    return HttpResponse.json(workspaceBody(userId));
  }),

  http.get("/api/v1/resume/standard", async () => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    const ws = loadWorkspace(storage(), currentUserId());
    return HttpResponse.json(deriveStandardResume(ws));
  }),

  // --- Dev-only fixture controls (never available outside `next dev`) ---
  http.get("/api/v1/dev/workspace-persona", async () => {
    if (process.env.NODE_ENV !== "development") {
      return HttpResponse.json({ error: "Not found." }, { status: 404 });
    }
    return HttpResponse.json({
      persona: personaOf(storage(), currentUserId()),
      failures: failuresEnabled(),
      failureScope: currentFailureScope(),
    });
  }),

  http.post("/api/v1/dev/workspace-persona", async ({ request }) => {
    if (process.env.NODE_ENV !== "development") {
      return HttpResponse.json({ error: "Not found." }, { status: 404 });
    }
    await latency();
    const parsed = PersonaBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Unknown persona." }, { status: 400 });
    }
    setPersona(storage(), currentUserId(), parsed.data.persona);
    return HttpResponse.json({ ok: true });
  }),

  http.post("/api/v1/dev/failures", async ({ request }) => {
    if (process.env.NODE_ENV !== "development") {
      return HttpResponse.json({ error: "Not found." }, { status: 404 });
    }
    const parsed = FailuresBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return HttpResponse.json({ error: "Expected { enabled: boolean }." }, { status: 400 });
    }
    setFailures(parsed.data.enabled, parsed.data.scope as FailureScope);
    return HttpResponse.json({
      enabled: parsed.data.enabled,
      scope: parsed.data.scope,
    });
  }),
];

/** All mock endpoints (workspace + auth + consent + F4 + F5). */
export const handlers = [
  ...workspaceHandlers,
  ...authHandlers,
  ...targetHandlers,
  ...resumeHandlers,
  ...importHandlers,
  ...privacyHandlers,
];
