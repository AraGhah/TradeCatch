# AI Receptionist — inbound call answering

Answers the contractor's phone, qualifies the caller in French or English,
transfers to a person when appropriate, bridges emergencies to the on-call
line, and sends the owner a structured summary. **Pilot** — see
`docs/CAPABILITY_MATRIX.md` for what may be advertised.

Designed after three open-source projects (ideas, not code):

| Project | What we took |
| --- | --- |
| [kirklandsig/AIReceptionist](https://github.com/kirklandsig/AIReceptionist) | One validated config per business (greeting, hours, routing, FAQ, after-hours message); tools = FAQ / transfer / take message / book; summaries delivered by email, SMS and webhook; transcript retention sweep. It uses OpenAI Realtime + LiveKit + SIP; we stay on Twilio `<Gather>`/`<Say>` (turn-based) so nothing new must be hosted. |
| [fonoster/fonoster](https://github.com/fonoster/fonoster) | Provider-neutral voice verbs (`say`, `gather`, `dial`, `record`, `hangup`). The engine returns `VoicePlan`s; `renderTwiml` targets Twilio and `runVoicePlanLoop` runs them on any imperative channel, e.g. a self-hosted Fonoster `VoiceResponse`. |
| [PaulleDemon/Email-automation](https://github.com/PaulleDemon/Email-automation) | See `src/product/email-automation` — Jinja-style templates, scheduled follow-ups. |

## Call flow

```
incoming ─ greeting (FR + EN) + language menu ─ gather ─┐
   ▲                                                    ├─ emergency guardrail (gas, fire, flood…)
   │                                                    │      └─ SMS alert + <Dial> on-call line
   │                                                    ├─ brain decides: ask │ transfer │ end
   │                                                    │      (rule brain, or LLM brain w/ guardrails)
   └────────── <Gather action> / <Dial action> ─────────┘
call status ─ finalize once ─ summary ─ email/SMS/webhook ─ /app/calls ─ timeline
              └─ hung up before any details → Module A missed-call SMS recovery
```

Safety rules (enforced in code, not prompts):

- Emergencies are detected **before** any brain runs, with the same
  `HARDCODED_CRITICAL_TRIGGERS` as Module A. The caller is told to dial 9-1-1
  and is bridged to `emergencyTransferE164`; the owner is texted immediately.
- The agent never diagnoses, gives repair/safety instructions, quotes prices or
  promises an arrival time / booked slot (approved copy in `prompts.ts`; the LLM
  prompt forbids it and replies are length-capped).
- LLM output is Zod-validated. Transfers only to configured routing ids, never
  after hours. Any error, timeout, or invalid output falls back to the rule brain.
- Failure never means dead air: a technical error apologizes, then dials
  `fallbackTransferE164` or records a voicemail.
- Twilio webhooks reuse `assertTwilioWebhook` (fail-closed in production).
  Production refuses the in-memory session store.

## Setup

1. `npm run db:schema` (adds `rc_call_sessions`, migration `006_ai_receptionist`).
2. Twilio number → **A call comes in**: `POST /api/twilio/voice/receptionist/incoming`;
   **Call status changes**: `POST /api/twilio/voice/receptionist/status`.
   Set `MISSED_CALL_PUBLIC_WEBHOOK_BASE` so signatures verify behind Cloudflare.
3. Enable a profile — either `RECEPTIONIST_ENABLED=1` (derived from the Module A
   client) or `RECEPTIONIST_CONFIG_JSON`.
4. Cron: `/api/receptionist/tick` runs every 15 minutes (already in
   `wrangler.jsonc` schedules) to finalize lost calls and purge transcripts.
5. Try it locally without Twilio:

```bash
curl -X POST localhost:3000/api/receptionist/sandbox -H "content-type: application/json" \
  -d '{"action":"start","callSid":"CA_test_1","from":"+15145559876","to":"<your number>"}'
# → verbs + TwiML; continue with {"action":"say","sessionId":"rcs_…","speech":"…"}
# finish with {"action":"end","callSid":"CA_test_1","status":"completed","duration":40}
```

## `RECEPTIONIST_CONFIG_JSON` (one object, or an array for several businesses)

Only `id`, `clientAccountId`, `phoneNumberE164`, `businessName` are required.

```json
{
  "id": "rc_nord",
  "clientAccountId": "client_nord",
  "phoneNumberE164": "+14385597001",
  "businessName": "Nord Plomberie",
  "timezone": "America/Toronto",
  "businessHours": { "start": "08:00", "end": "17:00", "days": [1, 2, 3, 4, 5] },
  "languages": ["fr", "en"],
  "defaultLanguage": "fr",
  "voices": { "fr": "Polly.Gabrielle-Neural", "en": "Polly.Joanna-Neural" },
  "greetingFr": "Bonjour, Nord Plomberie. Je suis l'assistante virtuelle.",
  "personality": "Chaleureuse, brève, professionnelle.",
  "businessFacts": "Plomberie résidentielle à Montréal et Laval. Estimations gratuites.",
  "routing": [
    { "id": "billing", "name": "Facturation", "phoneE164": "+14385597002", "keywords": ["facture", "billing"] }
  ],
  "emergencyTransferE164": "+14385597003",
  "fallbackTransferE164": "+14385597004",
  "afterHoursMode": "take_message_emergency_transfer",
  "faqs": [
    { "id": "hours", "keywords": ["heures d'ouverture", "opening hours"],
      "answerFr": "Du lundi au vendredi, de 8 h à 17 h.", "answerEn": "Monday to Friday, 8 a.m. to 5 p.m." }
  ],
  "collectPreferredTime": true,
  "maxTurns": 12,
  "notifications": [
    { "type": "email", "to": "owner@nord.example" },
    { "type": "sms", "toE164": "+14385597005" },
    { "type": "webhook", "url": "https://hooks.example.com/calls", "secret": "at-least-8-chars" }
  ],
  "smsRecoveryOnIncomplete": true,
  "transcriptRetentionDays": 90
}
```

Production validation (`validateReceptionistConfig`) rejects reserved demo /
`555` numbers, requires a live human (`emergencyTransferE164` or
`fallbackTransferE164`) and at least one notification channel.

## Conversation brain

| `RECEPTIONIST_LLM_PROVIDER` | Behavior |
| --- | --- |
| *(unset, no keys)* / `none` | Deterministic rule brain (slot-filling, FAQ, routing) — no AI cost, fully tested. |
| `anthropic` (default if `ANTHROPIC_API_KEY`) | Claude via the Messages API with a forced tool call. Default model `claude-haiku-4-5-20251001` (low latency); override with `RECEPTIONIST_LLM_MODEL`. |
| `openai` | Any OpenAI-compatible `/chat/completions` endpoint. Set `RECEPTIONIST_LLM_BASE_URL` to self-host (Ollama, vLLM, LocalAI) so caller audio transcripts never leave your infrastructure. `RECEPTIONIST_LLM_MODEL` is required. |

Latency budget: Twilio waits ~15 s for a webhook. `RECEPTIONIST_LLM_TIMEOUT_MS`
(default 4500) bounds each turn; on timeout the rule brain answers.

## Running on self-hosted Fonoster instead of Twilio

The engine is transport-neutral. In a Fonoster voice app:

```ts
import VoiceServer from "@fonoster/voice";
import { runVoicePlanLoop } from "@/product/receptionist";

new VoiceServer().listen(async (req, voice) => {
  await voice.answer();
  const first = await engine.startCall({ callSid: req.sessionRef, fromE164: req.callerNumber, toE164: req.ingressNumber });
  await runVoicePlanLoop(first, {
    say: (text, o) => voice.say(text, { /* map o.voice / o.language to your TTS */ }),
    gather: async (o) => {
      for (const p of o.prompts) await voice.say(p.text);
      const r = await voice.gather({ source: "speech" });
      return { speech: r.speech };
    },
    dial: async (n) => { await voice.dial(n); return { status: "completed" }; },
    record: async () => { await voice.record(); return {}; },
    hangup: () => voice.hangup(),
  }, {
    onGather: (g) => engine.handleGather({ sessionId: g.sessionId!, speech: g.speech, digits: g.digits }),
    onDial: (d) => engine.handleDialResult({ sessionId: d.sessionId!, dialStatus: d.status }),
    onVoicemail: (v) => engine.handleVoicemail({ sessionId: v.sessionId!, recordingUrl: v.recordingUrl }),
  });
  await engine.handleCallStatus({ callSid: req.sessionRef, callStatus: "completed" });
});
```

This wiring is an **untested sketch** (Fonoster is not a dependency of this
repo). Only `ingressNumber`, `sessionRef` and the verbs `answer / say / gather /
dial / record / hangup` come from Fonoster's public docs; the caller-number
field (`req.callerNumber` above) and the `say` / `dial` / `record` options are
assumptions — check them against the Fonoster version you deploy. The
imperative runner itself is covered by `tests/unit/receptionist-core.test.ts`.

## Website ↔ receptionist sync

- **Public demo** — `/ai-receptionist#try-it` runs this same engine (rule brain
  only) against a fictional plumbing business. `POST /api/receptionist/demo`
  has no side effects: no SMS, email, dialed number, database write or LLM call.
  The server keeps no state; each response carries the session as an
  HMAC-signed token (30 min) that the browser sends back. Rate limited per IP;
  `RECEPTIONIST_DEMO=0` disables it; it needs `AUTH_SECRET` in production.
- **Known callers (owner-facing only)** — when a call is finalized,
  `lookupCallerContext` checks whether the number (caller ID or the callback the
  caller gave) matches a lead from the contractor's website form
  (`POST /api/website-leads`) or an earlier AI call. The result appears in the
  summary, the notifications and `/app/calls`. It is **never spoken to the
  caller**, because caller ID can be spoofed.
- **Write-back** — `syncFinalizedCall` runs after every call: it logs a timeline
  event; for calls with a real request it updates the matching website lead
  (appends the call note, `qualified`, or `needs_attention` and stops the SMS
  bot on emergencies) and, on the Growth plan, creates one pipeline card per
  phone number per week (source `missed_call` — the pipeline's phone-origin
  source; no schema change). FAQ-only calls and pure transfers create nothing.
## Client-editable profile (multi-tenant)

Owners edit their receptionist from **`/app/receptionist`** (`GET/PUT /api/app/receptionist`,
owner/admin only): languages, greetings, after-hours messages, hours, business
facts, departments, FAQ, emergency + fallback lines, summary email/SMS.

Who controls what:

| | Owner (`/app/receptionist`) | Founder (`POST /api/receptionist/ops/profile`, ops bearer + `X-Ops-Actor`) |
| --- | --- | --- |
| Content (greetings, FAQ, routing, hours…) | ✅ | — |
| Twilio number the profile answers | ❌ | ✅ |
| Activation on / off | ❌ | ✅ |

- Nothing answers until the founder activates it (paid plan + Twilio cost). An
  owner payload can never change the number or activation (ignored server-side).
- Dial targets (departments, emergency, fallback, SMS) must be **Canadian
  geographic numbers** — premium, international, Caribbean and N11 numbers are
  rejected (toll-fraud guard). A transfer to the number the receptionist answers
  is rejected (loop). The founder can still use any number through
  `RECEPTIONIST_CONFIG_JSON`.
- Activation runs the same production checks as the founder config, and one
  number can belong to one organization (409 otherwise).
- Profiles live in `rc_profiles`. Each server instance re-reads them at most
  every 30 s (`PROFILE_CACHE_TTL_MS`) and immediately after a save/activation,
  so a change reaches other instances within ~30 s.
- The founder env config wins when it defines the same number. A tenant profile
  never answers an unknown number (no single-profile fallback), and an
  unlinked, suspended or invalid profile is skipped and logged.

Email follow-up of website leads: see `src/product/email-automation` —
auto-enroll is **off by default**, chosen per organization at `/app/email`, and
enrolls a website lead only when it has an email **and** a `consentAt`
timestamp from the contractor's form (CASL express consent); never spam or
unsubscribed contacts. It runs from `POST /api/website-leads` and never fails
lead capture. The response reports `emailSequence: { enrolled, reason }`.

## Known limits

- Turn-based Twilio speech recognition — expect ~1–3 s per turn, not
  sub-second speech-to-speech. A realtime path (OpenAI Realtime / LiveKit) would
  be a new transport on top of the same config and summary pipeline.
- No calendar availability lookup or booking by phone: the agent captures a
  preferred time window for a human to confirm.
- Call recording is limited to voicemail; whole-call recording needs a consent
  announcement decision (Québec Law 25 / Criminal Code s.184) before enabling.
- Not validated on live Twilio traffic yet.
