-- Migration 009: Create the `offers` table
-- One offer per application (enforced by UNIQUE on application_id).

CREATE TABLE IF NOT EXISTS offers (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID          NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  start_date     DATE          NOT NULL,
  duration_weeks SMALLINT      NOT NULL,
  stipend        NUMERIC(10,2) NULL,
  issued_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);
