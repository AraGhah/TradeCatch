# TradeCatch receptionist — LiveKit voice agent

Answers calls that arrive from the Twilio SIP trunk, using each business's own
settings from TradeCatch, books appointments against the real calendar, and can
**really transfer** the call.

```
caller → Twilio number → SIP trunk → LiveKit → this agent
                                          │
   GET  /api/receptionist/agent-config?number=<dialed number>   rendered prompt, language menu,
                                                                 silence wording, transfer lines
   POST /api/receptionist/agent/availability                    real open times
   POST /api/receptionist/agent/book                            reserves one (idempotent)
   POST /api/receptionist/agent/report                          saves the finished call
                              (all with the ops bearer; see "Safety")
```

Companies, prompts, hours, greeting wording and transfer numbers are edited in
TradeCatch (`/app/receptionist`, or `/admin/businesses/<id>`), not in this folder.

## How a call goes

1. **Opening, French first.** "Bonjour! Merci d'avoir appelé *Business*. Pour continuer
   en français, restez en ligne. For English, press 1." The wording comes from the
   business config; this agent only reads it out.
2. **Language.** `1` → English, `2` → French, nothing within the menu timeout → French.
   Speech never picks the language (a cough or a TV in the background must not flip
   the call), and the greeting is never repeated after a choice. Later in the call the
   caller can ask out loud ("in English please"); the agent offers once in that language
   and switches only if they accept.
3. **Conversation.** One question at a time, no re-asking of anything already said.
   Details are written to a per-call record as the caller gives them (`record_details`),
   not at the end, so a dropped call still leaves a usable lead.
4. **Booking.** `check_availability` reads real openings; `book_appointment` can only
   book one of the options just offered. The agent says "booked" **only** when the
   server answers `confirmed`. Any other outcome (taken, calendar down, timeout) is
   described honestly and the request is passed to the team.
5. **Transfers.** `transfer_call` picks one of the business's configured lines. The
   model never supplies a number. Closed office → normal transfers are refused;
   emergencies still go through.
6. **Silence.** One "are you still there?", then a polite goodbye and hang-up.
7. **End.** `report` is sent once (retried on network errors), whether the call ended
   normally, the caller hung up, or the model errored.

If TradeCatch cannot be reached when the call starts, the agent uses a minimal,
bilingual instruction set with **no** transfer and no promises.

## Why transfers used to do nothing

The first version of this agent had **no tools**, so "I'll transfer you" was only
words. Now `transfer_call` calls LiveKit's `transfer_sip_participant`, which sends a
SIP REFER to Twilio. Two things must be true for it to work:

1. The agent calls the tool (the prompt requires it).
2. The Twilio trunk allows transfers: **Elastic SIP Trunking → the trunk → General →
   Call Transfer (SIP REFER) = "Enabled for all calls"** (API: `TransferMode=enable-all`).
   With the default `disable-all`, Twilio rejects the transfer and the caller is left
   waiting in silence.

A REFER hands the call to Twilio and LiveKit does not hear what happens next, so a
transfer that **rings out with no answer cannot be detected** on this path. The agent
only reports a failed transfer when the REFER itself is rejected. (The Twilio
`<Gather>` path does detect no-answer and offers a callback.)

## Safety

- The model never provides a phone number. `routing.pick_transfer` chooses one of the
  lines configured for that business (validated server-side as Canadian geographic
  numbers).
- Phone numbers (Canadian/US rules) and emails are validated before they are saved;
  a rejected value is reported back to the model so it asks the caller again. Every
  saved field has a length limit, and only whitelisted fields can be written.
- The server re-validates everything (zod, exact dialed-number match, 256 KB limit),
  returns field names but never echoes caller text in errors, and logs no PII.
- Call ids must match `^[A-Za-z0-9_.:-]{6,128}$`; the booking idempotency key is
  `rca:<callId>:<startAt>`, so a retried booking cannot reserve twice.

## Files

