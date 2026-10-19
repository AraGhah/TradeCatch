import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

type Finding = { line: number; rule: string };
const { scanText, scanEnvTemplate, forbiddenFileReason } = createRequire(__filename)("../../scripts/check-secrets.js") as {
  scanText: (text: string) => Finding[];
  scanEnvTemplate: (text: string) => Finding[];
  forbiddenFileReason: (path: string) => string | null;
};

// Built at runtime so this file does not itself look like a leaked credential.
const rand = (n: number) => "aB3dE5gH7jK9mN1pQ4sT6vX8zC2fR0wY".repeat(3).slice(0, n);
const samples: Record<string, string> = {
  "stripe-secret-key": `const k = "${"sk_" + "live_"}${rand(24)}";`,
  "stripe-webhook-secret": `STRIPE_WEBHOOK_SECRET=${"whsec" + "_"}${rand(32)}`,
  "aws-access-key-id": `id = ${"AKIA" + "ABCDEFGHIJKLMNOP"}`,
  "private-key-block": `${"-----BEGIN " + "RSA PRIVATE KEY-----"}`,
  "google-api-key": `key=${"AIza" + rand(35)}`,
  "github-token": `token ${"ghp" + "_"}${rand(36)}`,
  "slack-webhook-url": `https://${"hooks.slack.com/services/"}T0123ABCD/B0123ABCD/${rand(24)}`,
  "database-url-with-password": `DATABASE_URL=${"postgres" + "://"}app:${rand(20)}@db.example-host.supabase.co:5432/postgres`,
  "signed-jwt": `${"eyJ" + rand(30)}.${"eyJ" + rand(30)}.${rand(30)}`,
  "hardcoded-secret": `const config = { auth_secret: "${rand(40)}" };`,
};

describe("secret scanner", () => {
  for (const [rule, line] of Object.entries(samples)) {
    it(`finds ${rule}`, () => {
      const findings = scanText(`harmless\n${line}\nharmless`);
      assert.deepEqual(findings.map((f) => f.rule).includes(rule), true, JSON.stringify(findings));
      assert.equal(findings.find((f) => f.rule === rule)?.line, 2);
    });
  }

  it("never puts the matched value in a finding", () => {
    const findings = scanText(samples["stripe-secret-key"]);
    assert.ok(findings.length > 0);
    assert.doesNotMatch(JSON.stringify(findings), /sk_live|aB3dE5/);
  });

  it("leaves ordinary code and local database URLs alone", () => {
    assert.deepEqual(
      scanText(
        [
          "const url = process.env.DATABASE_URL;",
          "postgres://postgres:postgres@localhost:5432/test",
          "postgresql://user:password@host/db",
          "const id = `sess_${crypto.randomUUID()}`;",
          'AUTH_SECRET: "tradecatch-e2e-session-secret-not-for-production",',
          "// whsec_… comes from the Stripe dashboard",
          "client_secret = process.env.GOOGLE_CLIENT_SECRET",
        ].join("\n"),
      ),
      [],
    );
  });

  it("honors an explicit allow marker on that line only", () => {
    const allowed = `${samples["stripe-secret-key"]} // secret-scan: allow`;
    assert.deepEqual(scanText(allowed), []);
    assert.equal(scanText(`${allowed}\n${samples["stripe-secret-key"]}`).length, 1);
  });

  it("flags a real-looking value in an env template, not an empty or documented one", () => {
    const template = ["AUTH_SECRET=", "RESEND_API_KEY=", `STRIPE_SECRET_KEY=${rand(30)}`, "NEXT_PUBLIC_SITE_URL=https://tradecatch.ca"].join("\n");
    assert.deepEqual(scanEnvTemplate(template), [{ line: 3, rule: "env-template-value:STRIPE_SECRET_KEY" }]);
  });

  it("refuses to commit environment, key and certificate files", () => {
    for (const path of [".env", ".env.local", ".env.production", "apps/web/.env", ".dev.vars", ".dev.vars.production", "certs/server.pem", "deploy/id_rsa", "x/store.p12"]) {
      assert.ok(forbiddenFileReason(path), path);
    }
    for (const path of [".env.example", ".dev.vars.example", "src/lib/environment.ts", "docs/env.md"]) {
      assert.equal(forbiddenFileReason(path), null, path);
    }
  });
});
