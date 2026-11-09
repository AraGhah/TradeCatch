# TradeCatch receptionist — LiveKit voice agent

Answers calls that arrive from the Twilio SIP trunk, using each business's own
settings from TradeCatch, books appointments against the real calendar, and can
**really transfer** the call.

```
caller → Twilio number → SIP trunk → LiveKit → this agent
                                          │
   GET  /api/receptionist/agent-config?number=<dialed number>   rendered prompt, bilingual opening,
                                                                 silence wording, transfer lines
   POST /api/receptionist/agent/availability                    real open times
   POST /api/receptionist/agent/book                            reserves one (idempotent)
   POST /api/receptionist/agent/appointments                    the caller's own appointments (find, move,
                                                                cancel) and texts to the caller
   POST /api/receptionist/agent/report                          saves the finished call
                              (all with the ops bearer; see "Safety")
```

Companies, prompts, hours, greeting wording and transfer numbers are edited in
TradeCatch (`/app/receptionist`, or `/admin/businesses/<id>`), not in this folder.

## How a call goes

1. **Bilingual opening, no keypad.** Every call opens the same way, in two voices:
   "Bonjour, ici *Business*." (French) and "How can I help you?" (English). The wording
   comes from the business config (`languageSelect.detection`); this agent only reads it out.
   A single-language line greets in its own language instead.
2. **Language, from the caller's speech.** A text-only speech-to-text stream
   (`language_listener.py`, Deepgram nova-3 in `multi` mode through LiveKit Inference)
   listens to the caller beside the voice model and reports, per utterance, the language
   it heard, a word count and a confidence. Only those three values are kept: the words are
   counted and dropped, never stored or logged. `language.py` turns them into one decision:
   * the first clear sentence (3+ words, confidence 0.6+) sets the language, in French
     (`fr`, `fr-CA`) or English; one or two short words ("allô", "hello") only count if
     two of them agree;
   * once set, the other language must be spoken in two clear sentences in a row (three
     right after the caller asked for a language out loud), or in one long confident one
     (8+ words, confidence 0.85+); a borrowed word, a name or a short reply never flips the call;
   * if two utterances do not settle it, the agent asks once, in both languages:
     "Français ou anglais? French or English?". The caller's next answer decides, however
     short. If that does not settle it either, the call stays in the line's start language;
   * an explicit request ("in English please", the `set_language` tool) always wins.
   The greeting is never repeated. When the language is set, the voice model gets one
   standing `LANGUAGE UPDATE` rule; nothing extra is spoken. Every decision is logged
   without any words: `language decision: set en [clear_speech] after 1 utterances, 0.84s
   after the caller stopped`.
   *If the listener cannot start or keeps failing*, the call carries on in the language it
   has, the model is told to follow the caller itself and to ask when unsure, and a warning
   is logged. `AGENT_LANGUAGE_DETECTION=off` does the same on purpose.
3. **Conversation.** One question at a time, no re-asking of anything already said.
   Details are written to a per-call record as the caller gives them (`record_details`),
   not at the end, so a dropped call still leaves a usable lead.
4. **Booking.** `check_availability` reads real openings; `book_appointment` can only
   book one of the options just offered. The agent says "booked" **only** when the
   server answers `confirmed`. Any other outcome (taken, calendar down, timeout) is
   described honestly and the request is passed to the team.
5. **Transfers.** Two tools: `transfer_to_human` (optional department) and
   `transfer_emergency`. Both pick one of the business's configured lines; the model
   never supplies a number. Closed office → normal transfers are refused;
   emergencies still go through.
6. **Silence.** One "are you still there?", then a polite goodbye and hang-up.
7. **End.** `report` is sent once (retried on network errors), whether the call ended
   normally, the caller hung up, or the model errored.

If TradeCatch cannot be reached when the call starts, the agent uses a minimal,
bilingual instruction set with **no** transfer and no promises.

## Transfers

The model has two transfer tools, `transfer_to_human(department?)` and
`transfer_emergency()`. Neither takes a phone number. Both run the same internal
`transfer_call`, which never claims a transfer worked because it was *started*.

