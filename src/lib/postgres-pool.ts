import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolConfig } from "pg";

type RequestPools = { pools: Map<Pool, Pool>; closed: boolean };
// The Worker entrypoint and the generated Next server are separate bundles.
// Share the context carrier so both bundles see the same invocation scope.
const globalForPostgres = globalThis as unknown as {
  __tradecatchPostgresRequestPools?: AsyncLocalStorage<RequestPools>;
};
const requestPools = (globalForPostgres.__tradecatchPostgresRequestPools ??=
  new AsyncLocalStorage<RequestPools>());

const SAFE_NETWORK_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EHOSTUNREACH",
];

/**
 * A database error's code, safe to log: a five-character Postgres SQLSTATE
 * (`42P01` = table missing, `42703` = column missing, `28P01` = bad password)
 * or a known network code. Never the driver message, which can quote
 * connection strings or row values.
 */
export function safeDatabaseErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return undefined;
  return /^[0-9A-Z]{5}$/.test(code) || SAFE_NETWORK_CODES.includes(code)
    ? code
    : undefined;
}

function managedPool(options: PoolConfig): Pool {
  const pool = new Pool(options);
  // pg forwards disconnected idle-client errors to the pool, after removing
  // that client. Without a listener EventEmitter throws outside query catches,
  // which can surface as an unhandled CloudflareSocket rejection. Do not retry
  // writes here or persist diagnostics through the failed database itself.
  pool.on("error", (error: Error & { code?: string }) => {
    console.error(
      JSON.stringify({
        event: "tradecatch.postgres.idle_error",
        code: safeDatabaseErrorCode(error) ?? "UNKNOWN",
      }),
    );
  });
  return pool;
}

/** Share connections only inside the current Worker invocation. Reopening a
 * socket for every SQL statement exhausts the platform's subrequest budget. */
export async function withPostgresRequestScope<T>(
  run: () => Promise<T>,
  options: { independent?: boolean } = {},
): Promise<T> {
  const existing = requestPools.getStore();
  if (existing && !existing.closed && !options.independent) return run();
  const state: RequestPools = { pools: new Map(), closed: false };
  return requestPools.run(state, async () => {
    try {
      return await run();
    } finally {
      state.closed = true;
      const poolCount = state.pools.size;
      const cleanupStartedAt = Date.now();
      const closed = await Promise.allSettled(
        [...state.pools.values()].map((pool) => pool.end()),
      );
      const cleanupDurationMs = Date.now() - cleanupStartedAt;
      if (closed.some((result) => result.status === "rejected"))
        console.error(
          JSON.stringify({
            event: "tradecatch.postgres.cleanup_failed",
            poolCount,
            cleanupDurationMs,
          }),
        );
      else if (cleanupDurationMs > 1000)
        // pool.end() should be near-instant once queries drain; a slow
        // cleanup here is itself evidence of a stuck socket, not just noise.
        console.warn(
          JSON.stringify({
            event: "tradecatch.postgres.cleanup_slow",
            poolCount,
            cleanupDurationMs,
          }),
        );
    }
  });
}

/**
 * Workers sockets belong to the invocation that opened them. Cached stores
 * retain this facade, never a live socket across invocations. Streaming work
 * continuing after its scope closes uses an independent one-shot connection.
 * Node servers retain their ordinary connection pooling.
 */
export function createPostgresPool(options: PoolConfig): Pool {
  const target = managedPool(options);
  if (!("WebSocketPair" in globalThis)) return target;

  function currentPool(): Pool | undefined {
    const scope = requestPools.getStore();
    if (!scope || scope.closed) return undefined;
    let scoped = scope.pools.get(target);
    if (!scoped) {
      scoped = managedPool(options);
      scope.pools.set(target, scoped);
    }
    return scoped;
  }

  return new Proxy(target, {
    get(pool, property, receiver) {
      if (property === "query") {
        return async (...args: unknown[]) => {
          const current = currentPool();
          if (current) return Reflect.apply(current.query, current, args);
          const scoped = managedPool(options);
          try {
            return await Reflect.apply(scoped.query, scoped, args);
          } finally {
            await scoped.end();
          }
        };
      }
      if (property === "connect") {
        return async () => {
          const current = currentPool();
          if (current) return current.connect();
          const scoped = managedPool(options);
          try {
            const client = await scoped.connect();
            const release = client.release.bind(client);
            client.release = () => {
              release(true);
              void scoped.end().catch(() => {
                console.error("[postgres] Request connection cleanup failed");
              });
            };
            return client;
          } catch (error) {
            await scoped.end();
            throw error;
          }
        };
      }
      return Reflect.get(pool, property, receiver);
    },
  });
}

let sharedPool: Pool | null = null;

/**
 * The application's shared pool. The first connection string wins; every
 * durable store passes the same `DATABASE_URL`.
 */
export function getPgPool(connectionString: string): Pool {
  if (!sharedPool) {
    sharedPool = createPostgresPool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return sharedPool;
}

/**
 * Test seam: lets a suite run the real billing SQL against an in-process
 * PostgreSQL (see tests/support/pglite-pool.ts). Application code never calls
 * it; pass null afterwards to restore the normal lazy pool.
 */
export function setPgPoolForTests(next: Pool | null): void {
  sharedPool = next;
}

export async function closePgPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}

/**
 * A lazily filled `connection string -> pool` cache for one store module.
 * Each call returns its own cache, so every store keeps its own pool (and its
 * own `max` connections) exactly as when each module kept a private Map.
 */
export function createPostgresPoolCache(
  options: Omit<PoolConfig, "connectionString"> = {},
): (connectionString: string) => Pool {
  const pools = new Map<string, Pool>();
  return (connectionString) => {
    let pool = pools.get(connectionString);
    if (!pool) {
      pool = createPostgresPool({ ...options, connectionString });
      pools.set(connectionString, pool);
    }
    return pool;
  };
}
