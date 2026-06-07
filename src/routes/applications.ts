/**
 * Application Routes
 *
 * Tasks 10.1, 10.5, 10.7, 11.1, 11.2
 *
 * Student endpoints (require Student JWT):
 *   POST   /listings/:id/apply          — submit application        (Req 6.1–6.4)
 *   GET    /students/me/applications    — list own applications      (Req 6.5)
 *   DELETE /applications/:id           — withdraw application        (Req 6.6, 6.7)
 *   POST   /applications/:id/accept    — accept offer               (Req 7.6)
 *   POST   /applications/:id/reject-offer — reject offer            (Req 7.7)
 *
 * Employer endpoints (require Employer JWT):
 *   GET    /listings/:id/applications  — list applications for listing (Req 7.1, 7.8)
 *   PUT    /applications/:id/status    — update application status    (Req 7.2, 7.8)
 *   POST   /applications/:id/interview — schedule interview           (Req 7.3, 7.4)
 *   POST   /applications/:id/offer     — extend offer                 (Req 7.5)
 *
 * Standard error shape: { error: { code, message, details? } }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/authenticate';
import { UserRole, ApplicationStatus, InterviewMode } from '../types';
import { applicationService, AppFilterDTO } from '../services/applicationService';
import { interviewService, ScheduleInterviewDTO } from '../services/interviewService';
import { offerService, OfferDTO } from '../services/offerService';

// ---------------------------------------------------------------------------
// Helper
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
// Zod schema for PUT /applications/:id/status body
// ---------------------------------------------------------------------------

const updateStatusSchema = z.object({
  status: z.nativeEnum(ApplicationStatus),
});

// ---------------------------------------------------------------------------
// Zod schema for POST /applications/:id/interview body
// ---------------------------------------------------------------------------

const scheduleInterviewSchema = z.object({
  // Accept both full ISO-8601 and datetime-local format (YYYY-MM-DDTHH:MM)
  scheduledAt: z.string().min(10).refine(
    (v) => !isNaN(new Date(v).getTime()),
    { message: 'scheduledAt must be a valid date-time string' }
  ),
  mode: z.enum(['online', 'in-person']),
  locationOrLink: z.string().min(1, 'locationOrLink is required').max(500),
});

// ---------------------------------------------------------------------------
// Zod schema for POST /applications/:id/offer body
// ---------------------------------------------------------------------------

const extendOfferSchema = z.object({
  startDate: z.string().min(1, 'startDate is required'),
  durationWeeks: z.number().int().min(1),
  stipend: z.number().nonnegative().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Zod schema for GET /listings/:id/applications query parameters
// ---------------------------------------------------------------------------

const appFilterSchema = z.object({
  status:      z.nativeEnum(ApplicationStatus).optional(),
  institution: z.string().optional(),
  sortBy:      z.enum(['submittedAt', 'gpa']).optional(),
  sortOrder:   z.enum(['asc', 'desc']).optional(),
  page:        z.coerce.number().int().min(1).optional().default(1),
  pageSize:    z.coerce.number().int().min(1).max(100).optional().default(20),
});

// ===========================================================================
// Listings-scoped application router
// Mounted at /listings in index.ts — provides:
//   POST /listings/:id/apply
//   GET  /listings/:id/applications
// ===========================================================================

export const listingApplicationsRouter = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// POST /listings/:id/apply
// ---------------------------------------------------------------------------

/**
 * Submit an application for the specified listing.
 *
 * Guards enforced by ApplicationService.submitApplication():
 *   - Student profile completion ≥ 60 %  → 422 PROFILE_INCOMPLETE
 *   - Listing is `published`              → 422 LISTING_CLOSED
 *   - Deadline has not passed             → 422 DEADLINE_PASSED
 *   - No duplicate application            → 409 DUPLICATE_APPLICATION
 *
 * Success (201): Application
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
listingApplicationsRouter.post(
  '/:id/apply',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const application = await applicationService.submitApplication(
        req.user!.userId,
        req.params.id,
      );
      res.status(201).json(application);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /listings/:id/applications
// ---------------------------------------------------------------------------

/**
 * Return all applications for the specified listing (employer view).
 *
 * Supports query filters:
 *   - status       — filter by ApplicationStatus
 *   - institution  — filter by student institution (partial match)
 *   - sortBy       — 'submittedAt' | 'gpa'  (default: submittedAt)
 *   - sortOrder    — 'asc' | 'desc'          (default: desc)
 *   - page         — page number (default: 1)
 *   - pageSize     — items per page (default: 20, max: 100)
 *
 * Success (200): PaginatedResult<ApplicationWithStudentDetails>
 * Errors:
 *   401 UNAUTHORIZED        — missing / invalid access token
 *   403 FORBIDDEN           — caller is not an employer
 *   404 LISTING_NOT_FOUND   — listing does not exist or belongs to another employer
 *   422 VALIDATION_ERROR    — invalid query parameters
 *
 * Requirements: 7.1, 7.8
 */
