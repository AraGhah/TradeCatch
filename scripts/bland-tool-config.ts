/**
 * Prints the Bland configuration for the TradeCatch endpoints. Sends nothing
 * to Bland, reads no database and holds no secret.
 *
 *   npm run bland:config -- --base-url https://app.example.com
 *   npm run bland:config -- --new-token --line +15145550100 --receptionist +14505550101
 *
 * `--new-token` makes a fresh line token. The token is printed once for you to
 * store as a Bland Secret; only its SHA-256 goes into BLAND_LINES_JSON on the
 * server, so the server never holds a usable token.
 */

import { newBlandLineToken } from "../src/product/receptionist/bland/lines";
import {
  renderBlandTools,
  renderInboundSetup,
} from "../src/product/receptionist/bland/tools";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

const baseUrl = arg("base-url");
const wantsToken = process.argv.includes("--new-token");

if (!baseUrl && !wantsToken) {
  console.error(
    "Usage: bland:config --base-url https://your-deployment [--new-token --line +1... --receptionist +1...]",
  );
  process.exit(2);
}

if (wantsToken) {
  const line = arg("line");
  const receptionist = arg("receptionist");
  if (!line || !receptionist) {
    console.error("--new-token needs --line (the Bland number) and --receptionist (the business's TradeCatch number).");
    process.exit(2);
  }
  const { token, tokenSha256 } = newBlandLineToken();
  console.log(
    JSON.stringify(
      {
        storeThisInBlandAsASecret: token,
        addThisEntryToBLAND_LINES_JSON: {
          number: line,
          receptionistNumber: receptionist,
          tokenSha256,
        },
        note: "The token is shown once and is not stored by TradeCatch. Do not commit it.",
      },
      null,
      2,
    ),
  );
}

if (baseUrl) {
  if (!/^https:\/\/[^/\s]+$/.test(baseUrl)) {
    console.error("--base-url must be an https origin with no path, e.g. https://app.example.com");
    process.exit(2);
  }
  console.log(
    JSON.stringify(
      {
        createEachToolWith: "POST https://api.bland.ai/v1/tools",
        tools: renderBlandTools({ baseUrl }),
        thenSetUpTheInboundNumber: "POST https://api.bland.ai/v1/inbound/<the Bland number>",
        inboundNumber: renderInboundSetup({ baseUrl }),
      },
      null,
      2,
    ),
  );
}
