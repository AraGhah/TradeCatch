import { csvCell, csvLine, type ExportRow } from "./csv";
import { writeZip, type ArchiveFile } from "./zip";

export const EXPORT_LIMITS = {
  rows: 1000,
  sectionBytes: 1024 * 1024,
  dataBytes: 8 * 1024 * 1024,
  parents: 50,
  readMs: 5000,
  totalMs: 25000,
};
export type SourceResult = {
  rows: ExportRow[];
  warnings?: string[];
  notApplicable?: string;
  status?: "partial" | "failed";
};
export type ExportSource = {
  name: string;
  description: string;
  columns: readonly string[];
  phones?: readonly string[];
  load: (signal?: AbortSignal) => Promise<SourceResult>;
};
export const EXCLUSIONS = [
  "Call audio, recordings, recording URLs and media attachments (held by Twilio or other providers).",
  "Connected-mailbox email content and attachments (owned by the member who connected the mailbox).",
  "Passwords, authentication/session records, API keys, OAuth tokens and other integration credentials.",
  "Stripe billing records, invoices, payment methods and payment details (held by Stripe).",
  "Internal support notes, assignments, attachments and platform/security/diagnostic logs.",
  "Other account settings, automation configuration, analytics, revenue ledgers, and provider-side records not explicitly listed in the manifest.",
];
const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

export async function buildAccountExport(
  organizationId: string,
  sources: ExportSource[],
  options: { now?: Date; limits?: Partial<typeof EXPORT_LIMITS> } = {},
) {
  const started = options.now ?? new Date();
  const limits = { ...EXPORT_LIMITS, ...options.limits };
  const deadline = Date.now() + limits.totalMs;
  const files: ArchiveFile[] = [];
  const sections: {
    name: string;
    description: string;
    files: string[];
    columns: readonly string[];
    status: "complete" | "partial" | "failed" | "not_applicable";
    exportedRows: number;
    reasons: string[];
  }[] = [];
  let totalBytes = 0;
  for (const source of sources) {
    const section: (typeof sections)[number] = {
      name: source.name,
      description: source.description,
      files: [source.name + ".csv", source.name + ".json"],
      columns: source.columns,
      status: "complete",
      exportedRows: 0,
      reasons: [],
    };
    sections.push(section);
    let rows: ExportRow[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("export_time_limit");
      const result = await Promise.race([
        Promise.resolve().then(() => source.load(controller.signal)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("source_timeout")),
            Math.min(limits.readMs, remaining),
          );
        }),
      ]);
      if (result.notApplicable) {
        section.status = "not_applicable";
        section.reasons.push(result.notApplicable);
      }
      if (result.status) section.status = result.status;
      if (result.warnings?.length) {
        if (section.status !== "failed") section.status = "partial";
        section.reasons.push(...result.warnings.slice(0, 50));
      }
      if (result.rows.length > limits.rows) {
        section.status = "partial";
        section.reasons.push("row_limit");
      }
      rows = result.rows.slice(0, limits.rows);
    } catch (error) {
      section.status = "failed";
      section.reasons.push(
        error instanceof Error &&
          ["source_timeout", "export_time_limit"].includes(error.message)
          ? error.message
          : "source_unavailable",
      );
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
    let csv =
      "\ufeff" + source.columns.map((key) => csvCell(key)).join(",") + "\r\n";
    const json: string[] = [];
    let sectionBytes = bytes(csv) + 2;
    for (const raw of rows) {
      // A second allowlist at the serialization boundary prevents accidental
      // expansion of an adapter's records from leaking new private fields.
      const row: ExportRow = {};
      let invalid = false;
      for (const key of source.columns) {
        const value = raw?.[key];
        if (
          value != null &&
          !["string", "number", "boolean"].includes(typeof value)
        ) {
          invalid = true;
          break;
        }
        row[key] = value ?? null;
      }
      if (!raw || invalid) {
        section.status = "partial";
        section.reasons.push("invalid_record");
        continue;
      }
      if (
        Object.values(row).some(
          (v) => typeof v === "string" && v.length > limits.sectionBytes,
        )
      ) {
        section.status = "partial";
        section.reasons.push("section_byte_limit");
        break;
      }
      const line = csvLine(source.columns, row, source.phones);
      const encoded = JSON.stringify(row);
      const nextBytes = bytes(line) + bytes(encoded) + 1;
      if (
        sectionBytes + nextBytes > limits.sectionBytes ||
        totalBytes + sectionBytes + nextBytes > limits.dataBytes
      ) {
        section.status = "partial";
        section.reasons.push(
          sectionBytes + nextBytes > limits.sectionBytes
            ? "section_byte_limit"
            : "archive_byte_limit",
        );
        break;
      }
      csv += line;
      json.push(encoded);
      sectionBytes += nextBytes;
      section.exportedRows++;
    }
    section.reasons = [...new Set(section.reasons)];
    totalBytes += sectionBytes;
    files.push(
      { name: section.files[0], data: csv },
      { name: section.files[1], data: "[" + json.join(",") + "]" },
    );
  }
  const manifest = {
    formatVersion: 1,
    organizationId,
    createdAt: started.toISOString(),
    completedAt: new Date().toISOString(),
    complete: sections.every(
      (s) => s.status === "complete" || s.status === "not_applicable",
    ),
    limits,
    sections,
    exclusions: EXCLUSIONS,
  };
  const readme = [
    "TradeCatch account data export",
    `Business: ${organizationId}`,
    `Created: ${started.toISOString()}`,
    "",
    "Read manifest.json first. Every source has its own status, exported row count, exact columns and reasons for any missing data. A failed source is NOT an empty successful source. Capped sources are partial; totals beyond a cap are unknown. A missing phone-client link is marked not_applicable.",
    "",
    "CSV files use UTF-8 with BOM, quoted cells and CRLF records. Formula-like text is prefixed with an apostrophe for spreadsheet safety. Only validated E.164 phone columns retain a leading plus unchanged; import phone columns as Text to prevent spreadsheet number conversion. JSON files preserve the exact selected values, including phone numbers and original formula-like text.",
    "",
    "Included sources:",
    ...sections.map(
      (s) =>
        `${s.name}: ${s.description}. ${s.status}; ${s.exportedRows} rows${s.reasons.length ? "; " + s.reasons.join(", ") : ""}.`,
    ),
    "",
    "Excluded:",
    ...EXCLUSIONS.map((s) => "- " + s),
    "",
    "This is a bounded, sequential read, not a transactionally consistent database backup. Records can change during export. No provider API is called. Retention-purged transcripts and records are not recoverable through export. Store this archive securely; it contains customer personal data.",
  ].join("\r\n");
  files.push(
    { name: "README.txt", data: readme },
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
  );
  return { bytes: writeZip(files, started), manifest };
}
