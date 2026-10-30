import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../../src/app/api/receptionist/agent-config/route";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { buildAgentConfig } from "../../src/product/receptionist/agent-config";
import {
  buildProfileConfig,
  profileSettingsSchema,
} from "../../src/product/receptionist/profile";

const client = demoClientAccount({
  id: "client_agent",
  contractorDisplayName: "Nord Plomberie",
});

function config(settings: Record<string, unknown> = {}) {
  return buildProfileConfig(
    {
      organizationId: "org_agent",
      phoneNumberE164: "+14385597100",
      activated: true,
      settings: profileSettingsSchema.parse({
        knowledge: { companyName: "Nord Plomberie" },
        notifyEmail: "owner@example.com",
        ...settings,
      }),
      updatedAt: new Date().toISOString(),
    },
    { client },
  );
}

// 2026-10-28 is a Wednesday; business hours default to Mon–Fri 08:00–17:00 Toronto.
const OPEN = new Date("2026-10-28T15:00:00Z");
const CLOSED = new Date("2026-10-28T03:00:00Z");

describe("agent config", () => {
  it("tells the model it must call transfer_call, not just say it will", () => {
    const out = buildAgentConfig(
      config({
        fallbackTransferE164: "+14389957350",
        emergencyTransferE164: "+14389957350",
      }),
      OPEN,
    );
    assert.match(out.instructions, /MUST call the transfer_call tool/);
    assert.match(out.instructions, /currently OPEN/);
    assert.match(out.instructions, /Nord Plomberie/);
    assert.equal(out.transferE164, "+14389957350");
    assert.equal(out.emergencyTransferE164, "+14389957350");
    assert.equal(out.afterHours, false);
  });

  it("restricts transfers to emergencies when the office is closed", () => {
    const out = buildAgentConfig(
      config({ emergencyTransferE164: "+14389957350" }),
      CLOSED,
    );
    assert.equal(out.afterHours, true);
    assert.match(out.instructions, /currently CLOSED/);
    assert.match(out.instructions, /only transfer for an emergency/);
  });

  it("never offers a transfer when no human line exists", () => {
    const base = config();
    const out = buildAgentConfig(
      {
        ...base,
        fallbackTransferE164: undefined,
        emergencyTransferE164: undefined,
        routing: [],
      },
      OPEN,
    );
    assert.equal(out.transferE164, null);
    assert.equal(out.emergencyTransferE164, null);
    assert.match(out.instructions, /No live transfer is configured/);
    assert.ok(!out.instructions.includes("MUST call the transfer_call"));
  });

  it("forbids claiming bookings or submissions the agent cannot make", () => {
    const out = buildAgentConfig(config(), OPEN);
    assert.match(out.instructions, /no calendar, booking system/);
    assert.match(out.instructions, /Never say you submitted/);
  });
});

describe("GET /api/receptionist/agent-config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function req(path: string, headers: Record<string, string> = {}) {
    return new NextRequest(`http://localhost${path}`, { headers });
  }

  it("rejects callers without the ops bearer", async () => {
    process.env.MISSED_CALL_OPS_SECRET = "s3cret-s3cret";
    const res = await GET(
      req("/api/receptionist/agent-config?number=%2B14385597100"),
    );
    assert.equal(res.status, 401);
  });

  it("requires a number", async () => {
    process.env.MISSED_CALL_OPS_SECRET = "s3cret-s3cret";
    const res = await GET(
      req("/api/receptionist/agent-config", {
        authorization: "Bearer s3cret-s3cret",
      }),
    );
    assert.equal(res.status, 400);
  });

  it("does not answer an unknown number as some other business", async () => {
    process.env.MISSED_CALL_OPS_SECRET = "s3cret-s3cret";
    const res = await GET(
      req("/api/receptionist/agent-config?number=%2B14165550199", {
        authorization: "Bearer s3cret-s3cret",
      }),
    );
    assert.equal(res.status, 404);
  });
});
