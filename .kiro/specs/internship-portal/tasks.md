# Implementation Plan: Internship Portal Management System

## Overview

Implement the full Internship Portal Management System as a Node.js / Express REST API backed by PostgreSQL, Redis, and Bull job queues. The plan is broken into incremental tasks that wire together progressively — from database schema and shared infrastructure through each feature module to the final analytics and reporting layer. Property-based tests (fast-check) are included as optional sub-tasks immediately after the logic they verify.

---

## Tasks

- [x] 1. Project Setup and Shared Infrastructure
  - Initialise the Node.js / TypeScript project with Express, pg/Prisma (or Knex), Redis, Bull, bcrypt, jsonwebtoken, nodemailer, and fast-check
  - Configure TypeScript (`tsconfig.json`), ESLint, Prettier, and Jest (with ts-jest)
  - Set up environment variable management (`.env` + validation with zod or envalid)
  - Create the Express application entry point with middleware (body-parser, cors, helmet, morgan)
  - Define the global error-handler middleware and the standard error response shape (`{ error: { code, message, details } }`)
  - Define all shared TypeScript types and enums: `UserRole`, `UserStatus`, `ApplicationStatus`, `ListingStatus`, `InterviewMode`, `AuditAction`, `NotificationEventType`
  - _Requirements: all modules_

- [x] 2. Database Schema and Migrations
  - [x] 2.1 Write and run database migrations for all tables
    - Create migrations for: `users`, `student_profiles`, `resumes`, `employer_profiles`, `listings`, `applications`, `interviews`, `offers`, `notifications`, `audit_logs`
    - Apply all column types, constraints, defaults, and ENUM definitions as specified in the Data Models section
    - Add the `UNIQUE(student_id, listing_id)` constraint on `applications`
    - _Requirements: 1, 2, 3, 4, 6, 7, 9, 10_

  - [x] 2.2 Create all database indexes
    - Apply all indexes defined in the Indexes section: `idx_users_email`, `idx_applications_student_listing`, `idx_listings_status`, `idx_listings_deadline`, `idx_listings_employer`, `idx_notifications_user_read`, `idx_audit_logs_admin`, `idx_audit_logs_target`
    - _Requirements: 5, 9, 10_

  - [x] 2.3 Implement the database client module and repository base
    - Set up the PostgreSQL connection pool
    - Write a thin base-repository helper with typed query execution and transaction support
    - _Requirements: all modules_

