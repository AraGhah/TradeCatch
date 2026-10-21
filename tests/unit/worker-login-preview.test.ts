import assert from "node:assert/strict";
import { it } from "node:test";
import {
  loginPreview,
  workerLoginPreview,
} from "../../src/product/saas/auth/login-preview";

const origin = "https://tradecatch.test";
const token = "a".repeat(43);
const url = `${origin}/api/auth/callback?token=${token}`;

it("Worker preview uses the same private script-free confirmation as Next", async () => {
  const response = workerLoginPreview(new Request(url), {})!;
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Confirm your sign-in/);
  assert.match(html, /method="post" action="\/api\/auth\/callback"/);
  assert.match(html, /name="token" value="a{43}"/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    response.headers.get("content-security-policy")!,
    /default-src 'none'/,
  );
  const cookie = response.headers.get("set-cookie")!;
  assert.match(cookie, /^__Host-tc_login_confirmation=[A-Za-z0-9_-]{43};/);
  for (const flag of [
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Secure",
    "Max-Age=1200",
  ])
    assert.ok(cookie.includes(flag));
  const nonce = cookie.split(";")[0].split("=")[1];
  const next = loginPreview(
    new Request(url, { headers: { cookie: cookie.split(";")[0] } }),
    true,
  );
  assert.equal(next.headers.get("set-cookie"), cookie);
  assert.match(
    await next.text(),
    new RegExp(`name="confirmation" value="${nonce}"`),
  );
  assert.notEqual(
    workerLoginPreview(new Request(url), {})!.headers.get("set-cookie"),
    cookie,
  );
});

it("HEAD never generates a nonce or touches a token", async () => {
  const response = workerLoginPreview(
    new Request(url, { method: "HEAD" }),
    {},
  )!;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("set-cookie"), null);
});

it("Malformed cookies are replaced and invalid links redirect without reflecting input", async () => {
  const response = workerLoginPreview(
    new Request(url, {
      headers: { cookie: "__Host-tc_login_confirmation=untrusted" },
    }),
    {},
  )!;
  assert.doesNotMatch(await response.text(), /untrusted/);
  for (const query of ["", "?token=%3Cscript%3E&locale=fr"]) {
    const invalid = workerLoginPreview(
      new Request(origin + "/api/auth/callback" + query),
      {},
    )!;
    assert.equal(invalid.status, 303);
    assert.equal(invalid.headers.get("set-cookie"), null);
    assert.equal(
      new URL(invalid.headers.get("location")!).pathname,
      query ? "/fr/connexion" : "/login",
    );
  }
});

it("POSTs, other routes and every staging configuration continue through protected middleware", () => {
  for (const method of ["POST", "OPTIONS", "DELETE"])
    assert.equal(
      workerLoginPreview(new Request(url, { method }), {}),
      undefined,
    );
  assert.equal(
    workerLoginPreview(new Request(origin + "/api/app/me"), {}),
    undefined,
  );
  for (const env of [
    { TRADECATCH_ENV: " Staging " },
    { TRADECATCH_ENV: "stage" },
    { NEXT_PUBLIC_TRADECATCH_ENV: "demo" },
    { NEXT_PUBLIC_DEMO_MODE: "1" },
    { STAGING_BASIC_AUTH_USER: "owner" },
    { STAGING_BASIC_AUTH_PASSWORD: "test" },
  ])
    assert.equal(workerLoginPreview(new Request(url), env), undefined);
});
