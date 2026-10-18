import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createId } from "../../src/lib/id";
import { createPostgresGmailStore } from "../../src/product/gmail/postgres-store";
import { createMemoryGmailStore, type GmailStore } from "../../src/product/gmail/store";
import type { GmailAccount, GmailMessage } from "../../src/product/gmail/types";

/**
 * One contract, two implementations. The memory store runs everywhere; the
 * Postgres store runs when GMAIL_TEST_DATABASE_URL points at a database that
 * has had `npm run db:schema` applied (use a throwaway one, never production).
 */
const PG_URL = process.env.GMAIL_TEST_DATABASE_URL?.trim();

const run = Math.random().toString(36).slice(2, 8);
const org = (name: string) => `org_${name}_${run}`;
const usr = (name: string) => `usr_${name}_${run}`;

function account(over: Partial<GmailAccount> & Pick<GmailAccount, "organizationId" | "userId">): GmailAccount {
  const now = new Date().toISOString();
  return {
    id: createId("gac"),
    email: `${over.userId}@gmail.com`,
    status: "connected",
    tokenCiphertext: "sealed",
    historyId: null,
    watchExpiration: null,
    lastSyncAt: null,
    lastAttemptAt: null,
    nextSyncAt: null,
    failureCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

let counter = 0;
function message(
  owner: GmailAccount,
  over: Partial<Omit<GmailMessage, "id" | "createdAt">> = {},
): Omit<GmailMessage, "id" | "createdAt"> {
  counter += 1;
  return {
    organizationId: owner.organizationId,
    userId: owner.userId,
    accountId: owner.id,
    gmailId: `g${run}${counter}`,
    threadId: `t${run}${counter}`,
    fromName: "Marie",
    fromEmail: "marie@example.com",
    subject: `Subject ${counter}`,
    snippet: `snippet ${counter}`,
    bodyText: `body ${counter}`,
    receivedAt: new Date(Date.UTC(2026, 9, 1, 12, 0, counter)).toISOString(),
    unread: true,
    hasAttachments: false,
    attachments: [],
    important: true,
    direction: "inbound",
    ...over,
  };
}

function contract(name: string, make: () => GmailStore, options: { skip?: string } = {}) {
  describe(`gmail store: ${name}`, { skip: options.skip }, () => {
    let store: GmailStore;
    const a = account({ organizationId: org("a"), userId: usr("alice") });
    const b = account({ organizationId: org("a"), userId: usr("bob") });
    const c = account({ organizationId: org("c"), userId: usr("carol") });

    before(async () => {
      store = make();
      for (const row of [a, b, c]) await store.saveAccount(row);
    });
    after(async () => {
      for (const row of [a, b, c]) await store.deleteAccount(row.organizationId, row.userId);
    });

    it("finds an account only for its own organization and user", async () => {
      assert.equal((await store.getAccount(a.organizationId, a.userId))?.id, a.id);
      assert.equal(await store.getAccount(a.organizationId, b.userId + "x"), null);
      assert.equal(await store.getAccount(c.organizationId, a.userId), null);
    });

    it("de-duplicates by (account, gmail id) and reports whether the row was new", async () => {
      const row = message(a, { subject: "First", bodyText: "original" });
      const first = await store.upsertMessage(row);
      const again = await store.upsertMessage({ ...row, subject: "Edited", bodyText: null });
      assert.equal(first.inserted, true);
      assert.equal(again.inserted, false);
      assert.equal(again.message.id, first.message.id);
      assert.equal(again.message.subject, "Edited");
      assert.equal(again.message.bodyText, "original", "a missing body never wipes a stored one");
      const stored = (await store.listMessages(a.organizationId, a.userId)).filter((m) => m.threadId === row.threadId);
      assert.equal(stored.length, 1);
    });

    it("keeps local read state when the same message is stored again", async () => {
      const row = message(a);
      const { message: saved } = await store.upsertMessage(row);
      await store.setRead(a.organizationId, a.userId, saved.id, true);
      await store.upsertMessage({ ...row, unread: true });
      assert.equal((await store.getMessage(a.organizationId, a.userId, saved.id))?.unread, false);
    });

    it("answers existence and thread questions without loading mail", async () => {
      const row = message(a);
      await store.upsertMessage(row);
      const known = await store.existingGmailIds(a.id, [row.gmailId, "nope"]);
      assert.deepEqual([...known], [row.gmailId]);
      assert.equal((await store.existingGmailIds(a.id, [])).size, 0);
      assert.equal(await store.threadKnown(a.id, row.threadId), true);
      assert.equal(await store.threadKnown(a.id, "unknown-thread"), false);
      assert.equal(await store.threadKnown(b.id, row.threadId), false, "another account's thread is not known");
    });

    it("never shows one user's mail to another, in the same workspace or a different one", async () => {
      const mine = await store.upsertMessage(message(b, { subject: "Bob only" }));
      for (const other of [a, c]) {
        const rows = await store.listMessages(other.organizationId, other.userId);
        assert.ok(!rows.some((row) => row.id === mine.message.id));
        assert.equal(await store.getMessage(other.organizationId, other.userId, mine.message.id), null);
        assert.equal(await store.setRead(other.organizationId, other.userId, mine.message.id, true), false);
        assert.deepEqual(await store.listThread(other.organizationId, other.userId, mine.message.threadId), []);
      }
      assert.equal((await store.getMessage(b.organizationId, b.userId, mine.message.id))?.unread, true);
    });

    it("lists newest first, filters, searches (including wildcards literally) and pages by cursor", async () => {
      const p = account({ organizationId: org("p"), userId: usr("pager") });
      await store.saveAccount(p);
      for (let i = 0; i < 7; i += 1) {
        await store.upsertMessage(
          message(p, {
            subject: i === 3 ? "50% off_now" : `Item ${i}`,
            receivedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
            unread: i % 2 === 0,
            important: i % 3 === 0,
            hasAttachments: i === 5,
            bodyText: i === 6 ? "the magic word is zebra" : "plain",
          }),
        );
      }
      await store.upsertMessage(message(p, { subject: "Sent by me", direction: "outbound", unread: false }));
      const all = await store.listMessages(p.organizationId, p.userId, { limit: 100 });
      assert.equal(all.length, 7, "outbound mail is not in the inbox");
      assert.deepEqual(all.map((row) => row.subject), ["Item 6", "Item 5", "Item 4", "50% off_now", "Item 2", "Item 1", "Item 0"]);
      assert.equal((await store.listMessages(p.organizationId, p.userId, { unread: true })).length, 4);
      assert.equal((await store.listMessages(p.organizationId, p.userId, { important: true })).length, 3);
      assert.deepEqual((await store.listMessages(p.organizationId, p.userId, { attachments: true })).map((r) => r.subject), ["Item 5"]);
      assert.deepEqual((await store.listMessages(p.organizationId, p.userId, { q: "ZEBRA" })).map((r) => r.subject), ["Item 6"]);
      assert.deepEqual((await store.listMessages(p.organizationId, p.userId, { q: "%" })).map((r) => r.subject), ["50% off_now"]);
      assert.deepEqual((await store.listMessages(p.organizationId, p.userId, { q: "_now" })).map((r) => r.subject), ["50% off_now"]);
      assert.equal((await store.listMessages(p.organizationId, p.userId, { q: "'; DROP TABLE tc_gmail_messages; --" })).length, 0);

      const page1 = await store.listMessages(p.organizationId, p.userId, { limit: 3 });
      const last = page1[2]!;
      const page2 = await store.listMessages(p.organizationId, p.userId, { limit: 3, before: { receivedAt: last.receivedAt, id: last.id } });
      assert.deepEqual([...page1, ...page2].map((r) => r.subject), all.slice(0, 6).map((r) => r.subject));
      assert.equal(await store.countUnread(p.organizationId, p.userId), 4);
      await store.deleteAccount(p.organizationId, p.userId);
    });

    it("keeps equal timestamps stable across pages", async () => {
      const p = account({ organizationId: org("tie"), userId: usr("tie") });
      await store.saveAccount(p);
      const same = new Date(Date.UTC(2026, 8, 2)).toISOString();
      for (let i = 0; i < 5; i += 1) await store.upsertMessage(message(p, { receivedAt: same }));
      const seen = new Set<string>();
      let before: { receivedAt: string; id: string } | undefined;
      for (let round = 0; round < 5; round += 1) {
        const rows = await store.listMessages(p.organizationId, p.userId, { limit: 2, before });
        if (rows.length === 0) break;
        for (const row of rows) seen.add(row.id);
        before = { receivedAt: rows[rows.length - 1]!.receivedAt, id: rows[rows.length - 1]!.id };
      }
      assert.equal(seen.size, 5, "every row appears exactly once");
      await store.deleteAccount(p.organizationId, p.userId);
    });

    it("updates only the fields it is given and never re-creates a removed account", async () => {
      const p = account({ organizationId: org("u"), userId: usr("upd"), historyId: "100", lastError: "sync_failed" });
      await store.saveAccount(p);
      assert.equal(await store.updateAccount(p.id, { historyId: "200", lastError: null, failureCount: 0 }), true);
      const after = await store.getAccount(p.organizationId, p.userId);
      assert.equal(after?.historyId, "200");
      assert.equal(after?.lastError, null);
      assert.equal(after?.tokenCiphertext, "sealed", "untouched fields survive");
      assert.equal(after?.email, p.email);
      await store.deleteAccount(p.organizationId, p.userId);
      assert.equal(await store.updateAccount(p.id, { lastError: "x" }), false);
      assert.equal(await store.getAccount(p.organizationId, p.userId), null);
    });

    it("lets exactly one caller hold the sync lease until it expires or is released", async () => {
      const p = account({ organizationId: org("l"), userId: usr("lease") });
      await store.saveAccount(p);
      const now = new Date();
      const results = await Promise.all([1, 2, 3, 4].map(() => store.tryBeginSync(p.id, now, 60_000)));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await store.tryBeginSync(p.id, new Date(now.getTime() + 30_000), 60_000), false);
      assert.equal(await store.tryBeginSync(p.id, new Date(now.getTime() + 61_000), 60_000), true, "an expired lease can be taken over");
      await store.endSync(p.id);
      assert.equal(await store.tryBeginSync(p.id, now, 60_000), true);
      assert.equal(await store.tryBeginSync("missing-account", now, 60_000), false);
      await store.deleteAccount(p.organizationId, p.userId);
    });

    it("picks due accounts oldest-attempt first and skips backed-off, leased and disconnected ones", async () => {
      const mk = (name: string, over: Partial<GmailAccount>) =>
        account({ organizationId: org("due"), userId: usr(name), ...over });
      const now = new Date("2026-10-18T12:00:00Z");
      const stale = new Date(now.getTime() - 10 * 60_000).toISOString();
      const rows = [
        mk("never", { lastAttemptAt: null }),
        mk("old", { lastAttemptAt: new Date(now.getTime() - 3_600_000).toISOString() }),
        mk("fresh", { lastAttemptAt: new Date(now.getTime() - 60_000).toISOString() }),
        mk("backoff", { lastAttemptAt: new Date(now.getTime() - 3_600_000).toISOString(), nextSyncAt: new Date(now.getTime() + 60_000).toISOString() }),
        mk("reconnect", { status: "needs_reconnect", tokenCiphertext: null }),
        mk("leased", { lastAttemptAt: null }),
      ];
      for (const row of rows) await store.saveAccount(row);
      await store.tryBeginSync(rows[5]!.id, now, 60_000);
      const due = await store.listAccountsDue({ nowIso: now.toISOString(), staleBeforeIso: stale, limit: 10 });
      const ids = new Set(rows.map((row) => row.id));
      assert.deepEqual(
        due.filter((row) => ids.has(row.id)).map((row) => row.userId.split("_")[1]),
        ["never", "old"],
      );
      assert.equal((await store.listAccountsDue({ nowIso: now.toISOString(), staleBeforeIso: stale, limit: 1 })).length, 1);
      for (const row of rows) await store.deleteAccount(row.organizationId, row.userId);
    });

    it("finds every connected account for an address, case-insensitively", async () => {
      const one = account({ organizationId: org("e1"), userId: usr("e1"), email: `Shared.${run}@Gmail.com` });
      const two = account({ organizationId: org("e2"), userId: usr("e2"), email: `shared.${run}@gmail.com` });
      const gone = account({ organizationId: org("e3"), userId: usr("e3"), email: `shared.${run}@gmail.com`, status: "needs_reconnect" });
      for (const row of [one, two, gone]) await store.saveAccount(row);
      const found = await store.findAccountsByEmail(`SHARED.${run}@GMAIL.COM`);
      assert.deepEqual(found.map((row) => row.id).sort(), [one.id, two.id].sort());
      for (const row of [one, two, gone]) await store.deleteAccount(row.organizationId, row.userId);
    });

    it("syncs read state and removals by Gmail id, inbound only", async () => {
      const p = account({ organizationId: org("s"), userId: usr("sync") });
      await store.saveAccount(p);
      const inbound = message(p);
      const outbound = message(p, { direction: "outbound", unread: false });
      await store.upsertMessage(inbound);
      await store.upsertMessage(outbound);
      await store.setUnreadByGmailId(p.id, inbound.gmailId, false);
      await store.setUnreadByGmailId(p.id, outbound.gmailId, true);
      assert.equal(await store.countUnread(p.organizationId, p.userId), 0, "outbound mail is never unread");
      await store.deleteByGmailIds(p.id, [inbound.gmailId, "unknown"]);
      assert.equal((await store.existingGmailIds(p.id, [inbound.gmailId, outbound.gmailId])).size, 1);
      await store.deleteByGmailIds(p.id, []);
      await store.deleteAccount(p.organizationId, p.userId);
    });

    it("stores and returns attachments with their stable part ids", async () => {
      const p = account({ organizationId: org("at"), userId: usr("att") });
      await store.saveAccount(p);
      const attachments = [{ filename: "quote.pdf", mimeType: "application/pdf", size: 10, attachmentId: "a1", partId: "2" }];
      const { message: saved } = await store.upsertMessage(message(p, { hasAttachments: true, attachments }));
      assert.deepEqual((await store.getMessage(p.organizationId, p.userId, saved.id))?.attachments, attachments);
      await store.deleteAccount(p.organizationId, p.userId);
    });

    it("deleting an account deletes its mail, and only its mail", async () => {
      const x = account({ organizationId: org("x"), userId: usr("x") });
      const y = account({ organizationId: org("x"), userId: usr("y") });
      await store.saveAccount(x);
      await store.saveAccount(y);
      const mx = await store.upsertMessage(message(x));
      const my = await store.upsertMessage(message(y));
      await store.deleteAccount(x.organizationId, x.userId);
      assert.equal(await store.getMessage(x.organizationId, x.userId, mx.message.id), null);
      assert.ok(await store.getMessage(y.organizationId, y.userId, my.message.id));
      await store.clearMessages(y.id);
      assert.equal(await store.getMessage(y.organizationId, y.userId, my.message.id), null);
      assert.ok(await store.getAccount(y.organizationId, y.userId), "clearing mail keeps the connection");
      await store.deleteAccount(y.organizationId, y.userId);
    });

    it("refuses mail for an account that no longer exists", async () => {
      const ghost = account({ organizationId: org("g"), userId: usr("ghost") });
      await assert.rejects(store.upsertMessage(message(ghost)));
    });
  });
}

contract("memory", () => createMemoryGmailStore());
contract("postgres", () => createPostgresGmailStore(PG_URL!), {
  skip: PG_URL ? undefined : "set GMAIL_TEST_DATABASE_URL to run against Postgres",
});

after(async () => {
  if (PG_URL) await (await import("../../src/product/missed-call/postgres-store")).closePgPool();
});
