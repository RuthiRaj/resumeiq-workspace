/**
 * Auth domain types + client interface (F2).
 *
 * Every screen talks to `AuthClient`, never to `fetch` directly, so Supabase
 * Auth can replace `mockAuthClient` later without touching the screens
 * (PRD §5: auth is in scope; provider swap planned at B7).
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  /** How this session was created — password vs mocked OAuth. */
  provider: "password" | "google" | "github";
  createdAt: string;
}

export interface Session {
  user: SessionUser;
  /** Opaque mock token. Never a real credential; replaced by Supabase JWT. */
  token: string;
  createdAt: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_credentials"
      | "email_taken"
      | "validation"
      | "email_confirmation_required"
      | "network"
      | "unknown",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface SignupParams {
  name: string;
  email: string;
  password: string;
}

export interface SigninParams {
  email: string;
  password: string;
}

export interface AuthClient {
  getSession(): Promise<Session | null>;
  signUp(params: SignupParams): Promise<Session>;
  signIn(params: SigninParams): Promise<Session>;
  signInWithOAuth(provider: "google" | "github"): Promise<Session>;
  requestPasswordReset(email: string): Promise<{ message: string }>;
  signOut(): Promise<void>;
  /**
   * Live transport only: pushes auth-state changes (sign-out, refresh) so the
   * provider can react without polling. Returns an unsubscribe function.
   */
  subscribe?(
    listener: (session: Session | null) => void,
  ): Promise<() => void>;
}
