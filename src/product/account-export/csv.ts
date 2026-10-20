export type CsvValue = string | number | boolean | null | undefined;
export type ExportRow = Record<string, CsvValue>;

/** Quote every cell; only a validated E.164 phone column may start with '+'. */
export function csvCell(value: CsvValue, phone = false): string {
  let text = value == null ? "" : String(value);
  const e164 = phone && /^\+[1-9][0-9]{6,14}$/.test(text);
  if (
    !e164 &&
    (/^[\s\u0000-\u001f\u007f\u200b-\u200d\u2060\ufeff]*[=+\-@＝＋－＠]/u.test(
      text,
    ) ||
      /^[\t\r\n]/.test(text))
  ) {
    text = "'" + text;
  }
  return '"' + text.replaceAll('"', '""') + '"';
}

export function csvLine(
  columns: readonly string[],
  row: ExportRow,
  phones: readonly string[] = [],
) {
  return (
    columns.map((key) => csvCell(row[key], phones.includes(key))).join(",") +
    "\r\n"
  );
}

export function writeCsv(
  columns: readonly string[],
  rows: ExportRow[],
  phones: readonly string[] = [],
) {
  return (
    "\ufeff" +
    columns.map((key) => csvCell(key)).join(",") +
    "\r\n" +
    rows.map((row) => csvLine(columns, row, phones)).join("")
  );
}
