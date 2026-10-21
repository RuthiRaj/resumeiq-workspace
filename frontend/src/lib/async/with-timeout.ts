/** Raised when a live request exceeds its deadline. */
export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export const DEFAULT_LIVE_TIMEOUT_MS = 15_000;

/**
 * Give a promise a deadline.
 *
 * Live auth and consent calls go through third-party endpoints; without a
 * deadline a hung request leaves the UI on "Signing in…" or on the consent
 * gate forever (S-09). The rejection carries user-facing copy and never the
 * underlying error, so nothing sensitive can leak through it.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number = DEFAULT_LIVE_TIMEOUT_MS,
  message = "That took too long. Check your connection and try again.",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RequestTimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
