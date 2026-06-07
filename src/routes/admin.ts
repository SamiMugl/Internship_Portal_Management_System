/**
 * Admin Routes — Listing moderation + Employer account moderation + Dashboard
 *
 * All routes require a valid Admin JWT (authenticate + authorize(Admin)).
 *
 *   GET  /admin/dashboard             — aggregate dashboard counts          (Req 8.1)
 *   GET  /admin/employers             — list all employer accounts           (Req 8.2)
 *   POST /admin/employers/:id/approve — approve a pending employer account   (Req 8.3)
 *   POST /admin/employers/:id/reject  — reject a pending employer account    (Req 8.3)
 *   GET  /admin/listings/pending      — list pending listings for review     (Req 4.2)
 *   POST /admin/listings/:id/approve  — approve a pending listing            (Req 4.2)
 *   POST /admin/listings/:id/reject   — reject a pending listing             (Req 4.3)
 *
 * Standard error shape: { error: { code, message, details? } }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/authenticate';
import { UserRole } from '../types';
import { listingService } from '../services/listingService';
import { adminService } from '../services/adminService';
import { reportService, ReportType } from '../services/reportService';

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
// Validation schemas
// ---------------------------------------------------------------------------

const rejectListingSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required.'),
});

const rejectEmployerSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required.'),
});

// ---------------------------------------------------------------------------
// Router — mounted at /admin
// ---------------------------------------------------------------------------

export const adminRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/dashboard — aggregate counts for the admin dashboard
// ---------------------------------------------------------------------------

/**
 * Return aggregate counts:
 *   - pendingEmployerAccounts
 *   - pendingListings
 *   - activeStudents
 *   - totalApplications
 *
 * Success (200): DashboardCounts
 * Errors:
 *   401 UNAUTHORIZED  — missing / invalid access token
 *   403 FORBIDDEN     — caller is not an admin
 *
 * Requirement 8.1
 */
