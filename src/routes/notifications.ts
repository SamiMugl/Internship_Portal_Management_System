/**
 * Notification Routes
 *
 * Task 13.1 — in-app notification creation and read-marking
 *
 * All routes require a valid access-token JWT (authenticate middleware).
 * No role restriction — any authenticated user can access their own notifications.
 *
 * Endpoints (mounted at /notifications in index.ts):
 *
 *   GET  /notifications
 *     — Return a paginated list of the caller's notifications, sorted by
 *       most recent first.  Each item exposes `isRead` so the client can
 *       visually distinguish read from unread items.
 *     — Query params: page (default 1), pageSize (default 20, max 100)
 *     — Success 200: PaginatedResult<NotificationResponse>
 *
 *   GET  /notifications/unread-count
 *     — Return the count of unread notifications for the caller.
 *     — Used to drive the navigation-bar badge.
 *     — Success 200: { count: number }
 *
 *   PUT  /notifications/:id/read
 *     — Mark a single notification as read.
 *     — Returns the updated notification (isRead = true).
 *     — Success 200: NotificationResponse
 *     — Errors:
 *         404 NOTIFICATION_NOT_FOUND — not found or belongs to another user
 *
 * Standard error shape: { error: { code, message, details? } }
 *
 * Requirements: 9.1, 9.3, 9.4, 9.5
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { notificationService } from '../services/notificationService';

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const notificationsRouter = Router();

// Apply authentication middleware to all notification routes
notificationsRouter.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorBody(
  code: string,
  message: string,
  details?: unknown,
): { error: { code: string; message: string; details?: unknown } } {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

function handleAppError(err: unknown, res: Response, next: NextFunction): void {
  const appErr = err as {
    code?: string;
    statusCode?: number;
    message?: string;
    details?: unknown;
  };
  if (appErr.statusCode && appErr.code) {
    res
      .status(appErr.statusCode)
      .json(errorBody(appErr.code, appErr.message ?? '', appErr.details));
    return;
  }
  next(err);
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const paginationSchema = z.object({
  page:     z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ---------------------------------------------------------------------------
// GET /notifications/unread-count
//
// NOTE: This route MUST be declared BEFORE GET /notifications/:id/read to
// prevent Express from treating "unread-count" as a path parameter value.
// ---------------------------------------------------------------------------

/**
 * Return the count of unread notifications for the authenticated user.
 *
 * Response: { count: number }
 *
 * Requirement: 9.4
 */
notificationsRouter.get(
  '/unread-count',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const count = await notificationService.getUnreadCount(req.user!.userId);
      res.status(200).json({ count });
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /notifications
// ---------------------------------------------------------------------------

/**
 * Return a paginated list of the caller's notifications, most recent first.
 *
 * Query params:
 *   page     — page number (default 1)
 *   pageSize — items per page (default 20, max 100)
 *
 * Response: PaginatedResult<NotificationResponse>
 *   Each notification includes `isRead: boolean` to visually distinguish
 *   read from unread items.
 *
 * Requirement: 9.5
 */
notificationsRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = paginationSchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.flatten()));
        return;
      }

      const { page, pageSize } = parsed.data;

      const result = await notificationService.getNotifications(
        req.user!.userId,
        page,
        pageSize,
      );

      res.status(200).json(result);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /notifications/:id/read
// ---------------------------------------------------------------------------

/**
 * Mark a notification as read and return the updated notification.
 *
 * The endpoint verifies that the notification belongs to the authenticated
 * user; it returns 404 NOTIFICATION_NOT_FOUND if the notification does not
 * exist or belongs to another user.
 *
 * Response: NotificationResponse (isRead = true)
 *
 * Requirement: 9.3
 */
notificationsRouter.put(
  '/:id/read',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const notification = await notificationService.markRead(
        req.params.id,
        req.user!.userId,
      );
      res.status(200).json(notification);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

export default notificationsRouter;
