import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appointmentActionSchema,
  availabilitySchema,
  bookSchema,
} from "../../src/product/receptionist/agent-api";
import { buildBlandConfig } from "../../src/product/receptionist/bland/config";
import { hashBlandToken } from "../../src/product/receptionist/bland/lines";
import {
  blandDetailsSchema,
  blandReportSchema,
  dropUnresolved,
} from "../../src/product/receptionist/bland/schemas";
import {
  AUTH_PLACEHOLDER,
  CONFIG_VARIABLES,
  renderBlandTools,
  renderInboundSetup,
  type BlandToolDefinition,
} from "../../src/product/receptionist/bland/tools";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";

const BASE = "https://app.example.com";
const tools = renderBlandTools({ baseUrl: BASE });
const RESERVED = ["input", "speak", "transfer", "switch", "wait", "finish", "press", "button", "say", "pause", "record", "play", "dial", "hang"];

const SYSTEM = {
  "{{to}}": "+15145550111",
  "{{phone_number}}": "+15145559876",
  "{{call_id}}": "11111111-2222-3333-4444-555555555555",
};

/** What Bland does to a tool body: system variables and the model's inputs. */
function fill(tool: BlandToolDefinition, input: Record<string, string>) {
  const body: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(tool.body)) {
    const match = /^\{\{input\.(\w+)\}\}$/.exec(template);
    // An input the model did not give is left as the literal template.
    body[key] = match ? (input[match[1]] ?? template) : (SYSTEM[template as keyof typeof SYSTEM] ?? template);
  }
  return body;
}

const schemaFor = (tool: BlandToolDefinition) => {
  if (tool.url.endsWith("/availability")) return availabilitySchema;
  if (tool.url.endsWith("/book")) return bookSchema;
  if (tool.url.endsWith("/appointments")) return appointmentActionSchema;
  if (tool.url.endsWith("/details")) return blandDetailsSchema;
  if (tool.url.endsWith("/report")) return blandReportSchema;
  throw new Error(`no schema for ${tool.url}`);
};

describe("Bland tool definitions", () => {
  it("has the documented shape for POST /v1/tools", () => {
    for (const tool of tools) {
      assert.match(tool.name, /^[a-z_]+$/);
      assert.ok(!RESERVED.includes(tool.name), `${tool.name} is a name Bland reserves`);
      assert.ok(tool.description.length > 20);
      assert.equal(tool.method, "POST");
      assert.ok(tool.url.startsWith("https://"));
      assert.equal(tool.input_schema.type, "object");
      assert.ok(tool.timeout >= 1000);
    }
    assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
  });

  it("every endpoint a tool calls exists in the app", () => {
    const routes = new Set(
      readdirSync(join(__dirname, "..", "..", "src", "app", "api", "bland")).map((d) => `/api/bland/${d}`),
    );
    for (const tool of tools) {
      assert.ok(routes.has(new URL(tool.url).pathname), `${tool.url} has no route`);
    }
  });

  it("the line, the call and the caller always come from Bland's system variables, never from the model", () => {
    for (const tool of tools) {
      assert.equal(tool.body.number, "{{to}}");
      assert.equal(tool.body.callId, "{{call_id}}");
      assert.equal(tool.body.from, "{{phone_number}}");
      for (const reserved of ["number", "callId", "from"]) {
        assert.ok(!(reserved in tool.input_schema.properties), `${tool.name} lets the model set ${reserved}`);
      }
    }
  });

  it("every input a body uses is declared, and every required input exists", () => {
    for (const tool of tools) {
      const used = Object.values(tool.body)
        .map((v) => /^\{\{input\.(\w+)\}\}$/.exec(v)?.[1])
        .filter(Boolean);
      assert.deepEqual(new Set(used), new Set(Object.keys(tool.input_schema.properties)), tool.name);
      for (const required of tool.input_schema.required) {
        assert.ok(required in tool.input_schema.properties, `${tool.name}.${required}`);
      }
      for (const required of tool.input_schema.required) {
        assert.ok(required in tool.input_schema.example, `${tool.name} example lacks ${required}`);
      }
    }
  });

  it("holds no real secret: the Authorization value is a placeholder, and nothing else is secret", () => {
    const json = JSON.stringify(tools);
    assert.ok(json.includes(AUTH_PLACEHOLDER));
    assert.doesNotMatch(json, /tcbl_[0-9a-f]{20}/);
    assert.doesNotMatch(json, /MISSED_CALL_OPS_SECRET|ops secret/i);
  });

  it("accepts a reference to a Bland secret in place of the placeholder", () => {
    const custom = renderBlandTools({ baseUrl: `${BASE}/`, authorization: "Bearer {{secret.line}}" });
    assert.ok(custom.every((t) => t.headers.Authorization === "Bearer {{secret.line}}"));
    assert.ok(custom.every((t) => !t.url.includes("//api")), "no doubled slash");
  });

  describe("what each tool sends satisfies the endpoint it calls", () => {
    for (const tool of tools) {
      it(`${tool.name}: with all example inputs`, () => {
        const body = { language: "en", ...dropUnresolved(fill(tool, tool.input_schema.example)) };
        const parsed = schemaFor(tool).safeParse(body);
        assert.ok(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues));
      });

      it(`${tool.name}: with only the required inputs (the rest left as unfilled templates)`, () => {
        const only = Object.fromEntries(
          tool.input_schema.required.map((key) => [key, tool.input_schema.example[key]]),
        );
        const body = { language: "en", ...dropUnresolved(fill(tool, only)) };
        const parsed = schemaFor(tool).safeParse(body);
        assert.ok(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues));
      });
    }

    it("each appointment tool selects exactly one action", () => {
      const actions = tools
        .filter((t) => t.url.endsWith("/appointments"))
        .map((t) => t.body.action)
        .sort();
      assert.deepEqual(actions, ["cancel", "find", "move", "text"]);
    });

    it("the report tool never lets the model confirm a transfer was answered", () => {
      const report = tools.find((t) => t.name === "report_call")!;
      const body = {
        language: "en",
        ...dropUnresolved(fill(report, { intent: "transfer", transferCompleted: "true", transferTarget: "Owner" })),
      };
      const parsed = blandReportSchema.parse(body);
      assert.equal(parsed.transfer?.completed, true);
      assert.equal(parsed.transfer?.answerConfirmed, false);
    });
  });
});

