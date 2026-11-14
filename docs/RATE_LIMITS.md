# Rate limits

How TradeCatch limits requests, what the limits are, and how to change or watch them.

- Algorithm: one **token bucket** ([src/lib/token-bucket.ts](../src/lib/token-bucket.ts)).
- Limits: every number lives in one table, [src/lib/rate-limit-policy.ts](../src/lib/rate-limit-policy.ts). Routes ask for a policy by name; none writes its own numbers (a test enforces it).
- Storage: shared by all Worker instances (Redis, else Postgres) for every named per-route limit. The one exception is the default limit on Cloudflare, which is shared only when Redis is configured (see [The default limit on Cloudflare](#the-default-limit-on-cloudflare)).
- Default limit: [src/proxy.ts](../src/proxy.ts) applies a per-client-address limit to **every** `/api` route, so a new route is covered the day it is added.
- Refusals: HTTP **429** with `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, and a JSON body `{ error, code: "rate_limited", retryAfterSeconds }`.
- Voice and provider webhooks are **never** limited or queued (see [Voice receptionist](#voice-receptionist-and-provider-webhooks)).

## How the bucket works

A policy is `capacity` (the burst) and `refillEveryMs` (one token returns every so often). A request spends one token; with none left it is refused and told how long until one returns. A client that stays within the sustained rate is never refused, and one that bursts is allowed up to `capacity` at once. "20 per 15 min" is therefore written as _burst 20, one token back every 45 s_, which is smoother than a fixed window and has no "reset at :00" cliff for attackers to exploit.

The state is one number per key, the time the bucket is full again (`fullAt`). A request is allowed when `max(fullAt, now) + refill - now <= capacity * refill`. Refused requests change nothing, so hammering a limited endpoint cannot extend its own lockout.

### Where the buckets live

`takeToken` ([src/lib/rate-limit.ts](../src/lib/rate-limit.ts)) tries, in order:

| Tier       | Used when                                                     | Atomicity                                                                                  |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `upstash`  | `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` set   | One Lua script (`TIME`, `GET`, `SET PX`) per request, server clock                          |
| `postgres` | `DATABASE_URL` and a durable store flag (`SAAS_DURABLE_STORE=1` or `MISSED_CALL_DURABLE_STORE=1`) | One `INSERT ... ON CONFLICT DO UPDATE` per request on `tc_rate_limits`, database clock |
| `memory`   | Neither of the above, or both are failing                     | Per process only                                                                           |

- No migration is needed: the existing `tc_rate_limits` table is reused (`key` is `tb:<key>`, `reset_at` is the full-again time, `count` is the tokens left, or `-1` when the last request was refused). Old rows expire by the existing sweep.
- The Postgres bucket never admits more than `capacity` requests at once. When many requests hit the same key in the same few milliseconds the database may credit refill slightly late, so the very last token can be refused (at most one token fewer than `capacity`); it is never one too many. This is why `PG_SLACK_MS` is 5 ms, and a test requires every policy to refill no faster than every 50 ms so that 5 ms of slack can never buy a whole extra token. Redis reads its clock inside the Lua script and has no such effect.
- A shared tier that errors or takes more than 2 s is skipped for 15 s and the next tier answers. An outage of Redis or Postgres therefore degrades to per-instance limits. It never becomes "no limit", an error page, or a stalled request.
- Once a shared tier refuses a key, this instance remembers the refusal until its `Retry-After` passes (`tier: "memo"`), so a flood of refused requests costs no database round trips.
- Memory is bounded (5,000 keys, least useful evicted first). Log lines for refusals are throttled to one per policy per 10 s.
- `sharedRateLimitConfigured()` is what the startup warning in [src/lib/security-warnings.ts](../src/lib/security-warnings.ts) checks.

### The default limit on Cloudflare

The default limit runs in [src/proxy.ts](../src/proxy.ts). On Cloudflare, OpenNext builds that file as a separate "Node middleware" bundle, resolved with the `module` export condition instead of `workerd`. In that bundle the `pg` driver loses its Workers socket support (`pg-cloudflare` resolves to an empty module) and every connection attempt throws `TypeError: ... is not a constructor`. Route handlers are built with the `workerd` condition and connect to Postgres normally. Found by running the built Worker under `wrangler dev`, not by reading code.

So the central limiter calls `takeToken` with `postgres: false` when it runs on Workers (`consumePolicy(..., { postgres: !isCloudflareWorker() })`, covered by a test). It does not try Postgres, wait for a failure and fall back:

| Where                                        | Shared store for the **default** limit | Shared store for **named per-route** limits |
| -------------------------------------------- | -------------------------------------- | ------------------------------------------- |
| Cloudflare Worker with Upstash configured    | Upstash (all instances)                | Upstash (all instances)                     |
| Cloudflare Worker, Postgres only             | This isolate's memory                  | Postgres (all instances)                    |
| Node (`next start`, tests, other hosts)      | Upstash, else Postgres                 | Upstash, else Postgres                      |

What this means in practice: the strict limits that matter most (sign-in, password reset, texts, payments, exports, voice cloning) are enforced against Postgres or Upstash and are exact across isolates. The default limit is a backstop for runaway loops and floods, not for people (`api.write`: 60 at once then 1 a second; `api.read`: 240 at once then 8 a second, per address); without Upstash each isolate counts on its own, so a flood spread across many isolates gets more headroom in total than one address would on a single one. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (see [.env.example](../.env.example)) to make it exact, and add a Cloudflare rate-limiting rule above the application numbers as the outer backstop (see [Cloudflare](#cloudflare)).

### Which client address is used

On Cloudflare Workers `CF-Connecting-IP` is set by the edge and cannot be forged by a visitor, so it is trusted automatically (detected from `navigator.userAgent`, no setting needed). Elsewhere `CF_TRUSTED=1` or `TRUST_PROXY_HEADERS=1` must be set deliberately. IPv6 clients are grouped by /64, since one household owns a whole /64. A request whose address cannot be determined is **not** counted against the default limit, because all such visitors would share one bucket and lock each other out; the strict per-route limits still apply to them, with a looser shared "unknown address" bucket where the table shows one.

## Limits per endpoint

"Shared by" says what the bucket belongs to: `ip` (client address), `user` / `business+user` (the signed-in person, so an office behind one address is not throttled together), `number` / `number pair` (phone numbers), `other` (a combination named in the policy). Where the last-but-one column says `same`, the bucket is the same whether or not the address is known.

Which route uses which policy is found by searching the policy id, for example `"auth.password-login"`.

### auth

| Policy | Burst | Refill | Shared by | Shared unknown address | Protects |
| --- | --- | --- | --- | --- | --- |
| `auth.password-login` | 20 | 1 per 45 s | ip | 200, 1 per 4.5 s | Password guessing. Per-account lockout sits behind this. |
| `auth.magic-link` | 5 | 1 per 3 min | ip | same | Sign-in e-mails sent to other people. |
| `auth.forgot-password` | 5 | 1 per 3 min | ip | 100, 1 per 9 s | Reset e-mails sent to other people. |
| `auth.set-password` | 20 | 1 per 45 s | ip | 200, 1 per 4.5 s | Guessing reset tokens. |
| `auth.callback` | 60 | 1 per 10 s | ip | 600, 1 per 1 s | Guessing magic-link tokens. |
| `auth.change-password` | 20 | 1 per 45 s | user | same | Guessing the current password from a stolen session. |
| `auth.refresh` | 60 | 1 per 10 s | ip | 600, 1 per 1 s | Guessing refresh tokens. A signed-in tab renews about every 14 minutes. |
| `auth.account-recovery` | 3 | 1 per 20 min | ip | 30, 1 per 2 min | Support recovery requests from people locked out of their email. |
| `auth.mfa` | 20 | 1 per 45 s | other | same | Guessing the second factor (user and address). |

### sms

| Policy | Burst | Refill | Shared by | Shared unknown address | Protects |
| --- | --- | --- | --- | --- | --- |
| `sms.conversation` | 20 | 1 per 3 min | number pair | same | One abusive caller driving Twilio spend. Owner alerts are exempt. |
| `sms.sender` | 200 | 1 per 20 s | number | same | A bug or loop texting customers from one business number. |
| `sms.live-test` | 5 | 1 per 12 min | business+user | same | Test button that sends a real text. |

Both SMS buckets are checked inside the one adapter every text goes through ([src/product/missed-call/twilio.ts](../src/product/missed-call/twilio.ts)). A refused text is **retried later by the outbox, never marked dead** (`SmsRateLimitError`), and it never reaches Twilio. The pair bucket is spent first so that one abusive recipient cannot drain the business number's bucket; if the sender bucket then refuses, that pair token is not returned (rare, and it only makes that one conversation a little slower).

### payments

| Policy | Burst | Refill | Shared by | Shared unknown address | Protects |
| --- | --- | --- | --- | --- | --- |
| `payments.checkout` | 5 | 1 per 2 min | business+user | same | Repeated Stripe Checkout sessions. Duplicates are also blocked by a pending-checkout claim and a Stripe idempotency key. |
| `payments.portal` | 5 | 1 per 2 min | business+user | same | Repeated Stripe billing portal sessions. |

### sensitive

| Policy | Burst | Refill | Shared by | Shared unknown address | Protects |
| --- | --- | --- | --- | --- | --- |
| `sensitive.api-key-create` | 10 | 1 per 6 min | business+user | same | Minting credentials. |
| `sensitive.account-export` | 3 | 1 per 20 min | business+user | same | Bulk export of a business's data. |
| `sensitive.website-service` | 5 | 1 per 12 min | business+user | same | Paid website service requests. |
| `sensitive.referral-link` | 20 | 1 per 30 s | business+user | same | Referral link minting. |
| `sensitive.voice-challenge` | 10 | 1 per 6 min | business+user | same | Voice-clone consent challenges. |
| `sensitive.voice-clone` | 6 | 1 per 10 min | business+user | same | Voice cloning (paid third-party call, biometric data). |
| `sensitive.voice-preview` | 20 | 1 per 30 s | business+user | same | Paid text-to-speech previews. |
| `sensitive.voice-mode` | 30 | 1 per 20 s | business+user | same | Switching between the standard and a cloned voice. |
| `sensitive.voice-delete` | 20 | 1 per 30 s | business+user | same | Deleting a cloned voice. |
| `sensitive.voice-revoke` | 20 | 1 per 30 s | business+user | same | Voice consent revocation. |

### admin

| Policy | Burst | Refill | Shared by | Shared unknown address | Protects |
| --- | --- | --- | --- | --- | --- |
| `admin.installations` | 30 | 1 per 2 s | user | same | Installation approvals. |
| `admin.account-recovery` | 30 | 1 per 20 s | user | same | Identity verification and account email changes by an administrator. |
| `admin.referrals` | 60 | 1 per 1 s | user | same | Referral reward administration. |

### public

| Policy | Burst | Refill | Shared by | Shared unknown address | Protects |
| --- | --- | --- | --- | --- | --- |
| `public.book-audit` | 5 | 1 per 2 min | ip | 2, 1 per 5 min | Form spam; every submission e-mails the team. |
| `public.website-request` | 5 | 1 per 2 min | ip | 2, 1 per 5 min | Form spam. |
| `public.referral-submit` | 5 | 1 per 2 min | ip | 2, 1 per 5 min | Form spam. |
| `public.website-leads-ip` | 120 | 1 per 5 s | ip | same | Lead intake from customer websites, per address. |
| `public.website-leads-key` | 30 | 1 per 20 s | other | same | Lead intake from customer websites, per API key and address. |
| `public.client-error` | 12 | 1 per 50 s | ip | same | Browser error reports are anonymous and unbounded otherwise. |
| `public.receptionist-demo` | 120 | 1 per 5 s | ip | same | Marketing-site demo chat (model calls cost money). |
| `public.demo-voice` | 30 | 1 per 20 s | ip | same | Marketing-site demo voice (text-to-speech costs money). |
| `public.installation-verify` | 600 | 10 per s | ip | same | Installation checks run by customer websites. |
| `public.calendar-hook` | 60 | 1 per 1 s | business+ip | same | Calendar change notifications. |

### tools

| Policy | Burst | Refill | Shared by | Shared unknown address | Protects |
| --- | --- | --- | --- | --- | --- |
| `tools.call-test` | 10 | 1 per 1 min | business+user | same | Simulated calls. |
| `tools.notification-test` | 20 | 1 per 30 s | business+user | same | Test notifications. |
| `tools.automation-test` | 30 | 1 per 20 s | business+user | same | Automation dry runs. |
| `tools.receptionist-test` | 60 | 1 per 10 s | business+user | same | Receptionist test chat (model calls cost money). |

### api

| Policy | Burst | Refill | Shared by | Shared unknown address | Protects |
| --- | --- | --- | --- | --- | --- |
| `api.write` | 60 | 1 per 1 s | ip | same | Default for POST/PUT/PATCH/DELETE: 60 at once, then 1 a second. |
| `api.read` | 240 | 8 per s | ip | same | Default for GET/HEAD: 240 at once, then 8 a second. |

The two `api.*` rows are the default limit for every route not listed above and not exempt. They are deliberately generous (a person using the dashboard never gets near them); they exist to stop loops and floods. A named policy on a route is checked **in addition to** the default.

To change a number, edit [src/lib/rate-limit-policy.ts](../src/lib/rate-limit-policy.ts) and the matching row here. `tests/unit/rate-limit-policy.test.ts` fails if a row is missing or no longer matches the code.

## Voice receptionist and provider webhooks

A live call must never be delayed, queued or refused by a rate limit. These routes are on `EXEMPT_API_PREFIXES` and skip the default limit entirely:

| Prefix                              | Why it is exempt                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `/api/twilio/`                      | Twilio voice and SMS webhooks. Twilio sends from a few shared addresses.          |
| `/api/webhooks/`                    | Stripe and other provider webhooks. Retried by the provider, deduplicated by id.  |
| `/api/voice/`                       | The live voice socket and tool calls.                                             |
| `/api/receptionist/agent/`          | The voice agent's availability, booking and lookup calls during a call.           |
| `/api/receptionist/agent-config`    | The agent loading its configuration at call start.                                |
| `/api/health`                       | Uptime probes.                                                                    |

Exempt does not mean open. A test (`exempts only routes that prove who is calling`) fails unless every exempt route verifies a Twilio/Stripe signature, a shared secret, or an ops token. There is no queue in front of any of them. The only voice routes with limits are the ones a **person** clicks in the dashboard (cloning, previewing, switching voice: `sensitive.voice-*`), and the public marketing demo (`public.demo-voice`, `public.receptionist-demo`), none of which are on a live call's path.

## RATE_LIMIT_MODE

The default limit (not the named per-route ones) has a switch, `RATE_LIMIT_MODE`:

| Value               | Behaviour                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `enforce` (default) | Answer 429 when the bucket is empty. Any other or misspelled value also means `enforce`.                     |
| `monitor`           | Log what would have been refused (`tradecatch.rate_limit.limited`, `mode: "monitor"`) and let it through.    |
| `off`               | Switch the default layer off. Per-route limits and every Cloudflare protection stay on.                      |

**Rolling out new numbers:** deploy with `RATE_LIMIT_MODE=monitor`, search the Worker logs for `tradecatch.rate_limit.limited` for a day, raise any policy that would have refused real traffic, then remove the variable. Log lines carry the policy, route, tier and `retryAfterMs`, never the client address.

To see who is currently throttled in Postgres: `SELECT key, to_timestamp(reset_at / 1000.0) FROM tc_rate_limits WHERE count = -1;` (keys are `tb:<policy>:<subject>`).

## Cloudflare

- **This layer never weakens Cloudflare.** WAF, rate-limiting rules, Bot Fight, Turnstile and Access are untouched and still sit in front. Nothing here changes a Cloudflare setting.
- Cloudflare's own refusals look different from ours, and the browser tells them apart ([src/lib/client/request.ts](../src/lib/client/request.ts)):

  | Cloudflare answer                                 | Meaning                         | Browser behaviour                                                                        |
  | ------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
  | Error **1015** (HTTP 429, HTML)                   | Cloudflare rate-limited the IP  | Treated as rate limited for the whole site; waits 60 s (or its `Retry-After`) before any call |
  | Error **1020** and the 1003-1013 family (HTTP 403, HTML) | A firewall rule blocked it | Not retried (retrying cannot help). Shows "blocked, contact support"                     |
  | `error code: 1102` / 1101 (HTTP 503/500, plain text) | A Worker exceeded its resources | Treated as briefly unavailable; GETs retry with backoff, writes do not                  |
  | Our own 429 (JSON, `Retry-After`)                 | This layer's limit              | Waits exactly `Retry-After`, then retries once if safe                                   |

- If you add Cloudflare rate-limiting rules for `/api/*`, set their thresholds **above** the default limit (for example 600 requests per 10 s per IP). Then the application answers first, with JSON and an accurate `Retry-After`, and Cloudflare is the outer backstop for floods.
- Keep Cloudflare's `CF-Connecting-IP` as the identity. Do not put another proxy in front without setting `TRUST_PROXY_HEADERS` deliberately.

## Browser behaviour

All client code goes through [src/lib/client/](../src/lib/client/):

| What                         | How                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One shared request function  | `requestJson` returns parsed JSON or throws `ApiError` with a `kind` (`rate_limited`, `blocked`, `unavailable`, `network`, `unauthorized`, ...), `retryAfterMs`, and the body. |
| Controlled retries           | After a 429 any method waits `Retry-After` (+0-250 ms) and retries. 502/503/504/network errors retry **only** for GET, or a write the caller marks `idempotent`. A write defaults to 0 retries. |
| Exponential backoff + jitter | When the server gave no wait: `random(0, min(30 s, 500 ms * 2^attempt))` (full jitter), so a crowd that failed together does not return together.                     |
| Cooldown memory              | After a 429 for a route (or Cloudflare 1015 for the site) the browser does not send that request again until the wait is over; it fails instantly without a network call. |
| Duplicate GETs               | Identical GETs made at the same time share one request.                                                                                                              |
| Polling                      | `createPoller`: next run is scheduled only when the last one finished; waits +/-10% jitter; backs off exponentially after failures (capped at 5 min) and at least `Retry-After`; pauses in hidden tabs and when offline; one run on return; stops on 401. Used by the dashboard live badge, notification bell and centre, Gmail sync. |
| Rapid clicking               | `useSingleFlight` drops a second call while one is running (synchronous lock, so two clicks in the same tick are also caught). Checkout and billing buttons also stay disabled while the browser navigates to Stripe, and show a countdown after a 429 (`useCooldown`). |

## Idempotency: one payment, one text, one appointment

A limiter reduces how often something is attempted; idempotency makes a repeated attempt harmless. Both are in place for the three critical operations.

| Operation                         | What makes a repeat harmless                                                                                                                                                                                     | Test                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Stripe installation checkout      | Database claim: a partial unique index allows one `pending` checkout per organization, so concurrent requests get `already_pending` (409) before Stripe is called. Stripe is sent `Idempotency-Key` = the claim id. A claim over 24 h old (Stripe's session lifetime) is released. | `stripe-checkout.test.ts`: 20 simultaneous calls make 1 session; key header present        |
| Stripe webhooks                   | `tc_stripe_events` insert-once by event id: a duplicate delivery is acknowledged and ignored.                                                                                                                    | `stripe-checkout.test.ts`, `stripe-billing.test.ts`: duplicate delivery                    |
| Stripe overage invoices (flagged) | Frozen amounts and the same Stripe idempotency key on retry; stale claims are not blindly retried.                                                                                                               | `overage-invoicing.test.ts`                                                                |
| Appointments                      | `idempotencyKey` in the request: the booking is serialized per organization and looked up by key first, and the Postgres store enforces it with a unique constraint. The dashboard makes a fresh key per picked time and keeps it across retries and 429s. | `scheduling.test.ts`: 25 identical simultaneous bookings make 1 appointment and 1 text; `scheduling-atomic.test.ts` (Postgres) |
| SMS sending                       | Outbound messages are rows claimed with `FOR UPDATE SKIP LOCKED` (one worker per message), with a unique provider SID; inbound texts are deduplicated by `MessageSid`; one active workflow per missed call (`mc_workflows_active_dedupe`). A rate-limited send is retried, never duplicated. | `twilio-sms-rate-limit.test.ts`, `missed-call-outbox-and-config.test.ts`                   |
| Public forms                      | `idempotencyKey` (UUID) per form attempt, kept when the person retries after an error.                                                                                                                           | `book-audit-durability.test.ts`                                                            |
| Other provider webhooks           | `tc_webhook_receipts`: claim by provider and event id, insert-once.                                                                                                                                              | (existing coverage; not changed here)                                                      |

## Files

| File                                                                         | Role                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [src/lib/token-bucket.ts](../src/lib/token-bucket.ts)                        | The algorithm, in-memory buckets, refusal memo                                |
| [src/lib/rate-limit.ts](../src/lib/rate-limit.ts)                            | `takeToken`, tiers, timeouts, client address                                  |
| [src/lib/rate-limit-policy.ts](../src/lib/rate-limit-policy.ts)              | All limits, `consumePolicy`, route classification, exempt list                |
| [src/lib/rate-limit-response.ts](../src/lib/rate-limit-response.ts)          | `enforcePolicy`, `tooManyRequests` (429 + headers)                            |
| [src/lib/rate-limit-central.ts](../src/lib/rate-limit-central.ts)            | The default limit and `RATE_LIMIT_MODE`                                       |
| [src/lib/pg-rate-limit.ts](../src/lib/pg-rate-limit.ts)                      | Postgres bucket (atomic SQL) and sweep                                        |
| [src/lib/upstash.ts](../src/lib/upstash.ts)                                  | Redis bucket (Lua)                                                            |
| [src/lib/client/request.ts](../src/lib/client/request.ts)                    | `requestJson`, `ApiError`, Cloudflare error detection, backoff                |
| [src/lib/client/poller.ts](../src/lib/client/poller.ts)                      | Safe polling                                                                  |
| [src/lib/client/use-single-flight.ts](../src/lib/client/use-single-flight.ts)| One-at-a-time handlers and the visible cooldown                               |

## Tests

`npm run test:unit` runs them all. Without the variables below the Postgres and Redis suites skip; with them, every shared-store guarantee runs against the real servers.

```bash
docker run -d --name tc-pg-test -p 55432:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=db postgres:16
docker exec -i tc-pg-test psql -U postgres -d db < src/product/security/schema.sql
docker run -d --name tc-redis-test -p 56379:6379 redis:7
SECURITY_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/db REDIS_TEST_PORT=56379 npm run test:unit
```

| Suite                                  | Proves                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token-bucket.test.ts`                 | Burst, refill, exact Retry-After, no charge for refused requests, agreement with a textbook bucket on thousands of random requests, 50 rapid requests then recovery, bounded memory |
| `shared-rate-limit-postgres.test.ts`   | Real Postgres: 60 simultaneous requests allow `capacity` (one fewer at worst, never more; exactly `capacity` when sequential); 50 requests from 8 "instances" share one bucket; the central limiter leaves Postgres alone when told it cannot be used; Retry-After is right; refusals are not charged; old fixed-window rows are untouched; sweep |
| `upstash-rate-limit.test.ts`           | The request/reply plumbing, and the same guarantees on a real Redis running the Lua script (60 simultaneous, 50 rapid, refill, key expiry) |
| `shared-rate-limit.test.ts`            | `takeToken`: 50 rapid and 50 concurrent callers, recovery, the refusal memo, fall back to memory when Redis errors or hangs (2 s), cooldown and return, one log line without error text or connection string |
| `rate-limit-policy.test.ts`            | Table sanity, this document, no limits written outside the table, every route classified, exempt routes prove identity, 70 POSTs make 60 allowed, per-address buckets, IPv6, recovery, monitor/off, log throttle |
| `client-request.test.ts`               | Cloudflare 1015/1020/1102 pages, 429 with and without Retry-After, 20-50 rapid requests against a simulated bucket, backoff and jitter bounds, cooldown, poller, single-flight |

## Verified results

Run on 2026-11-13 against real Postgres 16 and Redis 7 (Docker), nothing deployed.

| Check                                                              | Result                                                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit` (with both servers)                            | 2124 tests, 2121 pass, 0 fail, 3 skipped (other PostgreSQL suites that need their own database variables)                                    |
| Postgres concurrency suite, repeated                               | 25 of 25 and 15 of 15 consecutive runs green (60 simultaneous requests never admit more than `capacity`)                                     |
| `tsc --noEmit`, `npm run lint`, `npm run format:check`, i18n parity | Clean (2857 i18n keys in parity)                                                                                                             |
| Live `next start` burst script                                     | 17 of 17 checks: 50 sign-ins (also 50 simultaneous) let exactly 20 through and answer the rest 429 with `Retry-After`, `RateLimit-*` and a JSON body; 40 concurrent users are not limited; 300 rapid GETs and 70 rapid writes hit the default limit; recovery after the wait; webhook, voice-agent and health routes never 429 under 300 requests; a fresh address is not limited by another's lockout (monitor/off modes and forged-header handling are covered by unit tests and the Worker row below) |
| Real Worker under `wrangler dev` (workerd)                         | Route limits shared through Postgres or Upstash; forged `X-Forwarded-For` ignored when the edge address is present; default limit enforced from the proxy; graceful fallback when a shared store times out; the proxy-bundle Postgres failure that led to `postgres: false` |
| `npm run build:cloudflare`, `npm run check:cloudflare-bundle`      | Build succeeds; dry-run deploy succeeds (18,486 KiB, 4,244 KiB gzip); bundle is Latin-1 clean (the KAN-10 guard)                               |
| Mutation spot-checks                                               | Removing the Workers-Postgres guard, the booking idempotency lookup, the checkout pending-claim branch, or the SMS sender bucket each makes tests fail |
| Browser specs that use limited routes (Playwright)                 | book-audit, referral form and link, Gmail, receptionist workspace, escalation contacts, installation approvals: 55 pass, 3 fail (see below). The run found a real regression in the Gmail badge (fixed), and the server logged no limiter refusal during any run |

Browser run notes:

- **Found and fixed:** the Gmail badge's first background sync had been moved to page load; the original waits 1 s, so a person who opens the inbox and presses Refresh is answered by their own press. The "Refresh pulls new mail and says how much" spec caught it; the 1 s wait is restored and the spec passes.
- **Environment, not code:** the e2e harness builds with the real `NEXT_PUBLIC_TURNSTILE_SITE_KEY` from `.env.local`, so a real Turnstile widget loads and cannot pass headless; the demo form and referral form stay blocked. These runs blanked that variable at build time (the harness already blanks the server-side secret).
- **Two of the three failures were the machine suspending network I/O mid-run** (`ERR_NETWORK_IO_SUSPENDED`, `ECONNRESET`).
- **The third is a click that lands before the page has hydrated** ("Get your link" in the referral specs). It is not caused by rate limiting or by these changes: the same two assertions fail at git `HEAD` with none of this work (12 of 40 runs under 8 parallel workers, against 3 of 20 on this tree, and 0 of 16 with one worker).

## Remaining risks

- **Cloudflare 1015 / 1020 were not triggered live.** The browser handling is tested against fixtures that reproduce the real response shapes (status, content type, body markers). Tripping a real Cloudflare rule would need a rule on the production zone, which this work does not touch.
- **Default limit on Cloudflare is per isolate without Upstash.** See [The default limit on Cloudflare](#the-default-limit-on-cloudflare). Provision Upstash for an exact shared count.
- **Postgres round trip per limited request is unmeasured on real Workers.** Locally it is a single statement; on Cloudflare the latency depends on how the database is reached. The 2 s timeout and the 15 s tier cooldown bound the worst case. Watch the p95 of limited routes after rollout.
- **Several people behind one address share the per-address default bucket** (an office, a mobile carrier's NAT). The numbers are deliberately generous, and the strict limits are per user or per number, not per address. If a customer reports 429s, raise `api.read` / `api.write` for that case before disabling anything.
- **An SMS refused by the sender bucket has already spent the conversation-pair token.** It is retried later, never lost or duplicated, but the pair bucket recovers slowly.
- **First deploy:** the default is `enforce`. Start with `RATE_LIMIT_MODE=monitor` for a day (see [RATE_LIMIT_MODE](#rate_limit_mode)). No database migration is needed.
