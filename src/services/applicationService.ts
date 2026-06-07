/**
 * ApplicationService
 *
 * Provides business logic for the full application lifecycle:
 *   - submitApplication      — student submits; guards: profile ≥60%, listing published,
 *                              deadline not passed, no duplicate
 *   - getApplicationsByStudent — return all applications for a student
 *   - withdrawApplication    — student withdraws (Submitted | Under_Review only)
 *   - getApplicationsByListing — employer views applications for a listing
 *   - updateStatus           — employer (or student) advances the state machine
 *
 * All database access uses parameterised queries via BaseRepository.
 * In-app notifications are written inside the same DB transaction as the
 * triggering event; email jobs are enqueued outside the transaction so a
 * Redis failure cannot roll back the DB change.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.8
 */

import { PoolClient } from 'pg';
import { BaseRepository } from '../database/baseRepository';
import {
  Application,
  ApplicationStatus,
  ListingStatus,
  Notification,
  PaginatedResult,
} from '../types';
import { AppError } from './authService';
import { COMPLETION_THRESHOLD } from '../config/profileCompletion';
import { enqueueEmail, EmailJobData } from '../queues/emailQueue';

// ---------------------------------------------------------------------------
// Application state machine
//
// Valid transitions keyed by current status.
// The actor field documents which role may perform the transition (informational;
// RBAC is enforced at the route layer).
// ---------------------------------------------------------------------------

type Transition = {
  /** Roles that are allowed to drive this transition */
  actor: 'employer' | 'student';
};

const VALID_TRANSITIONS: Record<ApplicationStatus, Partial<Record<ApplicationStatus, Transition>>> = {
  [ApplicationStatus.Submitted]: {
    [ApplicationStatus.UnderReview]: { actor: 'employer' },
    [ApplicationStatus.Withdrawn]:   { actor: 'student'  },
  },
  [ApplicationStatus.UnderReview]: {
    [ApplicationStatus.Shortlisted]: { actor: 'employer' },
    [ApplicationStatus.Rejected]:    { actor: 'employer' },
    [ApplicationStatus.Withdrawn]:   { actor: 'student'  },
  },
  [ApplicationStatus.Shortlisted]: {
    [ApplicationStatus.InterviewScheduled]: { actor: 'employer' },
    [ApplicationStatus.Rejected]:           { actor: 'employer' },
  },
  [ApplicationStatus.InterviewScheduled]: {
    [ApplicationStatus.Offered]:  { actor: 'employer' },
    [ApplicationStatus.Rejected]: { actor: 'employer' },
  },
  [ApplicationStatus.Offered]: {
    [ApplicationStatus.Accepted]: { actor: 'student' },
    [ApplicationStatus.Rejected]: { actor: 'student' },
  },
  // Terminal states — no outgoing transitions
  [ApplicationStatus.Accepted]:  {},
  [ApplicationStatus.Rejected]:  {},
  [ApplicationStatus.Withdrawn]: {},
};

// ---------------------------------------------------------------------------
// Application filter DTO
// ---------------------------------------------------------------------------

export interface AppFilterDTO {
  status?: ApplicationStatus;
  institution?: string;
  sortBy?: 'submittedAt' | 'gpa';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Application with student details (employer view)
// ---------------------------------------------------------------------------

export interface ApplicationWithStudentDetails extends Application {
  student_name: string;
  institution: string | null;
  gpa: string | null;
  skills: string[] | null;
  bio: string | null;
  resume_file_url: string | null;
  resume_original_name: string | null;
}

// ---------------------------------------------------------------------------
// ApplicationService
// ---------------------------------------------------------------------------

export class ApplicationService extends BaseRepository {

  // -------------------------------------------------------------------------
  // submitApplication
  // -------------------------------------------------------------------------

