/**
 * NotificationService
 *
 * Provides business logic for creating and querying in-app notifications:
 *   - createNotification  — writes a notification row synchronously;
 *                           accepts an optional PoolClient for transactional use
 *   - markRead            — marks a single notification as read for a given user
 *   - getUnreadCount      — returns the count of unread notifications for a user
 *   - getNotifications    — returns a paginated list of notifications sorted by
 *                           created_at DESC
 *   - enqueueEmail        — maps a high-level NotificationEvent to an email job
 *                           payload and dispatches it to the Bull email queue
 *
 * Design notes:
 *  • createNotification accepts an optional `client` so callers inside a DB
 *    transaction (e.g. ApplicationService, InterviewService) can write the
 *    notification row atomically with the triggering event.
 *  • enqueueEmail failures are intentionally non-fatal — they are logged but
 *    never propagate to the caller so email delivery failures cannot affect
 *    in-app notification creation.
 *  • All queries use parameterised values — never string interpolation.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { PoolClient } from 'pg';
import { BaseRepository } from '../database/baseRepository';
import { ApplicationStatus, Notification, NotificationEventType, PaginatedResult } from '../types';
import { AppError } from './authService';
import {
  enqueueEmail,
  AccountVerifiedJobData,
  AccountApprovedJobData,
  AccountRejectedJobData,
  ShortlistNotificationJobData,
  InterviewScheduledNotifyJobData,
  OfferReceivedNotifyJobData,
} from '../queues/emailQueue';

// ---------------------------------------------------------------------------
// NotificationEvent — high-level event descriptor consumed by enqueueEmail()
// ---------------------------------------------------------------------------

/**
 * Union of all event types that can trigger an email notification.
 *
 * Services pass one of these event descriptors to `notificationService.enqueueEmail()`.
 * The method resolves any referenced entity IDs to concrete field values
 * (user email, name, listing title, etc.) before dispatching the job.
 *
 * Requirement: 9.2
 */
export type NotificationEvent =
  | { type: 'ACCOUNT_VERIFIED'; userId: string }
  | { type: 'ACCOUNT_APPROVED'; userId: string }
  | { type: 'ACCOUNT_REJECTED'; userId: string; reason: string }
  | { type: 'APPLICATION_STATUS_CHANGED'; applicationId: string; newStatus: ApplicationStatus }
  | { type: 'INTERVIEW_SCHEDULED'; applicationId: string }
  | { type: 'OFFER_RECEIVED'; applicationId: string }
  | { type: 'LISTING_CLOSED'; listingId: string; affectedStudentIds: string[] };

// ---------------------------------------------------------------------------
// Response shape — camelCase fields for API consumers
// ---------------------------------------------------------------------------

/**
 * The shape returned to API consumers.
 * Adds `isRead` as a camelCase alias for `is_read` to visually distinguish
 * read vs. unread notifications in the response payload.
 *
 * Requirements: 9.3
 */
