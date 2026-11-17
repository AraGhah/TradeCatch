# Bland AI integration and Cal.com scheduling

Operator guide for connecting a Bland AI inbound voice agent to TradeCatch, and for using a contractor's Cal.com account as the real calendar.

**Nothing in this repository switches any of it on.** There is no Bland number, no secret, no Cal.com enrollment and no Bland tool until you create them by hand with the steps below. Nothing here changes Twilio numbers, SIP trunks, carrier forwarding, production credentials or outbound campaigns.

## What was built

```
caller → Bland number → Bland agent (pathway)
           │  custom tools  (Authorization: Bearer BLAND_TOOL_SECRET)
           ├─ GET  /api/bland/config        business facts + transfer numbers
           ├─ POST /api/bland/availability  real openings
           ├─ POST /api/bland/details       confirmed name, callback number, address
           ├─ POST /api/bland/book          book one offered time
           ├─ POST /api/bland/appointments  find / move / cancel / text the caller
           ├─ POST /api/bland/report        what the caller needs
           └─ POST /api/bland/webhook       post-call webhook (HMAC signature, no bearer)
```

The Bland endpoints are a thin adapter over the services the LiveKit receptionist already uses. No booking, tenant, plan or CRM rule was copied:

| Concern | Reused from |
|---|---|
| Call session, idempotency, confirmed details, finalization, owner summary, CRM sync | `src/product/receptionist/agent-calls.ts` (a second instance with `channel: "bland"`: call ids are stored as `bl_<call_id>`, booking keys as `rcb:`) |
| Appointments the caller owns, move, cancel, text | `src/product/receptionist/agent-appointments.ts` |
| Booking, availability, holds, double-booking protection | `src/product/scheduling/service.ts` through `createPhoneScheduler` |
| Plan limits | `src/product/receptionist/plan-limits.ts` |
| Rate limits | `tools.bland-call` in `src/lib/rate-limit-policy.ts` |

New code: `src/product/bland/` (auth, trusted routes, tenant resolution, transfer numbers, SMS guard, config, webhook), `src/app/api/bland/*`, `src/product/scheduling/address.ts` (address validation), and `src/product/scheduling/calcom/` (Cal.com provider).

## Security model

1. **A dedicated secret.** `BLAND_TOOL_SECRET` opens `/api/bland/*` and nothing else: not leads, escalations, cron or any ops endpoint. The operations secret is rejected on these endpoints. Unlike the ops secret there is no "open when unset in development": a missing, shorter-than-32-characters or reused secret (equal to `MISSED_CALL_OPS_SECRET`, `CRON_SECRET`, `AUTH_SECRET` or `BLAND_WEBHOOK_SECRET`) answers **503**, so a misconfiguration is loud. Comparison is constant-time. `BLAND_TOOL_SECRET_PREVIOUS` keeps the old value valid while you rotate.
2. **The business comes from trusted configuration**, never from the model or the caller. The `to` number Bland sends ({{to}}) is matched exactly against `BLAND_ROUTES_JSON`. No match: 404, there is no default business. A number or a config claimed twice refuses every claimant.
3. **Entitlements on every request**: the receptionist must be enabled, the owner must not have switched the line off (fresh read), the organization must be active, and the organization's *current* plan must include the voice receptionist. The plan's limits (phone booking, live transfer, emergency routing) are applied to the config before it is used.
4. **A call id belongs to one business for good.** Using the same `call_id` against another business answers 409 `call_conflict` and changes nothing.
5. **Bounded, validated input.** 32 KB body cap, strict field limits, field names only in 400 errors (a value may be caller speech). A blank value or an unfilled Bland template (`{{input.x}}`) counts as "not given" and can never replace something the caller confirmed.
6. **The caller is Bland's `from`** (the carrier's caller ID), never a number the model chose. Existing appointments are found only for that number plus a matching name.
7. **The webhook is signed.** `BLAND_WEBHOOK_SECRET` verifies HMAC-SHA256 over the exact raw body (`X-Webhook-Signature`). Unsigned or wrongly signed: 401. No secret: 503. A signed payload for a number that is not routed here is acknowledged and ignored (200), never attributed to someone.
8. **Per-call rate limit** `tools.bland-call` (a burst of 120 requests per business and call, then one more every 5 s), instead of per address.

## Operator checklist (all manual)

