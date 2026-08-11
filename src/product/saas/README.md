# SaaS foundation (Voie B)

Multi-tenant portal layered on Module A without replacing the missed-call engine.

## Pieces

| Area | Location |
| --- | --- |
| Schema | `schema.sql` (`tc_organizations`, `tc_users`, `tc_memberships`, `tc_sessions`, `tc_magic_links`) |
| Entitlements | `entitlements.ts` — **only** place for plan → feature mapping |
| Auth | `auth/magic-link.ts`, `auth/session-token.ts` |
| Tenant guard | `tenant.ts` → `requireTenantContext()` |
| Stores | `memory-store.ts` (tests/dev), `postgres-store.ts` (durable) |

## Apply DB

```bash
# Requires DATABASE_URL. Applies Module A schema then SaaS schema.
npm run db:schema
```

## Local sign-in

1. Set `AUTH_SECRET` (any long random string).
2. Optionally `SAAS_DEV_LOGIN=1` so `/api/auth/magic-link` returns `devToken` when Resend is unset.
3. Open `/login`, enter email + company name (first time), follow the link.

## Tenant isolation rules

- `/api/app/leads` and `/api/app/dashboard` only load `organization.missedCallClientId`.
- Ops Module A APIs remain bearer-secret (founder tools) — not a client escape hatch for other tenants’ UI.
- Voice webhook resolves client by Twilio `To` number, then checks org plan entitlement when linked.

## Not in this foundation slice

Quote follow-up engine, website lead ingest, inbox human-takeover UI, calendar booking, review automation — next P1/P2 slices on top of this auth + entitlements layer.
