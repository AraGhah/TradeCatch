import { pathToFileURL } from "node:url";
import path from "node:path";

export async function assertNoCachePopulation(
  configFile = ".open-next/.build/open-next.config.edge.mjs",
) {
  const { default: config } = await import(
    pathToFileURL(path.resolve(configFile)).href
  );
  if (config.cloudflare?.skewProtection?.enabled) {
    throw new Error(
      "Release blocked: skew protection needs OpenNext deployment mapping; update the release workflow.",
    );
  }
  for (const name of ["incrementalCache", "tagCache"]) {
    const value = config.default?.override?.[name];
    const resolved = typeof value === "function" ? (await value()).name : value;
    if (resolved && resolved !== "dummy") {
      throw new Error(
        `Release blocked: ${name} needs OpenNext cache population; update the release workflow.`,
      );
    }
  }
}

export function releaseArgs({ mode, staging, sha, runId }) {
  return [
    ...(mode === "upload" ? ["versions", "upload"] : ["deploy"]),
    "--config",
    "wrangler.jsonc",
    "--keep-vars",
    "--message",
    `git:${sha},ci:${runId}`,
    ...(staging ? ["--env", "staging"] : ["--env", ""]),
  ];
}