export interface NotificationResponse {
  id: string;
  userId: string;
  eventType: NotificationEventType | string;
  payload: Record<string, unknown>;
  /** true = already read; false = unread (badge-worthy) */
  isRead: boolean;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Internal DB row shape
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  user_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function toResponse(row: NotificationRow): NotificationResponse {
  return {
    id: row.id,
    userId: row.user_id,
    eventType: row.event_type as NotificationEventType,
    payload: row.payload,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

export class NotificationService extends BaseRepository {
  // -------------------------------------------------------------------------
  // createNotification
  // -------------------------------------------------------------------------

  /**
   * Write a notification row synchronously.
   *
   * When a `client` (PoolClient) is provided the INSERT runs inside the
   * caller's existing transaction, allowing the notification and its
   * triggering event to be committed (or rolled back) atomically.
   *
   * When no `client` is provided the INSERT is executed against the pool
   * directly (auto-committed).
   *
   * Requirement: 9.1
   *
   * @param userId    users.id of the recipient
   * @param eventType one of the NotificationEventType literals (or any string)
   * @param payload   arbitrary JSON payload describing the event
   * @param client    optional PoolClient for transactional writes
   */
  async createNotification(
    userId: string,
    eventType: NotificationEventType | string,
    payload: Record<string, unknown>,
    client?: PoolClient,
  ): Promise<Notification> {
    const sql = `
      INSERT INTO notifications (user_id, event_type, payload)
      VALUES ($1, $2, $3::jsonb)
      RETURNING *
    `;
    const params = [userId, eventType, JSON.stringify(payload)];

    let row: NotificationRow | null;

    if (client) {
      row = await this.queryOneWithClient<NotificationRow>(client, sql, params);
    } else {
      row = await this.queryOne<NotificationRow>(sql, params);
    }

    if (!row) {
      throw new AppError(500, 'NOTIFICATION_CREATE_FAILED', 'Failed to create notification.');
    }

    // Return using the raw Notification shape (matches DB row)
    return {
      id: row.id,
      user_id: row.user_id,
      event_type: row.event_type as NotificationEventType,
      payload: row.payload,
      is_read: row.is_read,
      created_at: row.created_at,
    };
  }

  // -------------------------------------------------------------------------
  // markRead
  // -------------------------------------------------------------------------

  /**
   * Mark the specified notification as read.
   *
   * Returns the updated notification (with isRead = true) in the API-friendly
   * response shape.
   *
   * Requirement: 9.3
   *
   * @param notificationId  notifications.id
   * @param userId          users.id of the authenticated user (ownership check)
   */
  async markRead(
    notificationId: string,
    userId: string,
  ): Promise<NotificationResponse> {
    const row = await this.queryOne<NotificationRow>(
      `UPDATE notifications
       SET    is_read = TRUE
       WHERE  id      = $1
         AND  user_id = $2
       RETURNING *`,
      [notificationId, userId],
    );

    if (!row) {
      throw new AppError(
        404,
        'NOTIFICATION_NOT_FOUND',
        'Notification not found or does not belong to you.',
      );
    }

    return toResponse(row);
  }

  // -------------------------------------------------------------------------
  // getUnreadCount
  // -------------------------------------------------------------------------

  /**
   * Return the count of unread notifications for the given user.
   *
   * Used to drive the navigation-bar badge.
   *
   * Requirement: 9.4
   *
   * @param userId  users.id of the authenticated user
   */
  async getUnreadCount(userId: string): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM   notifications
       WHERE  user_id  = $1
         AND  is_read  = FALSE`,
      [userId],
    );

    return parseInt(row?.count ?? '0', 10);
  }

  // -------------------------------------------------------------------------
  // getNotifications
  // -------------------------------------------------------------------------

  /**
   * Return a paginated list of all notifications for the given user,
   * sorted by created_at DESC (most recent first).
   *
   * Each item in the result includes an `isRead` boolean field so consumers
   * can visually distinguish read from unread notifications.
   *
   * Requirement: 9.5
   *
   * @param userId    users.id of the authenticated user
   * @param page      1-based page number (default 1)
   * @param pageSize  items per page (default 20, max 100)
   */
  async getNotifications(
    userId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<NotificationResponse>> {
    const safePage     = Math.max(1, page);
    const safePageSize = Math.min(100, Math.max(1, pageSize));
    const offset       = (safePage - 1) * safePageSize;

    // Total count for pagination metadata
    const countRow = await this.queryOne<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM   notifications
       WHERE  user_id = $1`,
      [userId],
    );
    const total = parseInt(countRow?.total ?? '0', 10);

    // Paginated data
    const rows = await this.query<NotificationRow>(
      `SELECT *
       FROM   notifications
       WHERE  user_id = $1
       ORDER  BY created_at DESC
       LIMIT  $2
       OFFSET $3`,
      [userId, safePageSize, offset],
    );

    return {
      data: rows.map(toResponse),
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize),
    };
  }

  // -------------------------------------------------------------------------
  // enqueueEmail
  // -------------------------------------------------------------------------

