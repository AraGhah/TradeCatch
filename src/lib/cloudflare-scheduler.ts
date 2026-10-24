export const CLOUDFLARE_CRON_ROUTES = {
  "* * * * *": [
    "/api/book-audit/notifications/tick",
    "/api/gmail/sync/tick",
    "/api/missed-call/escalations/tick",
    "/api/automations/tick",
    "/api/notifications/tick",
  ],
  "*/15 * * * *": [
    "/api/starter/quotes/tick",
    "/api/growth/reminders/tick",
    "/api/growth/reviews/tick",
    "/api/growth/crm/tick",
    "/api/receptionist/tick",
    "/api/notifications/daily-summary/tick",
    "/api/growth/email/tick",
    "/api/scheduling/reconcile",
    "/api/monitoring/tick",
  ],
  "15 6 * * *": ["/api/missed-call/retention/tick"],
} as const;

export type TradeCatchCron = keyof typeof CLOUDFLARE_CRON_ROUTES;

export type SchedulerEnvironment = {
  MONITORING_SECRET?: string;
  BOOK_AUDIT_RETRY_SECRET?: string;
  NOTIFICATION_RETRY_SECRET?: string;
  GMAIL_SYNC_SECRET?: string;
  MISSED_CALL_OPS_SECRET?: string;
  CRON_SECRET?: string;
};

export function cloudflareSchedulerSecret(
  env: SchedulerEnvironment,
  path: string,
): string {
  if (
    !Object.values(CLOUDFLARE_CRON_ROUTES).some((paths) =>
      (paths as readonly string[]).includes(path),
    )
  )
    throw new Error("Unknown scheduled route");
  const dedicated =
    path === "/api/monitoring/tick"
      ? env.MONITORING_SECRET
      : path === "/api/book-audit/notifications/tick"
        ? env.BOOK_AUDIT_RETRY_SECRET
        : path === "/api/gmail/sync/tick"
          ? env.GMAIL_SYNC_SECRET
          : [
                "/api/notifications/tick",
                "/api/notifications/daily-summary/tick",
              ].includes(path)
            ? env.NOTIFICATION_RETRY_SECRET
            : undefined;
  const secret =
    dedicated?.trim() ||
    env.MISSED_CALL_OPS_SECRET?.trim() ||
    env.CRON_SECRET?.trim();
  if (!secret)
    throw new Error(`Scheduler credential is not configured for ${path}`);
  return secret;
}

function diagnosticCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return;
  return typeof error.code === "string" && /^[A-Z0-9_]{2,32}$/.test(error.code)
    ? error.code
    : undefined;
}

export function routesForCloudflareCron(cron: string): readonly string[] {
  return CLOUDFLARE_CRON_ROUTES[cron as TradeCatchCron] ?? [];
}

export async function runCloudflareCron(
  cron: string,
  invoke: (path: string) => Promise<Response>,
  observe?: (path: string, ok: boolean) => Promise<void>,
): Promise<{ completed: string[] }> {
  const routes = routesForCloudflareCron(cron);
  if (routes.length === 0) {
    throw new Error(`Unsupported Cloudflare cron expression: ${cron}`);
  }

  const completed: string[] = [];
  const failures: Error[] = [];

  // Run sequentially so one scheduled event does not create a burst of
  // concurrent database connections. A failure never prevents later jobs in
  // the same schedule from running.
  for (const path of routes) {
    let stage = "invoke";
    let httpStatus: number | undefined;
    try {
      const response = await invoke(path);
      stage = "response";
      httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`${path} returned ${response.status}`);
      }
      if (response.headers.get("content-type")?.includes("application/json")) {
        const result = (await response.clone().json()) as {
          ok?: boolean;
          failed?: number;
          outcomes?: { status?: string }[];
        };
        if (
          result.ok === false ||
          (typeof result.failed === "number" && result.failed > 0) ||
          result.outcomes?.some((row) =>
            ["failed", "dead", "retry"].includes(row.status || ""),
          )
        ) {
          stage = "work";
          throw new Error(`${path} reported failed work`);
        }
      }
      stage = "observation";
      await observe?.(path, true);
      completed.push(path);
    } catch (error) {
      // Retain route/stage evidence without copying provider bodies, request
      // headers, credentials, or arbitrary error messages into monitoring logs.
      console.error(
        JSON.stringify({
          event: "tradecatch.cron.route_failed",
          path,
          stage,
          httpStatus,
          code: diagnosticCode(error),
        }),
      );
      try {
        await observe?.(path, false);
      } catch (persistenceError) {
        console.error(
          JSON.stringify({
            event: "tradecatch.cron.observation_failed",
            path,
            code: diagnosticCode(persistenceError),
          }),
        );
      }
      failures.push(
        error instanceof Error
          ? error
          : new Error(`${path} failed with an unknown error`),
      );
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Cloudflare cron ${cron} failed for ${failures.length} route(s)`,
    );
  }

  return { completed };
}
