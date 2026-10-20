# Problem 9 — Quality checks and release gate

The October 19 audit numbers were historical. On October 20, fresh checks of
main revision 953a2e7 found **10 lint errors, 13 warnings, and 116 files failing
the existing formatting check**. The latest GitHub CI run failed at formatting.

Changes:
- Apply Prettier to every file covered by the existing CI formatting command.
- Fix React callback dependencies, fetch completion state updates, appointment
  clock updates, browser navigation/audio operations, and unused code.
  No lint rule is disabled. Lint now rejects warnings as well as errors.
- Exclude ignored local artifacts and generated browser reports from ESLint;
  application code and tracked tests remain checked.
- Regenerate Worker binding/runtime declarations with the lockfile's Wrangler.
- Run CI on development branch pushes and allow manual runs, so a revision can
  pass before being merged. Both quality and e2e are required on main, including
  for administrators, with branches required to be up to date. GitHub Actions
  (app 15368) must supply those check results.
- Gate npm run deploy, deploy:staging, and upload before building and again
  immediately before publication. The gate requires a clean checkout, an exact
  remote branch revision and the latest successful CI run with both required
  jobs completed successfully. Failed, pending, cancelled, skipped or missing
  results block release. Production/upload require current remote main;
  staging requires the current named development branch.

Release procedure:
1. Commit on an unprefixed development branch and push it.
2. Wait for both jobs in .github/workflows/ci.yml to pass. Fix failures before
   merging; do not bypass required checks.
3. Merge/fast-forward main and push. Wait for the main push's CI run to pass.
4. Use npm run deploy (or npm run upload), then verify live behavior. The GitHub
   CLI must be installed and authenticated with permission to read this repo's
   Actions runs; no GitHub credential is added to the Worker.
5. For an operator-managed version rollout, run npm run check:release before
   both the Wrangler version upload and activation. The checked-in npm scripts
   are the supported release entry points. Standalone Cloudflare credentials
   still permit direct CLI/dashboard changes outside these repository gates.

Validation:
- Five release-gate unit tests cover successful runs and fail-closed cases,
  including other revisions/branches/workflows, skipped jobs and newer failed
  runs. An actual dirty checkout was rejected before any build or upload.
- Full unit/QA suites and the complete GitHub CI workflow are required before
  rollout. Browser tests use fictional accounts and fake providers; they do
  not send customer messages or charge payment methods.
- A remote staging Worker/database is not provisioned. The CI browser harness
  is isolated and exercises production builds with synthetic accounts/data.

See the Problem 9 commit and its linked GitHub Actions runs for final validation
and deployment evidence. GitHub branch protection is repository configuration,
not a setting stored in the workflow file.
