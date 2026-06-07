-- Migration 002: Create the `users` table
-- Central authentication record shared by students, employers, and admins.

CREATE TABLE IF NOT EXISTS users (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 VARCHAR(255)  UNIQUE NOT NULL,
  password_hash         VARCHAR       NOT NULL,
  role                  user_role     NOT NULL,
  status                user_status   NOT NULL,
  failed_login_attempts SMALLINT      NOT NULL DEFAULT 0,
  locked_until          TIMESTAMP     NULL,
  created_at            TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Trigger to auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
