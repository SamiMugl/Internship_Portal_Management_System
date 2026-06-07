/**
 * Listing Routes — Employer listing management
 *
 * All routes require a valid Employer JWT (authenticate + authorize(Employer)).
 *
 *   POST /listings               — create a draft listing           (Req 4.1)
 *   PUT  /listings/:id           — update listing fields            (Req 4.5)
 *   POST /listings/:id/submit    — submit for admin review          (Req 4.1)
 *   POST /listings/:id/deactivate — deactivate (close) a listing   (Req 4.6)
 *   GET  /employers/me/listings  — list own listings with status   (Req 4.7)
 *
 * The GET /employers/me/listings route is exported separately so it can be
 * mounted on the /employers router in index.ts.
 *
 * Standard error shape: { error: { code, message, details? } }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/authenticate';
import { UserRole } from '../types';
import { listingService } from '../services/listingService';
import {
  createListingSchema,
  updateListingSchema,
  listingFilterSchema,
} from '../validators/listingValidators';

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

function handleAppError(
  err: unknown,
  res: Response,
  next: NextFunction,
): void {
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
// Listings router — mounted at /listings
// ---------------------------------------------------------------------------

export const listingsRouter = Router();

// ---------------------------------------------------------------------------
// GET /listings — search / filter published listings
// ---------------------------------------------------------------------------

/**
 * Search and filter published internship listings.
 *
 * Supports: keyword, industry, location, durationWeeksMin/Max,
 * stipendMonthlyMin/Max, skills (comma-separated), deadlineBefore,
 * page, pageSize.
 *
 * Results are cached in Redis for 5 minutes.
 *
 * Success (200): PaginatedResult<ListingWithDetails>
 * Errors:
 *   401 UNAUTHORIZED    — missing / invalid access token
 *   403 FORBIDDEN       — caller is not a student
 *   422 VALIDATION_ERROR — invalid query parameters
 *
 * Requirements: 5.1, 5.2, 5.3, 5.5
 */
listingsRouter.get(
  '/',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = listingFilterSchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid query parameters.', parsed.error.flatten()));
        return;
      }

      const result = await listingService.searchListings(parsed.data);
      res.status(200).json(result);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /listings/:id — get full listing detail
// ---------------------------------------------------------------------------

/**
 * Return full detail for a single published internship listing, including
 * employer information and the derived `remaining_openings` field.
 *
 * Success (200): ListingWithDetails
 * Errors:
 *   401 UNAUTHORIZED     — missing / invalid access token
 *   403 FORBIDDEN        — caller is not a student
 *   404 LISTING_NOT_FOUND — listing does not exist or is not published
 *
 * Requirement 5.4, 5.5
 */
listingsRouter.get(
  '/:id',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listing = await listingService.getListingById(req.params.id);

      // Restrict student-facing detail view to published listings only.
      if (listing.status !== 'published') {
        res
          .status(404)
          .json(errorBody('LISTING_NOT_FOUND', 'Listing not found.'));
        return;
      }

      res.status(200).json(listing);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /listings — create a draft listing
// ---------------------------------------------------------------------------

/**
 * Create a new internship listing with status `draft`.
 *
 * Body: CreateListingDTO
 *
 * Success (201): Listing
 * Errors:
 *   401 UNAUTHORIZED           — missing / invalid access token
 *   403 FORBIDDEN              — caller is not an employer
 *   404 EMPLOYER_PROFILE_NOT_FOUND — no employer profile for this user
 *   422 VALIDATION_ERROR       — request body fails schema validation
 *
 * Requirement 4.1
 */
listingsRouter.post(
  '/',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createListingSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      const listing = await listingService.createListing(req.user!.userId, parsed.data);
      res.status(201).json(listing);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /listings/:id — update listing fields
// ---------------------------------------------------------------------------

/**
 * Update fields of an existing listing.
 *
 * If the listing is currently `published`, the update reverts its status to
 * `pending` for re-review by an administrator (Requirement 4.5).
 *
 * Body: UpdateListingDTO (all fields optional)
 *
 * Success (200): Listing
 * Errors:
 *   401 UNAUTHORIZED           — missing / invalid access token
 *   403 FORBIDDEN              — caller is not an employer
 *   404 LISTING_NOT_FOUND      — listing does not exist or belongs to another employer
 *   422 VALIDATION_ERROR       — request body fails schema validation
 *   422 LISTING_NOT_EDITABLE   — listing status does not permit editing
 *
 * Requirement 4.5
 */
listingsRouter.put(
  '/:id',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = updateListingSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      const listing = await listingService.updateListing(
        req.user!.userId,
        req.params.id,
        parsed.data,
      );
      res.status(200).json(listing);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /listings/:id/submit — submit for admin review
// ---------------------------------------------------------------------------

/**
 * Transition a listing from `draft` to `pending` for administrator review.
 *
 * Success (200): Listing (with updated status)
 * Errors:
 *   401 UNAUTHORIZED              — missing / invalid access token
 *   403 FORBIDDEN                 — caller is not an employer
 *   404 LISTING_NOT_FOUND         — listing does not exist or belongs to another employer
 *   422 INVALID_STATUS_TRANSITION — listing is not in `draft` status
 *
 * Requirement 4.1
 */
listingsRouter.post(
  '/:id/submit',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listing = await listingService.submitForReview(
        req.user!.userId,
        req.params.id,
      );
      res.status(200).json(listing);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /listings/:id/deactivate — deactivate (close) a listing
// ---------------------------------------------------------------------------

/**
 * Deactivate a listing by transitioning it to `closed` status.
 *
 * The listing is removed from student-facing search results while existing
 * applications are retained and unaffected (Requirement 4.6).
 *
 * Success (200): Listing (with status `closed`)
 * Errors:
 *   401 UNAUTHORIZED      — missing / invalid access token
 *   403 FORBIDDEN         — caller is not an employer
 *   404 LISTING_NOT_FOUND — listing does not exist or belongs to another employer
 *
 * Requirement 4.6
 */
listingsRouter.post(
  '/:id/deactivate',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listing = await listingService.deactivateListing(
        req.user!.userId,
        req.params.id,
      );
      res.status(200).json(listing);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// Employer listings router — provides GET /employers/me/listings
// Mounted at /employers in index.ts
// ---------------------------------------------------------------------------

export const employerListingsRouter = Router();

/**
 * Return all listings for the authenticated employer with their current status.
 *
 * Success (200): Listing[]
 * Errors:
 *   401 UNAUTHORIZED              — missing / invalid access token
 *   403 FORBIDDEN                 — caller is not an employer
 *   404 EMPLOYER_PROFILE_NOT_FOUND — no employer profile for this user
 *
 * Requirement 4.7
 */
employerListingsRouter.get(
  '/me/listings',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const listings = await listingService.getEmployerListings(req.user!.userId);
      res.status(200).json(listings);
    } catch (err) {
      handleAppError(err, res, next);
    }
  },
);