  /**
   * Submit a new application for the given student to the given listing.
   *
   * Guards (in order):
   *  1. Student profile exists.
   *  2. Profile completion ≥ COMPLETION_THRESHOLD (60 %).  → 422 PROFILE_INCOMPLETE
   *  3. Student has an active resume.
   *  4. Listing exists and is `published`.               → 422 LISTING_CLOSED
   *  5. Application deadline has not passed.             → 422 DEADLINE_PASSED
   *  6. No duplicate application for this (student, listing) pair.
   *                                                       → 409 DUPLICATE_APPLICATION
   *
   * On success (inside one DB transaction):
   *  - INSERT application (status = Submitted, resume_id = active resume)
   *  - INSERT in-app notification for the student (APPLICATION_STATUS_CHANGED)
   *
   * Requirements: 6.1, 6.2, 6.3, 6.4
   *
   * @param userId    users.id of the authenticated student
   * @param listingId listings.id to apply to
   */
  async submitApplication(userId: string, listingId: string): Promise<Application> {
    // 1. Resolve student profile
    const studentProfile = await this.queryOne<{
      id: string;
      completion_pct: string | null;
    }>(
      `SELECT id, completion_pct
       FROM   student_profiles
       WHERE  user_id = $1`,
      [userId],
    );

    if (!studentProfile) {
      throw new AppError(404, 'PROFILE_NOT_FOUND', 'Student profile not found.');
    }

    // 2. Guard: profile completion ≥ 60 %
    const completionPct = studentProfile.completion_pct !== null
      ? parseFloat(studentProfile.completion_pct)
      : 0;

    if (completionPct < COMPLETION_THRESHOLD) {
      throw new AppError(
        422,
        'PROFILE_INCOMPLETE',
        `Your profile is only ${completionPct}% complete. You need at least ${COMPLETION_THRESHOLD}% to apply.`,
        { completionPct, required: COMPLETION_THRESHOLD },
      );
    }

    // 3. Find student's active resume
    const activeResume = await this.queryOne<{ id: string }>(
      `SELECT id
       FROM   resumes
       WHERE  student_id = $1
         AND  is_active  = TRUE`,
      [studentProfile.id],
    );

    if (!activeResume) {
      throw new AppError(
        422,
        'NO_ACTIVE_RESUME',
        'You must upload a resume before applying.',
      );
    }

    // 4. Fetch the listing
    const listing = await this.queryOne<{
      id: string;
      status: ListingStatus;
      application_deadline: string;
      title: string;
    }>(
      `SELECT id, status, application_deadline, title
       FROM   listings
       WHERE  id = $1`,
      [listingId],
    );

    if (!listing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    // 4a. Guard: listing must be published
    if (listing.status !== ListingStatus.Published) {
      throw new AppError(
        422,
        'LISTING_CLOSED',
        'This listing is not currently accepting applications.',
        { currentStatus: listing.status },
      );
    }

    // 5. Guard: deadline not passed
    // application_deadline is a DATE string from pg (e.g. "2025-08-31")
    const deadline = new Date(listing.application_deadline);
    // Treat deadline as end-of-day UTC
    deadline.setUTCHours(23, 59, 59, 999);

    if (new Date() > deadline) {
      throw new AppError(
        422,
        'DEADLINE_PASSED',
        'The application deadline for this listing has passed.',
        { deadline: listing.application_deadline },
      );
    }

    // 6. Guard: no duplicate
    const existingApplication = await this.queryOne<{ id: string }>(
      `SELECT id
       FROM   applications
       WHERE  student_id  = $1
         AND  listing_id  = $2`,
      [studentProfile.id, listingId],
    );

    if (existingApplication) {
      throw new AppError(
        409,
        'DUPLICATE_APPLICATION',
        'You have already applied to this listing.',
        { applicationId: existingApplication.id },
      );
    }

    // All guards passed — insert application + notification in one transaction.
    const application = await this.transaction(async (client: PoolClient) => {
      // INSERT application
      const app = await this.queryOneWithClient<Application>(
        client,
        `INSERT INTO applications (student_id, listing_id, resume_id, status)
         VALUES ($1, $2, $3, 'Submitted')
         RETURNING *`,
        [studentProfile.id, listingId, activeResume.id],
      );

      // INSERT in-app notification for the student (Requirement 6.4, 9.1)
      await this.queryWithClient(
        client,
        `INSERT INTO notifications (user_id, event_type, payload)
         VALUES ($1, 'APPLICATION_STATUS_CHANGED', $2::jsonb)`,
        [
          userId,
          JSON.stringify({
            applicationId: app!.id,
            listingId,
            listingTitle: listing.title,
            newStatus: ApplicationStatus.Submitted,
            message: 'Your application has been submitted successfully.',
          }),
        ],
      );

      return app!;
    });

    // Send submission confirmation email to student
    try {
      const studentUser = await this.queryOne<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [userId],
      );
      if (studentUser) {
        await enqueueEmail({
          type: 'APPLICATION_STATUS_CHANGED',
          userId,
          email: studentUser.email,
          applicationId: application.id,
          listingId,
          listingTitle: listing.title,
          newStatus: 'Submitted',
        } as unknown as EmailJobData);
      }
    } catch (queueErr) {
      console.error('[application] Failed to enqueue submission confirmation email:', queueErr);
    }

    return application;
  }

