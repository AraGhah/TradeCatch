import { readFileSync } from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseSchemaSteps } = require("../../scripts/lib/schema-steps.js");

/**
 * Every scheduling migration file, in the order `npm run db:schema` applies
 * them (012_scheduling, then 060/061/062), joined into one script. Read from
 * the runner's own step list so a new scheduling step is picked up here too.
 */
export function schedulingSchemaSql(): string {
  return (parseSchemaSteps() as { file: string }[])
    .filter((step) => step.file.startsWith("src/product/scheduling/"))
    .map((step) => readFileSync(path.join(process.cwd(), ...step.file.split("/")), "utf8"))
    .join("\n");
}
