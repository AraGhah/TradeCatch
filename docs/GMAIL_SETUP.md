# Gmail receiving — setup and operations

Each TradeCatch user can connect **their own** Gmail account. TradeCatch reads
incoming mail into the user's private inbox (`/app/mail`), the dashboard card,
and an in-app notification for customer emails. It can **read only**: it cannot
send, delete or modify anything in Gmail.

## What gets requested from Google

One scope: `https://www.googleapis.com/auth/gmail.readonly` — the minimum that
allows reading message bodies and downloading attachments.

Google classifies it as a *restricted* scope. While the OAuth consent screen is
in **Testing** you can add up to 100 test users and use it immediately. Before
opening Gmail connection to the public, the app must pass Google's OAuth
verification (and, for restricted scopes, the security assessment).

## One-time Google Cloud setup

1. Google Cloud console → create (or pick) a project.
2. **APIs & Services → Library → Gmail API → Enable.**
3. **OAuth consent screen**: user type External, app name, support email,
   authorised domain, and add the scope `.../auth/gmail.readonly`. Add test users
   while in Testing.
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Authorised redirect URI (exact match):
   `https://<your-site>/api/app/gmail/callback`
   (use `http://localhost:3000/api/app/gmail/callback` for local development).
5. Put the values in the environment (`.env.local`, or Worker secrets):

   ```
   GOOGLE_GMAIL_CLIENT_ID=...
   GOOGLE_GMAIL_CLIENT_SECRET=...
   AUTH_SECRET=...            # already required; also seals Gmail tokens
   NEXT_PUBLIC_SITE_URL=https://<your-site>
   ```

6. Apply the database tables: `npm run db:schema` (migration `019_gmail`; safe to
   re-run, and it upgrades an earlier version of the tables in place). Row-level
   security is enabled on both tables with no policies, so Supabase's public API
   cannot read them; the server's owner connection bypasses RLS.

Until step 5 is done, Settings shows "Gmail is not turned on for this
TradeCatch yet" and the dashboard card is hidden — nothing else is affected.

## How mail arrives (three layers)

| Layer | When | Notes |
| --- | --- | --- |
| Background poll | Every minute while TradeCatch is open in a visible tab | Throttled on the server to once per ~45 s per mailbox, however many tabs are open |
| Push (optional) | Within seconds of new mail | Gmail → Pub/Sub → `POST /api/webhooks/gmail` (verified Google OIDC) |
| Scheduled fallback | Every minute, even if nobody is signed in | `POST /api/gmail/sync/tick` (Cloudflare cron + `vercel.json`) |

All three run the same incremental sync (Gmail `history.list`), so a missed or
duplicated trigger cannot lose or duplicate mail. A per-mailbox lease keeps two
syncs from running at once.

### Enabling push (optional)

1. Create a Pub/Sub topic, e.g. `projects/<project>/topics/gmail`.
2. Grant `gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher**
   role on that topic.
3. Create a dedicated push service account. Grant the Pub/Sub service agent
   `service-<project-number>@gcp-sa-pubsub.iam.gserviceaccount.com` the
   `roles/iam.serviceAccountTokenCreator` role for it. Restrict topic publishers
   and who may impersonate this identity.
4. Create an authenticated push subscription targeting
   `https://<your-site>/api/webhooks/gmail` with **no query string**. Select the
   dedicated service account and use that exact URL as its OIDC audience.
5. Set `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUSH_AUDIENCE`, and
   `GMAIL_PUSH_SERVICE_ACCOUNT` (the exact service account email).
   TradeCatch verifies Google's RS256 signature, issuer, audience, email identity,
   email_verified and timestamps before reading any payload or mailbox.
6. Sync a connected test mailbox to register `users.watch` (renewed daily).
   Confirm Settings shows push active; send a controlled email with the dashboard
   closed and verify arrival and the owner's opted-in alerts.

Migration: update existing subscriptions to the clean URL and OIDC authentication
before deploying. Query-token URLs are rejected even with a valid bearer token.
Remove/rotate the retired GMAIL_WEBHOOK_TOKEN. Existing platform access logs may
still contain old URLs: restrict access and purge them under the retention policy.
Application logs do not record callback URLs, headers, JWTs or provider messages.

Without all three push settings, push stays off and polling remains available.
See [Google authenticated push setup](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)
and [Gmail watch setup](https://developers.google.com/workspace/gmail/api/guides/push).

## Security properties

- **Per-user isolation.** Every query is scoped by organization *and* user; another
  user's message id is a 404 on pages, the JSON API, attachments and read-state.
- **Tokens never reach the browser.** They are AES-256-GCM sealed in
  `tc_gmail_accounts.token_ciphertext`; APIs return only status, address and counts.
  Changing `AUTH_SECRET` makes stored tokens unreadable → users see "Reconnect Gmail".
- **OAuth state** is signed, expires in 10 minutes, and is bound to one user and
  organization; a code/state cannot attach a mailbox to someone else.
- **Disconnect** stops the Gmail watch, **revokes the grant at Google**, and deletes
  TradeCatch's copy of the mail.
- **Read status** is kept inside TradeCatch (the permission is read-only). Reading
  mail in Gmail marks it read here on the next sync; reading it here does not change Gmail.

## What users see when something goes wrong

| Situation | Behaviour |
| --- | --- |
| Access revoked / expired / permission unticked | Status "Needs reconnecting", clear message and a **Reconnect Gmail** button; existing mail kept; no further calls to Google |
| Gmail rate limit | Backs off (honours `Retry-After`, minimum 5 min), retries automatically |
| Google/network error | Retries with growing delay (1, 2, 4 … max 30 min); Refresh still works |
| Gmail API disabled / bad client credentials | "Not set up correctly on the server" (no reconnect asked); retried hourly |
| History older than ~1 week | Silently re-imports the latest inbox without duplicates |

## Operating notes

- The scheduled fallback checks `GMAIL_CRON_BATCH` mailboxes per run (default 2),
  oldest first, to stay inside a Worker invocation's subrequest budget.
- One mailbox per user. Reconnecting with a *different* Google account starts clean;
  the same account resumes where it left off.
- Only the 25 most recent inbox messages are imported on first connect, and no
  notifications are raised for them.

## Important replies and synchronization monitoring

Settings → Notifications → Customer replies lets each mailbox owner opt in to
email and/or SMS. Defaults remain off. Only new, unread, non-automated customer
messages trigger alerts. External alerts omit sender, subject and body, including
on shared business phones; mailbox details and in-app notices remain owner-only.
Failed deliveries stay in the durable notification queue.

The fallback runs every minute, considers mailboxes stale after five minutes,
and starts at most GMAIL_CRON_BATCH mailboxes (default 2, allowed 1–25). It stops
starting mailboxes after 20 seconds; an in-progress sync finishes normally.
The authenticated tick returns capacityLimited, delayedInBatch and
oldestSuccessfulSyncAgeSeconds for the selected batch, not the entire fleet.
Privacy-safe aggregate warnings are emitted on saturation, failure or a delay
above 15 minutes. Configure operations alerts on `[gmail] sync health` warnings.
Settings warns the mailbox owner after 15 minutes without a successful sync.
Increase batch size only after measuring execution and subrequest usage; move to
per-mailbox queue consumers before exceeding the Worker's execution budget.
