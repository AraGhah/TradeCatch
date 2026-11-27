import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAccountSession,
  isAccountDestination,
  parseAccountAnswer,
  type AccountSnapshot,
} from "../../src/lib/client/account-session";

type Answer = { status?: number; body?: unknown } | "network-error";

/** A fake server whose answers the test chooses, one request at a time. */
function harness(answers: Answer[], { locale = "en" as "en" | "fr" } = {}) {
  const requests: string[] = [];
  const navigations: string[] = [];
  const snapshots: AccountSnapshot[] = [];
  const gates: Array<() => void> = [];
  let held = false;
  let index = 0;

  const fakeFetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    const answer = answers[Math.min(index, answers.length - 1)]!;
    index += 1;
    if (held) await new Promise<void>((resolve) => gates.push(resolve));
    if (answer === "network-error") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
    });
  }) as typeof fetch;

  const session = createAccountSession({
    fetch: fakeFetch,
    locale,
    loginPath: locale === "fr" ? "/fr/connexion" : "/login",
    navigate: (path) => navigations.push(path),
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  return {
    session,
    requests,
    navigations,
    snapshots,
    /** Hold every answer back until release() is called. */
    hold() {
      held = true;
    },
    release() {
      held = false;
      for (const open of gates.splice(0)) open();
    },
  };
}

const customer: Answer = {
  body: { state: "signed_in", role: "customer", destination: "/app" },
};
const admin: Answer = {
  body: { state: "signed_in", role: "admin", destination: "/admin" },
};
const signedOut: Answer = {
  body: { state: "anonymous", destination: "/login" },
};

describe("parseAccountAnswer", () => {
  it("accepts the three answers the server gives", () => {
    assert.deepEqual(
      parseAccountAnswer(200, { state: "anonymous", destination: "/login" }),
      { state: "anonymous", destination: "/login" },
    );
    assert.deepEqual(
      parseAccountAnswer(200, {
        state: "signed_in",
        role: "admin",
        destination: "/fr/admin",
      }),
      { state: "signed_in", role: "admin", destination: "/fr/admin" },
    );
    assert.deepEqual(
      parseAccountAnswer(200, {
        state: "signed_in",
        role: "billing",
        destination: "/fr/facturation",
      }),
      { state: "signed_in", role: "billing", destination: "/fr/facturation" },
    );
  });

  it("treats every unexpected answer as unavailable, never as signed in or out", () => {
    const unavailable = { state: "unavailable" };
    assert.deepEqual(parseAccountAnswer(503, { state: "unavailable" }), unavailable);
    assert.deepEqual(parseAccountAnswer(429, { error: "rate_limited" }), unavailable);
    assert.deepEqual(parseAccountAnswer(200, null), unavailable);
    assert.deepEqual(parseAccountAnswer(200, "signed_in"), unavailable);
    assert.deepEqual(parseAccountAnswer(200, { state: "signed_in", destination: "/app" }), unavailable);
    assert.deepEqual(
      parseAccountAnswer(200, { state: "signed_in", role: "root", destination: "/app" }),
      unavailable,
    );
    assert.deepEqual(parseAccountAnswer(200, { state: "maybe", destination: "/login" }), unavailable);
  });

  it("never accepts an address outside our own sign-in and dashboard pages", () => {
    for (const evil of [
      "https://evil.example/app",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/app/../admin",
      "/app?next=//evil.example",
      "/api/auth/logout",
      "/app/leads",
      "",
      42,
      null,
    ]) {
      assert.equal(isAccountDestination(evil), false, String(evil));
      assert.deepEqual(
        parseAccountAnswer(200, { state: "anonymous", destination: evil }),
        { state: "unavailable" },
      );
    }
    for (const ok of ["/login", "/fr/connexion", "/app", "/fr/app", "/admin", "/fr/admin", "/billing", "/fr/facturation"]) {
      assert.equal(isAccountDestination(ok), true, ok);
    }
  });
});

describe("the profile icon's session", () => {
  it("sends a signed-out visitor to sign in", async () => {
    const h = harness([signedOut]);
    await h.session.open();
    assert.deepEqual(h.navigations, ["/login"]);
  });

  it("sends a customer to their dashboard and an administrator to the admin dashboard", async () => {
    const asCustomer = harness([customer]);
    await asCustomer.session.open();
    assert.deepEqual(asCustomer.navigations, ["/app"]);

    const asAdmin = harness([admin]);
    await asAdmin.session.open();
    assert.deepEqual(asAdmin.navigations, ["/admin"]);
  });

  it("asks for the French answer on the French site", async () => {
    const h = harness([{ body: { state: "signed_in", role: "customer", destination: "/fr/app" } }], { locale: "fr" });
    await h.session.open();
    assert.deepEqual(h.requests, ["/api/auth/session?locale=fr"]);
    assert.deepEqual(h.navigations, ["/fr/app"]);
  });

  it("goes nowhere while the session is still being checked, then to the right place", async () => {
    const h = harness([customer]);
    h.hold();
    const first = h.session.check();
    const click = h.session.open();
    // The check is open: no premature trip to the sign-in page (or anywhere else).
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(h.navigations, []);
    assert.equal(h.snapshots.at(-1)?.busy, true);
    assert.equal(h.snapshots.at(-1)?.view.state, "loading");
    // The click shares the check that was already running.
    assert.equal(h.requests.length, 1);

    h.release();
    await Promise.all([first, click]);
    assert.deepEqual(h.navigations, ["/app"]);
    assert.equal(h.requests.length, 1);
  });

  it("asks again at the moment of the click instead of trusting an old answer (session ended meanwhile)", async () => {
    const h = harness([customer, signedOut]);
    await h.session.check();
    assert.equal(h.snapshots.at(-1)?.view.state, "signed_in");

    await h.session.open();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.navigations, ["/login"], "an ended session goes to sign in, not to a dashboard that would bounce them");
    assert.equal(h.snapshots.at(-1)?.view.state, "anonymous");
  });

  it("rapid clicks cost one request and one navigation", async () => {
    const h = harness([customer]);
    h.hold();
    const clicks = Array.from({ length: 12 }, () => h.session.open());
    h.release();
    await Promise.all(clicks);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.navigations, ["/app"]);
    // Still no second trip after the navigation began.
    await h.session.open();
    await h.session.open();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.navigations, ["/app"]);
  });

  it("falls back to sign-in when the check fails and nothing is known", async () => {
    for (const answer of ["network-error", { status: 503, body: { state: "unavailable" } }, { status: 429, body: {} }] as Answer[]) {
      const h = harness([answer]);
      await h.session.open();
      assert.deepEqual(h.navigations, ["/login"], JSON.stringify(answer));
      assert.equal(h.snapshots.at(-1)?.view.state, "unavailable");
    }
    const french = harness(["network-error"], { locale: "fr" });
    await french.session.open();
    assert.deepEqual(french.navigations, ["/fr/connexion"]);
  });

  it("falls back to the last place it knew when a later check fails", async () => {
    const h = harness([admin, "network-error"]);
    await h.session.check();
    await h.session.open();
    assert.deepEqual(h.navigations, ["/admin"]);
  });

  it("never follows an address the answer should not name", async () => {
    const h = harness([{ body: { state: "signed_in", role: "customer", destination: "https://evil.example/app" } }]);
    await h.session.open();
    assert.deepEqual(h.navigations, ["/login"]);
  });

  it("can be used again after the page returns from the back/forward cache", async () => {
    const h = harness([customer, signedOut]);
    await h.session.open();
    assert.deepEqual(h.navigations, ["/app"]);
    assert.equal(h.snapshots.at(-1)?.busy, true);

    h.session.reset();
    await h.session.check();
    assert.equal(h.snapshots.at(-1)?.busy, false);
    await h.session.open();
    assert.deepEqual(h.navigations, ["/app", "/login"]);
  });

  it("does nothing once stopped (the header left the page)", async () => {
    const h = harness([customer]);
    h.hold();
    const click = h.session.open();
    h.session.stop();
    h.release();
    await click;
    assert.deepEqual(h.navigations, []);
  });
});