  /**
   * Map a high-level NotificationEvent to the appropriate email job payload
   * and dispatch it to the Bull email queue.
   *
   * Email delivery failures are intentionally non-fatal:
   *  - Errors are caught and logged.
   *  - They never propagate to the caller so an email failure cannot affect
   *    in-app notification creation or any other synchronous DB writes.
   *
   * Bull handles at-least-once delivery: 3 attempts with exponential backoff
   * (1 s → 5 s → 25 s). Permanently failed jobs are logged by the queue's
   * `failed` event handler in emailQueue.ts.
   *
   * Requirement: 9.2
   *
   * @param event  The high-level notification event descriptor.
   */
  async enqueueEmail(event: NotificationEvent): Promise<void> {
    try {
      switch (event.type) {
        // ------------------------------------------------------------------
        // Account events — look up user name + email from `users` table
        // ------------------------------------------------------------------

        case 'ACCOUNT_VERIFIED': {
          const user = await this.queryOne<{ email: string; name: string }>(
            `SELECT u.email, COALESCE(sp.full_name, ep.contact_person, u.email) AS name
             FROM   users u
             LEFT JOIN student_profiles  sp ON sp.user_id = u.id
             LEFT JOIN employer_profiles ep ON ep.user_id = u.id
             WHERE  u.id = $1`,
            [event.userId],
          );
          if (!user) break;

          await enqueueEmail({
            type: 'ACCOUNT_VERIFIED',
            userId: event.userId,
            email: user.email,
            name:  user.name,
          } satisfies AccountVerifiedJobData);
          break;
        }

        case 'ACCOUNT_APPROVED': {
          const user = await this.queryOne<{ email: string; name: string }>(
            `SELECT u.email, COALESCE(ep.contact_person, u.email) AS name
             FROM   users u
             LEFT JOIN employer_profiles ep ON ep.user_id = u.id
             WHERE  u.id = $1`,
            [event.userId],
          );
          if (!user) break;

          await enqueueEmail({
            type: 'ACCOUNT_APPROVED',
            userId: event.userId,
            email: user.email,
            name:  user.name,
          } satisfies AccountApprovedJobData);
          break;
        }

        case 'ACCOUNT_REJECTED': {
          const user = await this.queryOne<{ email: string; name: string }>(
            `SELECT u.email, COALESCE(ep.contact_person, u.email) AS name
             FROM   users u
             LEFT JOIN employer_profiles ep ON ep.user_id = u.id
             WHERE  u.id = $1`,
            [event.userId],
          );
          if (!user) break;

          await enqueueEmail({
            type: 'ACCOUNT_REJECTED',
            userId: event.userId,
            email:  user.email,
            name:   user.name,
            reason: event.reason,
          } satisfies AccountRejectedJobData);
          break;
        }

        // ------------------------------------------------------------------
        // APPLICATION_STATUS_CHANGED — shortlist notification
        // Only enqueues email for Shortlisted status (Requirement 9.2)
        // ------------------------------------------------------------------

        case 'APPLICATION_STATUS_CHANGED': {
          if (event.newStatus !== ApplicationStatus.Shortlisted) break;

          const appData = await this.queryOne<{
            student_user_id: string;
            student_email: string;
            student_name: string;
            listing_title: string;
            company_name: string;
          }>(
            `SELECT sp_u.id         AS student_user_id,
                    sp_u.email      AS student_email,
                    sp.full_name    AS student_name,
                    l.title         AS listing_title,
                    ep.company_name AS company_name
             FROM   applications a
             JOIN   listings         l   ON l.id   = a.listing_id
             JOIN   employer_profiles ep  ON ep.id  = l.employer_id
             JOIN   student_profiles  sp  ON sp.id  = a.student_id
             JOIN   users             sp_u ON sp_u.id = sp.user_id
             WHERE  a.id = $1`,
            [event.applicationId],
          );
          if (!appData) break;

          await enqueueEmail({
            type:         'SHORTLIST_NOTIFICATION',
            userId:       appData.student_user_id,
            email:        appData.student_email,
            name:         appData.student_name,
            listingTitle: appData.listing_title,
            companyName:  appData.company_name,
          } satisfies ShortlistNotificationJobData);
          break;
        }

        // ------------------------------------------------------------------
        // INTERVIEW_SCHEDULED — interview details email to student
        // ------------------------------------------------------------------

        case 'INTERVIEW_SCHEDULED': {
          const appData = await this.queryOne<{
            student_user_id: string;
            student_email: string;
            student_name: string;
            listing_title: string;
            scheduled_at: Date;
            mode: string;
            location_or_link: string;
          }>(
            `SELECT sp_u.id              AS student_user_id,
                    sp_u.email           AS student_email,
                    sp.full_name         AS student_name,
                    l.title              AS listing_title,
                    i.scheduled_at,
                    i.mode,
                    i.location_or_link
             FROM   applications a
             JOIN   listings         l   ON l.id   = a.listing_id
             JOIN   student_profiles  sp  ON sp.id  = a.student_id
             JOIN   users             sp_u ON sp_u.id = sp.user_id
             JOIN   interviews        i   ON i.application_id = a.id
             WHERE  a.id = $1`,
            [event.applicationId],
          );
          if (!appData) break;

          await enqueueEmail({
            type:         'INTERVIEW_SCHEDULED_NOTIFY',
            userId:       appData.student_user_id,
            email:        appData.student_email,
            name:         appData.student_name,
            listingTitle: appData.listing_title,
            scheduledAt:  new Date(appData.scheduled_at).toISOString(),
            mode:         appData.mode,
            locationOrLink: appData.location_or_link,
          } satisfies InterviewScheduledNotifyJobData);
          break;
        }

        // ------------------------------------------------------------------
        // OFFER_RECEIVED — offer details email to student
        // ------------------------------------------------------------------

        case 'OFFER_RECEIVED': {
          const appData = await this.queryOne<{
            student_user_id: string;
            student_email: string;
            student_name: string;
            listing_title: string;
            start_date: string;
            duration_weeks: number;
            stipend: string | null;
          }>(
            `SELECT sp_u.id              AS student_user_id,
                    sp_u.email           AS student_email,
                    sp.full_name         AS student_name,
                    l.title              AS listing_title,
                    o.start_date,
                    o.duration_weeks,
                    o.stipend
             FROM   applications a
             JOIN   listings         l   ON l.id   = a.listing_id
             JOIN   student_profiles  sp  ON sp.id  = a.student_id
             JOIN   users             sp_u ON sp_u.id = sp.user_id
             JOIN   offers            o   ON o.application_id = a.id
             WHERE  a.id = $1`,
            [event.applicationId],
          );
          if (!appData) break;

          await enqueueEmail({
            type:          'OFFER_RECEIVED_NOTIFY',
            userId:        appData.student_user_id,
            email:         appData.student_email,
            name:          appData.student_name,
            listingTitle:  appData.listing_title,
            startDate:     appData.start_date,
            durationWeeks: appData.duration_weeks,
            stipend:       appData.stipend != null ? parseFloat(appData.stipend) : null,
          } satisfies OfferReceivedNotifyJobData);
          break;
        }

        // ------------------------------------------------------------------
        // LISTING_CLOSED — no email dispatched here; the listing service
        // enqueues the LISTING_CLOSED broadcast job directly using
        // affectedStudentIds.  Included for interface completeness.
        // ------------------------------------------------------------------

        case 'LISTING_CLOSED':
          // The listing service already enqueues the LISTING_CLOSED email
          // broadcast directly via enqueueEmail({ type: 'LISTING_CLOSED', … }).
          // Nothing to do here.
          break;

        default: {
          // Exhaustiveness check — TypeScript will flag missing cases.
          const _exhaustive: never = event;
          console.warn('[notification] Unknown NotificationEvent type:', (_exhaustive as NotificationEvent).type);
        }
      }
    } catch (err) {
      // Email failures are non-fatal: log and continue.
      console.error('[notification] Failed to enqueue email for event:', (event as NotificationEvent).type, err);
    }
  }
}

// Singleton instance
export const notificationService = new NotificationService();
