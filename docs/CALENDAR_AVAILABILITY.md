# Calendar availability — TC-035

## Verified from code and automated tests

- In-app scheduling and simulations exist independently of external calendars.
- Google has OAuth, encrypted token storage/refresh, writable-calendar selection,
  free/busy reads and event create/update/delete. Tests verify provider contracts
  with mocks; this is **not evidence of successful live Google delivery**.
- Google is a separately approved Growth technical pilot, not generally released
  or automatically included with a subscription. Outlook has no adapter and is
  planned, not available. The external marketing booking link is a separate CTA.

## Server-side enrollment

`GOOGLE_CALENDAR_PILOT_ORG_IDS` is an operator-controlled comma-separated list of
exact organization IDs. Empty means no live access. An enrolled business must
also be active, account type `pilot`, Growth, and have appointment booking enabled.
Customers cannot enroll themselves through editable business features.

Connect, OAuth callback, calendar listing/selection and runtime Google access
(including background reconciliation) enforce enrollment. Disconnect remains
available to authorized users to remove old access. Removing enrollment pauses
Google-backed booking rather than silently confirming through a simulation.
Existing records and encrypted tokens are not deleted by this release gate.

## Deployment and rollback

No schema migration or production-data change is required. Before rollout,
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
implications first. No database rollback or record deletion is necessary.
