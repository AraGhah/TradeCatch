import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { isSecretLinkPath, analyticsAllowed } from "../../src/lib/analytics";
import {
  PASSWORD_LINK_TOKEN_SHAPE,
  readPasswordLinkToken,
} from "../../src/lib/client/password-link";
import { routing } from "../../src/i18n/routing";
import { isPasswordTokenShape } from "../../src/product/saas/auth/password-auth";
import {
  PASSWORD_LINK_PAGE_PATHS,
  passwordLinkPageHeaders,
} from "../../src/product/saas/auth/password-link-headers";
import { trustedSiteOrigin } from "../../src/product/saas/auth/site-origin";

/**
 * KAN-27: where the reset link's secret may and may not travel. The secret is
 * the only thing standing between an emailed link and someone's account, so
 * the places it could leak to (logs, Referer headers, analytics, a forged
 * host) each get a test.
 */

const TOKEN = "Ab3_-Zx9".repeat(5) + "Abc"; // 43 base64url characters
const env = process.env as Record<string, string | undefined>;
const saved = {
  NODE_ENV: env.NODE_ENV,
  NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
  TRADECATCH_E2E: env.TRADECATCH_E2E,
  VERCEL_ENV: env.VERCEL_ENV,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  delete (globalThis as { window?: unknown }).window;
});

