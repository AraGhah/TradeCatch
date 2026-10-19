import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forwardProductEventToCrm } from "../../src/lib/product-crm";
import { checkOutboundUrl, hostResolution, isNonPublicAddress, publicHttpsUrl } from "../../src/lib/safe-url";
import { orgSettingsSchema } from "../../src/product/starter/qualification";

const event = { eventType: "lead.created", organizationId: "org_1", data: { name: "Alex" } };

describe("checkOutboundUrl accepts ordinary webhook addresses", () => {
  for (const url of [
    "https://hooks.zapier.com/hooks/catch/123/abc/",
    "https://hook.us1.make.com/abcdef",
    "https://api.hubapi.com/webhooks/v1/x?token=1",
    "https://crm.example.co.uk:443/in",
    "https://g.page/r/CabcDEF/review",
    "https://xn--bcher-kva.example/hook",
  ]) {
    it(url, () => assert.equal(checkOutboundUrl(url).ok, true));
  }
});

describe("checkOutboundUrl refuses addresses that lead inside", () => {
  const cases: Array<[string, string]> = [
    ["http://hooks.zapier.com/x", "scheme"],
    ["ftp://example.com/x", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["not a url", "invalid"],
    ["", "invalid"],
    ["https://user:pass@example.com/x", "credentials"],
    ["https://google.com@evil.example.com/x", "credentials"],
    ["https://example.com:8080/x", "port"],
    ["https://example.com:22/x", "port"],
    // IPv4 in every spelling the URL parser normalises to dotted-quad
    ["https://127.0.0.1/x", "host"],
    ["https://2130706433/x", "host"],
    ["https://0x7f.0.0.1/x", "host"],
    ["https://017700000001/x", "host"],
    ["https://127.1/x", "host"],
    ["https://169.254.169.254/latest/meta-data/", "host"],
    ["https://10.0.0.5/x", "host"],
    ["https://192.168.1.1/x", "host"],
    ["https://8.8.8.8/x", "host"],
    // IPv6
    ["https://[::1]/x", "host"],
    ["https://[fd00::1]/x", "host"],
    ["https://[::ffff:127.0.0.1]/x", "host"],
    ["https://[2606:4700::1111]/x", "host"],
    // names that only resolve privately
    ["https://localhost/x", "host"],
    ["https://app.localhost/x", "host"],
    ["https://intranet/x", "host"],
    ["https://metadata.google.internal/computeMetadata/v1/", "host"],
    ["https://printer.local/x", "host"],
    ["https://kubernetes.default.svc.cluster.local/x", "host"],
    ["https://example.com../x", "host"],
  ];
  for (const [url, reason] of cases) {
    it(`${url || "(empty)"} -> ${reason}`, () => {
      const result = checkOutboundUrl(url);
      assert.equal(result.ok, false);
      if (!result.ok && url !== "https://example.com../x") assert.equal(result.reason, reason);
    });
  }

  it("refuses an overlong URL", () => {
    const result = checkOutboundUrl(`https://example.com/${"a".repeat(3000)}`);
    assert.deepEqual(result, { ok: false, reason: "length" });
  });
});

describe("isNonPublicAddress", () => {
  it("flags private, loopback, link-local and reserved IPv4", () => {
    for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
      assert.equal(isNonPublicAddress(ip), true, ip);
    }
  });

  it("passes ordinary public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "104.16.0.1"]) {
      assert.equal(isNonPublicAddress(ip), false, ip);
    }
  });

  it("handles IPv6, including addresses that embed an IPv4", () => {
    for (const ip of ["::1", "::", "fe80::1", "fd12:3456::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "2001:db8::1"]) {
      assert.equal(isNonPublicAddress(ip), true, ip);
    }
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001::200e", "::ffff:8.8.8.8"]) {
      assert.equal(isNonPublicAddress(ip), false, ip);
    }
  });

  it("treats anything that is not an address as unsafe", () => {
    assert.equal(isNonPublicAddress("example.com"), true);
  });
});

describe("hostResolution", () => {
  it("is public only if every address is public", async () => {
    assert.equal(await hostResolution("a.example", async () => ["8.8.8.8", "2606:4700::1111"]), "public");
    assert.equal(await hostResolution("a.example", async () => ["8.8.8.8", "10.0.0.1"]), "non-public");
    assert.equal(await hostResolution("127.0.0.1.nip.io", async () => ["127.0.0.1"]), "non-public");
  });

  it("says unknown when names cannot be resolved here, instead of guessing", async () => {
    assert.equal(await hostResolution("a.example", async () => { throw new Error("no resolver"); }), "unknown");
    assert.equal(await hostResolution("a.example", async () => []), "unknown");
  });
});

