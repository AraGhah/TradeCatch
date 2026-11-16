# TradeCatch · Business plan

**Verdict: Not yet**

- ✓ Each client-month earns $182.92 before fixed costs (61% contribution).
- ✗ Year 1 operating LOSS: $13,687.
- ✓ 6 of 20 simulated buyers buy (30%, the bar is 25%).

| key number | |
| --- | ---: |
| Price | $299.00 a client-month |
| Profit margin at plan | -4% per client-month |
| Break-even | 13 client-months a day |
| Year 1 operating profit | $-13,687 |
| Startup spend | $2,000 |
| Cash needed before it pays for itself | $15,687 |
| Startup money earned back | not in year 1 |
| Buyer panel | 6 buy · 14 pass |

## The idea

- What it is: a bilingual (Québec French and English) phone receptionist service for small contractor businesses that answers every call under the contractor's business name, captures the caller's name, number, address, service needed and urgency, alerts the contractor right away, follows up by text, and on the higher plan books appointments into the contractor's Google Calendar.
- Who it is for: owner-operated trade businesses in Montréal, Laval, Mirabel and Vaudreuil-Dorion (plumbing, HVAC, electrical, roofing and renovation, landscaping) whose owner and crew are on job sites and cannot answer the phone, and who lose jobs to the next company on Google when a call rings out.
- What it sells, at what price (all CAD):
  - Essential: $1,999.99 one-time setup, then $249 a month. Answers calls 24/7 in French and English, captures requests, flags urgent ones, texts follow-ups, dashboard with call history and captured requests.
  - Professional: $1,999.99 one-time setup, then $349 a month. Everything in Essential plus automatic appointment scheduling with Google Calendar (availability checked before booking, rescheduling, text confirmations and reminders).
  - Optional website service: $699.99, paid once, only if chosen.
  - Billing is month to month after setup, cancel with notice. The setup fee is paid at checkout; the first monthly charge comes one month later. Each plan has a monthly allowance of call minutes and text segments; usage past it is billed only if the customer confirms it. Voice cloning, bulk messaging and CRM integrations are not offered.
  - Call transfer (updated 2026-11-15, per the founder: it now transfers calls; the earlier "does not transfer" copy is out of date). From the agent code (`agents/receptionist/README.md`): when a caller asks for a person or the call is urgent, the receptionist tells the caller in their language, rings the contractor's configured line while the caller waits, screens the contractor (who must say yes or press 1, so a voicemail greeting cannot count as an answer) and then connects the call. If the line is busy, unanswered, goes to voicemail or the contractor declines, the caller returns to the receptionist, who takes the details or a callback and the contractor gets a failed-transfer alert. A configured backup number is tried next. It never transfers to 911 or another emergency number. A general transfer only rings inside the owner's hours rule; an emergency line can ring after hours.
- Where and how: Montréal and surrounding area, sold directly by the founder through a free demo ("you talk with the founder"), a live receptionist demo on the website, and a referral program. Delivery is high-touch: the founder audits how calls and quotes move through the business, configures the system, writes every message with the customer, tests every scenario with the customer's team, then monitors after launch. No call centre, no outsourced support. The software runs on the founder's own platform (Next.js on Cloudflare, Twilio for voice and SMS, Stripe for billing, an AI voice provider for the receptionist).
- Budget and constraints: one person, the founder (a software developer), builds, sells, installs and supports everything. The product is built and in production as of November 2026; it is at or just before launch to paying customers, and the number of paying customers is not stated. Cash budget, marketing budget and target customer count are not stated. The per-plan allowances are in `src/lib/plans.ts`, marked provisional and not published in the product copy: Essential 500 call minutes and 1,000 text segments a month; Professional 750 minutes and 2,000 segments. No overage rate is set yet. The per-minute and per-text cost of the stack is researched in `founder/cfo-sources.md`. Open for the founder: which plan includes call transfer (in the code today it is a launch-gated feature granted only to the legacy Receptionist plan, not to Essential or Professional), hours per install, fixed monthly costs, and the cash available.

## Summary

**Verdict: Not yet.** The panel check passes; the money check does not, and the money check rests on two numbers only the founder can set.

**The business.** TradeCatch is a bilingual (Québec French and English) AI phone receptionist for owner-operated trade businesses in Montréal, Laval and nearby: it answers in the contractor's name, captures the caller's details, texts the owner right away, chases quiet quotes, and on Professional books into Google Calendar. The founder installs and watches it for each client; it costs $1,999.99 to set up, then $249 (Essential) or $349 (Professional) a month, CAD.

**What has to change, and which skill changes it.** Year 1 loses **$13,687** and needs about **13 active clients** to break even, because the model pays the founder a **placeholder $4,000 a month** and there are no real hours per install. At a $2,500 wage year 1 is +$4,313 with about 5 clients to break even, and with no wage drawn it is profitable from the first client. So: tell `/founder-cfo` the real pay and the real hours (time the next install) and re-run it. If the setup fee must come down, `/founder-pricing` shows what that costs: about $5,800 of year-1 profit for the first $500 off.

**The three numbers.** One client-month leaves **$182.92 (61%)** after its own costs, with voice and texts fully used. Break-even is about **13 clients** at the placeholder wage. Year 1 is **-$13,687** and needs **$15,687** of cash. Every figure is a projection with estimates marked in `numbers.json`.

**Where the panel and the board agree and differ.** The first panel of 20 simulated buyers gave 1 buy (5%). After the offer was rebuilt (a 60-day setup refund, a free missed-call count, quote follow-up, call transfer, a stated install capacity) the same 20 gave **6 buys (30%)**, over the 25% bar. Both runs and the board name the same wall: **$1,999.99 asked before any proof**. The board voted 3 "fund if", 0 fund, 0 pass (5.3 of 10) and wants one trade, two municipalities and three paying clients first. It split on the setup fee: one lens wants it refundable, the other says it rightly pays for the install. The refund answers both, as long as the claim rate stays under about 18%. The panel is also the weakest evidence here: 30% is an upper bound.

**The biggest risk.** One person does everything and nobody has measured the hours, so the client ceiling is unknown. The plan: cap installs at what the first three actually cost (the proposal of 5 a month holds only if an install takes about 17 hours), and read every transcript for the first 14 days.

**What the founder needs to start.** Cash of $15,687 at the placeholder wage, $3,489 at a $2,500 wage, $2,000 if no wage is drawn. The first test is three paid pilot clients in plumbing or HVAC within 45 days of launch, at least one by referral. The default launch date is Monday 2026-12-07 (`launch.md`). Before it: a lawyer's read of the guarantee wording, call transfer wired into both plans (the code grants it only to a legacy plan and the site still says "does not transfer calls"), and the board's quality bar on open bugs.

**The one thing to do this week.** Give the CFO your real monthly pay and your real hours per install, and re-run `/founder-cfo`. The verdict changes or holds on those two numbers.

**Said once, clearly.** The buyer panel is simulated buyers and the numbers are projections; real customers and real quotes confirm them. This is not financial, legal or tax advice.

## What the board said

**Vote: 3 fund if, 0 fund, 0 pass. Average score 5.3 / 10** (Offers 5, Monopoly 5, Product 6).

Nobody passed and nobody funded outright. All three members see a built product aimed at a real, well-described pain, and all three stop at the same place: the business has not yet shown that the thing the homeowner hears works, that the numbers under the price work, or that one person can sell and install it at any volume. Memos: `board/offers.md`, `board/monopoly.md`, `board/product.md`.

### Risks more than one member raised

1. **One calendar does everything** (all three). Demo, audit, install, message-writing, scenario testing, monitoring and bug fixes are all founder hours, and the install is also the differentiator, so it cannot simply be cut. Hours per install and per customer per month are unknown. The Monopoly lens calls the resulting customer ceiling the limit on "a big share of a small market"; the Product lens adds that while the founder is on a demo, nobody is watching the live receptionist.
2. **The allowance cap is unpriced and its behaviour undefined** (all three). Nobody knows the minutes and text segments per plan, the per-minute cost of voice and telephony, or what the receptionist does on the next call once the cap is hit and no overage has been confirmed. The Offers lens: the 11 p.m. no-heat call in January is either unanswered (the one outcome the buyer paid to avoid) or served unbilled; either breaks the offer.
3. **$1,999.99 asked before any proof** (Offers, Monopoly). No customer count, no captured-call numbers, no testimonial, no recorded call. The largest cheque comes first and the only evidence is a live demo the buyer cannot check against a real result.
4. **No beachhead** (Offers, Monopoly). Five trades, four municipalities, two languages is a region, not a wedge. Both want one trade (plumbing or HVAC, where a rung-out call is lost in twenty seconds) leading the message, and the referral program only becomes a channel once customers are dense enough to know each other.
5. **The emergency seam** (Offers, Product). "24/7" on the headline, "emergency handling stays with the contractor" in the fine print, no call transfer. When the caller says "I need someone now" at 11 p.m. and the contractor is asleep, what the homeowner hears and what the contractor's phone does is undescribed.
6. **Quote chasing is on the site, not clearly in a plan** (Offers, Monopoly). The $9,000 quote that goes quiet is the site's third failure moment; neither plan names quote follow-up.
7. **Competitor prices are unknown** (all three). Without the monthly price of a bilingual human answering service in Montréal and of the two nearest generic AI tools, "premium position" is untestable.

### Conditions, merged

Tick these off as the rest of the pack answers them.

