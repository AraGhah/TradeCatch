/**
 * Regenerates docs/bland/*.json from the code that defines them
 * (src/product/receptionist/bland/tools.ts). tests/unit/bland-tools.test.ts
 * fails when these files are out of date.
 *
 *   npx tsx scripts/write-bland-config-docs.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  renderBlandTools,
  renderInboundSetup,
} from "../src/product/receptionist/bland/tools";

export const DOC_BASE_URL = "https://YOUR-DEPLOYMENT";

const dir = join(__dirname, "..", "docs", "bland");
const options = { baseUrl: DOC_BASE_URL };

writeFileSync(
  join(dir, "bland-tools.json"),
  `${JSON.stringify(renderBlandTools(options), null, 2)}\n`,
);
writeFileSync(
  join(dir, "bland-inbound-number.json"),
  `${JSON.stringify(renderInboundSetup(options), null, 2)}\n`,
);
console.log("Wrote docs/bland/bland-tools.json and docs/bland/bland-inbound-number.json");
