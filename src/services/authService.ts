/**
 * AuthService — handles user registration, login, and related auth flows.
 *
 * Registration flow:
 *   1. Hash the plaintext password with bcrypt (cost factor 12).
 *   2. Begin a database transaction.
 *   3. INSERT into `users` with the appropriate initial status:
 *        - student  → pending_verification
 *        - employer → pending_approval
 *   4. INSERT the corresponding profile row (student_profiles / employer_profiles).
 *   5. COMMIT the transaction.
 *   6. Enqueue an email job via Bull (outside the transaction so a queue
 *      failure does not roll back the persisted account).
 *
 * Login flow:
 *   1. Look up the user by email.
 *   2. Check lockout state from Redis (`lockout:{userId}`).
 *   3. Check account status (deactivated / unverified).
 *   4. Verify bcrypt password.
 *   5. On mismatch: increment failed_login_attempts; on 3rd failure set Redis
 *      lockout key (15 min TTL) and enqueue lockout notification email.
 *   6. On success: reset failed_login_attempts, issue TokenPair (15 min JWT
 *      access token + opaque refresh token stored in refresh_tokens table).
 *
 * On duplicate email the PostgreSQL unique-constraint violation (code 23505)
 * is caught and re-thrown as an AppError with code DUPLICATE_EMAIL / HTTP 409.
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { PoolClient } from 'pg';
import { BaseRepository } from '../database/baseRepository';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { enqueueEmail } from '../queues/emailQueue';
import { UserRole, UserStatus, User, StudentProfile, EmployerProfile } from '../types';
import { RegisterStudentDTO, RegisterEmployerDTO } from '../validators/authValidators';

// ---------------------------------------------------------------------------
// Login DTO
// ---------------------------------------------------------------------------

export interface LoginDTO {
  email: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Password reset DTOs
// ---------------------------------------------------------------------------

export interface RequestPasswordResetDTO {
  email: string;
}

export interface ResetPasswordDTO {
  token: string;
  newPassword: string;
}

// ---------------------------------------------------------------------------
// Application error
// ---------------------------------------------------------------------------

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ---------------------------------------------------------------------------
// Token pair
// ---------------------------------------------------------------------------

export interface TokenPair {
  /** Short-lived JWT access token (15 min) */
  accessToken: string;
  /** Opaque refresh token (7 days), stored in DB as SHA-256 hash */
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Lockout constants
// ---------------------------------------------------------------------------

/** Number of failed attempts before account is locked */
const MAX_FAILED_ATTEMPTS = 3;
/** Lockout duration in seconds (15 minutes) */
const LOCKOUT_TTL_SECONDS = 15 * 60;
/** Refresh token TTL in seconds (7 days) */
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Registration result shapes
// ---------------------------------------------------------------------------

export interface StudentRegistrationResult {
  user: Omit<User, 'password_hash'>;
  studentProfile: StudentProfile;
}

export interface EmployerRegistrationResult {
  user: Omit<User, 'password_hash'>;
  employerProfile: EmployerProfile;
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

export class AuthService extends BaseRepository {
  // -------------------------------------------------------------------------
  // Student registration
  // -------------------------------------------------------------------------

  /**
   * Register a new student account.
   *
   * @throws AppError(409, 'DUPLICATE_EMAIL') if the email is already in use.
   */
  async registerStudent(dto: RegisterStudentDTO): Promise<StudentRegistrationResult> {
    const passwordHash = await bcrypt.hash(dto.password, env.BCRYPT_ROUNDS);

    let user!: User;
    let studentProfile!: StudentProfile;

    try {
      await this.transaction(async (client: PoolClient) => {
        // Insert user row
        user = await this.queryOneWithClient<User>(
          client,
          `INSERT INTO users (email, password_hash, role, status)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [dto.email, passwordHash, UserRole.Student, UserStatus.PendingVerification],
        ) as User;

        // Insert student_profile row
        studentProfile = await this.queryOneWithClient<StudentProfile>(
          client,
          `INSERT INTO student_profiles (user_id, full_name, institution, degree)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [
            user.id,
            dto.fullName,
            dto.institution ?? null,
            dto.degree ?? null,
          ],
        ) as StudentProfile;
      });
    } catch (err) {
      this.handleDbError(err);
    }

    // Generate a verification token (HMAC-signed JWT, 24 h expiry)
    const verificationToken = jwt.sign(
      { sub: user.id, purpose: 'email_verification' },
      env.JWT_VERIFICATION_SECRET,
      { expiresIn: env.EMAIL_VERIFICATION_EXPIRES_IN },
    );

    // Enqueue email job — outside the transaction so a Redis failure doesn't
    // roll back the persisted account.
    try {
      await enqueueEmail({
        type: 'ACCOUNT_VERIFICATION',
        userId: user.id,
        email: user.email,
        verificationToken,
      });
    } catch (queueErr) {
      // Non-fatal: log and continue. The account is already persisted.
      console.error('[auth] Failed to enqueue verification email:', queueErr);
    }

    const { password_hash: _omit, ...safeUser } = user;
    return { user: safeUser, studentProfile };
  }