describe("Bland call-start data", () => {
  const setup = renderInboundSetup({ baseUrl: BASE });
  const entry = setup.dynamic_data[0];

  /** The subset of JSONPath the mapping uses: $.a.b and $.a[0].b */
  function jsonPath(value: unknown, path: string): { found: boolean; value?: unknown } {
    let current: unknown = value;
    for (const part of path.replace(/^\$\.?/, "").split(".").filter(Boolean)) {
      const m = /^(\w+)(?:\[(\d+)\])?$/.exec(part);
      if (!m || current === null || typeof current !== "object" || !(m[1] in current)) {
        return { found: false };
      }
      current = (current as Record<string, unknown>)[m[1]];
      if (m[2] !== undefined) {
        if (!Array.isArray(current) || !(Number(m[2]) in current)) return { found: false };
        current = current[Number(m[2])];
      }
    }
    return { found: true, value: current };
  }

  it("asks for the line, the caller and the call, with the line's token", () => {
    assert.equal(entry.url, `${BASE}/api/bland/config`);
    assert.equal(entry.method, "GET");
    assert.deepEqual(entry.query, { number: "{{to}}", from: "{{phone_number}}", callId: "{{call_id}}" });
    assert.equal(entry.headers.Authorization, AUTH_PLACEHOLDER);
    assert.equal(entry.timeout, 2000);
  });

  it("every mapped path exists in the real response", () => {
    const config = parseReceptionistConfig({
      id: "rc_t",
      clientAccountId: "client_t",
      phoneNumberE164: "+14385550100",
      businessName: "Nord Plomberie",
      notifications: [],
      fallbackTransferE164: "+15145550142",
      emergencyTransferE164: "+15145550143",
      transferHours: "always",
      smsFromE164: "+14385550199",
    });
    const response = {
      ok: true,
      answering: true,
      config: buildBlandConfig(config, {
        line: { number: "+15145550111", receptionistNumber: "+14385550100", tokenSha256: hashBlandToken("x") },
        now: new Date("2026-11-18T16:00:00Z"),
        from: "+15145559876",
        bookingProvider: "calcom",
      }),
    };
    const optional = new Set(["tc_policy_kind", "tc_policy_message"]);
    for (const variable of entry.response_data) {
      const result = jsonPath(response, variable.data);
      if (!optional.has(variable.name)) {
        assert.ok(result.found, `${variable.name} -> ${variable.data}`);
      }
    }
    assert.equal(jsonPath(response, "$.config.transfer.emergency").value, "+15145550143");
    assert.equal(jsonPath(response, "$.config.capabilities.booking").value, true);
  });

  it("each variable has a unique name and a plain-language use", () => {
    assert.equal(new Set(CONFIG_VARIABLES.map((v) => v.name)).size, CONFIG_VARIABLES.length);
    assert.ok(CONFIG_VARIABLES.every((v) => v.name.startsWith("tc_") && v.context.length > 10));
  });
});

describe("published configuration files", () => {
  // docs/bland/*.json are what an operator pastes into Bland. They are generated
  // (npx tsx scripts/write-bland-config-docs.ts), so they cannot drift from the code.
  const read = (name: string): unknown =>
    JSON.parse(
      readFileSync(join(__dirname, "..", "..", "docs", "bland", name), "utf8"),
    );
  const options = { baseUrl: "https://YOUR-DEPLOYMENT" };

  it("bland-tools.json matches the code", () => {
    assert.deepEqual(read("bland-tools.json"), renderBlandTools(options));
  });

  it("bland-inbound-number.json matches the code", () => {
    assert.deepEqual(
      read("bland-inbound-number.json"),
      renderInboundSetup(options),
    );
  });
});

describe("unfilled templates", () => {
  it("drops empty and literal-template values and keeps everything else", () => {
    assert.deepEqual(
      dropUnresolved({ a: "{{input.a}}", b: "", c: "  ", d: "ok", e: 5, f: "{{to}}", g: "text {{x}}" }),
      { d: "ok", e: 5, g: "text {{x}}" },
    );
  });
});
