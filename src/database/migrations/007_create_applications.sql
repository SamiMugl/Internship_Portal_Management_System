-- Migration 007: Create the `applications` table

CREATE TABLE IF NOT EXISTS applications (
  id           UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID               NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  listing_id   UUID               NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  resume_id    UUID               NOT NULL REFERENCES resumes(id),
  status       application_status NOT NULL DEFAULT 'Submitted',
  submitted_at TIMESTAMP          NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP          NOT NULL DEFAULT NOW(),

  -- Prevents a student from applying to the same listing more than once
  CONSTRAINT uq_application_student_listing UNIQUE (student_id, listing_id)
);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_applications_updated_at ON applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
