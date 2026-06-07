/**
 * `authenticate` middleware
 *
 * Extracts the Bearer token from the `Authorization` header, verifies its
 * signature and expiry using the access-token secret, and attaches the decoded
 * payload as `req.user`.
 *
 * On failure the middleware short-circuits the request and returns:
 *   401 UNAUTHORIZED — missing, malformed, expired, or invalid token.
 *
 * Usage:
 *   router.get('/protected', authenticate, handler);
 *
 * Requirements: 1, 3, 4, 5, 6, 7, 8, 9, 10
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '../types';

// ---------------------------------------------------------------------------
// JWT payload shape for access tokens
// ---------------------------------------------------------------------------

/**
 * The claims included in every access-token JWT.
 *
 * Convention:
 *   sub   — user UUID (standard JWT subject claim)
 *   role  — UserRole enum value
 *   email — user email address (convenience claim, avoids extra DB lookup)
 */
export interface AccessTokenPayload {
  sub: string;     // userId
  role: UserRole;
  email: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Error response helper
// ---------------------------------------------------------------------------

function unauthorizedResponse(res: Response, message: string): void {
  res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message,
    },
  });
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Verifies the access-token JWT from the `Authorization: Bearer <token>`
 * header and attaches the decoded user information to `req.user`.
 *
 * Rejects with 401 when:
 *   - The `Authorization` header is absent or not a Bearer token.
 *   - The token signature is invalid.
 *   - The token has expired.
 *   - The token payload does not contain the required claims.
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // 1. Extract token from Authorization header.
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    unauthorizedResponse(res, 'Access token is required.');
    return;
  }

  const token = authHeader.slice(7).trim(); // Remove "Bearer " prefix.

  if (!token) {
    unauthorizedResponse(res, 'Access token is required.');
    return;
  }

  // 2. Verify signature and expiry atomically with jsonwebtoken.
  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    // Covers TokenExpiredError, JsonWebTokenError, NotBeforeError, etc.
    unauthorizedResponse(res, 'Access token is invalid or has expired.');
    return;
  }

  // 3. Validate the required claims are present.
  if (
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    !Object.values(UserRole).includes(payload.role) ||
    typeof payload.email !== 'string' ||
    !payload.email
  ) {
    unauthorizedResponse(res, 'Access token payload is malformed.');
    return;
  }

  // 4. Attach the decoded identity to the request object.
  req.user = {
    userId: payload.sub,
    role: payload.role,
    email: payload.email,
  };

  next();
}

// ---------------------------------------------------------------------------
// RBAC middleware factory
// ---------------------------------------------------------------------------

/**
 * `authorize(...roles)` — role-based access control middleware.
 *
 * Must be used **after** `authenticate` in the middleware chain.
 *
 * Allows the request to proceed only when `req.user.role` is included in
 * the provided `roles` list.  Returns 403 FORBIDDEN otherwise.
 *
 * Usage:
 *   router.get('/admin/only', authenticate, authorize(UserRole.Admin), handler);
 *   router.get('/employers', authenticate, authorize(UserRole.Employer, UserRole.Admin), handler);
 *
 * Requirements: 1, 3, 4, 5, 6, 7, 8, 9, 10
 */
export function authorize(...roles: UserRole[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      // authenticate must run first; if req.user is absent, it is a coding error.
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token is required.',
        },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource.',
        },
      });
      return;
    }

    next();
  };
}
