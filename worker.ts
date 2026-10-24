/* eslint-disable @typescript-eslint/ban-ts-comment -- OpenNext generates this module after clean-checkout type-checking. */
// The OpenNext worker is generated before Wrangler bundles this entrypoint.
// @ts-ignore -- .open-next/worker.js is generated after a clean type-check.
import openNextWorker from "./.open-next/worker.js";
import { runCloudflareCron } from "./src/lib/cloudflare-scheduler";
import { withPostgresRequestScope } from "./src/lib/postgres-pool";
import { recordScheduledJob } from "./src/product/reliability/job-health";
import { workerLoginPreview } from "./src/product/saas/auth/login-preview";
import {
  enforceInstallationRequest,
  type InstallationEnvironment,
} from "./src/product/installations/gate";

type TradeCatchWorkerEnv = CloudflareEnv &
  InstallationEnvironment & {
    CRON_SECRET?: string;
    MISSED_CALL_OPS_SECRET?: string;
    NEXT_PUBLIC_SITE_URL?: string;
    BOOK_AUDIT_RETRY_SECRET?: string;
    GMAIL_SYNC_SECRET?: string;
    NOTIFICATION_RETRY_SECRET?: string;
    MONITORING_SECRET?: string;
    TRADECATCH_ENV?: string;
  };

// Preserve any cache Durable Object exports produced by OpenNext.
// @ts-ignore -- generated during `opennextjs-cloudflare build`.
export { DOQueueHandler } from "./.open-next/worker.js";
// @ts-ignore -- generated during `opennextjs-cloudflare build`.
export { DOShardedTagCache } from "./.open-next/worker.js";
// @ts-ignore -- generated during `opennextjs-cloudflare build`.
export { BucketCachePurge } from "./.open-next/worker.js";

function schedulerSecret(env: TradeCatchWorkerEnv, path: string): string {
  const secret =
    (path === "/api/monitoring/tick"
      ? env.MONITORING_SECRET?.trim()
      : path === "/api/book-audit/notifications/tick"
        ? env.BOOK_AUDIT_RETRY_SECRET?.trim()
        : path === "/api/notifications/tick" ||
            path === "/api/notifications/daily-summary/tick"
          ? env.NOTIFICATION_RETRY_SECRET?.trim()
          : path === "/api/gmail/sync/tick"
            ? env.GMAIL_SYNC_SECRET?.trim()
            : "") ||
    env.MISSED_CALL_OPS_SECRET?.trim() ||
    env.CRON_SECRET?.trim() ||
    "";
  if (!secret) {
    throw new Error(
      "Cloudflare scheduler requires MISSED_CALL_OPS_SECRET or CRON_SECRET",
    );
  }
  return secret;
}

function schedulerOrigin(env: TradeCatchWorkerEnv): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  return new URL(configured || "https://tradecatch.ca").origin;
}

export default {
  fetch(request, env, ctx) {
    return withPostgresRequestScope(async () => {
      const denied = await enforceInstallationRequest(request, env);
      if (denied) return denied;
      const preview = workerLoginPreview(request, env);
      if (preview) return preview;
      return openNextWorker.fetch(request, env, ctx);
    });
  },

  async scheduled(controller, env, ctx) {
    const origin = schedulerOrigin(env);

    try {
      const result = await withPostgresRequestScope(async () => {
        const denied = await enforceInstallationRequest(
          new Request(origin),
          env,
        );
        if (denied)
          throw new Error("Installation approval blocked scheduled work");
        return runCloudflareCron(
          controller.cron,
          (path) =>
            openNextWorker.fetch(
              new Request(new URL(path, origin), {
                method: "POST",
                headers: {
                  authorization: `Bearer ${schedulerSecret(env, path)}`,
                  "user-agent": "TradeCatch-Cloudflare-Scheduler/1.0",
                  // Existing routes use this authenticated marker to distinguish a
                  // scheduler from manual ops requests that require X-Ops-Actor.
                  "x-vercel-cron": "cloudflare",
                },
              }),
              env,
              ctx,
            ),
          (path, ok) => recordScheduledJob(path, ok),
        );
      });
      console.log(
        JSON.stringify({
          event: "tradecatch.cron.completed",
          cron: controller.cron,
          routes: result.completed,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "tradecatch.cron.failed",
          cron: controller.cron,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
      throw error;
    }
  },
} satisfies ExportedHandler<TradeCatchWorkerEnv>;
