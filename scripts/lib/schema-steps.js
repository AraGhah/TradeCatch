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

module.exports = {
  parseSchemaSteps,
  readStepSql,
  tablesCreatedBy,
  managesOwnTransaction,
  replayHazards,
};
