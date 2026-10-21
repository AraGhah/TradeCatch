import { createHmac } from "node:crypto";
import { test, expect, request as playwrightRequest, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FakeGoogle } from "./support/fake-google";
import { startFakeGoogleServer } from "./support/fake-google-server";

/**
 * End-to-end Gmail receiving against the real app (production build) with the
 * Gmail/OAuth endpoints served by tests/support/fake-google. Everything the
 * browser and the server do is real: OAuth redirect and callback, token
 * sealing, sync, notifications, the inbox UI, cookies and sessions. Only
 * Google itself is substituted.
 *
 * Sign-in budget: magic-link requests are limited to 5 per 15 minutes per IP
 * for the whole server process, and the other specs already use 3. This file
 * therefore signs in exactly twice (Alice and Bob) and reuses those sessions
 * for the owner-dashboard checks at the end. Do not add sign-ins here.
 */

const PORT = Number(process.env.TRADECATCH_GMAIL_E2E_PORT || 4010);
const OPS = {
  Authorization: "Bearer tradecatch-e2e-ops-secret-not-for-production",
  "X-Ops-Actor": "playwright-gmail",
};
const WEBHOOK = "/api/webhooks/gmail?token=e2e-gmail-webhook-token";

const google = new FakeGoogle();
let server: Awaited<ReturnType<typeof startFakeGoogleServer>>;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const pubsub = (email: string, historyId: string | number) => ({
  message: { data: Buffer.from(JSON.stringify({ emailAddress: email, historyId })).toString("base64") },
});

type Person = { email: string; page: Page; context: BrowserContext };

async function signUp(browser: Browser, label: string): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = `gmail-${label}-${Date.now()}@example.test`;
  const provision = await page.request.post("/api/missed-call/ops/provision-organization", {
    headers: OPS,
    data: { email, organizationName: `Gmail ${label}`, ownerName: `${label} Owner`, locale: "en", plan: "growth" },
  });
  expect(provision.status()).toBe(201);
  await signIn(page, email);
  return { email, page, context };
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page
    .waitForFunction(() => Boolean(document.querySelector('div[style*="transform"]')), undefined, { timeout: 10_000 })
    .catch(() => undefined);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("link", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page).toHaveURL(/\/app(?:\/)?$/);
}

/** Labels Gmail itself holds for the message with this subject. */
function fakeLabels(email: string, subject: string): Set<string> | undefined {
  for (const message of google.mailbox(email).messages.values()) {
    const found = message.payload.headers?.find((header) => header.name === "Subject");
    if (found?.value === subject) return message.labels;
  }
  return undefined;
}

async function api<T = Record<string, unknown>>(page: Page, path: string): Promise<{ status: number; body: T }> {
  const response = await page.request.get(path);
  return { status: response.status(), body: (await response.json().catch(() => ({}))) as T };
}

type ListBody = { messages: { id: string; subject: string; unread: boolean }[]; unread: number; next: string | null };
const subjects = (body: ListBody) => body.messages.map((message) => message.subject);

test.describe.configure({ mode: "serial" });

