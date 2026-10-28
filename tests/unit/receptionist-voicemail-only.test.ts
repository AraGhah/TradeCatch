import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseReceptionistConfig,
  validateReceptionistConfig,
  loadReceptionistConfigsFromEnv,
} from "../../src/product/receptionist/config";
import { createReceptionistEngine } from "../../src/product/receptionist/engine";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import { createRuleBrain } from "../../src/product/receptionist/brain-rules";
import { createReceptionistNotifier } from "../../src/product/receptionist/notifications";
import { createMemorySmsPort } from "../../src/product/missed-call/twilio";
import {
  buildProfileConfig,
  profileSettingsSchema,
} from "../../src/product/receptionist/profile";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";

const input = {
  id: "rc_email",
  clientAccountId: "client_email",
  phoneNumberE164: "+14385597001",
  businessName: "Fixture Business",
  languages: ["fr"],
  allowVoicemailOnly: true,
  notifications: [{ type: "email", to: "owner@example.test" }],
  smsRecoveryOnIncomplete: false,
};
test("production voicemail-only requires explicit opt-in and an email recipient", () => {
  assert.equal(
    validateReceptionistConfig(parseReceptionistConfig(input)).ok,
    true,
  );
  assert.equal(
    validateReceptionistConfig(
      parseReceptionistConfig({ ...input, allowVoicemailOnly: false }),
    ).ok,
    false,
  );
  assert.equal(
    validateReceptionistConfig(
      parseReceptionistConfig({ ...input, notifications: [] }),
    ).ok,
    false,
  );
  assert.equal(
    validateReceptionistConfig(
      parseReceptionistConfig({
        ...input,
        notifications: [{ type: "sms", toE164: "+14385597002" }],
      }),
    ).ok,
    false,
  );
  assert.equal(
    loadReceptionistConfigsFromEnv(null, {
      NODE_ENV: "production",
      RECEPTIONIST_CONFIG_JSON: JSON.stringify(input),
    }).length,
    1,
  );
});

test("workspace voicemail choice opts in; adding a human number later remains valid", () => {
  const client = demoClientAccount({
    id: "client_email",
    smsFromNumber: input.phoneNumberE164,
    technicianRoster: [],
    mainTechnicianId: "",
    ownerTechnicianId: undefined,
    humanReviewPhone: undefined,
  });
  const config = buildProfileConfig(
    {
      organizationId: "org_email",
      activated: true,
      phoneNumberE164: input.phoneNumberE164,
      settings: profileSettingsSchema.parse({
        notifyEmail: "owner@example.test",
        transferSettings: { failedAction: "voicemail" },
      }),
      updatedAt: new Date().toISOString(),
    },
    { client },
  );
  assert.equal(config.allowVoicemailOnly, true);
  assert.equal(config.fallbackTransferE164, undefined);
  assert.equal(validateReceptionistConfig(config).ok, true);
  assert.equal(
    validateReceptionistConfig({
      ...config,
      fallbackTransferE164: "+14385597002",
    }).ok,
    true,
  );
});

test("greeting, safety voicemail, persistence, and email delivery work with no transfer number", async () => {
  const config = parseReceptionistConfig(input);
  const emails: string[] = [];
  const store = createMemoryReceptionistStore();
  const engine = createReceptionistEngine({
    store,
    configs: () => [config],
    brain: createRuleBrain(),
    notifier: createReceptionistNotifier({
      sms: createMemorySmsPort(),
      sendEmail: async (mail) => {
        emails.push(mail.toEmail);
        return { sent: true };
      },
    }),
  });
  const started = await engine.startCall({
    callSid: "CAemail",
    fromE164: "+15145559876",
    toE164: input.phoneNumberE164,
  });
  assert.ok(started.sessionId);
  assert.ok(started.verbs.some((verb) => verb.verb === "gather"));
  const emergency = await engine.handleGather({
    sessionId: started.sessionId,
    speech: "il y a une fuite de gaz",
  });
  assert.match(JSON.stringify(emergency), /9-1-1/);
  assert.ok(!emergency.verbs.some((verb) => verb.verb === "dial"));
  const fallback = engine.failSafePlan(config, started.sessionId);
  assert.ok(fallback.verbs.some((verb) => verb.verb === "record"));
  assert.ok(!fallback.verbs.some((verb) => verb.verb === "dial"));
  await engine.handleVoicemail({
    sessionId: started.sessionId,
    recordingUrl: "https://api.twilio.test/recording",
    durationSeconds: 8,
  });
  const ended = await engine.handleCallStatus({
    callSid: "CAemail",
    callStatus: "completed",
    durationSeconds: 25,
  });
  assert.equal(ended.finalized, true);
  assert.equal(
    (await store.getSession(started.sessionId))?.recordingUrl,
    "https://api.twilio.test/recording",
  );
  assert.deepEqual(emails, ["owner@example.test"]);
});
