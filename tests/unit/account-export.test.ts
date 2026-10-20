import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32, writeZip } from "../../src/product/account-export/zip";
import { csvCell, writeCsv } from "../../src/product/account-export/csv";
import {
  buildAccountExport,
  type ExportSource,
} from "../../src/product/account-export/archive";
import { collectChildren } from "../../src/product/account-export/sources";
import { readExportZip } from "../support/read-export-zip";
const source = (name: string, load: ExportSource["load"]): ExportSource => ({
  name,
  description: name,
  columns: ["id", "body"],
  load,
});

describe("account export ZIP", () => {
  it("has correct CRC-32 vectors, local records, central directory, UTF-8 sizes and contents", () => {
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
    assert.equal(crc32(new Uint8Array()), 0);
    const zip = writeZip(
      [
        { name: "README.txt", data: "Montréal\r\nBonjour 👋" },
        { name: "empty.csv", data: "" },
      ],
      new Date("2026-10-20T12:30:10Z"),
    );
    assert.deepEqual(readExportZip(zip), {
      "README.txt": "Montréal\r\nBonjour 👋",
      "empty.csv": "",
    });
    assert.deepEqual(readExportZip(writeZip([])), {});
  });
  it("rejects traversal, unsafe or duplicate names and oversized archives", () => {
    for (const name of ["../x", "/x", "a/b", "a\\b", "x\u0000", ""])
      assert.throws(() => writeZip([{ name, data: "x" }]));
    assert.throws(() =>
      writeZip([
        { name: "A.csv", data: "x" },
        { name: "a.csv", data: "y" },
      ]),
    );
    assert.throws(() =>
      writeZip([{ name: "x", data: new Uint8Array(20 * 1024 * 1024) }]),
    );
  });
});
describe("account export CSV", () => {
  it("quotes commas, delimiters, newlines, Unicode and double quotes without creating cells", () => {
    assert.equal(csvCell('a,"b"\r\n,c'), '"a,""b""\r\n,c"');
    assert.equal(
      writeCsv(["value"], [{ value: "Montréal" }]),
      '\ufeff"value"\r\n"Montréal"\r\n',
    );
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell(false), '"false"');
    assert.equal(csvCell(0), '"0"');
  });
  it("neutralizes formulas after whitespace/control characters, including disguised phone formulas", () => {
    for (const value of [
      "=SUM(1,2)",
      "+cmd|x",
      "-1+2",
      "@SUM(1)",
      "  =1+1",
      "\t=1+1",
      "\r\n=1",
      "\u0000=1",
      "\u200b=1",
      "＝1+1",
      "＋1+2",
      "+14385550123+1",
    ])
      assert.ok(csvCell(value, true).startsWith("\"'"), value);
    assert.equal(csvCell("+14385550123", true), '"+14385550123"');
    assert.equal(csvCell("+14385550123"), '"\'+14385550123"');
  });
});
describe("account export sections", () => {
  it("keeps good data, whitelists columns, and reports source failures without exposing errors", async () => {
    const result = await buildAccountExport("org_a", [
      source("good", async () => ({
        rows: [{ id: "1", body: "reply", oauthToken: "EXCLUDED_SECRET" }],
      })),
      source("bad", async () => {
        throw Error("EXCLUDED_DATABASE_SECRET");
      }),
    ]);
    const files = readExportZip(result.bytes);
    assert.equal(result.manifest.complete, false);
    assert.equal(result.manifest.sections[0].status, "complete");
    assert.equal(result.manifest.sections[1].status, "failed");
    assert.deepEqual(JSON.parse(files["good.json"]), [
      { id: "1", body: "reply" },
    ]);
    assert.deepEqual(JSON.parse(files["bad.json"]), []);
    assert.ok(!Object.values(files).join("").includes("EXCLUDED_"));
    assert.match(files["README.txt"], /failed/);
    assert.ok(files["manifest.json"]);
  });
  it("labels row and byte caps and preserves exact JSON while sanitizing CSV", async () => {
    const result = await buildAccountExport(
      "org_a",
      [
        source("rows", async () => ({
          rows: [
            { id: "1", body: "=1+1" },
            { id: "2", body: "second" },
          ],
        })),
        source("large", async () => ({
          rows: [{ id: "3", body: "é".repeat(1000) }],
        })),
      ],
      { limits: { rows: 1, sectionBytes: 200 } },
    );
    const files = readExportZip(result.bytes);
    assert.equal(result.manifest.sections[0].exportedRows, 1);
    assert.ok(result.manifest.sections[0].reasons.includes("row_limit"));
    assert.ok(
      result.manifest.sections[1].reasons.includes("section_byte_limit"),
    );
    assert.match(files["rows.csv"], /"'=1\+1"/);
    assert.equal(JSON.parse(files["rows.json"])[0].body, "=1+1");
  });
  it("labels aggregate byte caps, invalid records, and not-applicable sources", async () => {
    const result = await buildAccountExport(
      "org_a",
      [
        source("one", async () => ({
          rows: [{ id: "1", body: "x".repeat(40) }],
        })),
        source("two", async () => ({
          rows: [{ id: "2", body: "x".repeat(100) }],
        })),
        source("none", async () => ({
          rows: [],
          notApplicable: "no_linked_phone_client",
        })),
        source("invalid", async () => ({
          rows: [{ id: "3", body: { secret: "bad" } } as never],
        })),
      ],
      { limits: { dataBytes: 200 } },
    );
    assert.ok(
      result.manifest.sections[1].reasons.includes("archive_byte_limit"),
    );
    assert.equal(result.manifest.sections[2].status, "not_applicable");
    assert.ok(result.manifest.sections[3].reasons.includes("invalid_record"));
  });
  it("bounds slow reads, aborts derived readers, and marks sections skipped after the deadline", async () => {
    let aborted = false,
      called = false;
    const result = await buildAccountExport(
      "org_a",
      [
        source("slow", async (signal) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
          });
          return new Promise(() => {});
        }),
        source("skipped", async () => {
          called = true;
          return { rows: [] };
        }),
      ],
      { limits: { readMs: 15, totalMs: 10 } },
    );
    assert.ok(aborted);
    assert.equal(called, false);
    assert.equal(result.manifest.sections[0].status, "failed");
    assert.deepEqual(result.manifest.sections[1].reasons, [
      "export_time_limit",
    ]);
  });
  it("keeps related records from successful parents and flags failed or capped parents", async () => {
    const result = await collectChildren(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      async (p) => {
        if (p.id === "b") throw Error("private");
        return { rows: [{ body: p.id }], capped: p.id === "c" };
      },
      (r, p) => ({ id: p.id, body: r.body }),
    );
    assert.deepEqual(
      result.rows.map((r) => r.id),
      ["a", "c"],
    );
    assert.deepEqual(result.warnings, ["child_unavailable:b", "child_limit:c"]);
    assert.equal(result.status, "partial");
    const all = await collectChildren(
      [{ id: "x" }],
      async () => {
        throw Error("x");
      },
      () => ({}),
    );
    assert.equal(all.status, "failed");
    const cap = await collectChildren(
      Array.from({ length: 51 }, (_, n) => ({ id: String(n) })),
      async () => ({ rows: [] }),
      () => ({}),
    );
    assert.ok(cap.warnings?.includes("parent_limit"));
  });
});