| File | Job |
| --- | --- |
| `agent.py` | LiveKit entrypoint, tools, silence and error handling |
| `language.py` | Language menu state (keys, timeout, switching) |
| `phrases.py` | Exact greeting / language / silence instructions from config |
| `policy.py` | Silence policy (check in once, then say goodbye) |
| `call_record.py` | Per-call record, phone normalisation, report payload |
| `tool_results.py` | What each tool tells the model (never "booked" unless confirmed) |
| `tradecatch_api.py` | HTTP client: timeouts, retries, no PII in logs |
| `tuning.py` | Env-driven voice, endpointing and interruption settings |
| `routing.py` | Choosing a transfer line; caller number and call id from SIP |

## Configuration

Secrets (never in git): `TRADECATCH_BASE_URL`, `TRADECATCH_OPS_SECRET`.
Everything else is optional tuning — see `.env.example` for the full list with
ranges: `AGENT_VOICE`, `AGENT_REALTIME_MODEL`, `AGENT_ENDPOINTING_MODE`,
`AGENT_MIN_ENDPOINTING_DELAY`, `AGENT_MAX_ENDPOINTING_DELAY`, `AGENT_INTERRUPTIONS`,
`AGENT_INTERRUPTION_MIN_DURATION`, `AGENT_INTERRUPTION_MIN_WORDS`,
`AGENT_PREEMPTIVE_GENERATION`, and `AGENT_{CONFIG,AVAILABILITY,BOOK}_TIMEOUT_SECONDS`.
Out-of-range values are ignored (a typo cannot make the line cut callers off).

The speech-to-speech model has no speaking-rate setting, so pacing (calm, slower for
numbers and addresses) is requested in the instructions. Treat it as something to
listen to on real calls, not as a guarantee.

## Deploy (LiveKit Cloud)

```bash
cd agents/receptionist
lk agent update-secrets --secrets "TRADECATCH_BASE_URL=https://tradecatch.ca,TRADECATCH_OPS_SECRET=<MISSED_CALL_OPS_SECRET value>"
lk agent deploy
```

Roll back with `lk agent rollback` if a new version misbehaves.

## Test

```bash
pip install -r requirements.txt
python -m unittest discover -p "test_*.py"     # ~160 tests, no network, no real LiveKit room
```

The suite covers the language menu and silence policy, the call record and its
validation, the API client against a local HTTP server (timeouts, retries, 4xx vs 5xx),
tool results, and the agent end to end with a fake session (opening, DTMF, silence,
booking confirmed / taken / failed, transfer, report-once, error recovery).
The TypeScript side (`npx tsx --test tests/unit/receptionist-*.test.ts`) covers the
endpoints and the Twilio `<Gather>` path, including 20 full-call scenarios in
`tests/unit/receptionist-scenarios.test.ts`.

## Live-call checklist

Automated tests cannot judge sound, recognition on a real line, or carrier behaviour.
Before relying on a number, call it and check:

- [ ] No key pressed: French greeting, French conversation, no repeated greeting.
- [ ] Press `1` during the greeting and again right after it: English, once, no restart.
- [ ] Press `2`; press a stray key (`5`); talk over the menu — language never flips by voice.
- [ ] Speak with a Québec accent and background noise: names and street addresses come
      back right, or are confirmed once, never guessed silently.
- [ ] Interrupt the agent mid-sentence: it stops and answers what you said.
- [ ] Ask for a price: no number is invented, the open question resumes.
- [ ] Book an appointment: it is only called "booked" after it shows in the calendar;
      take the slot first from another phone and check the "just taken" path.
- [ ] Transfer to a department, then to a number that does not answer — expect the
      SIP limitation above on this path.
- [ ] Say nothing for the silence window: one check-in, then goodbye.
- [ ] "Are you a robot?": honest, short, then back to the question.
- [ ] Ear check of pace and pauses; adjust the `AGENT_*` delays if it feels hurried or slow.
