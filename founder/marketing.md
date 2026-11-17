# Marketing: TradeCatch

Written 2026-11-15. CAD. Built from `panel/results.md` (re-test, 30% buy), `competitors.md`, `offer.md`, `pricing.md`, `cfo.md` and `board.md`. Budget and launch date were not given, so the plan spends nothing on paid media until the board's referral condition is met, and the calendar is in days from launch ("L"). The panel is simulated buyers: it picks what to try, it is not proof.

## 1. The audience and the evidence

- **First audience: plumbing and HVAC owners with 1 to 10 people in Laval and Montréal who answer their own cell on the job and run no scheduling or CRM software.** Panel buy rates after the offer change: growing businesses of 6 to 10 people 67% (3 buyers), small businesses of 2 to 5 people 29% (7), solo contractors 25% (8). Owners who answer on a personal phone or voicemail buy at 40% (5). Two groups did not buy: renovation, roofing and landscaping (0 of 2) and anyone who runs a scheduling or CRM tool (0 of 3, it fails again after the offer change). Every group is a handful of buyers, so each rate is a hint.
- **What the five new buyers said they needed:** a lost job (two tie it to the quote follow-up), the free missed-call count, the 60-day refund, a founder who installs it for them. The recurring "$9,000 kitchen" story comes from the profile text the buyers were given, so it is not independent evidence of what contractors say.
- **What marketing has to answer** (counted, `offer.md` section 5): no live client to call (6), "the guarantee counts requests, not jobs" (7), no CRM link (5), the $2,000 setup itself (4 passes for price), data location (2).
- **The gap** (`competitors.md`): none of ten bilingual vendors shows a customer, a rating or a recorded Québec French call; only two install for you, at $797 a month; none states owner approval of every message.

## 2. Positioning

Three versions of `For <segment>, who <problem>, TradeCatch is the <category> that <gap>, unlike <alternative>`:

- **A, the night call.** For plumbing and HVAC owners in Laval and Montréal who lose the urgent call when they are under a sink or asleep, TradeCatch is the bilingual phone receptionist that answers in your company's name and rings you through on an urgent call, unlike self-serve AI tools that only take a message.
- **B, the quote that goes quiet.** For contractors who lose big jobs because a quote was never chased, TradeCatch is the receptionist that also follows up every unanswered quote on day 1, 3, 7 and 14, unlike answering services that stop at the call.
- **C, the install with the risk taken out.** For owner-operators who will not hand their phone line to a tool they have never heard, TradeCatch is the done-for-you receptionist that the founder sets up, tests with you and watches, with the setup fee back if it does not catch 10 calls in 60 days, unlike self-serve tools with no install and $797 installers with no guarantee.

**Recommendation: lead with C, hook with A.** C answers the objection that kept most buyers out (trust and the $2,000 before proof) and is the only version no competitor can claim today; A is the sharpest first line for a plumber or HVAC owner (the board's strongest version of the business). B belongs inside the demo, as the second reason to sign. **Blocked until confirmed by the founder:** A needs call transfer to be live on both plans (the code gates it, see `pricing.md`), and C needs the 60-day refund approved and its wording read by a lawyer.

## 3. Channels

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

## 4. The 30-day campaign

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

## 5. Budget and the most you can pay to win a client

- **Budget:** $0 paid until a client comes by referral; then at most the $300 four-week search test above (the founder's decision). The scarce resource is the founder's hours, not money: at 5 installs a month, 20 demos a month is the ceiling.
- **The most one client is worth winning for, with the sum:** setup fee net of the card fee, after the guarantee at a 20% claim rate, **$1,541.69** (`pricing.md`), plus 6 months of contribution at **$182.92** (`cfo.md`) = 1,541.69 + 6 x 182.92 = **$2,639.21**. Earning it back within 6 months is a rule of thumb, not a result.
- **The most one demo is worth:** at the panel's 30% buy rate (an upper bound) 2,639.21 x 0.30 = **$791.76**; at a pessimistic 10% close, 2,639.21 x 0.10 = **$263.92**. The panel's buyers say they would buy 1.0 times in the first month, so one buyer is one sale. Founder install hours are inside the founder's wage line in `cfo.md`, not here.
- **A referral costs** $50 to $75 a sale, far below any figure above.

## 6. The three numbers to watch each week

| Number | Change something when |
| --- | --- |
| Demos held a week (goal about 5) | Below 3 for two weeks in a row: change the list or the first message, not the offer |
| Demo to signed | Below 10% after 20 demos: the offer or the price is wrong; revisit `offer.md` and the setup-fee test in `pricing.md` |
| Missed calls counted per demo, median | Under 10 a month: this audience loses too few calls for the product to pay; move to higher-volume owners (6 to 10 people) |

## Rules kept

No fake reviews, follower counts, testimonials or before/afters. Panel answers are research and are never quoted as customers. Any paid partnership is disclosed, and claims follow the advertising rules of the market. Not legal advice.
