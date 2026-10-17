/**
 * OpenNext deletes `.open-next` at the start of a build.
 * On Windows that fails with EPERM while `next dev` has workerd holding the folder.
 */
const fs = require("node:fs");
const path = require("node:path");

const outputDir = path.join(process.cwd(), ".open-next");

if (!fs.existsSync(outputDir)) {
  process.exit(0);
}

try {
  fs.rmSync(outputDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
} catch (error) {
  const code = error && error.code;
  if (code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY") {
    console.error("Cannot replace .open-next because another process has it open.");
    console.error("Stop the local dev server (`npm run dev`), then run deploy again.");
    console.error("After restart, next dev uses wrangler.dev.jsonc and leaves .open-next free for deploy.");
    process.exit(1);
  }
  throw error;
}
