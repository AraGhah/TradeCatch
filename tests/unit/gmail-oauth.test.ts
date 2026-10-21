import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GmailApiError, backoffMs, failureFromResponse } from "../../src/product/gmail/errors";
import { attachmentDisposition, asNotice } from "../../src/product/gmail/http";
import {
  GMAIL_SCOPE,
  buildGmailAuthUrl,
  exchangeGmailCode,
  gmailConfigured,
  gmailPushConfigured,
  openGmailTokens,
  readGmailEnv,
  readGmailState,
  refreshGmailTokens,
  revokeGmailToken,
  sealGmailTokens,
} from "../../src/product/gmail/oauth";
import { FakeGoogle, GMAIL_SCOPE as FAKE_SCOPE } from "../support/fake-google";
import { TEST_ENV } from "../support/gmail-harness";

const person = { organizationId: "org_1", userId: "usr_1", locale: "fr" as const };

describe("gmail OAuth", () => {
  it("asks Google for the one read-only scope and nothing else", () => {
    assert.equal(GMAIL_SCOPE, FAKE_SCOPE);
    const { url } = buildGmailAuthUrl({ ...person, loginHint: "me@gmail.com" }, TEST_ENV);
    const params = new URL(url).searchParams;
    assert.equal(new URL(url).origin, "https://accounts.google.com");
    assert.equal(params.get("scope"), "https://www.googleapis.com/auth/gmail.readonly");
    assert.equal(params.get("access_type"), "offline");
    assert.equal(params.get("prompt"), "consent");
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("include_granted_scopes"), "false");
    assert.equal(params.get("login_hint"), "me@gmail.com");
    assert.equal(params.get("redirect_uri"), TEST_ENV.redirectUri);
    assert.ok(!url.includes(TEST_ENV.clientSecret!), "the client secret is never put in a URL");
  });

  it("binds the state to one person, one locale and ten minutes", () => {
    const now = Date.UTC(2026, 9, 18, 12);
    const { state } = buildGmailAuthUrl(person, TEST_ENV, now);
    assert.deepEqual(readGmailState(state, TEST_ENV, now + 60_000), person);
    assert.equal(readGmailState(state, TEST_ENV, now + 11 * 60_000), null, "expired");
    const [body, mac] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ organizationId: "org_evil", userId: "usr_evil", exp: now + 1e9 })).toString("base64url");
    assert.equal(readGmailState(`${forged}.${mac}`, TEST_ENV, now), null, "tampered body");
    assert.equal(readGmailState(`${body}.AAAA`, TEST_ENV, now), null, "bad signature");
    assert.equal(readGmailState("garbage", TEST_ENV, now), null);
    assert.equal(readGmailState(state, { ...TEST_ENV, authSecret: "another-secret-0123456789abcdef" }, now), null);
    assert.equal(readGmailState(state, { ...TEST_ENV, authSecret: undefined }, now), null);
  });

  it("refuses to start without credentials", () => {
    assert.throws(() => buildGmailAuthUrl(person, { ...TEST_ENV, clientId: undefined }), /not_configured/);
    assert.equal(gmailConfigured({ ...TEST_ENV, clientSecret: undefined }), false);
    assert.equal(gmailConfigured(TEST_ENV), true);
  });

  it("seals tokens so nothing readable is stored, and only the right secret opens them", () => {
    const tokens = { accessToken: "ya29.access-token-value", refreshToken: "1//refresh-token-value", expiresAt: new Date().toISOString() };
    const sealed = sealGmailTokens(tokens, TEST_ENV);
    assert.ok(!sealed.includes("ya29") && !sealed.includes("1//") && !sealed.includes("refresh"));
    assert.deepEqual(openGmailTokens(sealed, TEST_ENV), tokens);
    assert.notEqual(sealGmailTokens(tokens, TEST_ENV), sealed, "fresh IV every time");
    assert.throws(() => openGmailTokens(sealed, { ...TEST_ENV, authSecret: "wrong-secret-0123456789abcdef" }));
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    assert.throws(() => openGmailTokens(tampered, TEST_ENV), "GCM detects modification");
  });

  it("exchanges the code and requires both the Gmail permission and a refresh token", async () => {
    const google = new FakeGoogle();
    const fetchImpl = google.fetchImpl();
    const tokens = await exchangeGmailCode(google.codeFor("a@gmail.com"), TEST_ENV, fetchImpl);
    assert.equal(tokens.refreshToken, "rt:a@gmail.com");
    assert.ok(Date.parse(tokens.expiresAt) > Date.now());

    google.grantScope = "openid email"; // user unticked the Gmail box on Google's consent screen
    await assert.rejects(exchangeGmailCode(google.codeFor("a@gmail.com"), TEST_ENV, fetchImpl), (error: unknown) => {
      assert.ok(error instanceof GmailApiError);
      assert.equal(error.kind, "needs_reconnect");
      return true;
    });
    google.grantScope = GMAIL_SCOPE;
    google.grantRefreshToken = false;
    await assert.rejects(exchangeGmailCode(google.codeFor("a@gmail.com"), TEST_ENV, fetchImpl), /refresh token/);
    google.grantRefreshToken = true;
    await assert.rejects(exchangeGmailCode("forged-code", TEST_ENV, fetchImpl), GmailApiError);
  });

  it("keeps the refresh token when Google does not send a new one, and detects revocation", async () => {
    const google = new FakeGoogle();
    const fetchImpl = google.fetchImpl();
    const first = await exchangeGmailCode(google.codeFor("a@gmail.com"), TEST_ENV, fetchImpl);
    const refreshed = await refreshGmailTokens(first, TEST_ENV, fetchImpl);
    assert.equal(refreshed.refreshToken, first.refreshToken);
    assert.notEqual(refreshed.accessToken, first.accessToken);
    google.mailbox("a@gmail.com").revoked = true;
    await assert.rejects(refreshGmailTokens(first, TEST_ENV, fetchImpl), (error: unknown) => {
      assert.ok(error instanceof GmailApiError);
      assert.equal(error.kind, "needs_reconnect");
      return true;
    });
  });

  it("revokes the grant at Google on request", async () => {
    const google = new FakeGoogle();
    const fetchImpl = google.fetchImpl();
    const tokens = await exchangeGmailCode(google.codeFor("a@gmail.com"), TEST_ENV, fetchImpl);
    assert.equal(await revokeGmailToken(tokens, TEST_ENV, fetchImpl), true);
    assert.deepEqual(google.revokedTokens, ["rt:a@gmail.com"]);
    assert.equal(await revokeGmailToken(tokens, TEST_ENV, (async () => { throw new Error("offline"); }) as typeof fetch), false);
  });

  it("only talks to a substitute Google inside the local test harness", () => {
    const base = { GMAIL_TEST_GOOGLE_BASE: "http://127.0.0.1:4010", NEXT_PUBLIC_SITE_URL: "http://localhost:3100" };
    assert.equal(readGmailEnv({ ...base, TRADECATCH_E2E: "1" } as never).tokenUrl, "http://127.0.0.1:4010/token");
    for (const env of [
      { ...base },
      { ...base, TRADECATCH_E2E: "1", NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca" },
      { ...base, TRADECATCH_E2E: "1", VERCEL_ENV: "production" },
    ]) {
      assert.equal(readGmailEnv(env as never).tokenUrl, "https://oauth2.googleapis.com/token");
      assert.equal(readGmailEnv(env as never).apiBase, "https://gmail.googleapis.com/gmail/v1/users/me");
    }
  });

  it("reports push as configured only when the topic, audience and service account exist", () => {
    assert.equal(gmailPushConfigured({ ...TEST_ENV, pubsubTopic: "projects/p/topics/t" }), false);
    assert.equal(gmailPushConfigured({ ...TEST_ENV, pubsubTopic: "projects/p/topics/t", pushAudience: "https://example.test/api/webhooks/gmail", pushServiceAccount: "push@p.iam.gserviceaccount.com" }), true);
  });
});

