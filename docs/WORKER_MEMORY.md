# Worker memory and Cloudflare Error 1102

## Symptom

Pages and APIs on tradecatch.ca intermittently answer with Cloudflare's plain
text `error code: 1102` ("Worker exceeded resource limits", HTTP 503), or hang.
It is not tied to a route: `/health` fails as readily as `/pricing`. It shows up
in analytics as `status = exceededResources`, with a CPU time of about 10 ms and
a wall time of about 14 ms (the isolate is killed almost immediately), on warm
isolates whose reported memory sits at the ~99 MiB ceiling.

## Root cause (2026-11-13, KAN-10)

The Worker runs in an isolate limited to 128 MiB. The deployed script is one
27 MB JavaScript file, and the runtime keeps that script as a single string in
the isolate heap. V8 stores a string one byte per character only when every
character is U+00FF or lower; one character above that makes V8 store the whole
string as UTF-16, two bytes per character.

204 characters did that: curly apostrophes, ellipses, en dashes, zero-width
characters, combining marks and fullwidth symbols inside **regular expression
literals** in our receptionist/CRM text code (esbuild escapes non-ASCII in string
literals but prints regex literals verbatim), plus two em dashes in **comments**
in `pg-protocol` and `zod`.

A heap snapshot of an idle isolate showed 51.7 MiB of the 66.2 MiB live heap was
that single string. Fixing the encoding alone took the same bundle from 67.8 to
40.8 MiB idle with byte-identical page output. That left too little room to
render pages (each render adds several MiB of garbage), so isolates were killed
under ordinary traffic: 239 killed requests on 2026-11-12, 189 on 2026-11-09,
kills on 13 of the 22 days measured (Oct 23 to Nov 13). The baseline had also crept from 57 MiB
(Oct 23) to 82 MiB as the app grew, which is why it got worse over time.

Not the cause (tested and ruled out): `experimental.preloadEntriesOnStart`
(identical heap), Workers Free plan CPU limits (the gzipped bundle is 4 MB,
above the Free plan's 3 MiB cap), and the database layer.

## What prevents it now

| Layer | What it does |
| --- | --- |
| `src/**` regex literals | Written with `\uXXXX` escapes. |
| `wrangler.jsonc` `minify: true` | Drops third-party comments (and shrinks the upload from 26.5 to 18.2 MB). |
| `tests/unit/worker-memory-guards.test.ts` | Fails `npm run test:unit` if any regex literal in `src` contains a character above U+00FF, naming file and line. |
| `scripts/check-worker-bundle-encoding.js` | Fails `npm run check:cloudflare-bundle` (run in CI after the Cloudflare build, and required green before `npm run deploy`) if the real bundle contains any character above U+00FF, with module and context. |
| `src/lib/worker-fetch-guard.ts` | If an exception escapes the Worker's `fetch`, logs `tradecatch.worker.fetch_failed` (method and path only, credentials redacted) and returns a retryable 503. It cannot catch Error 1102, which kills the isolate from outside the script. |

If the bundle check fails, write the character as `\uXXXX` in source. If it
names a dependency, check that `minify` is still `true`; a dependency that puts
the character in code (not a comment) needs an escape upstream or an alias.

## Detecting it in production

Dashboard: Workers & Pages, `tradecatch`, Metrics, filter status
"Exceeded Resources".

Or from a terminal logged in with `wrangler login` (read-only analytics):

```js
// node query.mjs  (needs: npx wrangler auth token --json)
import { execSync } from "node:child_process";
const token = JSON.parse(execSync("npx wrangler auth token --json", { encoding: "utf8" })).token;
const to = new Date(), from = new Date(to - 24 * 3600e3);
const query = `query($a:String!,$f:Time!,$t:Time!){viewer{accounts(filter:{accountTag:$a}){
  workersInvocationsAdaptive(limit:100, filter:{scriptName:"tradecatch", eventType:"fetch", datetime_geq:$f, datetime_leq:$t}){
    dimensions{status httpResponseStatus}
    sum{requests}
    quantiles{memoryUsageBytesP50 memoryUsageBytesP99 cpuTimeP99}
  }}}}`;
const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query, variables: { a: "<account id>", f: from, t: to } }),
});
console.log(JSON.stringify((await r.json()).data.viewer.accounts[0].workersInvocationsAdaptive, null, 1));
```

Healthy: no `exceededResources` rows, and `memoryUsageBytesP99` well under
~100 MiB (it was 99 to 118 MiB before the fix). Locally, a fresh isolate now
holds ~34 MiB live (was 66) and ~49 MiB after every route has been touched
(was 89).

## Measuring locally

`wrangler dev --inspector-port 9239` exposes the isolate over the Chrome
DevTools protocol (`http://127.0.0.1:9239/json`). `Runtime.getHeapUsage` gives
used and committed heap; `HeapProfiler.takeHeapSnapshot` forces a GC first, so it
shows the live set. Use a `.dev.vars` file so Wrangler does not load
`.env.local`, which points at production.

## Known remaining headroom risks

- Every marketing page is rendered on every request (`Cache-Control: no-store`).
  `src/app/[locale]/layout.tsx` calls `headers()` for an `x-nonce` that
  `src/proxy.ts` deliberately never sets, which makes the whole tree dynamic, and
  OpenNext runs with the dummy incremental cache. Each render adds several MiB of
  garbage. Making these pages static and serving them from a static-assets cache
  would cut per-request memory further; it changes caching behaviour, so it needs
  its own review.
- Under sustained concurrency of 8 the isolate still grew to ~129 MiB used locally
  (unbounded there; production caps at 128 MiB and V8 collects sooner). Watch the
  analytics above after any traffic spike.
