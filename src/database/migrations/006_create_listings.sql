-- Migration 006: Create the `listings` table

CREATE TABLE IF NOT EXISTS listings (
  id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id          UUID            NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
  title                VARCHAR(255)    NOT NULL,
  description          TEXT            NOT NULL,
  required_skills      TEXT[]          NULL,
  duration_weeks       SMALLINT        NOT NULL,
  location             VARCHAR(255)    NOT NULL,
  stipend_monthly      NUMERIC(10,2)   NULL,
  application_deadline DATE            NOT NULL,
  openings             SMALLINT        NOT NULL,
  accepted_count       SMALLINT        NOT NULL DEFAULT 0,
  status               listing_status  NOT NULL DEFAULT 'draft',
  rejection_reason     TEXT            NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_listings_updated_at ON listings;
CREATE TRIGGER trg_listings_updated_at
  BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
