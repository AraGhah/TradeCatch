# CFO sources: what one call minute and one text actually cost TradeCatch

Read date: 2026-11-15. Prices are in US dollars unless marked CAD. **FACT** means a number read on the vendor's own public page or in this repo's code that day. **ESTIMATE** means the number is not on a public page; the reasoning is next to it. Nothing here is a quote from a vendor sales team, and vendors change prices without notice.

**Exchange rate (assumption, dated).** 1 USD = 1.4257 CAD, Bank of Canada FXUSDCAD for 2026-11-13 (the last value the page returned). The rate moves; redo the CAD column if it matters.

## 1. What the production agent actually runs (from the code)

| Item | Value | Source | Type |
| --- | --- | --- | --- |
| How a call arrives | caller -> Twilio number -> Twilio Elastic SIP trunk -> LiveKit -> the agent | `agents/receptionist/README.md` lines 7-8 | FACT |
| Standard voice (every plan sold at launch) | one speech-to-speech model, `openai/gpt-live-1`, through LiveKit Inference; it does speech-to-text, thinking and speaking in one billed unit | `agents/receptionist/tuning.py:37` (`DEFAULT_MODEL`), `agent.py:1426` | FACT |
| Language listener (on by default) | a second, text-only speech-to-text stream, `deepgram/nova-3` in multilingual mode, started for every call | `language_listener.py:26`, README line 33-37 and 221 | FACT |
| Noise handling | ai-coustics voice isolation `QUAIL_VF_S` on the caller's audio | `agent.py:1539-1540` | FACT |
| Cloned-voice path (only a business that uploaded its own voice, the legacy "Receptionist Plus" plan) | `deepgram/nova-3` speech-to-text, `openai/gpt-6-luna` language model, ElevenLabs `eleven_flash_v2_5` voice with a `cartesia/sonic-3` fallback | `voice.py:65-71` | FACT |
| Warm transfer | a second outbound call leg through a LiveKit outbound SIP trunk on Twilio, the caller stays connected while the contractor is screened | README lines 115 and 136-158 | FACT |

## 2. Prices read from vendor pages

