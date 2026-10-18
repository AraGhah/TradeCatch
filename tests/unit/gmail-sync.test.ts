import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { openGmailTokens } from "../../src/product/gmail/oauth";
import { syncGmailAccount, syncSkipReason, downloadGmailAttachment } from "../../src/product/gmail/sync";
import { at, createHarness, TEST_ENV, T0, type Harness } from "../support/gmail-harness";

const OWNER = "owner@gmail.com";
const owner = { organizationId: "org_a", userId: "usr_a" };

function inbox(h: Harness, filter?: Parameters<Harness["store"]["listMessages"]>[2]) {
  return h.store.listMessages(owner.organizationId, owner.userId, filter);
}

describe("gmail sync", () => {
  let h: Harness;
  let box: ReturnType<Harness["google"]["mailbox"]>;

  beforeEach(async () => {
    h = createHarness();
    box = h.google.mailbox(OWNER);
    await h.connect(OWNER);
  });

  it("first sync imports only recent inbox mail, learns the address and does not alert on old mail", async () => {
    box.deliver({ from: "Marie <marie@example.com>", subject: "Old quote", text: "hi", at: new Date(T0 - 864e5) });
    box.deliver({ from: OWNER, subject: "My own reply", text: "sent", labels: ["SENT"] });
    box.deliver({ from: "x@y.com", subject: "Draft", text: "d", labels: ["DRAFT"] });
    box.deliver({ from: "spam@y.com", subject: "Spam", text: "d", labels: ["SPAM"] });
    const result = await h.sync(0);
    assert.deepEqual(result, { ok: true, added: 1, skipped: false, more: false });
    const rows = await inbox(h);
    assert.deepEqual(rows.map((row) => row.subject), ["Old quote"]);
    const account = await h.account();
    assert.equal(account.email, OWNER);
    assert.equal(account.historyId, box.historyId);
    assert.equal(account.lastError, null);
    assert.equal(h.alerts.length, 0, "connecting must not page the user about old mail");
  });

  it("on first connect also pulls your own replies, but only in conversations it imports", async () => {
    box.deliver({ from: "Marie <marie@example.com>", subject: "Quote", text: "Need price", threadId: "thread-1", at: new Date(T0 - 3000) });
    box.deliver({ from: OWNER, subject: "Re: Quote", text: "Here you go", labels: ["SENT"], threadId: "thread-1", at: new Date(T0 - 2000) });
    box.deliver({ from: OWNER, subject: "Unrelated outgoing", text: "hello", labels: ["SENT"], threadId: "thread-other" });
    const result = await h.sync(0);
    assert.equal(result.ok && result.added, 2);
    const [row] = await inbox(h);
    const thread = await h.store.listThread(owner.organizationId, owner.userId, (await h.store.getMessage(owner.organizationId, owner.userId, row!.id))!.threadId);
    assert.deepEqual(thread.map((message) => `${message.direction}:${message.subject}`), ["inbound:Quote", "outbound:Re: Quote"]);
    assert.equal((await inbox(h)).length, 1, "the reply is context, not an inbox row");
    assert.equal(h.alerts.length, 0);
  });

  it("imports new mail incrementally, once, and alerts only for customer emails", async () => {
    await h.sync(0);
    box.deliver({ from: "Marie <marie@example.com>", subject: "Need a quote", text: "Roof leak" });
    box.deliver({ from: "Shop <noreply@shop.com>", subject: "Receipt", text: "thanks" });
    box.deliver({
      from: "News <news@brand.com>",
      subject: "Sale",
      text: "50% off",
      headers: { "List-Unsubscribe": "<mailto:unsub@brand.com>" },
    });
    const result = await h.sync(2);
    assert.equal(result.ok && result.added, 3);
    assert.deepEqual(h.alerts.map((message) => message.subject), ["Need a quote"]);
    const customers = await inbox(h, { important: true });
    assert.deepEqual(customers.map((row) => row.subject), ["Need a quote"]);
  });

  it("never duplicates mail, even when the same history is replayed", async () => {
    box.deliver({ from: "a@example.com", subject: "One", text: "1" });
    await h.sync(0);
    const first = await h.account();
    box.deliver({ from: "b@example.com", subject: "Two", text: "2" });
    await h.sync(2);
    // Rewind the cursor as if a crash had lost the last save.
    await h.store.updateAccount(first.id, { historyId: first.historyId, lastAttemptAt: null });
    const replay = await h.sync(4);
    assert.equal(replay.ok && replay.added, 0);
    assert.equal((await inbox(h)).length, 2);
    assert.equal(h.alerts.length, 1, "a replay must not alert twice");
  });

  it("spends no API calls when asked again too soon", async () => {
    await h.sync(0);
    h.google.reset();
    const again = await h.sync(0.5);
    assert.deepEqual(again, { ok: true, added: 0, skipped: true, more: false });
    assert.equal(h.google.calls.length, 0);
    assert.equal(syncSkipReason({ lastAttemptAt: at(0).toISOString(), nextSyncAt: null, lastError: null }, at(0.1).getTime(), "manual"), "recent");
  });

  it("uses one cheap history call, not a profile call, on later syncs", async () => {
    await h.sync(0);
    h.google.reset();
    await h.sync(2);
    assert.equal(h.google.count("/profile"), 0);
    assert.equal(h.google.count("/history"), 1);
  });

  it("follows every page of history so a burst of mail is not lost", async () => {
    await h.sync(0);
    h.google.historyPageSize = 40;
    for (let i = 0; i < 130; i += 1) {
      box.deliver({ from: `p${i}@example.com`, subject: `Burst ${i}`, text: "x", at: new Date(T0 + i * 1000) });
    }
    const result = await h.sync(2);
    assert.deepEqual(result, { ok: true, added: 130, skipped: false, more: false });
    assert.equal((await inbox(h, { limit: 100 })).length, 100);
    assert.equal(h.google.count("/history"), 4);
  });

  it("resumes where it stopped when history is longer than one run reads", async () => {
    await h.sync(0);
    h.google.historyPageSize = 1;
    for (let i = 0; i < 14; i += 1) box.deliver({ from: `p${i}@example.com`, subject: `S${i}`, text: "x" });
    const first = await h.sync(2);
    assert.equal(first.ok && first.more, true);
    assert.equal(first.ok && first.added, 10);
    const second = await h.sync(4);
    assert.deepEqual(second, { ok: true, added: 4, skipped: false, more: false });
    assert.equal((await inbox(h, { limit: 100 })).length, 14);
  });

  it("mirrors read, unread, trash and permanent deletion from Gmail", async () => {
    const a = box.deliver({ from: "a@example.com", subject: "A", text: "a" });
    const b = box.deliver({ from: "b@example.com", subject: "B", text: "b" });
    const c = box.deliver({ from: "c@example.com", subject: "C", text: "c" });
    const d = box.deliver({ from: "d@example.com", subject: "D", text: "d", unread: false });
    await h.sync(0);
    assert.equal(await h.store.countUnread(owner.organizationId, owner.userId), 3);
    box.setUnread(a, false);
    box.setUnread(d, true);
    box.trash(b);
    box.remove(c);
    await h.sync(2);
    const subjects = (await inbox(h)).map((row) => `${row.subject}:${row.unread ? "u" : "r"}`).sort();
    assert.deepEqual(subjects, ["A:r", "D:u"]);
    assert.equal(await h.store.countUnread(owner.organizationId, owner.userId), 1);
  });

  it("keeps a message read locally when Gmail still thinks it is unread", async () => {
    const id = box.deliver({ from: "a@example.com", subject: "A", text: "a" });
    await h.sync(0);
    const [row] = await inbox(h);
    assert.equal(await h.store.setRead(owner.organizationId, owner.userId, row!.id, true), true);
    box.deliver({ from: "b@example.com", subject: "B", text: "b" });
    await h.sync(2);
    const a = (await inbox(h)).find((message) => message.subject === "A");
    assert.equal(a?.unread, false, `${id} stays read here`);
  });

  it("recovers by starting over when Google has forgotten the history id", async () => {
    box.deliver({ from: "a@example.com", subject: "A", text: "a" });
    await h.sync(0);
    box.deliver({ from: "b@example.com", subject: "B", text: "b" });
    box.expireHistory();
    const result = await h.sync(2);
    assert.equal(result.ok && result.added, 1);
    assert.deepEqual((await inbox(h)).map((row) => row.subject).sort(), ["A", "B"]);
    assert.equal((await h.account()).historyId, box.historyId);
  });

  it("stores your own replies for context but keeps them out of the inbox and unread count", async () => {
    box.deliver({ from: "Marie <marie@example.com>", subject: "Quote", text: "Need price", threadId: "thread-1", at: new Date(T0 - 3000) });
    await h.sync(0);
    box.deliver({ from: OWNER, subject: "Re: Quote", text: "Here you go", labels: ["SENT"], threadId: "thread-1", at: new Date(T0 - 2000) });
    box.deliver({ from: OWNER, subject: "Unrelated outgoing", text: "hello", labels: ["SENT"], threadId: "thread-other" });
    box.deliver({ from: "Marie <marie@example.com>", subject: "Re: Quote", text: "Thanks!", threadId: "thread-1", at: new Date(T0 - 1000) });
    await h.sync(2);
    assert.equal((await inbox(h)).length, 2, "inbox lists received mail only");
    const row = (await inbox(h)).find((message) => message.subject === "Quote");
    const stored = await h.store.getMessage(owner.organizationId, owner.userId, row!.id);
    const thread = await h.store.listThread(owner.organizationId, owner.userId, stored!.threadId);
    assert.deepEqual(thread.map((message) => `${message.direction}:${message.bodyText}`), [
      "inbound:Need price",
      "outbound:Here you go",
      "inbound:Thanks!",
    ]);
    assert.equal(await h.store.countUnread(owner.organizationId, owner.userId), 2);
  });

  it("refreshes an expired access token and saves the new one", async () => {
    await h.sync(0);
    const before = openGmailTokens((await h.account()).tokenCiphertext!, TEST_ENV);
    h.google.expireAccessTokens();
    box.deliver({ from: "a@example.com", subject: "After expiry", text: "x" });
    const result = await h.sync(2);
    assert.equal(result.ok && result.added, 1);
    assert.equal(h.google.count("/token"), 2, "the connect exchange plus exactly one refresh after the 401");
    const after = openGmailTokens((await h.account()).tokenCiphertext!, TEST_ENV);
    assert.notEqual(after.accessToken, before.accessToken);
    assert.equal(after.refreshToken, before.refreshToken);
  });

  it("marks the account for reconnection when the user revoked access, and then stops calling Google", async () => {
    box.deliver({ from: "a@example.com", subject: "Kept", text: "x" });
    await h.sync(0);
    box.revoked = true;
    h.google.expireAccessTokens();
    const result = await h.sync(2);
    assert.deepEqual(result, { ok: false, error: "needs_reconnect" });
    const account = await h.account();
    assert.equal(account.status, "needs_reconnect");
    assert.equal(account.tokenCiphertext, null, "dead credentials are dropped");
    assert.equal((await inbox(h)).length, 1, "existing mail is kept");
    h.google.reset();
    assert.deepEqual(await h.sync(60), { ok: false, error: "needs_reconnect" });
    assert.equal(h.google.calls.length, 0);
  });

  it("treats tokens it can no longer decrypt as needing a reconnect", async () => {
    const account = await h.account();
    const result = await syncGmailAccount({
      account,
      store: h.store,
      env: { ...TEST_ENV, authSecret: "a-different-secret-entirely-0123456789" },
      now: at(0),
      fetchImpl: h.google.fetchImpl(),
    });
    assert.deepEqual(result, { ok: false, error: "needs_reconnect" });
    assert.equal((await h.account()).status, "needs_reconnect");
  });

  it("backs off when Gmail rate-limits, honours Retry-After, and recovers", async () => {
    await h.sync(0);
    h.google.failNext(429, { error: { code: 429, message: "Too many requests", errors: [{ reason: "rateLimitExceeded" }] } }, { "Retry-After": "900" });
    const limited = await h.sync(2);
    assert.deepEqual(limited, { ok: false, error: "rate_limited" });
    const account = await h.account();
    assert.equal(account.lastError, "rate_limited");
    assert.equal(Date.parse(account.nextSyncAt!) - at(2).getTime(), 15 * 60_000);
    h.google.reset();
    for (const trigger of ["auto", "manual", "push", "cron"] as const) {
      const skipped = await h.sync(5, { trigger });
      assert.deepEqual(skipped, { ok: false, error: "rate_limited", skipped: true }, trigger);
    }
    assert.equal(h.google.calls.length, 0, "no calls while Gmail asked us to wait");
    box.deliver({ from: "a@example.com", subject: "Later", text: "x" });
    const recovered = await h.sync(20);
    assert.equal(recovered.ok && recovered.added, 1);
    const healed = await h.account();
    assert.equal(healed.lastError, null);
    assert.equal(healed.failureCount, 0);
    assert.equal(healed.nextSyncAt, null);
  });

  it("retries transient failures with growing delays, lets a manual refresh through, and resets on success", async () => {
    await h.sync(0);
    h.google.failNext(503, "upstream down");
    assert.deepEqual(await h.sync(2), { ok: false, error: "sync_failed" });
    assert.equal((await h.account()).failureCount, 1);
    assert.equal(Date.parse((await h.account()).nextSyncAt!) - at(2).getTime(), 60_000);

    h.google.reset();
    assert.deepEqual(await h.sync(2.5, { trigger: "auto" }), { ok: false, error: "sync_failed", skipped: true });
    assert.equal(h.google.calls.length, 0, "background triggers wait out the backoff");

    h.google.failNext(500, "still down");
    assert.deepEqual(await h.sync(2.7, { trigger: "manual" }), { ok: false, error: "sync_failed" });
    assert.equal((await h.account()).failureCount, 2);
    assert.equal(Date.parse((await h.account()).nextSyncAt!) - at(2.7).getTime(), 120_000);

    box.deliver({ from: "a@example.com", subject: "Back", text: "x" });
    const ok = await h.sync(10);
    assert.equal(ok.ok && ok.added, 1);
    assert.equal((await h.account()).failureCount, 0);
  });

  it("reports an unusable Google client as a configuration error, not a reconnect", async () => {
    await h.sync(0);
    h.google.failNext(403, { error: { code: 403, message: "Gmail API has not been used in project 1 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] } });
    assert.deepEqual(await h.sync(2), { ok: false, error: "config_error" });
    const account = await h.account();
    assert.equal(account.status, "connected", "the user does not need to reconnect for an operator problem");
    assert.ok(account.tokenCiphertext);
    assert.equal(Date.parse(account.nextSyncAt!) - at(2).getTime(), 60 * 60_000);
  });

  it("runs only one sync per mailbox at a time", async () => {
    box.deliver({ from: "a@example.com", subject: "Only once", text: "x" });
    await h.sync(0);
    box.deliver({ from: "b@example.com", subject: "New", text: "y" });
    h.google.reset();
    const [one, two, three] = await Promise.all([h.sync(2), h.sync(2), h.sync(2)]);
    const results = [one, two, three];
    assert.equal(results.filter((result) => result.ok && !result.skipped).length, 1);
    assert.equal(h.google.count("/history"), 1);
    assert.equal((await inbox(h)).length, 2);
    assert.equal(h.alerts.length, 1);
  });

  it("does not resurrect a mailbox that was disconnected while a sync was running", async () => {
    box.deliver({ from: "a@example.com", subject: "A", text: "a" });
    const account = await h.account();
    const base = h.google.fetchImpl();
    const racing: typeof fetch = async (input, init) => {
      if (String(input).includes("/messages/")) {
        await h.store.deleteAccount(owner.organizationId, owner.userId);
      }
      return base(input, init);
    };
    const result = await syncGmailAccount({ account, store: h.store, env: TEST_ENV, now: at(0), fetchImpl: racing });
    assert.equal(result.ok, false);
    assert.equal(await h.store.getAccount(owner.organizationId, owner.userId), null);
    assert.equal((await inbox(h)).length, 0);
  });

  it("does not let a failing alert hook break the sync", async () => {
    await h.sync(0);
    box.deliver({ from: "a@example.com", subject: "Alert me", text: "x" });
    const result = await syncGmailAccount({
      account: await h.account(),
      store: h.store,
      env: TEST_ENV,
      now: at(2),
      fetchImpl: h.google.fetchImpl(),
      onCustomerEmail: async () => {
        throw new Error("notification store down");
      },
    });
    assert.equal(result.ok && result.added, 1);
    assert.equal((await inbox(h)).length, 1);
  });

  it("downloads attachments, even when Gmail changed the attachment id", async () => {
    box.deliver({
      from: "a@example.com",
      subject: "With file",
      text: "see attached",
      attachments: [{ filename: "quote.pdf", mimeType: "application/pdf", content: "PDF-BYTES" }],
    });
    await h.sync(0);
    const [row] = await inbox(h);
    const message = await h.store.getMessage(owner.organizationId, owner.userId, row!.id);
    const attachment = message!.attachments[0]!;
    assert.equal(attachment.filename, "quote.pdf");
    const tokens = openGmailTokens((await h.account()).tokenCiphertext!, TEST_ENV);
    const common = { tokens, env: TEST_ENV, gmailId: message!.gmailId, fetchImpl: h.google.fetchImpl() };
    const direct = await downloadGmailAttachment({ ...common, attachment });
    assert.equal(direct?.toString(), "PDF-BYTES");
    box.rotateAttachmentIds = true;
    // First fetch rotates the id server-side; the stored id is now stale.
    await h.google.fetchImpl()(`${TEST_ENV.apiBase}/messages/${message!.gmailId}?format=full`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const viaPartId = await downloadGmailAttachment({ ...common, attachment });
    assert.equal(viaPartId?.toString(), "PDF-BYTES", "found again through its stable part id");
  });
});

describe("gmail sync across users", () => {
  it("keeps each user's mail in their own account and never mixes mailboxes", async () => {
    const h = createHarness();
    const alice = { organizationId: "org_a", userId: "usr_alice" };
    const bob = { organizationId: "org_a", userId: "usr_bob" }; // same workspace
    const carol = { organizationId: "org_c", userId: "usr_carol" }; // another workspace
    for (const [email, who] of [["alice@gmail.com", alice], ["bob@gmail.com", bob], ["carol@gmail.com", carol]] as const) {
      await h.connect(email, who);
      h.google.mailbox(email).deliver({ from: "x@example.com", subject: `For ${email}`, text: `secret of ${email}` });
    }
    for (const who of [alice, bob, carol]) await h.sync(0, { owner: who });

    for (const [email, who] of [["alice@gmail.com", alice], ["bob@gmail.com", bob], ["carol@gmail.com", carol]] as const) {
      const rows = await h.store.listMessages(who.organizationId, who.userId);
      assert.deepEqual(rows.map((row) => row.subject), [`For ${email}`]);
      for (const other of [alice, bob, carol].filter((candidate) => candidate !== who)) {
        const otherRows = await h.store.listMessages(other.organizationId, other.userId);
        // Another user's message id resolves to nothing, whether in the same workspace or another.
        assert.equal(await h.store.getMessage(other.organizationId, other.userId, rows[0]!.id), null);
        assert.equal(await h.store.setRead(other.organizationId, other.userId, rows[0]!.id, true), false);
        assert.ok(!otherRows.some((row) => row.id === rows[0]!.id));
        assert.deepEqual(await h.store.listThread(other.organizationId, other.userId, rows[0]!.threadId), []);
      }
      assert.equal(await h.store.countUnread(who.organizationId, who.userId), 1);
    }
    // Reading as Bob changed nothing for Alice.
    const bobRow = (await h.store.listMessages(bob.organizationId, bob.userId))[0]!;
    await h.store.setRead(bob.organizationId, bob.userId, bobRow.id, true);
    assert.equal(await h.store.countUnread(alice.organizationId, alice.userId), 1);
    assert.equal(await h.store.countUnread(bob.organizationId, bob.userId), 0);

    // Disconnecting Bob removes only Bob's copy.
    await h.store.deleteAccount(bob.organizationId, bob.userId);
    assert.equal((await h.store.listMessages(bob.organizationId, bob.userId)).length, 0);
    assert.equal((await h.store.listMessages(alice.organizationId, alice.userId)).length, 1);
    assert.equal((await h.store.listMessages(carol.organizationId, carol.userId)).length, 1);
  });
});
