-- Migration 003: Create the `student_profiles` table

CREATE TABLE IF NOT EXISTS student_profiles (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name       VARCHAR(255)  NOT NULL,
  institution     VARCHAR(255)  NULL,
  degree          VARCHAR(255)  NULL,
  gpa             NUMERIC(3,2)  NULL CHECK (gpa IS NULL OR (gpa >= 0.00 AND gpa <= 4.00)),
  graduation_year SMALLINT      NULL,
  skills          TEXT[]        NULL,
  bio             TEXT          NULL,
  photo_url       VARCHAR       NULL,
  completion_pct  NUMERIC(5,2)  NULL
);

-- One profile per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profiles_user_id
  ON student_profiles(user_id);
