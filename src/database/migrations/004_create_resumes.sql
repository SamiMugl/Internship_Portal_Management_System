-- Migration 004: Create the `resumes` table

CREATE TABLE IF NOT EXISTS resumes (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID          NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  file_url         VARCHAR       NOT NULL,
  original_name    VARCHAR(255)  NULL,
  file_size_bytes  INTEGER       NULL,
  uploaded_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE
);

-- Quick lookup of a student's active resume
CREATE INDEX IF NOT EXISTS idx_resumes_student_active
  ON resumes(student_id, is_active);