describe("forwardProductEventToCrm", () => {
  const publicResolver = async () => ["104.16.0.1"];
  const neverCalled = (async () => { throw new Error("fetch must not be called"); }) as unknown as typeof fetch;

  it("does not contact an internal address, and says only that it was blocked", async () => {
    for (const url of ["https://169.254.169.254/latest/meta-data/", "http://hooks.example.com/x", "https://localhost/x", "https://user:pw@hooks.example.com/x"]) {
      const result = await forwardProductEventToCrm(url, event, "s3cret", { fetchImpl: neverCalled, resolver: publicResolver });
      assert.deepEqual(result, { ok: false, error: "blocked_url" }, url);
    }
  });

  it("does not contact a name that resolves inside", async () => {
    const result = await forwardProductEventToCrm("https://127.0.0.1.nip.io/x", event, null, {
      fetchImpl: neverCalled,
      resolver: async () => ["127.0.0.1"],
    });
    assert.deepEqual(result, { ok: false, error: "blocked_url" });
  });

  it("posts to a public address without following redirects", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const result = await forwardProductEventToCrm("https://hooks.example.com/in", event, "s3cret", {
      resolver: publicResolver,
      fetchImpl: (async (url: URL | string, init?: RequestInit) => {
        seen = { url: String(url), init };
        return new Response("ok", { status: 200 });
      }) as typeof fetch,
    });
    assert.deepEqual(result, { ok: true, status: 200 });
    assert.equal(seen?.url, "https://hooks.example.com/in");
    assert.equal(seen?.init?.redirect, "manual");
    assert.equal(seen?.init?.method, "POST");
    assert.equal((seen?.init?.headers as Record<string, string>).Authorization, "Bearer s3cret");
  });

  it("treats a redirect as a failure and never forwards the secret to its target", async () => {
    let calls = 0;
    const result = await forwardProductEventToCrm("https://hooks.example.com/in", event, "s3cret", {
      resolver: publicResolver,
      fetchImpl: (async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
      }) as typeof fetch,
    });
    assert.deepEqual(result, { ok: false, status: 302, error: "redirect_not_followed" });
    assert.equal(calls, 1);
  });

  it("reports network failures as a fixed code that reveals nothing about the target", async () => {
    const result = await forwardProductEventToCrm("https://hooks.example.com/in", event, null, {
      resolver: publicResolver,
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED 10.1.2.3:6379");
      }) as typeof fetch,
    });
    assert.deepEqual(result, { ok: false, error: "network_error" });
  });

  it("reports a timeout and an upstream HTTP error distinctly", async () => {
    const timeout = await forwardProductEventToCrm("https://hooks.example.com/in", event, null, {
      resolver: publicResolver,
      fetchImpl: (async () => {
        throw new DOMException("The operation timed out", "TimeoutError");
      }) as typeof fetch,
    });
    assert.deepEqual(timeout, { ok: false, error: "timeout" });
    const upstream = await forwardProductEventToCrm("https://hooks.example.com/in", event, null, {
      resolver: publicResolver,
      fetchImpl: (async () => new Response("no", { status: 503 })) as typeof fetch,
    });
    assert.deepEqual(upstream, { ok: false, status: 503, error: "http_503" });
  });

  it("still reports a missing URL", async () => {
    assert.deepEqual(await forwardProductEventToCrm("  ", event), { ok: false, error: "missing_url" });
  });
});

describe("settings accept only public https URLs", () => {
  it("rejects internal CRM webhook and review URLs when they are saved", () => {
    for (const crmWebhookUrl of ["http://169.254.169.254/latest", "https://localhost:8443/x", "https://10.0.0.1/hook", "javascript:alert(1)"]) {
      assert.equal(orgSettingsSchema.safeParse({ crmWebhookUrl }).success, false, crmWebhookUrl);
    }
    assert.equal(orgSettingsSchema.safeParse({ googleReviewUrl: "https://google.com@evil.example/r" }).success, false);
  });

  it("accepts real ones, and still allows clearing them", () => {
    assert.equal(orgSettingsSchema.safeParse({ crmWebhookUrl: "https://hooks.zapier.com/hooks/catch/1/x/" }).success, true);
    assert.equal(orgSettingsSchema.safeParse({ googleReviewUrl: "https://g.page/r/example" }).success, true);
    assert.equal(orgSettingsSchema.safeParse({ crmWebhookUrl: null, googleReviewUrl: null }).success, true);
    assert.equal(publicHttpsUrl().safeParse("https://example.com/x").success, true);
  });
});
