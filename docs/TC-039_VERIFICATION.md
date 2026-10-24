# TC-039 — Receptionist naming

Checked 2026-10-23 (America/Toronto).

The established customer-facing product/plan names are **Receptionist** (EN)
and **Réceptionniste** (FR). Public navigation, homepage tiers, pricing tiers,
comparison headings, the product page and dashboard headings already agree.
The account setup checklist and platform-admin navigation still used
“AI receptionist” / “Réceptionniste IA”; these two labels are now aligned in
both languages. Generic descriptions, internal identifiers, database fields,
route names and legacy redirect URLs are not renamed.

Regression tests compare eleven public/dashboard label locations per language
and recursively check all localized message values for the obsolete product
name variants. Both localization catalogs were inspected; technical identifiers
containing `aiReceptionist` remain intentionally stable.

## Live verification limits

A read-only audit of the 36 public routes in `tests/route-matrix.spec.ts` found
HTTP 200 responses and no obsolete name in server-rendered main content. Both
Help Center indexes also returned 200 without the obsolete name. The 22 localized
article URLs returned HTTP 503, “Worker exceeded resource limits”, so their live
content could not be verified. Do not count these error pages as passing naming
checks. No repeated retries, production writes, or security-gate bypasses were
used to obtain article content.

Authenticated production dashboards were not accessible in this session. Their
labels are covered through source/catalog regression tests, not a claimed live
admin login. The label correction requires deployment, followed by authenticated
EN/FR account-checklist and admin-navigation checks. Recheck the unavailable
articles once the deployment/resource-limit issue is resolved before closing the
full live-audit portion of TC-039.

No migration, permission change or customer-data modification is required.
Rollback: revert this task's commit and redeploy; no database rollback is needed.
