/**
 * Shared TypeScript enums and types for the Internship Portal Management System.
 * These mirror the PostgreSQL ENUM types defined in the database migrations.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum UserRole {
  Student = 'student',
  Employer = 'employer',
  Admin = 'admin',
}

export enum UserStatus {
  PendingVerification = 'pending_verification',
  Active = 'active',
  PendingApproval = 'pending_approval',
  Deactivated = 'deactivated',
}

export enum ApplicationStatus {
  Submitted = 'Submitted',
  UnderReview = 'Under_Review',
  Shortlisted = 'Shortlisted',
  InterviewScheduled = 'Interview_Scheduled',
  Offered = 'Offered',
  Accepted = 'Accepted',
  Rejected = 'Rejected',
  Withdrawn = 'Withdrawn',
}

export enum ListingStatus {
  Draft = 'draft',
  Pending = 'pending',
  Published = 'published',
  Closed = 'closed',
  Rejected = 'rejected',
}

export enum InterviewMode {
  Online = 'online',
  InPerson = 'in-person',
}

export enum ApprovalStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

export enum AuditAction {
  ApproveEmployer = 'APPROVE_EMPLOYER',
  RejectEmployer = 'REJECT_EMPLOYER',
  ApproveListing = 'APPROVE_LISTING',
  RejectListing = 'REJECT_LISTING',
  DeactivateAccount = 'DEACTIVATE_ACCOUNT',
}

export type NotificationEventType =
  | 'ACCOUNT_VERIFIED'
  | 'ACCOUNT_APPROVED'
  | 'ACCOUNT_REJECTED'
  | 'APPLICATION_STATUS_CHANGED'
  | 'INTERVIEW_SCHEDULED'
  | 'OFFER_RECEIVED'
  | 'LISTING_CLOSED';

// ---------------------------------------------------------------------------
// Domain entity interfaces (row shapes returned from the database)
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  failed_login_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface StudentProfile {
  id: string;
  user_id: string;
  full_name: string;
  institution: string | null;
  degree: string | null;
  gpa: string | null; // NUMERIC returned as string by pg driver
  graduation_year: number | null;
  skills: string[] | null;
  bio: string | null;
  photo_url: string | null;
  completion_pct: string | null; // NUMERIC returned as string by pg driver
}

export interface Resume {
  id: string;
  student_id: string;
  file_url: string;
  original_name: string | null;
  file_size_bytes: number | null;
  uploaded_at: Date;
  is_active: boolean;
}

export interface EmployerProfile {
  id: string;
  user_id: string;
  company_name: string;
  industry: string | null;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  contact_person: string | null;
  size_range: string | null;
  approval_status: ApprovalStatus;
}

export interface Listing {
  id: string;
  employer_id: string;
  title: string;
  description: string;
  required_skills: string[] | null;
  duration_weeks: number;
  location: string;
  stipend_monthly: string | null; // NUMERIC returned as string by pg driver
  application_deadline: string;   // DATE returned as string by pg driver
  openings: number;
  accepted_count: number;
  status: ListingStatus;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Application {
  id: string;
  student_id: string;
  listing_id: string;
  resume_id: string;
  status: ApplicationStatus;
  submitted_at: Date;
  updated_at: Date;
}

export interface Interview {
  id: string;
  application_id: string;
  scheduled_at: Date;
  mode: InterviewMode;
  location_or_link: string;
  created_at: Date;
}

export interface Offer {
  id: string;
  application_id: string;
  start_date: string;   // DATE returned as string by pg driver
  duration_weeks: number;
  stipend: string | null; // NUMERIC returned as string by pg driver
  issued_at: Date;
}

export interface Notification {
  id: string;
  user_id: string;
  event_type: NotificationEventType;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: Date;
}

export interface AuditLog {
  id: string;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Listing with employer details and derived fields
// ---------------------------------------------------------------------------

/**
 * Extends the base Listing with employer profile fields and the derived
 * `remaining_openings` value (openings - accepted_count).
 *
 * Returned by ListingService.searchListings() and ListingService.getListingById().
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export interface ListingWithDetails extends Listing {
  /** Computed: openings - accepted_count */
  remaining_openings: number;
  /** Employer's industry from employer_profiles */
  employer_industry: string | null;
  /** Employer's company name from employer_profiles */
  company_name: string;
  /** Employer's company description (included in detail view) */
  company_description?: string | null;
  /** Employer's logo URL (included in detail view) */
  logo_url?: string | null;
  /** Employer's website URL (included in detail view) */
  website_url?: string | null;
}