adminRouter.get(
  '/dashboard',
  authenticate,
  authorize(UserRole.Admin),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const counts = await adminService.getDashboardCounts();
      res.status(200).json(counts);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/students — list all student accounts
// ---------------------------------------------------------------------------

adminRouter.get(
  '/students',
  authenticate,
  authorize(UserRole.Admin),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { BaseRepository } = await import('../database/baseRepository');
      const repo = new BaseRepository();
      const students = await repo.query<{
        id: string; email: string; status: string; created_at: string;
        full_name: string | null; institution: string | null; completion_pct: string | null;
      }>(
        `SELECT u.id, u.email, u.status, u.created_at,
                sp.full_name, sp.institution, sp.completion_pct
         FROM   users u
         LEFT JOIN student_profiles sp ON sp.user_id = u.id
         WHERE  u.role = 'student'
         ORDER  BY u.created_at DESC`,
      );
      res.status(200).json({ data: students });
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/applications — list all applications across all listings
// ---------------------------------------------------------------------------

adminRouter.get(
  '/applications',
  authenticate,
  authorize(UserRole.Admin),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { BaseRepository } = await import('../database/baseRepository');
      const repo = new BaseRepository();
      const apps = await repo.query<{
        id: string; status: string; submitted_at: string;
        student_name: string; student_email: string;
        listing_title: string; company_name: string;
      }>(
        `SELECT a.id, a.status, a.submitted_at,
                sp.full_name  AS student_name,
                u_s.email     AS student_email,
                l.title       AS listing_title,
                ep.company_name
         FROM   applications a
         JOIN   student_profiles sp  ON sp.id  = a.student_id
         JOIN   users           u_s ON u_s.id = sp.user_id
         JOIN   listings        l   ON l.id   = a.listing_id
         JOIN   employer_profiles ep ON ep.id = l.employer_id
         ORDER  BY a.submitted_at DESC`,
      );
      res.status(200).json({ data: apps, total: apps.length });
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/employers — list all employer accounts with approval status
// ---------------------------------------------------------------------------

/**
 * Return all employer profiles joined with their user record, including
 * email, user status, and approval_status.
 *
 * Success (200): EmployerWithUser[]
 * Errors:
 *   401 UNAUTHORIZED  — missing / invalid access token
 *   403 FORBIDDEN     — caller is not an admin
 *
 * Requirement 8.2
 */
adminRouter.get(
  '/employers',
  authenticate,
  authorize(UserRole.Admin),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const employers = await adminService.getEmployers();
      res.status(200).json(employers);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/employers/:id/approve — approve a pending employer account
// ---------------------------------------------------------------------------

/**
 * Approve an employer account in 'pending' approval_status:
 *   - Sets approval_status to 'approved' and users.status to 'active'
 *   - Writes an immutable audit log entry
 *   - Enqueues an ACCOUNT_APPROVED notification email
 *   - Creates an in-app notification
 *
 * Success (200): EmployerWithUser (with updated approval_status)
 * Errors:
 *   401 UNAUTHORIZED              — missing / invalid access token
 *   403 FORBIDDEN                 — caller is not an admin
 *   404 EMPLOYER_NOT_FOUND        — employer profile does not exist
 *   400 INVALID_STATUS_TRANSITION — already approved or rejected
 *
 * Requirement 8.3
 */
adminRouter.post(
  '/employers/:id/approve',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const employer = await adminService.approveEmployer(
        req.params.id,
        req.user!.userId,
      );
      res.status(200).json(employer);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/employers/:id/approve-link — one-click approve from email
// No JWT required — uses a time-limited signed token embedded in email
// ---------------------------------------------------------------------------

adminRouter.get(
  '/employers/:id/approve-link',
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Use the admin account directly for email-link approvals
      const adminRow = await adminService.getAdminUser();
      if (!adminRow) {
        res.status(500).send('<h2>❌ No admin account found</h2>');
        return;
      }
      await adminService.approveEmployer(req.params.id, adminRow.id);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Employer Approved</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f0fdf4; }
            .card { background: white; border-radius: 16px; padding: 40px; text-align: center; max-width: 400px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            h1 { color: #16a34a; }
            a { display: inline-block; margin-top: 20px; background: linear-gradient(135deg,#667eea,#764ba2); color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <div style="font-size:60px">✅</div>
            <h1>Employer Approved!</h1>
            <p>The employer account has been approved successfully. They can now log in.</p>
            <a href="${frontendUrl}/admin/employers">View All Employers</a>
          </div>
        </body>
        </html>
      `);
    } catch (err: any) {
      res.status(400).send(`<h2>❌ Error: ${err.message}</h2><p>The employer may already be approved, or the link has expired.</p>`);
    }
  },
);



/**
 * Reject an employer account in 'pending' approval_status:
 *   - Sets approval_status to 'rejected'
 *   - Writes an immutable audit log entry (with reason)
 *   - Enqueues an ACCOUNT_REJECTED notification email (with reason)
 *   - Creates an in-app notification
 *
 * Body: { reason: string }
 *
 * Success (200): EmployerWithUser (with updated approval_status)
 * Errors:
 *   401 UNAUTHORIZED              — missing / invalid access token
 *   403 FORBIDDEN                 — caller is not an admin
 *   404 EMPLOYER_NOT_FOUND        — employer profile does not exist
 *   400 INVALID_STATUS_TRANSITION — already approved or rejected
 *   422 VALIDATION_ERROR          — body missing or reason is empty
 *
 * Requirement 8.3
 */
adminRouter.post(
  '/employers/:id/reject',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = rejectEmployerSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      const employer = await adminService.rejectEmployer(
        req.params.id,
        req.user!.userId,
        parsed.data.reason,
      );
      res.status(200).json(employer);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/listings/pending — return all listings awaiting admin review
// ---------------------------------------------------------------------------

/**
 * Return all internship listings with `status = pending`.
 *
 * Success (200): Listing[]
 * Errors:
 *   401 UNAUTHORIZED  — missing / invalid access token
 *   403 FORBIDDEN     — caller is not an admin
 *
 * Requirement 4.2
 */
adminRouter.get(
  '/listings/pending',
  authenticate,
  authorize(UserRole.Admin),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listings = await listingService.getPendingListings();
      res.status(200).json(listings);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/listings/:id/approve — publish a pending listing
// ---------------------------------------------------------------------------

/**
 * Approve a listing in `pending` status:
 *   - Transitions status to `published`
 *   - Writes an immutable audit log entry
 *   - Enqueues an employer notification email
 *
 * Success (200): Listing (with updated status)
 * Errors:
 *   401 UNAUTHORIZED              — missing / invalid access token
 *   403 FORBIDDEN                 — caller is not an admin
 *   404 LISTING_NOT_FOUND         — listing does not exist
 *   422 INVALID_STATUS_TRANSITION — listing is not in `pending` status
 *
 * Requirement 4.2
 */
adminRouter.post(
  '/listings/:id/approve',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listing = await listingService.approveListing(
        req.params.id,
        req.user!.userId,
      );
      res.status(200).json(listing);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/listings/:id/reject — reject a pending listing with a reason
// ---------------------------------------------------------------------------

/**
 * Reject a listing in `pending` status:
 *   - Sets status to `rejected` and stores `rejection_reason`
 *   - Writes an immutable audit log entry
 *   - Enqueues an employer notification email
 *
 * Body: { reason: string }
 *
 * Success (200): Listing (with updated status and rejection_reason)
 * Errors:
 *   401 UNAUTHORIZED              — missing / invalid access token
 *   403 FORBIDDEN                 — caller is not an admin
 *   404 LISTING_NOT_FOUND         — listing does not exist
 *   422 VALIDATION_ERROR          — body missing or reason is empty
 *   422 INVALID_STATUS_TRANSITION — listing is not in `pending` status
 *
 * Requirement 4.3
 */
adminRouter.post(
  '/listings/:id/reject',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = rejectListingSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      const listing = await listingService.rejectListing(
        req.params.id,
        req.user!.userId,
        parsed.data.reason,
      );
      res.status(200).json(listing);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/audit-log — return paginated audit log entries
// ---------------------------------------------------------------------------

/**
 * Return a paginated list of audit log entries with optional filtering.
 *
 * Query parameters:
 *   adminId    (string, optional) — filter by the admin who performed the action
 *   targetType (string, optional) — filter by entity type (e.g. 'listing', 'employer')
 *   dateFrom   (ISO date, optional) — lower bound (inclusive) on timestamp
 *   dateTo     (ISO date, optional) — upper bound (inclusive) on timestamp
 *   page       (integer, default 1)
 *   pageSize   (integer, default 20, max 100)
 *
 * Success (200): { data: AuditLogWithAdminEmail[], pagination: { total, page, pageSize, totalPages } }
 * Errors:
 *   401 UNAUTHORIZED — missing / invalid access token
 *   403 FORBIDDEN    — caller is not an admin
 *   422 VALIDATION_ERROR — invalid query parameters
 *
 * Requirement 8.7
 */

const auditLogQuerySchema = z.object({
  adminId:    z.string().uuid().optional(),
  targetType: z.string().min(1).optional(),
  dateFrom:   z.string().datetime({ offset: true }).optional(),
  dateTo:     z.string().datetime({ offset: true }).optional(),
  page:       z.coerce.number().int().min(1).optional(),
  pageSize:   z.coerce.number().int().min(1).max(100).optional(),
});

adminRouter.get(
  '/audit-log',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = auditLogQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.flatten()));
        return;
      }

      const { adminId, targetType, dateFrom, dateTo, page = 1, pageSize = 20 } = parsed.data;

      const result = await adminService.getAuditLog(
        { adminId, targetType, dateFrom, dateTo },
        page,
        pageSize,
      );

      res.status(200).json({
        data: result.data,
        pagination: {
          total:      result.total,
          page:       result.page,
          pageSize:   result.pageSize,
          totalPages: result.totalPages,
        },
      });
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/accounts/:id/deactivate — deactivate a student or employer account
// ---------------------------------------------------------------------------

/**
 * Deactivate a student or employer account.
 *   - Sets users.status = 'deactivated'
 *   - Writes an immutable audit log entry
 *   - Creates an in-app notification for the affected user
 *   - Enqueues an email notification to the affected user
 *
 * Success (200): { userId, email, role, status }
 * Errors:
 *   401 UNAUTHORIZED                 — missing / invalid access token
 *   403 FORBIDDEN                    — caller is not an admin
 *   403 CANNOT_DEACTIVATE_ADMIN      — target is an admin account
 *   404 USER_NOT_FOUND               — target user does not exist
 *   400 ACCOUNT_ALREADY_DEACTIVATED  — account is already deactivated
 *
 * Requirements: 8.5, 8.6
 */
adminRouter.post(
  '/accounts/:id/deactivate',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await adminService.deactivateAccount(
        req.params.id,
        req.user!.userId,
      );
      res.status(200).json(result);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// Shared query-parameter schema for report endpoints
// ---------------------------------------------------------------------------

/**
 * Accepts ISO date strings (YYYY-MM-DD or full ISO datetime) for the date
 * range, plus optional free-text institution and industry filters.
 *
 * Requirements: 10.1, 10.2, 10.6
 */
const reportQuerySchema = z.object({
  dateFrom:    z.string().optional(),
  dateTo:      z.string().optional(),
  institution: z.string().min(1).optional(),
  industry:    z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// GET /admin/reports/summary
// ---------------------------------------------------------------------------

/**
 * Return aggregate counts of registered students, employers, published
 * listings, and applications for the given date range / filters.
 *
 * Query params:
 *   dateFrom    (ISO date/datetime, optional) — lower bound on creation date
 *   dateTo      (ISO date/datetime, optional) — upper bound on creation date
 *   institution (string, optional)            — filter students by institution
 *   industry    (string, optional)            — filter employers/listings by industry
 *
 * Success (200): SummaryReport
 * Errors:
 *   401 UNAUTHORIZED  — missing / invalid access token
 *   403 FORBIDDEN     — caller is not an admin
 *   422 VALIDATION_ERROR — invalid query parameters
 *
 * Requirements: 10.1, 10.6
 */
adminRouter.get(
  '/reports/summary',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = reportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.flatten()));
        return;
      }

      const { dateFrom, dateTo, institution, industry } = parsed.data;

      const filters = {
        dateFrom:    dateFrom    ? new Date(dateFrom)    : undefined,
        dateTo:      dateTo      ? new Date(dateTo)      : undefined,
        institution: institution ?? undefined,
        industry:    industry    ?? undefined,
      };

      const report = await reportService.getSummaryReport(filters);
      res.status(200).json(report);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/reports/applications
// ---------------------------------------------------------------------------

/**
 * Return ApplicationStatus counts broken down per listing and per employer,
 * optionally filtered by date range, institution, and industry.
 *
 * Query params:
 *   dateFrom    (ISO date/datetime, optional) — lower bound on submitted_at
 *   dateTo      (ISO date/datetime, optional) — upper bound on submitted_at
 *   institution (string, optional)            — filter by student institution
 *   industry    (string, optional)            — filter by employer industry
 *
 * Success (200): ApplicationBreakdown { byListing, byEmployer }
 * Errors:
 *   401 UNAUTHORIZED  — missing / invalid access token
 *   403 FORBIDDEN     — caller is not an admin
 *   422 VALIDATION_ERROR — invalid query parameters
 *
 * Requirements: 10.2, 10.6
 */
adminRouter.get(
  '/reports/applications',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = reportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.flatten()));
        return;
      }

      const { dateFrom, dateTo, institution, industry } = parsed.data;

      const filters = {
        dateFrom:    dateFrom    ? new Date(dateFrom)    : undefined,
        dateTo:      dateTo      ? new Date(dateTo)      : undefined,
        institution: institution ?? undefined,
        industry:    industry    ?? undefined,
      };

      const breakdown = await reportService.getApplicationBreakdown(filters);
      res.status(200).json(breakdown);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/reports/placement-rate
// ---------------------------------------------------------------------------

/**
 * Return the placement rate: the ratio of accepted applications to total
 * applications, optionally filtered by date range.
 *
 * Query params:
 *   dateFrom (ISO date/datetime, optional) — lower bound on submitted_at
 *   dateTo   (ISO date/datetime, optional) — upper bound on submitted_at
 *
 * Success (200): { acceptedCount, totalApplications, placementRate }
 *   placementRate is 0.0 when there are no applications in the range.
 * Errors:
 *   401 UNAUTHORIZED     — missing / invalid access token
 *   403 FORBIDDEN        — caller is not an admin
 *   422 VALIDATION_ERROR — invalid query parameters
 *
 * Requirement 10.3
 */
adminRouter.get(
  '/reports/placement-rate',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = reportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.flatten()));
        return;
      }

      const { dateFrom, dateTo } = parsed.data;

      const filters = {
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo:   dateTo   ? new Date(dateTo)   : undefined,
      };

      const result = await reportService.getPlacementRate(filters);
      res.status(200).json(result);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/reports/trends
// ---------------------------------------------------------------------------

/**
 * Return daily trend data for the past 30 days, covering new registrations,
 * new listings, and new applications per calendar day.
 *
 * No query parameters required. Always covers the last 30 days.
 *
 * Success (200): { days: 30, dataPoints: TrendDataPoint[] }
 * Errors:
 *   401 UNAUTHORIZED  — missing / invalid access token
 *   403 FORBIDDEN     — caller is not an admin
 *
 * Requirement 10.5
 */
adminRouter.get(
  '/reports/trends',
  authenticate,
  authorize(UserRole.Admin),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const trendData = await reportService.getTrendData(30);
      res.status(200).json(trendData);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/reports/:type/export — download a report as CSV
// ---------------------------------------------------------------------------

/**
 * Export any supported report type as a CSV file.
 *
 * Path parameter:
 *   type  — one of 'summary' | 'applications' | 'placement-rate' | 'trends'
 *
 * Query params (same as the individual report endpoints):
 *   dateFrom    (ISO date/datetime, optional)
 *   dateTo      (ISO date/datetime, optional)
 *   institution (string, optional)
 *   industry    (string, optional)
 *
 * Success (200): CSV file download
 *   Content-Type: text/csv; charset=utf-8
 *   Content-Disposition: attachment; filename="report-{type}-{YYYY-MM-DD}.csv"
 *
 * Errors:
 *   400 INVALID_REPORT_TYPE — :type is not a recognised report type
 *   401 UNAUTHORIZED        — missing / invalid access token
 *   403 FORBIDDEN           — caller is not an admin
 *   422 VALIDATION_ERROR    — invalid query parameters
 *
 * Requirements: 10.4, 10.6
 */

const VALID_REPORT_TYPES: ReportType[] = [
  'summary',
  'applications',
  'placement-rate',
  'trends',
];

adminRouter.get(
  '/reports/:type/export',
  authenticate,
  authorize(UserRole.Admin),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Validate :type path parameter
      const rawType = req.params.type;
      if (!VALID_REPORT_TYPES.includes(rawType as ReportType)) {
        res
          .status(400)
          .json(
            errorBody(
              'INVALID_REPORT_TYPE',
              `Report type must be one of: ${VALID_REPORT_TYPES.join(', ')}.`,
            ),
          );
        return;
      }
      const reportType = rawType as ReportType;

      // Parse filter query params
      const parsed = reportQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.flatten()));
        return;
      }

      const { dateFrom, dateTo, institution, industry } = parsed.data;

      const filters = {
        dateFrom:    dateFrom    ? new Date(dateFrom)    : undefined,
        dateTo:      dateTo      ? new Date(dateTo)      : undefined,
        institution: institution ?? undefined,
        industry:    industry    ?? undefined,
      };

      // Generate CSV buffer
      const csvBuffer = await reportService.exportToCsv(reportType, filters);

      // Build filename with today's date
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const filename = `report-${reportType}-${today}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(csvBuffer);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);
