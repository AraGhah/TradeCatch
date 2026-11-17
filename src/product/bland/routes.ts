/**
 * Which Bland number answers for which business: the trusted mapping.
 *
 * `BLAND_ROUTES_JSON` is set by the operator, never by a caller, a model or
 * Bland itself:
 *
 *   [{ "toE164": "+14385550100", "configId": "rc_org_abc", "smsE164": "+14385550199" }]
 *
 * - `toE164`   the Bland inbound number callers dial. It is matched EXACTLY
 *              against the `to` Bland sends. No match, no business: nothing
 *              falls back to a default tenant.
 * - `configId` the receptionist config (founder env config or tenant profile)
 *              that answers on it.
 * - `smsE164`  optional: a number Bland itself texts from. It is recorded so
 *              the Twilio SMS responder can refuse to own the same number
 *              (see sms-guard.ts).
 *
 * An empty or missing variable means no Bland line is live. A route that
 * cannot be trusted (bad number, a number or config claimed twice) is dropped
 * and reported, and the rest keep working.
 */

import { z } from "zod";

const E164 = /^\+[1-9]\d{9,14}$/;

const routeSchema = z.object({
  toE164: z.string().trim().regex(E164, "must be an E.164 phone number"),
  configId: z.string().trim().min(1).max(120),
  smsE164: z
    .string()
    .trim()
    .regex(E164, "must be an E.164 phone number")
    .optional(),
});

export type BlandRoute = z.infer<typeof routeSchema>;

export type BlandRoutes = {
  routes: BlandRoute[];
  /** Index and reason only: the numbers are not logged. */
  problems: { index: number; reason: string }[];
};

/** Digits of the national number, so "+15145550100" and "5145550100" are one line. */
export function lineKey(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function parseBlandRoutes(raw: string | undefined): BlandRoutes {
  const text = raw?.trim();
  if (!text) return { routes: [], problems: [] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { routes: [], problems: [{ index: -1, reason: "not_json" }] };
  }
  const list: unknown[] = Array.isArray(json) ? json : [json];
  const problems: BlandRoutes["problems"] = [];
  const candidates: { index: number; route: BlandRoute }[] = [];
  list.forEach((item, index) => {
    const parsed = routeSchema.safeParse(item);
    if (!parsed.success) {
      problems.push({ index, reason: "invalid_route" });
      return;
    }
    if (parsed.data.smsE164 && lineKey(parsed.data.smsE164) === lineKey(parsed.data.toE164)) {
      // Bland would text from the number callers dial; keep the voice line, drop the SMS claim.
      problems.push({ index, reason: "sms_equals_voice_number" });
      delete parsed.data.smsE164;
    }
    candidates.push({ index, route: parsed.data });
  });

  // A number or a config claimed twice is ambiguous: refuse every claimant.
  const claims = (pick: (route: BlandRoute) => string | undefined) => {
    const seen = new Map<string, number>();
    for (const { route } of candidates) {
      const key = pick(route);
      if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return seen;
  };
  const voiceClaims = claims((r) => lineKey(r.toE164));
  const smsClaims = claims((r) => (r.smsE164 ? lineKey(r.smsE164) : undefined));
  const voiceKeys = new Set(voiceClaims.keys());
  const routes: BlandRoute[] = [];
  for (const { index, route } of candidates) {
    if ((voiceClaims.get(lineKey(route.toE164)) ?? 0) > 1) {
      problems.push({ index, reason: "duplicate_number" });
      continue;
    }
    const next: BlandRoute = { ...route };
    if (next.smsE164) {
      const key = lineKey(next.smsE164);
      if ((smsClaims.get(key) ?? 0) > 1 || voiceKeys.has(key)) {
        problems.push({ index, reason: "sms_number_not_unique" });
        delete next.smsE164;
      }
    }
    routes.push(next);
  }
  return { routes, problems };
}

let cache: { raw: string | undefined; parsed: BlandRoutes } | undefined;
const reported = new Set<string>();

/** The routes in `BLAND_ROUTES_JSON` (parsed once per distinct value). */
export function getBlandRoutes(
  env: Record<string, string | undefined> = process.env,
): BlandRoutes {
  const raw = env.BLAND_ROUTES_JSON;
  if (!cache || cache.raw !== raw) {
    cache = { raw, parsed: parseBlandRoutes(raw) };
    for (const problem of cache.parsed.problems) {
      const key = `${problem.index}:${problem.reason}`;
      if (reported.has(key)) continue;
      reported.add(key);
      console.warn(
        JSON.stringify({ event: "tradecatch.bland.route_ignored", ...problem }),
      );
    }
  }
  return cache.parsed;
}

export function resetBlandRoutesForTests(): void {
  cache = undefined;
  reported.clear();
}

/** The route for the number Bland says was dialed, or null. */
export function findBlandRoute(
  to: string,
  env: Record<string, string | undefined> = process.env,
): BlandRoute | null {
  const key = lineKey(to);
  if (key.length < 10) return null;
  return getBlandRoutes(env).routes.find((r) => lineKey(r.toE164) === key) ?? null;
}

/** Numbers Bland texts from, for the SMS guard. */
export function blandSmsNumbers(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return getBlandRoutes(env)
    .routes.map((r) => r.smsE164)
    .filter((v): v is string => Boolean(v));
}

/** Bland voice and SMS lines: never a transfer destination. */
export function blandOwnLines(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return getBlandRoutes(env).routes.flatMap((r) =>
    [r.toE164, r.smsE164].filter((v): v is string => Boolean(v)),
  );
}
