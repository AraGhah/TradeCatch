# Referral program

A customer shares a personal link. When a contractor who arrived through it
pays their installation fee, the referrer earns an **Interac e-Transfer sized
to the plan the referred customer bought** (not the referrer's own plan).

| Plan purchased by the referred customer | Default Interac (CAD) |
|---|---|
| Starter | $50 |
| Growth | $75 |
| Receptionist Plus | $125 |

Defaults live in `DEFAULT_REFERRAL_REWARDS_CENTS`
(`src/product/saas/plan-catalog.ts`). An administrator changes the live values,
the eligible plans, the hold period and the fulfillment method on
**/admin/referrals** — no deploy needed. The public page and the customer
dashboard read the live values.

## What is where

| Piece | Location |
|---|---|
| Rules (who qualifies, how much, once) | `src/product/referrals/service.ts` |
| Types, settings, fraud signals | `model.ts`, `code.ts` |
| Storage (memory / PostgreSQL) | `store.ts`, `postgres-store.ts`, `schema.sql` (migration `033_referral_program`) |
| Stripe + SaaS wiring | `directory.ts`, `billing-hooks.ts`, `runtime.ts` |
| Public landing page | `/referral` (`/fr/parrainage`) |
| Customer dashboard | `/app/referrals` (owners and administrators only) |
| Admin review | `/admin/referrals`, API `/api/admin/referrals` |

Apply the schema with `node scripts/apply-missed-call-schema.js`. It is
additive: no existing table is altered. Until the schema is applied, the public
page still renders with the published default amounts (in-memory fallback).

## Lifecycle

1. **Link.** An eligible customer (program on, organization active, installation
   paid) gets one random 10-character code. Their link is
   `/referral?ref=CODE` (`/fr/parrainage?ref=CODE`).
2. **Attribution.** Opening the link stores the code in the visitor's browser
   for 60 days (`localStorage`, disclosed on the page). The audit form sends it
   as `referralCode`; it is saved on the lead and shown in the notification
   email. When the founder provisions the business
   (`POST /api/missed-call/ops/provision-organization`) they pass the same
   `referralCode`; provisioning links the referral. If it was forgotten, use
   **Link a business to a referral code** on the admin page.
3. **Qualification.** `checkout.session.completed` for the installation fee
   (already handled by `synchronizeInstallationCheckout`) calls the referral
   hook *after* billing has committed. The reward amount is chosen from the plan
   on that payment. A replay of the same payment returns the same reward.
4. **Hold.** The reward is **pending** for `holdDays` (default 30).
5. **Approval** (administrator, MFA session). Re-checks at that moment: the
   hold has passed; the payment was live-mode; the referred customer is still
   active; the referrer is still active (setting); **Stripe still shows the
   payment as paid and not refunded or disputed**; review flags acknowledged.
6. **Issue.** Needs a fulfillment method other than `none` and an Interac
   confirmation reference. **Nothing is sent automatically** — see below.

## Rules that are enforced

* Reward only after a successful qualifying payment; none at sign-up.
* **One reward per referred business** — unique per referral, per referred
  business and per Checkout Session, in the database.
* Self-referral, same owner (Gmail dots and `+tags` normalised), same phone,
  same Stripe customer: rejected. Same company-email domain or lookalike
  business name: flagged, and an administrator must acknowledge before approval.
* Refunded, disputed or cancelled before the Interac is issued: reward rejected.
  Partially refunded or suspended: flagged. After issue: a refund or dispute
  flags the reward for a person (`clawback_review`); a plain later cancellation
  does nothing.
* Stripe **test-mode** payments create rewards that can never be approved.
* One Interac confirmation reference can be recorded once (case-insensitive).
* Issued rewards cannot be deleted; the event trail is append-only.
* The referrer sees the referred business's name and status only — never fraud
  flags, notes or payment details.

## Interac fulfillment

There is deliberately **no automatic Interac delivery**. The only supported
method is `manual`: an administrator approves a reward, sends the Interac
e-Transfer through their own banking channel, then records its confirmation
reference. The default method is `none`, which blocks "mark issued" until
someone chooses to enable `manual`.

## Stripe setup (required once)

Add these events to the existing webhook endpoint
(`/api/webhooks/stripe`, live **and** test):

* `charge.refunded`
* `charge.dispute.created`

Without them the program still works: approval re-verifies the payment with
Stripe, so a missed refund is caught before any reward is approved. The events
just reject the reward sooner.

The referral hooks are best effort and never throw: a referral failure cannot
fail, delay or roll back a payment or subscription. If a hook was lost,
**Re-check payments** on the admin page re-qualifies from the billing records.

## Known limits

* Attribution depends on the founder passing (or linking) the code; there is no
  self-serve sign-up to attach it to automatically.
* Interac delivery is manual.
* The 60-day browser storage and the program terms shown on `/referral` should
  be reviewed by whoever owns legal copy before launch.
