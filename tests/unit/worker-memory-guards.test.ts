import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import ts from "typescript";
import { guardWorkerFetch } from "../../src/lib/worker-fetch-guard";

const require = createRequire(import.meta.url);
const {
  findWideCharacters,
} = require("../../scripts/check-worker-bundle-encoding.js");

const srcRoot = join(import.meta.dirname, "..", "..", "src");
const BACKSLASH = String.fromCharCode(92);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("Worker bundle stays one byte per character", () => {
  // esbuild escapes non-ASCII in string literals but prints regular expression
  // literals verbatim. One character above U+00FF in the shipped bundle makes
  // V8 hold the whole ~27 MB script as UTF-16 (about 26 MiB of the 128 MiB
  // isolate limit). The release check scans the built bundle; this catches the
  // same mistake at `npm run test:unit` time and names the file and line.
  it("source regular expression literals contain no character above U+00FF", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      const text = readFileSync(file, "utf8");
      if (!/[^\u0000-ÿ]/.test(text)) continue;
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        if (
          node.kind === ts.SyntaxKind.RegularExpressionLiteral &&
          /[^\u0000-ÿ]/.test(node.getText(source))
        ) {
          const { line } = source.getLineAndCharacterOfPosition(
            node.getStart(source),
          );
          offenders.push(
            `${relative(srcRoot, file).split(sep).join("/")}:${line + 1}`,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    assert.deepEqual(
      offenders,
      [],
      `Write these characters as ${BACKSLASH}uXXXX escapes inside the regular expression: ${offenders.join(", ")}`,
    );
  });

  it("the bundle scanner reports characters above U+00FF with their module and ignores Latin-1", () => {
    const clean = "// src/a.ts\nconst s = /[à-ÿ]/;\n";
    assert.deepEqual(findWideCharacters(clean), { total: 0, findings: [] });

    const bundle = [
      "// src/lib/a.ts",
      "const a = /['’]/;",
      "// node_modules/dep/index.js",
      "// pause — then continue",
    ].join("\n");
    const result = findWideCharacters(bundle);
    assert.equal(result.total, 2);
    assert.deepEqual(
      result.findings.map(({ module, count, codePoints }: {
        module: string;
        count: number;
        codePoints: string[];
      }) => ({ module, count, codePoints })),
      [
        { module: "src/lib/a.ts", count: 1, codePoints: ["U+2019"] },
        { module: "node_modules/dep/index.js", count: 1, codePoints: ["U+2014"] },
      ],
    );
  });
});

describe("guardWorkerFetch", () => {
  const logged: string[] = [];
  const originalError = console.error;
  beforeEach(() => {
    logged.length = 0;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
  });
  afterEach(() => {
    console.error = originalError;
  });

  it("passes the application's own responses through untouched, including errors", async () => {
    for (const status of [200, 404, 500]) {
      const response = await guardWorkerFetch(
        new Request("https://tradecatch.test/pricing"),
        async () => new Response("body", { status }),
      );
      assert.equal(response.status, status);
      assert.equal(await response.text(), "body");
    }
    assert.deepEqual(logged, []);
  });

  it("turns an escaped exception into a logged, retryable 503", async () => {
    const response = await guardWorkerFetch(
      new Request("https://tradecatch.test/pricing?token=secret-token"),
      async () => {
        throw new TypeError("boom");
      },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /briefly unavailable/);

    assert.equal(logged.length, 1);
    const event = JSON.parse(logged[0]);
    assert.deepEqual(event, {
      event: "tradecatch.worker.fetch_failed",
      method: "GET",
      path: "/pricing",
      error: "TypeError",
      message: "boom",
    });
    assert.doesNotMatch(logged[0], /secret-token/);
  });

  it("answers API callers with JSON and redacts credentials quoted in the error", async () => {
    const response = await guardWorkerFetch(
      new Request("https://tradecatch.test/api/health", { method: "POST" }),
      async () => {
        throw new Error("connect failed postgres://app:hunter2@db.example:5432/x");
      },
    );
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), {
      error: "service_unavailable",
      retryable: true,
    });
    assert.doesNotMatch(logged[0], /hunter2/);
    assert.match(logged[0], /postgres:\/\/\[redacted\]@db\.example/);
  });

  it("sends no body for HEAD and tolerates non-Error throws", async () => {
    const response = await guardWorkerFetch(
      new Request("https://tradecatch.test/", { method: "HEAD" }),
      async () => {
        throw "plain string";
      },
    );
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "");
    assert.equal(JSON.parse(logged[0]).error, "UnknownError");
  });
});
