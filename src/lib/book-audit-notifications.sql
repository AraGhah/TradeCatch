-- Additive migration 020. Apply before deploying the notification worker.
CREATE TABLE IF NOT EXISTS mc_book_audit_notifications (
  lead_id TEXT NOT NULL REFERENCES mc_book_audit_leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('notify_email', 'customer_email', 'crm', 'admin_alert')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token TEXT,
  leased_until TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  PRIMARY KEY (lead_id, channel)
);

CREATE INDEX IF NOT EXISTS mc_book_audit_notifications_due
  ON mc_book_audit_notifications (next_attempt_at)
  WHERE delivered_at IS NULL;

ALTER TABLE mc_book_audit_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mc_book_audit_notifications FROM PUBLIC;

-- Preserve known email deliveries; recover unfinished email notifications.
-- External CRM work is opt-in at booking capture, never unconditionally backfilled.
-- Historical email_sent recorded only the administrator email. Do not claim
-- that historical customer confirmations were delivered or resend them in bulk.
INSERT INTO mc_book_audit_notifications (lead_id, channel, delivered_at)
SELECT l.id, c.channel,
  CASE WHEN (c.channel = 'notify_email' AND l.email_sent)
       THEN l.updated_at ELSE NULL END
FROM mc_book_audit_leads l
CROSS JOIN (VALUES ('notify_email'), ('customer_email')) AS c(channel)
WHERE c.channel <> 'customer_email' OR NOT l.email_sent
ON CONFLICT DO NOTHING;
