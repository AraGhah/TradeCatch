import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { hashToken, newId, randomToken } from "../../../src/product/saas/ids";
import type { SaasStore } from "../../../src/product/saas/store";
import type { PasswordToken } from "../../../src/product/saas/types";

/**
 * One set of assertions about how reset links are stored, run against every
 * store (memory, and real PostgreSQL when a disposable database is given).
 * "Atomic" and "all or nothing" are claims about the store, so they are tested
 * where the SQL actually runs, not only against the in-memory twin.
 */
export type TokenHarness = {
  store: SaasStore;
  newUser(): Promise<{ userId: string; organizationId: string }>;
};

const MIN = 60_000;

function stamp(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function tokenFor(
  userId: string,
  kind: PasswordToken["kind"],
  ttlMs = 30 * MIN,
  createdAt = new Date(),
) {
  const raw = randomToken(32);
  const token: PasswordToken = {
    id: newId("pwt"),
    userId,
    tokenHash: hashToken(raw),
    kind,
    expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    createdAt: createdAt.toISOString(),
  };
  return { raw, token };
}

async function openTokens(store: SaasStore, hashes: string[]) {
  const states = await Promise.all(hashes.map((h) => store.findPasswordToken(h)));
  return states.filter((t) => t && !t.consumedAt);
}

async function sessionFor(h: TokenHarness, user: { userId: string; organizationId: string }) {
  const id = newId("ses");
  await h.store.createSession({
    id,
    userId: user.userId,
    organizationId: user.organizationId,
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * MIN).toISOString(),
    createdAt: stamp(),
  });
  return id;
}

export function describePasswordTokenContract(
  name: string,
  open: () => Promise<TokenHarness>,
) {
  describe(name, () => {
    it("a newer link replaces the older unused link of the same kind", async () => {
      const h = await open();
      const user = await h.newUser();
      const first = tokenFor(user.userId, "reset");
      const second = tokenFor(user.userId, "reset", 30 * MIN, new Date(Date.now() + 5));
      await h.store.replacePasswordToken(first.token);
      await h.store.replacePasswordToken(second.token);

      const old = await h.store.findPasswordToken(first.token.tokenHash);
      assert.ok(old?.consumedAt, "the older link is cancelled");
      assert.equal(
        await h.store.consumePasswordToken(first.token.tokenHash, stamp(10)),
        null,
        "and can no longer be spent",
      );
      assert.ok(
        await h.store.consumePasswordToken(second.token.tokenHash, stamp(10)),
        "the newest link works",
      );
    });

    it("replacing a reset link leaves other kinds and other people alone", async () => {
      const h = await open();
      const user = await h.newUser();
      const other = await h.newUser();
      const invite = tokenFor(user.userId, "activation", 7 * 24 * 60 * MIN);
      const theirs = tokenFor(other.userId, "reset");
      const mine = tokenFor(user.userId, "reset");
      await h.store.replacePasswordToken(invite.token);
      await h.store.replacePasswordToken(theirs.token);
      await h.store.replacePasswordToken(mine.token);

      const open_ = await openTokens(h.store, [
        invite.token.tokenHash,
        theirs.token.tokenHash,
        mine.token.tokenHash,
      ]);
      assert.equal(open_.length, 3);
    });

    it("simultaneous requests for one person leave exactly one live link", async () => {
      const h = await open();
      const user = await h.newUser();
      const issued = Array.from({ length: 10 }, () => tokenFor(user.userId, "reset"));
      await Promise.all(issued.map((t) => h.store.replacePasswordToken(t.token)));
      const live = await openTokens(
        h.store,
        issued.map((t) => t.token.tokenHash),
      );
      assert.equal(live.length, 1, "only one of ten simultaneous links stays live");
    });

    it("finishing a link changes everything or nothing", async () => {
      const h = await open();
      const user = await h.newUser();
      const a = await sessionFor(h, user);
      const b = await sessionFor(h, user);
      const link = tokenFor(user.userId, "reset");
      const invite = tokenFor(user.userId, "activation", 7 * 24 * 60 * MIN);
      await h.store.replacePasswordToken(link.token);
      await h.store.replacePasswordToken(invite.token);

      const at = stamp(1000);
      const done = await h.store.completePasswordReset({
        tokenHash: link.token.tokenHash,
        atIso: at,
        passwordHash: "scrypt$test$hash-one",
      });
      assert.equal(done?.userId, user.userId);
      assert.equal(done?.kind, "reset");

      const credential = await h.store.getPasswordCredential(user.userId);
      assert.equal(credential?.hash, "scrypt$test$hash-one");
      assert.ok((await h.store.getSession(a))?.revokedAt, "session one signed out");
      assert.ok((await h.store.getSession(b))?.revokedAt, "session two signed out");
      assert.equal(
        (await openTokens(h.store, [link.token.tokenHash, invite.token.tokenHash])).length,
        0,
        "no link of any kind stays live",
      );
    });

    it("of simultaneous submissions of one link, exactly one wins", async () => {
      const h = await open();
      const user = await h.newUser();
      const link = tokenFor(user.userId, "reset");
      await h.store.replacePasswordToken(link.token);
      const at = stamp(500);

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          h.store.completePasswordReset({
            tokenHash: link.token.tokenHash,
            atIso: at,
            passwordHash: `scrypt$race$hash-${i}`,
          }),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1, "one winner");
      const stored = await h.store.getPasswordCredential(user.userId);
      assert.match(stored?.hash ?? "", /^scrypt\$race\$hash-\d$/);
    });

    it("an expired, used or unknown link changes nothing", async () => {
      const h = await open();
      const user = await h.newUser();
      const session = await sessionFor(h, user);
      const link = tokenFor(user.userId, "reset", 1000);
      await h.store.replacePasswordToken(link.token);

      // At the very instant of expiry the link is already dead.
      assert.equal(
        await h.store.completePasswordReset({
          tokenHash: link.token.tokenHash,
          atIso: link.token.expiresAt,
          passwordHash: "scrypt$late$hash",
        }),
        null,
      );
      assert.equal(
        await h.store.completePasswordReset({
          tokenHash: hashToken(randomBytes(8).toString("hex")),
          atIso: stamp(),
          passwordHash: "scrypt$unknown$hash",
        }),
        null,
      );
      assert.equal(await h.store.getPasswordCredential(user.userId), null);
      assert.equal((await h.store.getSession(session))?.revokedAt, undefined);

      // A millisecond earlier it still works.
      assert.ok(
        await h.store.completePasswordReset({
          tokenHash: link.token.tokenHash,
          atIso: new Date(Date.parse(link.token.expiresAt) - 1).toISOString(),
          passwordHash: "scrypt$ontime$hash",
        }),
      );
      assert.equal(
        await h.store.completePasswordReset({
          tokenHash: link.token.tokenHash,
          atIso: stamp(),
          passwordHash: "scrypt$again$hash",
        }),
        null,
        "a used link cannot be used again",
      );
      assert.equal(
        (await h.store.getPasswordCredential(user.userId))?.hash,
        "scrypt$ontime$hash",
      );
    });
  });
}
