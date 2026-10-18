import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The dev route indicator is a floating overlay that owns the first keyboard
  // tab stops in development (its contents live in a shadow root, so focus
  // appears "stuck" on `nextjs-portal`). It is dev-only chrome, it is absent
  // from any production build, and it makes an honest keyboard sweep of the app
  // impossible. Hide it; compile and runtime errors are still surfaced (ADR-026).
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
