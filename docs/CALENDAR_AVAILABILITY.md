# Calendar availability — TC-035

## Verified from code and automated tests

- In-app scheduling and simulations exist independently of external calendars.
- Google has OAuth, encrypted token storage/refresh, writable-calendar selection,
  free/busy reads and event create/update/delete, and since KAN-22 **two-way
  synchronization** (push notifications plus a polling safety net, retries with
  backoff, a visible status panel). See `docs/KAN-22-GOOGLE-CALENDAR-SYNC.md`.
  Tests run against a fake Google; this is **not evidence of successful live
  Google delivery**.
- Google is a separately approved technical pilot (Professional), not generally released
  or automatically included with a subscription. Outlook has no adapter and is
  planned, not available. The external marketing booking link is a separate CTA.

## Server-side enrollment

`GOOGLE_CALENDAR_PILOT_ORG_IDS` is an operator-controlled comma-separated list of
exact organization IDs. Empty means no live access. An enrolled business must
also be active, not a demo account, on a plan that includes appointment booking
(Professional; earlier Growth customers keep it), and have appointment booking
enabled.
Customers cannot enroll themselves through editable business features.

Connect, OAuth callback, calendar listing/selection and runtime Google access
(including background reconciliation) enforce enrollment. Disconnect remains
available to authorized users to remove old access. Removing enrollment pauses
Google-backed booking rather than silently confirming through a simulation.
Existing records and encrypted tokens are not deleted by this release gate.

## Deployment and rollback

KAN-22 adds the additive, idempotent migration `062_scheduling_google_sync`
(columns on the calendar connection/sync-state tables and two new tables); apply
the scheduling schema and take a backup first. It rewrites no appointment, and it
blanks the old clear-text notification channel token. `GOOGLE_CALENDAR_WEBHOOK_TOKEN`
is no longer used (each business has its own channel secret). Before rollout,
inventory any existing live Google businesses and agree their pilot enrollment;
unenrolled connections will no longer execute live Google operations. Set the
allowlist in the intended Worker environment, not in client/public variables.
Keep existing database and OAuth configuration in server-side secret storage.
Do not automatically enroll existing customers or use wildcard IDs.

For each approved pilot, verify sign-in, writable calendar selection, timezone,
busy-slot exclusion, create/reschedule/cancel and expired/revoked-token behavior
against a dedicated real test calendar before declaring it operational. No live
Google account was supplied for this task, so that acceptance remains pending.

Rollback: redeploy the prior application revision and restore the prior
environment configuration. This reverts enforcement; review the wider access
implications first. The KAN-22 migration is additive, so the previous revision
still runs on the migrated database (it ignores the new columns and tables); no
database rollback or record deletion is necessary.
