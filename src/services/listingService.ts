/**
 * ListingService
 *
 * Provides business logic for internship listing management:
 *   - createListing       — create a new draft listing for an employer
 *   - updateListing       — update listing fields (reverts published → pending)
 *   - submitForReview     — transition draft → pending
 *   - deactivateListing   — transition to closed (hide from search, keep applications)
 *   - getEmployerListings — return all listings belonging to an employer
 *   - getPendingListings  — return all listings awaiting admin review (admin only)
 *   - approveListing      — publish a pending listing, write audit log, notify employer
 *   - rejectListing       — reject a pending listing, write audit log, notify employer
 *   - searchListings      — search/filter published listings with Redis caching
 *   - getListingById      — fetch a single published listing with remainingOpenings
 *
 * All database access uses parameterised queries via BaseRepository to prevent
 * SQL injection.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { BaseRepository } from '../database/baseRepository';
import { AuditAction, Listing, ListingStatus, ListingWithDetails, PaginatedResult } from '../types';
import { AppError } from './authService';
import { CreateListingDTO, ListingFilterDTO, UpdateListingDTO } from '../validators/listingValidators';
import { enqueueEmail } from '../queues/emailQueue';
import { redis } from '../config/redis';

// Redis key prefix for listing search cache
const CACHE_PREFIX = 'cache:listings:';
// 5-minute TTL in seconds
const CACHE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// ListingService
// ---------------------------------------------------------------------------

export class ListingService extends BaseRepository {
  // -------------------------------------------------------------------------
  // Private cache helpers
  // -------------------------------------------------------------------------

  /**
   * Invalidate all cached listing search results.
   *
   * Called whenever a listing's status changes so that stale results are not
   * served from the Redis cache.  Failures are logged but do not propagate —
   * cache invalidation is best-effort; correctness is guaranteed by the DB.
   */
  private async _invalidateListingCache(): Promise<void> {
    try {
      // SCAN for all cache:listings:* keys and delete them.
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await redis.scan(
          cursor,
          'MATCH',
          `${CACHE_PREFIX}*`,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      console.error('[listing] Failed to invalidate listing cache:', err);
    }
  }

  // -------------------------------------------------------------------------
  // createListing
  // -------------------------------------------------------------------------

  /**
   * Create a new internship listing in `draft` status for the authenticated
   * employer.
   *
   * The employer_id stored on the listing is the `employer_profiles.id` (not
   * the `users.id`).  We resolve it here so callers can simply pass the user
   * ID from the JWT.
   *
   * @throws AppError(404, 'EMPLOYER_PROFILE_NOT_FOUND') when no employer profile
   *         exists for the given userId.
   *
   * Requirement 4.1
   */
  async createListing(userId: string, dto: CreateListingDTO): Promise<Listing> {
    // Resolve employer_profiles.id from users.id.
    const employerProfile = await this.queryOne<{ id: string }>(
      `SELECT id FROM employer_profiles WHERE user_id = $1`,
      [userId],
    );

    if (!employerProfile) {
      throw new AppError(404, 'EMPLOYER_PROFILE_NOT_FOUND', 'Employer profile not found.');
    }

    const listing = await this.queryOne<Listing>(
      `INSERT INTO listings
         (employer_id, title, description, required_skills, duration_weeks,
          location, stipend_monthly, application_deadline, openings, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
       RETURNING *`,
      [
        employerProfile.id,
        dto.title,
        dto.description,
        dto.requiredSkills ?? [],
        dto.durationWeeks,
        dto.location,
        dto.stipendMonthly ?? null,
        dto.applicationDeadline,
        dto.openings,
      ],
    );

    return listing!;
  }

  // -------------------------------------------------------------------------
  // updateListing
  // -------------------------------------------------------------------------

  /**
   * Update the fields of an existing listing that belongs to the employer.
   *
   * Business rule (Requirement 4.5):
   *   If the current status is `published`, the update reverts it to `pending`
   *   for re-review by an administrator.
   *
   * Allowed statuses for editing: draft, published, rejected.
   * A listing with status `pending` (awaiting review) or `closed` cannot be
   * edited via this endpoint.
   *
   * @throws AppError(404, 'LISTING_NOT_FOUND')      — listing does not exist or
   *         does not belong to this employer.
   * @throws AppError(422, 'LISTING_NOT_EDITABLE')   — listing status does not
   *         permit editing.
   *
   * Requirements: 4.5
   */
  async updateListing(
    userId: string,
    listingId: string,
    dto: UpdateListingDTO,
  ): Promise<Listing> {
    // 1. Resolve employer profile.
    const employerProfile = await this.queryOne<{ id: string }>(
      `SELECT id FROM employer_profiles WHERE user_id = $1`,
      [userId],
    );

    if (!employerProfile) {
      throw new AppError(404, 'EMPLOYER_PROFILE_NOT_FOUND', 'Employer profile not found.');
    }

    // 2. Fetch the current listing, ensuring ownership.
    const existing = await this.queryOne<Listing>(
      `SELECT * FROM listings WHERE id = $1 AND employer_id = $2`,
      [listingId, employerProfile.id],
    );

    if (!existing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    // 3. Guard: listing must be in an editable state.
    const editableStatuses: ListingStatus[] = [
      ListingStatus.Draft,
      ListingStatus.Published,
      ListingStatus.Rejected,
    ];

    if (!editableStatuses.includes(existing.status)) {
      throw new AppError(
        422,
        'LISTING_NOT_EDITABLE',
        `A listing with status '${existing.status}' cannot be edited.`,
        { currentStatus: existing.status, editableStatuses },
      );
    }

    // 4. Build SET clause from provided DTO fields.
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const fieldMap: Record<keyof UpdateListingDTO, string> = {
      title:               'title',
      description:         'description',
      requiredSkills:      'required_skills',
      durationWeeks:       'duration_weeks',
      location:            'location',
      stipendMonthly:      'stipend_monthly',
      applicationDeadline: 'application_deadline',
      openings:            'openings',
    };

    for (const [dtoKey, columnName] of Object.entries(fieldMap) as [
      keyof UpdateListingDTO,
      string,
    ][]) {
      if (Object.prototype.hasOwnProperty.call(dto, dtoKey)) {
        setClauses.push(`${columnName} = $${paramIndex}`);
        const val = dto[dtoKey as keyof UpdateListingDTO];
        values.push(val === undefined ? null : val);
        paramIndex++;
      }
    }

    // 5. If the current status is `published`, revert to `pending` (Req 4.5).
    if (existing.status === ListingStatus.Published) {
      setClauses.push(`status = $${paramIndex}`);
      values.push(ListingStatus.Pending);
      paramIndex++;
    }

    // If nothing changed, return the existing listing as-is.
    if (setClauses.length === 0) {
      return existing;
    }

    // 6. Execute the UPDATE.
    values.push(listingId);
    const updated = await this.queryOne<Listing>(
      `UPDATE listings
       SET    ${setClauses.join(', ')}
       WHERE  id = $${paramIndex}
       RETURNING *`,
      values,
    );

    // Invalidate listing search cache whenever a listing changes.
    await this._invalidateListingCache();

    return updated!;
  }

  // -------------------------------------------------------------------------
  // submitForReview
  // -------------------------------------------------------------------------

  /**
   * Transition a listing from `draft` to `pending` for administrator review.
   *
   * @throws AppError(404, 'LISTING_NOT_FOUND')       — listing does not exist or
   *         does not belong to this employer.
   * @throws AppError(422, 'INVALID_STATUS_TRANSITION') — listing is not in `draft`
   *         status.
   *
   * Requirement 4.1
   */
  async submitForReview(userId: string, listingId: string): Promise<Listing> {
    // 1. Resolve employer profile.
    const employerProfile = await this.queryOne<{ id: string }>(
      `SELECT id FROM employer_profiles WHERE user_id = $1`,
      [userId],
    );

    if (!employerProfile) {
      throw new AppError(404, 'EMPLOYER_PROFILE_NOT_FOUND', 'Employer profile not found.');
    }

    // 2. Fetch the listing, ensuring ownership.
    const existing = await this.queryOne<Listing>(
      `SELECT * FROM listings WHERE id = $1 AND employer_id = $2`,
      [listingId, employerProfile.id],
    );

    if (!existing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    // 3. Only draft listings can be submitted for review.
    if (existing.status !== ListingStatus.Draft) {
      throw new AppError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Only listings in 'draft' status can be submitted for review. Current status: '${existing.status}'.`,
        { currentStatus: existing.status, requiredStatus: ListingStatus.Draft },
      );
    }

    // 4. Transition to pending.
    const updated = await this.queryOne<Listing>(
      `UPDATE listings
       SET    status = 'pending'
       WHERE  id     = $1
       RETURNING *`,
      [listingId],
    );

    await this._invalidateListingCache();

    return updated!;
  }

  // -------------------------------------------------------------------------
  // deactivateListing
  // -------------------------------------------------------------------------

  /**
   * Deactivate a listing by transitioning it to `closed` status.
   *
   * Effect (Requirement 4.6):
   *   - The listing is removed from student-facing search results (only
   *     `published` listings appear in search).
   *   - Existing applications are retained and unaffected.
   *
   * Listings that are already `closed` are silently left unchanged.
   *
   * @throws AppError(404, 'LISTING_NOT_FOUND') — listing does not exist or does
   *         not belong to this employer.
   *
   * Requirement 4.6
   */
  async deactivateListing(userId: string, listingId: string): Promise<Listing> {
    // 1. Resolve employer profile.
    const employerProfile = await this.queryOne<{ id: string }>(
      `SELECT id FROM employer_profiles WHERE user_id = $1`,
      [userId],
    );

    if (!employerProfile) {
      throw new AppError(404, 'EMPLOYER_PROFILE_NOT_FOUND', 'Employer profile not found.');
    }

    // 2. Fetch the listing, ensuring ownership.
    const existing = await this.queryOne<Listing>(
      `SELECT * FROM listings WHERE id = $1 AND employer_id = $2`,
      [listingId, employerProfile.id],
    );

    if (!existing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    // 3. Transition to closed (idempotent if already closed).
    if (existing.status === ListingStatus.Closed) {
      return existing;
    }

    const updated = await this.queryOne<Listing>(
      `UPDATE listings
       SET    status = 'closed'
       WHERE  id     = $1
       RETURNING *`,
      [listingId],
    );

    await this._invalidateListingCache();

    return updated!;
  }

  // -------------------------------------------------------------------------
  // getEmployerListings
  // -------------------------------------------------------------------------

  /**
   * Return all listings for the authenticated employer, ordered by most
   * recently created first.
   *
   * Requirement 4.7
   */
  async getEmployerListings(userId: string): Promise<Listing[]> {
    // Resolve employer profile.
    const employerProfile = await this.queryOne<{ id: string }>(
      `SELECT id FROM employer_profiles WHERE user_id = $1`,
      [userId],
    );

    if (!employerProfile) {
      throw new AppError(404, 'EMPLOYER_PROFILE_NOT_FOUND', 'Employer profile not found.');
    }

    const listings = await this.query<Listing>(
      `SELECT *
       FROM   listings
       WHERE  employer_id = $1
       ORDER  BY created_at DESC`,
      [employerProfile.id],
    );

    return listings;
  }

  // -------------------------------------------------------------------------
  // getListing (internal helper used by other services)
  // -------------------------------------------------------------------------

  /**
   * Return a single listing by ID, or throw 404 if not found.
   *
   * @throws AppError(404, 'LISTING_NOT_FOUND')
   */
  async getListing(listingId: string): Promise<Listing> {
    const listing = await this.queryOne<Listing>(
      `SELECT * FROM listings WHERE id = $1`,
      [listingId],
    );

    if (!listing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    return listing;
  }

  // -------------------------------------------------------------------------
  // getPendingListings (admin)
  // -------------------------------------------------------------------------

  /**
   * Return all listings that have `status = pending`, ordered by most recently
   * created first. Intended for use by the admin moderation dashboard.
   *
   * Requirement 4.2
   */
  async getPendingListings(): Promise<Listing[]> {
    return this.query<Listing>(
      `SELECT *
       FROM   listings
       WHERE  status = 'pending'
       ORDER  BY created_at DESC`,
    );
  }

  // -------------------------------------------------------------------------
  // approveListing (admin)
  // -------------------------------------------------------------------------

  /**
   * Approve a pending listing — transition its status to `published`, write an
   * immutable audit log entry, and enqueue an employer notification email.
   *
   * @param listingId - UUID of the listing to approve.
   * @param adminId   - UUID of the admin user performing the action (users.id).
   *
   * @throws AppError(404, 'LISTING_NOT_FOUND')          — listing does not exist.
   * @throws AppError(422, 'INVALID_STATUS_TRANSITION')  — listing is not in `pending` state.
   *
   * Requirement 4.2
   */
  async approveListing(listingId: string, adminId: string): Promise<Listing> {
    // 1. Fetch the listing.
    const existing = await this.queryOne<Listing>(
      `SELECT * FROM listings WHERE id = $1`,
      [listingId],
    );

    if (!existing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    if (existing.status !== ListingStatus.Pending) {
      throw new AppError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Only listings in 'pending' status can be approved. Current status: '${existing.status}'.`,
        { currentStatus: existing.status, requiredStatus: ListingStatus.Pending },
      );
    }

    // 2. Transition to published and write audit log atomically.
    let updated!: Listing;
    await this.transaction(async (client) => {
      updated = (await this.queryOneWithClient<Listing>(
        client,
        `UPDATE listings
         SET    status     = 'published',
                updated_at = NOW()
         WHERE  id         = $1
         RETURNING *`,
        [listingId],
      ))!;

      await this.queryWithClient(
        client,
        `INSERT INTO audit_logs (admin_id, action, target_type, target_id)
         VALUES ($1, $2, 'listing', $3)`,
        [adminId, AuditAction.ApproveListing, listingId],
      );
    });

    // 3. Enqueue employer notification email (outside the transaction so a
    //    queue failure does not roll back the approval).
    try {
      // Resolve the employer's user record (email + user id).
      const employer = await this.queryOne<{ user_id: string; email: string }>(
        `SELECT u.id AS user_id, u.email
         FROM   employer_profiles ep
         JOIN   users u ON u.id = ep.user_id
         WHERE  ep.id = $1`,
        [updated.employer_id],
      );

      if (employer) {
        await enqueueEmail({
          type: 'LISTING_APPROVED',
          userId: employer.user_id,
          email: employer.email,
          listingId: updated.id,
          listingTitle: updated.title,
        });
      }
    } catch (queueErr) {
      console.error('[listing] Failed to enqueue listing-approved email:', queueErr);
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // rejectListing (admin)
  // -------------------------------------------------------------------------

  /**
   * Reject a pending listing — set its status to `rejected`, store the
   * `rejection_reason`, write an immutable audit log entry, and enqueue an
   * employer notification email.
   *
   * @param listingId - UUID of the listing to reject.
   * @param adminId   - UUID of the admin user performing the action (users.id).
   * @param reason    - Human-readable rejection reason (stored on the listing and
   *                    in the audit log).
   *
   * @throws AppError(404, 'LISTING_NOT_FOUND')          — listing does not exist.
   * @throws AppError(422, 'INVALID_STATUS_TRANSITION')  — listing is not in `pending` state.
   *
   * Requirement 4.3
   */
  async rejectListing(listingId: string, adminId: string, reason: string): Promise<Listing> {
    // 1. Fetch the listing.
    const existing = await this.queryOne<Listing>(
      `SELECT * FROM listings WHERE id = $1`,
      [listingId],
    );

    if (!existing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    if (existing.status !== ListingStatus.Pending) {
      throw new AppError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Only listings in 'pending' status can be rejected. Current status: '${existing.status}'.`,
        { currentStatus: existing.status, requiredStatus: ListingStatus.Pending },
      );
    }

    // 2. Set status to rejected, store reason, and write audit log atomically.
    let updated!: Listing;
    await this.transaction(async (client) => {
      updated = (await this.queryOneWithClient<Listing>(
        client,
        `UPDATE listings
         SET    status           = 'rejected',
                rejection_reason = $1,
                updated_at       = NOW()
         WHERE  id               = $2
         RETURNING *`,
        [reason, listingId],
      ))!;

      await this.queryWithClient(
        client,
        `INSERT INTO audit_logs (admin_id, action, target_type, target_id, reason)
         VALUES ($1, $2, 'listing', $3, $4)`,
        [adminId, AuditAction.RejectListing, listingId, reason],
      );
    });

    // 3. Enqueue employer notification email (outside the transaction).
    try {
      const employer = await this.queryOne<{ user_id: string; email: string }>(
        `SELECT u.id AS user_id, u.email
         FROM   employer_profiles ep
         JOIN   users u ON u.id = ep.user_id
         WHERE  ep.id = $1`,
        [updated.employer_id],
      );

      if (employer) {
        await enqueueEmail({
          type: 'LISTING_REJECTED',
          userId: employer.user_id,
          email: employer.email,
          listingId: updated.id,
          listingTitle: updated.title,
          rejectionReason: reason,
        });
      }
    } catch (queueErr) {
      console.error('[listing] Failed to enqueue listing-rejected email:', queueErr);
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // closeExpiredListings (cron job)
  // -------------------------------------------------------------------------

  /**
   * Atomically close all published listings that have passed their application
   * deadline or whose accepted_count has reached (or exceeded) the number of
   * openings.
   *
   * For each listing that is closed, enqueue a LISTING_CLOSED notification job
   * for every student who has an application in status `Submitted` or
   * `Under_Review` against that listing.
   *
   * Called daily by the Bull cron job registered in `src/queues/deadlineCron.ts`.
   *
   * Requirements: 4.4, 5.6, 9.6
   */
  async closeExpiredListings(): Promise<void> {
    // 1. Find all published listings that should be closed.
    const expiredListings = await this.query<{ id: string; title: string }>(
      `SELECT id, title
       FROM   listings
       WHERE  status = 'published'
         AND  (application_deadline < CURRENT_DATE
              OR accepted_count >= openings)`,
    );

    if (expiredListings.length === 0) {
      return;
    }

    const listingIds = expiredListings.map((l) => l.id);

    // 2. Build placeholder list for the IN clause (e.g. $1, $2, ...).
    const placeholders = listingIds.map((_id, i) => `$${i + 1}`).join(', ');

    // 3. Atomically close all expired listings and find affected applications.
    let affectedApplications: { student_profile_id: string; listing_id: string }[] = [];
    await this.transaction(async (client) => {
      // Transition all expired listings to closed in a single statement.
      await this.queryWithClient(
        client,
        `UPDATE listings
         SET    status     = 'closed',
                updated_at = NOW()
         WHERE  id IN (${placeholders})`,
        listingIds,
      );

      // Collect all Submitted / Under_Review applications for those listings.
      // We need the student's user_id to send notifications, so join through
      // student_profiles.
      if (listingIds.length > 0) {
        affectedApplications = await this.queryWithClient<
          { student_profile_id: string; listing_id: string }
        >(
          client,
          `SELECT a.student_id AS student_profile_id, a.listing_id
           FROM   applications a
           WHERE  a.listing_id IN (${placeholders})
             AND  a.status IN ('Submitted', 'Under_Review')`,
          listingIds,
        );
      }
    });

    // 4. Invalidate the listing search cache after the DB changes are committed.
    await this._invalidateListingCache();

    // 5. Enqueue one LISTING_CLOSED notification job per listing that has
    //    affected students.  Group by listing_id to keep jobs manageable.
    const byListing = new Map<string, string[]>();
    for (const row of affectedApplications) {
      const existing = byListing.get(row.listing_id) ?? [];
      existing.push(row.student_profile_id);
      byListing.set(row.listing_id, existing);
    }

    for (const [listingId, studentProfileIds] of byListing.entries()) {
      if (studentProfileIds.length === 0) continue;

      // Resolve user IDs from student_profiles.id so the email worker can
      // look up addresses.
      const userRows = await this.query<{ user_id: string }>(
        `SELECT user_id
         FROM   student_profiles
         WHERE  id = ANY($1::uuid[])`,
        [studentProfileIds],
      );
      const studentUserIds = userRows.map((r) => r.user_id);

      try {
        await enqueueEmail({
          type: 'LISTING_CLOSED',
          listingId,
          affectedStudentIds: studentUserIds,
        });
      } catch (err) {
        console.error(
          `[listing] Failed to enqueue LISTING_CLOSED notification for listing ${listingId}:`,
          err,
        );
      }
    }

    console.log(
      `[listing] closeExpiredListings: closed ${listingIds.length} listing(s). ` +
        `Notified ${affectedApplications.length} affected application(s).`,
    );
  }

  // -------------------------------------------------------------------------
  // searchListings (student-facing public search)
  // -------------------------------------------------------------------------

  /**
   * Search and filter published internship listings with Redis-backed caching.
   *
   * Supports keyword search (title, description, required_skills), industry,
   * location, duration range, stipend range, skills overlap, deadline filter,
   * and pagination.
   *
   * Results are cached in Redis for CACHE_TTL_SECONDS (300 s / 5 min).
   * The cache is invalidated whenever any listing's status changes via
   * _invalidateListingCache().
   *
   * @param filters - Validated filter/pagination options from listingFilterSchema.
   * @returns PaginatedResult containing ListingWithDetails rows.
   *
   * Requirements: 5.1, 5.2, 5.3, 5.5
   */
  async searchListings(filters: ListingFilterDTO): Promise<PaginatedResult<ListingWithDetails>> {
    // ------------------------------------------------------------------
    // 1. Build cache key from serialised filters and try Redis first.
    // ------------------------------------------------------------------
    const cacheKey = `${CACHE_PREFIX}${JSON.stringify(filters)}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as PaginatedResult<ListingWithDetails>;
      }
    } catch (cacheErr) {
      // Cache read failures are non-fatal; fall through to DB.
      console.error('[listing] Cache read error:', cacheErr);
    }

    // ------------------------------------------------------------------
    // 2. Build dynamic WHERE clauses (parameterised).
    // ------------------------------------------------------------------
    const whereClauses: string[] = [`l.status = 'published'`];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.keyword) {
      const kw = `%${filters.keyword}%`;
      params.push(kw);
      whereClauses.push(
        `(l.title ILIKE $${paramIndex} OR l.description ILIKE $${paramIndex} OR l.required_skills::text ILIKE $${paramIndex})`,
      );
      paramIndex++;
    }

    if (filters.industry) {
      params.push(filters.industry);
      whereClauses.push(`ep.industry ILIKE $${paramIndex}`);
      paramIndex++;
    }

    if (filters.location) {
      params.push(`%${filters.location}%`);
      whereClauses.push(`l.location ILIKE $${paramIndex}`);
      paramIndex++;
    }

    if (filters.durationWeeksMin !== undefined) {
      params.push(filters.durationWeeksMin);
      whereClauses.push(`l.duration_weeks >= $${paramIndex}`);
      paramIndex++;
    }

    if (filters.durationWeeksMax !== undefined) {
      params.push(filters.durationWeeksMax);
      whereClauses.push(`l.duration_weeks <= $${paramIndex}`);
      paramIndex++;
    }

    if (filters.stipendMonthlyMin !== undefined) {
      params.push(filters.stipendMonthlyMin);
      whereClauses.push(`l.stipend_monthly >= $${paramIndex}`);
      paramIndex++;
    }

    if (filters.stipendMonthlyMax !== undefined) {
      params.push(filters.stipendMonthlyMax);
      whereClauses.push(`l.stipend_monthly <= $${paramIndex}`);
      paramIndex++;
    }

    if (filters.skills && filters.skills.length > 0) {
      params.push(filters.skills);
      whereClauses.push(`l.required_skills && $${paramIndex}::text[]`);
      paramIndex++;
    }

    if (filters.deadlineBefore) {
      params.push(filters.deadlineBefore);
      whereClauses.push(`l.application_deadline <= $${paramIndex}`);
      paramIndex++;
    }

    const whereSQL = whereClauses.join(' AND ');

    // ------------------------------------------------------------------
    // 3. COUNT query (no ORDER BY / LIMIT needed for total).
    // ------------------------------------------------------------------
    const countSQL = `
      SELECT COUNT(*) AS total
      FROM   listings l
      JOIN   employer_profiles ep ON ep.id = l.employer_id
      WHERE  ${whereSQL}
    `;

    const countRow = await this.queryOne<{ total: string }>(countSQL, params);
    const total = parseInt(countRow?.total ?? '0', 10);

    // ------------------------------------------------------------------
    // 4. Data query with ORDER BY, LIMIT, OFFSET.
    // ------------------------------------------------------------------
    const page     = filters.page;
    const pageSize = filters.pageSize;
    const offset   = (page - 1) * pageSize;

    params.push(pageSize);
    const limitParam = paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex++;

    const dataSQL = `
      SELECT
        l.*,
        ep.industry    AS employer_industry,
        ep.company_name,
        (l.openings - l.accepted_count) AS remaining_openings
      FROM   listings l
      JOIN   employer_profiles ep ON ep.id = l.employer_id
      WHERE  ${whereSQL}
      ORDER  BY l.created_at DESC
      LIMIT  $${limitParam} OFFSET $${offsetParam}
    `;

    const rows = await this.query<ListingWithDetails>(dataSQL, params);

    // ------------------------------------------------------------------
    // 5. Assemble result and cache it.
    // ------------------------------------------------------------------
    const result: PaginatedResult<ListingWithDetails> = {
      data:       rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };

    try {
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));
    } catch (cacheErr) {
      // Cache write failures are non-fatal.
      console.error('[listing] Cache write error:', cacheErr);
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // getListingById (student-facing detail view)
  // -------------------------------------------------------------------------

  /**
   * Fetch a single listing by ID, joining employer profile details and
   * computing the derived `remaining_openings` field.
   *
   * No status filter is applied here — callers (route handlers) are responsible
   * for any status-based access control.
   *
   * @param listingId - UUID of the listing.
   * @returns ListingWithDetails including employer profile fields and remaining_openings.
   * @throws AppError(404, 'LISTING_NOT_FOUND') if no listing with that ID exists.
   *
   * Requirement 5.4
   */
  async getListingById(listingId: string): Promise<ListingWithDetails> {
    const listing = await this.queryOne<ListingWithDetails>(
      `SELECT
         l.*,
         ep.industry        AS employer_industry,
         ep.company_name,
         ep.description     AS company_description,
         ep.logo_url,
         ep.website_url,
         (l.openings - l.accepted_count) AS remaining_openings
       FROM   listings l
       JOIN   employer_profiles ep ON ep.id = l.employer_id
       WHERE  l.id = $1`,
      [listingId],
    );

    if (!listing) {
      throw new AppError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    }

    return listing;
  }
}

// Singleton instance
export const listingService = new ListingService();
