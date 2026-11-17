# Pricing: TradeCatch

Written 2026-11-15. All CAD, before GST/QST. The panel is 20 simulated buyers: it picks what to test with real contractors, it is not proof. Costs come from `cfo-sources.md`; margins from `founder/cfo.md` (founder pay is a placeholder there).

## 1. The price, and why

**Keep the monthly prices: Essential $249, Professional $349. The problem is the setup fee, not the monthly.**

| Evidence | What it says |
| --- | --- |
| Buyer panel, first run, price curve (`pricing-curve-v1.md`) | Acceptable monthly range **$61.00 to $348.78**. Essential $249 is inside it; the panel's median "getting expensive" answer is $250, so it sits right at the point where buyers start to wince. Professional $349 is 22 cents above the top of the range. The bargain point is $150.51. |
| Competitors (`competitors.md`) | Eight comparable bilingual vendors run $18.99 to $797 a month, median about $164. Voxify (Montréal, $300, unlimited, no setup fee) is the nearest local rival. The two Québec vendors that install for you charge $797. No competitor publishes a setup fee. |
| CFO runs | One client-month leaves $159.98 (64%) on Essential and $205.86 (59%) on Professional, with voice and texts fully used. A 10% price cut turns year 1 from -$13,687 to -$16,020. |

**Update after the offer re-test (same 20 buyers, new pitch with the guarantee, missed-call count, transfer and quote follow-up).** The acceptable monthly range moved up to **$79.94 to $398.81**, the bargain point to $176.06, and the median "getting expensive" answer from $250 to $300. Essential $249 and Professional $349 are both inside it now (Professional was 22 cents over). The figures above are from the first run (`panel-v1/`); the re-test's are in `panel/`. Both are simulated, and the shift came with a pitch that changed several things at once, so it says buyers price the offer higher when risk is removed, not that $349 is proven.

Why not go lower on Professional: its own costs are $143.14 a month at full use, so at $299 it would leave $155.86, less than Essential leaves at $249. Professional only earns its place at about $349.

Why the setup fee is the real price. The panel's four price questions asked about monthly prices, so the curve does not measure the setup. The pass reasons do: **all 6 buyers who passed on price named the $1,999.99 setup**, and year 1 costs a buyer an effective $415.66 (Essential) or $515.66 (Professional) a month, both above the panel's $348.78 ceiling. From year 2 it is $249 or $349, inside the range. Ten more passed on trust, and their fix is also about the setup ("try it a month", "refund it if it doesn't catch a job").

**Setup fee options, run through the CFO tool** (12 clients by month 12, one new a month):

| Setup fee | Net per new client | Year 1, $4,000 founder pay | Year 1, $2,500 founder pay |
| --- | ---: | ---: | ---: |
| $1,999.99 (today) | $1,941.69 | -$13,687 | +$4,313 |
| $1,499.99 | $1,456.19 | -$19,513 | -$1,513 |
| $999.99 | $970.69 | -$25,339 | -$7,339 |
| $0 | $0 | -$36,988 | -$18,988 |
| $1,999.99 with a 60-day refund guarantee, 20% claim rate | $1,541.69 | -$18,487 | not run |
| $1,999.99 with a 60-day refund guarantee, 50% claim rate | $941.70 | -$25,687 | not run |

The refund rows assume a refunded client gets the full $1,999.99 back while the $58.30 card fee is lost.

**Recommendation: keep $1,999.99 and back it with a printed 60-day result guarantee, instead of cutting the fee.** A cut costs margin on every sale (-$5,826 a year for the first $500 off, about -$11,652 at $999.99) and answers none of the trust objections. A guarantee costs nothing when the product delivers and $400 per new client at a 20% claim rate. It also matches the board's open condition (`board.md`: refund or credit if a stated 60-day result is missed). The claim rate is unknown; it is the number the first three installs will reveal. Refunds do not return the founder's install hours, so the result tested must be something the receptionist can control (see the test in section 4).

## 2. The ladder

| Rung | Price | Reason to step up |
| --- | --- | --- |
| Essential | $1,999.99 setup + $249 a month | Every call answered 24/7 in French and English, requests captured, urgent calls flagged, texts, dashboard. 500 call minutes, 1,000 texts (provisional). |
| Professional | $1,999.99 setup + $349 a month | Everything in Essential, and the receptionist books into Google Calendar during the call, with confirmations, reminders and rescheduling. 750 minutes, 2,000 texts (provisional). Leaves $45.88 more a client-month. |

- **Call transfer** (live as of today, per the founder): recommended in **both** plans, not as a step-up. Every direct competitor offers an urgent-call path, the board's emergency-seam risk is about exactly this, and the extra phone leg costs about CA$0.0133 a minute while it is open. **Check before it goes on the price page:** in the code today transfer is launch-gated behind the `callTransfer` flag and granted only to the legacy Receptionist plan (`src/product/saas/entitlements.ts`), not to Essential or Professional.
- No third rung at launch. The legacy plans exist only for current customers, and the website service ($699.99) comes out of the launch offer, per the board.

## 3. The opening offer

A **founding-client offer for plumbing and HVAC in Laval and Montréal**, matching the board's single beachhead. It is list price with the guarantee, not a discount, so nobody learns to wait for a sale:

- Full price, with the 60-day result guarantee printed.
- In return: a recorded Québec French test call before go-live, and a reference call plus before/after call counts once live (the proof the panel asked for: "two or three local owners I can call").
- **A real limit, not a countdown:** the number of installs the founder can do a month. Proposed: the first 5 installs, closing 2027-01-31 or when filled. **The founder must replace the 5 with the true capacity**; hours per install are not known yet (`board.md`).

## 4. What to test with real buyers

Test the setup structure, not the monthly price. Two arms inside the range, run in the free founder demos (about 20 a month, so roughly 10 per arm; treat it as a signal):

1. **Arm A:** $1,999.99 + 60-day guarantee: "if it does not capture at least N requests you would have missed, the setup fee is refunded."
2. **Arm B:** $999.99 setup, no guarantee.

Log demo, booked call, signed. Alongside, ask 10 real plumbers or HVAC owners the panel's flip question: "what would make you sign this week?" If Arm A signs at least as often as Arm B, A wins, because it keeps $971 more a client after card fees ($1,941.69 against $970.69). Set N (the guaranteed result) from real missed-call counts: three buyers said they do not know how many calls they miss, so the first step of each install should be counting them.

## 5. The panel's top price objections, verbatim

For marketing to answer. The fix each one needs is in brackets.

- **Paying before seeing it work** (6 of 19 passes): "Two thousand dollars just to set it up, before I've seen it catch a single job, is a lot to put down for something my customers might hang up on." (P020) [guarantee, recorded test call, reference call]
- **Cannot measure the return** (P007, P012): "I don't actually know how many calls I miss. If it's two a month, I'm paying 2,000 $ plus 249 $ a month for something my voicemail mostly does already." (P007) [count missed calls in the install audit; quote the count]
- **Urgent calls do not reach me** (P017): "...because it can't put an urgent call through to me and people in a panic don't want a text back." (P017) [answered by call transfer, once the plan placement above is confirmed]

## Rules kept

Nothing is priced below variable cost. No "was" price was invented. The guarantee's cost is modeled before it is promised.
