# Native TradeCatch sales CRM

Booking-audit submissions belong to TradeCatch's own sales pipeline. They are not
contractor customer leads. Native synchronization requires only the existing
server-side `DATABASE_URL` and durable-store configuration; it requires no external
automation, webhook URL, webhook secret, special organization, or new provider.

## Data and access model

- `mc_book_audit_leads` remains the durable source of contact, qualification, and
  consent evidence. Its existing identifiers and idempotency keys are unchanged.
- New `tc_platform_sales_leads` is a platform sales projection: one primary/foreign
  key `lead_id` per booking, source, sales stage, and synchronization timestamp. It
  has no contractor `organization_id` and cannot be captured through the tenant
  CRM service. It stores no duplicated contact data.
- A single PostgreSQL statement commits the booking, native sales record, and
  email outbox together. Any insert failure rolls back the whole statement, and
  the public API returns 503. Retrying the same request key is safe, including
  concurrent retries. Duplicate requests preserve the original contact details.
- `/admin/sales` (also `/fr/admin/sales`) shows retained bookings in pages of 50.
  `/api/admin/sales-leads` uses the existing admin guard: platform identity, MFA
  and matching admin-session token, or the existing protected ops credential.
  Ordinary contractor users cannot access this feed. The endpoint accepts no
  organization selector and sends private, non-cacheable responses.
- PostgreSQL RLS denies public/anonymous access to the new table. Production uses
  the existing trusted server-side connection. Client components import only the
  response schema/types, never database code or credentials.
- Reads join the original booking evidence and exclude `purged_pending` and
  `purged` records. Existing privacy retention therefore removes contact data
  without leaving a second CRM copy. Deleting a source record cascades only its
  projection; this migration does not delete source records.

## Native versus optional external delivery

The response field `nativeCrmSynced` reports native synchronization.
`crmForwarded` continues to mean actual **external** forwarding; a native sync or
cancelled external job never sets it to true. `externalCrmConfigured` states
whether optional global forwarding is enabled. `notificationsDelivered` checks
both email jobs and any active optional external job; disabled/cancelled external
work does not keep successful emails pending forever.

When `LEADS_WEBHOOK_URL` is absent or blank, new captures create only the two email
jobs. The historical email migration also no longer fabricates CRM jobs. Email
templates, stable provider keys, leasing, backoff, and failure escalation remain.

On the existing scheduled booking notification tick, bounded reconciliation:

1. Adds missing native projections for retained bookings, including records saved
   by the previous application version during rollout. Failures leave the source
   intact and retry on the next scheduled invocation.
2. Marks undelivered, unleased external CRM jobs with `cancelled_at` and
   `cancel_reason = external_crm_not_configured` when no webhook exists. It keeps
   their attempts, last errors, original lead information and delivered history.
   It never marks them delivered or updates `crm_forwarded`.
3. Skips a live lease until it expires, and excludes unconfigured external jobs
   from claims immediately, even if reconciliation still has more rows to visit.

Configuring the optional global webhook is an explicit opt-in to forwarding
TradeCatch sales leads. It resumes jobs cancelled for that configuration reason,
retaining their retry budgets/backoff and idempotency keys. Successful external
jobs are never replayed by this reconciliation. Historical retained leads with
no external job are not automatically exported in bulk. The administrator must
review the destination and historical pending jobs before enabling forwarding.

Contractor-specific integrations remain under their existing organization CRM
settings and retry queue (`crmWebhookUrl`, `tc_crm_dlq`, Growth services). These
are unchanged and never receive TradeCatch sales bookings.

## Migration 027 and rollout

No production migration, data reconciliation or deployment is performed merely by
committing this change. Apply the following plan through the release process.

1. Take and verify a normal PostgreSQL backup. Review the booking lead count,
   retention state and pending external CRM history. Confirm the server database
   role has the normal schema migration privileges; do not grant access to
   browser-facing PostgreSQL roles.