- [x] 3. Authentication Module
  - [x] 3.1 Implement user registration for students and employers
    - Write `POST /auth/register/student` and `POST /auth/register/employer` handlers
    - Hash passwords with bcrypt (cost factor 12) before persistence
    - Insert `user` row with correct initial `status` (`pending_verification` for student, `pending_approval` for employer)
    - Insert the corresponding `student_profile` or `employer_profile` row
    - Enqueue a verification or notification email job via Bull
    - Return 409 on duplicate email with `DUPLICATE_EMAIL` code
    - _Requirements: 1.1, 3.1_

  - [ ]* 3.2 Write property test for registration initial state (Property 1)
    - **Property 1: Registration creates account with correct initial state**
    - **Validates: Requirements 1.1, 3.1**

  - [ ]* 3.3 Write property test for duplicate email rejection (Property 3)
    - **Property 3: Duplicate email registration is rejected**
    - **Validates: Requirements 1.3**

  - [x] 3.4 Implement email verification
    - Write `POST /auth/verify-email` handler
    - Validate the token from the email link (HMAC-signed JWT with 24 h expiry)
    - Transition `user.status` to `active` on success
    - Return `400 INVALID_OR_EXPIRED_TOKEN` if token is expired or tampered
    - _Requirements: 1.2_

  - [ ]* 3.5 Write property test for email verification round-trip (Property 2)
    - **Property 2: Email verification round-trip activates account**
    - **Validates: Requirements 1.2**

  - [x] 3.6 Implement login with lockout logic
    - Write `POST /auth/login` handler
    - Verify password with bcrypt; on mismatch increment `failed_login_attempts` and set `locked_until` in Redis after the third failure
    - Enqueue a lockout-notification email job on lockout
    - Return `423 Locked` with `lockUntil` timestamp when account is locked
    - Return `401 ACCOUNT_NOT_VERIFIED` for unverified accounts; return `401 ACCOUNT_DEACTIVATED` for deactivated accounts
    - Issue a `TokenPair` (access token 15 min JWT + opaque refresh token stored in DB) on success; reset `failed_login_attempts` on success
    - _Requirements: 1.4, 1.5, 3.4_

  - [ ]* 3.7 Write property test for valid credentials yielding a token pair (Property 4)
    - **Property 4: Valid credentials always yield a token pair**
    - **Validates: Requirements 1.4, 3.4**

  - [ ]* 3.8 Write property test for three failed logins triggering lockout (Property 5)
    - **Property 5: Three consecutive failed logins trigger account lockout**
    - **Validates: Requirements 1.5**

  - [ ]* 3.9 Write property test for deactivated account blocking login (Property 27)
    - **Property 27: Deactivated accounts cannot log in**
    - **Validates: Requirements 8.5**

  - [x] 3.10 Implement token refresh, logout, and password reset
    - Write `POST /auth/refresh` — validate refresh token record in DB, issue a new `TokenPair`, invalidate the old refresh token
    - Write `POST /auth/logout` — delete the refresh token record (add to Redis blacklist if needed)
    - Write `POST /auth/request-password-reset` — generate a signed reset token (1 h expiry) and enqueue a reset email job
    - Write `POST /auth/reset-password` — validate token, hash new password, persist, invalidate token
    - _Requirements: 1.6, 1.7_

  - [ ]* 3.11 Write property test for password reset token expiry (Property 6)
    - **Property 6: Password reset token expires after its window**
    - **Validates: Requirements 1.6**

  - [x] 3.12 Implement JWT + RBAC middleware
    - Write `authenticate` middleware: extract and verify access-token JWT; attach `req.user`
    - Write `authorize(...roles)` middleware: check `req.user.role` against allowed roles; return 403 on mismatch
    - Apply middleware to all protected routes
    - _Requirements: 1, 3, 4, 5, 6, 7, 8, 9, 10_

- [x] 4. Checkpoint — Auth module complete
  - Ensure all auth tests pass, ask the user if questions arise.

- [x] 5. Student Profile Module
  - [x] 5.1 Implement student profile CRUD and completion percentage
    - Write `GET /students/me/profile` and `PUT /students/me/profile` handlers calling `StudentProfileService.getProfile` and `updateProfile`
    - Implement `getCompletionPercentage()`: evaluate the weighted-field formula from configuration constants; cache the computed value on the `student_profiles.completion_pct` column
    - Write `GET /students/me/completion` handler
    - Return a success notification body on profile save
    - _Requirements: 2.1, 2.4, 2.5_

  - [ ]* 5.2 Write property test for profile update round-trip (Property 7)
    - **Property 7: Profile updates are persisted faithfully (round-trip)**
    - **Validates: Requirements 2.1, 2.5, 3.5, 3.6**

  - [ ]* 5.3 Write property test for completion percentage formula (Property 9)
    - **Property 9: Profile completion percentage matches the weighted-field formula**
    - **Validates: Requirements 2.4**

  - [x] 5.4 Implement resume upload
    - Write `POST /students/me/resume` handler
    - Validate MIME type (PDF or DOCX) and file size (≤ 5 MB) before sending to object storage; return `422 FILE_VALIDATION_ERROR` on violation
    - Set previous active resume to `is_active = false`; insert new resume as `is_active = true`
    - _Requirements: 2.2, 2.3_

  - [ ]* 5.5 Write property test for file upload accept/reject (Property 8)
    - **Property 8: Valid file uploads succeed; invalid ones are rejected**
    - **Validates: Requirements 2.2, 2.3, 3.7**

  - [ ]* 5.6 Write property test for low-completion profile blocking application (Property 10)
    - **Property 10: Low-completion profile blocks application submission**
    - **Validates: Requirements 2.6**