listingApplicationsRouter.get(
  '/:id/applications',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = appFilterSchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.flatten()));
        return;
      }

      const filters: AppFilterDTO = parsed.data;

      const result = await applicationService.getApplicationsByListing(
        req.params.id,
        req.user!.userId,
        filters,
      );

      res.status(200).json(result);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ===========================================================================
// Student applications router
// Mounted at /students in index.ts — provides:
//   GET /students/me/applications
// ===========================================================================

export const studentApplicationsRouter = Router();

// ---------------------------------------------------------------------------
// GET /students/me/applications
// ---------------------------------------------------------------------------

/**
 * Return all applications submitted by the authenticated student, with current
 * status and listing title, ordered by most recently submitted first.
 *
 * Success (200): Array of Application & { listing_title: string }
 * Errors:
 *   401 UNAUTHORIZED      — missing / invalid access token
 *   403 FORBIDDEN         — caller is not a student
 *   404 PROFILE_NOT_FOUND — no student profile found for this user
 *
 * Requirement: 6.5
 */
studentApplicationsRouter.get(
  '/me/applications',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const applications = await applicationService.getApplicationsByStudent(
        req.user!.userId,
      );
      res.status(200).json(applications);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ===========================================================================
// Applications router (standalone)
// Mounted at /applications in index.ts — provides:
//   DELETE /applications/:id
//   PUT    /applications/:id/status
// ===========================================================================

export const applicationsRouter = Router();

// ---------------------------------------------------------------------------
// DELETE /applications/:id
// ---------------------------------------------------------------------------

/**
 * Withdraw the specified application.
 *
 * Allowed only when the application status is `Submitted` or `Under_Review`;
 * all other statuses return 422 WITHDRAWAL_NOT_ALLOWED.
 *
 * On success transitions status → Withdrawn and enqueues an employer
 * notification.
 *
 * Success (200): Application (with status = Withdrawn)
 * Errors:
 *   401 UNAUTHORIZED           — missing / invalid access token
 *   403 FORBIDDEN              — caller is not a student
 *   404 APPLICATION_NOT_FOUND  — application does not exist or belongs to
 *                                another student
 *   422 WITHDRAWAL_NOT_ALLOWED — current status does not permit withdrawal
 *
 * Requirements: 6.6, 6.7
 */
applicationsRouter.delete(
  '/:id',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const application = await applicationService.withdrawApplication(
        req.params.id,
        req.user!.userId,
      );
      res.status(200).json(application);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /applications/:id/status
// ---------------------------------------------------------------------------

/**
 * Update the status of an application by advancing the state machine.
 *
 * The transition table is enforced server-side. An invalid transition returns:
 *   422 INVALID_STATUS_TRANSITION  — with `allowedNextStatuses` in details
 *
 * On a valid transition:
 *  - Updates the application status in the DB
 *  - Writes an in-app notification for the student
 *  - Enqueues an email notification for the student
 *  - On Accepted: increments listing.accepted_count
 *
 * Body: { status: ApplicationStatus }
 *
 * Success (200): Application
 * Errors:
 *   401 UNAUTHORIZED                — missing / invalid access token
 *   403 FORBIDDEN                   — caller is not an employer
 *   404 APPLICATION_NOT_FOUND       — application does not exist
 *   422 VALIDATION_ERROR            — invalid request body
 *   422 INVALID_STATUS_TRANSITION   — transition not permitted
 *
 * Requirements: 7.2, 7.8
 */
applicationsRouter.put(
  '/:id/status',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(
            errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()),
          );
        return;
      }

      const application = await applicationService.updateStatus(
        req.params.id,
        req.user!.userId,
        parsed.data.status,
      );

      res.status(200).json(application);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /applications/:id/interview
// ---------------------------------------------------------------------------

/**
 * Schedule an interview for a Shortlisted application.
 *
 * Validates that the listing belongs to the authenticated employer and that
 * the application is currently in `Shortlisted` status.
 *
 * Within a single DB transaction: inserts an `interviews` row and transitions
 * the application to `Interview_Scheduled`.
 *
 * Enqueues an INTERVIEW_SCHEDULED notification for the student.
 *
 * Body: { scheduledAt: ISO-8601 string, mode: 'online' | 'in-person', locationOrLink: string }
 *
 * Success (201): Interview
 * Errors:
 *   401 UNAUTHORIZED                — missing / invalid access token
 *   403 FORBIDDEN                   — caller is not the employer who owns the listing
 *   404 APPLICATION_NOT_FOUND       — application does not exist
 *   422 VALIDATION_ERROR            — invalid request body
 *   422 INVALID_STATUS_TRANSITION   — application is not Shortlisted
 *
 * Requirements: 7.3, 7.4
 */
applicationsRouter.post(
  '/:id/interview',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = scheduleInterviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(
            errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()),
          );
        return;
      }

      const dto: ScheduleInterviewDTO = {
        scheduledAt: new Date(parsed.data.scheduledAt),
        mode: parsed.data.mode as InterviewMode,
        locationOrLink: parsed.data.locationOrLink,
      };

      const interview = await interviewService.scheduleInterview(
        req.params.id,
        req.user!.userId,
        dto,
      );

      res.status(201).json(interview);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /applications/:id/offer