  // -------------------------------------------------------------------------
  // Employer registration
  // -------------------------------------------------------------------------

  /**
   * Register a new employer account (pending Administrator approval).
   *
   * @throws AppError(409, 'DUPLICATE_EMAIL') if the email is already in use.
   */
  async registerEmployer(dto: RegisterEmployerDTO): Promise<EmployerRegistrationResult> {
    const passwordHash = await bcrypt.hash(dto.password, env.BCRYPT_ROUNDS);

    let user!: User;
    let employerProfile!: EmployerProfile;

    try {
      await this.transaction(async (client: PoolClient) => {
        // Insert user row
        user = await this.queryOneWithClient<User>(
          client,
          `INSERT INTO users (email, password_hash, role, status)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [dto.email, passwordHash, UserRole.Employer, UserStatus.PendingApproval],
        ) as User;

        // Insert employer_profile row
        employerProfile = await this.queryOneWithClient<EmployerProfile>(
          client,
          `INSERT INTO employer_profiles (user_id, company_name, industry, contact_person)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [
            user.id,
            dto.companyName,
            dto.industry ?? null,
            dto.contactPerson,
          ],
        ) as EmployerProfile;
      });
    } catch (err) {
      this.handleDbError(err);
    }

    // Enqueue employer notification email (to the employer)
    try {
      await enqueueEmail({
        type: 'ACCOUNT_APPROVAL_PENDING',
        userId: user.id,
        email: user.email,
        companyName: dto.companyName,
      });
    } catch (queueErr) {
      console.error('[auth] Failed to enqueue approval-pending email:', queueErr);
    }

    // Also notify admin so they can approve from their mobile email
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      try {
        await enqueueEmail({
          type: 'ADMIN_EMPLOYER_PENDING',
          userId: user.id,
          email: adminEmail,
          companyName: dto.companyName,
          employerEmail: user.email,
          employerId: employerProfile.id,
        } as never);
      } catch (queueErr) {
        console.error('[auth] Failed to enqueue admin notification email:', queueErr);
      }
    }

    const { password_hash: _omit, ...safeUser } = user;
    return { user: safeUser, employerProfile };
  }

  // -------------------------------------------------------------------------
  // Email verification
  // -------------------------------------------------------------------------