- [x] 6. Employer Profile Module
  - [x] 6.1 Implement employer profile CRUD
    - Write `GET /employers/me/profile` and `PUT /employers/me/profile` handlers calling `EmployerProfileService.getProfile` and `updateProfile`
    - Return a success notification body on profile save
    - _Requirements: 3.5, 3.6_

  - [x] 6.2 Implement company logo upload
    - Write `POST /employers/me/logo` handler
    - Validate MIME type (PNG or JPG) and file size (≤ 2 MB); return `422 FILE_VALIDATION_ERROR` on violation
    - Persist the returned storage URL to `employer_profiles.logo_url`
    - _Requirements: 3.7_

- [x] 7. Checkpoint — Profile modules complete
  - Ensure all profile tests pass, ask the user if questions arise.

- [x] 8. Listing Module
  - [x] 8.1 Implement listing creation and employer listing management
    - Write `POST /listings` handler: create a listing in `draft` status for the authenticated employer
    - Write `PUT /listings/:id` handler: update listing fields; if status is `published`, transition back to `pending` for re-review
    - Write `POST /listings/:id/submit` handler: transition from `draft` to `pending`
    - Write `POST /listings/:id/deactivate` handler: transition to a `deactivated` / `closed` state, hide from search, retain applications
    - Write `GET /employers/me/listings` handler: return all employer listings with their current status
    - _Requirements: 4.1, 4.5, 4.6, 4.7_

  - [ ]* 8.2 Write property test for editing a published listing reverting to pending (Property 13)
    - **Property 13: Editing a published listing reverts it to pending**
    - **Validates: Requirements 4.5**

  - [ ]* 8.3 Write property test for deactivated listing invisible in search but applications preserved (Property 14)
    - **Property 14: Deactivated listing is invisible in search but applications are preserved**
    - **Validates: Requirements 4.6**

  - [x] 8.4 Implement admin listing moderation endpoints
    - Write `GET /admin/listings/pending` handler: return listings with `status = pending`
    - Write `POST /admin/listings/:id/approve` handler: transition status to `published`, write audit log, enqueue employer notification
    - Write `POST /admin/listings/:id/reject` handler: set status to `rejected`, store `rejection_reason`, write audit log, enqueue employer notification
    - _Requirements: 4.2, 4.3_

  - [ ]* 8.5 Write property test for listing approval transitions to published and appears in search (Property 11)
    - **Property 11: Listing approval transitions to published and appears in search**
    - **Validates: Requirements 4.2**

  - [ ]* 8.6 Write property test for listing rejection persisting reason and notifying employer (Property 12)
    - **Property 12: Listing rejection persists reason and notifies employer**
    - **Validates: Requirements 4.3**

  - [x] 8.7 Implement listing search, filter, and caching
    - Write `GET /listings` handler calling `ListingService.searchListings(filters)`: support all filter criteria (keyword, industry, location, durationWeeks, stipendMonthly, skills, deadlineBefore, page, pageSize)
    - Return only `published` listings sorted by `created_at DESC`
    - Cache results in Redis with 5-minute TTL; invalidate cache on any listing status change
    - Write `GET /listings/:id` handler: return full listing detail including `remainingOpenings = openings - accepted_count`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 8.8 Write property test for filter correctness (Property 16)
    - **Property 16: Search results satisfy all applied filters**
    - **Validates: Requirements 5.2**

  - [ ]* 8.9 Write property test for keyword search correctness (Property 17)
    - **Property 17: Keyword search returns only listings containing the keyword**
    - **Validates: Requirements 5.3**

  - [ ]* 8.10 Write property test for listings sorted by recency (Property 18)
    - **Property 18: Published listings are returned in most-recently-posted order**
    - **Validates: Requirements 5.1**

  - [ ]* 8.11 Write property test for remaining openings formula (Property 19)
    - **Property 19: Remaining openings equals openings minus accepted count**
    - **Validates: Requirements 5.5**

  - [x] 8.12 Implement deadline-enforcement cron job
    - Register a daily Bull cron job that calls `ListingService.closeExpiredListings()`
    - Atomically transition `published` listings where `application_deadline < NOW()` or `accepted_count >= openings` to `closed`
    - For each closed listing, enqueue notifications for students with `Submitted` or `Under_Review` applications
    - _Requirements: 4.4, 5.6, 9.6_

  - [ ]* 8.13 Write property test for expired/full listing auto-close (Property 15)
    - **Property 15: Expired or full listings are automatically closed and reject new applications**
    - **Validates: Requirements 4.4, 5.6**

