/* eslint-disable @typescript-eslint/ban-ts-comment -- OpenNext generates this module after clean-checkout type-checking. */
// The OpenNext worker is generated before Wrangler bundles this entrypoint.
// @ts-ignore -- .open-next/worker.js is generated after a clean type-check.
import openNextWorker from "./.open-next/worker.js";
import { runCloudflareCron } from "./src/lib/cloudflare-scheduler";

type TradeCatchWorkerEnv = CloudflareEnv & {
  CRON_SECRET?: string;
  MISSED_CALL_OPS_SECRET?: string;
  NEXT_PUBLIC_SITE_URL?: string;
};

// Preserve any cache Durable Object exports produced by OpenNext.
// @ts-ignore -- generated during `opennextjs-cloudflare build`.
export { DOQueueHandler } from "./.open-next/worker.js";
// @ts-ignore -- generated during `opennextjs-cloudflare build`.
export { DOShardedTagCache } from "./.open-next/worker.js";
// @ts-ignore -- generated during `opennextjs-cloudflare build`.
export { BucketCachePurge } from "./.open-next/worker.js";

function schedulerSecret(env: TradeCatchWorkerEnv): string {
  const secret =
    env.MISSED_CALL_OPS_SECRET?.trim() || env.CRON_SECRET?.trim() || "";
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
    return openNextWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const secret = schedulerSecret(env);
    const origin = schedulerOrigin(env);

    try {
      const result = await runCloudflareCron(controller.cron, (path) =>
        openNextWorker.fetch(
          new Request(new URL(path, origin), {
            method: "POST",
            headers: {
              authorization: `Bearer ${secret}`,
              "user-agent": "TradeCatch-Cloudflare-Scheduler/1.0",
              // Existing routes use this authenticated marker to distinguish a
              // scheduler from manual ops requests that require X-Ops-Actor.
              "x-vercel-cron": "cloudflare",
            },
          }),
          env,
          ctx,
        ),
      );
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
