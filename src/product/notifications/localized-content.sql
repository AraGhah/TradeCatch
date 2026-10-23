-- Additive migration: template inputs survive workers and delivery retries.
ALTER TABLE tc_notifications ADD COLUMN IF NOT EXISTS content_json JSONB;
UPDATE tc_notifications n
SET content_json = jsonb_build_array(jsonb_build_object('type', e.type, 'payload', e.payload_json))
FROM tc_outbox_events e
WHERE e.organization_id = n.organization_id AND e.idempotency_key = n.idempotency_key
  AND n.content_json IS NULL;