| Input | Value | Source | Date | Type |
| --- | --- | --- | --- | --- |
| LiveKit agent session | $0.01 per minute (5,000 minutes included on Ship, 1,000 on Build) | https://livekit.com/pricing (markdown copy at https://livekit.com/pricing.md) | 2026-11-15 | FACT |
| LiveKit Cloud plan fee | Build $0/mo, Ship from $50/mo, Scale from $500/mo | same | 2026-11-15 | FACT |
| Which plan TradeCatch is on | unknown. The README says the agent can show "Sleeping" and take a cold start, and "cold start prevention" is listed as Ship-only, so Build is likely today | README line 285-287 vs LiveKit feature table | 2026-11-15 | ESTIMATE (ask the founder; Ship is $50/mo, about CA$71/mo) |
| GPT-Live 1 (speech-to-speech) | $0.05 per minute of audio, same on every plan | same, "Realtime Models" table | 2026-11-15 | FACT |
| Deepgram Nova-3 (Multilingual) speech-to-text | $0.0058 per minute on Build/Ship, $0.005 on Scale | same, "Speech-to-Text" table | 2026-11-15 | FACT |
| Language stream billed for the whole call | assumed the stream runs for the full call length; the README says it "adds one speech-to-text stream per call to the LiveKit Inference bill" but not for how many minutes | README line 221 | 2026-11-15 | ESTIMATE |
| LiveKit third-party SIP (Twilio into LiveKit) | $0.004 per minute on Ship ($0.003 Scale; 1,000 minutes included on Build) | same, "Telephony" table | 2026-11-15 | FACT |
| ai-coustics voice isolation | $0.0012 per minute on Ship and Scale (1,000 / 10,000 minutes included); Build includes 100 minutes | same | 2026-11-15 | FACT |
| LiveKit connection and data transfer | about $0.001 per minute (LiveKit's own calculator estimate: $0.0005/min connection plus $0.12/GB) | same, "Fixed per-minute rates" | 2026-11-15 | ESTIMATE (vendor's own estimate, not a bill line) |
| LiveKit session recording / observability | $0.01 per minute if switched on (includes audio recording); whether it is on is not in the code I read | same | 2026-11-15 | FACT for the rate, unknown whether enabled |
| Backend model behind gpt-live tool calls (saving details, calendar, booking) | no separate public rate. GPT-Live 1 is priced only as "$0.05 per minute of audio". If it were billed like a small text model: about 6 tool calls x (1,500 in + 200 out tokens) per call, at GPT-6 Sol ($2 in / $10 out per 1M tokens) is about $0.03 per call, about $0.0075 per minute on a 4-minute call | https://livekit.com/pricing.md (GPT-6 Sol row) | 2026-11-15 | ESTIMATE (call length and tool-call count are my assumptions) |
| Twilio Elastic SIP Trunking, Canada, origination (inbound call to your SIP), local number | $0.0045 per minute | https://www.twilio.com/en-us/sip-trunking/pricing/ca | 2026-11-15 | FACT |
| Same, toll-free number | $0.0130 per minute | same | 2026-11-15 | FACT |
| Twilio SIP termination, Canada (outbound leg for a transfer) | from $0.0053 per minute | same | 2026-11-15 | FACT |
| Twilio Programmable Voice, Canada, receive on a local number | $0.0085 per minute plus $1.15 per month per number (toll-free $0.0220 + $2.15/mo) | https://www.twilio.com/en-us/voice/pricing/ca | 2026-11-15 | FACT (not the path the code uses; kept for comparison) |
| Twilio SMS, Canada, long code, per segment | $0.0083 outbound and $0.0083 inbound, plus a $0.001 fee per message that ends "Failed" | https://www.twilio.com/en-us/sms/pricing/ca | 2026-11-15 | FACT |
| Twilio carrier fee on outbound SMS, per segment | Bell and Virgin $0.0087, Rogers and Fido $0.0084, Telus $0.0073, Videotron $0.0067, Freedom $0.0067, all others $0.0064. The inbound SMS carrier-fee cell on the page is blank (an icon), so I treat inbound SMS as having no carrier fee | same, "Carrier fees" table | 2026-11-15 | FACT |
| Carrier mix of TradeCatch's texts | not known. Likely carrier fee taken as the simple average of Bell, Rogers, Telus and Videotron = $0.0078 | arithmetic: (0.0087+0.0084+0.0073+0.0067)/4 | 2026-11-15 | ESTIMATE |
| Stripe Canada, domestic card | 2.9% + CA$0.30 per successful transaction; +0.5% for manually entered cards; +0.8% for international cards; +2% if currency conversion is needed | https://stripe.com/en-ca/pricing | 2026-11-15 | FACT |
| Stripe Billing (subscriptions), pay as you go | 0.7% of Billing volume, excludes one-off invoices | same | 2026-11-15 | FACT for the rate; ESTIMATE that TradeCatch's monthly plans go through Stripe Billing (the Stripe docs in this repo map plans to Stripe prices, which implies subscriptions) |
| ElevenLabs text-to-speech, Flash/Turbo (cloned-voice path) | $0.04 per 1,000 characters, billed in US dollars | https://elevenlabs.io/pricing/api | 2026-11-15 | FACT |
| Speech per minute | 600 characters per minute and 3,000 / 175 input / output tokens per minute (LiveKit's own default assumptions) | https://livekit.com/pricing.md, "Calculator assumptions" | 2026-11-15 | ESTIMATE |
| GPT-6 Luna (cloned-voice language model) | $0.10 in / $0.50 out per 1M tokens | https://livekit.com/pricing.md, LLM table | 2026-11-15 | FACT |
| USD to CAD | 1.4257 | https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=3 (value dated 2026-11-13) | 2026-11-15 | FACT for that day, assumption going forward |

## 3. Cost of one call minute, standard voice (what Essential and Professional use)

Per minute, USD:

| Line | Low | Likely | High |
| --- | ---: | ---: | ---: |
| LiveKit agent session | 0.0100 | 0.0100 | 0.0100 |
| GPT-Live 1 | 0.0500 | 0.0500 | 0.0500 |
| Language stream (Nova-3 multilingual) | 0.0058 | 0.0058 | 0.0058 |
| LiveKit third-party SIP | 0.0040 | 0.0040 | 0.0040 |
| Twilio SIP origination | 0.0045 (local) | 0.0045 (local) | 0.0130 (toll-free number) |
| ai-coustics voice isolation | 0.0012 | 0.0012 | 0.0012 |
| LiveKit connection and data transfer | 0 | 0.0010 | 0.0010 |
| Session recording and observability | 0 | 0 | 0.0100 |
| Backend model for tool calls | 0 (assumed inside the GPT-Live rate) | 0 | 0.0075 |
| **Total, USD per minute** | **0.0755** | **0.0765** | **0.1025** |
| **Total, CAD per minute (x 1.4257)** | **0.1076** | **0.1091** | **0.1461** |

Arithmetic: low 0.01 + 0.05 + 0.0058 + 0.004 + 0.0045 + 0.0012 = 0.0755. Likely adds 0.001 = 0.0765. High = 0.0765 - 0.0045 + 0.013 + 0.01 + 0.0075 = 0.1025.

What this means for the plan allowances (CAD, if every allowed minute is used): Essential 500 minutes x CA$0.1091 = **CA$54.53**; Professional 750 minutes x CA$0.1091 = **CA$81.80**. At the high figure: CA$73.07 and CA$109.60. The Essential monthly price is $249, so voice alone is about 22% of it at full use; Professional is about 23% of $349. A typical customer will use well under the allowance, but the per-minute figure is what the CFO should multiply by real usage.

Not counted per minute, for the CFO's fixed costs: LiveKit plan ($0 on Build, from US$50 a month on Ship), Twilio number rental ($1.15 a month per local number, toll-free $2.15), and any minutes beyond what a plan includes at low volume (which makes the first few thousand minutes cheaper than the list rate).

**Warm transfer.** While a transfer leg is open it adds the outbound leg: LiveKit third-party SIP $0.004 + Twilio termination $0.0053 = $0.0093 per minute (CA$0.0133), on top of the minute rates above for as long as the agent session is open (FACT rates, my sum).

**Cloned-voice path (legacy plan only, not sold at launch).** Session 0.0100 + Nova-3 (call) 0.0058 + language stream 0.0058 + language model 3,000 x 0.10/1M + 175 x 0.50/1M = 0.0004 + ElevenLabs 600 characters x $0.04/1,000 = 0.0240 + SIP 0.0040 + Twilio 0.0045 + isolation 0.0012 + connection 0.0010 = **US$0.0567 per minute (CA$0.0808)**. It is cheaper than the GPT-Live path on paper, but the ElevenLabs plan fee and the fallback voice's cost were not added.

## 4. Cost of one text message (Twilio, Canada, long code)

| | Low | Likely | High | CAD at 1.4257 (likely) |
| --- | ---: | ---: | ---: | ---: |
| Outbound segment | 0.0083 + 0.0064 = 0.0147 | 0.0083 + 0.0078 = 0.0161 | 0.0083 + 0.0087 = 0.0170 | CA$0.0229 |
| Inbound segment | 0.0083 | 0.0083 | 0.0083 | CA$0.0118 |

Likely outbound uses the ESTIMATE carrier average. If the plan's text allowance counts both directions equally, a 50/50 mix is (0.0161 + 0.0083) / 2 = US$0.0122, CA$0.0174 per segment. Full use of the allowance, all outbound at the likely rate: Essential 1,000 x CA$0.0229 = **CA$22.92**; Professional 2,000 x CA$0.0229 = **CA$45.84**. Messages that fail add $0.001 each. A message holding a character outside the basic SMS alphabet (for example ê, â, ô, î or a curly apostrophe, which are common in Québec French) is sent in the wider encoding at 70 characters per segment instead of 160, so a French text can cost two or three segments where English costs one. That is general SMS behaviour, not read on a Twilio page, so treat it as an ESTIMATE and count real segments from the usage counters.

## 5. Card fees (Stripe, Canada, domestic card, CAD)

| Charge | Card fee 2.9% + CA$0.30 | Plus Stripe Billing 0.7% (only on recurring, ESTIMATE that it applies) | Total |
| --- | ---: | ---: | ---: |
| Setup fee CA$1,999.99 (paid once at checkout) | 1,999.99 x 0.029 + 0.30 = **CA$58.30** | none (one-off) | CA$58.30 |
| Essential CA$249 a month | 249 x 0.029 + 0.30 = **CA$7.52** | 249 x 0.007 = CA$1.74 | CA$9.26 |
| Professional CA$349 a month | 349 x 0.029 + 0.30 = **CA$10.42** | 349 x 0.007 = CA$2.44 | CA$12.86 |

International cards add 0.8% and currency conversion 2%; most Québec contractors pay with a domestic card, so these are left out of the main figures. Sales tax (GST/QST) collected from customers is not revenue and is left out; whether it is added on top of these prices is not stated in the product copy.

## 6. What is still not known

- Which LiveKit plan is in use (fixed fee of $0 or US$50 a month).
- Whether session recording is switched on.
- How the "gpt-live" backend model for tool calls is billed, if at all, beyond the $0.05 per minute.
- The average length of a real call and how many minutes and segments a typical customer uses. The plan allowances (500 / 750 minutes, 1,000 / 2,000 texts) are marked "provisional" in `src/lib/plans.ts`; the first month of real usage counters will replace these multiplications.
- No overage rate has been set (`OVERAGE_RATE_*` have no defaults), so the cost ceiling above is also the break-even overage price per unit, before any margin.
