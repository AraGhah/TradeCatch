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
| Missed-call detection (Twilio voice status) | pilot | `/api/twilio/voice/status` | Postgres when enabled; memory fallback | unit | Single-tenant |
| Customer SMS recovery + collection | pilot | `/api/twilio/sms/inbound`, engine | Postgres when enabled; memory fallback | unit | FR/EN, opt-out |
| Technician job card + ACCEPTER/REFUSER/APPELER | pilot | engine + tech alerts | Postgres when enabled; memory fallback | unit | Bound by action token + open alert |
| Technician escalation timers | pilot | `/api/missed-call/escalations/tick` | Postgres when enabled; memory fallback | unit | Ops bearer required |
| Ops lead list / CRM correction API | pilot | `/api/missed-call/leads*` | Postgres when enabled; memory fallback | unit | Not a client dashboard |
| Book-audit lead capture (marketing) | live | `/api/book-audit` | Postgres when enabled + email/webhook | unit + e2e | Site lead gen |
| Quote ingestion / identification | planned | — | — | — | Do not claim |
| Scheduled quote follow-up sequences | illustrative / planned | UI only | — | — | Demo components |
| Stop quote sequence on reply | planned | — | — | — | Do not claim |
| Client dashboard / recovered-revenue reporting | illustrative | UI only | — | — | Marked Illustrative |
| Appointment / calendar booking product | planned | optional `NEXT_PUBLIC_CALENDAR_URL` CTA | — | — | External link only |
| Multi-tenant SaaS | planned | — | — | — | Single-tenant v1 |
| Durable workflows across restarts | pilot | Postgres adapter + `schema.sql` | PostgreSQL | unit | Requires `DATABASE_URL` + `MISSED_CALL_DURABLE_STORE=1` and applied schema |
| Quote recovery (ingestion, sequences, opt-out, retries) | planned | — | — | — | Phase 4 — do not advertise |
| CRM sync (credentials, mapping, DLQ, conflict handling) | planned | — | — | — | Phase 4 — do not advertise |
| Dashboard / revenue attribution / exports | planned | — | — | — | Phase 4 — do not advertise |
| Real calendar provider scheduling | planned | — | — | — | Phase 4 — do not advertise |

## Recommended repair order

1. **Stop a false launch** — marketing honesty, no demo contacts in prod, Twilio fail-closed, opt-out, legal placeholders.
2. **Foundation** — Postgres store, multi-tenant ownership, outbox, retention, monitoring, backup/restore.
3. **Workflow correctness** — covered by unit suites (`missed-call-hardening`, `missed-call-dangerous-branches`).
4. **Advertised product** — quote recovery, CRM, dashboard, scheduling (only after durable foundation).
5. **Earn launch readiness** — production E2E, a11y evidence, legal review, pilot traffic.

See README production go-live checklist. Do not call TradeCatch production-ready until every item there is true.

## Marketing rules

1. Hero and footer must describe **missed-call text-back + collection + technician alert** as the shipping pilot path.
2. Quote follow-up, dashboards, and recovered-revenue numbers must stay labelled **Illustrative** or **planned for pilots**.
3. Do not restore a claim to “live” until: route + durable store + monitoring + acceptance tests exist.
4. Module A must not be marketed as production SaaS until `durableMissedCallStore` and Twilio are green in `/api/health` (ops view).

## P0 launch blockers (engineering)

1. Configure PostgreSQL (`DATABASE_URL` + `MISSED_CALL_DURABLE_STORE=1`) and apply `schema.sql`; the memory fallback is development-only.
2. Never advertise quote follow-up as live until sequences exist.
3. Production Twilio must be configured; dry-run SIDs are forbidden in production.
4. Technician replies must stay bound to the current open alert + action token (implemented).