- [ ] Competitor map with real Montréal prices: bilingual human answering services and the two nearest generic AI answering tools. Confirm $249 / $349 is a premium position, not an accidental price leader. (`/founder-competitors`)
- [ ] Head-to-head Québec French test against the two nearest generic tools with real contractor callers, recorded. (founder, `/founder-ops`)
- [ ] Allowance per plan, cost per answered minute and per text segment, gross margin per plan at the allowance. (`/founder-cfo`)
- [ ] A cap rule that never leaves a call unanswered, and a defined receptionist behaviour at the cap. (`/founder-cfo` for the cost, `/founder-ops` for the behaviour)
- [ ] Hours per install, hours per customer per month, cost per demo, and the resulting one-person customer ceiling. (`/founder-cfo`, `/founder-ops`)
- [ ] Days from checkout to first live answered call, and contractor hours required during setup, stated on the site. (`/founder-ops`, `/founder-launch`)
- [ ] One beachhead: one trade (plumbing or HVAC), one or two municipalities, a share target. No new region until it is met. (`/founder-consumer` sizes it, `/founder-marketing` leads with it)
- [ ] How many contractors fit the profile in the service area and how many are reachable by demo in a year. (`/founder-consumer`)
- [ ] A printed guarantee on the setup fee: refunded or credited against monthly fees if a stated 60-day result is missed (requests captured on Essential, appointments booked on Professional). The CFO confirms it is affordable. (`/founder-offer`, `/founder-cfo`)
- [ ] Real onboarding capacity per month stated on the site, as the only honest urgency. (`/founder-offer`)
- [ ] Decide whether quote follow-up is in a plan. If yes, name it in the plan; if no, take it off the site. (`/founder-offer`)
- [ ] Website service out of the launch offer. (`/founder-offer`)
- [ ] Per-trade install templates (scripts, scenarios) so the second plumber takes a fraction of the first's hours while the founder-tested promise holds. (`/founder-ops`)
- [ ] A written, night-tested urgent-call path with a defined behaviour when the contractor does not acknowledge within a set time, tested from a real phone. (`/founder-ops`)
- [ ] A measured capture-accuracy rate from recorded Québec French calls (name, number, address, service, urgency, no correction needed), with a target set and met before selling past the first hand-held cohort. (`/founder-ops`, `/founder-launch`)
- [ ] Professional setup includes a calendar-hygiene step and a defined empty-calendar behaviour. (`/founder-ops`)
- [ ] No paying customer goes live until the high-severity bugs are closed and no screen a contractor or caller touches has a missing translation. (founder, before `/founder-launch`)
- [ ] Three paying customers in the lead trade with before/after call counts quotable in a demo. (`/founder-launch`)
- [ ] One paying customer sourced by referral rather than founder outreach before any marketing spend. (`/founder-launch`)

### Where the board disagrees

- **The setup fee.** The Offers lens wants it guaranteed or credited back; the Monopoly lens says it rightly pays for the install and protects the business from eating that cost. Both can hold if the guarantee is tied to a measurable result and the CFO shows the refund exposure is survivable.
- **Speed versus polish.** The Offers lens wants three paying customers in one trade as fast as possible, as proof. The Product lens will not let a paying customer go live with the known bugs and missing translations. The order matters: close the bugs first, then sell three.
- **Scarcity.** The Offers lens wants the one-person install capacity used as urgency on the site. The Product lens treats that same scarcity as the risk that nobody watches the live receptionist during a demo. Stating capacity honestly serves both.
- **Templating the install.** The Monopoly lens wants per-trade templates to cut hours; the Offers and Product lenses treat the founder writing every message with the customer as the thing being paid for. The Monopoly condition is careful to keep the promise; the question is how much of the install is genuinely bespoke.

### The strongest version this board can see

A plumbing-and-HVAC service, Laval and Montréal first, whose headline promise is narrower and harder than "we'll handle the calls": the urgent call, at night, in French, handled correctly, with a defined path when the contractor cannot pick up. It is sold with recorded Québec French calls a buyer can listen to, three named customers with before/after call counts, a setup fee credited back if a stated 60-day result is missed, and an honest monthly install capacity. The install is productized into per-trade templates so the founder's hours per customer fall without dropping the founder-tested promise, and the allowance and the behaviour at the cap are published. The website add-on comes out of the offer, and quote follow-up is either in a plan by name or off the site. This differs from the pitch in three ways: five trades become one, four municipalities become two, and the generic "every call answered" becomes the specific emergency the pitch already describes and the generic tools are least likely to handle.

## The competition

Read date: 2026-11-12. Every fact below comes from a public page read that day, linked in `competitors.csv`. Where a page could not be read, or a number comes from a search snippet or a competitor's blog, it is marked. Nothing is invented.

**The short version.** The market a Laval plumber sees is crowded at the bottom and thin in the middle. At least ten vendors sell a bilingual French/English AI receptionist to Québec or Montréal businesses, from 18.99 $ to 797 $ a month. None of them charges a published setup fee; three say in writing that there is none. None publishes a customer count, a rating or a single review. The two that are built for trades and run from Québec (AutoScale AI, JGSolutions) cost 797 $ a month. TradeCatch at 249 $ / 349 $ plus 1,999.99 $ setup lands between Voxify (300 $, Montréal, unlimited, no setup) and those two, and is the only one asking for 2,000 $ before the first call.

### 1. The table

Sorted by how directly each competes (bilingual AI receptionist, Québec, trades first).

