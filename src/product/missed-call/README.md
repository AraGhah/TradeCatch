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

- `GET /api/missed-call/leads?clientAccountId=` — list leads
- `GET /api/missed-call/leads/[id]` — lead + full conversation
- `PATCH /api/missed-call/leads/[id]` — manual corrections (dev/sandbox by default)

Each lead stores: conversation, technicians alerted, response time, accepted, booking flags, estimated/final value, correction audit trail.

## Local sandbox

```bash
curl -X POST http://localhost:3000/api/missed-call/sandbox \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"call\",\"callerE164\":\"+15145551234\",\"answered\":false,\"abandoned\":false}"
```

## Tests

```bash
npm run test:unit
```

## Persistence

In-memory store in `runtime.ts` — swap for DB before multi-instance production.
