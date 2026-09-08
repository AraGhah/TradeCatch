export const CLOUDFLARE_CRON_ROUTES = {
  "* * * * *": ["/api/missed-call/escalations/tick"],
  "*/15 * * * *": [
    "/api/starter/quotes/tick",
    "/api/growth/reminders/tick",
    "/api/growth/reviews/tick",
    "/api/growth/crm/tick",
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
        const detail = (await response.text()).slice(0, 512);
        throw new Error(
          `${path} returned ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }
      completed.push(path);
    } catch (error) {
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
