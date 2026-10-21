# TC-027 — employee escalation contacts

Owners and administrators choose primary and backup employees by name and role.
The dropdown saves the selected member ID; customers never need database IDs.
Only members of the current organization are listed or accepted. Removed contacts
must be replaced or cleared; primary and backup cannot be the same employee.
Read access to the contact directory requires permission to manage settings.

Options display an ownership-verified personal phone when available. Otherwise
they say “No verified phone.” Email remains available. A backup SMS uses the
selected employee's current verified phone, never the organization's shared
phone or a phone supplied in the settings request. Email is used instead when
enabled and no verified phone exists; SMS-only selections require verification.
Queued personal texts are canceled when the member or verified phone changes.

Apply `src/product/saas/notification-contacts.sql` (migration
`025_verified_notification_contacts`) before enabling verified numbers. It adds
nullable, paired verification fields to `tc_users`; existing users remain
unverified. The application can read older schemas during rollout.

These fields must only be populated after a trusted ownership-verification
workflow has succeeded. This change does not add an OTP provider, mark existing
business/employee numbers verified, or provide a manual “verified” checkbox.
There are currently no verified employee numbers in production. The founder
has not set up Twilio, so real carrier SMS delivery remains unverified.

Validation includes organization-scoped membership/phone mapping and durable
ID persistence against isolated CI PostgreSQL, selected-number routing and
revocation tests, and English/French browser tests covering dropdown selection,
reload, server rejection and load recovery. Browser fixtures use synthetic
contacts and never deliver messages.
