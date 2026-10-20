import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { GET, HEAD, POST } from "../../src/app/api/auth/callback/route";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import { createPostgresSaasStore } from "../../src/product/saas/postgres-store";
import { hashToken, newId, randomToken } from "../../src/product/saas/ids";
import { verifySessionClaims } from "../../src/product/saas/auth/session-token";
import type { SaasStore } from "../../src/product/saas/store";

const origin = "https://tradecatch.test";
const callback = `${origin}/api/auth/callback`;
const runtime = globalThis as typeof globalThis & {
  __tradecatchSaas?: { store: SaasStore; durable: boolean };
};
const cookieName =
  process.env.NODE_ENV === "production"
    ? "__Host-tc_login_confirmation"
    : "tc_login_confirmation";
const stagingUrl = process.env.LOGIN_CONFIRMATION_TEST_DATABASE_URL;

for (const mode of stagingUrl ? ["memory", "postgres"] : ["memory"]) {
  describe(`login confirmation (${mode})`, () => {
    let store: SaasStore;
    let pool: Pool | undefined;
    const previousSecret = process.env.AUTH_SECRET;
    before(async () => {
      process.env.AUTH_SECRET = "tc006-unit-test-secret";
      if (mode === "postgres") {
        const url = new URL(stagingUrl!);
        assert.equal(url.hostname, "127.0.0.1");
        assert.equal(url.pathname, "/tc006_staging");
        pool = new Pool({ connectionString: stagingUrl });
        for (const file of [
          "missed-call/schema.sql",
          "saas/schema.sql",
          "saas/schema-demo-businesses.sql",
        ]) {
          await pool.query(readFileSync(`src/product/${file}`, "utf8"));
        }
        store = createPostgresSaasStore(stagingUrl!);
      } else store = createMemorySaasStore();
      runtime.__tradecatchSaas = { store, durable: mode === "postgres" };
    });
    after(async () => {
      delete runtime.__tradecatchSaas;
      if (previousSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previousSecret;
      await pool?.end();
    });

    async function fixture(expired = false) {
      const created = await store.createOrganizationWithOwner({
        name: "TC006 Test",
        ownerEmail: `${newId("tc006")}@example.test`,
        ownerName: "Test Owner",
        accountType: "demo",
      });
      const token = randomToken();
      await store.createMagicLink({
        id: newId("mlk"),
        email: created.user.email,
        tokenHash: hashToken(token),
        organizationId: created.organization.id,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + (expired ? -60_000 : 60_000),
        ).toISOString(),
      });
      return { ...created, token };
    }
    async function form(token: string, locale = "en") {
      const response = GET(
        new NextRequest(`${callback}?token=${token}&locale=${locale}`),
      );
      assert.equal(response.status, 200);
      const html = await response.text();
      const nonce = html.match(/name="confirmation" value="([^"]+)"/)?.[1];
      assert.ok(nonce);
      return { response, html, nonce, cookie: `${cookieName}=${nonce}` };
    }
    function submit(
      token: string,
      nonce: string,
      cookie: string,
      extra: Record<string, string> = {},
      locale = "en",
      confirm = "1",
    ) {
      return POST(
        new NextRequest(callback, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie,
            ...extra,
          },
          body: new URLSearchParams({
            token,
            confirmation: nonce,
            confirm,
            locale,
          }).toString(),
        }),
      );
    }

    it("scanner GETs and HEADs leave a valid token and sessions untouched; a deliberate POST signs in once", async () => {
      const f = await fixture();
      for (let i = 0; i < 4; i++) {
        const preview = await form(f.token);
        assert.match(preview.html, /Confirm your sign-in/);
        assert.doesNotMatch(
          preview.html,
          /<script|<iframe|http-equiv="refresh"|https?:\/\//,
        );
        assert.match(
          preview.response.headers.get("cache-control")!,
          /no-store/,
        );
        assert.equal(
          preview.response.headers.get("referrer-policy"),
          "no-referrer",
        );
        assert.doesNotMatch(
          preview.response.headers.get("set-cookie")!,
          /tc_session=/,
        );
        assert.equal(HEAD().status, 200);
        assert.equal(HEAD().headers.get("set-cookie"), null);
      }
      assert.equal((await store.listSessionsForUser(f.user.id)).length, 0);
      if (pool)
        assert.equal(
          (
            await pool.query(
              "SELECT consumed_at FROM tc_magic_links WHERE token_hash=$1",
              [hashToken(f.token)],
            )
          ).rows[0].consumed_at,
          null,
        );
      const page = await form(f.token);
      const response = await submit(f.token, page.nonce, page.cookie);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), `${origin}/app`);
      const cookie = response.cookies.get("tc_session")?.value;
      assert.ok(cookie);
      const claims = await verifySessionClaims(
        cookie,
        "tc006-unit-test-secret",
      );
      assert.equal(claims?.uid, f.user.id);
      assert.equal(claims?.oid, f.organization.id);
      assert.equal((await store.listSessionsForUser(f.user.id)).length, 1);
      const replay = await submit(f.token, page.nonce, page.cookie);
      assert.match(replay.headers.get("location")!, /error=Invalid/);
      assert.equal(replay.cookies.get("tc_session"), undefined);
      assert.equal((await store.listSessionsForUser(f.user.id)).length, 1);
    });

    it("rejects missing, mismatched, cross-site, or unconfirmed submissions without burning the token", async () => {
      const f = await fixture();
      const page = await form(f.token);
      for (const response of [
        await submit(f.token, page.nonce, ""),
        await submit(f.token, randomToken(), page.cookie),
        await submit(f.token, page.nonce, page.cookie, {
          "sec-fetch-site": "cross-site",
        }),
        await submit(f.token, page.nonce, page.cookie, {}, "en", ""),
      ])
        assert.equal(response.status, 403);
      assert.equal((await store.listSessionsForUser(f.user.id)).length, 0);
      assert.equal(
        (await submit(f.token, page.nonce, page.cookie)).headers.get(
          "location",
        ),
        `${origin}/app`,
      );
    });

    it("keeps expiry enforcement and French confirmation/redirects", async () => {
      const expired = await fixture(true);
      const page = await form(expired.token, "fr");
      assert.match(page.html, /Confirmer et me connecter/);
      const rejected = await submit(
        expired.token,
        page.nonce,
        page.cookie,
        {},
        "fr",
      );
      assert.match(
        rejected.headers.get("location")!,
        /\/fr\/connexion\?error=Invalid/,
      );
      assert.equal(
        (await store.listSessionsForUser(expired.user.id)).length,
        0,
      );
      const f = await fixture();
      const valid = await form(f.token, "fr");
      assert.equal(
        (
          await submit(f.token, valid.nonce, valid.cookie, {}, "fr")
        ).headers.get("location"),
        `${origin}/fr/app`,
      );
    });

    it("permits only one session when two confirmations race", async () => {
      const f = await fixture();
      const page = await form(f.token);
      const results = await Promise.all([
        submit(f.token, page.nonce, page.cookie),
        submit(f.token, page.nonce, page.cookie),
      ]);
      assert.equal(
        results.filter((r) => r.cookies.has("tc_session")).length,
        1,
      );
      assert.equal((await store.listSessionsForUser(f.user.id)).length, 1);
    });

    it("rejects malformed tokens and oversized or unsupported form bodies", async () => {
      const invalid = GET(
        new NextRequest(`${callback}?token=%22%3E%3Cscript%3E`),
      );
      assert.equal(invalid.status, 303);
      assert.equal(GET(new NextRequest(callback)).status, 303);
      assert.equal(
        (
          await POST(
            new NextRequest(callback, {
              method: "POST",
              body: "x",
              headers: { "content-type": "application/json" },
            }),
          )
        ).status,
        415,
      );
      assert.equal(
        (
          await POST(
            new NextRequest(callback, {
              method: "POST",
              body: "x".repeat(4097),
              headers: { "content-type": "application/x-www-form-urlencoded" },
            }),
          )
        ).status,
        413,
      );
    });
  });
}