  /**
   * Verify a user's email address using the JWT verification token.
   *
   * Validates the token signature, expiry, and purpose claim, then transitions
   * the user account from `pending_verification` to `active`.
   *
   * Idempotent: if the account is already active, returns without error.
   *
   * @throws AppError(400, 'INVALID_OR_EXPIRED_TOKEN') — bad/expired/wrong-purpose token
   * @throws AppError(404, 'USER_NOT_FOUND')           — user no longer exists
   *
   * Requirement 1.2
   */
  async verifyEmail(token: string): Promise<void> {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_VERIFICATION_SECRET) as jwt.JwtPayload;
    } catch {
      throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'The verification token is invalid or has expired.');
    }

    if (payload.purpose !== 'email_verification' || !payload.sub) {
      throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'The verification token is invalid or has expired.');
    }

    const userId = payload.sub as string;

    await this.query(
      `UPDATE users
       SET    status     = $1,
              updated_at = NOW()
       WHERE  id         = $2
         AND  status     = $3`,
      [UserStatus.Active, userId, UserStatus.PendingVerification],
    );
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  /**
   * Authenticate a user by email and password.
   *
   * Flow:
   *  1. Look up user by email.
   *  2. Check Redis lockout key (`lockout:{userId}`).
   *  3. Enforce account status (deactivated / unverified).
   *  4. bcrypt.compare password.
   *  5a. Failure path: increment failed_login_attempts; on 3rd failure write
   *      Redis lockout key and enqueue lockout notification.
   *  5b. Success path: reset failed_login_attempts, issue TokenPair.
   *
   * @throws AppError(401, 'USER_NOT_FOUND')         — unknown email
   * @throws AppError(423, 'ACCOUNT_LOCKED')         — currently locked out
   * @throws AppError(401, 'ACCOUNT_NOT_VERIFIED')   — pending_verification
   * @throws AppError(401, 'ACCOUNT_DEACTIVATED')    — deactivated
   * @throws AppError(401, 'INVALID_CREDENTIALS')    — wrong password
   */
  async login(dto: LoginDTO): Promise<TokenPair> {
    // 1. Look up user by email.
    const user = await this.queryOne<User>(
      'SELECT * FROM users WHERE email = $1',
      [dto.email.toLowerCase().trim()],
    );

    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    // 2. Check Redis lockout key.
    const lockoutKey = `lockout:${user.id}`;
    const lockoutValue = await redis.get(lockoutKey);

    if (lockoutValue) {
      const lockUntilMs = parseInt(lockoutValue, 10);
      if (lockUntilMs > Date.now()) {
        throw new AppError(
          423,
          'ACCOUNT_LOCKED',
          'Account is temporarily locked due to too many failed login attempts.',
          { lockUntil: new Date(lockUntilMs).toISOString() },
        );
      }
      // Key still in Redis but time already passed — remove it.
      await redis.del(lockoutKey);
    }

    // 3. Enforce account status.
    if (user.status === UserStatus.PendingVerification) {
      throw new AppError(401, 'ACCOUNT_NOT_VERIFIED', 'Please verify your email address before logging in.');
    }

    if (user.status === UserStatus.Deactivated) {
      throw new AppError(401, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated.');
    }

    // Employer accounts that are pending approval cannot log in either.
    if (user.status === UserStatus.PendingApproval) {
      throw new AppError(401, 'ACCOUNT_PENDING_APPROVAL', 'Your account is pending administrator approval.');
    }

    // 4. Verify password.
    const passwordMatch = await bcrypt.compare(dto.password, user.password_hash);

    if (!passwordMatch) {
      // 5a. Increment failed attempts.
      const newAttempts = user.failed_login_attempts + 1;

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntilMs = Date.now() + LOCKOUT_TTL_SECONDS * 1000;

        await this.query(
          `UPDATE users
           SET    failed_login_attempts = $1,
                  updated_at            = NOW()
           WHERE  id = $2`,
          [newAttempts, user.id],
        );

        // Write Redis lockout key.
        await redis.set(lockoutKey, String(lockUntilMs), 'EX', LOCKOUT_TTL_SECONDS);

        // Enqueue lockout notification email.
        try {
          await enqueueEmail({
            type: 'ACCOUNT_LOCKED',
            userId: user.id,
            email: user.email,
            lockUntil: new Date(lockUntilMs).toISOString(),
          });
        } catch (queueErr) {
          console.error('[auth] Failed to enqueue lockout email:', queueErr);
        }

        throw new AppError(
          423,
          'ACCOUNT_LOCKED',
          'Account is temporarily locked due to too many failed login attempts.',
          { lockUntil: new Date(lockUntilMs).toISOString() },
        );
      }

      await this.query(
        `UPDATE users
         SET    failed_login_attempts = $1,
                updated_at            = NOW()
         WHERE  id = $2`,
        [newAttempts, user.id],
      );

      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    // 5b. Success — reset failed attempts and issue token pair.
    await this.query(
      `UPDATE users
       SET    failed_login_attempts = 0,
              updated_at            = NOW()
       WHERE  id = $1`,
      [user.id],
    );

    // Clear any stale lockout key.
    await redis.del(lockoutKey);

    return this.issueTokenPair(user.id, user.role, user.email);
  }

  // -------------------------------------------------------------------------
  // Token refresh
  // -------------------------------------------------------------------------

  /**
   * Validate a refresh token and issue a new TokenPair.
   * Invalidates the old refresh token (rotation).
   *
   * @throws AppError(401, 'INVALID_REFRESH_TOKEN') — not found, expired, or revoked
   */
  async refreshTokens(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = this.hashRefreshToken(rawRefreshToken);

    const row = await this.queryOne<{ user_id: string; expires_at: Date; revoked: boolean }>(
      `SELECT user_id, expires_at, revoked
       FROM   refresh_tokens
       WHERE  token_hash = $1`,
      [tokenHash],
    );

    if (!row || row.revoked || new Date(row.expires_at) < new Date()) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or has expired.');
    }

    // Revoke old token.
    await this.query(
      `UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
      [tokenHash],
    );

    // Look up user to get role and email for the new access token.
    const user = await this.queryOne<User>(
      'SELECT id, role, email FROM users WHERE id = $1',
      [row.user_id],
    );

    if (!user) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or has expired.');
    }

    return this.issueTokenPair(user.id, user.role, user.email);
  }

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  /**
   * Revoke a refresh token (logout).
   * Silently succeeds if the token doesn't exist.
   */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(rawRefreshToken);

    await this.query(
      `UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
      [tokenHash],
    );
  }

  // -------------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------------

  /**
   * Generate a password-reset token and enqueue the reset email.
   *
   * Deliberately returns nothing (same response whether email exists or not)
   * to avoid user-enumeration attacks.
   */
  async requestPasswordReset(dto: RequestPasswordResetDTO): Promise<void> {
    const user = await this.queryOne<User>(
      'SELECT id, email FROM users WHERE email = $1',
      [dto.email.toLowerCase().trim()],
    );

    if (!user) {
      // Silently succeed — don't reveal whether the email is registered.
      return;
    }

    const resetToken = jwt.sign(
      { sub: user.id, purpose: 'password_reset' },
      env.JWT_RESET_SECRET,
      { expiresIn: env.JWT_RESET_EXPIRES_IN },
    );

    try {
      await enqueueEmail({
        type: 'PASSWORD_RESET' as never,
        userId: user.id,
        email: user.email,
        resetToken,
      } as never);
    } catch (queueErr) {
      console.error('[auth] Failed to enqueue password-reset email:', queueErr);
    }
  }

  /**
   * Validate the reset token, hash the new password, and persist it.
   *
   * @throws AppError(400, 'INVALID_OR_EXPIRED_TOKEN') — bad/expired token
   */
  async resetPassword(dto: ResetPasswordDTO): Promise<void> {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(dto.token, env.JWT_RESET_SECRET) as jwt.JwtPayload;
    } catch {
      throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'The password reset token is invalid or has expired.');
    }

    if (payload.purpose !== 'password_reset' || !payload.sub) {
      throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'The password reset token is invalid or has expired.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, env.BCRYPT_ROUNDS);

    const updated = await this.query<{ id: string }>(
      `UPDATE users
       SET    password_hash         = $1,
              failed_login_attempts = 0,
              updated_at            = NOW()
       WHERE  id = $2
       RETURNING id`,
      [passwordHash, payload.sub as string],
    );

    if (updated.length === 0) {
      throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'The password reset token is invalid or has expired.');
    }

    // Revoke all existing refresh tokens for this user for security.
    await this.query(
      `UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`,
      [payload.sub as string],
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Issue an access token + opaque refresh token pair.
   * Stores a SHA-256 hash of the refresh token in the `refresh_tokens` table.
   */
  private async issueTokenPair(userId: string, role: UserRole, email: string): Promise<TokenPair> {
    const accessToken = jwt.sign(
      { sub: userId, role, email },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN },
    );

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashRefreshToken(rawRefreshToken);

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

    await this.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /**
   * Return the SHA-256 hex digest of a raw refresh token.
   */
  private hashRefreshToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Translate a PostgreSQL driver error into a meaningful AppError.
   * Re-throws any error that is not handled here.
   */
  private handleDbError(err: unknown): never {
    // PostgreSQL unique-constraint violation
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === '23505'
    ) {
      throw new AppError(409, 'DUPLICATE_EMAIL', 'An account with that email already exists.');
    }
    throw err;
  }
}

// Singleton instance
export const authService = new AuthService();
