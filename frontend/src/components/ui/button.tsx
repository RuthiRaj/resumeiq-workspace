import * as React from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-action text-white hover:brightness-110 focus-visible:outline-accent-cyan",
  secondary:
    "glass text-text hover:bg-white/[0.09]",
  ghost: "text-text hover:bg-white/[0.06]",
  danger: "text-evidence-missing border border-evidence-missing/30 hover:bg-evidence-missing/10",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-[filter,background-color,color] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50";

/** Shared class recipe so links can look like buttons without a Button wrapper. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(BUTTON_BASE, variantClasses[variant], sizeClasses[size], className);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, className })}
      {...props}
    />
  ),
);
Button.displayName = "Button";
