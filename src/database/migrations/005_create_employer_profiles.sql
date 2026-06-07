-- Migration 005: Create the `employer_profiles` table

CREATE TABLE IF NOT EXISTS employer_profiles (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name    VARCHAR(255)    NOT NULL,
  industry        VARCHAR(100)    NULL,
  description     TEXT            NULL,
  logo_url        VARCHAR         NULL,
  website_url     VARCHAR         NULL,
  contact_person  VARCHAR(255)    NULL,
  size_range      VARCHAR(50)     NULL,
  approval_status approval_status NOT NULL DEFAULT 'pending'
);

-- One profile per employer user
CREATE UNIQUE INDEX IF NOT EXISTS idx_employer_profiles_user_id
  ON employer_profiles(user_id);
