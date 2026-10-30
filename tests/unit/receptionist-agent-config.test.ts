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
    assert.equal(out.bookingEnabled, false);
    assert.match(out.instructions, /no calendar or booking system/);
    assert.match(out.instructions, /Never say a time is available, booked, confirmed or scheduled/);
    assert.match(out.instructions, /Never say you have sent, submitted or scheduled anything yourself/);
    assert.match(out.instructions, /Never offer a confirmation text or email/);
    assert.ok(!out.instructions.includes("book_appointment"));
  });

  it("describes the booking tools, and only a confirmed result as a booking, when phone booking is on", () => {
    const out = buildAgentConfig(
      config({ appointmentSettings: { phoneBooking: true } }),
      OPEN,
    );
    assert.equal(out.bookingEnabled, true);
    assert.match(out.instructions, /check_availability, book_appointment/);
    assert.match(out.instructions, /ONLY when book_appointment returns status confirmed/);
    assert.match(out.instructions, /Never invent or guess an opening/);
    assert.ok(!out.instructions.includes("no calendar or booking system"));
  });

  it("starts every call in French with one key for English and a short wait", () => {
    const out = buildAgentConfig(
      config({ languages: ["en", "fr"], defaultLanguage: "en" }),
      OPEN,
    );
    const menu = out.languageSelect;
    assert.equal(menu.startLanguage, "fr", "French first even when English is the default");
    assert.deepEqual(menu.keys, { "1": "en", "2": "fr" });
    assert.equal(menu.timeoutSeconds, 3);
    assert.match(menu.opening.statement.text, /Nord Plomberie/);
    assert.equal(menu.opening.statement.lang, "fr");
    assert.deepEqual(
      menu.opening.menu.map((m) => [m.lang, m.text]),
      [
        ["fr", "Pour continuer en français, restez en ligne."],
        ["en", "For English, press 1."],
      ],
    );
    assert.match(menu.afterChoice.fr.question, /Comment puis-je vous aider/);
    assert.match(menu.afterChoice.en.question, /How can I help you/);
    assert.match(menu.afterChoice.en.chosen, /continue in English/);
  });

  it("says nothing about a menu on a single-language line, and carries the after-hours notice", () => {
    const single = buildAgentConfig(config({ languages: ["fr"], defaultLanguage: "fr" }), CLOSED);
    assert.deepEqual(single.languageSelect.opening.menu, []);
    assert.match(single.languageSelect.afterChoice.fr.afterHoursNotice, /\S/);
    const open = buildAgentConfig(config(), OPEN);
    assert.equal(open.languageSelect.afterChoice.fr.afterHoursNotice, "");
  });

  it("passes the approved price, pace, and silence policy to the agent", () => {
    const priced = buildAgentConfig(
      config({ speakingSpeed: "slow", knowledge: { companyName: "Nord Plomberie", startingPrices: "Estimations gratuites." } }),
      OPEN,
    );
    assert.match(priced.instructions, /Approved pricing wording .*Estimations gratuites\./);
    assert.match(priced.instructions, /about 135 words a minute/);
    assert.equal(priced.speakingSpeed, "slow");
    assert.equal(priced.silence.maxCheckIns, 1);
    assert.match(priced.silence.checkIn.fr, /toujours là/);
    assert.match(priced.silence.goodbye.en, /Goodbye/);

    const unpriced = buildAgentConfig(config(), OPEN);
    assert.match(unpriced.instructions, /No pricing is approved/);
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
