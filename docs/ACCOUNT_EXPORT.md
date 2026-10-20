# Account data archive (Problem 7)

Owners and organization admins can use **Settings → Account management → Export data** to download a ZIP. The existing verified platform-admin exception is preserved. Other members, viewers, unauthenticated users and unrelated organizations cannot export the account.

The endpoint is `GET /api/businesses/[id]/account/export`. It returns `application/zip` with attachment headers and private/no-store caching. Each business/user has a budget of three export requests per hour; excess requests return HTTP 429 and Retry-After. Successful archives write an `account_exported` security event with actor, target, completeness, source counts and byte count. Archive-generation failures write `account_export_failed`. Auditing uses the existing best-effort `recordSecurityEvent` helper.

## Contents

Every data section has a CSV and a JSON file. `manifest.json` names the exact fields, file names, row counts and status for every section. `README.txt` explains the format, exclusions and any incomplete sections.

Included: business profile; CRM customers (including customers without leads); unified, website and missed-call leads; current scheduling and older Growth appointments; receptionist and missed-call metadata; retained caller/agent transcripts; CRM customer conversations/messages; missed-call customer recovery messages; quote threads/messages; customer-visible support tickets/replies; account requests. Legacy and current records stay separate and can overlap.

Excluded: call audio and recording/media URLs or attachments; connected-mailbox content and attachments, which belong to the connecting member; passwords, sessions, API keys, OAuth tokens and integration credentials; Stripe payment/billing records; internal support notes/assignments and attachments; system prompts, technician recovery traffic, internal diagnostics and platform/security logs. Other settings, automation configuration, analytics, revenue ledgers and provider-side records are outside this archive. Deleted or retention-purged records are not recovered. No provider API is called during export.

## Limits and incomplete sources

This is a bounded, sequential read, not a database backup or a transactionally consistent snapshot. Records can change while it runs. The archive never represents a failed source as successfully empty.

Default limits: 1,000 rows per section, 50 parent records per related-message/transcript section, 1 MiB of combined CSV/JSON per section, 8 MiB of data, five seconds per source read and 25 seconds for the overall read phase. Database queries use lookahead bounds; CRM leads are paged past the store's 200-row page ceiling. Sources at a row, parent, byte or time limit are explicitly marked partial/failed. Related-record failures identify the affected parent, while successful parents' rows remain available. A missing linked phone client is marked not_applicable and is never used as an unscoped query.

A partial archive remains downloadable with `X-Export-Status: partial`; the button tells the user to review the README/manifest. A fatal archive error produces JSON HTTP 503 and a localized error message instead of a download. The button also handles network failures and unexpected response types.

CSV uses UTF-8 with BOM, CRLF, and doubled quotes inside quoted cells. Formula-like text, including whitespace/control/full-width variants, is prefixed with an apostrophe. Only strictly validated E.164 values in phone columns retain their leading plus unchanged; import phone columns as Text to avoid spreadsheet numeric conversion. JSON preserves the exact selected values and is the preferred format for machine import. Spreadsheet sanitization is not guaranteed to survive a spreadsheet application's subsequent save/reopen cycle. See [OWASP's CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection).

The dependency-free ZIP32 writer uses uncompressed STORE entries, UTF-8 flags, CRC-32 and a central directory. It rejects unsafe/duplicate entry names and archives above 20 MiB. Format reference: [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).

## Verification

- Unit tests cover ZIP structure/CRC/Unicode/limits, CSV formula injection and phone preservation, source failures, row/byte/time caps, and related-record failures.
- Synthetic fixtures test tenant isolation, customers without leads, legacy records, internal-note/system-prompt/recording exclusion, CRM pagination and read limits against memory and isolated PostgreSQL stores.
- Full unit suite: 649 passed; one existing integration test skipped.
- Focused browser test passed: actual file download and readable archive, cross-tenant denial, and a localized error after a failed response.
- Final PostgreSQL staging verification: 17 checks passed. The staging database is isolated locally; the configured remote staging Worker is not provisioned.
- Windows' native libarchive reader independently read both a Unicode sample and the actual 38-file production button download.
- Verified on https://tradecatch.ca on 2026-10-20, Worker version 5f2f7f5a-e31c-4a99-a0e7-ca9c4e0a6820 at 100% traffic. Previous stable version: b9a18a06-161d-433a-89d7-53e558c1a7b5.
- Production test: anonymous requests returned 401; unrelated businesses, members and viewers returned 403; organization admins and owners downloaded complete archives. Repeated requests remained complete, three success audit events were stored, and further requests returned 429 with Retry-After. The real button downloaded a ZIP and displayed its error on rate limiting. Excluded sentinel data was absent.
- All labelled TC007 organizations, users, sessions, phone-client fixtures, support records, call records and test rate/audit rows were removed. No provider messages or calls were sent. Existing secret bindings and durable storage flags were preserved.

No new archive tables or packages are required. This deployment provisioned the already-defined shared rate-limit table/index from src/product/security/schema.sql because production lacked them. RLS is enabled and public client-role access is revoked. The existing db:schema command already creates this shared storage on fresh databases. Existing read callers retain their previous unlimited behavior when an optional limit is omitted. CRM, Starter and receptionist stores now use the existing Cloudflare-safe PostgreSQL pool helper, so repeated export requests do not reuse a socket owned by an earlier Worker request. Read-only call-store getters avoid initializing call-processing engines or seeding client configuration during export.
