-- Migration 008: Create the `interviews` table
-- One interview per application (enforced by UNIQUE on application_id).

CREATE TABLE IF NOT EXISTS interviews (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   UUID           NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  scheduled_at     TIMESTAMP      NOT NULL,
  mode             interview_mode NOT NULL,
  location_or_link VARCHAR(500)   NOT NULL,
  created_at       TIMESTAMP      NOT NULL DEFAULT NOW()
);
