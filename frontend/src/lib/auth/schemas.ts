import { z } from "zod";

/** Auth form contracts (F2). Screens validate with these; the mock API reuses them. */

export const NameSchema = z
  .string()
  .trim()
  .min(2, "Enter your full name (at least 2 characters).")
  .max(80, "Name must be 80 characters or fewer.");

export const EmailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("Enter a valid email address.")
  .max(254, "Email must be 254 characters or fewer.");

export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

export const SignupSchema = z.object({
  name: NameSchema,
  email: EmailSchema,
  password: PasswordSchema,
});
export type SignupInput = z.infer<typeof SignupSchema>;

export const SigninSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, "Password is required.").max(128),
});
export type SigninInput = z.infer<typeof SigninSchema>;

export const ForgotPasswordSchema = z.object({
  email: EmailSchema,
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const OAuthProviderSchema = z.enum(["google", "github"]);
export type OAuthProvider = z.infer<typeof OAuthProviderSchema>;