2. With the existing server database connection available securely, run
   `npm run db:migrate-native-sales-crm`. Do not put credentials in shell arguments
   or copy them to a public environment variable. This targeted command runs
   `src/product/sales-crm/schema.sql` in a transaction with a migration lock,
   a five-second lock timeout and a sixty-second statement timeout. It records
   `027_native_sales_crm` only on success and is safe to rerun. Failure rolls back
   all changes. Use the targeted command for existing production deployments;
   `db:schema` is also updated for complete installations, but replays other
   historical migrations and should not replace the targeted production step.
3. The additive SQL creates the platform projection and source-order index,
   adds nullable cancellation metadata to the existing outbox, and backfills
   retained bookings idempotently. It does not drop/replace existing tables,
   overwrite contact information, change delivery flags or cancel jobs at
   migration time. Large installations should rehearse the backfill on a restored
   backup and schedule a maintenance window if it exceeds these timeouts.
4. Deploy the checked Cloudflare build using the existing release process. Finish
   draining previous Worker invocations before treating queue reconciliation as
   complete: older code does not understand cancellation metadata. Native code
   uses the existing request-scoped PostgreSQL pool and scheduled booking tick;
   no new Worker bindings or database credentials are required.
5. Check authenticated readiness: `checks.nativeSalesCrm` must be true. A missing
   native migration degrades readiness even if PostgreSQL is reachable.
   `checks.externalCrmWebhook` reports `{configured, required: false}` separately;
   an absent optional webhook does not degrade native readiness. Public health
   remains a cheap liveness check without sales data or credential details.
6. Verify a consented, clearly identified test booking: one source lead, one
   matching native sales row, two email jobs and no external job when disabled.
   Confirm it in the MFA-protected admin sales view, repeat the same request key,
   and confirm no duplicate. Observe scheduled catch-up and normal email recovery.
   Do not generate unsolicited customer emails to test provider delivery.

Useful read-only checks for an authorized database operator:

```sql
SELECT id, applied_at FROM mc_schema_migrations WHERE id='027_native_sales_crm';
SELECT count(*) AS native_sales FROM tc_platform_sales_leads;
SELECT count(*) AS missing_native
FROM mc_book_audit_leads l
WHERE COALESCE(l.payload->>'retention_state','') NOT IN ('purged_pending','purged')
  AND NOT EXISTS (SELECT 1 FROM tc_platform_sales_leads s WHERE s.lead_id=l.id);
SELECT channel, count(*) AS jobs,
  count(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
  count(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled
FROM mc_book_audit_notifications GROUP BY channel;
```

## Rollback

Prefer a forward application fix while retaining the additive schema and original
booking evidence. A failed targeted migration rolls back automatically; diagnose
and rerun it. The new read model contains no unique contact information to recover.

If an application rollback is required, pause booking intake and its scheduled
notification route, drain in-flight requests, and revert the application release.
Retain the new table, index, cancellation fields and migration marker. Older code
ignores the extra schema, but it also ignores cancellation metadata and would
again enqueue/retry absent external webhooks. Keep that route paused until a
compatible fix is deployed, or deliberately restore a previously verified external
integration after reviewing the pending jobs. Email jobs remain durably stored.

Do not drop production tables, delete bookings or delivery jobs, clear attempts,
reset delivered flags, or bulk-uncancel jobs as a rollback shortcut. Any eventual
schema removal requires a separately reviewed migration after backup and explicit
approval; it is not part of this release.

## Automated coverage

The booking PostgreSQL integration suite covers atomic capture, native insert
failure and same-key retry, concurrent idempotency, protected platform API reads,
tenant isolation, RLS, optional webhook cancellation/re-enabling, live leases,
preserved successful delivery history, idempotent migration/backfill, catch-up
failure/retry and retention. Existing email retry/failure tests remain active.
Health tests cover independent native/optional readiness. Browser tests exercise
real MFA/admin-token gates, safe bilingual rendering, pagination, retry and
accessibility, and reject unauthenticated and contractor access to the sales feed/dashboard. Tests use only
the existing isolated loopback test database, never production credentials.
