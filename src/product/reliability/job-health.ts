import { getPgPool } from "@/product/missed-call/postgres-store";
import { CLOUDFLARE_CRON_ROUTES } from "@/lib/cloudflare-scheduler";

export type JobHealth = { service: string; status: string; checkedAt: string };
export const JOB_MAX_AGE_MS = Object.fromEntries(
  Object.entries(CLOUDFLARE_CRON_ROUTES).flatMap(([cron, paths]) =>
    paths.map((path) => [
      path,
      cron === "* * * * *"
        ? 5 * 60_000
        : cron === "*/15 * * * *"
          ? 40 * 60_000
          : 27 * 60 * 60_000,
    ]),
  ),
);

export function scheduledJobFailures(
  rows: JobHealth[],
  now = Date.now(),
): string[] {
  return Object.entries(JOB_MAX_AGE_MS)
    .filter(([path, maxAge]) => {
      const row = rows
        .filter((r) => r.service === `job:${path}`)
        .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
      return (
        !row ||
        row.status !== "healthy" ||
        !Number.isFinite(Date.parse(row.checkedAt)) ||
        now - Date.parse(row.checkedAt) > maxAge
      );
    })
    .map(([path]) => path);
}

/** Called after each actual Worker job result, inside its database request scope. */
export async function recordScheduledJob(
  path: string,
  ok: boolean,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!Object.hasOwn(JOB_MAX_AGE_MS, path))
    throw new Error("Unknown scheduled job");
  const url = env.DATABASE_URL?.trim();
  if (
    !url ||
    !(env.SAAS_DURABLE_STORE === "1" || env.MISSED_CALL_DURABLE_STORE === "1")
  )
    throw new Error("Durable job monitoring requires PostgreSQL");
  const pool = getPgPool(url);
  await pool.query(
    "INSERT INTO tc_health_checks (id,service,status,detail,checked_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,detail=EXCLUDED.detail,checked_at=EXCLUDED.checked_at",
    [
      `job:${path}`,
      `job:${path}`,
      ok ? "healthy" : "unavailable",
      ok ? "Scheduled job completed" : "Scheduled job failed",
    ],
  );
}
