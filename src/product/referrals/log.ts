/**
 * Logs a referral failure without ever passing the error text to a client.
 * Uses warn (not error) so Next.js dev overlays do not treat expected soft
 * fallbacks — e.g. the public landing page reading defaults when the store is
 * unreachable — as a red console error.
 */
export function logReferralFailure(what: string, error: unknown, extra?: Record<string, string>) {
  console.warn(`[referrals] ${what} failed`, {
    ...extra,
    message: error instanceof Error ? error.message : "unknown error",
  });
}
