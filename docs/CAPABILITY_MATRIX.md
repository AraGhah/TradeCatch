# TradeCatch capability matrix

Honest map of **what the public site may claim** vs **what this repository actually runs**.

Status legend:

| Status | Meaning |
| --- | --- |
| **live** | Implemented end-to-end with tests; suitable for a controlled pilot once durable storage + Twilio are configured |
| **pilot** | Domain logic exists with an optional durable Postgres adapter; not multi-tenant or SaaS-ready |
| **illustrative** | UI demo / marketing example only — not a product feature |
| **planned** | Roadmap; must not be advertised as shipping |

## Capability table

| Claim | Status | Runtime | Storage | Tests | Notes |
| --- | --- | --- | --- | --- | --- |
| Missed-call detection (Twilio voice status) | pilot | `/api/twilio/voice/status` | Postgres when enabled; memory fallback | unit | To-number client resolve + env fallback |
| Customer SMS recovery + collection | pilot | `/api/twilio/sms/inbound`, engine | Postgres when enabled; memory fallback | unit | FR/EN, opt-out, caller eligibility filters |
| Technician job card + ACCEPTER/REFUSER/APPELER | pilot | engine + tech alerts | Postgres when enabled; memory fallback | unit | Bound by action token + open alert |
| Technician escalation timers | pilot | `/api/missed-call/escalations/tick` | Postgres when enabled; memory fallback | unit | Ops bearer required |
| Ops lead list / CRM correction API | pilot | `/api/missed-call/leads*` | Postgres when enabled; memory fallback | unit | Founder/ops tools — not public marketing |
| Book-audit lead capture (marketing) | live | `/api/book-audit` | Postgres when enabled + email/webhook | unit + e2e | Site lead gen |
| Website lead capture (contractor org API key) | pilot | `POST /api/website-leads`, `/app/website-leads` | `tc_website_leads` + memory | unit | Not book-audit; entitlement `WEBSITE_LEAD_CAPTURE` |
| Quote ingestion / identification | pilot | `POST /api/app/quotes`, `/app/quotes` | `tc_quote_threads` + memory | unit | Founder/ops ingest in workspace |
| Scheduled quote follow-up sequences | pilot | `/api/starter/quotes/tick` (1/3/7/14d) | Postgres when durable | unit | Cron every 15m; dry-run SMS without Twilio |
| Stop quote sequence on reply | pilot | Twilio SMS inbound dispatcher | same | unit | Also stops on opt-out / won / lost / human takeover |
| Human takeover inbox | pilot | `/app/inbox`, `/api/app/inbox` | `tc_inbox_items` | unit | Syncs Module A `humanReviewRequired` leads |
| Marketing dashboard mockups | illustrative | UI only | — | — | Hero/demo Illustrative badges |
| Appointment / calendar booking product | pilot | `/app/bookings`, `/api/app/bookings`, `/api/growth/reminders/tick` | growth appointments + memory | unit | SMS confirm + 24h/2h reminders; not Google/Outlook sync |
| Advanced pipeline (stage moves) | pilot | `/app/pipeline`, `/api/app/pipeline` | growth pipeline cards | unit | Growth entitlement `ADVANCED_PIPELINE` |
| Revenue attribution (won deals) | pilot | `/api/app/analytics` (+ pipeline won) | growth revenue events | unit | Recorded when pipeline moves to won with value |
| Google review automation | pilot | `/app/reviews`, `/api/app/reviews`, `/api/growth/reviews/tick` | growth review requests | unit | Post-complete SMS when `googleReviewUrl` set |
| Activity timeline | pilot | `/app/timeline`, `/api/app/timeline` | growth timeline events | unit | Org-scoped; Starter+ via takeover/analytics features |
| Owner notifications (notify email) | pilot | `/api/app/settings`, growth `notifyOwner` | org settings | unit | Email alerts when notify email configured |
| Multi-tenant SaaS foundation | pilot | `/login`, `/app/*`, `/api/auth/*`, `/api/app/*` | Postgres `tc_*` + memory fallback | unit | Founder-gated pilot workspace — not self-serve SaaS launch |
| Plan entitlements (Starter/Growth) | pilot | `src/product/saas/entitlements.ts` | org.plan | unit | Backend assert; UI mirrors |
| Pilot client workspace (basic) | pilot | `/app` | Module A leads when linked | unit | No fabricated recovered revenue; audit-first sales motion |
| Durable workflows across restarts | pilot | Postgres adapter + `schema.sql` | PostgreSQL | unit | Requires `DATABASE_URL` + `MISSED_CALL_DURABLE_STORE=1` (or `SAAS_DURABLE_STORE=1`) and applied schema through `005_crm_webhook_dlq` |
| Quote recovery (ingestion, sequences, opt-out, retries) | pilot | `/api/app/quotes`, `/api/starter/quotes/tick`, SMS inbound | `tc_quote_*` | unit | Starter core — not Growth booking/CRM |
| CRM sync (credentials, mapping, DLQ, conflict handling) | pilot | org `crmWebhookUrl` + `/api/growth/crm/tick` DLQ | `tc_crm_dlq` + memory | unit | Outbound webhook (Zapier/Make/HubSpot); not native HubSpot OAuth mapping |
| Advanced analytics dashboard / exports | pilot | `/api/app/analytics` (+ `?format=csv`) | growth lists | unit | CSV export for entitled Growth orgs |
| Real calendar provider scheduling | planned | — | — | — | Phase 4 — Google/Outlook sync not built; in-app booking is pilot |

## Recommended repair order

1. **Stop a false launch** — marketing honesty, no demo contacts in prod, Twilio fail-closed, opt-out, legal placeholders.
2. **Foundation** — Postgres store, multi-tenant ownership, outbox, retention, monitoring, backup/restore.
3. **Workflow correctness** — covered by unit suites (`missed-call-hardening`, `missed-call-dangerous-branches`).
4. **Advertised product** — quote recovery, CRM, dashboard, scheduling (only after durable foundation).
5. **Earn launch readiness** — production E2E, a11y evidence, legal review, pilot traffic.

See README production go-live checklist. Do not call TradeCatch production-ready until every item there is true.

## Marketing rules

1. Hero and footer must describe **missed-call text-back + collection + technician alert** as the shipping pilot path.
2. Growth modules (booking, pipeline, revenue attribution, Google reviews, timeline) may be described as **pilot** for entitled orgs — not as self-serve SaaS launch or calendar-provider sync.
3. Do not restore a claim to “live” until: route + durable store + monitoring + acceptance tests exist.
4. Module A must not be marketed as production SaaS until `durableMissedCallStore` and Twilio are green in `/api/health` (ops view).
5. Starter quote follow-up / website capture may be described as **pilot** for linked orgs — not as self-serve SaaS launch.

## P0 launch blockers (engineering)

1. Configure PostgreSQL (`DATABASE_URL` + `MISSED_CALL_DURABLE_STORE=1`) and apply `schema.sql`; the memory fallback is development-only.
2. Never advertise Growth booking / revenue attribution / Google reviews as production-ready SaaS; keep status **pilot** until durable store + monitoring + acceptance tests are green.
3. Production Twilio must be configured; dry-run SIDs are forbidden in production.
4. Technician replies must stay bound to the current open alert + action token (implemented).
