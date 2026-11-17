# Operations: TradeCatch

Written 2026-11-15. CAD. TradeCatch is a software service run by one person, so "operations" is the founder's calendar, the vendors the service stands on, the routines that make each install repeatable, and what happens when something breaks. Inputs: `idea.md`, `offer.md`, `numbers.json`, `cfo-sources.md`, `board.md`, the agent README and the metering code. **Founder hours are the one number nobody has; the plan below names how to measure them and what they imply.** `numbers.json` was not changed: no real cost differed from it.

## 1. The cycle

**A typical working day** (customer-visible steps marked **[C]**):

1. **Morning check (30 min).** Overnight calls, urgent flags, failed transfers, and whether the voice agent is awake (the README warns it can show "Sleeping" and take a cold start). For each client in their first 14 days, read every transcript. **[C]** when it finds a mistake: the founder tells the owner before the owner finds it.
2. **Install work.** For a client in setup: call-flow audit, configuration, writing messages with the owner, scenario tests with the owner's team. **[C]**
3. **Demos and outreach (about 5 demos a week, `marketing.md`).** Start each demo by counting the prospect's missed calls from their call log. **[C]**
4. **Client contact.** Test-call approvals, go-live calls, answers to questions. **[C]**
5. **End-of-day check.** Alerts, billing failures, the day's support messages; tomorrow's demos.
6. **After hours.** The product answers by itself. The founder is not on a call centre rota: what monitors the platform at night is an open question (section 7).

**Every week:** the three numbers in `marketing.md`; the allowance review (SOP 4); every live client's call counts and capture mistakes.
**Every month:** vendor price check against `cfo-sources.md`; the CFO's numbers re-run on real usage; guarantee claims and refunds logged.

## 2. Suppliers

The service stands on a few vendors. Prices below are public and were read on 2026-11-15 (sources and arithmetic in `cfo-sources.md`). **Alternatives are named so a failure has a second path; their prices were not researched and need a quote.**

| Input | Today | Public price | Second source (quote needed) | Lead time and terms |
| --- | --- | --- | --- | --- |
| Voice runtime, speech and the model | LiveKit Cloud (agent sessions, Inference, SIP) | $0.01 a session minute; speech model $0.05 a minute; language stream $0.0058; SIP $0.004; plan $0 (Build) to $50 a month (Ship) | Self-hosted LiveKit (open source), or another voice-agent platform | Self-serve, card billing, month to month |
| Phone numbers, call routing, texts | Twilio (Elastic SIP, Canadian numbers, SMS) | SIP origination $0.0045 a minute (local); SMS about $0.0161 outbound a segment; number $1.15 a month | A second Canadian SIP and SMS provider, or a Canadian carrier | Self-serve; Canadian geographic permissions must be enabled for transfers (a 403 on every transfer is usually this) |
| Card billing | Stripe Canada | 2.9% + $0.30 a card payment; +0.7% on recurring Billing | Another Canadian processor | Payouts on Stripe's schedule |
| App hosting and database | Next.js on Cloudflare; a Postgres database | Not read this run; `numbers.json` carries an ESTIMATE of $200 a month for hosting and tools | Quote | The founder's own accounts |

**Single points of failure:** one voice platform and one telephony provider. If either fails, the contractor's own business number still rings them first, but calls that would have gone to the receptionist go unanswered. What the caller hears in that case depends on the carrier's forwarding settings and has not been tested (open).

## 3. People

**Roles:** one, the founder. There is no employee and no contractor. Wage assumption: the $4,000 a month placeholder in `numbers.json`, set by the founder, not a market figure. Payroll taxes, source deductions and any future hire's costs depend on how the founder is paid; ask the accountant.

**Capacity, with the arithmetic.** A working week assumed at 45 hours is about 195 hours a month. Assume fixed duties of 25 hours a week (demos 8, monitoring 6, billing and admin 3, product fixes 8): about 108 hours a month, which leaves **about 87 hours a month for installs and early monitoring**. At the proposed 5 installs a month, that holds only if one install costs **about 17 hours or less** of founder time in total. **Every figure in this paragraph is an assumption, not a measurement.** Replace them with the real log from the first three installs (SOP 2 asks for the time of each step), and set the number of open installs on the site from that.

