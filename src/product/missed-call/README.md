# Module A — Missed-call recovery

Workflow: **Missed call → SMS → collect → classify → job card → tech actions → customer notify → CRM outcome**

Domain: `src/product/missed-call/`. Webhooks: `src/app/api/twilio/`.

## Service-area checking

- Compares the service address to `approvedServiceAreas` (cities, postal prefixes, tokens).
- **Inside** → proceed normally.
- **Outside** or **uncertain** → flagged (`serviceAreaFlagged`), **human review** — never auto-reject.

## Urgency handling (rules only — no AI)

- Contractor `urgencyRubric` (keyword lists).
- Conservative **hard-coded** triggers: gas, fire, flooding, exposed electrical, etc. (`HARDCODED_CRITICAL_TRIGGERS`).
- Uncertain/short descriptions → human review.
- **No diagnoses, no invented safety instructions** in automated messages.
- Critical cases → human review + logged events (`urgency_classified`, `urgency_escalated`).

## Technician alerts (system-owned)

Configure per client:

- `technicianRoster`, `mainTechnicianId`, `backupTechnicianIds`, `ownerTechnicianId`
- `onCallSchedule` (day/time → technician)
- `escalationPolicy` (primary / backup / owner timeouts)

On dispatch the system sends a **job card** SMS with:

- Customer name, phone, address, issue, photos, urgency, service-area flag
- Actions: **ACCEPTER**, **REFUSER**, **APPELER**
- No promised arrival time without technician confirmation

Escalation:

- `POST /api/missed-call/escalations/tick` (cron-friendly) advances timers → backup → owner → human if exhausted.

## CRM / dashboard API

Requires `Authorization: Bearer $MISSED_CALL_OPS_SECRET` (or `CRON_SECRET`).

- `GET /api/missed-call/leads?clientAccountId=` — list leads
- `GET /api/missed-call/leads/[id]` — lead + full conversation
- `PATCH /api/missed-call/leads/[id]` — manual corrections (dev/sandbox by default)
- `POST /api/missed-call/escalations/tick` — advance escalation timers (cron)

Each lead stores: conversation, technicians alerted, response time, accepted, booking flags, estimated/final value, correction audit trail.

## Local sandbox

Requires ops bearer auth when `MISSED_CALL_OPS_SECRET` / `CRON_SECRET` is set.
In local development with no secret configured, auth is open for DX.

```bash
curl -X POST http://localhost:3000/api/missed-call/sandbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MISSED_CALL_OPS_SECRET" \
  -d "{\"action\":\"call\",\"callerE164\":\"+15145551234\",\"answered\":false,\"abandoned\":false}"
```

## Tests

```bash
npm run test:unit
```

## Persistence

**Default today:** in-memory store in `runtime.ts` — **not** multi-instance / serverless safe.

Before Module A go-live:

1. Apply `schema.sql` to Postgres (`DATABASE_URL`), including `mc_sms_suppressions` and `mc_outbound_messages`.
2. Implement a durable `MissedCallStore` adapter and wire it in `runtime.ts`.
3. Load complete client config via `MISSED_CALL_CLIENT_CONFIG_JSON` (or full `MISSED_CALL_*` env). Production rejects demo fixtures and reserved numbers.
4. Confirm `/api/health` (ops auth) reports `moduleA.ready: true`.
5. Enable Twilio Advanced Opt-Out; verify STOP persists suppression across new calls.
6. Verify escalation chain contacts every backup before owner; inactive techs are skipped.

See `docs/CAPABILITY_MATRIX.md` for what may be advertised vs what is illustrative/planned.