  // -------------------------------------------------------------------------
  // getApplicationsByStudent
  // -------------------------------------------------------------------------

  /**
   * Return all applications (with listing title) for the given student user,
   * ordered by most recently submitted first.
   *
   * Requirement: 6.5
   *
   * @param userId  users.id of the authenticated student
   */
  async getApplicationsByStudent(userId: string): Promise<(Application & { listing_title: string })[]> {
    // Resolve student profile id
    const studentProfile = await this.queryOne<{ id: string }>(
      `SELECT id FROM student_profiles WHERE user_id = $1`,
      [userId],
    );

    if (!studentProfile) {
      throw new AppError(404, 'PROFILE_NOT_FOUND', 'Student profile not found.');
    }

    const applications = await this.query<Application & { listing_title: string }>(
      `SELECT a.*, l.title AS listing_title
       FROM   applications a
       JOIN   listings     l ON l.id = a.listing_id
       WHERE  a.student_id = $1
       ORDER  BY a.submitted_at DESC`,
      [studentProfile.id],
    );

    return applications;
  }

  // -------------------------------------------------------------------------
  // withdrawApplication
  // -------------------------------------------------------------------------

  /**
   * Withdraw an application on behalf of a student.
   *
   * Allowed only when status ∈ {Submitted, Under_Review}.
   * Returns 422 WITHDRAWAL_NOT_ALLOWED otherwise.
   *
   * On success (within a single DB transaction):
   *  - Transition status → Withdrawn
   *  - INSERT in-app notification for the student
   *
   * Then (outside the transaction):
   *  - Enqueue an email notification for the employer.
   *
   * Requirements: 6.6, 6.7
   *
   * @param applicationId  applications.id to withdraw
   * @param userId         users.id of the authenticated student
   */
  async withdrawApplication(applicationId: string, userId: string): Promise<Application> {
    // Resolve student profile
    const studentProfile = await this.queryOne<{ id: string }>(
      `SELECT id FROM student_profiles WHERE user_id = $1`,
      [userId],
    );

    if (!studentProfile) {
      throw new AppError(404, 'PROFILE_NOT_FOUND', 'Student profile not found.');
    }

    // Fetch application, ensuring ownership
    const existing = await this.queryOne<Application & { listing_title: string; employer_user_id: string }>(
      `SELECT a.*,
              l.title AS listing_title,
              u.id    AS employer_user_id
       FROM   applications a
       JOIN   listings     l  ON l.id  = a.listing_id
       JOIN   employer_profiles ep ON ep.id = l.employer_id
       JOIN   users        u  ON u.id  = ep.user_id
       WHERE  a.id         = $1
         AND  a.student_id = $2`,
      [applicationId, studentProfile.id],
    );

    if (!existing) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    }

    // Guard: must be in a withdrawable state
    const withdrawableStatuses: ApplicationStatus[] = [
      ApplicationStatus.Submitted,
      ApplicationStatus.UnderReview,
    ];

    if (!withdrawableStatuses.includes(existing.status)) {
      throw new AppError(
        422,
        'WITHDRAWAL_NOT_ALLOWED',
        `Applications with status '${existing.status}' cannot be withdrawn.`,
        {
          currentStatus: existing.status,
          withdrawableStatuses,
        },
      );
    }

