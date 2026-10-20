import { Pool, type PoolConfig } from "pg";

/**
 * Workers sockets belong to the request that opened them. Cached stores may
 * retain this facade, but must never retain a live socket across requests.
 * Node servers keep their ordinary connection pooling.
 */
export function createPostgresPool(options: PoolConfig): Pool {
  const target = new Pool(options);
  if (!("WebSocketPair" in globalThis)) return target;

  return new Proxy(target, {
    get(pool, property, receiver) {
      if (property === "query") {
        return async (...args: unknown[]) => {
          const scoped = new Pool(options);
          try {
            return await Reflect.apply(scoped.query, scoped, args);
          } finally {
            await scoped.end();
          }
        };
      }
      if (property === "connect") {
        return async () => {
          const scoped = new Pool(options);
          try {
            const client = await scoped.connect();
            const release = client.release.bind(client);
            client.release = () => {
              // Destroy rather than returning this transaction's connection to
              // a pool that another Worker invocation could subsequently use.
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
