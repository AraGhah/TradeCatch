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
    try {
      const response = await invoke(path);
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
          throw new Error(`${path} reported failed work`);
        }
      }
      await observe?.(path, true);
      completed.push(path);
    } catch (error) {
      try {
        await observe?.(path, false);
      } catch {
        console.error("[monitoring] Job result could not be persisted");
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
