import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { it } from "node:test";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(fullPath);
    return entry.isFile() && entry.name === "route.ts" ? [fullPath] : [];
  });
}

it("API routes do not buffer JSON without a byte limit", () => {
  const files = routeFiles(path.resolve("src/app/api"));
  assert.ok(files.length > 0, "the API route inventory must not be empty");
  const unbounded = files.filter((file) =>
    /\brequest\.json\s*\(/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(
    unbounded.map((file) => path.relative(process.cwd(), file)),
    [],
  );
});
