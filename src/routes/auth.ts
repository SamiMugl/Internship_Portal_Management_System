/**
 * Authentication Routes
 *
 * Handles public authentication endpoints:
 *   POST /auth/register/student    — student registration
 *   POST /auth/register/employer   — employer registration
 *   POST /auth/verify-email        — email verification (task 3.4)
 *   POST /auth/login               — login (task 3.6)
 *   POST /auth/refresh             — refresh access token (task 3.10)
 *   POST /auth/logout              — invalidate refresh token (task 3.10)
 *   POST /auth/request-password-reset — request password reset (task 3.10)
 *   POST /auth/reset-password      — submit new password (task 3.10)
 *
 * All routes use parameterised SQL queries only (via BaseRepository helpers).
 * Standard error shape: { error: { code, message, details? } }
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { BaseRepository } from '../database/baseRepository';
import { env } from '../config/env';
import { getPublicFrontendUrl } from '../config/mailTransport';
import { authService } from '../services/authService';
import {
  registerStudentSchema,
  registerEmployerSchema,
} from '../validators/authValidators';
import { User, UserStatus } from '../types';

const router = Router();
const repo = new BaseRepository();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the standard error response body used across all endpoints.
 */
function errorBody(
  code: string,
  message: string,
  details?: unknown,
): { error: { code: string; message: string; details?: unknown } } {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

// ---------------------------------------------------------------------------
// POST /auth/register/student
// ---------------------------------------------------------------------------

router.post(
  '/register/student',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = registerStudentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      const result = await authService.registerStudent(parsed.data);
      res.status(201).json(result);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'DUPLICATE_EMAIL'
      ) {
        res.status(409).json(errorBody('DUPLICATE_EMAIL', 'An account with that email already exists.'));
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/register/employer
// ---------------------------------------------------------------------------

router.post(
  '/register/employer',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = registerEmployerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      const result = await authService.registerEmployer(parsed.data);
      res.status(201).json(result);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'DUPLICATE_EMAIL'
      ) {
        res.status(409).json(errorBody('DUPLICATE_EMAIL', 'An account with that email already exists.'));
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /auth/verify-email  (link from verification email)
// ---------------------------------------------------------------------------

router.get(
  '/verify-email',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!token.trim()) {
        res.status(400).send('<h2>Invalid verification link.</h2>');
        return;
      }

      await authService.verifyEmail(token);

      const loginUrl = getPublicFrontendUrl();
      res.status(200).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;">
          <h2 style="color:#16a34a;">Email verified successfully!</h2>
          <p>Your account is now active.</p>
          <p><a href="${loginUrl}/login" style="color:#2563eb;">Go to Login</a></p>
        </body></html>
      `);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'INVALID_OR_EXPIRED_TOKEN'
      ) {
        res.status(400).send('<h2>This verification link is invalid or has expired.</h2>');
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/verify-email
// ---------------------------------------------------------------------------

/**
 * Verify an email address using the token sent in the verification email.
 *
 * Expected request body:
 *   { "token": "<JWT>" }
 *
 * The token is an HMAC-signed JWT produced by authService.registerStudent():
 *   { sub: string (userId), purpose: 'email_verification', iat, exp }
 * It is signed with JWT_VERIFICATION_SECRET and has a 24-hour expiry.
 *
 * Success (200):
 *   { "message": "Email verified successfully." }
 *
 * Failure (400):
 *   { "error": { "code": "INVALID_OR_EXPIRED_TOKEN", "message": "..." } }
 *
 * Requirement 1.2: WHEN a student clicks the email verification link within
 * 24 hours of receiving it, THE Portal SHALL activate the Student account.
 */
router.post(
  '/verify-email',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token } = req.body as { token?: unknown };

      // 1. Basic presence check — token must be a non-empty string.
      if (typeof token !== 'string' || token.trim() === '') {
        res
          .status(400)
          .json(errorBody('INVALID_OR_EXPIRED_TOKEN', 'Verification token is required.'));
        return;
      }

      // 2. Decode and verify the JWT.
      //    jwt.verify() checks signature integrity AND the exp claim atomically,
      //    throwing TokenExpiredError, JsonWebTokenError, or NotBeforeError on failure.
      let payload: JwtPayload;
      try {
        payload = jwt.verify(token, env.JWT_VERIFICATION_SECRET) as JwtPayload;
      } catch {
        res
          .status(400)
          .json(errorBody('INVALID_OR_EXPIRED_TOKEN', 'The verification token is invalid or has expired.'));
        return;
      }

      // 3. Confirm the token carries the expected purpose claim.
      //    authService signs tokens with { sub: userId, purpose: 'email_verification' }.
      if (payload.purpose !== 'email_verification') {
        res
          .status(400)
          .json(errorBody('INVALID_OR_EXPIRED_TOKEN', 'The verification token is invalid or has expired.'));
        return;
      }

      // 4. Extract the user ID from the 'sub' claim.
      const userId = payload.sub as string;
      if (!userId) {
        res
          .status(400)
          .json(errorBody('INVALID_OR_EXPIRED_TOKEN', 'The verification token is invalid or has expired.'));
        return;
      }

      // 5. Look up the user by ID using a parameterised query.
      const user = await repo.queryOne<User>(
        'SELECT id, status FROM users WHERE id = $1',
        [userId],
      );

      if (!user) {
        // User no longer exists — treat as invalid token.
        res
          .status(400)
          .json(errorBody('INVALID_OR_EXPIRED_TOKEN', 'The verification token is invalid or has expired.'));
        return;
      }

      // 6. If already active, treat as idempotent success to handle token replays.
      if (user.status === UserStatus.Active) {
        res.status(200).json({ message: 'Email verified successfully.' });
        return;
      }

      // 7. Guard: token should only be usable for accounts that are still
      //    awaiting verification.  Any other status (pending_approval, deactivated)
      //    is not a valid target for this transition.
      if (user.status !== UserStatus.PendingVerification) {
        res
          .status(400)
          .json(errorBody('INVALID_OR_EXPIRED_TOKEN', 'The verification token is invalid or has expired.'));
        return;
      }

      // 8. Atomically transition the user's status to 'active'.
      //    The AND status = $3 guard prevents a race condition where two
      //    concurrent requests could both attempt the update.
      await repo.query(
        `UPDATE users
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id         = $2
         AND    status     = $3`,
        [UserStatus.Active, userId, UserStatus.PendingVerification],
      );

      res.status(200).json({ message: 'Email verified successfully.' });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

/**
 * Authenticate with email and password.
 *
 * Success (200): { accessToken, refreshToken }
 * Errors:
 *   401 INVALID_CREDENTIALS    — email not found or wrong password
 *   401 ACCOUNT_NOT_VERIFIED   — student has not verified email yet
 *   401 ACCOUNT_DEACTIVATED    — account has been deactivated
 *   401 ACCOUNT_PENDING_APPROVAL — employer awaiting admin approval
 *   423 ACCOUNT_LOCKED         — too many failed attempts; body includes lockUntil
 *   422 VALIDATION_ERROR       — malformed request body
 *
 * Requirement 1.4: Valid credentials return a JWT access token + refresh token.
 * Requirement 1.5: 3 failed logins lock the account for 15 minutes.
 * Requirement 3.4: Authenticated users can access role-gated resources.
 */
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      const tokenPair = await authService.login(parsed.data);
      res.status(200).json(tokenPair);
    } catch (err: unknown) {
      const appErr = err as { code?: string; statusCode?: number; message?: string; details?: unknown };
      if (appErr.statusCode && appErr.code) {
        res.status(appErr.statusCode).json(errorBody(appErr.code, appErr.message ?? '', appErr.details));
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------

/**
 * Exchange a valid refresh token for a new TokenPair (rotation).
 *
 * Success (200): { accessToken, refreshToken }
 * Errors:
 *   401 INVALID_REFRESH_TOKEN  — token not found, expired, or already revoked
 *   422 VALIDATION_ERROR       — malformed request body
 *
 * Requirement 1.6: Tokens can be refreshed before expiry.
 */
const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

router.post(
  '/refresh',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = refreshSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      const tokenPair = await authService.refreshTokens(parsed.data.refreshToken);
      res.status(200).json(tokenPair);
    } catch (err: unknown) {
      const appErr = err as { code?: string; statusCode?: number; message?: string };
      if (appErr.statusCode && appErr.code) {
        res.status(appErr.statusCode).json(errorBody(appErr.code, appErr.message ?? ''));
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

/**
 * Revoke the supplied refresh token (logout).
 *
 * Success (200): { message: "Logged out successfully." }
 * Errors:
 *   422 VALIDATION_ERROR — malformed request body
 *
 * Requirement 1.6: Users can log out, invalidating their refresh token.
 */
router.post(
  '/logout',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = refreshSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      await authService.logout(parsed.data.refreshToken);
      res.status(200).json({ message: 'Logged out successfully.' });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/request-password-reset
// ---------------------------------------------------------------------------

/**
 * Request a password-reset email.
 *
 * Always returns 200 regardless of whether the email is registered, to
 * prevent user-enumeration attacks.
 *
 * Success (200): { message: "If that email is registered you will receive a reset link." }
 * Errors:
 *   422 VALIDATION_ERROR — malformed request body
 *
 * Requirement 1.7: Users can reset their password via email.
 */
const requestResetSchema = z.object({
  email: z.string().email(),
});

router.post(
  '/request-password-reset',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = requestResetSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      await authService.requestPasswordReset({ email: parsed.data.email });
      res.status(200).json({ message: 'If that email is registered you will receive a reset link.' });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /auth/reset-password
// ---------------------------------------------------------------------------

/**
 * Submit a new password using the reset token from the email.
 *
 * Success (200): { message: "Password reset successfully." }
 * Errors:
 *   400 INVALID_OR_EXPIRED_TOKEN — bad/expired reset token
 *   422 VALIDATION_ERROR         — malformed request body
 *
 * Requirement 1.7: Password reset token is validated before accepting new password.
 */
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

router.post(
  '/reset-password',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json(errorBody('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten()));
        return;
      }

      await authService.resetPassword(parsed.data);
      res.status(200).json({ message: 'Password reset successfully.' });
    } catch (err: unknown) {
      const appErr = err as { code?: string; statusCode?: number; message?: string };
      if (appErr.statusCode && appErr.code) {
        res.status(appErr.statusCode).json(errorBody(appErr.code, appErr.message ?? ''));
        return;
      }
      next(err);
    }
  },
);

export default router;