**Slow first month (a rota):** about 4 demos a week, 1 install in setup at a time, all transcripts read, monitoring light. **Planned volume (5 installs a month and 12 live clients):** demos fall to what the pipeline needs, transcripts are read for the first 14 days only, and the weekly review replaces daily reading for settled clients.

## 4. Routines

**SOP 1: The free demo with a call-log count.**
1. Ask the owner to open their phone's recent calls for the last 30 days, with you watching.
2. Count the unanswered calls, and how many were from numbers not already in their contacts.
3. Write the two numbers down in front of them.
4. If fewer than about 10 missed calls a month: tell them this is not worth buying yet, and stop.
5. Otherwise show the live demo line, then the plans, then the 60-day guarantee.
6. Record: date, trade, missed calls, outcome, objection in their words.

**SOP 2: The install (log the time of every step).**
1. Audit: how calls and quotes move through the business today.
2. Configure the business profile, hours, urgent-call rules and the owner's transfer numbers (a general line, an emergency line, a backup).
3. Write every message with the owner. Nothing speaks or sends until the owner approves the wording.
4. Run every scenario with the owner's team.
5. Record the test-call pack (French and English, plus a stressed night call) and play it to the owner. The owner approves or rejects it.
6. Run the urgent-call test (SOP 3) from a real phone.
7. Go live. Read every transcript for 14 days. Send the owner the first-week summary.
8. Log founder hours per step.

**SOP 3: The night and urgent-call test (a board condition).** From a phone that is not the owner's:
1. Call the business number outside the owner's hours with the owner's phone unanswered. Confirm the caller hears the transfer announcement in their language.
2. Confirm the owner's phone rings with a screening message and the call connects only on "press 1".
3. Repeat and let it go unanswered: the caller must return to the receptionist, who takes the details and a callback, and the owner must receive the failed-transfer alert.
4. Confirm it never tries to transfer to 911.
5. Write down what happens when the owner does not acknowledge an urgent text within a set time. **No such rule exists in what I read; the founder must define it** (open).
6. Repeat after any change to routing, hours or the transfer settings.

**SOP 4: The allowance review (monthly).** Allowances are **soft limits**: nothing disconnects a call or blocks a text. When a client first passes the allowance, an overage confirmation opens and the owner is told; it bills nothing unless the owner confirms, and overage invoicing is **switched off with no rates set** (`docs/STRIPE_BILLING.md`). So the founder absorbs the cost of any unbilled overage at about CA$0.1091 a minute and CA$0.0229 a text. Each month: list every client at or above 80%, and every client over 100%. If a client is over two months running without confirming, call the owner: move them to Professional, or agree the overage. Before turning invoicing on, set rates above those costs.

**SOP 5: A complaint or a wrong capture.**
1. Reply within one hour, by the founder, in the client's language.
2. Pull the call recording and transcript before replying in detail.
3. Say what went wrong, what is fixed and by when.
4. If the 60-day guarantee applies, refund through Stripe (the card fee is not returned) and log the claim.
5. Add the case to the scenario list for that trade's template.

**SOP 6: The weekly review.** The three numbers in `marketing.md`, the allowance list, open complaints, and one question: what did I do by hand this week that a template could do?

## 5. Tools

The smallest stack is already in place: Stripe for billing, Twilio and LiveKit for voice and texts, Cloudflare and a Postgres database for the app, and the TradeCatch dashboard itself for calls, requests and usage. **Gaps:** a bookkeeping tool for a Canadian small business and a place to keep the install time log. Neither was priced; get a current quote from the vendor's own page. Do not add a CRM: TradeCatch does not integrate with CRMs (`offer.md`).

## 6. Licences, registrations and insurance

The rules differ by place, change, and apply differently depending on whether the founder is a sole proprietor or a corporation. **Each line below is a thing to confirm with the named authority or a professional; none is advice, and I did not confirm any of it.**

