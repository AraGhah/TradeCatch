# Persisted missed-call maintenance

The production scheduler authentication repair exposed a separate failure:
`/api/missed-call/escalations/tick` invoked webhook bootstrap, which requires a
global production phone-routing configuration and seeds an environment client.
Twilio is not configured yet, so even an empty timer queue failed every minute.
That bootstrap was also unnecessary for workflows whose client settings already
exist in PostgreSQL.

Timer/retry maintenance now uses the existing durable store and each workflow's
persisted client without creating or overwriting an environment/demo client.
Inbound call/webhook bootstrap retains its strict production configuration
validation. Production still refuses memory fallback and never selects dry-run
SMS to conceal missing provider credentials.

An empty queue can complete normally before telephony is activated. If genuine
queued SMS cannot be sent, the existing outbox retry/dead-letter rules remain in
force and the response reports `ok: false`; the scheduler must not mark those
failed deliveries healthy. Database errors still fail the job. Operations bearer
authentication and the actor audit remain required.

No migration, queue deletion, demo enablement, contact change, Twilio setup or
installation approval is needed for this code change. Roll back through a normal
reviewed release if necessary; preserve all persisted workflows and retries.
