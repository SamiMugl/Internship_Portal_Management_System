-- Migration 001: Create all PostgreSQL ENUM types
-- These must exist before any table that references them.

-- User roles
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('student', 'employer', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- User account status
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM (
    'pending_verification',
    'active',
    'pending_approval',
    'deactivated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Employer / company approval status
DO $$ BEGIN
  CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Internship listing status
DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM (
    'draft',
    'pending',
    'published',
    'closed',
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Application lifecycle status
DO $$ BEGIN
  CREATE TYPE application_status AS ENUM (
    'Submitted',
    'Under_Review',
    'Shortlisted',
    'Interview_Scheduled',
    'Offered',
    'Accepted',
    'Rejected',
    'Withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Interview mode
DO $$ BEGIN
  CREATE TYPE interview_mode AS ENUM ('online', 'in-person');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