test.describe("Gmail receiving", () => {
  let alice: Person;
  let bob: Person;
  const ids: Record<string, string> = {};

  test.beforeAll(async ({ browser }) => {
    server = await startFakeGoogleServer(google, PORT);
    const box = google.mailbox("alice@gmail.com");
    box.deliver({
      from: "Marie Tremblay <marie@example.com>",
      subject: "Roof leak estimate",
      text: "Hi, my roof leaks near the chimney. Can you quote?",
      at: minutesAgo(30),
      threadId: "thr-roof",
    });
    box.deliver({
      from: "Paul Roy <paul@example.com>",
      subject: "Photos of the basement",
      text: "Photos attached.",
      attachments: [{ filename: "basement.jpg", mimeType: "image/jpeg", content: "JPEGDATA" }],
      at: minutesAgo(20),
    });
    box.deliver({
      from: "Hardware Store <noreply@hardware.com>",
      subject: "Your receipt",
      text: "Thanks for your order",
      headers: { "List-Unsubscribe": "<mailto:unsub@hardware.com>" },
      at: minutesAgo(10),
    });
    box.deliver({
      from: "Zoë Gagnon <zoe@example.com>",
      subject: "Soumission salle de bain",
      text: "Bonjour, j'aimerais une soumission.",
      at: minutesAgo(5),
    });
    google.mailbox("bob@gmail.com").deliver({
      from: "Carl <carl@example.com>",
      subject: "BOB PRIVATE: contract numbers",
      text: "bob-only-secret",
      at: minutesAgo(3),
    });
    alice = await signUp(browser, "alice");
    bob = await signUp(browser, "bob");
  });

  test.afterAll(async () => {
    await alice?.context.close();
    await bob?.context.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  test("settings: not connected yet, with a clear way to connect", async () => {
    await alice.page.goto("/app/settings");
    await expect(alice.page.locator('[data-testid="gmail-status"]:visible')).toContainText("Not connected");
    // Streaming can briefly hold a hidden copy of a segment; once settled there is exactly one.
    await alice.page.waitForLoadState("networkidle");
    await expect(alice.page.locator('[data-testid="gmail-status"]')).toHaveCount(1);
    await expect(alice.page.getByRole("link", { name: "Connect Gmail" })).toBeVisible();
    await expect(alice.page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
    await alice.page.goto("/app/mail");
    await expect(alice.page.getByText("Connect Gmail to see your customer emails here.")).toBeVisible();
    const dash = await api<ListBody>(alice.page, "/api/app/gmail/messages");
    expect(dash.body.messages).toEqual([]);
  });

  test("connecting asks Google for read-only access only, then shows the connected mailbox", async () => {
    google.consent = { mode: "allow", email: "alice@gmail.com" };
    await alice.page.goto("/app/settings");
    await alice.page.getByRole("link", { name: "Connect Gmail" }).click();
    await expect(alice.page).toHaveURL(/\/app\/settings\?gmail=connected/);
    const asked = google.authRequests.at(-1)!.params;
    expect(asked.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(asked.get("access_type")).toBe("offline");
    expect(asked.get("client_id")).toBe("e2e-gmail-client-id");
    expect(asked.get("redirect_uri")).toMatch(/\/api\/app\/gmail\/callback$/);
    expect(asked.toString()).not.toContain("e2e-gmail-client-secret");
    await expect(alice.page.getByText("Gmail is connected. New emails show up here automatically.")).toBeVisible();
    await expect(alice.page.locator('[data-testid="gmail-status"]:visible')).toContainText("Connected · alice@gmail.com");
    await expect(alice.page.getByRole("button", { name: "Disconnect" })).toBeVisible();
    await expect(alice.page.getByText(/Last successful sync/)).toBeVisible();
  });

  test("the browser never receives tokens or secrets", async () => {
    const seen: string[] = [];
    alice.page.on("response", async (response) => {
      const kind = response.request().resourceType();
      if (["document", "fetch", "xhr"].includes(kind)) seen.push(await response.text().catch(() => ""));
    });
    await alice.page.goto("/app/settings");
    await alice.page.goto("/app/mail");
    for (const path of ["/api/app/gmail/status", "/api/app/gmail/messages"]) seen.push(JSON.stringify((await api(alice.page, path)).body));
    const blob = seen.join("\n");
    for (const secret of ["rt:alice@gmail.com", "at:alice@gmail.com", "e2e-gmail-client-secret", "tokenCiphertext", "refreshToken", "accessToken"]) {
      expect(blob, `leaked ${secret}`).not.toContain(secret);
    }
    const cookies = await alice.context.cookies();
    expect(JSON.stringify(cookies)).not.toContain("rt:alice");
  });

  test("inbox shows sender, subject, preview, date and read status for received mail", async () => {
    await alice.page.goto("/app/mail");
    await expect(alice.page.getByRole("heading", { name: "Gmail inbox", level: 1 })).toBeVisible();
    const list = alice.page.getByRole("list", { name: "Emails" });
    await expect(list.getByRole("listitem")).toHaveCount(4);
    const zoe = list.getByRole("listitem").filter({ hasText: "Soumission salle de bain" });
    await expect(zoe).toContainText("Zoë Gagnon");
    await expect(zoe).toContainText("Bonjour, j'aimerais une soumission.");
    await expect(zoe.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
    await expect(zoe.locator("a")).toHaveAttribute("data-unread", "true");
    await expect(list.getByRole("listitem").filter({ hasText: "Photos of the basement" })).toContainText("Attachment");
    await expect(alice.page.locator('[data-testid="gmail-unread-badge"]:visible')).toHaveText(/4/);
    // Newest first.
    await expect(list.getByRole("listitem").first()).toContainText("Soumission salle de bain");
    const body = (await api<ListBody>(alice.page, "/api/app/gmail/messages")).body;
    for (const message of body.messages) ids[message.subject] = message.id;
    expect(body.unread).toBe(4);
    // The sent-by-nobody receipt is stored but is not flagged as a customer.
    await expect(alice.page.getByText("Customer").first()).toBeVisible();
  });

  test("filters and search work, with honest empty states", async () => {
    await alice.page.goto("/app/mail");
    const rows = alice.page.getByRole("list", { name: "Emails" }).getByRole("listitem");
    await expect(rows).toHaveCount(4);
    await alice.page.getByRole("button", { name: "From customers" }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "Your receipt" })).toHaveCount(0);
    await alice.page.getByRole("button", { name: "With attachments" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Photos of the basement");
    await alice.page.getByRole("button", { name: "All", exact: true }).click();
    await alice.page.getByLabel("Search emails").fill("roof");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Roof leak estimate");
    await alice.page.getByLabel("Search emails").fill("chimney"); // body text, not in subject/snippet
    await expect(rows).toHaveCount(1);
    await alice.page.getByLabel("Search emails").fill("no-such-thing-xyz");
    await expect(alice.page.getByText("No emails match.")).toBeVisible();
    await alice.page.getByLabel("Search emails").fill("");
    await expect(rows).toHaveCount(4);
  });

  test("opening an email reads it here (not in Gmail), updates the badge, and can be undone", async () => {
    await alice.page.goto("/app/mail");
    await alice.page.getByRole("link", { name: /Roof leak estimate/ }).click();
    await expect(alice.page.getByRole("heading", { name: "Roof leak estimate", level: 1 })).toBeVisible();
    await expect(alice.page.locator('[data-testid="gmail-body"]:visible').first()).toContainText("my roof leaks near the chimney");
    await expect(alice.page.getByText("Marie Tremblay · marie@example.com")).toBeVisible();
    await expect(alice.page.locator('[data-testid="gmail-read-state"]:visible')).toHaveText("Read");
    await expect(alice.page.locator('[data-testid="gmail-unread-badge"]:visible')).toHaveText(/3/);
    // Gmail's own state is untouched: the permission is read-only.
    expect(fakeLabels("alice@gmail.com", "Roof leak estimate")?.has("UNREAD")).toBe(true);

    await alice.page.locator('[data-testid="gmail-toggle-read"]:visible').click();
    await expect(alice.page.locator('[data-testid="gmail-read-state"]:visible')).toHaveText("Unread");
    await expect(alice.page.locator('[data-testid="gmail-unread-badge"]:visible')).toHaveText(/4/);
    await alice.page.locator('[data-testid="gmail-toggle-read"]:visible').click();
    await expect(alice.page.locator('[data-testid="gmail-read-state"]:visible')).toHaveText("Read");

    await alice.page.getByRole("link", { name: "All emails" }).click();
    await expect(alice.page.locator('a[data-unread="false"]')).toHaveCount(1);
    await expect(alice.page.locator('a[data-unread="true"]')).toHaveCount(3);
    // Survives a refresh: it is stored, not just in memory on the page.
    await alice.page.reload();
    await expect(alice.page.locator('a[data-unread="false"]')).toHaveCount(1);
    await alice.page.getByRole("button", { name: /^Unread/ }).click();
    await expect(alice.page.getByRole("list", { name: "Emails" }).getByRole("listitem")).toHaveCount(3);
  });

  test("attachments download with the right name and content", async () => {
    await alice.page.goto(`/app/mail/${ids["Photos of the basement"]}`);
    const [download] = await Promise.all([
      alice.page.waitForEvent("download"),
      alice.page.getByRole("link", { name: /basement\.jpg/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("basement.jpg");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("JPEGDATA");
  });

  test("dashboard shows the unread count and recent mail without slowing or breaking the dashboard", async () => {
    await alice.page.goto("/app");
    const card = alice.page.locator('[data-testid="gmail-dashboard-card"]:visible');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-testid="gmail-card-unread"]:visible')).toHaveText(/\d+ unread emails?/);
    await expect(card.getByRole("link", { name: /Soumission salle de bain/ })).toBeVisible();
    await expect(card.getByRole("link", { name: "Open inbox" })).toBeVisible();
    // The rest of the dashboard still renders around it.
    await expect(alice.page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(alice.page.getByText("Something went wrong")).toHaveCount(0);
  });

  test("new mail appears on its own in the open inbox and raises a notification", async () => {
    await alice.page.goto("/app/mail");
    await expect(alice.page.getByRole("list", { name: "Emails" }).getByRole("listitem")).toHaveCount(4);
    const unreadBefore = (await api<ListBody>(alice.page, "/api/app/gmail/messages")).body.unread;
    google.mailbox("alice@gmail.com").deliver({
      from: "Marie Tremblay <marie@example.com>",
      subject: "Urgent: leak getting worse",
      text: "It is raining inside now.",
      threadId: "thr-roof",
    });
    // The page itself triggers a background sync a moment after load; no click.
    await alice.page.reload();
    await expect(alice.page.getByRole("list", { name: "Emails" }).getByRole("listitem").first()).toContainText(
      "Urgent: leak getting worse",
      { timeout: 15_000 },
    );
    // Opening Photos earlier marked it read, so the count is whatever it was, plus this email.
    await expect(alice.page.locator('[data-testid="gmail-unread-badge"]:visible')).toHaveAttribute("title", `${unreadBefore + 1} unread emails`);

    await alice.page.goto("/app/notifications");
    const note = alice.page.getByRole("listitem").filter({ hasText: "New customer email" });
    await expect(note).toHaveCount(1);
    await expect(note).toContainText("Marie Tremblay — Urgent: leak getting worse");
    await note.getByRole("link", { name: "Open" }).click();
    await expect(alice.page.getByRole("heading", { name: "Urgent: leak getting worse", level: 1 })).toBeVisible();
  });

  test("a conversation shows every message in order, including your own replies", async () => {
    const box = google.mailbox("alice@gmail.com");
    box.deliver({
      from: "alice@gmail.com",
      subject: "Re: Roof leak estimate",
      text: "We can come Thursday.",
      labels: ["SENT"],
      threadId: "thr-roof",
      at: new Date(Date.now() + 1000),
    });
    await alice.page.goto("/app/mail");
    await alice.page.getByRole("button", { name: "Refresh" }).click();
    await alice.page.getByRole("link", { name: /Urgent: leak getting worse/ }).click();
    const messages = alice.page.locator('[data-testid="gmail-thread-message"]:visible');
    await expect(messages).toHaveCount(3);
    await expect(messages.nth(0)).toContainText("Marie Tremblay");
    await expect(messages.nth(1)).toContainText("Marie Tremblay");
    await expect(messages.nth(2)).toContainText("You");
    await expect(alice.page.getByText("3 messages")).toBeVisible();
    await expect(alice.page.getByRole("link", { name: "Reply in Gmail" })).toHaveAttribute("href", /mail\.google\.com\/mail\/u\/alice%40gmail\.com\/#all\/thr-roof/);
    // Your reply is context only: the inbox list and unread count do not include it.
    await alice.page.goto("/app/mail");
    await expect(alice.page.getByRole("list", { name: "Emails" }).getByRole("listitem")).toHaveCount(5);
  });

  test("Refresh pulls new mail and says how much", async () => {
    google.mailbox("alice@gmail.com").deliver({ from: "Lea <lea@example.com>", subject: "Quick question", text: "Are you open Saturday?" });
    await alice.page.goto("/app/mail");
    await alice.page.getByRole("button", { name: "Refresh" }).click();
    await expect(alice.page.getByText("1 new email")).toBeVisible();
    await expect(alice.page.getByRole("list", { name: "Emails" }).getByRole("listitem").first()).toContainText("Quick question");
    await alice.page.getByRole("button", { name: "Refresh" }).click();
    await expect(alice.page.getByText("Up to date")).toBeVisible();
  });

  test("a Gmail push notification brings mail in immediately; bad or stale pushes do nothing", async () => {
    const box = google.mailbox("alice@gmail.com");
    box.deliver({ from: "Dan <dan@example.com>", subject: "Pushed in", text: "hello" });
    const anon = await playwrightRequest.newContext({ baseURL: `http://localhost:${process.env.TRADECATCH_E2E_PORT || 3100}` });

    const bad = await anon.post("/api/webhooks/gmail?token=wrong", { data: pubsub("alice@gmail.com", box.historyId) });
    expect(bad.status()).toBe(401);
    const missing = await anon.post("/api/webhooks/gmail", { data: pubsub("alice@gmail.com", box.historyId) });
    expect(missing.status()).toBe(401);
    const unknown = await anon.post(WEBHOOK, { data: pubsub("nobody@gmail.com", box.historyId) });
    expect(await unknown.json()).toMatchObject({ ok: true, synced: 0 });
    const junk = await anon.post(WEBHOOK, { data: { message: { data: "###" } } });
    expect(junk.status()).toBe(200);
    expect(await junk.json()).toMatchObject({ ignored: true });

    await alice.page.goto("/app/settings"); // let the page's own sync settle first
    await alice.page.waitForTimeout(500);
    const good = await anon.post(WEBHOOK, { data: pubsub("alice@gmail.com", box.historyId) });
    expect(await good.json()).toMatchObject({ ok: true });
    await expect
      .poll(async () => subjects((await api<ListBody>(alice.page, "/api/app/gmail/messages")).body), { timeout: 10_000 })
      .toContain("Pushed in");
    const stale = await anon.post(WEBHOOK, { data: pubsub("alice@gmail.com", 1) });
    expect(await stale.json()).toMatchObject({ ok: true, synced: 0 });
    await anon.dispose();
  });

  test("signing out and refreshing lose nothing; the scheduled fallback syncs while nobody is signed in", async () => {
    const before = (await api<ListBody>(alice.page, "/api/app/gmail/messages")).body.messages.length;
    const session = await alice.context.cookies();
    await alice.context.clearCookies(); // as if signed out
    expect((await api(alice.page, "/api/app/gmail/messages")).status).toBe(401);
    expect((await api(alice.page, "/api/app/gmail/status")).status).toBe(401);

    google.mailbox("alice@gmail.com").deliver({ from: "Night Owl <owl@example.com>", subject: "Sent while signed out", text: "z" });
    const anon = await playwrightRequest.newContext({ baseURL: `http://localhost:${process.env.TRADECATCH_E2E_PORT || 3100}` });
    await alice.page.waitForTimeout(500); // the fallback only picks mailboxes not tried within the staleness window
    const denied = await anon.post("/api/gmail/sync/tick");
    expect(denied.status()).toBe(401);
    const tick = await anon.post("/api/gmail/sync/tick", { headers: { Authorization: OPS.Authorization, "x-vercel-cron": "cloudflare" } });
    expect(tick.status()).toBe(200);
    expect((await tick.json()).attempted).toBeGreaterThanOrEqual(1);
    await anon.dispose();

    // Signing back in resumes the same account (restoring the cookie stands in for it,
    // which keeps this file inside the shared magic-link rate limit).
    await alice.context.addCookies(session);
    const after = (await api<ListBody>(alice.page, "/api/app/gmail/messages")).body;
    expect(after.messages.length).toBe(before + 1);
    expect(subjects(after)).toContain("Sent while signed out");
    await alice.page.reload();
    await alice.page.goto("/app/mail");
    await expect(alice.page.getByRole("link", { name: /Sent while signed out/ })).toBeVisible();
  });

  test("revoked access shows a clear message and a reconnect path; mail is kept; reconnecting resumes", async () => {
    const box = google.mailbox("alice@gmail.com");
    box.revoked = true; // the user removed TradeCatch in their Google account
    google.expireAccessTokens();
    await alice.page.goto("/app/mail");
    await alice.page.getByRole("button", { name: "Refresh" }).click();
    const alert = alice.page.locator('[data-testid="gmail-error"]:visible');
    await expect(alert).toContainText("Gmail access expired or was removed");
    await expect(alert.getByRole("link", { name: "Reconnect Gmail" })).toBeVisible();
    await expect(alice.page.getByRole("list", { name: "Emails" }).getByRole("listitem").first()).toBeVisible();

    await alice.page.goto("/app/settings");
    await expect(alice.page.locator('[data-testid="gmail-status"]:visible')).toContainText("Needs reconnecting");
    await expect(alice.page.locator('[data-testid="gmail-problem"]:visible')).toContainText("Reconnect Gmail");
    // Disconnect is still available so a broken connection can always be removed.
    await expect(alice.page.getByRole("button", { name: "Disconnect" })).toBeVisible();
    await alice.page.goto("/app");
    await expect(alice.page.locator('[data-testid="gmail-card-alert"]:visible')).toContainText("Gmail access expired or was removed");

    google.reset();
    await alice.page.goto("/app/mail");
    await alice.page.waitForTimeout(2500); // background poller must not keep hitting Google for a dead connection
    expect(google.count("/gmail/v1")).toBe(0);

    box.deliver({ from: "Marie Tremblay <marie@example.com>", subject: "After reconnect", text: "back" });
    google.consent = { mode: "allow", email: "alice@gmail.com" };
    await alice.page.goto("/app/settings");
    await alice.page.getByRole("link", { name: "Reconnect Gmail" }).click();
    await expect(alice.page).toHaveURL(/gmail=connected/);
    await expect(alice.page.locator('[data-testid="gmail-status"]:visible')).toContainText("Connected · alice@gmail.com");
    const list = (await api<ListBody>(alice.page, "/api/app/gmail/messages")).body;
    expect(subjects(list)).toContain("After reconnect");
    expect(subjects(list)).toContain("Roof leak estimate"); // old mail kept, not duplicated
    expect(subjects(list).filter((subject) => subject === "Roof leak estimate")).toHaveLength(1);
  });

  test("a second user in another workspace sees only their own mailbox, never Alice's", async () => {
    google.consent = { mode: "allow", email: "bob@gmail.com" };
    await bob.page.goto("/app/settings");
    await bob.page.getByRole("link", { name: "Connect Gmail" }).click();
    await expect(bob.page).toHaveURL(/gmail=connected/);
    await expect(bob.page.locator('[data-testid="gmail-status"]:visible')).toContainText("bob@gmail.com");

    await bob.page.goto("/app/mail");
    const rows = bob.page.getByRole("list", { name: "Emails" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("BOB PRIVATE: contract numbers");
    await expect(bob.page.getByText("Roof leak estimate")).toHaveCount(0);

    const bobList = (await api<ListBody>(bob.page, "/api/app/gmail/messages?q=roof")).body;
    expect(bobList.messages).toEqual([]);
    const aliceList = (await api<ListBody>(alice.page, "/api/app/gmail/messages")).body;
    expect(subjects(aliceList).some((subject) => subject.includes("BOB PRIVATE"))).toBe(false);
    expect(aliceList.messages.length).toBeGreaterThan(5);

    // Guessing Alice's ids as Bob gets nothing on any surface.
    const aliceId = ids["Roof leak estimate"]!;
    const photoId = ids["Photos of the basement"]!;
    await bob.page.goto(`/app/mail/${aliceId}`);
    await expect(bob.page.getByText("Roof leak estimate")).toHaveCount(0);
    await expect(bob.page.getByText("my roof leaks near the chimney")).toHaveCount(0);
    await expect(bob.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect((await bob.page.request.get(`/api/app/gmail/messages/${photoId}/attachment?part=whatever`)).status()).toBe(404);
    expect((await bob.page.request.post(`/api/app/gmail/messages/${aliceId}/read`, { data: { read: true } })).status()).toBe(404);
    const stillUnread = (await api<ListBody>(alice.page, "/api/app/gmail/messages?filter=unread")).body;
    expect(stillUnread.messages.length).toBeGreaterThan(0);

    // Bob's connection flow cannot be driven with Alice's OAuth state.
    const forged = await bob.page.request.get(`/api/app/gmail/callback?code=${google.codeFor("alice@gmail.com")}&state=${encodeURIComponent(google.lastStateFor("alice@gmail.com"))}`, {
      maxRedirects: 0,
    });
    expect(forged.status()).toBe(307);
    expect(forged.headers().location).toContain("gmail=denied");
    expect((await api(bob.page, "/api/app/gmail/status")).body).toMatchObject({ status: { email: "bob@gmail.com" } });
    const tampered = await bob.page.request.get("/api/app/gmail/callback?code=abc&state=not-a-real-state", { maxRedirects: 0 });
    expect(tampered.headers().location).toContain("gmail=denied");
  });

  test("everything is available in French", async () => {
    await alice.page.goto("/fr/app/courrier");
    await expect(alice.page.getByRole("heading", { name: "Boîte Gmail", level: 1 })).toBeVisible();
    await expect(alice.page.getByRole("button", { name: "Non lus" })).toBeVisible();
    await expect(alice.page.getByLabel("Rechercher des courriels")).toBeVisible();
    await expect(alice.page.getByRole("link", { name: /Boîte Gmail/ }).first()).toBeVisible();
    await alice.page.getByRole("link", { name: /Quick question/ }).click();
    await expect(alice.page).toHaveURL(/\/fr\/app\/courrier\//);
    await expect(alice.page.getByRole("link", { name: "Répondre dans Gmail" })).toBeVisible();
    await alice.page.goto("/fr/app/parametres");
    await expect(alice.page.locator('[data-testid="gmail-status"]:visible')).toContainText("Connecté · alice@gmail.com");
    await expect(alice.page.getByRole("button", { name: "Déconnecter" })).toBeVisible();
    await expect(alice.page.getByRole("link", { name: "Reconnecter Gmail" })).toBeVisible();
    await alice.page.goto("/fr/app");
    await expect(alice.page.locator('[data-testid="gmail-dashboard-card"]:visible')).toContainText("Derniers courriels");
    // next-intl remembers the visited locale in a cookie; later tests expect English paths.
    await alice.context.clearCookies({ name: "NEXT_LOCALE" });
  });

  test("Gmail screens have no accessibility violations", async () => {
    const scans: [string, string][] = [
      ["/app/mail", '[data-testid="gmail-inbox"]'],
      ["/app/settings", 'section[aria-labelledby="gmail-settings-title"]'],
      ["/app", '[data-testid="gmail-dashboard-card"]'],
    ];
    for (const [path, scope] of scans) {
      await alice.page.goto(path);
      await alice.page.locator(scope).waitFor();
      const results = await new AxeBuilder({ page: alice.page })
        .include(scope)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), path).toEqual([]);
    }
    await alice.page.goto("/app/mail");
    await alice.page.getByRole("link", { name: /Quick question/ }).click();
    await alice.page.locator("article").waitFor();
    const results = await new AxeBuilder({ page: alice.page }).include("article").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test("disconnecting removes the copy, revokes Google's grant, and can be undone by connecting again", async () => {
    await alice.page.goto("/app/settings");
    alice.page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("TradeCatch will delete its copy of your emails");
      void dialog.accept();
    });
    await alice.page.getByRole("button", { name: "Disconnect" }).click();
    await expect(alice.page.locator('[data-testid="gmail-status"]:visible')).toContainText("Not connected");
    await expect(alice.page.getByText("Gmail was disconnected.")).toBeVisible();
    expect(google.revokedTokens).toContain("rt:alice@gmail.com");
    expect(google.count("/gmail/v1/users/me/stop")).toBeGreaterThanOrEqual(1);

    expect((await api<ListBody>(alice.page, "/api/app/gmail/messages")).body.messages).toEqual([]);
    await alice.page.goto(`/app/mail/${ids["Roof leak estimate"]}`);
    await expect(alice.page.getByText("my roof leaks near the chimney")).toHaveCount(0);
    await expect(alice.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await alice.page.goto("/app/mail");
    await expect(alice.page.getByText("Connect Gmail to see your customer emails here.")).toBeVisible();
    await alice.page.goto("/app");
    await expect(alice.page.locator('[data-testid="gmail-dashboard-card"]:visible')).toContainText("Connect Gmail");
    // Bob is untouched.
    await bob.page.goto("/app/mail");
    await expect(bob.page.getByRole("list", { name: "Emails" }).getByRole("listitem")).toHaveCount(1);
  });

  test("cancelling at Google, or not granting the Gmail permission, explains what to do", async () => {
    google.consent = { mode: "deny", email: "alice@gmail.com" };
    await alice.page.goto("/app/settings");
    await alice.page.getByRole("link", { name: "Connect Gmail" }).click();
    await expect(alice.page.locator('[data-testid="gmail-problem"]:visible')).toContainText("Google did not give TradeCatch access");
    await expect(alice.page.locator('[data-testid="gmail-status"]:visible')).toContainText("Not connected");
    await expect(alice.page.getByRole("link", { name: "Connect Gmail" })).toBeVisible();

    google.consent = { mode: "allow", email: "alice@gmail.com" };
    google.grantScope = "openid email"; // ticked off the Gmail box on Google's consent screen
    await alice.page.getByRole("link", { name: "Connect Gmail" }).click();
    await expect(alice.page.locator('[data-testid="gmail-problem"]:visible')).toContainText("Google did not give TradeCatch access");
    expect((await api<{ status: { status: string } }>(alice.page, "/api/app/gmail/status")).body.status.status).toBe("not_connected");
    google.grantScope = "https://www.googleapis.com/auth/gmail.readonly";

    await alice.page.getByRole("link", { name: "Connect Gmail" }).click();
    await expect(alice.page).toHaveURL(/gmail=connected/);
    const again = (await api<ListBody>(alice.page, "/api/app/gmail/messages")).body;
    expect(subjects(again)).toContain("Roof leak estimate");
  });

  // ---- Owner dashboard (/app), using the two sessions above -------------------------

  test("dashboard: headline, live status and an honest empty state", async () => {
    await bob.page.goto("/app");
    await expect(bob.page.getByRole("heading", { name: "Your business, right now", level: 1 })).toBeVisible();
    await expect(bob.page.getByText(/Updates on its own/)).toBeVisible();
    await expect(bob.page.getByText("Nothing in this period yet.")).toBeVisible();
    // A new workspace has no phone client: the page says so instead of showing zeros as facts.
    await expect(bob.page.getByText(/missed-call number is not linked/i)).toBeVisible();
    await expect(bob.page.getByText("Something went wrong")).toHaveCount(0);
  });

  test("dashboard: date range controls change the period and keep the page working", async () => {
    const page = bob.page;
    await page.goto("/app");
    await expect(page.getByRole("link", { name: "7 days", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(/range=today/);
    await expect(page.getByRole("link", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "30 days", exact: true }).click();
    await expect(page).toHaveURL(/range=30d/);
    await expect(page.getByRole("heading", { name: "Your business, right now", level: 1 })).toBeVisible();

    await page.getByLabel("From", { exact: true }).fill("2026-10-01");
    await page.getByLabel("To", { exact: true }).fill("2026-10-15");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/range=custom/);
    await expect(page).toHaveURL(/from=2026-10-01/);
    await expect(page).toHaveURL(/to=2026-10-15/);
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-10-01");
    await expect(page.getByRole("heading", { name: "Your business, right now", level: 1 })).toBeVisible();
  });

  test("dashboard: garbage in the URL falls back to a sane period instead of breaking", async () => {
    for (const query of ["range=bogus", "range=custom&from=nope&to=also-nope", "range=custom&from=2026-12-31&to=2026-01-01"]) {
      const response = await bob.page.goto(`/app?${query}`);
      expect(response?.status(), query).toBeLessThan(500);
      await expect(bob.page.getByRole("heading", { name: "Your business, right now", level: 1 }), query).toBeVisible();
    }
  });

  test("dashboard: the live endpoint serves only the signed-in workspace", async () => {
    const mine = await bob.page.request.get("/api/app/overview?range=7d");
    expect(mine.status()).toBe(200);
    const body = await mine.json();
    expect(body.overview.range.preset).toBe("7d");
    expect(mine.headers()["cache-control"] ?? "").toMatch(/no-store|private/);

    const hers = await (await alice.page.request.get("/api/app/overview")).text();
    expect(hers).not.toContain("Gmail bob");
    expect(JSON.stringify(body)).not.toContain("Gmail alice");

    const anon = await playwrightRequest.newContext({ baseURL: `http://localhost:${process.env.TRADECATCH_E2E_PORT || 3100}` });
    expect((await anon.get("/api/app/overview")).status()).toBe(401);
    await anon.dispose();
  });

  test("calendar OAuth callback: a state only works for the person and business it was issued to", async () => {
    // Google Calendar is not configured in this environment, so a state that clears
    // every identity check ends in ?calendar=error (the token exchange), never in
    // ?calendar=forbidden. Nothing here reaches Google.
    const secret = "tradecatch-e2e-session-secret-not-for-production";
    const mint = (organizationId: string, userId: string, exp = Date.now() + 60_000) => {
      const body = Buffer.from(JSON.stringify({ organizationId, userId, exp, nonce: "e2e" })).toString("base64url");
      return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
    };
    const who = async (person: Person) => {
      const me = (await (await person.page.request.get("/api/app/me")).json()) as {
        user: { id: string };
        organization: { id: string };
      };
      return { userId: me.user.id, orgId: me.organization.id };
    };
    const outcome = async (person: Person, state: string) => {
      const res = await person.page.request.get(`/api/calendar/oauth/callback?code=x&state=${encodeURIComponent(state)}`, {
        maxRedirects: 0,
      });
      expect(res.status()).toBe(307);
      return new URL(res.headers().location).searchParams.get("calendar");
    };
    const a = await who(alice);
    const b = await who(bob);

    expect(await outcome(alice, mint(a.orgId, a.userId))).toBe("error");
    // Another person's state, handed to Alice: right business, wrong user.
    expect(await outcome(alice, mint(a.orgId, b.userId))).toBe("forbidden");
    // Alice's own user id against Bob's business.
    expect(await outcome(alice, mint(b.orgId, a.userId))).toBe("forbidden");
    // Bob cannot use the state issued to Alice, and the reverse.
    expect(await outcome(bob, mint(a.orgId, a.userId))).toBe("forbidden");
    // Expired, tampered and unsigned states never reach the identity check.
    expect(await outcome(alice, mint(a.orgId, a.userId, Date.now() - 1000))).toBe("expired");
    expect(await outcome(alice, `${mint(a.orgId, a.userId)}x`)).toBe("expired");
    // Not signed in at all.
    const anon = await playwrightRequest.newContext({ baseURL: `http://localhost:${process.env.TRADECATCH_E2E_PORT || 3100}` });
    const res = await anon.get(`/api/calendar/oauth/callback?code=x&state=${encodeURIComponent(mint(a.orgId, a.userId))}`, { maxRedirects: 0 });
    expect(new URL(res.headers().location).searchParams.get("calendar")).toBe("forbidden");
    await anon.dispose();
  });

  test("dashboard: each workspace sees only its own name and data", async () => {
    await alice.page.goto("/app");
    await bob.page.goto("/app");
    await expect(alice.page.getByText("Gmail alice").first()).toBeVisible();
    await expect(bob.page.getByText("Gmail bob").first()).toBeVisible();
    await expect(alice.page.getByText("Gmail bob")).toHaveCount(0);
    await expect(bob.page.getByText("Gmail alice")).toHaveCount(0);
  });

  test("dashboard: renders in French", async () => {
    await bob.page.goto("/fr/app");
    await expect(bob.page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(bob.page.getByText("Something went wrong")).toHaveCount(0);
    await expect(bob.page.getByRole("link", { name: /Aujourd/ }).first()).toBeVisible();
    await bob.context.clearCookies({ name: "NEXT_LOCALE" });
  });

  test("dashboard: no accessibility violations on the whole page", async () => {
    await alice.page.goto("/app");
    await alice.page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page: alice.page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    ).toEqual([]);
  });
  test("reply alert channels are configurable and Gmail shows successful sync freshness", async () => {
    const me = (await (await alice.page.request.get("/api/app/me")).json()) as {
      organization: { id: string };
    };
    const url = `/api/businesses/${me.organization.id}/notification-preferences`;
    const original = (await (await alice.page.request.get(url)).json()) as {
      preferences: Record<string, unknown>;
    };
    await alice.page.goto("/app/settings");
    await expect(
      alice.page.getByRole("link", { name: "Choose reply alerts" }),
    ).toBeVisible();
    await alice.page.getByRole("link", { name: "Choose reply alerts" }).click();
    const dailySummary = alice.page.getByLabel("Daily summary", {
      exact: true,
    });
    await expect(dailySummary).toBeVisible();
    await dailySummary.check();
    const row = alice.page.getByRole("group", {
      name: "Customer replies, including Gmail",
    });
    await row.getByLabel("Email", { exact: true }).check();
    await row.getByLabel("SMS", { exact: true }).check();
    await alice.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(alice.page.getByText("Saved.", { exact: true })).toBeVisible();
    const saved = (await (await alice.page.request.get(url)).json()) as {
      preferences: {
        dailySummary: boolean;
        categories: { replies: { email: boolean; sms: boolean } };
      };
    };
    expect(saved.preferences.dailySummary).toBe(true);
    expect(saved.preferences.categories.replies).toMatchObject({
      email: true,
      sms: true,
    });
    await alice.page.request.put(url, { data: original.preferences });
    await bob.page.goto("/app/settings");
    const status = (await (
      await bob.page.request.get("/api/app/gmail/status")
    ).json()) as { status: { lastSyncAt: string | null } };
    expect(status.status.lastSyncAt).not.toBeNull();
    await expect(
      bob.page.getByTestId("gmail-last-successful-sync"),
    ).toContainText("Last successful sync");
    const updated = new Date(Date.now() + 1000).toISOString();
    await bob.page.evaluate(
      (value) =>
        window.dispatchEvent(
          new CustomEvent("tradecatch:gmail", { detail: { status: value } }),
        ),
      {
        ...status.status,
        lastSyncAt: updated,
        pushEnabled: false,
        pushConfigured: false,
      },
    );
    await expect(
      bob.page.getByTestId("gmail-last-successful-sync").locator("time"),
    ).toHaveAttribute("datetime", updated);
    await expect(bob.page.getByTestId("gmail-sync-mode")).toContainText(
      "five minutes",
    );
  });
});