* **Announcement.** Before ringing, the caller hears one fixed sentence in the call's
  current language (the call's language state), spoken word for word:
  FR "Bien sûr, je vais vous transférer à un membre de notre équipe." / emergency
  "Je comprends, c'est urgent. Je vais vous transférer immédiatement à notre contact
  d'urgence."; EN "Of course. I'll connect you with someone from our team." /
  emergency "I understand this is urgent. I'll connect you with our emergency contact
  now." (`transfer.TRANSFER_ANNOUNCEMENTS`).
* **Destinations.** Only the tenant's own configured lines, and each must pass
  `routing.destination_problem`: never 911 or another N11/emergency code, never a
  premium-rate (900) number, never the business number itself (a loop back into this
  agent), never the caller's own number, and only well-formed E.164.
* **Caller still there.** No transfer starts if the caller's SIP participant has
  already left the room.
* **Accepted vs answered.** `completed: true` means the call left the agent for a
  person's line. Only a screened (`warm`) transfer, where the contractor said yes or
  pressed 1, sets `answerConfirmed: true`. A SIP REFER that LiveKit reports successful
  is logged `TRANSFER REQUEST ACCEPTED ... human answer not confirmed`; a screened yes
  is logged `HUMAN ANSWER CONFIRMED`.
* **Failures.** Anything else is a named failure; the caller stays on the line with
  the agent, who offers a callback (emergency: tells them to call 911 if anyone is in
  danger and takes an urgent callback). The report says `completed: false`, and
  TradeCatch sends the owner the `transfer_failed` alert (and, for an emergency, marks
  the call critical).
* **Logs.** Structured events `transfer_requested`, `transfer_accepted`,
  `transfer_failed`, `transfer_timeout`, `transfer_fallback_started`,
  `transfer_fallback_completed`, with an allow-list of fields (call id, reason,
  mechanism, line label, failure kind, SIP code, attempt, `answer_confirmed`). No
  phone numbers, keys or caller speech.
* **Prompt.** The agent appends its own `TRANSFER_POLICY` to the business's
  instructions, so the tool names and rules are right even if the backend prompt is
  older than the agent.

`AGENT_TRANSFER_MODE` picks the mechanism (default `auto`):

| Mode | How it works | Needs |
| --- | --- | --- |
| `warm` | The agent rings the contractor on a **second leg** while the caller stays connected and hears hold music. A short screening call tells the contractor who is waiting (and that it is an emergency). The calls are merged only when the contractor says yes or **presses 1**; then the agent leaves **without hanging up**. Busy, no answer, voicemail, wrong number, a refusal, a hang-up, a provider error or a missed deadline all return the caller to the agent. | A LiveKit **outbound** SIP trunk (`LIVEKIT_SIP_OUTBOUND_TRUNK`) |
| `blind` | SIP REFER hands the caller to the contractor. LiveKit reports the REFER's final status and **that status is what counts** (the old code ignored it). A voicemail greeting still counts as an answer, and there is no screening. | Twilio trunk: **General → Call Transfer (SIP REFER) = "Enabled for all calls"** |
| `auto` | `warm` when a trunk id is configured, otherwise `blind`. | |
| `off` | No transfers; the agent takes a message. | |

If the first line fails and the owner configured another one, the next is tried
(emergency: emergency line, then the general line; a department: its line, then the
general line; then the owner's secondary transfer number, sent as `backupTransferE164`.
The general and backup lines ring only when the owner's hours rule lets them). A phone-system failure (bad credentials, geographic
permission, provider outage) stops after the first attempt, because a second number
would fail the same way. A whole attempt is bounded: ring time + confirmation time,
and the total is capped by `AGENT_TRANSFER_BUDGET_SECONDS`.

Why a keypress: for the SIP layer a voicemail greeting is an *answered* call
(`wait_until_answered` returns), so the contractor has to do something a recording
cannot. The screening assistant also calls `voicemail_detected` when it hears one.

When the model session itself dies, there is nobody to screen the answer, so the
contractor is dialed straight into the caller's room (`warm`) or handed off with a
checked REFER (`blind`). A voicemail would look like success on that path only.

### Setting up warm transfers

1. **Twilio** (Elastic SIP Trunking → the trunk → *Termination*): a Termination SIP URI
   (`<name>.pstn.twilio.com`) and a Credential List (or IP ACL) for it. Under *Voice →
   Geographic Permissions* enable **Canada** (and the US if contractors dial there):
   a 403 on every transfer attempt is almost always this.
2. **LiveKit**: create the outbound trunk and note its id.

   ```bash
   # outbound-trunk.json
   # {"trunk": {"name": "TradeCatch transfers", "address": "<name>.pstn.twilio.com", "numbers": ["*"]}}
   lk sip outbound create outbound-trunk.json --auth-user "$TWILIO_TERMINATION_USER" --auth-pass "$TWILIO_TERMINATION_PASS"
   ```

   `numbers: ["*"]` lets each call show the business's own number to the contractor.
   Set `LIVEKIT_SIP_NUMBER` to one fixed caller ID instead if you prefer; either must
   be a Twilio number or a verified caller ID on the same account.
3. **Agent secrets** (never in git):

   ```bash
   lk agent update-secrets --secrets "LIVEKIT_SIP_OUTBOUND_TRUNK=<ST_...>"
   lk agent deploy
   ```

At the start of every call the agent logs a warning if transfers are degraded
(`transfers: ... (mode ...)`), so a missing trunk shows up before a caller needs it.

### Plan rules still apply

The numbers come from the TradeCatch profile. A plan without `AI_CALL_TRANSFER` /
`AI_EMERGENCY_ROUTING` (e.g. Growth) is sent to the agent with **no** transfer numbers,
so the agent never offers one. That is intentional and unchanged: the fix for such a
business is a plan change or an owner decision, not agent configuration.

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
| `language.py` | The call's language: decision rules, hysteresis, the "which language?" question (pure) |
| `language_listener.py` | The text-only speech-to-text stream that reports the language of each caller utterance |
| `phrases.py` | Exact greeting / language / silence instructions from config |
| `policy.py` | Silence policy (check in once, then say goodbye) |
| `call_record.py` | Per-call record, phone normalisation, report payload |
| `tool_results.py` | What each tool tells the model (never "booked" unless confirmed) |
| `tradecatch_api.py` | HTTP client: timeouts, retries, no PII in logs |
| `tuning.py` | Env-driven voice, endpointing and interruption settings |
| `voice.py` | Validates the per-call voice (`cfg["voice"]`) and the cloned-voice pipeline settings |
| `routing.py` | Choosing the transfer lines (primary + fallback); caller number and call id from SIP |
| `transfer.py` | Transfer settings, failure classification and wording (pure, no LiveKit) |
| `warm_transfer.py` | The screened warm transfer on LiveKit's `WarmTransferTask`, the checked REFER, the direct bridge |

## Configuration

Secrets (never in git): `TRADECATCH_BASE_URL`, `TRADECATCH_OPS_SECRET`.
Everything else is optional tuning — see `.env.example` for the full list with
ranges: `AGENT_VOICE`, `AGENT_REALTIME_MODEL`, `AGENT_ENDPOINTING_MODE`,
`AGENT_MIN_ENDPOINTING_DELAY`, `AGENT_MAX_ENDPOINTING_DELAY`, `AGENT_INTERRUPTIONS`,
`AGENT_INTERRUPTION_MIN_DURATION`, `AGENT_INTERRUPTION_MIN_WORDS`,
`AGENT_PREEMPTIVE_GENERATION`, and `AGENT_{CONFIG,AVAILABILITY,BOOK}_TIMEOUT_SECONDS`.
The standard gpt-live voice takes its own turns, so the endpointing, interruption and
preemptive settings only affect cloned-voice calls. For gpt-live, `AGENT_DELEGATION_REASONING`
and `AGENT_DELEGATION_VERBOSITY` speed up the backend model behind every tool call, and each
caller turn is logged as `reply gap <seconds> (<n> backend runs)`.
`AGENT_STANDARD_VOICE=elevenlabs` with `AGENT_ELEVENLABS_VOICE_ID` answers every business
that has no cloned voice with that ElevenLabs voice (speech-to-text -> LLM -> ElevenLabs),
and `AGENT_ELEVENLABS_{SPEED,STABILITY,SIMILARITY,STYLE}` tune its delivery. Every call logs
`voice for this call: ...`, which is the way to confirm the voice production loaded.
Language: `AGENT_LANGUAGE_DETECTION=off` is the kill switch, `AGENT_LANGUAGE_STT` the model
(it adds one speech-to-text stream per call to the LiveKit Inference bill).
Transfers: `AGENT_TRANSFER_MODE`, `LIVEKIT_SIP_OUTBOUND_TRUNK`, `LIVEKIT_SIP_NUMBER`,
`AGENT_TRANSFER_{RING,CONSULT,BUDGET}_SECONDS`.
Out-of-range values are ignored (a typo cannot make the line cut callers off).

The speech-to-speech model has no speaking-rate setting, so pacing (calm, slower for
numbers and addresses) is requested in the instructions. Treat it as something to
listen to on real calls, not as a guarantee.

## Custom voice (Receptionist Plus)

When TradeCatch says a business uses its owner's cloned voice (`cfg["voice"]` is
`{"mode": "custom", ...}`), the call runs on **speech-to-text → LLM → ElevenLabs**
instead of the speech-to-speech model, because that model cannot speak with a custom
voice. Everything else (language detection, tools, booking, transfer, silence, report) is
the same code. The ElevenLabs voice is wrapped in a fallback chain
(`AGENT_FALLBACK_TTS`), and anything that stops the pipeline being built (missing
key, missing plugin, kill switch, a voice id that does not validate) means the call
is answered with the standard voice. Needs `ELEVENLABS_API_KEY` as a LiveKit secret:

