import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../../src/app/api/receptionist/agent-config/route";
import { resetReceptionistRuntimeForTests } from "../../src/product/receptionist/runtime";

const SECRET = "s3cret-s3cret";
const NUMBER = "+14385550100";
const FRIEND = "+15145551111";

const CONFIG = {
  id: "rc_policy",
  clientAccountId: "client_policy",
  phoneNumberE164: NUMBER,
  businessName: "Nord Plomberie",
  languages: ["fr", "en"],
  defaultLanguage: "fr",
  notifications: [],
  personalContacts: [FRIEND],
  personalCallPolicy: "message",
  personalCallMessageFr: "Salut, je te rappelle.",
  unknownCallerPolicy: "message",
};

function get(query: string) {
  return GET(
    new NextRequest(`http://localhost/api/receptionist/agent-config?${query}`, {
      headers: { authorization: `Bearer ${SECRET}` },
    }),
  );
}

describe("agent-config caller policy (LiveKit path)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.MISSED_CALL_OPS_SECRET = SECRET;
    process.env.RECEPTIONIST_CONFIG_JSON = JSON.stringify([CONFIG]);
    resetReceptionistRuntimeForTests();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetReceptionistRuntimeForTests();
  });

  it("returns only this call's decision for a personal contact, never the list", async () => {
    const res = await get(`number=${encodeURIComponent(NUMBER)}&from=${encodeURIComponent("514-555-1111")}`);
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text) as { config: { callerPolicy?: { kind: string; messages: { lang: string; text: string }[] } } };
    assert.equal(body.config.callerPolicy?.kind, "personal_message");
    assert.equal(body.config.callerPolicy?.messages[0]?.text, "Salut, je te rappelle.");
    assert.doesNotMatch(text, /personalContacts|5145551111/, "the list and the number stay on the server");
  });

  it("an ordinary caller gets no policy", async () => {
    const body = (await (await get(`number=${encodeURIComponent(NUMBER)}&from=%2B15145559876`)).json()) as { config: Record<string, unknown> };
    assert.equal(body.config.callerPolicy, undefined);
  });

  it("a withheld caller ID gets the withheld-number policy", async () => {
    const body = (await (await get(`number=${encodeURIComponent(NUMBER)}&from=anonymous`)).json()) as { config: { callerPolicy?: { kind: string } } };
    assert.equal(body.config.callerPolicy?.kind, "unknown_message");
  });

  it("agents that do not send `from` keep today's behaviour", async () => {
    const body = (await (await get(`number=${encodeURIComponent(NUMBER)}`)).json()) as { config: Record<string, unknown> };
    assert.equal(body.config.callerPolicy, undefined);
  });

  it("still requires the ops bearer", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/receptionist/agent-config?number=${encodeURIComponent(NUMBER)}&from=${FRIEND}`));
    assert.equal(res.status, 401);
  });
});
