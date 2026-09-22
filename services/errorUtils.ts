/**
 * Resolves an error into a user-facing translated message.
 *
 * Pattern: Services throw errors with i18n keys as messages (e.g. "error_quota_exhausted").
 * This helper looks up the key in the translations object and falls back gracefully.
 *
 * @param err - The caught error (any type)
 * @param t - The current translations object
 * @param fallbackKey - Optional translation key for the fallback message
 * @returns A user-facing error string
 */
export const resolveErrorMessage = (
  err: unknown,
  t: Record<string, string>,
  fallbackKey?: string,
): string => {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";

  // 1. Try to look up the error message as a translation key
  if (message && message in t) {
    return t[message];
  }

  // 2. If the message looks like a raw i18n key (no spaces, starts with "error_"),
  //    don't show it to the user — use fallback instead
  if (message && /^error_\w+$/.test(message)) {
    return fallbackKey && fallbackKey in t
      ? t[fallbackKey]
      : t.generationFailed || message;
  }

  // 3. Use the raw error message if it's a readable string
  if (message) {
    return message;
  }

  // 4. Ultimate fallback
  return fallbackKey && fallbackKey in t
    ? t[fallbackKey]
    : t.generationFailed || "An error occurred";
};
