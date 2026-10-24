# TC-040 — deployed pricing consistency

Status: **verified resolved** on 2026-10-23 (America/Toronto).
No price correction is needed.

The live server-rendered main content was compared directly with `PLAN_PRICES`
and `formatPlanMoney` from `src/lib/plans.ts`, not with an old audit or a cached
search result. All six pages returned HTTP 200:

- EN: `/`, `/pricing`, `/one-pager`.
- FR: `/fr`, `/fr/tarifs`, `/fr/fiche-resume`.

| Plan                          | Setup (CAD) | Monthly (CAD) |
| ----------------------------- | ----------: | ------------: |
| Starter                       |      799.99 |        349.99 |
| Growth                        |    1,499.99 |        749.99 |
| Receptionist / Réceptionniste |    1,999.99 |        999.99 |

Every setup and monthly amount matched on every page: 36 amount comparisons,
including French decimal commas and non-breaking-space formatting. Existing
`tests/unit/plan-prices.test.ts` also passed all thirteen tests, covering localized
pricing tiers, homepage tiers, the overview, product-page copy, upgrade differences
and money formatting. The existing pricing browser suite checks rendered cards.

No runtime code, pricing source, billing configuration, database records or live
deployment was changed for TC-040. No migration or rollback is needed for this
verification-only record. Reopen if a later deployment diverges from the pricing
source; do not “fix” an audit by changing the agreed prices.
