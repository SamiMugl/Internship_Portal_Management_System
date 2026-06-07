/**
 * InterviewService
 *
 * Handles interview scheduling for applications that are in `Shortlisted` status.
 *
 * Methods:
 *   - scheduleInterview  — atomically inserts an `interviews` row and transitions
 *                          the application to `Interview_Scheduled`; enqueues a
 *                          student notification
 *   - getInterview       — fetch the interview for an application, or null
 *
 * Requirements: 7.3, 7.4
 */

import { PoolClient } from 'pg';
import { BaseRepository } from '../database/baseRepository';
import { Application, ApplicationStatus, Interview, InterviewMode } from '../types';
import { AppError } from './authService';
import { enqueueEmail, EmailJobData } from '../queues/emailQueue';

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface ScheduleInterviewDTO {
  scheduledAt: Date | string;
  mode: InterviewMode | 'online' | 'in-person';
  locationOrLink: string;
}

// ---------------------------------------------------------------------------
// InterviewService
// ---------------------------------------------------------------------------

export class InterviewService extends BaseRepository {
  // -------------------------------------------------------------------------
  // scheduleInterview
  // -------------------------------------------------------------------------

  /**
   * Schedule an interview for a Shortlisted application.
   *
   * Validations (in order):
   *  1. Application exists.
   *  2. The listing that the application belongs to is owned by `employerId`
   *     (the users.id of the authenticated employer).  → 403 FORBIDDEN
   *  3. Current application status is `Shortlisted`.  → 422 INVALID_STATUS_TRANSITION
   *
   * On success (inside one DB transaction):
   *  - INSERT interviews row
   *  - UPDATE application status → Interview_Scheduled
   *
   * Then (outside the transaction):
   *  - Enqueue INTERVIEW_SCHEDULED email notification for the student
   *
   * Requirements: 7.3, 7.4
   *
   * @param applicationId  applications.id
   * @param employerUserId users.id of the authenticated employer
   * @param dto            interview details
   */
  async scheduleInterview(
    applicationId: string,
    employerUserId: string,
    dto: ScheduleInterviewDTO,
  ): Promise<Interview> {
    // 1. Fetch the application together with ownership and student contact info.
    const existing = await this.queryOne<
      Application & {
        employer_user_id: string;
        student_user_id: string;
        student_email: string;
        listing_title: string;
      }
    >(
      `SELECT a.*,
              ep_u.id      AS employer_user_id,
              sp_u.id      AS student_user_id,
              sp_u.email   AS student_email,
              l.title      AS listing_title
       FROM   applications a
       JOIN   listings         l    ON l.id   = a.listing_id
       JOIN   employer_profiles ep  ON ep.id  = l.employer_id
       JOIN   users             ep_u ON ep_u.id = ep.user_id
       JOIN   student_profiles  sp  ON sp.id  = a.student_id
       JOIN   users             sp_u ON sp_u.id = sp.user_id
       WHERE  a.id = $1`,
      [applicationId],
    );

    if (!existing) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    }

    // 2. Verify employer ownership.
    if (existing.employer_user_id !== employerUserId) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'You do not have permission to schedule an interview for this application.',
      );
    }

    // 3. Guard: application must be Shortlisted.
    if (existing.status !== ApplicationStatus.Shortlisted) {
      throw new AppError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Cannot schedule an interview for an application with status '${existing.status}'. Application must be in 'Shortlisted' status.`,
        {
          currentStatus: existing.status,
          requiredStatus: ApplicationStatus.Shortlisted,
        },
      );
    }

    // All guards passed — insert interview + update status in one transaction.
    const interview = await this.transaction(async (client: PoolClient) => {
      // INSERT interviews row
      const newInterview = await this.queryOneWithClient<Interview>(
        client,
        `INSERT INTO interviews (application_id, scheduled_at, mode, location_or_link)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [applicationId, dto.scheduledAt, dto.mode, dto.locationOrLink],
      );

      // UPDATE application status → Interview_Scheduled
      await this.queryWithClient(
        client,
        `UPDATE applications
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id         = $2`,
        [ApplicationStatus.InterviewScheduled, applicationId],
      );

      // In-app notification for the student (Requirement 9.1)
      await this.queryWithClient(
        client,
        `INSERT INTO notifications (user_id, event_type, payload)
         VALUES ($1, 'INTERVIEW_SCHEDULED', $2::jsonb)`,
        [
          existing.student_user_id,
          JSON.stringify({
            applicationId,
            listingId: existing.listing_id,
            listingTitle: existing.listing_title,
            newStatus: ApplicationStatus.InterviewScheduled,
            interviewDetails: {
              scheduledAt: dto.scheduledAt,
              mode: dto.mode,
              locationOrLink: dto.locationOrLink,
            },
            message: 'An interview has been scheduled for your application.',
          }),
        ],
      );

      return newInterview!;
    });

    // Enqueue email notification for the student outside the transaction
    // so that a queue failure cannot roll back the DB changes.
    try {
      await enqueueEmail({
        type: 'INTERVIEW_SCHEDULED',
        userId: existing.student_user_id,
        email: existing.student_email,
        applicationId,
        interviewDetails: {
          scheduledAt: dto.scheduledAt,
          mode: dto.mode,
          locationOrLink: dto.locationOrLink,
        },
      } as unknown as EmailJobData);
    } catch (queueErr) {
      console.error('[interview] Failed to enqueue INTERVIEW_SCHEDULED notification:', queueErr);
    }

    return interview;
  }

  // -------------------------------------------------------------------------
  // getInterview
  // -------------------------------------------------------------------------

  /**
   * Return the interview record for the given application, or null if none
   * exists.
   *
   * @param applicationId  applications.id
   */
  async getInterview(applicationId: string): Promise<Interview | null> {
    return this.queryOne<Interview>(
      `SELECT * FROM interviews WHERE application_id = $1`,
      [applicationId],
    );
  }
}

// Singleton instance
export const interviewService = new InterviewService();