    // Transition + notification in one transaction
    const updated = await this.transaction(async (client: PoolClient) => {
      const app = await this.queryOneWithClient<Application>(
        client,
        `UPDATE applications
         SET    status     = 'Withdrawn',
                updated_at = NOW()
         WHERE  id = $1
         RETURNING *`,
        [applicationId],
      );

      // In-app notification for the student
      await this.queryWithClient(
        client,
        `INSERT INTO notifications (user_id, event_type, payload)
         VALUES ($1, 'APPLICATION_STATUS_CHANGED', $2::jsonb)`,
        [
          userId,
          JSON.stringify({
            applicationId,
            listingId: existing.listing_id,
            listingTitle: (existing as { listing_title: string }).listing_title,
            newStatus: ApplicationStatus.Withdrawn,
            message: 'Your application has been withdrawn.',
          }),
        ],
      );

      return app!;
    });

    // Enqueue employer notification email outside the transaction
    try {
      const employerUserId = (existing as { employer_user_id: string }).employer_user_id;
      const employerEmail = await this.queryOne<{ email: string }>(
        `SELECT email FROM users WHERE id = $1`,
        [employerUserId],
      );

      if (employerEmail) {
        await enqueueEmail({
          type: 'APPLICATION_WITHDRAWN',
          userId: employerUserId,
          email: employerEmail.email,
          applicationId,
          listingId: existing.listing_id,
          listingTitle: (existing as { listing_title: string }).listing_title,
        } as unknown as EmailJobData);
      }
    } catch (queueErr) {
      console.error('[application] Failed to enqueue withdrawal notification:', queueErr);
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // getApplicationsByListing
  // -------------------------------------------------------------------------

  /**
   * Return applications for a specific listing (employer view), with optional
   * filtering by status and institution, and sorting by submittedAt or GPA.
   *
   * The caller (employer) must own the listing; ownership is verified here.
   *
   * Requirements: 7.1, 7.8
   *
   * @param listingId  listings.id
   * @param userId     users.id of the authenticated employer
   * @param filters    optional filter/sort/pagination options
   */
  async getApplicationsByListing(
    listingId: string,
    userId: string,
    filters: AppFilterDTO = {},
  ): Promise<PaginatedResult<ApplicationWithStudentDetails>> {
    // Verify listing ownership
    const listingOwner = await this.queryOne<{ id: string }>(
      `SELECT l.id
       FROM   listings l
       JOIN   employer_profiles ep ON ep.id = l.employer_id
       WHERE  l.id = $1
         AND  ep.user_id = $2`,
      [listingId, userId],
    );

    if (!listingOwner) {
      throw new AppError(
        404,
        'LISTING_NOT_FOUND',
        'Listing not found or you do not have access to it.',
      );
    }

    // Build dynamic WHERE + ORDER BY
    const whereClauses: string[] = [`a.listing_id = $1`];
    const params: unknown[] = [listingId];
    let paramIndex = 2;

    if (filters.status) {
      params.push(filters.status);
      whereClauses.push(`a.status = $${paramIndex}`);
      paramIndex++;
    }

    if (filters.institution) {
      params.push(`%${filters.institution}%`);
      whereClauses.push(`sp.institution ILIKE $${paramIndex}`);
      paramIndex++;
    }

    const whereSQL = whereClauses.join(' AND ');

    // Sort
    const allowedSortColumns: Record<string, string> = {
      submittedAt: 'a.submitted_at',
      gpa:         'sp.gpa',
    };
    const sortColumn = filters.sortBy ? (allowedSortColumns[filters.sortBy] ?? 'a.submitted_at') : 'a.submitted_at';
    const sortDir = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';

    // Pagination
    const page     = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const offset   = (page - 1) * pageSize;

    // Count query
    const countRow = await this.queryOne<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM   applications a
       JOIN   student_profiles sp ON sp.id = a.student_id
       WHERE  ${whereSQL}`,
      params,
    );
    const total = parseInt(countRow?.total ?? '0', 10);

    // Data query
    params.push(pageSize);
    const limitParam = paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex++;

    const rows = await this.query<ApplicationWithStudentDetails>(
      `SELECT a.*,
              sp.full_name   AS student_name,
              sp.institution,
              sp.gpa,
              sp.skills,
              sp.bio,
              r.file_url     AS resume_file_url,
              r.original_name AS resume_original_name
       FROM   applications a
       JOIN   student_profiles sp ON sp.id = a.student_id
       LEFT JOIN resumes r ON r.id = a.resume_id
       WHERE  ${whereSQL}
       ORDER  BY ${sortColumn} ${sortDir}
       LIMIT  $${limitParam}
       OFFSET $${offsetParam}`,
      params,
    );

    return {
      data: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // -------------------------------------------------------------------------
  // updateStatus
  // -------------------------------------------------------------------------

  /**
   * Advance the application state machine from the current status to
   * `newStatus`.
   *
   * Enforces the transition table; returns 422 INVALID_STATUS_TRANSITION with
   * the list of allowed next states if the requested transition is not valid.
   *
   * On a valid transition (inside one DB transaction):
   *  - UPDATE application status
   *  - INSERT in-app notification for the student
   *
   * Then (outside the transaction):
   *  - Enqueue email notification for the student (APPLICATION_STATUS_CHANGED)
   *
   * When the new status is Accepted:
   *  - Increment listings.accepted_count atomically.
   *
   * Requirements: 7.2, 7.8
   *
   * @param applicationId  applications.id
   * @param userId         users.id of the actor (employer or student)
   * @param newStatus      desired target status
   */
  async updateStatus(
    applicationId: string,
    userId: string,
    newStatus: ApplicationStatus,
  ): Promise<Application> {
    // Fetch application + associated data needed for notifications
    const existing = await this.queryOne<
      Application & {
        listing_title: string;
        listing_id: string;
        student_user_id: string;
        student_email: string;
        student_name: string;
      }
    >(
      `SELECT a.*,
              l.title    AS listing_title,
              l.id       AS listing_id,
              u_s.id     AS student_user_id,
              u_s.email  AS student_email,
              sp.full_name AS student_name
       FROM   applications a
       JOIN   listings         l   ON l.id  = a.listing_id
       JOIN   student_profiles sp  ON sp.id = a.student_id
       JOIN   users            u_s ON u_s.id = sp.user_id
       WHERE  a.id = $1`,
      [applicationId],
    );

    if (!existing) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    }

    // Validate the transition
    const allowedNext = VALID_TRANSITIONS[existing.status];
    if (!allowedNext || !allowedNext[newStatus]) {
      const allowedStatuses = Object.keys(allowedNext ?? {}) as ApplicationStatus[];
      throw new AppError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Cannot transition from '${existing.status}' to '${newStatus}'.`,
        {
          currentStatus: existing.status,
          requestedStatus: newStatus,
          allowedNextStatuses: allowedStatuses,
        },
      );
    }

