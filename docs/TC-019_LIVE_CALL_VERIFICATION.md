# TC-019 — controlled live call verification

Status: **not verified with real Twilio calls**. No Twilio account SID, auth
token, staging calling number or controlled transfer destination was available
in the configured environment on October 21, 2026. Simulated tests are not proof
of real speech recognition, carrier routing or call audio quality.

Use an isolated staging organization and Twilio number, dry-run downstream
notifications, synthetic customer data and consenting test callers. Do not use
real emergency services as a transfer destination. Keep credentials in secure
provider settings, not documentation or chat. Configure signed Twilio callbacks
and a controlled staff destination; verify staging never routes to customer staff.

Run every scenario twice, once with the configured English language and once
with French. Record UTC start time, staging call SID, expected/actual behavior,
pass/fail, sanitized evidence and fixture cleanup. Store any audio only with the
caller's consent under the configured retention policy.

| Scenario | Expected result | Live result |
| --- | --- | --- |
| Greeting | Correct business name and selected language; audible and timely | Not run |
| Speech recognition | Natural speech, interruptions, names, phone digits and accented speech understood; ambiguous answers confirmed | Not run |
| Human transfer | Consenting staging staff answers; context preserved; caller not stranded | Not run |
| Transfer unavailable | Busy/no-answer/invalid destination recovers to message taking | Not run |
| Emergency wording | Configured emergency guidance in correct language; no real emergency transfer | Not run |
| Voicemail | Caller can leave details; resulting call record and notice accurate | Not run |
| Silence/unrecognized speech | Limited reprompts then configured safe fallback | Not run |
| Provider outage | Injected staging speech/AI timeout or error recovers without a silent/dead call | Not run |
| Callback replay/failure | Repeated callbacks don't duplicate records; retryable failure recovers | Not run |
| Hang-up and recovery | Early disconnect recorded; next fresh call succeeds normally | Not run |

Release gate: TC-019 remains open until all live rows have evidence. Current
application checks and simulation coverage must not be described as live-call
verification. Real numbers and credentials, plus controlled caller access, are
required to execute this matrix.
