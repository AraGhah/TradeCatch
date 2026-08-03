/**
 * Build entry used by `npm run build`.
 *
 * - When OpenNext invokes us (NEXT_PRIVATE_STANDALONE=true), run `next build` only.
 * - On CI (Cloudflare Workers Builds, GitHub Actions, …), run the full OpenNext
 *   worker build so `npx wrangler deploy` finds `.open-next`.
 * - Locally, keep a fast Next.js-only build; use `npm run deploy` / `preview`
 *   for the worker bundle.
 */
const { execSync } = require("node:child_process");

const nextOnly = process.env.NEXT_PRIVATE_STANDALONE === "true";
const onCi =
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  // Cloudflare Workers Builds home path (seen in deploy logs)
  String(process.env.HOME || "").includes("/opt/buildhome");

const command = nextOnly
  ? "npx next build"
  : onCi
    ? "npx opennextjs-cloudflare build"
    : "npx next build";

execSync(command, { stdio: "inherit" });