    const studentUserId = existing.student_user_id;
    const listingId = existing.listing_id;
    const listingTitle = existing.listing_title;

    // Execute update + notification in one transaction
    const updated = await this.transaction(async (client: PoolClient) => {
      const app = await this.queryOneWithClient<Application>(
        client,
        `UPDATE applications
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id = $2
         RETURNING *`,
        [newStatus, applicationId],
      );

      // If transitioning to Accepted, increment accepted_count on the listing
      if (newStatus === ApplicationStatus.Accepted) {
        await this.queryWithClient(
          client,
          `UPDATE listings
           SET    accepted_count = accepted_count + 1,
                  updated_at     = NOW()
           WHERE  id = $1`,
          [listingId],
        );
      }

      // In-app notification for the student (Requirement 7.2, 9.1)
      await this.queryWithClient(
        client,
        `INSERT INTO notifications (user_id, event_type, payload)
         VALUES ($1, 'APPLICATION_STATUS_CHANGED', $2::jsonb)`,
        [
          studentUserId,
          JSON.stringify({
            applicationId,
            listingId,
            listingTitle,
            previousStatus: existing.status,
            newStatus,
            message: `Your application status has been updated to '${newStatus}'.`,
          }),
        ],
      );

      return app!;
    });

    // Enqueue email notification for the student outside the transaction
    try {
      await enqueueEmail({
        type: 'APPLICATION_STATUS_CHANGED',
        userId: studentUserId,
        email: existing.student_email,
        applicationId,
        listingId,
        listingTitle,
        newStatus,
      } as unknown as EmailJobData);
    } catch (queueErr) {
      console.error('[application] Failed to enqueue status-change email:', queueErr);
    }

    return updated;
  }
}

// Singleton instance
export const applicationService = new ApplicationService();
