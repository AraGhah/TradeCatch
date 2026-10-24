# TC-041 — removed cancellation-policy link

Status: **verified resolved** on 2026-10-23 (America/Toronto).

The read-only live audit inspected footer anchor destinations on all 36 public
routes in `tests/route-matrix.spec.ts`, plus both Help Center indexes. The 34
route-matrix pages with a footer and both Help Center indexes contained no link
to either removed cancellation-policy URL. The two login pages have no footer.
Each inspected footer instead linked to the locale-appropriate Terms page:

- `/terms-of-service` — live HTTP 200.
- `/fr/conditions-utilisation` — live HTTP 200.

Both `/cancellation-refund-policy` and
`/fr/politique-annulation-remboursement` still return HTTP 404, matching the
intentional removal and existing route regression tests. No new redirect is
necessary to resolve the reported broken-footer-link issue. This task does not
rewrite legal content or imply that the old policy remains in effect.

A new bilingual browser regression checks the footer's link absence, the correct
Terms destination, and that destination's successful response. Existing route
tests continue asserting 404 for the retired pages. Individual live Help Center
articles returned Cloudflare resource-limit errors and were not counted as
successfully inspected footers; see TC-039's verification limits.

No runtime URL behavior, database record or live configuration was changed. No
migration is needed; removing the added tests/report has no runtime effect.
