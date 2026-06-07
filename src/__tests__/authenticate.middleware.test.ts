/**
 * Unit tests for the `authenticate` and `authorize` middleware.
 *
 * These tests run entirely in-memory — no database or Redis connection needed.
 * We use jsonwebtoken to mint real (signed) tokens so the middleware under
 * test exercises the real verification code path.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../types';

// ---------------------------------------------------------------------------
// Use a stable test secret — mock the env module before importing middleware.
// ---------------------------------------------------------------------------
const TEST_SECRET = 'test-access-secret-for-unit-tests';

jest.mock('../config/env', () => ({
  env: {
    JWT_ACCESS_SECRET: TEST_SECRET,
  },
}));

// Import middleware AFTER the mock is in place.
import { authenticate, authorize } from '../middleware/authenticate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(authorization?: string): Partial<Request> {
  return {
    headers: authorization ? { authorization } : {},
    user: undefined,
  };
}

function makeRes(): { status: jest.Mock; json: jest.Mock } {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res); // allow chaining: res.status(x).json(y)
  return res;
}

function mintToken(
  payload: object,
  secret = TEST_SECRET,
  options: jwt.SignOptions = { expiresIn: 900 },
): string {
  return jwt.sign(payload, secret, options);
}

// ---------------------------------------------------------------------------
// authenticate middleware
// ---------------------------------------------------------------------------

describe('authenticate middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn();
  });

  it('returns 401 when Authorization header is absent', () => {
    const req = makeReq();
    const res = makeRes();

    authenticate(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is not a Bearer token', () => {
    const req = makeReq('Basic somebase64string');
    const res = makeRes();

    authenticate(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the Bearer token is empty', () => {
    const req = makeReq('Bearer ');
    const res = makeRes();

    authenticate(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is signed with the wrong secret', () => {
    const token = mintToken(
      { sub: 'user-id', role: UserRole.Student, email: 'a@b.com' },
      'wrong-secret',
    );
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    authenticate(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is expired', () => {
    const token = mintToken(
      { sub: 'user-id', role: UserRole.Student, email: 'a@b.com' },
      TEST_SECRET,
      { expiresIn: -1 }, // already expired
    );
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    authenticate(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the token payload is missing required claims', () => {
    // Missing 'role' claim
    const token = mintToken({ sub: 'user-id', email: 'a@b.com' });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    authenticate(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and attaches req.user for a valid token', () => {
    const token = mintToken({
      sub: 'user-uuid-123',
      role: UserRole.Student,
      email: 'student@example.com',
    });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    authenticate(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as Request).user).toMatchObject({
      userId: 'user-uuid-123',
      role: UserRole.Student,
      email: 'student@example.com',
    });
  });

  it('accepts tokens for all valid roles', () => {
    for (const role of Object.values(UserRole)) {
      const token = mintToken({ sub: 'some-id', role, email: 'x@y.com' });
      const req = makeReq(`Bearer ${token}`);
      const res = makeRes();
      const localNext = jest.fn();

      authenticate(req as Request, res as unknown as Response, localNext);

      expect(localNext).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// authorize middleware
// ---------------------------------------------------------------------------

describe('authorize middleware', () => {
  function reqWithRole(role: UserRole): Partial<Request> {
    return {
      user: { userId: 'u1', role, email: 'u@e.com' },
    };
  }

  it('calls next() when the user has a permitted role', () => {
    const next = jest.fn();
    const req = reqWithRole(UserRole.Admin);
    const res = makeRes();

    authorize(UserRole.Admin)(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when the user role is one of multiple allowed roles', () => {
    const next = jest.fn();
    const req = reqWithRole(UserRole.Employer);
    const res = makeRes();

    authorize(UserRole.Admin, UserRole.Employer)(req as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 403 when the user role is not in the allowed list', () => {
    const next = jest.fn();
    const req = reqWithRole(UserRole.Student);
    const res = makeRes();

    authorize(UserRole.Admin)(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when req.user is absent (authenticate was not run first)', () => {
    const next = jest.fn();
    const req: Partial<Request> = {}; // no user
    const res = makeRes();

    authorize(UserRole.Admin)(req as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