- [ ] 9. Checkpoint — Listing module complete
  - Ensure all listing tests pass, ask the user if questions arise.

- [x] 10. Application Module
  - [x] 10.1 Implement application submission
    - Write `POST /listings/:id/apply` handler calling `ApplicationService.submitApplication()`
    - Guard: student profile completion ≥ 60%, listing is `published`, deadline not passed, no duplicate application
    - Insert application with `status = Submitted` and `resume_id` set to the student's active resume
    - Create an in-app notification for the student within the same DB transaction
    - Return 409 `DUPLICATE_APPLICATION`, 422 `LISTING_CLOSED`, 422 `DEADLINE_PASSED`, or 422 `PROFILE_INCOMPLETE` as appropriate
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 10.2 Write property test for application submission creating correct record (Property 20)
    - **Property 20: Application submission creates record with correct status and resume**
    - **Validates: Requirements 6.1**

  - [ ]* 10.3 Write property test for duplicate application rejection (Property 21)
    - **Property 21: Duplicate application is rejected (idempotence)**
    - **Validates: Requirements 6.2**

  - [ ]* 10.4 Write property test for submission triggering student notification (Property 22)
    - **Property 22: Application submission triggers a student confirmation notification**
    - **Validates: Requirements 6.4, 9.1**

  - [x] 10.5 Implement student application list and withdrawal
    - Write `GET /students/me/applications` handler: return all applications with current status
    - Write `DELETE /applications/:id` handler calling `ApplicationService.withdrawApplication()`
    - Allow withdrawal only when `status ∈ {Submitted, Under_Review}`; return `422 WITHDRAWAL_NOT_ALLOWED` otherwise
    - On success, transition status to `Withdrawn` and enqueue employer notification
    - _Requirements: 6.5, 6.6, 6.7_

  - [ ]* 10.6 Write property test for withdrawal state-machine (Property 23)
    - **Property 23: Withdrawal succeeds only for early-stage applications**
    - **Validates: Requirements 6.6, 6.7**

  - [x] 10.7 Implement employer application review and status updates
    - Write `GET /listings/:id/applications` handler: return applications for a listing with filters (status, institution) and sorting (submittedAt, GPA)
    - Write `PUT /applications/:id/status` handler calling `ApplicationService.updateStatus()`
    - Enforce the state machine transition table server-side; return `422 INVALID_STATUS_TRANSITION` with allowed next states on violation
    - Create an in-app notification for the student on every valid status change
    - _Requirements: 7.1, 7.2, 7.8_

  - [ ]* 10.8 Write property test for state-machine transition validity (Property 24)
    - **Property 24: Status transitions are valid per the state machine**
    - **Validates: Requirements 7.2, 7.3, 7.5, 7.6, 7.7**

  - [ ]* 10.9 Write property test for status updates producing student notifications (Property 25)
    - **Property 25: Status updates produce student notifications with correct content**
    - **Validates: Requirements 7.2, 7.4, 7.5**

  - [ ]* 10.10 Write property test for application filter and sort correctness (Property 26)
    - **Property 26: Application filter and sort returns correctly ordered, matching results**
    - **Validates: Requirements 7.8**

