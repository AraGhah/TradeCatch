import assert from "node:assert/strict";
import { describe, it } from "node:test";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import { PUBLIC_CONTACT_EMAIL } from "../../src/lib/contact";
import {
  LAUNCH_FLAGS,
  launchFlagEnabled,
  launchFlagEnvName,
} from "../../src/lib/launch-flags";
import {
  LAUNCH_GATED_FEATURES,
  featuresForPlan,
  orgHasFeature,
} from "../../src/product/saas/entitlements";
import { STORY_IDS } from "../../src/components/demo-video/stories";
import { getSaasStore } from "../../src/product/saas/runtime";
import {
  requestMagicLink,
  sendActivationInvite,
} from "../../src/product/saas/auth/magic-link";

function leaves(node: unknown, path: string, out: [string, string][]) {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node))
    node.forEach((value, index) => leaves(value, `${path}[${index}]`, out));
  else if (node && typeof node === "object")
    for (const [key, value] of Object.entries(node))
      leaves(value, path ? `${path}.${key}` : key, out);
}

const MESSAGES = { en, fr } as const;

describe("launch switches", () => {
  it("every switch is off unless the operator sets it", () => {
    for (const flag of LAUNCH_FLAGS) {
      assert.equal(launchFlagEnabled(flag, {}), false, flag);
      assert.equal(
        launchFlagEnabled(flag, { [launchFlagEnvName(flag)]: "0" }),
        false,
        flag,
      );
      assert.equal(
        launchFlagEnabled(flag, { [launchFlagEnvName(flag)]: "1" }),
        true,
        flag,
      );
      assert.equal(
        launchFlagEnabled(flag, { [launchFlagEnvName(flag)]: "TRUE" }),
        true,
        flag,
      );
    }
  });

  it("covers every capability the launch removes", () => {
    for (const flag of [
      "callTransfer",
      "customVoice",
      "bulkCampaigns",
      "crmIntegrations",
      "smsChatbot",
    ] as const)
      assert.ok(LAUNCH_FLAGS.includes(flag), flag);
  });

  it("no plan can run a withheld feature, so none can be unlocked from the browser", () => {
    const withheld = Object.keys(LAUNCH_GATED_FEATURES);
    assert.ok(withheld.length >= 8);
    for (const plan of [
      "essential",
      "professional",
      "starter",
      "growth",
      "receptionist",
    ] as const) {
      for (const feature of withheld) {
        assert.equal(
          orgHasFeature(plan, feature as never),
          false,
          `${plan} must not run ${feature}`,
        );
        assert.ok(!(featuresForPlan(plan) as readonly string[]).includes(feature));
      }
    }
  });

  it("appointments belong to Professional only", () => {
    assert.equal(orgHasFeature("essential", "APPOINTMENT_BOOKING"), false);
    assert.equal(orgHasFeature("essential", "AI_PHONE_BOOKING"), false);
    assert.equal(orgHasFeature("professional", "APPOINTMENT_BOOKING"), true);
    assert.equal(orgHasFeature("professional", "AI_PHONE_BOOKING"), true);
  });
});

describe("public copy", () => {
  it("offers email as the only way to reach TradeCatch", () => {
    for (const lang of ["en", "fr"] as const) {
      const site = MESSAGES[lang].site;
      assert.equal(site.email, PUBLIC_CONTACT_EMAIL, lang);
      assert.equal(site.founderEmail, PUBLIC_CONTACT_EMAIL, lang);
      assert.ok(!("phone" in site), `${lang} site.phone must not exist`);
    }
  });

  it("never prints a TradeCatch phone number", () => {
    const phone = /\(?438\)?[\s.·-]*993[\s.·-]*6997/;
    for (const lang of ["en", "fr"] as const) {
      const all: [string, string][] = [];
      leaves(MESSAGES[lang], "", all);
      for (const [path, text] of all)
        assert.ok(!phone.test(text), `${lang} ${path} prints a phone number`);
    }
  });

  it("uses no em or en dashes", () => {
    for (const lang of ["en", "fr"] as const) {
      const all: [string, string][] = [];
      leaves(MESSAGES[lang], "", all);
      const offenders = all
        .filter(([, text]) => /[–—]/.test(text))
        .map(([path]) => path);
      assert.deepEqual(offenders, [], `${lang} has dashes`);
    }
  });

  it("does not claim a call is ever transferred", () => {
    for (const lang of ["en", "fr"] as const) {
      const all: [string, string][] = [];
      leaves(MESSAGES[lang], "", all);
      const claim =
        lang === "en"
          ? /(we|it|receptionist)\s+(will\s+)?transfers?\s+(the\s+)?(call|you)/i
          : /(transf[eè]re(ra)?\s+(l.appel|votre appel))/i;
      for (const [path, text] of all) {
        if (path.startsWith("legal") || path.startsWith("demoVideo")) continue;
        if (/\b(does not|do not|never|ne transf[eè]re pas|not offered|pas offert)\b/i.test(text)) continue;
        assert.ok(!claim.test(text), `${lang} ${path}: ${text.slice(0, 80)}`);
      }
    }
  });
});

describe("demo video", () => {
  it("ships one universal story", () => {
    assert.deepEqual([...STORY_IDS], ["under-the-sink"]);
  });
});

describe("accounts are created by TradeCatch, never by a visitor", () => {
  it("a sign-in request for an unknown email creates no user and no organization", async () => {
    const store = getSaasStore();
    const email = `nobody-${Date.now()}@example.invalid`;
    const result = await requestMagicLink({
      email,
      locale: "en",
      origin: "https://example.invalid",
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(await store.getUserByEmail(email), null);
  });

  it("an activation invite needs an existing account and never carries a password", async () => {
    const store = getSaasStore();
    const unknown = await sendActivationInvite({
      email: `ghost-${Date.now()}@example.invalid`,
      locale: "fr",
      origin: "https://example.invalid",
      organizationId: "org_missing",
    });
    assert.equal(unknown.ok, false);

    const email = `owner-${Date.now()}@example.invalid`;
    const created = await store.createOrganizationWithOwner({
      name: "Plomberie Test",
      ownerEmail: email,
      ownerName: "Owner",
      locale: "fr",
      plan: "essential",
    });
    // No email provider in the test run: the invite is refused cleanly, not sent in clear text.
    const previous = {
      key: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL,
    };
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    try {
      const result = await sendActivationInvite({
        email,
        locale: "fr",
        origin: "https://example.invalid",
        organizationId: created.organization.id,
      });
      assert.deepEqual(result, { ok: false, error: "Email is not configured." });
      assert.equal(JSON.stringify(result).toLowerCase().includes("password"), false);
    } finally {
      if (previous.key !== undefined) process.env.RESEND_API_KEY = previous.key;
      if (previous.from !== undefined)
        process.env.RESEND_FROM_EMAIL = previous.from;
    }
  });
});
