# Unit economics: TradeCatch (bilingual AI phone receptionist for Québec contractors), CAD, before sales tax

## The CFO's note (written 2026-11-15)

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

## One client-month

| line | per client-month |
| --- | ---: |
| Price | $299.00 |
| Voice minutes at full allowance (avg of Essential 500 and Professional 750 min x CA$0.1091) | -$68.17 |
| Text segments at full allowance (avg of Essential 1,000 and Professional 2,000 x CA$0.0229) | -$34.38 |
| Transfer leg, ESTIMATE: 10% of minutes (62.5) x CA$0.0133 | -$0.83 |
| Card fee + Stripe Billing 0.7% (avg of Essential 9.26 and Professional 12.86) | -$11.06 |
| Twilio phone number rental, US$1.15 x 1.4257 (one local number a client, ESTIMATE) | -$1.64 |
| **Contribution** (what each client-month leaves to pay the fixed costs) | **$182.92** (61%) |

## The margin that matters

Fixed costs: $2,330 a month (Founder living wage drawn from the business (PLACEHOLDER, founder to set) $4,000, LiveKit Ship plan US$50 (ESTIMATE of plan; US$0 on Build) $71, Other hosting and software: Cloudflare, database, domain, email, monitoring (ESTIMATE) $200, LESS setup-fee income: 1 new client a month x (1,999.99 - 58.30 card fee) -$1,942).

- **Break-even: 13 client-months a day.** Below that you lose money every month.
- **Profit margin at your plan** (12 a day): **-4%** of every sale, after every cost.

## Year 1, month by month

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

## What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | -4% | 13 | -$13,687 |
| Price -10% | -15% | 16 | -$16,020 |
| Volume -20% | -20% | 13 | -$16,541 |
| Unit costs +15% | -10% | 15 | -$15,046 |

## Red flags

- Year 1 loses money on operations (-$13,687).
- The startup spend is not earned back within year 1.
