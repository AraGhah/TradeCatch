"use strict";
// Single source of truth for the ordered schema steps is scripts/apply-missed-call-schema.js.
// This reads that list instead of duplicating it, so the targeted tooling can
// never drift from what `npm run db:schema` would apply.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..", "..");

/** Ordered [{ id, file }] from the runner's applyFile(client, [..path..], "id") calls. */
function parseSchemaSteps(
  source = readFileSync(
    join(ROOT, "scripts", "apply-missed-call-schema.js"),
    "utf8",
  ),
) {
  return [
    ...source.matchAll(/applyFile\(\s*client,\s*\[([^\]]+)\],\s*"([^"]+)"/g),
  ].map((m) => ({
    id: m[2],
    file: m[1]
      .split(",")
      .map((part) => part.trim().replace(/"/g, ""))
      .join("/"),
  }));
}

function readStepSql(step) {
  return readFileSync(join(ROOT, ...step.file.split("/")), "utf8");
}

/** Tables a step's SQL creates (CREATE TABLE IF NOT EXISTS). */
function tablesCreatedBy(sql) {
  return [
    ...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(?:public\.)?([a-z0-9_]+)/gi),
  ].map((m) => m[1]);
}

/** Files that manage their own BEGIN/COMMIT must not be wrapped in another transaction. */
function managesOwnTransaction(sql) {
  return /^\s*BEGIN\s*;/im.test(sql);
}

/**
 * Statements that change existing rows or constraints and therefore must not be
 * replayed casually. Reported by --check so the operator sees why a full
 * `db:schema` is not the minimum safe change.
 */
function replayHazards(sql) {
  const hazards = [];
  if (/^\s*UPDATE\s+[a-z_]+\s+SET/im.test(sql)) hazards.push("UPDATE rows");
  if (/\bDROP\s+CONSTRAINT\b/i.test(sql)) hazards.push("DROP CONSTRAINT");
  if (/\bDELETE\s+FROM\b/i.test(sql)) hazards.push("DELETE rows");
  return hazards;
}

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const NOT_A_COLUMN = new Set([
  "constraint",
  "primary",
  "unique",
  "check",
  "foreign",
  "exclude",
  "like",
]);

/** Column names of a CREATE TABLE body, split on top-level commas only. */
function columnsOfTableBody(body) {
  const items = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      items.push(current);
      current = "";
    } else current += ch;
  }
  items.push(current);
  return items
    .map((item) => item.trim().match(/^"?([a-z0-9_]+)"?/i)?.[1]?.toLowerCase())
    .filter((name) => name && !NOT_A_COLUMN.has(name));
}

/**
 * What one step's SQL creates or removes, in statement order: tables and their
 * columns, columns added later, named indexes and constraints, and the
 * migration ids the file records itself. Only statements this repository uses
 * are understood (see tests/unit/schema-structure.test.ts).
 */
function structureEvents(rawSql) {
  const sql = stripComments(rawSql);
  const events = [];
  for (const m of sql.matchAll(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi,
  )) {
    const table = m[1].toLowerCase();
    let depth = 1;
    let end = m.index + m[0].length;
    while (end < sql.length && depth > 0) {
      if (sql[end] === "(") depth += 1;
      if (sql[end] === ")") depth -= 1;
      end += 1;
    }
    const body = sql.slice(m.index + m[0].length, end - 1);
    events.push({ at: m.index, op: "add", key: `table ${table}` });
    for (const column of columnsOfTableBody(body))
      events.push({ at: m.index, op: "add", key: `column ${table}.${column}` });
  }
  for (const m of sql.matchAll(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z0-9_]+)"?([^;]*)/gi,
  )) {
    const table = m[1].toLowerCase();
    const bodyAt = m.index + m[0].length - m[2].length;
    for (const c of m[2].matchAll(
      /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi,
    ))
      events.push({
        at: bodyAt + c.index,
        op: "add",
        key: `column ${table}.${c[1].toLowerCase()}`,
      });
    for (const c of m[2].matchAll(/\bADD\s+CONSTRAINT\s+"?([a-z0-9_]+)"?/gi))
      events.push({
        at: bodyAt + c.index,
        op: "add",
        key: `constraint ${c[1].toLowerCase()}`,
      });
    for (const c of m[2].matchAll(
      /\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi,
    ))
      events.push({
        at: bodyAt + c.index,
        op: "drop",
        key: `constraint ${c[1].toLowerCase()}`,
      });
  }
  for (const m of sql.matchAll(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\s+"?([a-z0-9_]+)"?/gi,
  ))
    events.push({ at: m.index, op: "add", key: `index ${m[1].toLowerCase()}` });
  for (const m of sql.matchAll(
    /INSERT\s+INTO\s+mc_schema_migrations\s*\(\s*id\s*\)\s*VALUES\s*\(\s*'([^']+)'/gi,
  ))
    events.push({ at: m.index, op: "add", key: `record ${m[1]}` });
  return events.sort((a, b) => a.at - b.at);
}

/** Migration ids a file records itself (INSERT INTO mc_schema_migrations). */
function migrationIdsRecordedBy(sql) {
  return structureEvents(sql)
    .filter((e) => e.key.startsWith("record "))
    .map((e) => e.key.slice("record ".length));
}

/**
 * The structures each step is responsible for once every step has run, in the
 * runner's order: a structure belongs to the step that first creates it, and a
 * named constraint a later step drops (and maybe re-adds) moves with it. Keys
 * look like "table t", "column t.c", "index i", "constraint c", "record id".
 */
function expectedStructures(steps = parseSchemaSteps(), read = readStepSql) {
  const owner = new Map();
  for (const step of steps) {
    owner.set(`record ${step.id}`, owner.get(`record ${step.id}`) ?? step.id);
    for (const event of structureEvents(read(step))) {
      if (event.op === "drop") owner.delete(event.key);
      else if (!owner.has(event.key)) owner.set(event.key, step.id);
    }
  }
  const byStep = new Map(steps.map((step) => [step.id, []]));
  for (const [key, id] of owner) byStep.get(id).push(key);
  return byStep;
}

/** What the database actually has, from the catalog (schema `public`). */
async function introspect(client) {
  const q = async (sql) => (await client.query(sql)).rows;
  const keys = new Set();
  for (const r of await q(
    "SELECT c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','i')",
  ))
    keys.add(`${r.kind === "i" ? "index" : "table"} ${r.name}`);
  for (const r of await q(
    "SELECT c.relname AS t, a.attname AS c FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped",
  ))
    keys.add(`column ${r.t}.${r.c}`);
  for (const r of await q(
    "SELECT con.conname AS name FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace WHERE n.nspname = 'public'",
  ))
    keys.add(`constraint ${r.name}`);
  if (keys.has("table mc_schema_migrations"))
    for (const r of await q("SELECT id FROM mc_schema_migrations"))
      keys.add(`record ${r.id}`);
  return keys;
}

module.exports = {
  parseSchemaSteps,
  readStepSql,
  tablesCreatedBy,
  managesOwnTransaction,
  replayHazards,
  structureEvents,
  migrationIdsRecordedBy,
  expectedStructures,
  introspect,
};
