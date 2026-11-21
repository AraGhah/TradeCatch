/* eslint-disable @typescript-eslint/ban-ts-comment -- OpenNext generates this module after clean-checkout type-checking. */
// The OpenNext worker is generated before Wrangler bundles this entrypoint.
// @ts-ignore -- .open-next/worker.js is generated after a clean type-check.
import openNextWorker from "./.open-next/worker.js";
import { corsDecision, withCors } from "./src/lib/cors";
import {
  runCloudflareCron,
  cloudflareSchedulerSecret,
} from "./src/lib/cloudflare-scheduler";
import { withPostgresRequestScope } from "./src/lib/postgres-pool";
import { guardWorkerFetch } from "./src/lib/worker-fetch-guard";
import { recordScheduledJob } from "./src/product/reliability/job-health";
import { createObserver } from "./src/product/reliability/observations";
import {
  createIngestSink,
  observeRequest,
} from "./src/product/reliability/worker-observer";
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

/**
 * Worker bindings as the plain string settings the CORS policy reads. This
 * entry point only ever runs a production build, so NODE_ENV is fixed rather
 * than read: a missing value must never select the development origin list.
 */
function corsEnv(env: TradeCatchWorkerEnv): Record<string, string | undefined> {
  const settings: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") settings[key] = value;
  }
  return { ...settings, NODE_ENV: "production" };
}

function schedulerOrigin(env: TradeCatchWorkerEnv): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  return new URL(configured || "https://tradecatch.ca").origin;
}

/**
 * Real request outcomes (KAN-28). One recorder per isolate counts each finished
 * response into per-minute buckets in memory (no I/O on the request path) and
 * writes them out, a few at a time, after the response has gone. It can fail in
 * any way without changing what a customer receives; see worker-observer.ts.
 */
const requestObserver = createObserver();

/** The secret the scheduler already uses for the monitoring routes, if any. */
function monitoringSecret(env: TradeCatchWorkerEnv): string | undefined {
  try {
    return cloudflareSchedulerSecret(env, "/api/monitoring/watch");
  } catch {
    return undefined;
  }
}

export default {
  fetch(request, env, ctx) {
    // The Next proxy answers CORS for everything it handles (src/proxy.ts).
    // This covers what never reaches it: the installation gate's refusals and
    // the fetch guard's 503, so an approved frontend can read the error.
    // withCors sets headers rather than appending, so nothing is duplicated.
    const url = new URL(request.url);
    const cors = corsDecision({
      method: request.method,
      pathname: url.pathname,
      headers: request.headers,
      selfHosts: [url.host],
      env: corsEnv(env),
    });
    return observeRequest({
      observer: requestObserver,
      request,
      handle: () =>
        guardWorkerFetch(request, () =>
          withPostgresRequestScope(async () => {
            const denied = await enforceInstallationRequest(request, env);
            if (denied) return denied;
            const preview = workerLoginPreview(request, env);
            if (preview) return preview;
            return openNextWorker.fetch(request, env, ctx);
          }),
        ).then((response) => withCors(response, cors)),
      schedule: (work) => ctx.waitUntil(work),
      // A scope of its own: the request's has closed by the time this runs.
      flush: () =>
        withPostgresRequestScope(
          () =>
            requestObserver.flush(
              createIngestSink({
                origin: schedulerOrigin(env),
                secret: monitoringSecret(env),
                fetchInternal: (internal) =>
                  openNextWorker.fetch(internal, env, ctx),
              }),
            ),
          { independent: true },
        ),
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
                  authorization: `Bearer ${cloudflareSchedulerSecret(env, path)}`,
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
