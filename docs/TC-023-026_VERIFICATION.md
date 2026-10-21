# TC-023–026 — release and privacy verification

## Release traceability and checks

The October 19 audit report commit `42710a4` and its security fixes are ancestors
of main; they must not be cherry-picked again. The report describes that review's
historical deployment state, not today's production state.

`npm run deploy`, `deploy:staging` and `upload` use `release-cloudflare.js`.
The wrapper checks the pushed revision's latest quality/e2e CI results before
building and again before uploading, rejects a revision change during the build,
and annotates the immutable Cloudflare version with `git:<SHA> ci:<run ID>`.
Compare the active version's annotation with GitHub CI, rather than treating a
branch name or a newer secret-configuration version as proof of source code.

CI now provisions separate, disposable loopback databases for booking retry and
login-confirmation tests. Retention/opt-out tests use a private schema in the
existing disposable PostgreSQL service. They never receive production credentials.
Lint, formatting, type checking, unit/QA/browser tests, production dependency
audit, Cloudflare build and bundle validation remain required before release.

## TC-024 — protected, durable intake

Production builds, including staging, require a nonblank Turnstile secret and
site key plus the durable-store flag and database URL. Public dummy Turnstile
keys are rejected on the live environment. Only the guarded loopback E2E
harness may omit bot configuration; it still cannot acknowledge memory storage.
Provider failures, invalid responses and missing/wrong host/action cannot save
a booking. Production-shaped verification does not trust `localhost`.

The existing atomic lead/outbox write remains the acceptance boundary. Email
and CRM outages leave retry jobs and a separately reported pending status.
Persistent failure creates a durable administrator job; it uses the monitoring
webhook first and the configured administrator email as a fallback. Alerts
contain lead references/channel names rather than customer contact data. The
email provider receives a stable idempotency key; rejection never counts as sent.

## TC-026 — technical checks and limits

- STOP, ARRÊT, decomposed accents and surrounding whitespace persist an SMS
  suppression in PostgreSQL; a new engine/store still refuses a later SMS.
- Booking consent is server-controlled: service consent, separate marketing
  choice, canonical wording, source and timestamp are stored with the lead.
- Module A retention runs atomically. It scrubs expired dead/error-bearing SMS
  and old call payloads, expires booking leads independently of delivery status,
  and removes their queued jobs without claiming delivery. Active leases/sends
  and calls associated with current workflows are deferred. A failure rolls
  back preceding cleanup. Minimal SMS suppression records remain to prevent
  contacting someone who opted out.
- Privacy request intake remains available to authorized owners/admins.
  Completion requires the same permission. The application returns 409 and
  leaves a request open because no verified, comprehensive subject-erasure
  adapter exists. Redacting a client-supplied snapshot is not evidence that
  stored records were erased. A privacy officer must fulfill these requests
  through the owning systems; the application does not falsely certify deletion.
- Voicemail explicitly announces recording, purpose and the opportunity to
  hang up before recording in French and English. Whole-call recording is not
  enabled by this change. Recording settings cannot enable recording while
  disabling disclosure.

The tests establish local/application behavior, not carrier enforcement or
deletion of provider-held recordings. Real Twilio STOP/ARRÊT and voicemail tests
remain blocked until the staging account/number exists (see TC-019).

## Québec legal review — pending; live onboarding not approved

Engineering tests are not legal approval. A qualified Québec privacy/legal
reviewer must approve the following before onboarding live customers:

1. Collection necessity, service versus marketing consent and bilingual wording.
2. CASL identification/unsubscribe behavior, Twilio Advanced Opt-Out setup and
   evidence from controlled English/French staging calls and SMS.
3. Voicemail/call-transcription disclosures, consent/refusal and alternatives.
4. Retention periods and exceptions for every dataset, not only Module A;
   provider-held Twilio audio, Gmail/Calendar and Stripe responsibilities.
5. The verified manual access/correction/deletion process, deadlines, identity
   checks, legal holds, backups and proof from each owning system.
6. Privacy officer, privacy policy, contractual roles, cross-border processing
   assessment and incident response obligations.

Record reviewer identity, review date, approved document versions, scope and
outstanding conditions. No reviewer approval is currently recorded. Keep live
onboarding approval pending until that evidence and provider tests are complete.

Primary review references:

- [CAI: consent for private enterprises](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/consentement-personnes-entreprises)
- [Québec private-sector privacy legislation](https://www.legisquebec.gouv.qc.ca/fr/document/lc/p-39.1)
- [CRTC: CASL consent and unsubscribe guidance](https://web.crtc.gc.ca/eng/com500/guide.htm)
- [OPC: recording customer telephone calls](https://www.priv.gc.ca/fr/sujets-lies-a-la-protection-de-la-vie-privee/surveillance/02_05_d_14/)
- [Cloudflare: Turnstile test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
