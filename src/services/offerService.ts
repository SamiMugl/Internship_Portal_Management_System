/**
 * OfferService
 *
 * Handles offer extension and acceptance/rejection:
 *   - extendOffer    — employer inserts an `offers` row and transitions the
 *                      application to `Offered`; enqueues student notification
 *   - acceptOffer    — student transitions application to `Accepted`, increments
 *                      `listings.accepted_count`, triggers listing closure if
 *                      capacity is reached; enqueues employer notification
 *   - rejectOffer    — student transitions application to `Rejected`; enqueues
 *                      employer notification
 *
 * Requirements: 7.5, 7.6, 7.7
 */

import { PoolClient } from 'pg';
import { BaseRepository } from '../database/baseRepository';
import { Application, ApplicationStatus, Listing, Offer } from '../types';
import { AppError } from './authService';
import { enqueueEmail, EmailJobData } from '../queues/emailQueue';
import { listingService } from './listingService';

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface OfferDTO {
  startDate: Date | string;
  durationWeeks: number;
  stipend?: number | null;
}

// ---------------------------------------------------------------------------
// OfferService
// ---------------------------------------------------------------------------

export class OfferService extends BaseRepository {
  // -------------------------------------------------------------------------
  // extendOffer
  // -------------------------------------------------------------------------