1. Generate two different secrets: `openssl rand -base64 32` for `BLAND_TOOL_SECRET`, and use the signing secret Bland gives you (or one you generate) as `BLAND_WEBHOOK_SECRET`. Set both as server environment variables. Do not reuse any other secret.
2. Choose the receptionist config that answers each Bland number and set `BLAND_ROUTES_JSON`:

   ```json
   [
     { "toE164": "+14385550100", "configId": "rc_org_abc" },
     { "toE164": "+14385550101", "configId": "rc_org_def", "smsE164": "+14385550199" }
   ]
   ```

   - `configId` is the receptionist config id: an `id` in `RECEPTIONIST_CONFIG_JSON`, or the id of an owner profile config.
   - `smsE164` is only for a number Bland itself texts from (see [SMS routing](#sms-routing)). Omit it otherwise.
3. In Bland, create the custom tools below (replace `https://YOUR_TRADECATCH_HOST` and `YOUR_BLAND_TOOL_SECRET`), attach them to the inbound number's agent or pathway, and point the post-call webhook at `https://YOUR_TRADECATCH_HOST/api/bland/webhook`.
4. Make a test call to the Bland number and check the call in TradeCatch (the call appears with channel `bland` and the transcript, summary and owner notice of any other receptionist call).
5. Only then publish the number.

The field names used for Bland's own settings (tool definition, inbound number, webhook) come from Bland's documentation at the time of writing. Check them against the Bland dashboard before you rely on them.

## Bland custom tools

Every tool sends the same three Bland built-ins: `to` = `{{to}}` (the number that was dialed), `from` = `{{from}}` (the caller), `call_id` = `{{call_id}}`. Each tool needs the header `Authorization: Bearer YOUR_BLAND_TOOL_SECRET`. The model-filled fields use `{{input.<field>}}`; every one is listed under `required` so the model sends an empty string rather than leaving it out.

Do **not** enable Bland's native `cal-com-v2` or `bland-sms` tools on this agent: Cal.com bookings must go through `book_appointment` (confirmation, idempotency, reconciliation), and texts through `text_caller` (opt-outs, one sender, one outbox).

### 1. `get_business_config` (call this first)

```json
{
  "name": "get_business_config",
  "description": "Load this business's name, language, hours, whether booking and texting are available, approved facts, and the only phone numbers a call may be transferred to. Call it once at the very start of every call, before anything else.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/config",
  "method": "GET",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "query": { "to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}" },
  "input_schema": { "example": {}, "type": "object", "properties": {} },
  "timeout": 10000,
  "response": {
    "business_name": "$.config.business_name",
    "receptionist_name": "$.config.receptionist_name",
    "timezone": "$.config.timezone",
    "language": "$.config.language",
    "after_hours": "$.config.after_hours",
    "booking_enabled": "$.config.booking_enabled",
    "sms_text_enabled": "$.config.sms_text_enabled",
    "business_context": "$.config.business_context",
    "normal_transfer_number": "$.config.normal_transfer_number",
    "backup_transfer_number": "$.config.backup_transfer_number",
    "emergency_transfer_number": "$.config.emergency_transfer_number",
    "transfer_available": "$.config.transfer_available",
    "emergency_transfer_available": "$.config.emergency_transfer_available",
    "transfer_unavailable_reason": "$.config.transfer_unavailable_reason",
    "config_warnings": "$.config.warnings"
  }
}
```

Every value is a string (`"true"` / `"false"`, an empty string for an unusable number), so a pathway that forgets to branch still fails safe.

### 2. `check_availability`

```json
{
  "name": "check_availability",
  "description": "Get the real openings for a new appointment. Only times returned here may be offered. If it returns ok false, do not invent times: offer a callback instead. Read the offer labels aloud; use startAt when booking.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/availability",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}",
    "from": "{{from}}",
    "call_id": "{{call_id}}",
    "preferred_time": "{{input.preferred_time}}",
    "issue": "{{input.issue}}"
  },
  "input_schema": {
    "example": { "preferred_time": "jeudi matin", "issue": "chauffe-eau qui fuit" },
    "type": "object",
    "properties": {
      "preferred_time": "What the caller asked for, in their words. Empty string if they have no preference.",
      "issue": "The job in a few words, to pick the right service. Empty string if unknown."
    },
    "required": ["preferred_time", "issue"]
  },
  "speech": "Un instant, je regarde l'horaire.",
  "timeout": 10000,
  "response": {
    "availability_ok": "$.availability.ok",
    "availability_reason": "$.availability.reason",
    "availability_service_id": "$.availability.serviceId",
    "availability_service_name": "$.availability.serviceName",
    "availability_timezone": "$.availability.timezone",
    "availability_matches_request": "$.availability.matchesRequest",
    "availability_offers": "$.availability.offers"
  }
}
```

`availability_reason` is `booking_disabled` (phone booking is off), `not_bookable` (no matching bookable service, or the real calendar cannot confirm times right now: Google or Cal.com not connected, refused or unreachable), `unavailable` or `no_openings`. In every `ok: false` case the agent must not name a time.

### 3. `save_caller_details` (after reading the details back and getting a yes)

```json
{
  "name": "save_caller_details",
  "description": "Save the caller's name, callback number and service address AFTER you read them back and the caller said yes. Send the address in parts. If it says an address part is missing, ask only for that part and call again. Never book with details that were not saved here.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/details",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}",
    "from": "{{from}}",
    "call_id": "{{call_id}}",
    "caller_name": "{{input.caller_name}}",
    "callback_phone": "{{input.callback_phone}}",
    "use_caller_id": "{{input.use_caller_id}}",
    "street": "{{input.street}}",
    "unit": "{{input.unit}}",
    "city": "{{input.city}}",
    "province": "{{input.province}}",
    "postal_code": "{{input.postal_code}}"
  },
  "input_schema": {
    "example": {
      "caller_name": "Marie Tremblay",
      "callback_phone": "",
      "use_caller_id": "true",
      "street": "12 rue des Pins",
      "unit": "",
      "city": "Laval",
      "province": "QC",
      "postal_code": "H7N 1A1"
    },
    "type": "object",
    "properties": {
      "caller_name": "Full name the caller confirmed. Empty string if not confirmed yet.",
      "callback_phone": "A different callback number the caller gave. Empty string to use none.",
      "use_caller_id": "\"true\" only if the caller said to use the number they are calling from, otherwise \"false\".",
      "street": "Civic number and street, as confirmed. Empty string if not confirmed yet.",
      "unit": "Apartment or unit, or empty string.",
      "city": "City, as confirmed, or empty string.",
      "province": "Province, as confirmed (name or QC/ON/...), or empty string.",
      "postal_code": "Canadian postal code if the caller gave it, or empty string."
    },
    "required": ["caller_name", "callback_phone", "use_caller_id", "street", "unit", "city", "province", "postal_code"]
  },
  "timeout": 10000,
  "response": {
    "details_status": "$.details.status",
    "details_missing": "$.details.missing",
    "details_rejected": "$.details.rejected",
    "saved_name": "$.details.confirmed.callerName",
    "saved_callback": "$.details.confirmed.callbackE164",
    "saved_address": "$.details.confirmed.serviceAddress",
    "address_status": "$.details.address.status",
    "address_formatted": "$.details.address.formatted",
    "address_missing": "$.details.address.missing",
    "address_problem": "$.details.address.problem",
    "address_understood": "$.details.address.understood",
    "address_recommended": "$.details.address.recommended"
  }
}
```

An address is saved only when it has a street number and street name, a city and a province (a postal code is recommended, not required). A PO box, a postal code that does not match the province, or a malformed postal code is refused with `address_problem`. `details_status` is `saved` or `rejected`; `details_missing` lists what is still needed before booking (`name`, `callback number`, `service address`).

### 4. `book_appointment`

```json
{
  "name": "book_appointment",
  "description": "Book one of the times returned by check_availability. Say the appointment is booked ONLY if booking_status is confirmed; read booking_label aloud. Name, callback number and address come from save_caller_details, not from this call. If booking_status is taken, offer the new times. If missing_details or details_conflict, fix that with the caller and save_caller_details first. If request or error, say the team will call back to confirm; never say it is booked.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/book",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}",
    "from": "{{from}}",
    "call_id": "{{call_id}}",
    "start_at": "{{input.start_at}}",
    "service_id": "{{input.service_id}}",
    "service_name": "{{input.service_name}}"
  },
  "input_schema": {
    "example": {
      "start_at": "2026-10-22T14:00:00.000Z",
      "service_id": "svc_abc",
      "service_name": "Drain inspection"
    },
    "type": "object",
    "properties": {
      "start_at": "The startAt value of the offer the caller chose, exactly as returned by check_availability.",
      "service_id": "availability_service_id from check_availability, or empty string.",
      "service_name": "availability_service_name from check_availability, or empty string."
    },
    "required": ["start_at", "service_id", "service_name"]
  },
  "speech": "Parfait, je réserve ce moment.",
  "timeout": 20000,
  "response": {
    "booking_status": "$.booking.status",
    "booking_label": "$.booking.label",
    "booking_start_at": "$.booking.startAt",
    "booking_appointment_id": "$.booking.appointmentId",
    "booking_reason": "$.booking.reason",
    "booking_missing": "$.booking.missing",
    "booking_conflict_fields": "$.booking.fields",
    "booking_offers": "$.booking.offers",
    "booking_address_status": "$.booking.address.status",
    "booking_address_missing": "$.booking.address.missing"
  }
}
```

Keep `timeout` generous (20000 here). A normal booking takes a second or two, but with Cal.com the server may make several provider calls in a row (a 4 s availability check, an 8 s booking request, and a 6 s cancel when Cal.com answers something other than `accepted`), so a slow Cal.com can take 15 s or more. If Bland's own limit on a tool timeout is lower, use that limit, never less than 12000. When Bland gives up first, the booking may still complete on the server: repeating the call for the same time is safe, books nothing twice, and returns the same `confirmed` answer. Tell the model to retry once and otherwise promise a callback.

`booking_status`:

| Value | What to do |
|---|---|
| `confirmed` | Say it is booked, read `booking_label`. The provider (Cal.com or the built-in calendar) accepted it. |
| `taken` | The time was just taken. Offer `booking_offers`. |
| `missing_details` | Ask for what `booking_missing` lists, then `save_caller_details`, then book again. |
| `details_conflict` | A value disagrees with what the caller confirmed (`booking_conflict_fields`). Re-confirm, save, book again. |
| `request` | Not confirmed (`booking_reason`, for example `calendar_unavailable`, `calendar_error`, `booking_disabled`). Say the team will confirm by callback. |
| `error` | Same as `request`. |

### 5. `find_appointments`, `move_appointment`, `cancel_appointment`, `text_caller`

All four call `POST /api/bland/appointments`; only the fixed `action` differs. Same headers as above.

```json
{
  "name": "find_appointments",
  "description": "List the upcoming appointments of the person calling, to move or cancel one. Ask for their name first.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/appointments",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}",
    "action": "find",
    "caller_name": "{{input.caller_name}}"
  },
  "input_schema": {
    "example": { "caller_name": "Marie Tremblay" },
    "type": "object",
    "properties": { "caller_name": "The caller's name. Empty string if already given earlier in the call." },
    "required": ["caller_name"]
  },
  "timeout": 10000,
  "response": {
    "find_status": "$.result.status",
    "found_appointments": "$.result.appointments"
  }
}
```

```json
{
  "name": "move_appointment",
  "description": "Move one of the caller's appointments to a time returned by check_move_availability. Say it moved ONLY if move_status is moved.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/appointments",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}",
    "action": "move",
    "caller_name": "{{input.caller_name}}",
    "appointment_id": "{{input.appointment_id}}",
    "start_at": "{{input.start_at}}"
  },
  "input_schema": {
    "example": { "caller_name": "Marie Tremblay", "appointment_id": "appt_123", "start_at": "2026-10-22T15:00:00.000Z" },
    "type": "object",
    "properties": {
      "caller_name": "The caller's name, or empty string if already given.",
      "appointment_id": "appointmentId from find_appointments.",
      "start_at": "startAt of the new time, exactly as returned by check_move_availability."
    },
    "required": ["caller_name", "appointment_id", "start_at"]
  },
  "timeout": 20000,
  "response": {
    "move_status": "$.result.status",
    "move_label": "$.result.label",
    "move_offers": "$.result.offers"
  }
}
```

```json
{
  "name": "cancel_appointment",
  "description": "Cancel one of the caller's appointments, only after the caller clearly confirmed. Say it is canceled ONLY if cancel_status is canceled.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/appointments",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}",
    "action": "cancel",
    "caller_name": "{{input.caller_name}}",
    "appointment_id": "{{input.appointment_id}}"
  },
  "input_schema": {
    "example": { "caller_name": "Marie Tremblay", "appointment_id": "appt_123" },
    "type": "object",
    "properties": {
      "caller_name": "The caller's name, or empty string if already given.",
      "appointment_id": "appointmentId from find_appointments."
    },
    "required": ["caller_name", "appointment_id"]
  },
  "timeout": 15000,
  "response": { "cancel_status": "$.result.status" }
}
```

```json
{
  "name": "text_caller",
  "description": "Text the caller, at the number they are calling from, either the business details or the confirmation of an appointment. Say a text was sent ONLY if text_status is sent or queued. Not available when sms_text_enabled is false.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/appointments",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}",
    "action": "text",
    "kind": "{{input.kind}}",
    "appointment_id": "{{input.appointment_id}}",
    "caller_name": "{{input.caller_name}}"
  },
  "input_schema": {
    "example": { "kind": "appointment", "appointment_id": "appt_123", "caller_name": "Marie Tremblay" },
    "type": "object",
    "properties": {
      "kind": "business_info or appointment.",
      "appointment_id": "appointmentId when kind is appointment, otherwise empty string.",
      "caller_name": "The caller's name, or empty string if already given."
    },
    "required": ["kind", "appointment_id", "caller_name"]
  },
  "timeout": 10000,
  "response": { "text_status": "$.result.status" }
}
```

`check_move_availability` is `check_availability` with a different body (it needs the appointment to be moved):

```json
{
  "name": "check_move_availability",
  "description": "Get the real openings to MOVE one of the caller's existing appointments. Use the appointmentId from find_appointments.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/availability",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}",
    "appointment_id": "{{input.appointment_id}}",
    "caller_name": "{{input.caller_name}}",
    "preferred_time": "{{input.preferred_time}}"
  },
  "input_schema": {
    "example": { "appointment_id": "appt_123", "caller_name": "Marie Tremblay", "preferred_time": "vendredi après-midi" },
    "type": "object",
    "properties": {
      "appointment_id": "appointmentId from find_appointments.",
      "caller_name": "The caller's name, or empty string if already given.",
      "preferred_time": "What the caller asked for, or empty string."
    },
    "required": ["appointment_id", "caller_name", "preferred_time"]
  },
  "timeout": 10000,
  "response": {
    "availability_ok": "$.availability.ok",
    "availability_reason": "$.availability.reason",
    "availability_offers": "$.availability.offers"
  }
}
```

Statuses: `find_status` is `found`, `not_found`, `name_needed`, `caller_unknown`, `disabled` or `unavailable`. `move_status` is `moved`, `taken`, `not_found`, `disabled` or `error`. `cancel_status` is `canceled`, `not_found`, `disabled` or `error`. `text_status` is `sent`, `queued`, `failed`, `already_sent`, `opted_out`, `unavailable` or `not_found`.

### 6. `record_call_details`

```json
{
  "name": "record_call_details",
  "description": "Save what the caller needs (the problem, the service, when they want it, a message, an email, whether it is an emergency) so the team has it even if the call drops. Safe to call several times as you learn more. It does not end the call.",
  "url": "https://YOUR_TRADECATCH_HOST/api/bland/report",
  "method": "POST",
  "headers": { "Authorization": "Bearer YOUR_BLAND_TOOL_SECRET" },
  "body": {
    "to": "{{to}}", "from": "{{from}}", "call_id": "{{call_id}}",
    "intent": "{{input.intent}}",
    "issue": "{{input.issue}}",
    "service": "{{input.service}}",
    "preferred_time": "{{input.preferred_time}}",
    "message": "{{input.message}}",
    "email": "{{input.email}}",
    "location": "{{input.location}}",
    "emergency": "{{input.emergency}}"
  },
  "input_schema": {
    "example": {
      "intent": "service_request",
      "issue": "Chauffe-eau qui fuit",
      "service": "",
      "preferred_time": "jeudi matin",
      "message": "",
      "email": "",
      "location": "Laval",
      "emergency": "false"
    },
    "type": "object",
    "properties": {
      "intent": "service_request, appointment, faq, transfer, message or other.",
      "issue": "The problem in the caller's words, or empty string.",
      "service": "The kind of service wanted, or empty string.",
      "preferred_time": "When the caller wants it, or empty string.",
      "message": "A message to leave for the team, or empty string.",
      "email": "The caller's email if they gave one, or empty string.",
      "location": "City or area, or empty string.",
      "emergency": "\"true\" only for an emergency (flooding, gas, no heat in winter), otherwise \"false\"."
    },
    "required": ["intent", "issue", "service", "preferred_time", "message", "email", "location", "emergency"]
  },
  "timeout": 10000,
  "response": {
    "report_recorded": "$.report.recorded",
    "report_fields": "$.report.fields"
  }
}
```

Do not put the caller's name, number or address here: only `save_caller_details` can set them, and what the caller confirmed is never replaced by a later note.

### Alternative: load the configuration before the call starts

Instead of (or in addition to) calling `get_business_config`, Bland's inbound-number **dynamic data** can load the same endpoint before the agent speaks. Use `GET https://YOUR_TRADECATCH_HOST/api/bland/config?to={{to}}&from={{from}}&call_id={{call_id}}` with the same bearer header and the same `response` mapping. Bland waits only about 2 seconds for it by default, which is tight for a cold start, so the tool above is the recommended path. If the dynamic data does not arrive, the pathway must still call `get_business_config`.

## Transfers: pathway variables

TradeCatch never lets the model, the caller or Bland pick a number. `get_business_config` returns the only numbers a Transfer node may dial, taken from the business configuration and re-validated at the boundary.

| Pathway variable | Meaning |
|---|---|
| `normal_transfer_number` | Where an ordinary "put me through to someone" call goes. Empty when unusable. |
| `backup_transfer_number` | Tried if the normal line does not answer. Empty unless a normal number is usable and the backup differs from it. |
| `emergency_transfer_number` | The on-call line, any hour. |
| `transfer_available` | `"true"` only when `normal_transfer_number` is usable right now. |
| `emergency_transfer_available` | `"true"` only when `emergency_transfer_number` is usable. |
| `transfer_unavailable_reason` | `plan`, `not_configured`, `after_hours`, `invalid_number` or empty. |

Pathway wiring:

1. After `get_business_config`, add a condition on `transfer_available` before any Transfer node, and another on `emergency_transfer_available` before the emergency Transfer node.
2. In a Transfer Call node set the number to `{{normal_transfer_number}}`, the fallback to `{{backup_transfer_number}}`, and for the emergency node `{{emergency_transfer_number}}`. Do **not** type a literal number into Bland's own transfer setting or the agent-level `transfer_phone_number`: it would bypass every check below.
3. When the condition is false, take a message instead (`record_call_details` with `intent` `message`; with `emergency` `"true"` for an emergency, and tell the caller to call 9-1-1 if anyone is in danger).

A number becomes a variable only when:

- the business's plan includes live transfer (Receptionist Plus) **and** the operator has set `LAUNCH_ENABLE_CALL_TRANSFER=1` (off by default at launch, so on a default deployment `transfer_available` is `"false"` for every business);
- for the normal line, it is inside the owner's transfer hours (`transferHours`: business hours only, or always);
- it is E.164, not a premium (900/976) or N11 number, and, for an owner's profile, a Canadian geographic number (the same rule as the settings form);
- it does not loop back into the line the call came in on: the business's own line, its text number, or **any** Bland number or Bland text number in `BLAND_ROUTES_JSON`.

A rejected number is reported by code in `config_warnings` (`transfer_normal_loops_to_own_line`, …), never by value. After the call, a `transferred_to` that equals the TradeCatch emergency number marks the call as an emergency transfer; the webhook never takes Bland's word for that.

### Audit findings on transfer numbers

- Owner-profile numbers are validated as Canadian geographic numbers when saved. Founder env configs (`RECEPTIONIST_CONFIG_JSON`) and the client-roster fallback are not, so the Bland boundary re-checks every number.
- With no dedicated emergency number, the existing LiveKit agent falls back to the normal line. The Bland adapter does the same, but only when the plan includes emergency routing, so a plan that lost the feature never keeps an emergency path.
- Named departments (`routing`) have no Bland variable: they are not exposed. A pathway can only reach the normal, backup and emergency numbers. Mapping departments would be a separate change.
- Because transfer is behind `LAUNCH_ENABLE_CALL_TRANSFER`, none of this is live until the operator turns that switch on.

## Post-call webhook

Set Bland's post-call webhook to `https://YOUR_TRADECATCH_HOST/api/bland/webhook` and the webhook signing secret to `BLAND_WEBHOOK_SECRET`. The webhook is the authoritative end of a call: it finalizes the record with the transcript, duration, transfer outcome, owner summary, notifications, CRM sync and missed-call recovery, exactly like a LiveKit call. Repeating it (Bland retries) changes nothing, and a call that already ended is never rewritten. Only inbound calls are recorded: a payload whose `inbound` field is not `true` is acknowledged with `{"ignored":"not_inbound"}` and nothing is stored, so if calls never appear, look at that field in Bland's payload first. If a webhook never arrives, the existing receptionist maintenance job (`/api/receptionist/tick`, every 15 minutes) finalizes any call left open for 30 minutes, from what `record_call_details` and `save_caller_details` saved.

## SMS routing

Diagnosis:

- A phone number has one inbound SMS destination. TradeCatch's Twilio responder (`POST /api/twilio/sms/inbound`) owns every number saved as a business's `smsFromNumber` (a unique index) and handles STOP, technician commands, CRM capture and AI replies. If Bland's SMS (its bring-your-own-Twilio mode or its native `bland-sms` tool) were pointed at the same number, whichever was configured last would win: customers could get two replies, or STOP and technician messages could land where TradeCatch cannot see them.

What the code enforces:

1. A number Bland texts from must be declared as `smsE164` in `BLAND_ROUTES_JSON`. It is dropped (and reported by index and reason) if it equals its own voice number, another route's number, or any Bland voice line.
2. On a declared Bland number the Twilio responder never creates an AI reply or a CRM record. STOP and technician commands are still honored (the same path as a suspended business), and the event `tradecatch.sms.bland_number_conflict` is logged.
3. `get_business_config` returns `warnings: ["bland_sms_number_conflict"]` when a declared Bland SMS number is also a business's voice line or SMS number.
4. A business whose own text number is a Bland number gets `sms_text_enabled: "false"`, and `text_caller` answers `unavailable`.
5. `text_caller` is the only way the agent texts: it goes through TradeCatch's own outbox from the business's own SMS number, with opt-out checks and one send per call.

Therefore: leave `smsE164` out unless Bland truly texts from a separate number, never use a number from a business's `smsFromNumber`, and do not enable Bland's native SMS tool. Changing which service answers a number's inbound SMS is a Twilio console change that stays yours to make; none was made.

## Cal.com

Cal.com API v2 can be a business's real calendar. It is optional, per business, and fail-closed.

### Switching it on for a business (operator)

1. `AUTH_SECRET` must be set: the Cal.com API key is sealed (AES-256-GCM) with a Cal.com-specific key derived from it. It is never returned to a browser, logged or put in a URL.
2. Add the business's organization id to `CALCOM_PILOT_ORG_IDS` (comma-separated). It also needs an active, non-demo account and a plan with appointments (Professional or above) with appointment booking on. These are re-checked on every use: a downgrade, a suspension or removing the id stops Cal.com for that business immediately.
3. In the contractor's Cal.com account, create an API key (`cal_live_…`) and event types for what TradeCatch should book. An event type must **book without host confirmation** and be a plain one-to-one event: confirmation-required, seated, recurring and instant event types are refused when you connect. Set each event type's length to the TradeCatch service's duration (a mismatch is allowed but reported as a warning).
4. As an owner or admin of the business, connect:

   ```http
   PUT /api/businesses/{organizationId}/calendar/calcom
   Content-Type: application/json

   {
     "apiKey": "cal_live_xxxxxxxxxxxxxxxx",
     "defaultEventTypeId": 123456,
     "routes": [
       { "eventTypeId": 123457, "serviceId": "svc_water_heater" },
       { "eventTypeId": 123458, "technicianId": "tech_luc" }
     ],
     "attendeeEmail": "bookings@contractor.example"
   }
   ```

   - The key is checked (`GET /v2/me`), every event type is looked up (`GET /v2/event-types`) and every service and technician id must belong to this business. Nothing is stored unless all checks pass; then the business's calendar mode becomes `calcom`.
   - `routes` pick an event type per service and/or per specialist: service+specialist, then specialist, then service, then the default. Specialist routes need Receptionist Plus (`MULTI_CREW_CALENDARS`); on another plan they are refused.
   - `attendeeEmail` is the contact Cal.com requires when a caller on the phone gave none.
   - Omit `apiKey` on a later `PUT` to change the mapping and keep the stored key. `GET` returns the connection without the key. `DELETE` wipes the key and puts the calendar back to the built-in one; bookings already made stay in Cal.com.
5. OAuth is not implemented. The credential is stored as an API key behind a `credentialKind` field so an OAuth connection can be added later without a schema change.

### Behaviour

| Situation | Result |
|---|---|
| Availability | Cal.com decides which times exist (its own calendars, buffers, working hours), asked in the business's timezone so daylight saving is exact. TradeCatch's own hours, holidays, notice, daily limit and existing appointments are applied on top: a time is offered only if **both** agree. |
| Booking | The appointment is `confirmed` only after Cal.com answers `accepted` for the same start time. |
| Cal.com leaves it pending / at another time / rejects it | Not confirmed. The Cal.com booking is cancelled, a request is recorded for the owner, and the caller is told the team will call back. |
| The time was taken a moment ago | A phone caller is offered other times; elsewhere a request is saved. |
| Cal.com is down or the key is refused | No times are offered (`not_bookable`) and bookings are saved as requests (`calendar_unavailable`). **A simulated appointment is never substituted**: a business in Cal.com mode whose connection cannot be used gets a provider that confirms nothing, not the built-in simulated calendar. |
| Repeated request (same idempotency key) | One booking. |
| Reschedule | Moved through Cal.com, which gives the booking a new uid; TradeCatch stores it. If Cal.com holds the move for the host, TradeCatch keeps the old time and flags the booking for the owner. |
| Cancel | Cancelled in Cal.com first. If Cal.com cannot be reached, the appointment is **not** reported as canceled. A booking already cancelled in Cal.com, or one the contractor moved there, is followed to the live booking. |

### Double-booking and consistency

- Per business, bookings run one at a time, with a short hold on the time, so two callers cannot take the same slot even if Cal.com still shows it.
- A ledger row (`tc_calcom_bookings`) is written **before** every booking request. If the answer is lost (timeout, network error, 5xx, unreadable reply), the row stays `creating`; the booking is never repeated blindly and never confirmed.
- Reconciliation runs every 15 minutes with the existing `/api/scheduling/reconcile` job (already scheduled in `src/lib/cloudflare-scheduler.ts`; manually, a `GET` or `POST` with the ops credentials runs every business, and `POST /api/scheduling/reconcile?organizationId=…` runs just one). For each business it:
  - settles open ledger rows: finds a booking by its metadata (`tcAppointmentId`, `tcOrgId`), adopts it only if the appointment was confirmed locally, cancels it otherwise, and after 5 minutes marks an attempt Cal.com never saw as gone;
  - follows the contractor: a booking cancelled in Cal.com cancels the appointment, a moved one moves it (reminders are rescheduled, the owner is notified);
  - reports, without cancelling, a booking Cal.com no longer knows or one awaiting the host;
  - marks the connection `error` and notifies the owner once when Cal.com refuses the key, and skips the business while Cal.com cannot be reached.
- Cal.com is polled, not pushed: a change made in Cal.com shows in TradeCatch at the next run. Webhooks from Cal.com are not used.

### Acceptance test to run before enrolling a real business

Use a test Cal.com account (not the contractor's), with `CALCOM_PILOT_ORG_IDS` set only to a test organization:

1. `PUT` the connection; confirm `GET` shows `connected` and no key.
2. Call or use the dashboard to see openings; compare them with Cal.com's booking page for the same event type, including a date after a daylight-saving change.
3. Book one; confirm it appears in Cal.com with the customer's name, phone, address in the booking metadata, and as `confirmed` in TradeCatch with a `calcom:` event id.
4. Repeat the same booking request; confirm there is still one booking.
5. Move it from TradeCatch; confirm Cal.com shows the new time and TradeCatch the new event id.
6. Cancel it in Cal.com; run `/api/scheduling/reconcile?organizationId=…`; confirm TradeCatch cancelled it.
7. Create an event type that requires confirmation; confirm `PUT` refuses it.
8. Revoke the API key; confirm bookings turn into requests, no times are offered, and the owner is notified at the next reconcile.

## Known limits

- Cal.com: API key only (no OAuth); personal event types of the key's owner only (no team or round-robin); polling, no Cal.com webhooks; event types that need host confirmation are refused rather than supported; a move that Cal.com leaves pending needs the owner to act (it is reported as `reschedule_not_accepted`); `approve` of a pending request does not override Cal.com's availability.
- Bland: department routing is not exposed to pathways; Bland's native Cal.com and SMS tools must stay off; the tool and inbound-settings field names come from Bland's docs and were not exercised against a live Bland account.
- The offered times and the booking depend on the live calendar: this was verified against a simulator that reproduces Cal.com's accepted, pending, taken-slot, lost-answer and server-error behaviour, not against a live Cal.com account.

## Tests

`npm run test:unit` covers (files `tests/unit/bland-*.test.ts`, `tests/unit/calcom-*.test.ts`, with the Cal.com simulator in `tests/unit/helpers/calcom-sim.ts`):

- authentication and secret hygiene, webhook signatures, tenant isolation (cross-business call ids, unrouted numbers, disabled receptionists, plan changes), input limits and field-name-only errors;
- availability, booking, move, cancel and the phone-receptionist mapping, including every Cal.com failure mode (pending, wrong time, taken, 5xx, lost request, lost answer, provider down, no connection);
- transfers (hours, plan, validation, loops), the SMS guard and the Twilio inbound responder on a Bland number, address validation and the preservation of confirmed details;
- Cal.com credentials, enrollment, connection validation and reconciliation.
