-- Migration 011: Create the `audit_logs` table
-- This table is INSERT-only; UPDATE and DELETE are forbidden by application policy.

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID      NOT NULL REFERENCES users(id),
  action      VARCHAR(100) NOT NULL,
  target_type VARCHAR(50)  NOT NULL,
  target_id   UUID      NOT NULL,
  reason      TEXT      NULL,
  timestamp   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Protective rule: prevent UPDATE and DELETE on audit_logs to enforce immutability
CREATE OR REPLACE RULE no_update_audit_logs AS
  ON UPDATE TO audit_logs DO INSTEAD NOTHING;

CREATE OR REPLACE RULE no_delete_audit_logs AS
  ON DELETE TO audit_logs DO INSTEAD NOTHING;
