/**
 * Employer Profile Routes
 *
 * All routes require a valid Employer JWT (authenticate + authorize(Employer)).
 *
 *   GET  /employers/me/profile  — retrieve own profile   (Req 3.5)
 *   PUT  /employers/me/profile  — update own profile     (Req 3.6)
 *   POST /employers/me/logo     — upload company logo    (Req 3.7)
 *
 * Standard error shape: { error: { code, message, details? } }
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/authenticate';
import { UserRole } from '../types';
import { employerProfileService, MAX_LOGO_SIZE_BYTES } from '../services/employerProfileService';
import { updateEmployerProfileSchema } from '../validators/employerProfileValidators';

// ---------------------------------------------------------------------------
// Multer configuration — memory storage so the buffer is available for
// validation before any I/O to disk or object storage.
// Accept files up to the allowed limit + a small overhead so multer itself
// doesn't hard-reject before our own error message fires.
// ---------------------------------------------------------------------------
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_SIZE_BYTES + 1 }, // service validates exact limit
});

const router = Router();

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

// ---------------------------------------------------------------------------
// GET /employers/me/profile
// ---------------------------------------------------------------------------

/**
 * Return the authenticated employer's own profile.
 *
 * Success (200): EmployerProfile
 * Errors:
 *   401 UNAUTHORIZED      — missing / invalid access token
 *   403 FORBIDDEN         — caller is not an employer
 *   404 PROFILE_NOT_FOUND — no profile row exists for this user
 *
 * Requirement 3.5
 */
router.get(
  '/me/profile',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await employerProfileService.getProfile(req.user!.userId);
      res.status(200).json(profile);
    } catch (err: unknown) {
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
  },
);

// ---------------------------------------------------------------------------
// PUT /employers/me/profile
// ---------------------------------------------------------------------------

/**
 * Update the authenticated employer's own profile.
 *
 * The response includes the updated EmployerProfile and a success notification
 * body.
 *
 * Success (200):
 *   {
 *     message: 'Profile updated successfully',
 *     profile: EmployerProfile
 *   }
 *
 * Errors:
 *   401 UNAUTHORIZED      — missing / invalid access token
 *   403 FORBIDDEN         — caller is not an employer
 *   404 PROFILE_NOT_FOUND — no profile row exists for this user
 *   422 VALIDATION_ERROR  — request body fails schema validation
 *
 * Requirements 3.5, 3.6
 */
router.put(
  '/me/profile',
  authenticate,
  authorize(UserRole.Employer),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Validate request body.
      const parsed = updateEmployerProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(
            errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()),
          );
        return;
      }

      // 2. Delegate to the service.
      const profile = await employerProfileService.updateProfile(
        req.user!.userId,
        parsed.data,
      );

      // 3. Return updated profile with success notification body.
      res.status(200).json({
        message: 'Profile updated successfully',
        profile,
      });
    } catch (err: unknown) {
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
  },
);

// ---------------------------------------------------------------------------
// POST /employers/me/logo
// ---------------------------------------------------------------------------

/**
 * Upload or replace the authenticated employer's company logo.
 *
 * Request: multipart/form-data with a single field named "logo".
 *
 * Validation (applied before any write to storage):
 *   - MIME type must be image/png or image/jpeg
 *   - File size must be ≤ 2 MB
 *
 * Success (200):
 *   {
 *     message: 'Logo uploaded successfully',
 *     profile: EmployerProfile   // includes updated logo_url
 *   }
 *
 * Errors:
 *   400 NO_FILE_PROVIDED   — request contains no file
 *   401 UNAUTHORIZED       — missing / invalid access token
 *   403 FORBIDDEN          — caller is not an employer
 *   404 PROFILE_NOT_FOUND  — no employer profile exists for this user
 *   422 FILE_VALIDATION_ERROR — wrong MIME type or file exceeds 2 MB
 *
 * Requirement 3.7
 */
router.post(
  '/me/logo',
  authenticate,
  authorize(UserRole.Employer),
  logoUpload.single('logo'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Ensure a file was actually uploaded.
      if (!req.file) {
        res
          .status(400)
          .json(errorBody('NO_FILE_PROVIDED', 'No file was included in the request. Use field name "logo".'));
        return;
      }

      // 2. Delegate validation + persistence to the service.
      const profile = await employerProfileService.uploadLogo(req.user!.userId, req.file);

      // 3. Return updated profile with success notification body.
      res.status(200).json({
        message: 'Logo uploaded successfully',
        profile,
      });
    } catch (err: unknown) {
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
  },
);

export default router;
