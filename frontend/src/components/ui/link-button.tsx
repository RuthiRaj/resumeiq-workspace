import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button";

/**
 * A navigation control that looks exactly like a button. Real links stay real
 * links (middle-click, open-in-new-tab and keyboard all work), which a
 * `<Button onClick={router.push}>` would break.
 */
export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />;
}
