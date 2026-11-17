# Launch: TradeCatch

Written 2026-11-15 (a Sunday). Inputs: `board.md` (the conditions), `offer.md`, `pricing.md`, `cfo.md`, `marketing.md`, `brand.md`, `ops.md`. **The launch date is a proposal:** the founder was not asked for one, so the default is the earliest date that fits the lead times below. Change `L` and every date moves with it. The product is built and in production; what remains is proof, paperwork and the founder's calendar. The founder is the owner of every task unless another person is named.

## 1. The test before the money

The big costs are mostly sunk (the product exists); what is still at risk is the founder's time and the guarantee. So the test is the board's own condition: **three paid pilot clients at the planned price**, in plumbing or HVAC, with before and after call counts, and the first one by referral.

**The success line, written before the test:**

| Line | Result needed | Meaning |
| --- | --- | --- |
| **Pass** | 3 clients paid in full (setup $1,999.99 plus the first month) within 45 days of `L`, at least 12 demos held | Real conversion near 3 of 12 or better, which is within the panel's 30% (an upper bound for simulated buyers) |
| **On the CFO's ramp** | At least 1 paid client by day 30 | Matches month 1 of `numbers.json` (one net new client a month) |
| **Referral** | At least 1 paid client sourced by a referral within 60 days | The board's condition before any paid marketing |
| **Fail: go back to the offer** | After 20 demos, fewer than 2 signed (under 10%) | Trust real buyers over the panel. Revisit `offer.md` and run the setup-fee test in `pricing.md` |
| **Stop and fix** | More than about 18% of live clients claim the guarantee | `offer.md`: past that, year 1 turns negative even at a $2,500 wage |

If real buyers fall well short of the panel, trust the real buyers.

## 2. The countdown, from today to launch

**Default `L` = Monday 2026-12-07.** Winter is the trade's peak for no-heat calls, so early December is the right season; the Christmas and New Year weeks will be slow for demos, so the first 30 days run unevenly.

| Block | Dates | Task | By |
| --- | --- | --- | --- |
| **Week 0: decide and ask** | Nov 15 to 21 | Confirm `L`, the founder wage and the true install capacity. **Decide the plan placement of call transfer and make the code match** (launch flag and plan grant). Send the guarantee wording to a lawyer. Ask a broker for an insurance quote. Ask the accountant about GST and QST. List the open bugs and missing translations against the board's condition | Nov 21 |
| **Week 1** | Nov 22 to 28 (marketing starts L-14, Nov 23) | Fill the open facts: days from checkout to go-live, owner hours in setup, where audio and transcripts are stored. Record the test-call pack (French night call, English day call). **Update the site and legal copy that still says TradeCatch does not transfer calls** (FAQ, terms, emergency disclaimer in `src/messages/*.json`) and add the guarantee, the free call-log count and quote follow-up. Build the list of 60 owners. Message the 10 known | Nov 28 |
| **Week 2: soft open** | Nov 29 to Dec 5 | Friends-and-family install with one willing contractor: run SOP 2 and SOP 3 (`ops.md`) on a real phone, time every step. First 5 demos. Fix what breaks. Deploy the copy changes on Dec 4 so Dec 5 is a clean check | Dec 4 |
| **`L`** | Mon Dec 7 | Founding offer opens | Dec 7 |

**Critical path (any slip moves `L`):**

1. **The guarantee wording read by a lawyer.** Without it the strongest part of the offer cannot go on the site.
2. **Transfer wired for both plans and the copy corrected.** In the code, transfer is launch-gated and granted only to the legacy plan; the copy still says no transfer. Selling a feature the plan does not have is the one thing the offer rules forbid.
3. **The board's quality bar: high-severity bugs closed and no screen a caller or contractor touches missing a translation.** Earlier working notes recorded several hardening items as built but not deployed (a Worker memory fix, rate limiting, authentication and CORS work, privacy settings). **Verify their current state before `L`; those notes may be out of date.**
4. **The urgent-call night test (SOP 3) passed from a real phone.**
5. **The test-call pack recorded and approved by one real contractor.**

Not on the critical path: registration and bank (the product already bills through Stripe; confirm with the accountant), insurance (quote now, bind before the first client goes live), the capped paid-search test (only after a referral sale).

## 3. Launch day: Monday 2026-12-07

The founder runs it alone, so the sheet is built around one calendar.

| Time | What | If it goes wrong |
| --- | --- | --- |
| 07:30 | Platform check: the voice agent is awake, demo line answers in French and English, a transfer test call connects on "press 1", checkout and dashboard load | Agent asleep: wake it and re-test. Checkout down: sell by an invoice link |
| 08:30 | Founding offer goes live on the site: 5 installs, closing date (proposed 2027-01-31 or when filled), 60-day guarantee | Site copy still wrong: do not open the offer; fix first |
| 09:00 | One-to-one messages to the 60 owners, in batches of 10, in French first. No bulk tool | Fewer than 3 replies by noon: change the first line (`marketing.md` hooks 2 and 3) |
| 10:30 | Flyers to 3 supply counters with the demo-line QR | |
| 12:00 | Phone check, eat | |
| 13:00 to 16:00 | Up to 2 demos, each starting with the call-log count (SOP 1) | |
| 16:30 | Read every call the demo line took; log objections in the owner's words | A bad call: SOP 5 style, find the cause the same day |
| 17:30 | End of day: numbers against section 4, fixes, tomorrow's demos | |

**Do not** plan anything else for launch day: nobody is watching the product while the founder is on a demo, which is the board's Product-lens concern.

## 4. The first 30 days

**Weekly numbers** (levels from `marketing.md` and `cfo.md`):

| Number | Target | Change something when |
| --- | --- | --- |
| Demos held a week | About 5 | Below 3 for two weeks: change the list or the first message |
| Demo to signed | At least 25% on the early demos, 10% as the floor | Below 10% after 20 demos: offer or price |
| Median missed calls counted per demo | At least 10 a month | Below: this audience loses too few calls |
| Active clients against break-even (`cfo.md`) | 1 by day 30; break-even with the setup income counted is about 13 clients at a $4,000 wage and about 5 at $2,500; with no wage drawn it is profitable from the first client (about 1.5 clients if setup income stops) | Zero by day 30 after 12 demos |
| Capture accuracy on recorded French calls (`board.md`) | A target set at the soft open, then met | Below target: stop selling past the first group |
| Guarantee claims | None expected in the first 30 days | Any claim: SOP 5 and read the whole call history |

**Reviews, with dates for `L` = Dec 7:**

- **Day 7 (Dec 14).** How many demos? What was the median missed-call count? Which objection came up most, in the owner's words? Did the soft-open install teach a step that needs a template? Any bug a client or caller met?
- **Day 14 (Dec 21).** Is there a live client? Was every transcript read? Capture accuracy and the urgent-call test result. Ask the first live client for a reference call and their before and after count, in writing, with permission.
- **Day 30 (Jan 6, 2027).** Signed against the success line. Claims against 18%. Hours per install against the 17-hour assumption in `ops.md`; reset the install cap on the site. Decide: continue as is, run the setup-fee test in `pricing.md`, or go back to the offer. Re-run `/founder-cfo` on real usage and real hours, and re-run `/founder-plan`.

## Rules kept

No fake scarcity: the limit is the founder's real install capacity, and the date is the founder's to set. No testimonials until a client agrees to be named. Not legal advice; every legal and tax item in `ops.md` needs the named professional.
