import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import proxy from "../../src/proxy";
import { AUTH_COOKIE_NAMES, carriesAuthCookie, isCrossSiteMutation } from "../../src/lib/csrf";
import { ADMIN_JWT_COOKIE } from "../../src/product/saas/auth/admin-jwt";
import { SESSION_COOKIE } from "../../src/product/saas/auth/session-token";

const HOSTS = ["app.tradecatch.test", null, undefined];
const SESSION = "tc_session=abc.def";

function check(method: string, headers: Record<string, string>) {
  return isCrossSiteMutation({ method, headers: new Headers(headers), hosts: HOSTS });
}

describe("csrf guard decisions", () => {
  it("knows which cookies are ours, and they match the real cookie names", () => {
    assert.deepEqual([...AUTH_COOKIE_NAMES].sort(), [ADMIN_JWT_COOKIE, SESSION_COOKIE].sort());
    assert.equal(carriesAuthCookie(null), false);
    assert.equal(carriesAuthCookie("theme=dark; NEXT_LOCALE=fr"), false);
    assert.equal(carriesAuthCookie("theme=dark; tc_session=x"), true);
    assert.equal(carriesAuthCookie("tc_admin=y"), true);
    assert.equal(carriesAuthCookie("not_tc_session=y"), false, "a cookie that merely ends in our name is not ours");
  });

  it("blocks a cookie-authenticated POST started by another site", () => {
    assert.equal(check("POST", { cookie: SESSION, "sec-fetch-site": "cross-site" }), true);
    assert.equal(check("DELETE", { cookie: SESSION, "sec-fetch-site": "cross-site" }), true);
    assert.equal(check("PUT", { cookie: SESSION, origin: "https://evil.example" }), true);
    assert.equal(check("PATCH", { cookie: SESSION, origin: "null" }), true);
    assert.equal(check("POST", { cookie: "tc_admin=jwt", origin: "https://evil.example" }), true);
  });

  it("blocks a sibling subdomain, which SameSite=Lax treats as the same site", () => {
    assert.equal(check("POST", { cookie: SESSION, "sec-fetch-site": "same-site" }), true);
    assert.equal(check("POST", { cookie: SESSION, origin: "https://blog.tradecatch.test" }), true);
  });

  it("lets the app's own pages through", () => {
    assert.equal(check("POST", { cookie: SESSION, "sec-fetch-site": "same-origin" }), false);
    assert.equal(check("POST", { cookie: SESSION, origin: "https://app.tradecatch.test" }), false);
    assert.equal(check("POST", { cookie: SESSION, "sec-fetch-site": "none" }), false);
  });

  it("trusts Sec-Fetch-Site over a conflicting Origin, since only the browser sets it", () => {
    assert.equal(check("POST", { cookie: SESSION, "sec-fetch-site": "cross-site", origin: "https://app.tradecatch.test" }), true);
    assert.equal(check("POST", { cookie: SESSION, "sec-fetch-site": "same-origin", origin: "https://evil.example" }), false);
  });

  it("does not touch safe methods, cookie-less callers, or non-browser clients", () => {
    assert.equal(check("GET", { cookie: SESSION, "sec-fetch-site": "cross-site" }), false);
    assert.equal(check("HEAD", { cookie: SESSION, origin: "https://evil.example" }), false);
    assert.equal(check("OPTIONS", { cookie: SESSION, origin: "https://evil.example" }), false);
    // Webhooks, bearer-secret cron calls and the public lead API carry no sign-in cookie.
    assert.equal(check("POST", { "sec-fetch-site": "cross-site" }), false);
    assert.equal(check("POST", { origin: "https://customer-site.example", "x-tradecatch-key": "k" }), false);
    assert.equal(check("POST", { authorization: "Bearer secret" }), false);
    // curl / server-to-server with the cookie but neither browser header.
    assert.equal(check("POST", { cookie: SESSION }), false);
  });

  it("treats an unparseable Origin as hostile", () => {
    assert.equal(check("POST", { cookie: SESSION, origin: "not a url" }), true);
  });
});

describe("csrf guard in the proxy", () => {
  const api = (method: string, headers: Record<string, string>, path = "/api/app/api-keys") =>
    proxy(new NextRequest(`https://app.tradecatch.test${path}`, { method, headers }));

  it("answers 403 to a cross-site mutation and says why", async () => {
    const res = await api("POST", { cookie: SESSION, "sec-fetch-site": "cross-site" });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Cross-site request blocked." });
  });

  it("passes the same request when it comes from the app itself", async () => {
    const res = await api("POST", { cookie: SESSION, "sec-fetch-site": "same-origin", origin: "https://app.tradecatch.test" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-middleware-next"), "1");
  });

  it("does not interfere with webhooks or reads", async () => {
    const webhook = await api("POST", { "sec-fetch-site": "cross-site", "stripe-signature": "t=1,v1=0" }, "/api/webhooks/stripe");
    assert.equal(webhook.headers.get("x-middleware-next"), "1");
    const read = await api("GET", { cookie: SESSION, "sec-fetch-site": "cross-site" }, "/api/businesses/org_1");
    assert.equal(read.headers.get("x-middleware-next"), "1");
  });

  it("leaves health and readiness alone", async () => {
    for (const path of ["/health", "/ready"]) {
      const res = await api("GET", {}, path);
      assert.equal(res.headers.get("x-middleware-next"), "1", path);
    }
  });
});

describe("request body size cap in the proxy", () => {
  const api = (method: string, headers: Record<string, string>, path = "/api/app/api-keys") =>
    proxy(new NextRequest(`https://app.tradecatch.test${path}`, { method, headers }));

  it("rejects a declared oversized body on a mutating method before any route runs", async () => {
    const res = await api("POST", { "content-length": String(3 * 1024 * 1024) });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: "Payload too large." });
  });

  it("lets a normally sized body and GET requests through regardless of declared size", async () => {
    const small = await api("POST", { "content-length": "1024" });
    assert.equal(small.headers.get("x-middleware-next"), "1");
    const read = await api("GET", { "content-length": String(10 * 1024 * 1024) });
    assert.equal(read.headers.get("x-middleware-next"), "1");
  });
});