- [x] 11. Interview Module
  - [x] 11.1 Implement interview scheduling
    - Write `POST /applications/:id/interview` handler calling `InterviewService.scheduleInterview()`
    - Within a single DB transaction: insert `interviews` row and update application `status` to `Interview_Scheduled`
    - Enqueue an interview-details notification for the student
    - _Requirements: 7.3, 7.4_

  - [x] 11.2 Implement offer extension and acceptance/rejection
    - Write `POST /applications/:id/offer` handler: insert `offers` row, update application status to `Offered`, enqueue offer notification for student
    - Write `POST /applications/:id/accept` handler: update status to `Accepted`, increment `listings.accepted_count`, enqueue employer notification; if `accepted_count >= openings` trigger listing close
    - Write `POST /applications/:id/reject-offer` handler: update status to `Rejected`, enqueue employer notification
    - _Requirements: 7.5, 7.6, 7.7_

- [x] 12. Checkpoint — Application and Interview modules complete
  - Ensure all application and interview tests pass, ask the user if questions arise.

- [x] 13. Notification Module
  - [x] 13.1 Implement in-app notification creation and read-marking
    - Implement `NotificationService.createNotification()` used by all other services to write notification rows synchronously
    - Write `PUT /notifications/:id/read` handler calling `NotificationService.markRead()`; visually distinguish read vs. unread in the response payload
    - Write `GET /notifications/unread-count` handler calling `NotificationService.getUnreadCount()`
    - Write `GET /notifications` handler: return paginated notifications sorted by `created_at DESC`
    - _Requirements: 9.1, 9.3, 9.4, 9.5_

  - [ ]* 13.2 Write property test for unread notification count accuracy (Property 29)
    - **Property 29: Unread notification count is accurate**
    - **Validates: Requirements 9.4**

  - [ ]* 13.3 Write property test for notifications sorted by most-recent-first (Property 30)
    - **Property 30: Notifications are returned in most-recent-first order**
    - **Validates: Requirements 9.5**

  - [ ]* 13.4 Write property test for listing close notifying all affected students exactly once (Property 31)
    - **Property 31: Closing a listing notifies all affected students (exactly once each)**
    - **Validates: Requirements 9.6**

  - [x] 13.5 Implement email notification worker
    - Implement the Bull email worker (`EW`) that processes jobs enqueued by `NotificationService.enqueueEmail()`
    - Cover all required email events: account verification, account approval/rejection, shortlist notification, interview scheduled, offer received
    - Configure Bull retry: 3 attempts, exponential backoff (1 s, 5 s, 25 s); log permanently failed jobs
    - _Requirements: 9.2_

- [x] 14. Administrator Module
  - [x] 14.1 Implement admin dashboard and employer account moderation
    - Write `GET /admin/dashboard` handler: return counts of pending employer accounts, pending listings, active students, and total applications
    - Write `GET /admin/employers` handler: return all employer accounts with approval status
    - Write `POST /admin/employers/:id/approve` and `POST /admin/employers/:id/reject` handlers: update `employer_profiles.approval_status`, write an audit log entry, and enqueue the appropriate employer notification
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 14.2 Implement account deactivation
    - Write `POST /admin/accounts/:id/deactivate` handler: set `users.status = deactivated` for any student or employer account
    - Prevent deactivated accounts from logging in (enforced in the login handler)
    - Write audit log entry; enqueue email notification to the affected user
    - _Requirements: 8.5, 8.6_

  - [ ]* 14.3 Write property test for every admin action producing an audit log entry (Property 28)
    - **Property 28: Every admin action produces an audit log entry**
    - **Validates: Requirements 8.7**

  - [x] 14.4 Implement audit log retrieval
    - Write `GET /admin/audit-log` handler: return paginated audit log entries (sorted by `timestamp DESC`) filtered by optional `adminId`, `targetType`, and date range
    - _Requirements: 8.7_

- [x] 15. Checkpoint — Admin module complete
  - Ensure all admin and notification tests pass, ask the user if questions arise.

