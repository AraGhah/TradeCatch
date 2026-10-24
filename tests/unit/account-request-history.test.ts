import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemorySupportStore } from "../../src/product/support/store";
import { createSupportService } from "../../src/product/support/service";

it("returns recent account requests only for the requested organization without changing service", async () => {
  const store = createMemorySupportStore();
  let now = new Date("2026-10-20T10:00:00Z");
  const service = createSupportService({ store, now: () => now });
  const first = await service.requestAccountChange("org-a", "suspension");
  now = new Date("2026-10-21T10:00:00Z");
  const second = await service.requestAccountChange("org-a", "reactivation");
  await service.requestAccountChange("org-b", "deletion");
  assert.deepEqual(await service.accountRequests("org-a", 1), [second]);
  assert.equal((await service.accountRequests("org-a")).length, 2);
  assert.equal(first.status, "requested");
  assert.equal(first.phoneRouting, "unchanged_until_transition");
  assert.equal(second.status, "requested");
});
