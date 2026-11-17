# Offer: TradeCatch

Written 2026-11-15. CAD. Method: the Offers lens in `founder-board/lenses.md` (a summary of the framework in Alex Hormozi's *$100M Offers*, not his words). Inputs: the panel's objections (`panel/results.md`), the competitor complaints and gaps (`competitors.md`), the board's conditions (`board.md`), the costs (`cfo.md`, `cfo-sources.md`) and the pricing decision (`pricing.md`). The panel is simulated buyers; the re-test result is at the bottom.

## 1. The problem list (buyer's words)

| # | Before they buy | Where it comes from |
| --- | --- | --- |
| 1 | "I'm paying 2,000 $ before I've seen it catch a single job." | 6 price passes (P003, P007, P012, P015, P017, P020) |
| 2 | "I don't know how many calls I miss, so I can't see the return." | P007, P012 |
| 3 | "I've never heard it handle a stressed caller talking fast in joual about a no-heat call." | P001 |
| 4 | "No client name, no numbers, no testimonial." | P002, competitor gap (no vendor shows proof) |
| 5 | "It can't put an urgent call through to me." | P017; every direct competitor offers an urgent path |
| 6 | "My customers will hang up on a robot and call the next guy." | P015, P020 |
| 7 | "Voxify is 300 $ with no setup." | `competitors.md` |
| 8 | "My appointments live in my CRM / Jobber; this only books into Google Calendar." | P008, P010 |
| 9 | "Where does the audio and data go?" | panel flip answer, `competitors.md` (residency is a selling point) |
| 10 | "I don't want to switch my business number." | pitch (answered: the number stays) |
| 11 | "It doesn't send me the quote; I'd write it myself anyway." | P003 |

| # | During (setup and use) | Where it comes from |
| --- | --- | --- |
| 12 | "How much of my time does the setup take, and when does it go live?" | board condition |
| 13 | "Who is watching it while the founder is on a demo?" | board, Product lens |
| 14 | "What does it do on the 11 p.m. call after I've used my minutes?" | board, risk 2 |
| 15 | "I only look at my phone at lunch and at six." | P012 |
| 16 | "Will it say anything I haven't approved?" | `competitors.md` (nobody states owner approval) |

| # | After | Where it comes from |
| --- | --- | --- |
| 17 | "Charges that carry on after I cancel; cancelling by email." | Smith.ai and Goodcall reviews |
| 18 | "If it gets the address wrong, the money is gone." | P015 |
| 19 | "How do I know it caught anything?" | board (capture accuracy), P007 |
| 20 | "What if the founder is the only person who can fix it?" | board, risk 1 |

## 2. Solutions, scored

Value to the buyer and cost to deliver, 1 to 5 (cost from `cfo.md`; 1 = nearly free).

| Problem | Solution | Value | Cost | Keep? |
| --- | --- | ---: | ---: | --- |
| 1, 4, 18 | 60-day result guarantee on the setup fee | 5 | 3 | Yes: core of the new offer. Costs $400 a new client at a 20% claim rate, $1,000 at 50% (`pricing.md`) |
| 5, 15 | Call transfer with screening (live): rings the owner, connects only on "press 1", falls back to the receptionist | 5 | 1 | Yes. Extra leg is about CA$0.0133 a minute. Plan placement must be confirmed in the code |
| 2, 19 | Missed-call count in the free demo and a month-1 "calls caught" report | 4 | 1 | Yes. Founder time only. Also qualifies buyers: too few missed calls and the founder says so |
| 3, 6, 16 | Recorded Québec French and English test calls (an angry no-heat caller included), wording approved by the owner before anything speaks | 4 | 1 | Yes. Already promised in the pitch, now a named deliverable |
| 11 | Quote follow-up named in both plans (day 1, 3, 7, 14; stops on reply, STOP, won/lost, takeover) | 4 | 1 | Yes. Already in the plan grants and site copy; the pitch never said so |
| 4 | Reference call and before/after call counts from founding clients | 5 | 2 | Yes, but only once real clients exist. Never invented |
| 9 | One-line data statement (where audio and transcripts are stored) | 3 | 1 | Yes, but the facts must come from the founder; not stated anywhere in the repo copy |
| 12 | Days from checkout to first live call and owner hours needed, on the page | 3 | 1 | Yes, numbers from the founder; not known yet |
| 14 | A cap rule that never leaves a call unanswered, and what happens past the allowance | 4 | 2 | **Open.** Founder decision with `/founder-ops`; ceiling cost is CA$0.1091 a minute |
| 7 | Defend the price with what the install buys (a named person, a test report, a guarantee), not a cut | 4 | 1 | Yes, copy only |
| 8 | CRM integration | 2 | 5 | **No.** Not offered and not buildable now. Say it plainly: books into Google Calendar |
| 17 | Cancel month to month with notice, in plain words | 3 | 1 | Already true in the pitch; marketing to repeat |
| 13, 20 | Honest install capacity on the page | 3 | 1 | Yes, real limit only |

Two problems are **not solved** and the offer should say so rather than hide them: CRM and Jobber users (8) and the founder as single point of failure (20).

## 3. The stack

**Name (proposed, founder to approve):** *The Caught-Call Install* (FR: *L'installation Appels captés*).

**The core, by outcome.** Calls you can't pick up are answered in your company's name, in Québec French or English, 24/7; the caller's details reach your phone in seconds; an urgent caller is connected to you if you press 1; a quote that goes quiet gets chased on day 1, 3, 7 and 14; and Professional also books the visit in your Google Calendar. Essential $249 a month, Professional $349, setup $1,999.99, all CAD, month to month.

**Bonuses (each kills one objection):**
1. **The missed-call count** (kills "I can't see the return"): in the free demo the founder goes through your recent call log with you and counts the calls that went unanswered; a month-1 report shows calls caught.
2. **The test-call pack** (kills "it will sound like a robot"): recorded French and English test calls, including a stressed no-heat caller at night, played to you before go-live; nothing speaks until you approve the wording.
3. **The reference call** (kills "nobody has used it"): once live, a call with the owner of a founding client plus their before/after counts. Starts only when the first real clients exist.

**The guarantee.** If 60 days after go-live the receptionist has not captured at least **10 caller requests that you did not pick up** (a number to prove with the first installs), the $1,999.99 setup fee is refunded. If the demo call count shows too few missed calls for this to pay, the founder says so and does not install. The refund does not return the $58.30 card fee or the founder's hours. The cost, run through the CFO tool at 12 new clients: -$4,800 a year at a 20% claim rate, -$12,000 at 50% (`pricing.md`). At a $2,500 founder wage year 1 stays above zero only while fewer than about **18%** of new clients claim (arithmetic: $4,312 profit / 12 x $1,999.99). The guarantee must be checked by a lawyer before it is printed; this is not legal advice.

**Urgency, only if true.** The founder's real install capacity, stated as a number. Proposed: the first 5 installs in plumbing and HVAC in Laval and Montréal, closing 2027-01-31 or when filled, whichever comes first. **The founder must replace the 5 with the true capacity.** No countdown, no "was" price.

## 4. Value equation, before and after (1 to 10, my judgement)

| Element | Before | After | What moves it |
| --- | ---: | ---: | --- |
| Dream outcome | 6 | 7 | Named results: the urgent night call reaches you, quotes get chased |
| Likelihood of getting it | 3 | 6 | Guarantee, test calls, missed-call count. Reaches 7 to 8 only when three real clients can be called |
| Time to the result | 5 | 5 | No change until days to first live call are stated (open) |
| Effort and sacrifice | 4 | 6 | The refund removes most of the risk of the $2,000 and the audit removes the guess |

## 5. Re-test (2026-11-15)

Same 20 persona cards (seed 7, byte-identical `personas.json`), shown `pitch.md` (new) instead of `pitch-v1.md`. Run 1 is kept in `panel-v1/`, the re-test is `panel/`.

| | Before (`pitch-v1.md`) | After (`pitch.md`) |
| --- | ---: | ---: |
| Buy | 1 of 20 (5%) | **6 of 20 (30%)** |
| Pass for trust | 10 | 7 |
| Pass for price | 6 | 4 |
| Pass for convenience or habit (CRM / scheduling tool) | 3 | 3 |
| Acceptable monthly range (price curve) | $61.00 to $348.78 | $79.94 to $398.81 |

The five new buyers are P001, P003, P006, P013 and P019; P011 bought both times. The re-test clears the plan's 25% bar. **Read it as direction, not a forecast:** the buyers are simulated and lean agreeable, so 30% is an upper bound; and the pitch changed in several ways at once (transfer, quote follow-up, missed-call count, guarantee, capacity, "no CRM"), so the result cannot say which change did it.

**What the buyers' own words credit.** Four buyers name the free missed-call count where the founder walks away if there are too few missed calls (P001, P003, P006, P011), five name the 60-day setup refund as what takes the risk off the $2,000 (P001, P006, P011, P013, P019), and two tie the quote follow-up to their lost $9,000 quote (P006, P013). Nobody credits call transfer, so this panel gives **no evidence either way** that transfer moved a buyer; it is still worth having because every direct competitor offers an urgent path.

**New objections the offer created**, most repeated first:

1. **The guarantee counts "caller requests", not jobs** (P003, P005, P007, P009, P011, P012, P015): 10 captured calls could be wrong numbers or price-shoppers.
2. **The refund covers the setup but not the monthly fees** (P005, P010, P015, P020): "I'd still pay two months at $249."
3. **No live client to call; "the first five are the guinea pigs"** (P002, P004, P005, P016, P017, P018). Wording cannot fix this. Only real clients can.
4. **No CRM link** (P008, P010, P013, P014, P016). All three buyers who use scheduling or CRM software passed again.
5. **Founding slots are plumbing and HVAC only**, so roofers and renovators (0 of 2 buy) feel excluded (P004, P007).
6. **Where call data is stored** (P013, P016) and **how fast it goes live** (P011).
7. **One founder doing five installs at once** (P006, P009).

**What to change next (candidates, not yet re-tested; do not tune further to the simulated panel):**

- **Reword the guarantee around outcomes the owner controls:** refund the setup fee if, after hearing and approving the test calls, the owner says no (P009's request), and count only requests the owner marks as real in the dashboard (answers objection 1). No extra cost beyond the modeled refund exposure.
- **Extend the refund to the first two monthly fees** if the 60-day result is missed (answers objection 2). Arithmetic, not a tool run: 2 x $249 = $498 per claim on Essential, so $100 per new client at a 20% claim rate, about $1,195 over 12 new clients.
- **Say what is already true about CRM users:** each caught call arrives as a text summary the owner can copy into their own system, and say plainly that there is no CRM sync. Qualify CRM-heavy buyers out in the demo instead of chasing them.
- **Put real numbers in the gaps only the founder can fill:** days from checkout to first live call, owner hours during setup, and where audio and transcripts are stored. These are open (`idea.md`).
- **The reference gap closes only with clients.** Three live plumbing or HVAC clients with before/after counts is the board's own condition (`board.md`) and the single thing buyers asked for most.

**Before any of `pitch.md` goes public,** the founder must confirm each promise is real: the 60-day refund (and a lawyer's read of its wording), the free call-log count, the 5-install capacity, call transfer on both plans (in the code it is launch-gated and not granted to Essential or Professional), and that quote follow-up is running. The panel tested the promises; it did not verify them.