- [x] 16. Reporting and Analytics Module
  - [x] 16.1 Implement summary report and application breakdown
    - Write `GET /admin/reports/summary` handler calling `ReportService.getSummaryReport(filters)`: return counts of registered students, employers, published listings, and applications for the given date range
    - Write `GET /admin/reports/applications` handler calling `ReportService.getApplicationBreakdown(filters)`: return `ApplicationStatus` counts per listing and per employer
    - _Requirements: 10.1, 10.2_

  - [ ]* 16.2 Write property test for summary report counts matching database (Property 32)
    - **Property 32: Summary report counts match actual database counts for any date range**
    - **Validates: Requirements 10.1**

  - [x] 16.3 Implement placement rate and trend data
    - Write `GET /admin/reports/placement-rate` handler: return `count(Accepted) / count(all submitted applications)` for the specified range; return `0.0` when total applications is zero
    - Write `GET /admin/reports/trends` handler calling `ReportService.getTrendData(30)`: return one data point per day for the past 30 days covering new registrations, new listings, and new applications
    - _Requirements: 10.3, 10.5_

  - [ ]* 16.4 Write property test for placement rate formula (Property 33)
    - **Property 33: Placement rate matches the defined formula for any dataset**
    - **Validates: Requirements 10.3**

  - [x] 16.5 Implement report filtering and CSV export
    - Apply `institution`, `industry`, and `dateFrom`/`dateTo` filter predicates to all report queries
    - Write `GET /admin/reports/:type/export` handler calling `ReportService.exportToCsv()`: serialise the report dataset to CSV and respond with `Content-Type: text/csv`
    - _Requirements: 10.4, 10.6_

  - [ ]* 16.6 Write property test for CSV export round-trip (Property 34)
    - **Property 34: CSV export is a lossless serialization of report data (round-trip)**
    - **Validates: Requirements 10.4**

  - [ ]* 16.7 Write property test for report filter correctness (Property 35)
    - **Property 35: Report filters correctly exclude non-matching records**
    - **Validates: Requirements 10.6**

- [x] 17. Final Checkpoint — Full system integration
  - Ensure all unit, property, and integration tests pass.
  - Verify the complete application lifecycle end-to-end via integration tests: register → verify → login → apply → review → shortlist → interview → offer → accept.
  - Verify the cron job correctly closes expired listings in the test environment.
  - Ask the user if any questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP delivery.
- Every property test task explicitly references a Correctness Property from the design document; the tag format inside each test must be `// Feature: internship-portal, Property {N}: {property_title}`.
- fast-check must run a minimum of 100 samples per property test.
- The state-machine transition table (Property 24) must cover 100% of valid and invalid transition pairs.
- All file validation (resume, logo) must occur before the file is forwarded to object storage.
- The `audit_logs` table is INSERT-only — update/delete operations on it are forbidden.
- Email delivery failures must not affect in-app notification creation; they are handled independently through Bull's retry/dead-letter mechanism.
- Redis is used for three distinct purposes: lockout TTL keys, refresh-token blacklisting, and listing search cache — keep key-namespace prefixes distinct (`lockout:`, `blacklist:`, `cache:listings:`).

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 1, "tasks": ["3.1", "3.4", "3.6", "3.10", "3.12"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.5", "3.7", "3.8", "3.9", "3.11"] },
    { "id": 3, "tasks": ["5.1", "5.4", "6.1", "6.2", "8.1", "8.4", "8.7", "8.12"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.5", "5.6", "8.2", "8.3", "8.5", "8.6", "8.8", "8.9", "8.10", "8.11", "8.13"] },
    { "id": 5, "tasks": ["10.1", "10.5", "10.7", "11.1", "11.2", "13.1", "13.5"] },
    { "id": 6, "tasks": ["10.2", "10.3", "10.4", "10.6", "10.8", "10.9", "10.10", "13.2", "13.3", "13.4"] },
    { "id": 7, "tasks": ["14.1", "14.2", "14.4"] },
    { "id": 8, "tasks": ["14.3"] },
    { "id": 9, "tasks": ["16.1", "16.3", "16.5"] },
    { "id": 10, "tasks": ["16.2", "16.4", "16.6", "16.7"] }
  ]
}
```
