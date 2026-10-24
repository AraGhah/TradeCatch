# PostgreSQL idle socket errors

The Cloudflare capture includes a `CloudflareSocket._listen` unhandled rejection.
The screenshot truncates the underlying socket error, so it does not establish
the exact network failure. Source inspection found a concrete missing safeguard:
the shared PostgreSQL pool factory registered no pool `error` listener.

node-postgres forwards idle-client disconnection errors to the pool. With no
listener, Node's EventEmitter throws outside active query error handling. The
Cloudflare socket adapter's promise rejection can consequently become unhandled.
This is a separate defensive fix, not a claim that all historical socket errors
had the same cause.

All pool creation paths now install a synchronous idle-error listener: Node
servers, the Worker facade, invocation-scoped pools, and one-shot query/transaction
pools. It logs a structured event and a tightly bounded SQLSTATE/network code,
never the connection URL, password, provider token, or arbitrary driver message.
It does not write diagnostics into the same failed database, retry writes, replace
the failed client manually, or turn active query errors into successful results.
The driver's removal/reconnection behavior and existing invocation cleanup remain
in place.

Regression tests inject idle errors through every pool path without opening real
database sockets. They verify safe diagnostics, active-query rejection,
invocation isolation, connection reuse and cleanup. Existing PostgreSQL integration
tests independently cover real connections in CI. No schema/data migration is
needed; rollback is a normal reviewed code release.

Reference: [node-postgres pool error events](https://node-postgres.com/apis/pool#error).
