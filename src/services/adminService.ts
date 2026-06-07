/**
 * AdminService
 *
 * Provides admin-only business logic:
 *   - getDashboardCounts    — aggregate counts for the admin dashboard
 *   - getEmployers          — list all employer accounts with approval status
 *   - approveEmployer       — approve a pending employer account
 *   - rejectEmployer        — reject a pending employer account
 *   - deactivateAccount     — deactivate a student or employer account
 *   - getAuditLog           — retrieve paginated, filtered audit log entries
 *
 * All database access uses parameterised queries via BaseRepository to prevent
 * SQL injection.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7
 */

import { BaseRepository } from '../database/baseRepository';
import { ApprovalStatus, AuditAction, AuditLog, EmployerProfile, PaginatedResult, User, UserRole, UserStatus } from '../types';
import { AppError } from './authService';
import { enqueueEmail } from '../queues/emailQueue';
import { notificationService } from './notificationService';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface DashboardCounts {
  pendingEmployerAccounts: number;
  pendingListings: number;
  activeStudents: number;
  totalApplications: number;
}

export interface EmployerWithUser {
  /** employer_profiles.id */
  id: string;
  userId: string;
  email: string;
  userStatus: string;
  companyName: string;
  industry: string | null;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  contactPerson: string | null;
  sizeRange: string | null;
  approvalStatus: ApprovalStatus;
}

export interface DeactivateAccountResult {
  userId: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}

