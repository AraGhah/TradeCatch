import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearTenantCacheForTests,
  readTenantCache,
  writeTenantCache,
} from "../../src/lib/tenant-cache";

describe("tenant cache", () => {
  beforeEach(() => clearTenantCacheForTests());

  it("keeps one organization's dashboard stats away from another", () => {
    writeTenantCache("org-a", "home", { leads: 4 }, 1_000);
    writeTenantCache("org-b", "home", { leads: 9 }, 1_000);
    assert.deepEqual(readTenantCache("org-a", "home", 20_000, 1_500), { leads: 4 });
    assert.deepEqual(readTenantCache("org-b", "home", 20_000, 1_500), { leads: 9 });
    assert.equal(readTenantCache("org-c", "home", 20_000, 1_500), undefined);
    assert.equal(readTenantCache("", "home", 20_000, 1_500), undefined);
  });

  it("expires after the ttl", () => {
    writeTenantCache("org-a", "home", { leads: 1 }, 1_000);
    assert.equal(readTenantCache("org-a", "home", 20_000, 21_001), undefined);
  });
});