| # | Competitor | Type | Where | Comparable price | Québec FR | Trades named | Setup fee | Booking | Urgent path | Reviews |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [AutoScale AI](https://autoscaleai.ca/receptionniste-ia-entrepreneurs-quebec) | Direct | Saint-Zotique QC | 797 $ CAD/mo, 700 min, 1.10 $/min over, no annual contract | Yes | HVAC, plumbing, roofing, doors/windows, tree care | Not stated (72-h setup) | Cal.com, Google/Outlook, GoRendezVous, Jobber, ServiceTitan | Transfer to on-call number | None found |
| 2 | [JGSolutions](https://jgsolutions.ca/ai-voice-agent-plumbers-montreal.html) | Direct | Saint-Laurent QC | 797 $ CAD/mo alone; 1,497 $ with SEO + site; month-to-month | Yes, "no press-1" | Montréal plumbers | Not stated | Google, Outlook, Jobber, ServiceTitan, Housecall Pro | Texts or calls the plumber | None found |
| 3 | [Voxify](https://voxify.ca/) | Direct | Montréal QC | 300 $ / 500 $ CAD/mo, unlimited calls, no contract | Yes, same call | Contractors, plumbers, electricians, landscapers, snow removal | None (stated) | Pro: Google/Outlook; contractors get a texted booking link | Owner texts OFF to take calls; no transfer stated | None found |
| 4 | [Cedri](https://cedri.ca/fr/receptionniste-ia/plombier) | Direct | Canada | 18.99 $ CAD/mo for 30 calls; packs after | Yes, switches with caller | Plumber, HVAC, electrical pages | Not stated | Own agenda; Google/Outlook sync beta | Urgent to chosen number; transfer | None found |
| 5 | [AlmaTalk](https://almatalk.ca/receptionniste-virtuelle-quebec) | Direct | Ottawa ON (serves Québec City) | 97.97 $ CAD/mo for 150 min; 247.97 $ for 400 | Yes, mid-sentence | Plumbing, heating, locksmith, towing | None (stated) | Google, Outlook, Cal.com, Apple | Transfer when needed | None found |
| 6 | [AutoRev](https://autorev.ai/ai-receptionist/plumbers/montreal-qc) | Direct | Miami FL | Not stated; 14-day trial | Yes, mid-call | Montréal plumbers | Not stated | Live calendar; ServiceTitan, HCP, Jobber, FieldEdge | To tech on rotation; texts hang-ups | None found |
| 7 | [Polaris Voice](https://polarisvoice.ca/cities/montreal) | Direct | Toronto ON | $199–$299/mo; 7-day trial | Yes, detects language | No (legal, dental, real estate) | Not stated | Google, Outlook, Jane, Clio | Not stated for trades | None found |
| 8 | [Dialbox](https://dialbox.ca/coverage/business-answering-service-in-montreal-quebec) | Direct | Canada | From $129/mo; 7-day trial, card required | Bilingual stated | "Home service businesses" | Not stated | Google, Microsoft, Calendly, Acuity... | Transfers to staff | None found |
| 9 | [1n1.ai](https://1n1.ai/blog/ai-answering-service-montreal) | Direct | Vancouver BC | $79/mo 250 min; $129/mo 500 min | Native, Québec named | Contractors named | Not stated | Not stated | Human-first routing (rings you first) | None found |
| 10 | [The Voice Agent](https://thevoiceagent.ca/answering-service-for/plumbers) | Direct | Brampton ON | 749 $ CAD/mo; 7 days free | **No**, English only, French "being added" | Plumbers | Waived | None yet | Flagged; transfer by rules | None found |
| 11 | [RTL Centre d'appel](https://gortl.com/) | Indirect (human) | Montréal QC | Search snippet: from 90 $/mo bilingual 24/7. **Unverified**: site body unreadable | Bilingual (title) | Unknown | Unknown | Unknown | Unknown | None found |
| 12 | [Jobber Receptionist](https://www.getjobber.com/features/ai-receptionist/) | Indirect (software add-on) | Canada/US | $29 USD/mo add-on; in Plus $399–$699 USD | **Not stated** | Jobber users (trades) | Not stated | Jobber schedule | Keyword transfer; texts hang-ups | App 4.5 / 4,883 (not the receptionist) |
| 13 | [Housecall Pro HCP Assist](https://www.housecallpro.com/hcp-assist/) | Indirect (human add-on) | US | Not stated; software $59–$329 USD | Not stated | HCP users | Not stated | HCP calendar | Text alerts to business | Software 4.7 / 2,700+ |
| 14 | [Smith.ai](https://smith.ai/pricing/ai-receptionist) | Indirect | US | AI $150/mo 75 calls; human $300/mo 30 calls; +$1.50/call booking; no setup fees | Not stated (Spanish add-on) | No | None (stated) | Calendly, Acuity (paid per call) | Human backup, transfers | Trustpilot 4.2 / 377 |
| 15 | [Ruby](https://www.ruby.com/pricing/) | Indirect (human) | US | $250/mo 50 min to $1,725/500 min; no activation fees | Not stated (Spanish) | No | None (stated) | Optional | Forwarding | Not shown; [ConsumerAffairs page 403](https://www.consumeraffairs.com/business/ruby-receptionists.html) |
| 16 | [Rosie](https://heyrosie.com/pricing) | Indirect | US | $49/mo 250 min; $149 1,000 min with booking | No (EN/ES) | No | Not stated | Scale+ | Warm/live transfers | Trustpilot 0 reviews |
| 17 | [Goodcall](https://www.goodcall.com/pricing) | Indirect | US | $79/mo 100 customers | Not stated | No | Not stated | Not stated | Transfers | Trustpilot 2.5 / 5 |
| 18 | [Podium](https://www.podium.com/pricing/) | Indirect | US | Not stated (sales); blogs cite $399–$599 annual, unverified | Not stated | Home services page | Not stated | "Schedules" | Not stated | [Capterra page 403](https://www.capterra.com/p/164285/Podium/reviews/) |
| 19 | Voicemail / let it ring | Substitute | The contractor's phone | $0 | — | — | — | — | — | — |
| 20 | Spouse, office person, part-time dispatcher | Substitute | In-house | Wages | — | — | — | — | — | — |
| 21 | Owner answers on the job / forwards to a tech | Substitute | The contractor's phone | $0 plus interrupted work | — | — | — | — | — | — |

Also seen but not read: [OnCallCentre](https://oncallcentre.com/remote-receptionist-for-busy-field-service-teams/) (human bilingual EN/FR remote receptionist for field-service teams, Montréal and Ottawa, no price in the snippet), [Omnivision Design](https://www.omnivisiondesign.com/fr/services-gestion-appels/) (Montréal, 125 $/mo, 8 h to 20 h, page about three years old per the snippet). The [ADUX/ADEL](https://www.adux.ca/adel) result from the search was a marketing consultancy, not a receptionist; the "350 $/mo + 0.50 $/min" in the search snippet does not appear on the page and is dropped.

### 2. Price range

Comparable item: a bilingual (Québec French + English) AI receptionist a Montréal contractor can buy today, monthly, before usage overage. Ten vendors, two unpriced (AutoRev) or English-only (The Voice Agent) excluded, leaving eight.

| | Monthly | Who |
|---|---|---|
| Lowest | 18.99 $ CAD | Cedri (30 calls) |
| Median | ~164 $ | between Dialbox ($129) and Polaris ($199) |
| Highest | 797 $ CAD | AutoScale AI, JGSolutions |

The trade-specific, Québec-based pair sits alone at 797 $. The Montréal generalist that names contractors (Voxify) is 300 $ unlimited with no setup fee.

**Where TradeCatch lands.** Essential 249 $, Professional 349 $, plus 1,999.99 $ once.

| Year 1 effective monthly | Year 2+ |
|---|---|
| Essential: (1,999.99 + 12 × 249) / 12 = **415.66 $** | 249 $ |
| Professional: (1,999.99 + 12 × 349) / 12 = **515.66 $** | 349 $ |

In year one TradeCatch costs 1.4 to 1.7 times Voxify and about half of AutoScale AI or JGSolutions. From year two it matches Voxify. No competitor on this list publishes a setup fee; Voxify, AlmaTalk, Smith.ai and Ruby state in writing that there is none, and The Voice Agent says its setup fee is waived. The 1,999.99 $ is the single most visible difference on any comparison a buyer will make. Human services for scale: Ruby 250 $ buys 50 minutes; Smith.ai 300 $ buys 30 calls; the only Montréal human price seen (RTL, 90 $) could not be verified.

### 3. Positioning map

Axes that matter to this buyer: **how much is done for you** (self-serve setup through to someone installs, tests and watches it) against **monthly price**.

```
DONE FOR YOU
(installed, tested, watched)
   |
   |                                       AutoScale AI (797, 72-h setup, trades)
   |                                       JGSolutions (797, plumbers, Montréal)
   |
   |                 TradeCatch Pro (349 + 2,000 setup)
   |            TradeCatch Essential (249 + 2,000 setup)
   |
   |   HCP Assist (human, price n/s)     Ruby (human, 250/50 min)   Smith.ai human (300/30 calls)
   |
   |                   Voxify (300, Montréal, unlimited, no setup)
   |      Dialbox (129)      Polaris (199-299)
   |  1n1 (79)   AlmaTalk (98)      Smith.ai AI (150)
   |  Cedri (19) Jobber add-on (29 USD) Rosie (49) Goodcall (79)
   |
SELF-SERVE ------------------------------------------------------ PRICE / MONTH
 cheap                                                              expensive
```

Reading it: the bottom-left is crowded with self-serve tools that a contractor configures alone and that give no proof they handle Québec French well. The top-right has two Québec vendors who install for you at 797 $. TradeCatch is pitching the top-right service at a middle-column monthly price, and funding the gap with a setup fee nobody else charges. Whether buyers read that as "fair price for the install" or "2,000 $ before I've heard it work" is the question `/founder-consumer` must answer.

### 4. What their customers complain about

Honest limit first: **no public review exists for any of the ten bilingual Québec/Canada vendors** (Cedri, Voxify, AutoScale AI, AlmaTalk, JGSolutions, Polaris, Dialbox, 1n1, AutoRev, The Voice Agent). A [targeted search](https://www.google.com/search?q=Cedri+OR+Voxify+OR+%22AutoScale+AI%22+OR+AlmaTalk+r%C3%A9ceptionniste+IA+avis) returned nothing, and none of their pages shows a rating or count. Rosie has [zero Trustpilot reviews](https://www.trustpilot.com/review/heyrosie.com). Ruby's [ConsumerAffairs](https://www.consumeraffairs.com/business/ruby-receptionists.html), Podium's and Jobber's [Capterra](https://www.capterra.com/p/137005/Jobber/reviews/) review pages returned 403 and were not read. Reddit searches returned no threads. What follows is from the two readable review pages and one operator forum.

1. **Charges that continue after cancelling, or prices that change without notice** (Smith.ai ~12 reviews, Goodcall ~3). [Smith.ai Trustpilot](https://www.trustpilot.com/review/smith.ai): "they charged my account for another month and refused to refund me" (17 Aug 2026). [Goodcall Trustpilot](https://www.trustpilot.com/review/goodcall.com): "the company continued charging our card month after month" (2 Jun 2026). Smith.ai replies to 92% of negative reviews and disputes several.
2. **Cancellation friction** (Smith.ai ~6). "They make you email to request cancellation!!" (15 Jan 2026, [source](https://www.trustpilot.com/review/smith.ai)).
3. **Unresponsive support** (Smith.ai ~5; Goodcall 2, thin). "they ignored all calls and emails" (7 Jul 2026, [source](https://www.trustpilot.com/review/smith.ai)).
4. **The AI mishandles calls and frustrates callers** (Smith.ai ~5). "Ai barely works, consistently making errors and frustrating callers." (10 Nov 2026, [source](https://www.trustpilot.com/review/smith.ai)). On the [Jobber operations forum](https://community.getjobber.com/discussions/operations-forum/ai-receptionist-vs-outsourced-vs-owners/7842), an HVAC operator's view is that AI is fine for after-hours, routing and spam, but struggles with urgency and trust; another describes using the AI only to capture the request, with an office person calling back to confirm. Thin as a count, but it is the only trade-operator voice found.
5. **Spam and routing** (Smith.ai ~3, thin). "resulting in 100+ spam calls per month" (15 Feb 2026, [source](https://www.trustpilot.com/review/smith.ai)).

Not found anywhere: complaints about language handling or calendar/CRM integration failures. Absence of evidence, not evidence of absence; the Québec vendors simply have no reviews.

A competitor blog reports Ruby paid a [$12 million settlement in 2021 over billing practices](https://admin-panel-ruby-xi.vercel.app/blog/ruby-receptionist-alternatives-2026); the source page could not be verified and the figure stays unconfirmed.

### 5. The gap

There is a gap, and it is narrower than the pitch assumes.

**What nobody does, with the evidence:**

- **Proof.** Not one of the ten bilingual vendors shows a customer count, a rating, a review or a recorded Québec French call. The whole category sells on claims. Three named Montréal customers with before/after call counts and three recorded calls would be unique in this market today. This is the cheapest gap on the list and the one the board asked for.
- **Done-for-you at a mid-market monthly.** Only AutoScale AI and JGSolutions install for you, and both charge 797 $ a month. Everyone under 300 $ is self-serve. TradeCatch's install-and-monitor model at 249 $ / 349 $ is alone in its column, provided the setup fee is defended as the price of that install (see the threat below).
- **"Nothing speaks until you approve the wording."** No competitor page states owner approval of every message. The Jobber forum shows operators building that human check themselves; TradeCatch sells it built in.
- **Quote follow-up.** No receptionist vendor mentions chasing a sent estimate. Voxify's closest feature is a recovery text 30 minutes after an unbooked call. TradeCatch's site names "the quote that goes quiet" and neither plan names it; if it were productized and named, it would be unmatched on this list.
- **Data residency as a line item.** Cedri says call audio and transcripts pass through the US; Voxify says its servers are in Oregon; AlmaTalk advertises Canadian storage (AWS ca-central-1). Residency is already being used as a selling point in this market. TradeCatch's own position is not stated in its copy and should be.

**Where the gap runs against TradeCatch:**

- **The setup fee is naked.** Nobody else charges one, and four say so in writing. On a side-by-side it is the first number a buyer sees. It must either buy something visible (a named person, a test report, a guarantee) or come down.
- **Every direct competitor offers an urgent-call escape that TradeCatch does not.** AutoScale AI transfers urgent calls to an on-call number; Cedri routes urgent calls to a chosen number; AutoRev pushes to the tech on rotation; JGSolutions texts or calls the plumber; AlmaTalk and Dialbox transfer. TradeCatch states "no call transfer." For a plumber selling emergency service, this is a feature gap the competitor map makes visible, and it matches the board's emergency-seam risk.
- **Jobber is already in the contractor's pocket.** A $29 USD add-on inside software the contractor already pays for, that books into the schedule they already use and texts back hang-ups, is the cheapest switching cost on the list. Its French support is not stated anywhere readable; if Jobber adds Québec French, it takes the Jobber-using segment at a price TradeCatch cannot touch.

### 6. The threat: who copies fastest

1. **Voxify** (Montréal, 300 $, unlimited, already names plumbers and electricians, no setup fee). To match TradeCatch it needs an onboarding package and an urgent-transfer rule. Both are weeks of work for a company that already sells in the same city in the same French. It is the most dangerous because it is cheaper, local and already live.
2. **AutoScale AI** (Saint-Zotique, trade-specific, 72-hour setup, urgent transfer already built). It only needs to cut its monthly from 797 $ toward 400 $ to sit on top of TradeCatch Professional with a longer feature list. One pricing decision.
3. **Jobber** (Canadian, in the hands of the buyer already). Adding French to the Receptionist absorbs every Jobber customer in the service area for $29 a month.
4. **Any Montréal agency bundling a voice API with French prompts.** JGSolutions is exactly that at 797 $; the Monopoly lens predicted this and the map confirms it already exists. The barrier is a sales page, not technology.

What none of them can copy quickly: a named founder with recorded Québec calls, three local customers who will take a reference call, and a published install process with a capacity number. That is the moat the board described, and the map shows it is still unclaimed.

### Hand-offs

- `/founder-consumer`: test the objections this map produces: "2,000 $ before I've heard it", "Voxify is 300 $ with no setup", "what happens at 11 p.m. if there's no transfer", "my Jobber already has a receptionist", "where does the audio go".
- `/founder-pricing`: comparable range 18.99 $ to 797 $, median ~164 $, done-for-you tier 797 $; year-one effective TradeCatch 416 $ / 516 $.
- `/founder-offer`: the setup fee needs a visible deliverable or a guarantee; urgent escalation and quote follow-up are the two features the map says to name.
- `/founder-cfo`: AutoScale AI's 1.10 $/min overage is the only published Québec per-minute price; use it as a ceiling check on TradeCatch's own cost per minute.

## The buyer panel

**6 buy · 14 pass** (30% buy) out of 20 simulated buyers. Seed 7, so the same cards can be dealt again.

These are simulated buyers, not customers. Use this to find objections and weak spots, then confirm the big ones with real people before you spend.

### By segment

| group | buyers | buy rate |
| --- | ---: | ---: |
| Growing business, 6 to 10 employees (business revenue) | 3 | 67%  (thin) |
| Small service business, 2 to 5 employees (business revenue) | 7 | 29%  (thin) |
| Solo contractor (plumber, electrician or HVAC), business revenue | 8 | 25% |
| Renovation, roofing or landscaping business (business revenue) | 2 | 0%  (thin) |

### By buying behaviour

| group | buyers | buy rate |
| --- | ---: | ---: |
| Bilingual service matters | 2 | 50%  (thin) |
| Wants it simple | 2 | 50%  (thin) |
| Personal phone, voicemail or an employee answers | 5 | 40%  (thin) |
| Manages appointments by hand | 3 | 33%  (thin) |
| Misses calls on the job | 5 | 20%  (thin) |
| Uses scheduling or CRM software | 3 | 0%  (thin) |

### By income

| group | buyers | buy rate |
| --- | ---: | ---: |
| $789,000 and up | 7 | 43%  (thin) |
| $277,000 to $789,000 | 7 | 29%  (thin) |
| under $277,000 | 6 | 17%  (thin) |

### Why they pass

| reason | buyers | in their words |
| --- | ---: | --- |
| trust | 7 | "I would call the demo line and probably take the free call-log count, but I would not wire $2,000 in the first month to a one-man setup that has no live clients to show me yet. My calls are my revenue and I want to see it work for somebody else first." (P002) · "Two grand up front for something that has no customer I can call yet, and the open spots are plumbers and HVAC, not roofers or landscapers. My cell and my guys already catch most of it, so I'm not signing on a promise." (P004) |
| price | 4 | "I do miss calls when I'm up on a roof or in a client's house, and chasing quotes is a real hole for me, but $1,999.99 up front plus $249 a month is a lot to commit to a one-man outfit I've never heard of. I'd probably try the free demo, but I'm not paying before I've seen it land one real job." (P007) · "Two grand up front plus 250 a month is real money, and the guarantee only promises 10 messages, not 10 jobs. I'd call the demo line and maybe sit through the free demo, but I'm not signing this week." (P012) |
| habit | 2 | "Keeping my number is good, and the guarantee is fair, but all my jobs already live in my scheduling software and this only books into Google Calendar. So every call it catches I'd be retyping into my system on a Sunday night, and I'm not putting $2,000 down for that." (P010) · "Everything I book already lives in my scheduling/CRM tool, and this one books into Google Calendar instead. So I'd be keying jobs in twice, and double entry is exactly how I end up with a missed appointment. I'd take the free demo, but I'm not paying $2,000 upfront off a first look." (P014) |
| convenience | 1 | "I run my jobs and appointments out of my scheduling/CRM tool, and this books into Google Calendar, not into that. So every lead it catches I'd have to re-type into my system, and I'm already doing invoicing on Sunday night with nothing left over. $2,000 up front plus $249 a month for something that doesn't plug into how I already work is a hard sell this week." (P008) |

### Why they buy

| reason | buyers | in their words |
| --- | ---: | --- |
| need | 5 | "In winter I lose callbacks all the time because it's my cell or whoever's free, and one missed job costs me more than the monthly fee. The free demo, where he counts my missed calls first and walks away if there aren't enough, plus the refund if it doesn't catch 10, takes most of the risk off the $2,000." (P001) · "I lost a $9,000 kitchen job last month because a quote sat unanswered, so one saved job pays for the setup and a good part of the year. The free demo costs me nothing and he walks away if my missed calls are too few, so I would sit down with him and sign on the Essential plan if the count is there." (P003) |
| convenience | 1 | "I'm under a sink or on a roof half the day and every call I miss is a job that goes to the next guy. He sets it all up with me and I hear the test calls before it goes live, so I don't have to touch any software, and if it doesn't catch 10 calls I get the setup back." (P019) |

### What would flip a no

- A reference call with a plumber or HVAC owner in Laval or Montréal who is already live and will tell me how many calls it caught, plus a recorded night-time French call that sounds like a real person from here.
- Talking to a roofing or renovation contractor in Laval who has had it running for a few months and can tell me how many real jobs it caught, plus the founder going through my own call log and showing me the missed calls.
- Calling the demo line and hearing it handle a stressed no-heat caller in Québec French without sounding like a robot, then the founder counting my own call log and showing me enough missed jobs that one recovered call a month clearly covers the $249.
- No setup fee up front: I'd pay it only after it has caught real quote requests, or a roofer or renovator I know tells me it booked him jobs.
- If it pushed the leads straight into my CRM so I never re-type anything, and the $2K setup came down or I could see real before-and-after numbers from another plumber or HVAC guy first.
- Only charging the setup after I've heard the French and English test calls and approved them, with my money back if I say no. Not just a refund based on a count of requests.
- If it pushed the captured requests into my scheduling software instead of just texting me and using Google Calendar, I'd book the demo and probably sign. Seeing from my own call log that I'm losing several real jobs a month would also get me to a yes.
- The call-log count in the free demo showing I'm really missing 15 or more real customer calls a month on jobs worth $500 or more, plus a reference call with another Laval or Montréal plumber or HVAC guy saying it turned into actual booked work.
- If it sent every captured call straight into my CRM, or I could keep my CRM as the master and only get clean text summaries to copy over in 10 seconds. A reference call with another contractor who uses the same CRM would help too.
- A reference call with another owner in my area who shows me how many of the calls it caught turned into paid jobs, and a setup fee that is lowered or credited against the first months if it does not.
- A plain written statement of where call data is stored and that it's never used for anything else, plus one plumber or HVAC guy in Laval or Montréal who has run it for a couple of months telling me it didn't botch a real call. Then I'd do the free demo and pay if my own call log shows enough missed calls.
- A call with a plumber or HVAC guy in Laval who has had it live for a couple of months, with his real before and after missed-call numbers, and no complaints from his customers.

Buyers say they would buy **1.0 times** in the first month on average.

20 buyers gave all four price answers. Run founder-pricing's van_westendorp.py on the answers folder.

## Pricing

Written 2026-11-15. All CAD, before GST/QST. The panel is 20 simulated buyers: it picks what to test with real contractors, it is not proof. Costs come from `cfo-sources.md`; margins from `founder/cfo.md` (founder pay is a placeholder there).

### 1. The price, and why

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

### 2. The ladder

| Rung | Price | Reason to step up |
| --- | --- | --- |
| Essential | $1,999.99 setup + $249 a month | Every call answered 24/7 in French and English, requests captured, urgent calls flagged, texts, dashboard. 500 call minutes, 1,000 texts (provisional). |
| Professional | $1,999.99 setup + $349 a month | Everything in Essential, and the receptionist books into Google Calendar during the call, with confirmations, reminders and rescheduling. 750 minutes, 2,000 texts (provisional). Leaves $45.88 more a client-month. |

- **Call transfer** (live as of today, per the founder): recommended in **both** plans, not as a step-up. Every direct competitor offers an urgent-call path, the board's emergency-seam risk is about exactly this, and the extra phone leg costs about CA$0.0133 a minute while it is open. **Check before it goes on the price page:** in the code today transfer is launch-gated behind the `callTransfer` flag and granted only to the legacy Receptionist plan (`src/product/saas/entitlements.ts`), not to Essential or Professional.
- No third rung at launch. The legacy plans exist only for current customers, and the website service ($699.99) comes out of the launch offer, per the board.

### 3. The opening offer

A **founding-client offer for plumbing and HVAC in Laval and Montréal**, matching the board's single beachhead. It is list price with the guarantee, not a discount, so nobody learns to wait for a sale:

- Full price, with the 60-day result guarantee printed.
- In return: a recorded Québec French test call before go-live, and a reference call plus before/after call counts once live (the proof the panel asked for: "two or three local owners I can call").
- **A real limit, not a countdown:** the number of installs the founder can do a month. Proposed: the first 5 installs, closing 2027-01-31 or when filled. **The founder must replace the 5 with the true capacity**; hours per install are not known yet (`board.md`).

### 4. What to test with real buyers

Test the setup structure, not the monthly price. Two arms inside the range, run in the free founder demos (about 20 a month, so roughly 10 per arm; treat it as a signal):

1. **Arm A:** $1,999.99 + 60-day guarantee: "if it does not capture at least N requests you would have missed, the setup fee is refunded."
2. **Arm B:** $999.99 setup, no guarantee.

Log demo, booked call, signed. Alongside, ask 10 real plumbers or HVAC owners the panel's flip question: "what would make you sign this week?" If Arm A signs at least as often as Arm B, A wins, because it keeps $971 more a client after card fees ($1,941.69 against $970.69). Set N (the guaranteed result) from real missed-call counts: three buyers said they do not know how many calls they miss, so the first step of each install should be counting them.

### 5. The panel's top price objections, verbatim

For marketing to answer. The fix each one needs is in brackets.

- **Paying before seeing it work** (6 of 19 passes): "Two thousand dollars just to set it up, before I've seen it catch a single job, is a lot to put down for something my customers might hang up on." (P020) [guarantee, recorded test call, reference call]
- **Cannot measure the return** (P007, P012): "I don't actually know how many calls I miss. If it's two a month, I'm paying 2,000 $ plus 249 $ a month for something my voicemail mostly does already." (P007) [count missed calls in the install audit; quote the count]
- **Urgent calls do not reach me** (P017): "...because it can't put an urgent call through to me and people in a panic don't want a text back." (P017) [answered by call transfer, once the plan placement above is confirmed]

### Rules kept

Nothing is priced below variable cost. No "was" price was invented. The guarantee's cost is modeled before it is promised.

## The offer

Written 2026-11-15. CAD. Method: the Offers lens in `founder-board/lenses.md` (a summary of the framework in Alex Hormozi's *$100M Offers*, not his words). Inputs: the panel's objections (`panel/results.md`), the competitor complaints and gaps (`competitors.md`), the board's conditions (`board.md`), the costs (`cfo.md`, `cfo-sources.md`) and the pricing decision (`pricing.md`). The panel is simulated buyers; the re-test result is at the bottom.

### 1. The problem list (buyer's words)

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

### 2. Solutions, scored

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

### 3. The stack

**Name (proposed, founder to approve):** *The Caught-Call Install* (FR: *L'installation Appels captés*).

**The core, by outcome.** Calls you can't pick up are answered in your company's name, in Québec French or English, 24/7; the caller's details reach your phone in seconds; an urgent caller is connected to you if you press 1; a quote that goes quiet gets chased on day 1, 3, 7 and 14; and Professional also books the visit in your Google Calendar. Essential $249 a month, Professional $349, setup $1,999.99, all CAD, month to month.

**Bonuses (each kills one objection):**
1. **The missed-call count** (kills "I can't see the return"): in the free demo the founder goes through your recent call log with you and counts the calls that went unanswered; a month-1 report shows calls caught.
2. **The test-call pack** (kills "it will sound like a robot"): recorded French and English test calls, including a stressed no-heat caller at night, played to you before go-live; nothing speaks until you approve the wording.
3. **The reference call** (kills "nobody has used it"): once live, a call with the owner of a founding client plus their before/after counts. Starts only when the first real clients exist.

**The guarantee.** If 60 days after go-live the receptionist has not captured at least **10 caller requests that you did not pick up** (a number to prove with the first installs), the $1,999.99 setup fee is refunded. If the demo call count shows too few missed calls for this to pay, the founder says so and does not install. The refund does not return the $58.30 card fee or the founder's hours. The cost, run through the CFO tool at 12 new clients: -$4,800 a year at a 20% claim rate, -$12,000 at 50% (`pricing.md`). At a $2,500 founder wage year 1 stays above zero only while fewer than about **18%** of new clients claim (arithmetic: $4,312 profit / 12 x $1,999.99). The guarantee must be checked by a lawyer before it is printed; this is not legal advice.

**Urgency, only if true.** The founder's real install capacity, stated as a number. Proposed: the first 5 installs in plumbing and HVAC in Laval and Montréal, closing 2027-01-31 or when filled, whichever comes first. **The founder must replace the 5 with the true capacity.** No countdown, no "was" price.

### 4. Value equation, before and after (1 to 10, my judgement)

| Element | Before | After | What moves it |
| --- | ---: | ---: | --- |
| Dream outcome | 6 | 7 | Named results: the urgent night call reaches you, quotes get chased |
| Likelihood of getting it | 3 | 6 | Guarantee, test calls, missed-call count. Reaches 7 to 8 only when three real clients can be called |
| Time to the result | 5 | 5 | No change until days to first live call are stated (open) |
| Effort and sacrifice | 4 | 6 | The refund removes most of the risk of the $2,000 and the audit removes the guess |

### 5. Re-test (2026-11-15)

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

## The numbers

### The CFO's note (written 2026-11-15)

Read the tables below with one translation: the tool's "a day" means "a month" here, so "13 client-months a day" is **13 active clients**. All figures are CAD before GST/QST. Several inputs are estimates the founder must replace (founder pay, LiveKit plan, other hosting, plan mix, demos a month); they are marked ESTIMATE or PLACEHOLDER in `numbers.json`, and every vendor cost has its source in `cfo-sources.md`.

**The margin.** One client-month leaves **$182.92 (61%)** after its own costs at the blended $299, with the voice minutes and texts fully used, so this is a floor. Essential leaves $159.98 (64%); Professional leaves $205.86 (59%), more dollars from the dearer plan. If a typical client uses 40% of the allowance (ESTIMATE, no real usage data yet), it leaves $244.45 (82%). The business covers its own running costs at about 1.5 clients (no founder pay, no setup income); the question is how many clients it takes to also pay the founder.

**The line to watch: the setup fee, and the founder's pay.** At the planned ramp (one net new client a month, 12 by month 12) the setup fee brings in $23,300 net in year 1, while 78 client-months of subscription leave $14,268. Take the setup income away and keep a $4,000 a month founder wage (PLACEHOLDER) and break-even moves from 13 clients to **24** and year 1 falls to **-$36,988**. This matters because every buyer-panel request is to drop, refund or delay that fee.

**Cash.** With the placeholder $4,000 wage: year 1 operating profit **-$13,687**, cash needed before it pays for itself **$15,687**, no payback inside 12 months. At a $2,500 wage: +$4,313 and $3,489 of cash. With no wage drawn: +$34,313 and $2,000 (the startup spend only). Same business, same clients; the founder's pay is the swing.

**Three ways to improve the margin** (each a tool run):
1. Sell Professional: $205.86 vs $159.98 contribution per client-month. Professional-only year 1 is -$11,898 against -$15,477 for Essential-only, $3,579 better.
2. Measure real usage and plan on it: at 40% of the allowance year 1 improves from -$13,687 to -$8,888 (+$4,799) and break-even falls from 13 to 10 clients. Needs the first month of real usage counters.
3. Set the overage rates now. None exists (`OVERAGE_RATE_*` have no defaults). Cost is CA$0.1091 a call minute and CA$0.0229 an outbound text segment, so any rate must be above those; the only published Québec rate seen is AutoScale AI's $1.10 a minute (`competitors.md`).

**Board money conditions** (`board.md`): allowance per plan, cost per minute and per text, and margin per plan at the allowance are now answered. **Not met:** a cap rule and what the receptionist does at the cap (a founder and `/founder-ops` decision; the cost ceiling is above); hours per install and per client per month and the one-person client ceiling (unknown inputs, so no capacity is entered and the plan's capacity check is skipped); the refund-guarantee exposure (`/founder-offer` models it next).

Not financial, tax or legal advice. An accountant should check the structure, the founder's pay and tax, and whether GST/QST applies on top of these prices, before money moves.

Every number below comes from the input file. Nothing is looked up or guessed.

### One client-month

| line | per client-month |
| --- | ---: |
| Price | $299.00 |
| Voice minutes at full allowance (avg of Essential 500 and Professional 750 min x CA$0.1091) | -$68.17 |
| Text segments at full allowance (avg of Essential 1,000 and Professional 2,000 x CA$0.0229) | -$34.38 |
| Transfer leg, ESTIMATE: 10% of minutes (62.5) x CA$0.0133 | -$0.83 |
| Card fee + Stripe Billing 0.7% (avg of Essential 9.26 and Professional 12.86) | -$11.06 |
| Twilio phone number rental, US$1.15 x 1.4257 (one local number a client, ESTIMATE) | -$1.64 |
| **Contribution** (what each client-month leaves to pay the fixed costs) | **$182.92** (61%) |

### The margin that matters

Fixed costs: $2,330 a month (Founder living wage drawn from the business (PLACEHOLDER, founder to set) $4,000, LiveKit Ship plan US$50 (ESTIMATE of plan; US$0 on Build) $71, Other hosting and software: Cloudflare, database, domain, email, monitoring (ESTIMATE) $200, LESS setup-fee income: 1 new client a month x (1,999.99 - 58.30 card fee) -$1,942).

- **Break-even: 13 client-months a day.** Below that you lose money every month.
- **Profit margin at your plan** (12 a day): **-4%** of every sale, after every cost.

### Year 1, month by month

| month | client-months a day | revenue | profit | cumulative (after $2,000 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | $299 | -$2,147 | -$4,147 |
| 2 | 2 | $598 | -$1,964 | -$6,110 |
| 3 | 3 | $897 | -$1,781 | -$7,891 |
| 4 | 4 | $1,196 | -$1,598 | -$9,489 |
| 5 | 5 | $1,495 | -$1,415 | -$10,904 |
| 6 | 6 | $1,794 | -$1,232 | -$12,136 |
| 7 | 7 | $2,093 | -$1,049 | -$13,185 |
| 8 | 8 | $2,392 | -$866 | -$14,052 |
| 9 | 9 | $2,691 | -$683 | -$14,735 |
| 10 | 10 | $2,990 | -$500 | -$15,235 |
| 11 | 11 | $3,289 | -$317 | -$15,553 |
| 12 | 12 | $3,588 | -$135 | -$15,687 |

- **Year 1 operating profit: -$13,687** on $23,322 of revenue.
- After the $2,000 startup spend: -$15,687.
- Startup money earned back: not within year 1.
- Cash you need before it pays for itself: **$15,687**.

### What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | -4% | 13 | -$13,687 |
| Price -10% | -15% | 16 | -$16,020 |
| Volume -20% | -20% | 13 | -$16,541 |
| Unit costs +15% | -10% | 15 | -$15,046 |

### Red flags

- Year 1 loses money on operations (-$13,687).
- The startup spend is not earned back within year 1.

## Marketing

Written 2026-11-15. CAD. Built from `panel/results.md` (re-test, 30% buy), `competitors.md`, `offer.md`, `pricing.md`, `cfo.md` and `board.md`. Budget and launch date were not given, so the plan spends nothing on paid media until the board's referral condition is met, and the calendar is in days from launch ("L"). The panel is simulated buyers: it picks what to try, it is not proof.

### 1. The audience and the evidence

- **First audience: plumbing and HVAC owners with 1 to 10 people in Laval and Montréal who answer their own cell on the job and run no scheduling or CRM software.** Panel buy rates after the offer change: growing businesses of 6 to 10 people 67% (3 buyers), small businesses of 2 to 5 people 29% (7), solo contractors 25% (8). Owners who answer on a personal phone or voicemail buy at 40% (5). Two groups did not buy: renovation, roofing and landscaping (0 of 2) and anyone who runs a scheduling or CRM tool (0 of 3, it fails again after the offer change). Every group is a handful of buyers, so each rate is a hint.
- **What the five new buyers said they needed:** a lost job (two tie it to the quote follow-up), the free missed-call count, the 60-day refund, a founder who installs it for them. The recurring "$9,000 kitchen" story comes from the profile text the buyers were given, so it is not independent evidence of what contractors say.
- **What marketing has to answer** (counted, `offer.md` section 5): no live client to call (6), "the guarantee counts requests, not jobs" (7), no CRM link (5), the $2,000 setup itself (4 passes for price), data location (2).
- **The gap** (`competitors.md`): none of ten bilingual vendors shows a customer, a rating or a recorded Québec French call; only two install for you, at $797 a month; none states owner approval of every message.

### 2. Positioning

Three versions of `For <segment>, who <problem>, TradeCatch is the <category> that <gap>, unlike <alternative>`:

- **A, the night call.** For plumbing and HVAC owners in Laval and Montréal who lose the urgent call when they are under a sink or asleep, TradeCatch is the bilingual phone receptionist that answers in your company's name and rings you through on an urgent call, unlike self-serve AI tools that only take a message.
- **B, the quote that goes quiet.** For contractors who lose big jobs because a quote was never chased, TradeCatch is the receptionist that also follows up every unanswered quote on day 1, 3, 7 and 14, unlike answering services that stop at the call.
- **C, the install with the risk taken out.** For owner-operators who will not hand their phone line to a tool they have never heard, TradeCatch is the done-for-you receptionist that the founder sets up, tests with you and watches, with the setup fee back if it does not catch 10 calls in 60 days, unlike self-serve tools with no install and $797 installers with no guarantee.

**Recommendation: lead with C, hook with A.** C answers the objection that kept most buyers out (trust and the $2,000 before proof) and is the only version no competitor can claim today; A is the sharpest first line for a plumber or HVAC owner (the board's strongest version of the business). B belongs inside the demo, as the second reason to sign. **Blocked until confirmed by the founder:** A needs call transfer to be live on both plans (the code gates it, see `pricing.md`), and C needs the 60-day refund approved and its wording read by a lawyer.

### 3. Channels

| Channel | Why it fits | Rough cost | How you will know it worked |
| --- | --- | --- | --- |
| **Direct outreach to a named list of 60 plumbing and HVAC owners** (visit, call, text from the founder's own number; a free demo is the sale) | The founder already sells by demo, and a bilingual owner-to-owner conversation is the thing a bigger vendor cannot copy. Highest conversion, lowest money | Founder time only. About 5 demos a week fits the proposed capacity of 5 installs a month | Demos held a week; missed calls counted in each demo; demo to signed |
| **Referral from the first clients** (the program exists: $50 to $75 e-Transfer per referred paid plan in `plan-catalog.ts`; the database default in `launch-plans.sql` is $65, so confirm which is live) | Trade owners trust each other more than any ad. It costs far less than any paid channel | $50 to $75 per referred sale, paid only on a sale | The board's condition: one paying client from a referral before any paid spend |
| **Supply-counter and trade-association presence in Laval and Montréal** (a flyer with a QR to the demo line, a short talk at a local association meeting) | It reaches owners where they already stop between jobs, in the languages they use, with a trusted third party | ESTIMATE: printing and a few hours; no figure researched | Demo-line calls and demo bookings that name the source |

**Not doing, and why:**

- **Paid search and paid social:** not until one client has come by referral (`board.md`). Then one capped test (a French landing page for "réceptionniste IA plombier Laval", with a $300 cap for four weeks, a proposal for the founder to set).
- **Instagram and TikTok:** owners on job sites do not browse them for a phone service, and video costs founder hours the capacity cannot spare.
- **Cold bulk email or text:** bulk messaging is not something TradeCatch offers, and Canada's anti-spam law requires consent for commercial electronic messages. Personal one-to-one outreach by the founder is different; check the rules. Not legal advice.
- **Selling to CRM and Jobber users:** zero buyers in both panel runs. Qualify them out in the demo.
- **Roofers, renovators and landscapers:** 0 of 2 buyers and the founding slots do not include them. Wait for the first plumbing and HVAC results.

### 4. The 30-day campaign

L is the day the founding offer opens (the founder sets it; the board will not let a paying client go live until the high-severity bugs are closed and no screen is missing a translation). The offer is the one in `pricing.md`: full price with the 60-day guarantee, first 5 installs, closing on the date the founder sets (proposed 2027-01-31, or when filled). It is a capacity limit, not a countdown.

| Day | Channel | What goes out |
| --- | --- | --- |
| L-14 to L-12 | Founder desk work | Record the demo-line test calls in French and English, including a stressed no-heat caller at night. Write the guarantee wording and have it read. Fill the three open facts: days to go-live, owner hours in setup, where data is stored |
| L-11 to L-8 | Direct | Build the list of 60 owners (name, trade, municipality, phone). Message 10 people the founder already knows: "I'm opening 5 founding installs for plumbers and HVAC; may I count your missed calls for free?" |
| L-7 | Direct | First 5 demos booked. Script: count the missed calls from their call log first |
| L-6 to L-1 | Direct | 5 demos a week; log missed calls counted, demo held, signed. Ask every demo "who else loses calls like you do?" |
| **L** | Direct, supply counters | Founding offer opens. Flyer to 3 supply counters (hook 1 and hook 3, QR to the demo line). Message the 60-name list |
| L+1 to L+4 | Direct | 5 demos a week. Hook 2 and hook 4 in the messages |
| L+5 | Founder desk | First weekly numbers review (section 6). Decide whether to change the message or the list |
| L+6 to L+9 | Direct, association | Ask one trade association for a 10-minute slot or a mention. Hook 6 and hook 7 |
| L+10 | Referral | First live client (if any) is asked for a reference call and the before/after count, with permission. Nothing is posted that is not theirs to share |
| L+11 to L+14 | Direct | 5 demos a week. Hook 5 in every quote-chasing conversation |
| L+15 | Founder desk | Second numbers review. If at least one client came by referral, open the capped paid-search test |
| L+16 | Founder desk | Write up what the first 30 days showed: demos, call counts, signs, objections heard. This is the real panel |

**Ten hooks** (French first, English gloss; each answers one objection or buyer reason; the two marked BLOCKED need the founder's confirmation first):

1. **"60 jours pour voir si ça capte vos appels. Sinon, l'installation vous est remboursée."** 60 days to see if it catches your calls, or the setup fee comes back. (paying before it works) BLOCKED: guarantee approval.
2. **"Combien d'appels ratez-vous par mois? On les compte ensemble, gratuitement. Pas assez? On vous le dit."** (can't measure the return)
3. **"Appelez notre ligne démo comme un client pressé. En français, en anglais. Jugez vous-même."** (will it sound like a robot)
4. **"Appel d'urgence à 23 h? Ça sonne chez vous. Vous appuyez sur 1, l'appel passe. Sinon, on prend les détails."** (urgent call can't reach me) BLOCKED: transfer on both plans.
5. **"La soumission qui dort? Relance par texto aux jours 1, 3, 7 et 14. Elle s'arrête quand le client répond."** (the quote that goes quiet)
6. **"Pas un logiciel à configurer seul. Je l'installe, je le teste avec votre équipe, je le surveille."** (what the setup fee buys against $300 no-setup tools)
7. **"Rien ne parle en votre nom sans votre accord. Chaque message, chaque scénario."** (will it say something I did not approve)
8. **"Gardez votre numéro. Ça sonne chez vous d'abord; on répond seulement si vous ne pouvez pas."** (I don't want to switch)
9. **"Où vont vos enregistrements d'appels? Une phrase, par écrit."** (data location) Needs the founder's facts before use.
10. **"Un client appelle en anglais ou en français : il est servi dans sa langue."** (bilingual service matters)

**When there is nothing new to say:** a short clip of the founder setting up an install with client details removed; a recorded test call from the demo line; the week's count of calls the demo line answered; "what I learned counting a plumber's missed calls", with permission and no names. No invented results, no stock "client" photos.

### 5. Budget and the most you can pay to win a client

- **Budget:** $0 paid until a client comes by referral; then at most the $300 four-week search test above (the founder's decision). The scarce resource is the founder's hours, not money: at 5 installs a month, 20 demos a month is the ceiling.
- **The most one client is worth winning for, with the sum:** setup fee net of the card fee, after the guarantee at a 20% claim rate, **$1,541.69** (`pricing.md`), plus 6 months of contribution at **$182.92** (`cfo.md`) = 1,541.69 + 6 x 182.92 = **$2,639.21**. Earning it back within 6 months is a rule of thumb, not a result.
- **The most one demo is worth:** at the panel's 30% buy rate (an upper bound) 2,639.21 x 0.30 = **$791.76**; at a pessimistic 10% close, 2,639.21 x 0.10 = **$263.92**. The panel's buyers say they would buy 1.0 times in the first month, so one buyer is one sale. Founder install hours are inside the founder's wage line in `cfo.md`, not here.
- **A referral costs** $50 to $75 a sale, far below any figure above.

### 6. The three numbers to watch each week

| Number | Change something when |
| --- | --- |
| Demos held a week (goal about 5) | Below 3 for two weeks in a row: change the list or the first message, not the offer |
| Demo to signed | Below 10% after 20 demos: the offer or the price is wrong; revisit `offer.md` and the setup-fee test in `pricing.md` |
| Missed calls counted per demo, median | Under 10 a month: this audience loses too few calls for the product to pay; move to higher-volume owners (6 to 10 people) |

### Rules kept

No fake reviews, follower counts, testimonials or before/afters. Panel answers are research and are never quoted as customers. Any paid partnership is disclosed, and claims follow the advertising rules of the market. Not legal advice.

## Brand

Written 2026-11-15. TradeCatch is already named, live at tradecatch.ca and built in production, so this brief **documents the brand that exists, tightens it around the positioning in `marketing.md`, and lists the gaps**. It does not invent ten new names; if the founder wants a rename, say so and the naming step can be run. Facts about the existing look come from the repo (`src/app/globals.css`, `src/fonts/index.ts`, `public/brand-mark.svg`, `src/messages/en.json`).

### 1. The name, and the checks the founder must finish

**TradeCatch.** "Trade" is who it is for (the trades); "catch" is the job (catch the call, catch the request). It sounds the same in French and English, reads on a sign and fits beside the check-mark logo. Risks: it is an English name for a market where French is the default (the bilingual site and a French tagline carry it), and "Trade" next to "Catch" can read as a trading product to someone who has not heard it.

What I could check on 2026-11-15 with public lookups:

| Check | Result |
| --- | --- |
| **tradecatch.ca** | Resolves and serves the site (HTTP 200). The product's own domain. |
| **tradecatch.com** | **Not free.** It resolves and redirects (HTTP 302) to a `www.atom.com/name/TradeCatch` page on a domain-name marketplace, so someone owns it and it appears to be for sale. I could not read the page (it returned 403), so the price is unknown. |
| Other domains | `tradecatch.app` and `tradecatch.io` returned no address in a DNS lookup. That is not proof they are unregistered; check at a registrar. |
| Existing businesses | Two web searches for "TradeCatch" or "Trade Catch" found no company, product, app or trademark under that name. Search results are thin for small businesses, so this is not clearance. |
| Confusion with the competitors in `competitors.md` | None sounds close (Voxify, Cedri, AlmaTalk, AutoScale AI, JGSolutions, Polaris Voice, Dialbox, 1n1.ai, AutoRev, The Voice Agent, Smith.ai, Ruby, Rosie, Goodcall, Podium, Jobber). The nearest "Trade-" names seen are TradeTapp (Autodesk, prequalification software), Trade Connect (an app for hiring tradespeople) and Tradesly (a trades answering service listed on Capterra Canada). Tradesly is the one to look at, because it is also a receptionist for trades. |
| Social handles | **Not checked.** Instagram, TikTok, X and YouTube block automated lookups. Check by hand for `tradecatch` and `tradecatch.ca`. |

**To finish yourself, with a trademark agent:** search the Canadian Trademarks Database (CIPO, https://ised-isde.canada.ca/cipo/trademark-search/srch) for "TradeCatch" and close variants ("Trade Catch", "TradeCatcher"), and the USPTO register (https://tmsearch.uspto.gov/) if you will sell in the US. Classes to check in the Nice system: 9 (software), 35 (business support), 38 (telecommunications), 42 (software as a service); an agent confirms which apply. Nothing is registered until the founder registers it. I can only run public searches; this is not legal advice on trademarks.

**A competitor `competitors.md` does not list:** the second search returned a listing for **FetchLine**, described as a done-for-you AI receptionist for owner-operated trade businesses in Canada (a third-party listing, not read in full, so unverified). If true, it narrows the gap in `competitors.md` section 5 ("done-for-you at a mid-market monthly"). Re-run `/founder-competitors` on it before the campaign leans on that gap.

### 2. Voice and promise

**The promise, one line:** *When you can't pick up, the call is still answered in your name, written down, and put in front of you right away.* Every word is deliverable today; it avoids "every call" and "24/7" as absolutes, because the board flagged the gap between the 24/7 headline and the fine print about emergencies and allowances.

**Tagline, three options** (the site's live line is option 1):

1. **"You're on the job. We'll handle the calls."** FR: *« Vous êtes sur le chantier. On s'occupe des appels. »* Already live on the home page. Keep it.
2. **"Calls caught. Jobs kept."** FR: *« Appels captés. Contrats gardés. »* Plays on the name and the check-mark logo.
3. **"Answered in your name. Approved by you."** FR: *« Répond en votre nom. Approuvé par vous. »* Names what no competitor states: owner approval of every message.

**Recommendation:** keep option 1 on the site, and use option 3 as the support line in the founder's outreach, because it carries the trust gap the panel kept raising.

**Voice, three adjectives:**

| Adjective | Do | Don't |
| --- | --- | --- |
| **Plain** | Short sentences and the words of the trade: job, quote, no-heat call. | "Solutions", "leverage", "AI-powered" as a selling word. |
| **Straight** | Say what it does not do and give the number: no CRM sync, no diagnosing, never transfers to 911, 10 captured requests in 60 days. | Absolutes without the fine print ("every call", "24/7 guaranteed"), or a fine print that contradicts the headline. |
| **On your side** | Talk to one owner ("you"), keep them in control ("nothing sends until you approve"). | Fake urgency, countdowns, fear of losing jobs as a threat. |

**Before and after, two lines from `pitch.md`:**

- Before: *"Each plan includes a monthly allowance of call minutes and text messages; extra usage is billed only if you confirm it."*
  After: *"Your plan covers a set number of call minutes and texts each month. If you go over, we ask you first. Nothing is charged until you say yes."*
- Before: *"It does not book into CRM tools such as Jobber; it books into Google Calendar."*
  After: *"It doesn't connect to Jobber or other CRM tools. It books straight into your Google Calendar, and every caught call reaches you as a text you can copy into your own system."*

### 3. The look, as a brief

**Colour** (all from `globals.css`; contrast computed for each pair, WCAG AA needs 4.5:1 for text and 3:1 for large text and icons):

| Colour | Hex | Its job | Text on it, contrast |
| --- | --- | --- | --- |
| **Navy** | `#0c141e` | Headings, dark panels, the logo tile | White on navy 18.51:1; orange on navy 6.10:1; 64%-white mono labels on navy 7.96:1. All pass |
| **Paper** | `#f4f1ec` | Page background | Navy on paper 16.43:1; body text `#1a2430` 13.92:1; muted `#566276` 5.48:1; secondary `#3d4855` 8.26:1. All pass |
| **Orange** | `#e4762b` | The "catch" accent: the check mark, primary buttons, highlights on navy | Navy label on orange 6.10:1 passes. **White on orange 3.03:1 fails for body text.** **Orange as text on paper 2.69:1 fails.** |
| **Ember** | `#96460f` | Orange when it must be text on paper | 5.86:1 on paper, passes |
| **Signal green** | `#2f9e68`, text `#1e6b47` | "Live" and success states | The text version is 5.74:1 on paper and passes; `#2f9e68` as text is 3.00:1, so use it only for icons or large shapes |

The rules that come out of the numbers: buttons are orange with a **navy** label, never white; orange text goes on navy only, and on paper uses Ember; green text on paper uses the darker `#1e6b47`.

**Type** (self-hosted in `src/fonts/`): **Archivo** 700 and 800 for display, **IBM Plex Sans** 400 to 700 for text, **IBM Plex Mono** 400 to 600 for numbers and labels. Both families are, to my knowledge, published under the SIL Open Font License and are free to use commercially (sources: https://github.com/IBM/plex for Plex and Google Fonts for Archivo). **The repo ships the font files with no licence text**; add the OFL notices and confirm at the source before shipping a printed asset.

**Logo brief.** The mark today is a navy rounded square with a thick orange check (`public/brand-mark.svg`, 64 by 64): it says "caught, done, confirmed", it reads at 32 px and on a dark app icon. What is missing, and what to brief:

- **A wordmark and a lockup.** `public/` holds only the mark and an open-graph image; I found no wordmark or reversed or one-colour version. A truck decal, an invoice, a stamp and an email signature need them.
- **Must work:** a sign or truck door at distance, a 32 px favicon and app icon, a one-colour print, and on both navy and paper.
- **Avoid:** a phone handset or a headset (the obvious choice for the category, though I did not check what competitors use), stock tool icons, a speech bubble, and any blue-and-white "tech" look (the existing navy and orange already separates it).
- **Competitors' looks were not reviewed in this run**, so check their logos and colours by eye before printing anything.
- I can generate concept sketches with an image tool if the founder has one. They would be marked as concepts, not a finished logo.

### 4. The first five touchpoints

| Touchpoint | What it does | The one line or move |
| --- | --- | --- |
| **1. The home page** | First look. Live today with *"You're on the job. We'll handle the calls."*, *Book a Free Demo* and *Hear the Receptionist*. | Add the missed-call count and the 60-day refund line once the founder has approved them. |
| **2. The demo line** | The first time anyone hears the brand. Today it answers, so it is the proof the panel keeps asking for. | Publish two recorded test calls (French night call, English day call) next to the number, with the caller's consent. |
| **3. The install pack** | In place of packaging: the test-call recordings, the list of messages for the owner to approve, and a one-page "what happens next". | State the days to go-live and the owner's hours (both open, `offer.md`). |
| **4. The confirmation** | The checkout confirmation and the first message after payment. | Say what the owner has paid, what comes next, who to call (the founder, by name), and how the 60-day guarantee works. |
| **5. The first complaint** | A reply within one hour, from the founder, in the customer's language. | *"You're right to be upset. I've pulled the call and I'm reading it now. Here is what I'll fix, and when you'll hear from me."* Offer the guarantee remedy if it applies; no excuses, no template apology. |

### Rules kept

No competitor's name, logo, colours or tagline was copied. No font, image or icon outside what the repo already uses. Not legal advice on trademarks.

## Operations

Written 2026-11-15. CAD. TradeCatch is a software service run by one person, so "operations" is the founder's calendar, the vendors the service stands on, the routines that make each install repeatable, and what happens when something breaks. Inputs: `idea.md`, `offer.md`, `numbers.json`, `cfo-sources.md`, `board.md`, the agent README and the metering code. **Founder hours are the one number nobody has; the plan below names how to measure them and what they imply.** `numbers.json` was not changed: no real cost differed from it.

### 1. The cycle

**A typical working day** (customer-visible steps marked **[C]**):

1. **Morning check (30 min).** Overnight calls, urgent flags, failed transfers, and whether the voice agent is awake (the README warns it can show "Sleeping" and take a cold start). For each client in their first 14 days, read every transcript. **[C]** when it finds a mistake: the founder tells the owner before the owner finds it.
2. **Install work.** For a client in setup: call-flow audit, configuration, writing messages with the owner, scenario tests with the owner's team. **[C]**
3. **Demos and outreach (about 5 demos a week, `marketing.md`).** Start each demo by counting the prospect's missed calls from their call log. **[C]**
4. **Client contact.** Test-call approvals, go-live calls, answers to questions. **[C]**
5. **End-of-day check.** Alerts, billing failures, the day's support messages; tomorrow's demos.
6. **After hours.** The product answers by itself. The founder is not on a call centre rota: what monitors the platform at night is an open question (section 7).

**Every week:** the three numbers in `marketing.md`; the allowance review (SOP 4); every live client's call counts and capture mistakes.
**Every month:** vendor price check against `cfo-sources.md`; the CFO's numbers re-run on real usage; guarantee claims and refunds logged.

### 2. Suppliers

The service stands on a few vendors. Prices below are public and were read on 2026-11-15 (sources and arithmetic in `cfo-sources.md`). **Alternatives are named so a failure has a second path; their prices were not researched and need a quote.**

| Input | Today | Public price | Second source (quote needed) | Lead time and terms |
| --- | --- | --- | --- | --- |
| Voice runtime, speech and the model | LiveKit Cloud (agent sessions, Inference, SIP) | $0.01 a session minute; speech model $0.05 a minute; language stream $0.0058; SIP $0.004; plan $0 (Build) to $50 a month (Ship) | Self-hosted LiveKit (open source), or another voice-agent platform | Self-serve, card billing, month to month |
| Phone numbers, call routing, texts | Twilio (Elastic SIP, Canadian numbers, SMS) | SIP origination $0.0045 a minute (local); SMS about $0.0161 outbound a segment; number $1.15 a month | A second Canadian SIP and SMS provider, or a Canadian carrier | Self-serve; Canadian geographic permissions must be enabled for transfers (a 403 on every transfer is usually this) |
| Card billing | Stripe Canada | 2.9% + $0.30 a card payment; +0.7% on recurring Billing | Another Canadian processor | Payouts on Stripe's schedule |
| App hosting and database | Next.js on Cloudflare; a Postgres database | Not read this run; `numbers.json` carries an ESTIMATE of $200 a month for hosting and tools | Quote | The founder's own accounts |

**Single points of failure:** one voice platform and one telephony provider. If either fails, the contractor's own business number still rings them first, but calls that would have gone to the receptionist go unanswered. What the caller hears in that case depends on the carrier's forwarding settings and has not been tested (open).

### 3. People

**Roles:** one, the founder. There is no employee and no contractor. Wage assumption: the $4,000 a month placeholder in `numbers.json`, set by the founder, not a market figure. Payroll taxes, source deductions and any future hire's costs depend on how the founder is paid; ask the accountant.

**Capacity, with the arithmetic.** A working week assumed at 45 hours is about 195 hours a month. Assume fixed duties of 25 hours a week (demos 8, monitoring 6, billing and admin 3, product fixes 8): about 108 hours a month, which leaves **about 87 hours a month for installs and early monitoring**. At the proposed 5 installs a month, that holds only if one install costs **about 17 hours or less** of founder time in total. **Every figure in this paragraph is an assumption, not a measurement.** Replace them with the real log from the first three installs (SOP 2 asks for the time of each step), and set the number of open installs on the site from that.

**Slow first month (a rota):** about 4 demos a week, 1 install in setup at a time, all transcripts read, monitoring light. **Planned volume (5 installs a month and 12 live clients):** demos fall to what the pipeline needs, transcripts are read for the first 14 days only, and the weekly review replaces daily reading for settled clients.

### 4. Routines

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

### 5. Tools

The smallest stack is already in place: Stripe for billing, Twilio and LiveKit for voice and texts, Cloudflare and a Postgres database for the app, and the TradeCatch dashboard itself for calls, requests and usage. **Gaps:** a bookkeeping tool for a Canadian small business and a place to keep the install time log. Neither was priced; get a current quote from the vendor's own page. Do not add a CRM: TradeCatch does not integrate with CRMs (`offer.md`).

### 6. Licences, registrations and insurance

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

### 7. Risk register

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

### Open questions for the founder

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

## Launch plan

Written 2026-11-15 (a Sunday). Inputs: `board.md` (the conditions), `offer.md`, `pricing.md`, `cfo.md`, `marketing.md`, `brand.md`, `ops.md`. **The launch date is a proposal:** the founder was not asked for one, so the default is the earliest date that fits the lead times below. Change `L` and every date moves with it. The product is built and in production; what remains is proof, paperwork and the founder's calendar. The founder is the owner of every task unless another person is named.

### 1. The test before the money

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

### 2. The countdown, from today to launch

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

### 3. Launch day: Monday 2026-12-07

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

### 4. The first 30 days

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

### Rules kept

No fake scarcity: the limit is the founder's real install capacity, and the date is the founder's to set. No testimonials until a client agrees to be named. Not legal advice; every legal and tax item in `ops.md` needs the named professional.

_The panel is simulated buyers and the numbers are projections from your inputs. Confirm demand with real customers and costs with real quotes before you spend. Not financial, legal or tax advice._