// ---------------------------------------------------------------------------

/**
 * Extend an internship offer for an application in `Interview_Scheduled` status.
 *
 * Validates employer ownership of the listing and status guard.
 * Within a single DB transaction: inserts an `offers` row and transitions the
 * application to `Offered`.
 *
 * Enqueues an OFFER_RECEIVED notification for the student.
 *
 * Body: { startDate: string (YYYY-MM-DD), durationWeeks: number, stipend?: number | null }
 *
 * Success (201): Offer
 * Errors:
 *   401 UNAUTHORIZED                — missing / invalid access token
 *   403 FORBIDDEN                   — caller is not the employer who owns the listing
 *   404 APPLICATION_NOT_FOUND       — application does not exist
 *   422 VALIDATION_ERROR            — invalid request body
 *   422 INVALID_STATUS_TRANSITION   — application is not Interview_Scheduled
 *
 * Requirements: 7.5
 */
applicationsRouter.post(
  '/:id/offer',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = extendOfferSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(
            errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()),
          );
        return;
      }

      const dto: OfferDTO = {
        startDate: parsed.data.startDate,
        durationWeeks: parsed.data.durationWeeks,
        stipend: parsed.data.stipend ?? null,
      };

      const offer = await offerService.extendOffer(
        req.params.id,
        req.user!.userId,
        dto,
      );

      res.status(201).json(offer);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /applications/:id/accept
// ---------------------------------------------------------------------------

/**
 * Accept an offer for an application in `Offered` status.
 *
 * Transitions the application to `Accepted`, increments `listings.accepted_count`,
 * and enqueues an employer notification.
 * If `accepted_count >= openings`, triggers listing closure.
 *
 * Success (200): Application (with status = Accepted)
 * Errors:
 *   401 UNAUTHORIZED                — missing / invalid access token
 *   403 FORBIDDEN                   — caller is not a student
 *   404 APPLICATION_NOT_FOUND       — application does not exist or belongs to
 *                                     another student
 *   422 INVALID_STATUS_TRANSITION   — application is not Offered
 *
 * Requirements: 7.6
 */
applicationsRouter.post(
  '/:id/accept',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const application = await offerService.acceptOffer(
        req.params.id,
        req.user!.userId,
      );
      res.status(200).json(application);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /applications/:id/reject-offer
// ---------------------------------------------------------------------------

/**
 * Reject an offer for an application in `Offered` status.
 *
 * Transitions the application to `Rejected` and enqueues an employer
 * notification.
 *
 * Success (200): Application (with status = Rejected)
 * Errors:
 *   401 UNAUTHORIZED                — missing / invalid access token
 *   403 FORBIDDEN                   — caller is not a student
 *   404 APPLICATION_NOT_FOUND       — application does not exist or belongs to
 *                                     another student
 *   422 INVALID_STATUS_TRANSITION   — application is not Offered
 *
 * Requirements: 7.7
 */
applicationsRouter.post(
  '/:id/reject-offer',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const application = await offerService.rejectOffer(
        req.params.id,
        req.user!.userId,
      );
      res.status(200).json(application);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);
