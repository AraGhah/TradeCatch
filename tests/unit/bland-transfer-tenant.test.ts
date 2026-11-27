import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  authorizeBlandTool,
  blandToolSecrets,
  verifyBlandSignature,
} from "../../src/product/bland/auth";
import { mapPostCall, postCallSchema } from "../../src/product/bland/webhook";
import { resetBlandRoutesForTests } from "../../src/product/bland/routes";
import {
  resolveBlandTenant,
  type TenantDeps,
} from "../../src/product/bland/tenant";
import {
  resolveBlandTransfers,
  type BlandTransferVariables,
} from "../../src/product/bland/transfer";
import { parseReceptionistConfig } from "../../src/product/receptionist/config";
import {
  voiceCapabilitiesForPlan,
  type VoiceCapabilities,
} from "../../src/product/receptionist/plan-limits";
import type { ReceptionistConfig } from "../../src/product/receptionist/types";
import type { PlanId } from "../../src/product/saas/entitlements";

const TOOL = "tool-secret-for-tests-0123456789abcdef";
const PREVIOUS = "previous-tool-secret-0123456789abcdef";
const WEBHOOK = "webhook-secret-for-tests-0123456789abc";
const OPS = "ops-secret-for-tests-0123456789abcdef-x";

function bearer(token: string | undefined) {
  return new Request("http://localhost/api/bland/config", {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

describe("Bland tool authentication", () => {
  const env = {
    BLAND_TOOL_SECRET: TOOL,
    BLAND_WEBHOOK_SECRET: WEBHOOK,
    MISSED_CALL_OPS_SECRET: OPS,
  };

  it("accepts the tool secret and nothing else", () => {
    assert.deepEqual(authorizeBlandTool(bearer(TOOL), env), { ok: true });
    for (const token of [undefined, "", "wrong", `${TOOL}x`, TOOL.slice(0, -1)]) {
      assert.deepEqual(authorizeBlandTool(bearer(token), env), {
        ok: false,
        status: 401,
        code: "unauthorized",
      });
    }
  });

  it("the operations secret does not open the Bland endpoints", () => {
    assert.equal(authorizeBlandTool(bearer(OPS), env).ok, false);
    assert.equal(authorizeBlandTool(bearer(WEBHOOK), env).ok, false, "nor does the webhook secret");
  });

  it("is not anonymous when nothing is configured: it fails closed with 503", () => {
    assert.deepEqual(authorizeBlandTool(bearer(TOOL), {}), {
      ok: false,
      status: 503,
      code: "not_configured",
    });
    assert.equal(authorizeBlandTool(bearer(undefined), {}).ok, false);
  });

  it("refuses a short secret", () => {
    assert.equal(authorizeBlandTool(bearer("short"), { BLAND_TOOL_SECRET: "short" }).ok, false);
    assert.equal(blandToolSecrets({ BLAND_TOOL_SECRET: "short" }).length, 0);
  });

  it("refuses a Bland secret that is reused from another secret of the deployment", () => {
    for (const name of ["MISSED_CALL_OPS_SECRET", "CRON_SECRET", "AUTH_SECRET", "BLAND_WEBHOOK_SECRET"]) {
      const reused = { BLAND_TOOL_SECRET: TOOL, [name]: TOOL };
      assert.deepEqual(
        authorizeBlandTool(bearer(TOOL), reused),
        { ok: false, status: 503, code: "not_configured" },
        name,
      );
    }
  });

  it("accepts the previous secret during rotation, and only while it is set", () => {
    const rotating = { ...env, BLAND_TOOL_SECRET_PREVIOUS: PREVIOUS };
    assert.equal(authorizeBlandTool(bearer(PREVIOUS), rotating).ok, true);
    assert.equal(authorizeBlandTool(bearer(TOOL), rotating).ok, true);
    assert.equal(authorizeBlandTool(bearer(PREVIOUS), env).ok, false);
  });

  it("ignores a header that is not a bearer token", () => {
    const request = new Request("http://localhost/", { headers: { authorization: `Basic ${TOOL}` } });
    assert.equal(authorizeBlandTool(request, env).ok, false);
  });
});

describe("Bland webhook signature", () => {
  const body = JSON.stringify({ call_id: "c1", to: "+14385550100" });
  const sign = (text: string, secret = WEBHOOK) =>
    createHmac("sha256", secret).update(text).digest("hex");
  const env = { BLAND_WEBHOOK_SECRET: WEBHOOK, MISSED_CALL_OPS_SECRET: OPS };

  it("verifies the HMAC of the exact bytes", () => {
    assert.equal(verifyBlandSignature(body, sign(body), env), "ok");
    assert.equal(verifyBlandSignature(body, `sha256=${sign(body).toUpperCase()}`, env), "ok");
  });

  it("rejects a changed body, a wrong secret and a missing signature", () => {
    assert.equal(verifyBlandSignature(`${body} `, sign(body), env), "bad_signature");
    assert.equal(verifyBlandSignature(body, sign(body, "x".repeat(40)), env), "bad_signature");
    assert.equal(verifyBlandSignature(body, null, env), "bad_signature");
    assert.equal(verifyBlandSignature(body, "", env), "bad_signature");
  });

  it("is not configured without a usable secret (never accepts unsigned requests)", () => {
    assert.equal(verifyBlandSignature(body, sign(body), {}), "not_configured");
    assert.equal(
      verifyBlandSignature(body, sign(body, "short"), { BLAND_WEBHOOK_SECRET: "short" }),
      "not_configured",
    );
    assert.equal(
      verifyBlandSignature(body, sign(body), { BLAND_WEBHOOK_SECRET: WEBHOOK, MISSED_CALL_OPS_SECRET: WEBHOOK }),
      "not_configured",
      "reused secret",
    );
  });
});

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

const NORMAL = "+15145550111";
const EMERGENCY = "+15145550222";
const BACKUP = "+15145550333";
const BLAND_LINE = "+14385550100";
// Wednesday 10:00 in Toronto (inside 08:00–17:00 Mon–Fri) and Wednesday 23:00.
const IN_HOURS = new Date("2026-10-21T14:00:00Z");
const AFTER_HOURS = new Date("2026-10-22T03:00:00Z");

function config(over: Record<string, unknown> = {}): ReceptionistConfig {
  return {
    ...parseReceptionistConfig({
      id: "rc_transfer",
      clientAccountId: "client_transfer",
      phoneNumberE164: "+15145550000",
      businessName: "Nord Plomberie",
      notifications: [],
      fallbackTransferE164: NORMAL,
      emergencyTransferE164: EMERGENCY,
      backupTransferE164: BACKUP,
      ...over,
    }),
    source: "profile" as const,
  };
}

const ALL: VoiceCapabilities = {
  voice: true,
  phoneBooking: true,
  transfer: true,
  emergencyRouting: true,
  transcripts: true,
};

function resolve(
  cfg: ReceptionistConfig,
  over: { now?: Date; capabilities?: VoiceCapabilities; ownLines?: string[] } = {},
) {
  return resolveBlandTransfers({
    config: cfg,
    now: over.now ?? IN_HOURS,
    capabilities: over.capabilities,
    ownLines: over.ownLines ?? [BLAND_LINE],
  });
}

describe("Bland transfer destinations", () => {
  it("maps the configured numbers to the three pathway variables", () => {
    const { variables, rejected } = resolve(config());
    assert.deepEqual(variables, {
      normal_transfer_number: NORMAL,
      backup_transfer_number: BACKUP,
      emergency_transfer_number: EMERGENCY,
      transfer_available: "true",
      emergency_transfer_available: "true",
      transfer_unavailable_reason: "",
    } satisfies BlandTransferVariables);
    assert.deepEqual(rejected, []);
  });

  it("uses empty strings, never undefined, when nothing is configured", () => {
    const { variables } = resolve(
      config({ fallbackTransferE164: undefined, emergencyTransferE164: undefined, backupTransferE164: undefined }),
    );
    assert.deepEqual(variables, {
      normal_transfer_number: "",
      backup_transfer_number: "",
      emergency_transfer_number: "",
      transfer_available: "false",
      emergency_transfer_available: "false",
      transfer_unavailable_reason: "not_configured",
    });
  });

  it("closes the normal transfer after hours but keeps the emergency line", () => {
    const { variables } = resolve(config({ transferHours: "business_hours" }), { now: AFTER_HOURS });
    assert.equal(variables.normal_transfer_number, "");
    assert.equal(variables.backup_transfer_number, "", "no backup without a normal line");
    assert.equal(variables.transfer_available, "false");
    assert.equal(variables.transfer_unavailable_reason, "after_hours");
    assert.equal(variables.emergency_transfer_number, EMERGENCY);
    assert.equal(variables.emergency_transfer_available, "true");
  });

  it("keeps the normal transfer after hours when the owner chose 'always'", () => {
    const { variables } = resolve(config({ transferHours: "always" }), { now: AFTER_HOURS });
    assert.equal(variables.normal_transfer_number, NORMAL);
    assert.equal(variables.transfer_unavailable_reason, "");
  });

  it("falls back to the normal line for emergencies only when the plan includes emergency routing", () => {
    const noDedicated = config({ emergencyTransferE164: undefined });
    assert.equal(resolve(noDedicated, { capabilities: ALL }).variables.emergency_transfer_number, NORMAL);
    const withoutRouting = { ...ALL, emergencyRouting: false };
    assert.equal(resolve(noDedicated, { capabilities: withoutRouting }).variables.emergency_transfer_number, "");
    assert.equal(
      resolve(config(), { capabilities: withoutRouting }).variables.emergency_transfer_number,
      "",
      "a saved emergency number is unusable on a plan without it",
    );
  });

  it("gives no number at all on a plan without live transfer", () => {
    const { variables } = resolve(config(), {
      capabilities: { ...ALL, transfer: false, emergencyRouting: false },
    });
    assert.equal(variables.normal_transfer_number, "");
    assert.equal(variables.backup_transfer_number, "");
    assert.equal(variables.emergency_transfer_number, "");
    assert.equal(variables.transfer_unavailable_reason, "plan");
  });

  it("drops a backup that is the same as the normal number", () => {
    const { variables } = resolve(config({ backupTransferE164: NORMAL }));
    assert.equal(variables.backup_transfer_number, "");
  });

  it("refuses numbers an owner profile may not use, with a reason for each", () => {
    const cases: [string, string][] = [
      ["+12125550123", "not_canadian_geographic"],
      ["+19005550123", "premium_or_short_code"],
      ["+15144111234", "premium_or_short_code"],
    ];
    for (const [number, reason] of cases) {
      const { variables, rejected } = resolve(config({ fallbackTransferE164: number }));
      assert.equal(variables.normal_transfer_number, "", number);
      assert.deepEqual(rejected, [{ slot: "normal", reason }], number);
      assert.equal(variables.transfer_unavailable_reason, "invalid_number");
    }
  });

  it("lets a founder env config use a non-Canadian number but still refuses premium ones", () => {
    const founder = (number: string) => ({ ...config({ fallbackTransferE164: number }), source: "env" as const });
    assert.equal(resolve(founder("+12125550123")).variables.normal_transfer_number, "+12125550123");
    assert.equal(resolve(founder("+19005550123")).variables.normal_transfer_number, "");
  });

  it("never transfers a call back into the line it came in on", () => {
    // The Bland number, the business's own public line, and its SMS line.
    for (const looped of [BLAND_LINE, "+15145550000", "+15145550777"]) {
      const { variables, rejected } = resolve(
        config({ fallbackTransferE164: looped, smsFromE164: "+15145550777" }),
      );
      assert.equal(variables.normal_transfer_number, "", looped);
      assert.equal(rejected[0]?.reason, "loops_to_own_line", looped);
    }
    const other = resolve(config({ emergencyTransferE164: "+14385550101" }), {
      ownLines: [BLAND_LINE, "+14385550101"],
    });
    assert.equal(other.variables.emergency_transfer_number, "", "another Bland line is not a destination either");
  });
});

// ---------------------------------------------------------------------------
// Tenant resolution
// ---------------------------------------------------------------------------

function deps(
  over: Partial<Omit<TenantDeps, "configs">> & {
    configs?: ReceptionistConfig[];
    plan?: PlanId;
    orgStatus?: string | null;
  } = {},
): TenantDeps {
  const cfgs = over.configs ?? [config({ phoneBooking: true })];
  return {
    findRoute: over.findRoute ?? ((to) =>
      to === BLAND_LINE ? { toE164: BLAND_LINE, configId: "rc_transfer" } : null),
    refresh: over.refresh ?? (async () => {}),
    configs: () => cfgs,
    confirmLineActive: over.confirmLineActive ?? (async () => true),
    findOrganization:
      over.findOrganization ??
      (async () =>
        over.orgStatus === null
          ? null
          : { id: "org_1", status: over.orgStatus ?? "active", plan: over.plan ?? "professional" }),
  };
}

describe("Bland tenant resolution", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    mock.method(console, "error", () => {});
  });
  afterEach(() => {
    process.env = { ...saved };
    mock.restoreAll();
  });

  it("answers only for a routed number: there is no default business", async () => {
    const result = await resolveBlandTenant("+14165550199", deps());
    assert.deepEqual(result, { ok: false, status: 404, code: "no_route" });
  });

  it("does not answer for a route whose receptionist is missing or switched off", async () => {
    const gone = await resolveBlandTenant(BLAND_LINE, deps({ configs: [] }));
    assert.deepEqual(gone, { ok: false, status: 404, code: "no_receptionist" });
    const disabled = await resolveBlandTenant(BLAND_LINE, deps({ configs: [config({ enabled: false })] }));
    assert.deepEqual(disabled, { ok: false, status: 404, code: "no_receptionist" });
  });

  it("stops when the owner switched the line off", async () => {
    const result = await resolveBlandTenant(BLAND_LINE, deps({ confirmLineActive: async () => false }));
    assert.deepEqual(result, { ok: false, status: 403, code: "line_inactive" });
  });

  it("stops for an inactive or missing organization", async () => {
    for (const orgStatus of ["suspended", "canceled", null]) {
      const result = await resolveBlandTenant(BLAND_LINE, deps({ orgStatus }));
      assert.deepEqual(result, { ok: false, status: 403, code: "organization_inactive" }, String(orgStatus));
    }
  });

  it("uses the organization's CURRENT plan: a plan without voice gets no receptionist", async () => {
    const result = await resolveBlandTenant(BLAND_LINE, deps({ plan: "starter" }));
    assert.deepEqual(result, { ok: false, status: 403, code: "plan_without_voice" });
  });

  it("applies plan limits to the config the agent will use", async () => {
    process.env.LAUNCH_ENABLE_CALL_TRANSFER = "1";
    const book = config({ phoneBooking: true });

    const professional = await resolveBlandTenant(BLAND_LINE, deps({ configs: [book], plan: "professional" }));
    assert.ok(professional.ok);
    assert.equal(professional.tenant.config.phoneBooking, true);
    assert.equal(professional.tenant.config.fallbackTransferE164, NORMAL, "Professional transfers live calls");
    assert.deepEqual(professional.tenant.capabilities, voiceCapabilitiesForPlan("professional"));
    assert.equal(professional.tenant.capabilities?.transfer, true);
    assert.equal(professional.tenant.capabilities?.emergencyRouting, true);
    assert.equal(professional.tenant.organizationId, "org_1");

    const essential = await resolveBlandTenant(BLAND_LINE, deps({ configs: [book], plan: "essential" }));
    assert.ok(essential.ok);
    assert.equal(essential.tenant.config.phoneBooking, false, "booking needs Professional");
    assert.equal(essential.tenant.config.fallbackTransferE164, undefined, "no live transfer on Essential");
    assert.equal(essential.tenant.config.emergencyTransferE164, undefined);

    const growth = await resolveBlandTenant(BLAND_LINE, deps({ configs: [book], plan: "growth" }));
    assert.ok(growth.ok);
    assert.equal(growth.tenant.config.phoneBooking, false, "legacy Growth keeps exactly what it was sold");
    assert.equal(growth.tenant.config.fallbackTransferE164, undefined);

    const plus = await resolveBlandTenant(BLAND_LINE, deps({ configs: [book], plan: "receptionist" }));
    assert.ok(plus.ok);
    assert.equal(plus.tenant.config.fallbackTransferE164, NORMAL);
    assert.deepEqual(plus.tenant.capabilities, voiceCapabilitiesForPlan("receptionist"));
  });

  it("has no plan to enforce for a founder env config", async () => {
    const founder = { ...config(), source: "env" as const };
    const result = await resolveBlandTenant(BLAND_LINE, deps({ configs: [founder], orgStatus: null }));
    assert.ok(result.ok);
    assert.equal(result.tenant.organizationId, null);
    assert.equal(result.tenant.capabilities, undefined);
    assert.equal(result.tenant.config.fallbackTransferE164, NORMAL);
  });

  it("answers 503 when a dependency fails, never a half-resolved business", async () => {
    const result = await resolveBlandTenant(
      BLAND_LINE,
      deps({
        refresh: async () => {
          throw new Error("db down");
        },
      }),
    );
    assert.deepEqual(result, { ok: false, status: 503, code: "unavailable" });
  });
});

