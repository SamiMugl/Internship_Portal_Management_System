/**
 * Student Profile Routes
 *
 * All routes require a valid Student JWT (authenticate + authorize(Student)).
 *
 *   GET  /students/me/profile    — retrieve own profile          (Req 2.1)
 *   PUT  /students/me/profile    — update own profile            (Req 2.1, 2.5)
 *   POST /students/me/resume     — upload resume (PDF/DOCX ≤5MB) (Req 2.2, 2.3)
 *   GET  /students/me/completion — get profile completion %      (Req 2.4)
 *
 * Standard error shape: { error: { code, message, details? } }
 */

import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/authenticate';
import { UserRole } from '../types';
import { studentProfileService, ALLOWED_RESUME_MIME_TYPES, MAX_RESUME_SIZE_BYTES } from '../services/studentProfileService';
import { updateStudentProfileSchema } from '../validators/studentProfileValidators';
import { COMPLETION_THRESHOLD } from '../config/profileCompletion';

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
// GET /students/me/profile
// ---------------------------------------------------------------------------

/**
 * Return the authenticated student's own profile.
 *
 * Success (200): StudentProfile
 * Errors:
 *   401 UNAUTHORIZED   — missing / invalid access token
 *   403 FORBIDDEN      — caller is not a student
 *   404 PROFILE_NOT_FOUND — no profile row exists for this user
 *
 * Requirement 2.1
 */
router.get(
  '/me/profile',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await studentProfileService.getProfile(req.user!.userId);
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
// PUT /students/me/profile
// ---------------------------------------------------------------------------

/**
 * Update the authenticated student's own profile.
 *
 * The response includes:
 *   - the updated StudentProfile
 *   - a success notification body
 *   - whether profile completion has reached the threshold
 *
 * Success (200):
 *   {
 *     profile: StudentProfile,
 *     notification: { type: "PROFILE_SAVED", message: string },
 *     completionPct: number,
 *     belowThreshold: boolean
 *   }
 *
 * Errors:
 *   401 UNAUTHORIZED      — missing / invalid access token
 *   403 FORBIDDEN         — caller is not a student
 *   404 PROFILE_NOT_FOUND — no profile row exists for this user
 *   422 VALIDATION_ERROR  — request body fails schema validation
 *
 * Requirements 2.1, 2.5
 */
router.put(
  '/me/profile',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Validate request body.
      const parsed = updateStudentProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(422)
          .json(
            errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()),
          );
        return;
      }

      // 2. Delegate to the service (also recomputes and caches completion_pct).
      const profile = await studentProfileService.updateProfile(
        req.user!.userId,
        parsed.data,
      );

      // 3. Parse completion_pct from the returned profile (pg returns NUMERIC as string).
      const completionPct = profile.completion_pct !== null
        ? parseFloat(profile.completion_pct)
        : 0;

      const belowThreshold = completionPct < COMPLETION_THRESHOLD;

      // 4. Build response with success notification body.
      res.status(200).json({
        profile,
        notification: {
          type: 'PROFILE_SAVED',
          message: 'Your profile has been saved successfully.',
        },
        completionPct,
        belowThreshold,
        ...(belowThreshold
          ? {
              prompt:
                'Your profile is less than 60% complete. Complete your profile to unlock all application features.',
            }
          : {}),
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
// Multer configuration for resume uploads
//
// - memoryStorage: keep file in memory (buffer) so we can validate before
//   writing to disk. Never touches the filesystem on validation failure.
// - limits.fileSize: set a generous hard cap (10 MB) at the multer layer to
//   reject obviously oversized uploads early; the 5 MB business rule is
//   enforced explicitly in the service layer for a proper 422 response.
// ---------------------------------------------------------------------------

const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RESUME_SIZE_BYTES * 2 }, // hard cap at 10 MB
  fileFilter: (_req, file, cb) => {
    // Reject clearly wrong MIME types early; the service layer also validates
    // and returns the standard 422 shape.
    if (ALLOWED_RESUME_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false); // reject the file; the service will surface the error
    }
  },
});

// ---------------------------------------------------------------------------
// POST /students/me/resume
// ---------------------------------------------------------------------------

/**
 * Upload a resume for the authenticated student.
 *
 * Expects a multipart/form-data request with a single file field named "resume".
 *
 * Success (201):
 *   {
 *     resume: Resume,
 *     notification: { type: "RESUME_UPLOADED", message: string }
 *   }
 *
 * Errors:
 *   400 NO_FILE_PROVIDED   — no file was attached to the request
 *   401 UNAUTHORIZED       — missing / invalid access token
 *   403 FORBIDDEN          — caller is not a student
 *   404 PROFILE_NOT_FOUND  — no profile row exists for this user
 *   422 FILE_VALIDATION_ERROR — wrong MIME type or file exceeds 5 MB
 *
 * Requirements 2.2, 2.3
 */
router.post(
  '/me/resume',
  authenticate,
  authorize(UserRole.Student),
  resumeUpload.single('resume'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // If multer rejected the file (wrong MIME) req.file is undefined.
      // Also handle the case where no file was sent at all.
      if (!req.file) {
        // Distinguish between "no file" and "file rejected by fileFilter"
        // by checking the Content-Type header.
        const contentType = req.headers['content-type'] ?? '';
        if (contentType.includes('multipart/form-data')) {
          // A multipart request was sent but the file was rejected (wrong type).
          res.status(422).json(
            errorBody(
              'FILE_VALIDATION_ERROR',
              'Invalid file type. Only PDF and DOCX files are accepted.',
              { allowedTypes: [...ALLOWED_RESUME_MIME_TYPES] },
            ),
          );
        } else {
          res.status(400).json(
            errorBody('NO_FILE_PROVIDED', 'No resume file was attached. Send a multipart/form-data request with a "resume" field.'),
          );
        }
        return;
      }

      const resume = await studentProfileService.uploadResume(req.user!.userId, req.file);

      res.status(201).json({
        resume,
        notification: {
          type: 'RESUME_UPLOADED',
          message: 'Your resume has been uploaded successfully.',
        },
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
// GET /students/me/completion
// ---------------------------------------------------------------------------

/**
 * Return the profile-completion percentage for the authenticated student.
 * Recomputes the value and caches it back to the DB.
 *
 * Success (200):
 *   {
 *     completionPct: number,
 *     belowThreshold: boolean,
 *     threshold: number
 *   }
 *
 * Errors:
 *   401 UNAUTHORIZED      — missing / invalid access token
 *   403 FORBIDDEN         — caller is not a student
 *   404 PROFILE_NOT_FOUND — no profile row exists for this user
 *
 * Requirement 2.4
 */
router.get(
  '/me/completion',
  authenticate,
  authorize(UserRole.Student),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const completionPct = await studentProfileService.getCompletionPercentage(
        req.user!.userId,
      );

      res.status(200).json({
        completionPct,
        belowThreshold: completionPct < COMPLETION_THRESHOLD,
        threshold: COMPLETION_THRESHOLD,
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