function configure(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

describe("the address in an emailed link", () => {
  it("is the configured https site, never a request-supplied address, in production", () => {
    configure({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://tradecatch.ca/" });
    assert.equal(trustedSiteOrigin("https://evil.example"), "https://tradecatch.ca");
    assert.equal(trustedSiteOrigin(undefined), "https://tradecatch.ca");
  });

  it("falls back to the canonical site, not the request, when production has nothing valid configured", () => {
    configure({ NODE_ENV: "production" });
    delete env.NEXT_PUBLIC_SITE_URL;
    assert.equal(trustedSiteOrigin("https://evil.example"), "https://tradecatch.ca");
    for (const bad of ["", "not a url", "http://tradecatch.ca", "ftp://x.test", "javascript:alert(1)", "https://user:pw@tradecatch.ca"]) {
      configure({ NEXT_PUBLIC_SITE_URL: bad });
      assert.equal(trustedSiteOrigin("https://evil.example"), "https://tradecatch.ca", bad);
    }
  });

  it("keeps only the origin: a path, query or fragment in the setting cannot leak into the link", () => {
    configure({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://staging.tradecatch.ca/x?y=1#z" });
    assert.equal(trustedSiteOrigin(), "https://staging.tradecatch.ca");
  });

  it("allows plain http only for loopback, and only outside production or in the e2e harness", () => {
    configure({ NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://localhost:3100" });
    assert.equal(trustedSiteOrigin(), "https://tradecatch.ca", "production refuses http");
    configure({ TRADECATCH_E2E: "1" });
    assert.equal(trustedSiteOrigin(), "http://localhost:3100", "the local test harness may use it");
    configure({ NODE_ENV: undefined, TRADECATCH_E2E: undefined, NEXT_PUBLIC_SITE_URL: "http://example.test" });
    assert.notEqual(trustedSiteOrigin(), "http://example.test", "http to a real host is never accepted");
  });

  it("outside production, with nothing configured, uses the address the request came to", () => {
    configure({ NODE_ENV: undefined });
    delete env.NEXT_PUBLIC_SITE_URL;
    assert.equal(trustedSiteOrigin("http://localhost:3001"), "http://localhost:3001");
    assert.equal(trustedSiteOrigin("https://preview.example"), "https://preview.example");
    assert.equal(trustedSiteOrigin("http://evil.example"), "https://tradecatch.ca");
  });
});

describe("reading the secret in the browser", () => {
  it("prefers the fragment, accepts the older query string, and refuses anything misshapen", () => {
    assert.deepEqual(readPasswordLinkToken({ hash: `#token=${TOKEN}`, search: "" }), {
      token: TOKEN,
      fromQuery: false,
    });
    assert.deepEqual(readPasswordLinkToken({ hash: "", search: `?token=${TOKEN}` }), {
      token: TOKEN,
      fromQuery: true,
    });
    assert.equal(
      readPasswordLinkToken({ hash: `#token=${TOKEN}`, search: `?token=${"Z".repeat(43)}` })?.token,
      TOKEN,
    );
    for (const bad of ["", "#", "#token=", "#token=short", `#token=${TOKEN}x`, `#other=${TOKEN}`, "#token=%00".padEnd(60, "a")]) {
      assert.equal(readPasswordLinkToken({ hash: bad, search: "" }), null, bad);
    }
  });

  it("uses exactly the same shape rule as the server", () => {
    const samples = [TOKEN, "", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}!`, `${"A".repeat(42)} `, "é".repeat(43), "A".repeat(43)];
    for (const sample of samples) {
      assert.equal(PASSWORD_LINK_TOKEN_SHAPE.test(sample), isPasswordTokenShape(sample), JSON.stringify(sample));
    }
  });
});

describe("keeping the secret away from analytics", () => {
  const consent = JSON.stringify({
    version: 1,
    analytics: true,
    wording: "test",
    decidedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });

  it("recognises the set-password page in both languages and nothing else", () => {
    for (const yes of ["/set-password", "/set-password/", "/fr/definir-mot-de-passe", "/fr/definir-mot-de-passe/"]) {
      assert.equal(isSecretLinkPath(yes), true, yes);
    }
    for (const no of ["/", "/login", "/forgot-password", "/fr/mot-de-passe-oublie", "/set-password-help", "/pricing", "/app"]) {
      assert.equal(isSecretLinkPath(no), false, no);
    }
  });

  it("measures nothing there even when the visitor accepted analytics", () => {
    (globalThis as { window?: unknown }).window = {
      location: { pathname: "/set-password" },
      localStorage: { getItem: () => consent, removeItem() {} },
    };
    assert.equal(analyticsAllowed("/pricing"), true, "marketing pages are still measured");
    assert.equal(analyticsAllowed("/set-password"), false);
    assert.equal(analyticsAllowed("/fr/definir-mot-de-passe"), false);
    assert.equal(analyticsAllowed(), false, "and by the page the browser is actually on");
  });
});

describe("keeping the page out of Referer, caches and search", () => {
  it("sends no referrer, no cache and noindex, and covers both addresses of the page", () => {
    assert.equal(passwordLinkPageHeaders["Referrer-Policy"], "no-referrer");
    assert.match(passwordLinkPageHeaders["Cache-Control"], /no-store/);
    assert.match(passwordLinkPageHeaders["X-Robots-Tag"], /noindex/);
    const route = routing.pathnames["/set-password"] as { en: string; fr: string };
    assert.deepEqual([...PASSWORD_LINK_PAGE_PATHS], [route.en, `/fr${route.fr}`]);
  });

  it("is wired into next.config after the catch-all rule, so it wins", async () => {
    const config = (await import("../../next.config")).default;
    const rules = await config.headers!();
    const catchAll = rules.findIndex((r) => r.source === "/(.*)");
    assert.ok(catchAll >= 0);
    for (const source of PASSWORD_LINK_PAGE_PATHS) {
      const index = rules.findIndex((r) => r.source === source);
      assert.ok(index > catchAll, `${source} must come after the catch-all`);
      const policy = rules[index]!.headers.find((h) => h.key === "Referrer-Policy");
      assert.equal(policy?.value, "no-referrer");
    }
  });

  it("the page and its parts load nothing from anyone else and never read the secret on the server", () => {
    const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");
    const page = read("src", "app", "[locale]", "set-password", "page.tsx");
    assert.doesNotMatch(page, /searchParams/, "the server must not see the secret");
    for (const file of [
      page,
      read("src", "components", "app", "SetPasswordFlow.tsx"),
      read("src", "components", "app", "SetPasswordForm.tsx"),
    ]) {
      assert.doesNotMatch(file, /https?:\/\//, "no third-party address on the page");
      assert.doesNotMatch(file, /next\/script|<script|gtag|dataLayer/i);
      assert.doesNotMatch(file, /console\.(log|info|warn|error|debug)/, "the secret is never logged client-side");
      assert.doesNotMatch(file, /localStorage|sessionStorage|document\.cookie/);
    }
  });

  it("the emailed link is a fragment: nothing after the path reaches a server", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "product", "saas", "auth", "password-auth.ts"),
      "utf8",
    );
    assert.match(source, /#token=/);
    assert.doesNotMatch(source, /setPasswordPath\(locale\)\}\?token=/);
  });
});
