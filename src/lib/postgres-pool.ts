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

function managedPool(options: PoolConfig): Pool {
  const pool = new Pool(options);
  // pg forwards disconnected idle-client errors to the pool, after removing
  // that client. Without a listener EventEmitter throws outside query catches,
  // which can surface as an unhandled CloudflareSocket rejection. Do not retry
  // writes here or persist diagnostics through the failed database itself.
  pool.on("error", (error: Error & { code?: string }) => {
    const code = error.code;
    const safeCode =
      typeof code === "string" &&
      (/^[0-9A-Z]{5}$/.test(code) ||
        [
          "ECONNRESET",
          "ECONNREFUSED",
          "ETIMEDOUT",
          "EPIPE",
          "ENOTFOUND",
          "EHOSTUNREACH",
        ].includes(code))
        ? code
        : "UNKNOWN";
    console.error(
      JSON.stringify({
        event: "tradecatch.postgres.idle_error",
        code: safeCode,
      }),
    );
  });
  return pool;
}

/** Share connections only inside the current Worker invocation. Reopening a
 * socket for every SQL statement exhausts the platform's subrequest budget. */
export async function withPostgresRequestScope<T>(
  run: () => Promise<T>,
): Promise<T> {
  const existing = requestPools.getStore();
  if (existing && !existing.closed) return run();
  const state: RequestPools = { pools: new Map(), closed: false };
  return requestPools.run(state, async () => {
    try {
      return await run();
    } finally {
      state.closed = true;
      const closed = await Promise.allSettled(
        [...state.pools.values()].map((pool) => pool.end()),
      );
      if (closed.some((result) => result.status === "rejected"))
        console.error("[postgres] Invocation connection cleanup failed");
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