// ---------------------------------------------------------------------------
// Post-call mapping
// ---------------------------------------------------------------------------

describe("Bland post-call mapping", () => {
  afterEach(() => resetBlandRoutesForTests());

  const tenant = { route: { toE164: BLAND_LINE, configId: "rc_transfer" }, config: config(), organizationId: null };
  const env = { BLAND_ROUTES_JSON: JSON.stringify([{ toE164: BLAND_LINE, configId: "rc_transfer" }]) };
  const payload = (over: Record<string, unknown> = {}) =>
    postCallSchema.parse({ call_id: "bl-call-1", to: BLAND_LINE, from: "+15145559876", inbound: true, ...over });
  const map = (over: Record<string, unknown> = {}) => mapPostCall(payload(over), tenant, IN_HOURS, env);

  it("keeps what was said and drops the tool traces", () => {
    const mapped = map({
      transcripts: [
        { user: "assistant", text: "Bonjour" },
        { user: "user", text: "J'ai une fuite" },
        { user: "agent-action", text: "book_appointment {...}" },
      ],
      call_length: 1.5,
    });
    assert.deepEqual(mapped.transcript, [
      { speaker: "agent", text: "Bonjour" },
      { speaker: "caller", text: "J'ai une fuite" },
    ]);
    assert.equal(mapped.durationSeconds, 90);
    assert.equal(mapped.fromE164, "+15145559876");
    assert.equal(mapped.transfer, undefined);
  });

  it("reads why the call ended", () => {
    assert.equal(map({ call_ended_by: "USER" }).endReason, "caller_hung_up");
    assert.equal(map({ status: "error" }).endReason, "error");
    assert.equal(map({ call_ended_by: "ASSISTANT" }).endReason, "completed");
  });

  it("recognises an emergency transfer by OUR emergency number, not by what Bland says", () => {
    const own = { ...tenant, config: config({ transferHours: "always" }) };
    const toEmergency = mapPostCall(payload({ transferred_to: EMERGENCY }), own, IN_HOURS, env);
    assert.equal(toEmergency.emergency, true);
    assert.equal(toEmergency.transfer?.completed, true);
    assert.equal(toEmergency.transfer?.answerConfirmed, false, "a transfer is not proof someone answered");
    assert.equal(toEmergency.transfer?.mechanism, "blind");

    const elsewhere = mapPostCall(payload({ transferred_to: "+15145559999" }), own, IN_HOURS, env);
    assert.equal(elsewhere.emergency, undefined);
    assert.equal(elsewhere.transfer?.completed, true);
  });

  it("reports a failed warm transfer as not completed", () => {
    const mapped = map({ transferred_to: NORMAL, warm_transfer_call: { state: "no-answer" } });
    assert.equal(mapped.transfer?.completed, false);
    assert.equal(mapped.transfer?.mechanism, "warm");
  });

  it("takes the language only from fr/en and otherwise keeps the business default", () => {
    assert.equal(map({ variables: { language: "en-CA" } }).language, "en");
    assert.equal(map({ variables: { language: "klingon" } }).language, tenant.config.defaultLanguage);
  });

  it("refuses an oversized or malformed payload", () => {
    assert.equal(postCallSchema.safeParse({ call_id: "bad id", to: BLAND_LINE }).success, false);
    assert.equal(
      postCallSchema.safeParse({ call_id: "ok", to: BLAND_LINE, transcripts: [{ user: "user", text: "x".repeat(5000) }] }).success,
      false,
    );
  });
});
