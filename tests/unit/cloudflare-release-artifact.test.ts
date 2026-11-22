import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertNoCachePopulation,
  releaseArgs,
} from "../../scripts/release-worker-artifact.mjs";

test("release targets the configured custom worker and preserves dashboard variables", () => {
  assert.deepEqual(
    releaseArgs({ mode: "deploy", staging: false, sha: "abc", runId: 123 }),
    [
      "deploy",
      "--config",
      "wrangler.jsonc",
      "--keep-vars",
      "--message",
      "git:abc,ci:123",
      "--env",
      "",
    ],
  );
  assert.deepEqual(
    releaseArgs({ mode: "upload", staging: true, sha: "abc", runId: 123 }),
    [
      "versions",
      "upload",
      "--config",
      "wrangler.jsonc",
      "--keep-vars",
      "--message",
      "git:abc,ci:123",
      "--env",
      "staging",
    ],
  );
});

test("release blocks a cache configuration needing OpenNext population", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tradecatch-release-"));
  try {
    const dummy = path.join(dir, "dummy.mjs");
    const r2 = path.join(dir, "r2.mjs");
    const skew = path.join(dir, "skew.mjs");
    await writeFile(
      dummy,
      'export default {default:{override:{incrementalCache:async()=>({name:"dummy"}),tagCache:"dummy"}}}',
    );
    await writeFile(
      r2,
      'export default {default:{override:{incrementalCache:async()=>({name:"r2"})}}}',
    );
    await writeFile(
      skew,
      "export default {cloudflare:{skewProtection:{enabled:true}}}",
    );
    await assert.doesNotReject(assertNoCachePopulation(dummy));
    await assert.rejects(assertNoCachePopulation(r2), /cache population/);
    await assert.rejects(assertNoCachePopulation(skew), /skew protection/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
