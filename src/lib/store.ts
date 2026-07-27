/**
 * Tiny key/value store used by rate limiting and idempotency.
 *
 * Default: in-memory (single Node process). For multi-instance / serverless
 * production, swap `createMemoryStore` for an Upstash Redis / Vercel KV
 * implementation without touching call sites.
 */

export type TimedStore = {
  get(key: string): number | undefined;
  set(key: string, value: number): void;
  has(key: string): boolean;
  delete(key: string): void;
  /** Drop entries whose stored timestamp is older than `maxAgeMs`. */
  prune(maxAgeMs: number, now?: number): void;
  entries(): IterableIterator<[string, number]>;
};

export function createMemoryStore(): TimedStore {
  const map = new Map<string, number>();

  return {
    get(key) {
      return map.get(key);
    },
    set(key, value) {
      map.set(key, value);
    },
    has(key) {
      return map.has(key);
    },
    delete(key) {
      map.delete(key);
    },
    prune(maxAgeMs, now = Date.now()) {
      for (const [key, value] of map) {
        if (now - value > maxAgeMs) map.delete(key);
      }
    },
    entries() {
      return map.entries();
    },
  };
}