| What | Why it may apply | Where to confirm |
| --- | --- | --- |
| Business registration in Québec | A business carrying on activity in Québec is generally listed in the enterprise register | Registraire des entreprises (https://www.registreentreprises.gouv.qc.ca) |
| GST and QST registration | Registration depends on taxable sales passing a small-supplier threshold (commonly $30,000 over four quarters); the site does not say whether prices are before or after tax | Revenu Québec (https://www.revenuquebec.ca) and the Canada Revenue Agency (https://www.canada.ca/en/revenue-agency.html) |
| Privacy law (Law 25) | The service records calls and holds names, numbers and addresses: a privacy policy, a person responsible, an incident log, and a position on where data is stored | Commission d'accès à l'information (https://www.cai.gouv.qc.ca) |
| Consent for commercial texts | Canada's anti-spam law covers commercial electronic messages | CRTC (https://crtc.gc.ca) |
| French-language rules | Commercial offers, contracts and the website in Québec have French requirements | Office québécois de la langue française (https://www.oqlf.gouv.qc.ca) |
| Call recording and AI disclosure | Whether the receptionist must say it is recorded or is an AI | A Québec lawyer |
| Whether carrying calls is a regulated telecom service | TradeCatch sits on top of a carrier; confirm no registration applies | A telecom lawyer or the CRTC |
| Contract, terms, privacy and the guarantee wording | Already on the site (terms, privacy, emergency disclaimer); the guarantee is new | A lawyer, once, before launch |
| Insurance | Professional liability (errors and omissions) and cyber cover; a mishandled urgent call is the exposure | An insurance broker |
| Referral rewards | $50 to $75 e-Transfers to customers have a tax treatment | The accountant |

## 7. Risk register

Likelihood and impact are my judgement (high, medium, low), to be revised from real use.

| # | What goes wrong | Likely | Impact | Plan |
| --- | --- | --- | --- | --- |
| 1 | The founder is sick or booked solid; nobody else can fix or watch it | High | High | Keep the install cap honest. Write the runbook (this file). Find one trusted person for monitoring cover within 30 days of going live. Alerts to the founder's phone (which alerts exist is open) |
| 2 | The voice platform or phone provider goes down | Medium | High | Watch vendor status pages. Test and document what the caller hears. Get a second SIP quote. Tell clients early |
| 3 | It mishears a name, number or address | High | Medium | Read every transcript for 14 days. Measure capture accuracy on recorded French calls and set a target before selling past the first group (`board.md`). Text the caller a confirmation |
| 4 | An urgent call is mishandled (the emergency seam) | Medium | Very high | SOP 3 before every go-live. Define the "no acknowledgement" rule. Keep the 911 wording and disclaimers. Get insurance |
| 5 | Clients go over their allowance and never confirm overage | Medium | Low to medium | SOP 4. Set the overage rates, then enable invoicing. At worst each unbilled client costs the founder a few tens of dollars a month |
| 6 | More than about 18% of new clients claim the guarantee (`offer.md`) | Medium | High | Qualify in the demo (SOP 1). Review after the first three installs. Pause the guarantee if claims pass 18% |
| 7 | A vendor raises prices | Medium | Medium | Re-check `cfo-sources.md` monthly. After a 15% rise in unit costs a client-month still leaves about $165 (299 - 116.08 x 1.15) |
| 8 | A privacy incident involving call recordings | Low to medium | High | An incident log, the data-location statement, a retention rule, a Law 25 review (section 6) |
| 9 | The first install goes badly and the trade community hears about it | Medium | High | Start with owners who will be candid. Hold paid marketing until three installs are stable (`board.md`) |
| 10 | A cheaper or closer rival moves in (Voxify, FetchLine, Jobber adding French) | Medium | Medium | The named founder, recorded calls and the guarantee are slow to copy. Re-run the competitor map each quarter |

## Open questions for the founder

1. Hours per install, step by step (time the first three).
2. Days from checkout to the first live call, and the owner's hours during setup.
3. Who or what watches the platform at night, and which alerts reach the founder's phone.
4. The rule when an owner does not acknowledge an urgent text.
5. What a caller hears if the receptionist is unreachable.
6. Whether prices are shown before or after GST and QST.
7. Where audio and transcripts are stored, and for how long.
8. The overage rates and whether to enable overage invoicing.
9. Which insurance, registrations and legal reviews are already in place.
10. Hosting and database plan prices, to replace the $200 estimate in `numbers.json`.
