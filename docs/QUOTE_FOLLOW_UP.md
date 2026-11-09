# Quote follow-up and owner approval

Quote follow-up texts customers who have not answered an estimate. Nothing is sent
until the business owner approves the wording.

## Schedule

`DEFAULT_QUOTE_STEPS_MS` in `src/product/starter/types.ts`: one text each at
**Day 1, Day 3, Day 7 and Day 14** after the quote was sent. Every step has an
English and a French template (`quoteFollowUpBody`); the customer's locale picks
which. A reply from the customer, or an opt-out, stops the sequence.

## Approval rules

- Approval is stored per business in `tc_org_settings.quote_followup_approved_at`
  (migration `schema-crm.sql`). `NULL` means not approved.
- It **fails closed**: no stored approval, an unreadable setting or a missing
  settings store all mean nothing is sent. Held threads stay due and are counted
  in `awaitingApproval`.
- Approval is **per business**. One business approving never releases another's
  threads.
- The owner approves or withdraws on the Quotes page (`/app/quotes`). Withdrawing
  writes `NULL`; the next scheduler tick sends nothing for that business.
- Threads held while a business was unapproved resume from the step they were
  waiting on as soon as it approves. A held backlog from other businesses cannot
  starve an approved business: each tick looks past held threads (up to a fixed
  window) and sends at most 50 messages.

## Policy: wording updates do not invalidate an approval

The approval is a single timestamp, not tied to a wording version. If TradeCatch
later edits the templates, existing approvals stay valid; so do unrelated
settings edits. The owner sees the live wording on the Quotes page and can
withdraw at any time. If a future change must force re-approval (for example a new
legal requirement), add a wording version to the setting and compare it in
`processDueQuotes`; do not clear `quote_followup_approved_at` in a migration,
because the migration runner re-applies every file on each run.

## Verification

- `tests/unit/quote-wording-approval.test.ts` — rules against the in-memory store,
  including held threads never hiding an approved business's due follow-up and the
  50-per-tick cap.
- `tests/unit/quote-approval-postgres.test.ts` — the same round trip against real
  PostgreSQL: held until approved, per business, Day 3 scheduling after the first
  send, unrelated edits keep approval, withdrawal clears the column and stops the
  next send, re-approval finishes Day 7 and Day 14 and stops the thread. Runs only
  when `QUOTE_APPROVAL_TEST_DATABASE_URL` points at a disposable database named
  `*_staging` that has had `npm run db:schema` applied.

Real text delivery is not covered by these tests: they use an in-memory SMS port,
so no customer is ever contacted. Delivery through Twilio needs a staging number
and the owner's authorization.