  /**
   * Extend an offer for an application that is in `Interview_Scheduled` status.
   *
   * Validations (in order):
   *  1. Application exists.
   *  2. The listing is owned by the authenticated employer. → 403 FORBIDDEN
   *  3. Current status is `Interview_Scheduled`.           → 422 INVALID_STATUS_TRANSITION
   *
   * On success (inside one DB transaction):
   *  - INSERT offers row
   *  - UPDATE application status → Offered
   *  - INSERT in-app notification for the student
   *
   * Then (outside the transaction):
   *  - Enqueue OFFER_RECEIVED email notification for the student
   *
   * Requirements: 7.5
   *
   * @param applicationId  applications.id
   * @param employerUserId users.id of the authenticated employer
   * @param dto            offer details
   */
  async extendOffer(
    applicationId: string,
    employerUserId: string,
    dto: OfferDTO,
  ): Promise<Offer> {
    // 1. Fetch the application with ownership and student contact info.
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
        'You do not have permission to extend an offer for this application.',
      );
    }

    // 3. Guard: application must be Interview_Scheduled.
    if (existing.status !== ApplicationStatus.InterviewScheduled) {
      throw new AppError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Cannot extend an offer for an application with status '${existing.status}'. Application must be in 'Interview_Scheduled' status.`,
        {
          currentStatus: existing.status,
          requiredStatus: ApplicationStatus.InterviewScheduled,
        },
      );
    }

    // All guards passed — insert offer + update status in one transaction.
    const offer = await this.transaction(async (client: PoolClient) => {
      // INSERT offers row
      const newOffer = await this.queryOneWithClient<Offer>(
        client,
        `INSERT INTO offers (application_id, start_date, duration_weeks, stipend)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [applicationId, dto.startDate, dto.durationWeeks, dto.stipend ?? null],
      );

      // UPDATE application status → Offered
      await this.queryWithClient(
        client,
        `UPDATE applications
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id         = $2`,
        [ApplicationStatus.Offered, applicationId],
      );

      // In-app notification for the student (Requirement 9.1)
      await this.queryWithClient(
        client,
        `INSERT INTO notifications (user_id, event_type, payload)
         VALUES ($1, 'OFFER_RECEIVED', $2::jsonb)`,
        [
          existing.student_user_id,
          JSON.stringify({
            applicationId,
            listingId: existing.listing_id,
            listingTitle: existing.listing_title,
            newStatus: ApplicationStatus.Offered,
            offerDetails: {
              startDate: dto.startDate,
              durationWeeks: dto.durationWeeks,
              stipend: dto.stipend ?? null,
            },
            message: 'You have received an internship offer.',
          }),
        ],
      );

      return newOffer!;
    });

    // Enqueue email notification for the student outside the transaction.
    try {
      await enqueueEmail({
        type: 'OFFER_RECEIVED',
        userId: existing.student_user_id,
        email: existing.student_email,
        applicationId,
        offerDetails: {
          startDate: dto.startDate,
          durationWeeks: dto.durationWeeks,
          stipend: dto.stipend ?? null,
        },
      } as unknown as EmailJobData);
    } catch (queueErr) {
      console.error('[offer] Failed to enqueue OFFER_RECEIVED notification:', queueErr);
    }

    return offer;
  }

  // -------------------------------------------------------------------------
  // acceptOffer
  // -------------------------------------------------------------------------

  /**
   * Accept an offer for an application that is in `Offered` status.
   *
   * Validations (in order):
   *  1. Application exists and belongs to the authenticated student. → 404
   *  2. Current status is `Offered`. → 422 INVALID_STATUS_TRANSITION
   *
   * On success (inside one DB transaction):
   *  - UPDATE application status → Accepted
   *  - INCREMENT listings.accepted_count atomically
   *  - INSERT in-app notification for the employer
   *
   * Then (outside the transaction):
   *  - Enqueue APPLICATION_STATUS_CHANGED email for the employer
   *  - If accepted_count >= openings, trigger listingService.closeExpiredListings()
   *    (which handles the idempotent closure and student notifications)
   *
   * Requirements: 7.6
   *
   * @param applicationId  applications.id
   * @param studentUserId  users.id of the authenticated student
   */
  async acceptOffer(applicationId: string, studentUserId: string): Promise<Application> {
    // 1. Fetch the application, ensuring student ownership.
    const existing = await this.queryOne<
      Application & {
        student_profile_id: string;
        listing_id: string;
        listing_title: string;
        employer_user_id: string;
        employer_email: string;
        openings: number;
      }
    >(
      `SELECT a.*,
              sp.id        AS student_profile_id,
              l.id         AS listing_id,
              l.title      AS listing_title,
              l.openings,
              ep_u.id      AS employer_user_id,
              ep_u.email   AS employer_email
       FROM   applications a
       JOIN   student_profiles  sp   ON sp.id  = a.student_id
       JOIN   users             sp_u ON sp_u.id = sp.user_id
       JOIN   listings          l    ON l.id   = a.listing_id
       JOIN   employer_profiles ep   ON ep.id  = l.employer_id
       JOIN   users             ep_u ON ep_u.id = ep.user_id
       WHERE  a.id      = $1
         AND  sp_u.id   = $2`,
      [applicationId, studentUserId],
    );

    if (!existing) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    }

    // 2. Guard: application must be Offered.
    if (existing.status !== ApplicationStatus.Offered) {
      throw new AppError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Cannot accept an offer for an application with status '${existing.status}'. Application must be in 'Offered' status.`,
        {
          currentStatus: existing.status,
          requiredStatus: ApplicationStatus.Offered,
        },
      );
    }

    // All guards passed — update status + increment accepted_count in one transaction.
    let newAcceptedCount = 0;
    const updated = await this.transaction(async (client: PoolClient) => {
      // UPDATE application status → Accepted
      const app = await this.queryOneWithClient<Application>(
        client,
        `UPDATE applications
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id         = $2
         RETURNING *`,
        [ApplicationStatus.Accepted, applicationId],
      );

      // INCREMENT listings.accepted_count atomically and return the new value.
      const listingRow = await this.queryOneWithClient<{ accepted_count: number }>(
        client,
        `UPDATE listings
         SET    accepted_count = accepted_count + 1,
                updated_at     = NOW()
         WHERE  id = $1
         RETURNING accepted_count`,
        [existing.listing_id],
      );

      newAcceptedCount = listingRow?.accepted_count ?? 0;

      // In-app notification for the employer (Requirement 9.1)
      await this.queryWithClient(
        client,
        `INSERT INTO notifications (user_id, event_type, payload)
         VALUES ($1, 'APPLICATION_STATUS_CHANGED', $2::jsonb)`,
        [
          existing.employer_user_id,
          JSON.stringify({
            applicationId,
            listingId: existing.listing_id,
            listingTitle: existing.listing_title,
            previousStatus: ApplicationStatus.Offered,
            newStatus: ApplicationStatus.Accepted,
            message: 'A student has accepted your internship offer.',
          }),
        ],
      );

      return app!;
    });

    // Enqueue employer email notification outside the transaction.
    try {
      await enqueueEmail({
        type: 'APPLICATION_STATUS_CHANGED',
        userId: existing.employer_user_id,
        email: existing.employer_email,
        applicationId,
        listingId: existing.listing_id,
        listingTitle: existing.listing_title,
        newStatus: ApplicationStatus.Accepted,
      } as unknown as EmailJobData);
    } catch (queueErr) {
      console.error('[offer] Failed to enqueue acceptance notification for employer:', queueErr);
    }

    // If accepted_count >= openings, trigger listing closure (Requirement 5.6).
    if (newAcceptedCount >= existing.openings) {
      try {
        await listingService.closeExpiredListings();
      } catch (closeErr) {
        console.error(
          '[offer] Failed to trigger closeExpiredListings after acceptance:',
          closeErr,
        );
      }
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // rejectOffer
  // -------------------------------------------------------------------------

  /**
   * Reject an offer for an application that is in `Offered` status.
   *
   * Validations (in order):
   *  1. Application exists and belongs to the authenticated student. → 404
   *  2. Current status is `Offered`. → 422 INVALID_STATUS_TRANSITION
   *
   * On success (inside one DB transaction):
   *  - UPDATE application status → Rejected
   *  - INSERT in-app notification for the employer
   *
   * Then (outside the transaction):
   *  - Enqueue APPLICATION_STATUS_CHANGED email for the employer
   *
   * Requirements: 7.7
   *
   * @param applicationId  applications.id
   * @param studentUserId  users.id of the authenticated student
   */
  async rejectOffer(applicationId: string, studentUserId: string): Promise<Application> {
    // 1. Fetch the application, ensuring student ownership.
    const existing = await this.queryOne<
      Application & {
        listing_id: string;
        listing_title: string;
        employer_user_id: string;
        employer_email: string;
      }
    >(
      `SELECT a.*,
              l.id         AS listing_id,
              l.title      AS listing_title,
              ep_u.id      AS employer_user_id,
              ep_u.email   AS employer_email
       FROM   applications a
       JOIN   student_profiles  sp   ON sp.id  = a.student_id
       JOIN   users             sp_u ON sp_u.id = sp.user_id
       JOIN   listings          l    ON l.id   = a.listing_id
       JOIN   employer_profiles ep   ON ep.id  = l.employer_id
       JOIN   users             ep_u ON ep_u.id = ep.user_id
       WHERE  a.id      = $1
         AND  sp_u.id   = $2`,
      [applicationId, studentUserId],
    );

    if (!existing) {
      throw new AppError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    }

    // 2. Guard: application must be Offered.
    if (existing.status !== ApplicationStatus.Offered) {
      throw new AppError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Cannot reject an offer for an application with status '${existing.status}'. Application must be in 'Offered' status.`,
        {
          currentStatus: existing.status,
          requiredStatus: ApplicationStatus.Offered,
        },
      );
    }

    // Update status + notify employer in one transaction.
    const updated = await this.transaction(async (client: PoolClient) => {
      // UPDATE application status → Rejected
      const app = await this.queryOneWithClient<Application>(
        client,
        `UPDATE applications
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id         = $2
         RETURNING *`,
        [ApplicationStatus.Rejected, applicationId],
      );

      // In-app notification for the employer (Requirement 9.1)
      await this.queryWithClient(
        client,
        `INSERT INTO notifications (user_id, event_type, payload)
         VALUES ($1, 'APPLICATION_STATUS_CHANGED', $2::jsonb)`,
        [
          existing.employer_user_id,
          JSON.stringify({
            applicationId,
            listingId: existing.listing_id,
            listingTitle: existing.listing_title,
            previousStatus: ApplicationStatus.Offered,
            newStatus: ApplicationStatus.Rejected,
            message: 'A student has rejected your internship offer.',
          }),
        ],
      );

      return app!;
    });

    // Enqueue employer email notification outside the transaction.
    try {
      await enqueueEmail({
        type: 'APPLICATION_STATUS_CHANGED',
        userId: existing.employer_user_id,
        email: existing.employer_email,
        applicationId,
        listingId: existing.listing_id,
        listingTitle: existing.listing_title,
        newStatus: ApplicationStatus.Rejected,
      } as unknown as EmailJobData);
    } catch (queueErr) {
      console.error('[offer] Failed to enqueue rejection notification for employer:', queueErr);
    }

    return updated;
  }
}

// Singleton instance
export const offerService = new OfferService();
