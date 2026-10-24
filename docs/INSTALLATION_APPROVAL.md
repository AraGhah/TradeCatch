# Installation and exact-domain approval

## Shipping state: enforcement OFF

This feature adds a private registry and admin workflow, not production
activation. Unset/`off` `INSTALLATION_ENFORCEMENT` performs zero approval DB or
network lookups at Worker ingress or cron. No live domains, customers, providers,
staging settings or preview permissions were changed or automatically granted.

| Owner-confirmed inventory                           | Required action before enforcement                 |
| --------------------------------------------------- | -------------------------------------------------- |
| `https://tradecatch.ca`                             | Register and approve after ownership review        |
| `https://tradecatch.ara-ghahramanyan07.workers.dev` | Register as exact alias of the same installation   |
| `http://localhost:3000`                             | Separate local installation, exact port            |
| `*-tradecatch.ara-ghahramanyan07.workers.dev`       | Discovery pattern only; **never an approval**      |
| Staging `tradecatch-staging`                        | Active origin/install unconfirmed; rollout blocker |

Enumerate every existing authorized preview's exact origin in Cloudflare, capture
a dated snapshot and identify its installation and owner. Do not grant future
previews based on the wildcard or use a broad workers.dev exemption. Leave the
feature off until existing production, development, staging and preview inventory
has been identified, reviewed and migrated safely.

## Administrator workflow

Open `/admin/installations` or `/fr/admin/installations`. The existing platform
admin identity, MFA and matching admin JWT are required on both page and API.
Customer owners/admins and the shared operations credential cannot approve.

1. Register a new installation's name, exact origin and review reason. The server
   creates a stable UUID and 256-bit credential. The origin starts **pending**.
2. Save the one-time credential in that installation's server secret storage.
   Only its hash is stored in PostgreSQL. It is not logged or included in list or
   audit responses. The admin UI holds it in memory until cleared/unmounted, not
   local/session storage. Do not put secrets in decision reasons or client code.
3. Register aliases using the existing installation UUID; each new exact origin
   independently starts pending. Verify ownership before explicitly approving.
4. Reject pending origins or revoke approved ones; later reapproval is explicit.
   Decisions require a reason and authenticated actor. Stale/concurrent decisions
   return 409. A decision and its audit insert commit atomically; audit failure
   rolls back the decision. Audit rows reject UPDATE/DELETE through normal DML.
5. Review the recent history: the UI shows up to 200 domains and 100 audit entries,
   not a full export. Older records remain in the private database.

“Revoke all domains of this installation” atomically revokes all of its current
origins, including pending aliases, with a separate audit entry per changed
origin. Installation-first locks and revision changes invalidate stale approvals.
Reactivation requires fresh, explicit approval of each origin; updates never
automatically restore a revoked grant.

Approval is per installation/exact origin, **not per build or release**. Scheme
and port matter. Wildcards, credentials in URLs, paths, query/fragment and trailing
dot aliases are refused; HTTP is permitted only for loopback. A new preview
hostname is a new domain even if created by the same pipeline. Code updates using
the same UUID/credential/origin do not need another approval.

## Private authority and guarded enforcement

TradeCatch's controlled backend/PostgreSQL is the authority. Remote installations
must never receive its database credentials or administrator secrets.
`POST https://tradecatch.ca/api/installations/verify` accepts a scoped bearer
credential, UUID and origin; it returns only an approval boolean and cannot grant
approvals or access tenant data. Requests are bounded/rate-limited and responses
non-cacheable. The remote client uses a fixed HTTPS destination, no redirects,
a five-second timeout and a 512-byte response limit.

The Cloudflare Worker entrypoint gates HTTP and scheduled execution when enabled.
Static assets may bypass Workers: this does not conceal downloadable source or
images. It checks the actual request URL, not Host/X-Forwarded-Host hints, and
independently checks a different browser Origin. Requests without Origin still
need approved ingress and retain all original provider-signature/session checks.
No normal authentication, CSRF, MFA or tenant boundary is replaced. Unknown,
pending, rejected and revoked grants deny access; authority/DB/config failures
return 503, never fail open. No positive cache delays revocation.

Authority mode `local` uses the existing private DB; a separate Worker uses
`remote` and its own scoped ID/credential, never the authority's credentials.
This is the shipping Cloudflare integration; deploying standalone Node/Next
publicly requires equivalent trusted ingress integration.

Editable source can always have a local check removed. This is not unbreakable
anti-copy DRM or proof of a server's location: server callers can forge Origin
headers. Keep private services/DB credentials under owner control and retain
service/tenant authentication. A modified clone cannot use the verification API
to approve itself, but can run independent services using its own resources.

## Migration, rollout and rollback — NOT executed

1. Back up the intended DB and review all pending migrations before running the
   existing `npm run db:schema` procedure. Additive migration
   `028_installation_approval` adds three private RLS-protected tables, transactionally,
   with **no approved rows or production/customer backfill**. Reapplying it
   preserves records. Do not run production migrations to exercise tests.
2. Deploy with enforcement unset/`off`. Check unchanged booking, login, billing,
   Stripe/Twilio callbacks, cron, staging controls and every authorized preview.
3. Register/review exact existing origins, preserving installation identity across
   aliases/updates; store scoped credentials securely. Pending rows are not grants.
4. Resolve staging and preview inventory. Obtain the owner's sign-off on the exact
   snapshot, callback routes, scheduled jobs and rollback access.
5. Only in a **later separately approved rollout** set
   `INSTALLATION_INVENTORY_CONFIRMED=1`, `INSTALLATION_ENFORCEMENT=enforce`,
   `INSTALLATION_ID`, `INSTALLATION_CREDENTIAL` and authority mode. Missing inventory
   confirmation or invalid enforcement mode denies rather than bypasses. Do not
   configure enforcement now. Canary an isolated installation before production.

Rollback by restoring `INSTALLATION_ENFORCEMENT=off` via authorized deployment
configuration, then redeploy the prior revision if needed. Preserve registry and
audit data; no table drops, customer revocations or whole-DB restore are needed.
If a credential is lost, keep that rollout disabled and use a reviewed operator
credential-replacement procedure; there is no public autoapproval/recovery bypass.

## Verification and migration history

Unit tests cover default-off compatibility, exact origins/ports, stable releases,
no wildcard grants, Origin/forwarded-host handling, revocation, bounded remote
responses and failure-closed behavior. PostgreSQL tests use only explicitly
configured loopback test DBs in isolated schemas: hashing, uniqueness, domain
isolation, rejection, concurrency, audit rollback and append-only history. CI
runs them using `INSTALLATION_TEST_DATABASE_URL`, with no production fallback.
Bilingual browser tests cover admin/MFA/JWT gates, errors/retry/stale data, failed
decisions without false refresh, credential clearing and accessibility.

Local branches, remote-tracking refs, worktrees, schema runner and migration
history were inspected before changes. No `026_receptionist_plan` branch or
migration was found. Existing `026_notification_localized_content`, Stripe billing
and plan constraints were left unchanged. This feature uses separate migration
028, not a guessed reconstruction of the missing billing work.

Reference: [Cloudflare Node crypto support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).
