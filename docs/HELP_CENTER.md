# Help Center content and screenshots

All eleven public and authenticated Help Center articles share the same English
and French numbered instructions, expected results and troubleshooting. Search
indexes the full guidance in both languages. Instructions describe the current
workspace and distinguish configuration, simulation and verified live delivery.

Content lives in `src/product/support/help-guides.ts`; article identifiers and
introductions remain in `help.ts`. React renders plain text (no HTML injection).
Screenshots are local static PNGs in `public/help`, with localized descriptions
that disclose example data and disconnected states. No third-party image host,
credentials, payment details or customer records are needed.

## Updating screenshots

Build the application, then use the isolated Playwright harness. In PowerShell:

```powershell
$env:UPDATE_HELP_SCREENSHOTS = "1"
npx playwright test tests/help-center.spec.ts --grep "capture help screenshots" --config playwright.local.config.ts --workers=2
Remove-Item Env:UPDATE_HELP_SCREENSHOTS
```

This creates synthetic organizations through the localhost-only test provisioner.
It never connects a live phone, Google account or payment portal. Do not run the
capture against production. Review all screenshots visually in both languages:
check the relevant controls are legible, examples are accurately captioned, and
no private data or credentials appear. Commit only reviewed PNGs, not test traces.
Then run the help unit tests and Help Center browser tests without the opt-in.

## Deployment and rollback

No migration, production-data modification or new environment variable is
required. Deploy the normal application/static assets together. Roll back the
TC-034 commit and redeploy to restore the prior article presentation.