describe("gmail failure handling", () => {
  const body = (status: number, reason: string, message = "x") => JSON.stringify({ error: { code: status, message, errors: [{ reason }] } });

  it("separates what the user can fix from what an operator must fix", () => {
    const cases: [number, string, string, string][] = [
      [401, body(401, "authError"), "needs_reconnect", "expired access token"],
      [403, body(403, "insufficientPermissions", "Insufficient Permission"), "needs_reconnect", "scope removed"],
      [400, JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), "needs_reconnect", "revoked"],
      [429, body(429, "rateLimitExceeded"), "rate_limited", "429"],
      [403, body(403, "userRateLimitExceeded"), "rate_limited", "403 rate limit"],
      [403, body(403, "accessNotConfigured", "Gmail API has not been used in project 1"), "config_error", "api disabled"],
      [400, JSON.stringify({ error: "invalid_client" }), "config_error", "bad client secret"],
      [500, "<html>oops</html>", "sync_failed", "non-JSON"],
      [503, "", "sync_failed", "empty"],
    ];
    for (const [status, text, kind, label] of cases) {
      assert.equal(failureFromResponse(status, text).kind, kind, label);
    }
  });

  it("reads Retry-After in seconds and as a date, and caps it at an hour", () => {
    assert.equal(failureFromResponse(429, "{}", "120").retryAfterMs, 120_000);
    assert.equal(failureFromResponse(429, "{}", "999999").retryAfterMs, 3_600_000);
    assert.equal(failureFromResponse(429, "{}", null).retryAfterMs, undefined);
  });

  it("backs off exponentially for transient failures but never past thirty minutes", () => {
    const transient = new GmailApiError("sync_failed", 500, "x");
    assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map((n) => backoffMs(transient, n) / 60_000), [1, 2, 4, 8, 16, 30, 30]);
    assert.equal(backoffMs(new GmailApiError("rate_limited", 429, "x"), 1), 5 * 60_000);
  });
});

describe("gmail HTTP helpers", () => {
  it("only accepts known notice codes from the URL", () => {
    assert.equal(asNotice("connected"), "connected");
    assert.equal(asNotice("<script>alert(1)</script>"), null);
    assert.equal(asNotice(undefined), null);
  });

  it("builds a download header that survives hostile and non-ASCII filenames", () => {
    const header = attachmentDisposition('Soumission "été"\r\nSet-Cookie: x=1.pdf');
    assert.ok(!/[\r\n]/.test(header));
    assert.ok(header.startsWith('attachment; filename="'));
    assert.ok(/^[\x20-\x7e]*$/.test(header), "header is plain ASCII, so the runtime will not throw");
    assert.ok(header.includes("filename*=UTF-8''Soumission%20_%C3%A9t%C3%A9_"));
    assert.ok(attachmentDisposition("").includes('filename="attachment"'));
  });
});