```bash
lk agent update-secrets --secrets "ELEVENLABS_API_KEY=<key>"
```

`AGENT_CUSTOM_VOICE=false` turns it off for every call without a redeploy of
TradeCatch. Expect somewhat higher response latency than the speech-to-speech voice:
listen to real calls (in French and English) before relying on it.

## Deploy (LiveKit Cloud)

Follow [the production cutover procedure](CUTOVER.md) to replace the Builder agent, check the worker and recover service.

## Test

```bash
pip install -r requirements.txt
python -m unittest discover -p "test_*.py"     # ~440 tests, no network, no real LiveKit room
```

Run it with the same Python that has `livekit-agents` installed: without it the agent
tests are **skipped, not failed**, and the run still says OK.

The suite covers the language decision rules and the listener (fake streams), the
silence policy, the call record and its
validation, the API client against a local HTTP server (timeouts, retries, 4xx vs 5xx),
tool results, and the agent end to end with a fake session (opening, language, silence,
booking confirmed / taken / failed, transfers, report-once, error recovery). The
transfer tests drive LiveKit's real `WarmTransferTask` with a fake job, rooms and SIP
API (busy, no answer, wrong number, voicemail, refusal, keypress, deadlines, the caller
hanging up, a failed merge). They prove our code; they cannot prove a carrier's behaviour.
The TypeScript side (`npx tsx --test tests/unit/receptionist-*.test.ts`) covers the
endpoints and the Twilio `<Gather>` path, including 20 full-call scenarios in
`tests/unit/receptionist-scenarios.test.ts`.

