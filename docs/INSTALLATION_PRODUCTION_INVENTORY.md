# Production installation approval: reviewed inventory and preflight

## Owner-authorized scope

This record incorporates the owner's confirmation after the database credential
repair on 2026-10-24 UTC. It documents approval intent, **not database grants or
an active enforcement rollout**.

- One existing production installation, with exactly two authorized origins:
  `https://tradecatch.ca` and
  `https://tradecatch.ara-ghahramanyan07.workers.dev`.
- No specific preview URLs have been identified as requiring authorization.
  The preview wildcard is not approved, and future preview domains require an
  explicit administrator decision.
- Staging is not deployed. Do not create a staging installation or grant.
- Local development at `http://localhost:3000` keeps enforcement off, without
  production approval, installation credentials, or an automatic loopback
  exception at the production ingress.
- Approval persists for the installation/exact origin across deployments and
  updates; release identifiers are not installation identifiers.

## Read-only integration audit — 2026-10-24 UTC

The following checks were made without changing provider configuration, customer
records, callbacks, notification queues, or domain permissions. Secret values,
customer identifiers, mailbox content and tokens are excluded from this record.

| Surface                                              | Evidence                                                                                                                           | Preview dependency found?                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Active Cloudflare Worker                             | Custom domain `tradecatch.ca`; production workers.dev alias enabled; self-reference targets the production `tradecatch` service    | No                                           |
| Active server configuration                          | Canonical site URL is `https://tradecatch.ca`; no configured alternate Twilio webhook base or Google OAuth redirect override       | No                                           |
| Live Stripe endpoint inventory                       | Authenticated list completed with no further pages; one enabled live endpoint at `https://tradecatch.ca/api/webhooks/stripe`       | No                                           |
| Organization CRM callbacks                           | No saved non-null CRM webhook URLs                                                                                                 | No                                           |
| Missed-call client configuration                     | One saved configuration inspected; no URLs                                                                                         | No                                           |
| Receptionist profiles / SMS automation configuration | No saved profiles or automation configurations                                                                                     | No                                           |
| Gmail and Google Calendar connections                | No account/connection rows; OAuth credentials, Gmail Pub/Sub topic and push audience are absent in the active Worker configuration | No active connected integration found        |
| Twilio in active Worker configuration                | Account SID and auth token absent; owner confirms Twilio has not been configured                                                   | No configured dependency reported            |
| External booking link                                | Points to `cal.com`                                                                                                                | Account-side webhooks/redirects not verified |

No preview references were found in the inspected surfaces. **This is not a
claim that every external provider configuration has been verified.** The active
Worker's lack of credentials does not prove that an older preview has no callback
configured in a provider account. No broad preview approval is justified by these
results.

## Activation decision: HOLD, enforcement OFF

Before enabling enforcement, resolve these remaining prerequisites:

1. The owner confirms Twilio has not been configured. Obtain a provider-console
   review or account-owner confirmation that any Google OAuth redirect/Pub/Sub push endpoints
   and Cal.com webhooks/redirects do not depend on an unidentified TradeCatch
   preview. Inaccessible provider configuration is **unverified**, not a pass.
   If a preview dependency exists, obtain a specific migration/approval decision;
   do not silently rewrite callbacks or approve a wildcard.
2. Obtain and restore-verify a backup of the intended production database.
   `pg_dump`/`pg_restore` are not installed locally. Docker Desktop was started
   using its CLI and hidden executable, but its engine commands timed out. The
   backend log confirms startup crashed while initializing its Inference manager
   (`dockerInference` socket/file unavailable). No reset, reinstall, Docker
   settings change or volume removal was attempted. There is no verified backup
   from this attempt. Do not migrate before confirming a backup and restore test.
3. Review pending migrations. The production ledger lacks
   `026_notification_localized_content`, `027_native_sales_crm`, and
   `028_installation_approval`. Do not run the
   full schema runner simply to install the approval registry without reviewing
   those unrelated changes. No migration was executed during this audit.
4. Reconcile local uncommitted Cloudflare configuration with deployed settings
   before a clean, CI-approved application release. Preserve the repaired
   encrypted `DATABASE_URL` and all existing runtime bindings. Do not deploy the
   unrelated local configuration changes implicitly.
5. After these checks pass, migrate the private registry, register one stable
   production installation, and explicitly approve its two exact origins with
   the administrator identity/reason recorded. Securely store its scoped
   credential on the production Worker; keep it out of local-development files.
6. Validate with enforcement off, canary the enabled policy, and verify both
   origins, authentication, booking, billing callbacks and cron before declaring
   enforcement active. Unknown domains must be denied; localhost must continue
   to work locally with enforcement off. Retain an operator-controlled rollback
   to `INSTALLATION_ENFORCEMENT=off`, preserving the registry and audit history.

No installations or domain grants were created, no production secrets changed,
and no application deployment or enforcement activation was performed in this
preflight. Existing production domains and preview settings remain unchanged.

See [the rollout and rollback procedure](INSTALLATION_APPROVAL.md) and
[backup and recovery](BACKUP_AND_RECOVERY.md).
