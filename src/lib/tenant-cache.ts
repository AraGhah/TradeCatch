type Entry<T> = { at: number; value: T };

const buckets = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 200;

function keyFor(organizationId: string, name: string) {
  return `${organizationId}\0${name}`;
}

/** Short-lived value scoped to one organization. A missing or different id never hits. */
export function readTenantCache<T>(
  organizationId: string,
  name: string,
  ttlMs: number,
  now = Date.now(),
): T | undefined {
  if (!organizationId) return undefined;
  const hit = buckets.get(keyFor(organizationId, name)) as Entry<T> | undefined;
  if (!hit) return undefined;
  if (now - hit.at > ttlMs) {
    buckets.delete(keyFor(organizationId, name));
    return undefined;
  }
  return hit.value;
}

export function writeTenantCache<T>(
  organizationId: string,
  name: string,
  value: T,
  now = Date.now(),
): void {
  if (!organizationId) return;
  const key = keyFor(organizationId, name);
  if (buckets.size >= MAX_ENTRIES && !buckets.has(key)) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
  buckets.set(key, { at: now, value });
}

export function clearTenantCacheForTests() {
  buckets.clear();
}