export interface AuditLogFilters {
  adminId?: string;
  targetType?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AuditLogEntry {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// AdminService
// ---------------------------------------------------------------------------

export class AdminService extends BaseRepository {
  // -------------------------------------------------------------------------
  // getDashboardCounts
  // -------------------------------------------------------------------------

  /**
   * Return aggregate counts for the admin dashboard:
   *   - pendingEmployerAccounts: employer_profiles with approval_status = 'pending'
   *   - pendingListings:         listings with status = 'pending'
   *   - activeStudents:          users with role = 'student' AND status = 'active'
   *   - totalApplications:       total rows in applications
   *
   * Requirement 8.1
   */
  async getDashboardCounts(): Promise<DashboardCounts> {
    const row = await this.queryOne<{
      pending_employer_accounts: string;
      pending_listings: string;
      active_students: string;
      total_applications: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM employer_profiles WHERE approval_status = 'pending')  AS pending_employer_accounts,
         (SELECT COUNT(*) FROM listings            WHERE status = 'pending')          AS pending_listings,
         (SELECT COUNT(*) FROM users               WHERE role = 'student' AND status = 'active') AS active_students,
         (SELECT COUNT(*) FROM applications)                                          AS total_applications`,
    );

    return {
      pendingEmployerAccounts: parseInt(row?.pending_employer_accounts ?? '0', 10),
      pendingListings:         parseInt(row?.pending_listings         ?? '0', 10),
      activeStudents:          parseInt(row?.active_students          ?? '0', 10),
      totalApplications:       parseInt(row?.total_applications       ?? '0', 10),
    };
  }

  // -------------------------------------------------------------------------
  // getEmployers
  // -------------------------------------------------------------------------

  /**
   * Return all employer profiles joined with their user record.
   * Includes email, user status, and approval_status.
   *
   * Requirement 8.2
   */
  async getEmployers(): Promise<EmployerWithUser[]> {
    const rows = await this.query<{
      id: string;
      user_id: string;
      email: string;
      user_status: string;
      company_name: string;
      industry: string | null;
      description: string | null;
      logo_url: string | null;
      website_url: string | null;
      contact_person: string | null;
      size_range: string | null;
      approval_status: ApprovalStatus;
    }>(
      `SELECT ep.id,
              ep.user_id,
              u.email,
              u.status          AS user_status,
              ep.company_name,
              ep.industry,
              ep.description,
              ep.logo_url,
              ep.website_url,
              ep.contact_person,
              ep.size_range,
              ep.approval_status
       FROM   employer_profiles ep
       JOIN   users u ON u.id = ep.user_id
       ORDER  BY ep.company_name ASC`,
    );

    return rows.map((r) => ({
      id:             r.id,
      userId:         r.user_id,
      email:          r.email,
      userStatus:     r.user_status,
      companyName:    r.company_name,
      industry:       r.industry,
      description:    r.description,
      logoUrl:        r.logo_url,
      websiteUrl:     r.website_url,
      contactPerson:  r.contact_person,
      sizeRange:      r.size_range,
      approvalStatus: r.approval_status,
    }));
  }

  // -------------------------------------------------------------------------
  // approveEmployer
  // -------------------------------------------------------------------------

  /**
   * Approve a pending employer account:
   *   1. Fetch the employer profile by employer_profiles.id — 404 if not found.
   *   2. Guard: only 'pending' accounts can be approved — 400 otherwise.
   *   3. Inside a transaction:
   *        a. UPDATE employer_profiles.approval_status = 'approved'
   *        b. UPDATE linked users.status = 'active'
   *        c. INSERT audit_log entry (action: APPROVE_EMPLOYER)
   *   4. Outside the transaction:
   *        a. Enqueue ACCOUNT_APPROVED email via NotificationService
   *        b. Create in-app notification for the employer user
   *
   * @param employerId  employer_profiles.id
   * @param adminId     users.id of the acting admin
   *
   * @throws AppError(404, 'EMPLOYER_NOT_FOUND')      — profile does not exist
   * @throws AppError(400, 'INVALID_STATUS_TRANSITION') — already approved/rejected
   *
   * Requirement 8.3
   */
  async approveEmployer(employerId: string, adminId: string): Promise<EmployerWithUser> {
    // 1. Fetch the employer profile.
    const profile = await this.queryOne<EmployerProfile & { user_id: string }>(
      `SELECT * FROM employer_profiles WHERE id = $1`,
      [employerId],
    );

    if (!profile) {
      throw new AppError(404, 'EMPLOYER_NOT_FOUND', 'Employer profile not found.');
    }

    // 2. Guard: only pending accounts can be approved.
    if (profile.approval_status !== ApprovalStatus.Pending) {
      throw new AppError(
        400,
        'INVALID_STATUS_TRANSITION',
        `Employer account is already ${profile.approval_status}. Only 'pending' accounts can be approved.`,
        { currentStatus: profile.approval_status },
      );
    }

    const userId = profile.user_id;

    // 3. Atomically update the profile, user status, and write the audit log.
    await this.transaction(async (client) => {
      await this.queryWithClient(
        client,
        `UPDATE employer_profiles
         SET    approval_status = 'approved'
         WHERE  id = $1`,
        [employerId],
      );

      await this.queryWithClient(
        client,
        `UPDATE users
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id         = $2`,
        [UserStatus.Active, userId],
      );

      await this.queryWithClient(
        client,
        `INSERT INTO audit_logs (admin_id, action, target_type, target_id)
         VALUES ($1, $2, 'employer', $3)`,
        [adminId, AuditAction.ApproveEmployer, employerId],
      );
    });

    // 4a. Enqueue the ACCOUNT_APPROVED notification email (non-fatal).
    try {
      await notificationService.enqueueEmail({ type: 'ACCOUNT_APPROVED', userId });
    } catch (err) {
      console.error('[admin] Failed to enqueue ACCOUNT_APPROVED email:', err);
    }

    // 4b. Create an in-app notification for the employer user (non-fatal).
    try {
      await notificationService.createNotification(
        userId,
        'ACCOUNT_APPROVED',
        { employerProfileId: employerId, message: 'Your employer account has been approved.' },
      );
    } catch (err) {
      console.error('[admin] Failed to create ACCOUNT_APPROVED in-app notification:', err);
    }

    // Return the updated employer record.
    const updated = await this.queryOne<{
      id: string;
      user_id: string;
      email: string;
      user_status: string;
      company_name: string;
      industry: string | null;
      description: string | null;
      logo_url: string | null;
      website_url: string | null;
      contact_person: string | null;
      size_range: string | null;
      approval_status: ApprovalStatus;
    }>(
      `SELECT ep.id,
              ep.user_id,
              u.email,
              u.status          AS user_status,
              ep.company_name,
              ep.industry,
              ep.description,
              ep.logo_url,
              ep.website_url,
              ep.contact_person,
              ep.size_range,
              ep.approval_status
       FROM   employer_profiles ep
       JOIN   users u ON u.id = ep.user_id
       WHERE  ep.id = $1`,
      [employerId],
    );

    return {
      id:             updated!.id,
      userId:         updated!.user_id,
      email:          updated!.email,
      userStatus:     updated!.user_status,
      companyName:    updated!.company_name,
      industry:       updated!.industry,
      description:    updated!.description,
      logoUrl:        updated!.logo_url,
      websiteUrl:     updated!.website_url,
      contactPerson:  updated!.contact_person,
      sizeRange:      updated!.size_range,
      approvalStatus: updated!.approval_status,
    };
  }

  // -------------------------------------------------------------------------
  // rejectEmployer
  // -------------------------------------------------------------------------

  /**
   * Reject a pending employer account:
   *   1. Fetch the employer profile by employer_profiles.id — 404 if not found.
   *   2. Guard: only 'pending' accounts can be rejected — 400 otherwise.
   *   3. Inside a transaction:
   *        a. UPDATE employer_profiles.approval_status = 'rejected'
   *        b. INSERT audit_log entry (action: REJECT_EMPLOYER, with reason)
   *   4. Outside the transaction:
   *        a. Enqueue ACCOUNT_REJECTED email via NotificationService (with reason)
   *        b. Create in-app notification for the employer user
   *
   * @param employerId  employer_profiles.id
   * @param adminId     users.id of the acting admin
   * @param reason      Human-readable rejection reason
   *
   * @throws AppError(404, 'EMPLOYER_NOT_FOUND')      — profile does not exist
   * @throws AppError(400, 'INVALID_STATUS_TRANSITION') — already approved/rejected
   *
   * Requirement 8.3
   */
  async rejectEmployer(
    employerId: string,
    adminId: string,
    reason: string,
  ): Promise<EmployerWithUser> {
    // 1. Fetch the employer profile.
    const profile = await this.queryOne<EmployerProfile & { user_id: string }>(
      `SELECT * FROM employer_profiles WHERE id = $1`,
      [employerId],
    );

    if (!profile) {
      throw new AppError(404, 'EMPLOYER_NOT_FOUND', 'Employer profile not found.');
    }

    // 2. Guard: only pending accounts can be rejected.
    if (profile.approval_status !== ApprovalStatus.Pending) {
      throw new AppError(
        400,
        'INVALID_STATUS_TRANSITION',
        `Employer account is already ${profile.approval_status}. Only 'pending' accounts can be rejected.`,
        { currentStatus: profile.approval_status },
      );
    }

    const userId = profile.user_id;

    // 3. Atomically update the profile and write the audit log.
    await this.transaction(async (client) => {
      await this.queryWithClient(
        client,
        `UPDATE employer_profiles
         SET    approval_status = 'rejected'
         WHERE  id = $1`,
        [employerId],
      );

      await this.queryWithClient(
        client,
        `INSERT INTO audit_logs (admin_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'employer', $3, $4)`,
        [adminId, AuditAction.RejectEmployer, employerId, reason],
      );
    });

    // 4a. Enqueue the ACCOUNT_REJECTED notification email (non-fatal).
    try {
      await notificationService.enqueueEmail({ type: 'ACCOUNT_REJECTED', userId, reason });
    } catch (err) {
      console.error('[admin] Failed to enqueue ACCOUNT_REJECTED email:', err);
    }

    // 4b. Create an in-app notification for the employer user (non-fatal).
    try {
      await notificationService.createNotification(
        userId,
        'ACCOUNT_REJECTED',
        { employerProfileId: employerId, reason, message: 'Your employer account application has been rejected.' },
      );
    } catch (err) {
      console.error('[admin] Failed to create ACCOUNT_REJECTED in-app notification:', err);
    }

    // Return the updated employer record.
    const updated = await this.queryOne<{
      id: string;
      user_id: string;
      email: string;
      user_status: string;
      company_name: string;
      industry: string | null;
      description: string | null;
      logo_url: string | null;
      website_url: string | null;
      contact_person: string | null;
      size_range: string | null;
      approval_status: ApprovalStatus;
    }>(
      `SELECT ep.id,
              ep.user_id,
              u.email,
              u.status          AS user_status,
              ep.company_name,
              ep.industry,
              ep.description,
              ep.logo_url,
              ep.website_url,
              ep.contact_person,
              ep.size_range,
              ep.approval_status
       FROM   employer_profiles ep
       JOIN   users u ON u.id = ep.user_id
       WHERE  ep.id = $1`,
      [employerId],
    );

    return {
      id:             updated!.id,
      userId:         updated!.user_id,
      email:          updated!.email,
      userStatus:     updated!.user_status,
      companyName:    updated!.company_name,
      industry:       updated!.industry,
      description:    updated!.description,
      logoUrl:        updated!.logo_url,
      websiteUrl:     updated!.website_url,
      contactPerson:  updated!.contact_person,
      sizeRange:      updated!.size_range,
      approvalStatus: updated!.approval_status,
    };
  }

  // -------------------------------------------------------------------------
  // deactivateAccount
  // -------------------------------------------------------------------------

  /**
   * Deactivate a student or employer account:
   *   1. Fetch the user by users.id — 404 if not found.
   *   2. Guard: admins cannot be deactivated — 403 CANNOT_DEACTIVATE_ADMIN.
   *   3. Guard: already deactivated accounts return 400 ACCOUNT_ALREADY_DEACTIVATED.
   *   4. Inside a transaction:
   *        a. UPDATE users.status = 'deactivated'
   *        b. INSERT audit_log entry (action: DEACTIVATE_ACCOUNT)
   *   5. Outside the transaction:
   *        a. Enqueue ACCOUNT_DEACTIVATED email notification (non-fatal)
   *        b. Create an in-app notification for the affected user (non-fatal)
   *
   * @param userId   users.id of the account to deactivate
   * @param adminId  users.id of the acting admin
   *
   * @throws AppError(404, 'USER_NOT_FOUND')               — user does not exist
   * @throws AppError(403, 'CANNOT_DEACTIVATE_ADMIN')      — target is an admin
   * @throws AppError(400, 'ACCOUNT_ALREADY_DEACTIVATED')  — already deactivated
   *
   * Requirements: 8.5, 8.6
   */
  async deactivateAccount(userId: string, adminId: string): Promise<DeactivateAccountResult> {
    // 1. Fetch the user.
    const user = await this.queryOne<User>(
      `SELECT * FROM users WHERE id = $1`,
      [userId],
    );

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    // 2. Guard: cannot deactivate admin accounts.
    if (user.role === UserRole.Admin) {
      throw new AppError(403, 'CANNOT_DEACTIVATE_ADMIN', 'Admin accounts cannot be deactivated.');
    }

    // 3. Guard: account must not already be deactivated.
    if (user.status === UserStatus.Deactivated) {
      throw new AppError(400, 'ACCOUNT_ALREADY_DEACTIVATED', 'This account is already deactivated.');
    }

    // Determine target_type for the audit log based on the user's role.
    const targetType = user.role === UserRole.Student ? 'student' : 'employer';

    // 4. Atomically update the user status and write the audit log.
    await this.transaction(async (client) => {
      await this.queryWithClient(
        client,
        `UPDATE users
         SET    status     = $1,
                updated_at = NOW()
         WHERE  id         = $2`,
        [UserStatus.Deactivated, userId],
      );

      await this.queryWithClient(
        client,
        `INSERT INTO audit_logs (admin_id, action, target_type, target_id)
         VALUES ($1, $2, $3, $4)`,
        [adminId, AuditAction.DeactivateAccount, targetType, userId],
      );
    });

    // Resolve the user's display name for email / notification payloads.
    const nameRow = await this.queryOne<{ name: string }>(
      `SELECT COALESCE(sp.full_name, ep.contact_person, u.email) AS name
       FROM   users u
       LEFT JOIN student_profiles  sp ON sp.user_id = u.id
       LEFT JOIN employer_profiles ep ON ep.user_id = u.id
       WHERE  u.id = $1`,
      [userId],
    );
    const name = nameRow?.name ?? user.email;

    // 5a. Enqueue the ACCOUNT_DEACTIVATED notification email (non-fatal).
    try {
      await enqueueEmail({
        type:   'ACCOUNT_DEACTIVATED',
        userId,
        email:  user.email,
        name,
      });
    } catch (err) {
      console.error('[admin] Failed to enqueue ACCOUNT_DEACTIVATED email:', err);
    }

    // 5b. Create an in-app notification for the affected user (non-fatal).
    try {
      await notificationService.createNotification(
        userId,
        'ACCOUNT_DEACTIVATED',
        { message: 'Your account has been deactivated by an administrator.' },
      );
    } catch (err) {
      console.error('[admin] Failed to create ACCOUNT_DEACTIVATED in-app notification:', err);
    }

    return {
      userId: user.id,
      email:  user.email,
      role:   user.role,
      status: UserStatus.Deactivated,
    };
  }

  // -------------------------------------------------------------------------
  // getAuditLog
  // -------------------------------------------------------------------------

  /**
   * Return a paginated, optionally filtered list of audit log entries,
   * sorted by timestamp DESC (most recent first).
   *
   * Filters (all optional):
   *   - adminId    — filter to entries performed by a specific admin (UUID)
   *   - targetType — filter by entity type (e.g. 'employer', 'listing', 'student')
   *   - dateFrom   — lower bound on timestamp (inclusive, ISO date/datetime string)
   *   - dateTo     — upper bound on timestamp (inclusive, ISO date/datetime string)
   *
   * @param filters   Optional filter criteria
   * @param page      1-based page number (default 1)
   * @param pageSize  Items per page (default 20, max 100)
   *
   * Requirement: 8.7
   */
  async getAuditLog(
    filters: AuditLogFilters,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    const safePage     = Math.max(1, page);
    const safePageSize = Math.min(100, Math.max(1, pageSize));
    const offset       = (safePage - 1) * safePageSize;

    // Build dynamic WHERE clauses.
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.adminId) {
      params.push(filters.adminId);
      conditions.push(`al.admin_id = $${params.length}`);
    }

    if (filters.targetType) {
      params.push(filters.targetType);
      conditions.push(`al.target_type = $${params.length}`);
    }

    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      conditions.push(`al.timestamp >= $${params.length}`);
    }

    if (filters.dateTo) {
      params.push(filters.dateTo);
      conditions.push(`al.timestamp <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matching rows.
    const countRow = await this.queryOne<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM   audit_logs al
       ${whereClause}`,
      params,
    );
    const total = parseInt(countRow?.total ?? '0', 10);

    // Fetch paginated data — join users to include adminEmail.
    const dataParams = [...params, safePageSize, offset];
    const rows = await this.query<{
      id: string;
      admin_id: string;
      admin_email: string;
      action: string;
      target_type: string;
      target_id: string;
      reason: string | null;
      timestamp: Date;
    }>(
      `SELECT al.id,
              al.admin_id,
              u.email  AS admin_email,
              al.action,
              al.target_type,
              al.target_id,
              al.reason,
              al.timestamp
       FROM   audit_logs al
       JOIN   users u ON u.id = al.admin_id
       ${whereClause}
       ORDER  BY al.timestamp DESC
       LIMIT  $${dataParams.length - 1}
       OFFSET $${dataParams.length}`,
      dataParams,
    );

    return {
      data: rows.map((r) => ({
        id:         r.id,
        adminId:    r.admin_id,
        adminEmail: r.admin_email,
        action:     r.action,
        targetType: r.target_type,
        targetId:   r.target_id,
        reason:     r.reason,
        timestamp:  r.timestamp,
      })),
      total,
      page:       safePage,
      pageSize:   safePageSize,
      totalPages: Math.ceil(total / safePageSize),
    };
  }

  /**
   * Get the first admin user — used for email-link quick-approve.
   */
  async getAdminUser(): Promise<{ id: string; email: string } | null> {
    return this.queryOne<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1`,
      [],
    );
  }
}

// Singleton instance
export const adminService = new AdminService();
