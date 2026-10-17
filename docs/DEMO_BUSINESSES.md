# Demo contractor account system (Task 2)

Creates fictional contractor businesses that use the same SaaS backend as real
pilots (`tc_organizations` / `tc_memberships` / Module A clients), with simulated
data and no live customer contact by default.

## Mapping

| Spec concept | TradeCatch implementation |
| --- | --- |
| `businesses` | `tc_organizations` (`account_type = 'demo'`) |
| `business_members` | `tc_memberships` (`owner` / `admin` / `member`) |
| `business_settings` | org columns + `features_json` + `tc_org_settings` |
| `users` | `tc_users` (+ optional `platform_role = 'admin'`) |

Apply migration: `npm run db:schema` (includes `008_demo_businesses`).

## Admin access

1. Magic-link login as usual (`/login`).
2. Either:
   - set `TRADECATCH_ADMIN_EMAILS=you@example.com`, or
   - set `platform_role = 'admin'` on your `tc_users` row.
3. Open `/admin` → **+ Create Demo Business**.

Ops bearer (`MISSED_CALL_OPS_SECRET`) can also call the admin APIs without a browser session.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/admin/demo-businesses` | Create demo business (supports `Idempotency-Key`) |
| `GET` | `/api/admin/demo-businesses` | List demo businesses |
| `GET` | `/api/businesses/:id` | Read business (member or admin) |
| `PATCH` | `/api/businesses/:id` | Update settings / feature toggles |
| `POST` | `/api/admin/demo-businesses/:id/seed` | Generate fictional records |
| `POST` | `/api/admin/demo-businesses/:id/reset` | Wipe + optional reseed (`confirm: RESET_DEMO_ACCOUNT`) |
| `DELETE` | `/api/admin/demo-businesses/:id` | Delete demo business only |
| `POST` | `/api/app/switch-organization` | Open a business dashboard in-session |

## Contractor dashboard nav

Overview · Receptionist · Phone Calls · Leads · Conversations · Appointments ·
Quotes & Follow-Ups · Analytics · Business Settings · Test Center

Conversations → inbox. Analytics → overview. Test Center seeds/resets demo data
for administrators.

## Safety

- Demo SMS/calls use staging dry-run / sandbox paths from Task 1.
- Seeded records are labelled `[SIMULATED]`.
- Reset/delete are scoped by `organization_id` and refuse non-demo accounts.

## AI Receptionist (Task 3)

See [AI_RECEPTIONIST_CONFIG.md](./AI_RECEPTIONIST_CONFIG.md). Each demo business
owns an independent `rc_profiles` row; knowledge and simulated tests never leak
across organizations.
