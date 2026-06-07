-- Migration 012: Create all application indexes

-- Auth lookups — unique email constraint is already backed by an index,
-- but we name it explicitly for clarity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

-- Application duplicate prevention — mirrors the UNIQUE constraint on the table;
-- naming it explicitly ensures the design-doc name is present in pg_indexes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_student_listing
  ON applications(student_id, listing_id);

-- Listing search
CREATE INDEX IF NOT EXISTS idx_listings_status
  ON listings(status);

-- Partial index: only published listings need fast deadline lookups
CREATE INDEX IF NOT EXISTS idx_listings_deadline
  ON listings(application_deadline)
  WHERE status = 'published';

-- Employer's own listings
CREATE INDEX IF NOT EXISTS idx_listings_employer
  ON listings(employer_id);

-- Notification feed (user's unread messages, newest first)
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, is_read, created_at DESC);

-- Audit log — by admin
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin
  ON audit_logs(admin_id, timestamp DESC);

-- Audit log — by target entity
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON audit_logs(target_type, target_id);
