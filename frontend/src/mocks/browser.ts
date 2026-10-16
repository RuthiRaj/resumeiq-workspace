import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/** MSW browser worker (dev + preview). Started from `providers.tsx` in dev. */
export const worker = setupWorker(...handlers);
