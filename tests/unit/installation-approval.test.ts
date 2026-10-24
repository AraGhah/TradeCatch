import assert from "node:assert/strict";
import { test, afterEach, mock } from "node:test";
import {
  enforceInstallationRequest,
  verifyAtAuthority,
} from "../../src/product/installations/gate";
import {
  installationCommand,
  normalizeInstallationOrigin,
} from "../../src/product/installations/model";

afterEach(() => mock.restoreAll());

test("misconfigured authority cannot recursively call itself", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ approved: true });
  });
  const denied = await enforceInstallationRequest(
    new Request("https://tradecatch.ca"),
    {
      INSTALLATION_ENFORCEMENT: "enforce",
      INSTALLATION_INVENTORY_CONFIRMED: "1",
      INSTALLATION_ID: crypto.randomUUID(),
      INSTALLATION_CREDENTIAL: "x".repeat(43),
      INSTALLATION_AUTHORITY_MODE: "remote",
    },
  );
  assert.equal(denied?.status, 503);
  assert.equal(calls, 0);
});
const env = {
  INSTALLATION_ENFORCEMENT: "enforce",
  INSTALLATION_INVENTORY_CONFIRMED: "1",
  INSTALLATION_ID: crypto.randomUUID(),
  INSTALLATION_CREDENTIAL: "a".repeat(43),
};
const production = "https://tradecatch.ca";
test("approval is disabled by default, with zero authority or database calls for existing environments", async () => {
  for (const origin of [
    production,
    "https://tradecatch.ara-ghahramanyan07.workers.dev",
    "https://existing-tradecatch.ara-ghahramanyan07.workers.dev",
    "http://localhost:3000",
    "https://staging.unknown.test",
  ]) {
    assert.equal(
      await enforceInstallationRequest(new Request(origin), {}, async () => {
        throw new Error("Must never run");
      }),
      null,
    );
  }
});
test("enforcement cannot start without the explicit inventory confirmation", async () => {
  assert.equal(
    (
      await enforceInstallationRequest(new Request(production), {
        ...env,
        INSTALLATION_INVENTORY_CONFIRMED: "",
      })
    )?.status,
    503,
  );
  assert.equal(
    (
      await enforceInstallationRequest(new Request(production), {
        ...env,
        INSTALLATION_ENFORCEMENT: "typo",
      })
    )?.status,
    503,
  );
  assert.equal(
    (
      await enforceInstallationRequest(new Request(production), {
        ...env,
        INSTALLATION_CREDENTIAL: "",
      })
    )?.status,
    403,
  );
});
test("exact approved origin works across updates; a new domain is not grandfathered", async () => {
  const check = async (_id: string, _secret: string, origin: string) =>
    origin === production;
  for (let deploy = 0; deploy < 3; deploy++)
    assert.equal(
      await enforceInstallationRequest(new Request(production), env, check),
      null,
    );
  for (const origin of [
    "https://tradecatch.ca.evil.test",
    "https://new-tradecatch.ara-ghahramanyan07.workers.dev",
    "http://localhost:3001",
  ])
    assert.equal(
      (await enforceInstallationRequest(new Request(origin), env, check))
        ?.status,
      403,
    );
});
test("revocation takes effect on the next request; no cached approvals or failure-open", async () => {
  let approved = true;
  const check = async () => approved;
  assert.equal(
    await enforceInstallationRequest(new Request(production), env, check),
    null,
  );
  approved = false;
  assert.equal(
    (await enforceInstallationRequest(new Request(production), env, check))
      ?.status,
    403,
  );
  const error = await enforceInstallationRequest(
    new Request(production),
    env,
    async () => {
      throw new Error("private provider secret");
    },
  );
  assert.equal(error?.status, 503);
  assert.doesNotMatch(await error!.text(), /private provider secret/);
});
test("forwarded host cannot grant access and unapproved browser Origin is refused", async () => {
  const check = async (_id: string, _secret: string, origin: string) =>
    origin === production;
  assert.equal(
    (
      await enforceInstallationRequest(
        new Request("https://evil.test", {
          headers: {
            host: "tradecatch.ca",
            "x-forwarded-host": "tradecatch.ca",
          },
        }),
        env,
        check,
      )
    )?.status,
    403,
  );
  assert.equal(
    (
      await enforceInstallationRequest(
        new Request(production, { headers: { origin: "https://evil.test" } }),
        env,
        check,
      )
    )?.status,
    403,
  );
  // Existing signed-provider requests need no browser Origin, but still pass
  // approval plus the original provider signature/auth checks downstream.
  assert.equal(
    await enforceInstallationRequest(
      new Request(production + "/api/webhooks/stripe", { method: "POST" }),
      env,
      check,
    ),
    null,
  );
});
test("normalization rejects wildcards, insecure domains, user info and non-origin URLs", () => {
  assert.equal(
    normalizeInstallationOrigin("https://TRADECATCH.ca/"),
    production,
  );
  assert.equal(
    normalizeInstallationOrigin("http://localhost:3000"),
    "http://localhost:3000",
  );
  for (const bad of [
    "https://*-tradecatch.ara-ghahramanyan07.workers.dev",
    "http://evil.test",
    "https://u:p@tradecatch.ca",
    "https://tradecatch.ca/path",
    "https://tradecatch.ca/a/..",
    "https://tradecatch.ca?x=1",
    "https://tradecatch.ca#fragment",
    "https://tradecatch.ca.",
    "null",
    "https://tradecatch.ca\\evil",
  ])
    assert.throws(() => normalizeInstallationOrigin(bad), bad);
  assert.equal(
    installationCommand.safeParse({
      action: "register",
      label: "Unsafe",
      origin: "https://*.example.test",
      reason: "Test only",
    }).success,
    false,
  );
});
test("authority uses a fixed HTTPS destination, no redirects, and a bounded response", async () => {
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(input, "https://tradecatch.ca/api/installations/verify");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${env.INSTALLATION_CREDENTIAL}`,
      );
      return Response.json({ approved: true });
    },
  );
  assert.equal(
    await verifyAtAuthority(
      env.INSTALLATION_ID,
      env.INSTALLATION_CREDENTIAL,
      production,
    ),
    true,
  );
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response("x".repeat(1024)));
  await assert.rejects(
    verifyAtAuthority(
      env.INSTALLATION_ID,
      env.INSTALLATION_CREDENTIAL,
      production,
    ),
  );
});