## Live-call checklist

Automated tests cannot judge sound, recognition on a real line, or carrier behaviour.
Before relying on a number, call it and check:

- [ ] Greeting: "Bonjour, ici *Business*." then "How can I help you?" — no menu, no "press".
- [ ] Answer in French: French conversation, no repeated greeting. Hang up, call again, answer in English: English.
- [ ] Answer "oui" or "hello" only, then a full sentence: the language follows the sentence.
- [ ] Say something unclear or in a third language twice: "Français ou anglais? French or English?" once, and
      "English" / "français" settles it. Stay silent after the question: the call goes on in the start language.
- [ ] Speak French with one English word ("le weekend", a brand name): the call stays French.
- [ ] Switch language mid-call with two full sentences, then ask "in French please": both switch correctly.
- [ ] Press digits during the greeting: nothing happens.
- [ ] Read the log of each call: every `language decision` line shows a language, a reason and a delay, and
      no line contains anything the caller said.
- [ ] Speak with a Québec accent and background noise: names and street addresses come
      back right, or are confirmed once, never guessed silently.
- [ ] Interrupt the agent mid-sentence: it stops and answers what you said.
- [ ] Ask for a price: no number is invented, the open question resumes.
- [ ] Book an appointment: it is only called "booked" after it shows in the calendar;
      take the slot first from another phone and check the "just taken" path.
- [ ] Transfer, contractor says yes (and again with "press 1"): the caller hears hold
      music, then the contractor; the agent is gone; hanging up on either side ends both.
- [ ] Transfer to a phone that is busy, one that rings out, one that goes to voicemail,
      and a number the trunk cannot dial: each time the agent comes back, says what
      happened, offers a callback (emergency: 911 advice), and TradeCatch shows a
      *failed* transfer.
- [ ] Hang up while the contractor's phone is still ringing: the ringing stops.
- [ ] The contractor's phone shows the number you expect, in French and in English.
- [ ] Say nothing for the silence window: one check-in, then goodbye.
- [ ] "Are you a robot?": honest, short, then back to the question.
- [ ] To measure language detection, place at least 20 calls per language (and 10 mixed) with callers who
      speak naturally, note what the caller spoke and compare it with the `language decision` log lines
      and `reply gap`. Until that is done the thresholds in `language.py` are starting points, not tuned values.
- [ ] Ear check of pace and pauses; adjust the `AGENT_*` delays if it feels hurried or slow.
