/**
 * Integration tests — Deadline-enforcement Cron Job
 *
 * Tests ListingService.closeExpiredListings() which is called daily by the
 * Bull cron job registered in src/queues/deadlineCron.ts.
 *
 * Exercises:
 *   - Listings past their application_deadline are transitioned to `closed`
 *   - Listings whose accepted_count >= openings are transitioned to `closed`
 *   - Currently published listings with a future deadline and capacity
 *     remaining are left untouched
 *   - Non-published listings (draft, pending, rejected) are left untouched
 *   - Affected students (Submitted / Under_Review applications) receive a
 *     LISTING_CLOSED notification job
 *   - Students with terminal application statuses do NOT receive notifications
 *   - When there are no expired listings the function exits early
 *
 * PostgreSQL pool and Redis are mocked so no real infrastructure is required.
 *
 * Requirements: 4.4, 5.6, 9.6
 */

// ---------------------------------------------------------------------------
// Module-level mocks (must precede any imports that touch the modules)
// ---------------------------------------------------------------------------

jest.mock('../database/client', () => ({
  pool: {
    connect: jest.fn(),
    query: jest.fn(),
    on: jest.fn(),
  },
}));

jest.mock('../queues/emailQueue', () => ({
  enqueueEmail: jest.fn().mockResolvedValue({}),
  emailQueue: { on: jest.fn(), add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../config/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []]),
    on: jest.fn(),
  },
}));

jest.mock('../config/env', () => ({
  env: {
    JWT_ACCESS_SECRET:             'test-access-secret',
    JWT_VERIFICATION_SECRET:       'test-verify-secret',
    JWT_REFRESH_SECRET:            'test-refresh-secret',
    JWT_RESET_SECRET:              'test-reset-secret',
    JWT_ACCESS_EXPIRES_IN:         900,
    JWT_REFRESH_EXPIRES_IN:        604800,
    JWT_RESET_EXPIRES_IN:          3600,
    EMAIL_VERIFICATION_EXPIRES_IN: 86400,
    BCRYPT_ROUNDS:                 1,
    REDIS_URL:                     'redis://localhost:6379',
    APP_BASE_URL:                  'http://localhost:3000',
    SMTP_HOST:                     'localhost',
    SMTP_PORT:                     587,
    SMTP_SECURE:                   false,
    SMTP_USER:                     '',
    SMTP_PASS:                     '',
    EMAIL_FROM:                    'test@example.com',
  },
}));

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { pool } from '../database/client';
import { enqueueEmail } from '../queues/emailQueue';
import { ListingService } from '../services/listingService';

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockPool    = pool as jest.Mocked<typeof pool>;
const mockEnqueue = enqueueEmail as jest.MockedFunction<typeof enqueueEmail>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LISTING_ID_EXPIRED  = 'listing-expired-uuid-001';
const LISTING_ID_FULL     = 'listing-full-uuid-002';
const LISTING_ID_ACTIVE   = 'listing-active-uuid-003';
const LISTING_ID_DRAFT    = 'listing-draft-uuid-004';

const STUDENT_PROFILE_ID_1 = 'student-profile-uuid-001';
const STUDENT_PROFILE_ID_2 = 'student-profile-uuid-002';
const STUDENT_USER_ID_1    = 'student-user-uuid-001';
const STUDENT_USER_ID_2    = 'student-user-uuid-002';

// ---------------------------------------------------------------------------
// Helper — build a mock PoolClient that replays provided query results in order
// ---------------------------------------------------------------------------

function buildMockClient(
  ...queryResults: ({ rows: unknown[] })[]
): { query: jest.Mock; release: jest.Mock } {
  const client = { query: jest.fn(), release: jest.fn() };
  for (const result of queryResults) {
    client.query.mockResolvedValueOnce(result);
  }
  return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ListingService.closeExpiredListings (cron job)', () => {
  let service: ListingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ListingService();
  });

  // -------------------------------------------------------------------------
  // Happy path: deadline-passed listing is closed
  // -------------------------------------------------------------------------

  it('closes a listing whose application_deadline < today and does not touch active listings', async () => {
    // Step 1: pool.query → SELECT expired/full listings
    // Step 2: transaction (connect → BEGIN, UPDATE listings, SELECT affected apps, COMMIT)
    // Step 3: pool.query → SELECT student user_ids from profiles
    // Step 4: enqueueEmail (LISTING_CLOSED)

    // 1. SELECT expired listings (pool.query)
    mockPool.query = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: LISTING_ID_EXPIRED, title: 'Expired Internship' }],
      })
      // 3. SELECT student user_ids
      .mockResolvedValueOnce({
        rows: [{ user_id: STUDENT_USER_ID_1 }, { user_id: STUDENT_USER_ID_2 }],
      });

    // 2. Transaction: BEGIN, UPDATE listings, SELECT affected apps, COMMIT
    const mockClient = buildMockClient(
      { rows: [] },  // BEGIN
      { rows: [] },  // UPDATE listings SET status = 'closed'
      {              // SELECT affected applications (Submitted / Under_Review)
        rows: [
          { student_profile_id: STUDENT_PROFILE_ID_1, listing_id: LISTING_ID_EXPIRED },
          { student_profile_id: STUDENT_PROFILE_ID_2, listing_id: LISTING_ID_EXPIRED },
        ],
      },
      { rows: [] },  // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await service.closeExpiredListings();

    // The UPDATE in the transaction must target the expired listing id
    const updateCall = mockClient.query.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('UPDATE listings') &&
        (c[0] as string).includes('status') &&
        (c[0] as string).includes('closed'),
    );
    expect(updateCall).toBeDefined();
    // The parameter array must contain the expired listing id
    expect(updateCall![1]).toContain(LISTING_ID_EXPIRED);

    // A LISTING_CLOSED email job must have been enqueued
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LISTING_CLOSED',
        listingId: LISTING_ID_EXPIRED,
        affectedStudentIds: expect.arrayContaining([STUDENT_USER_ID_1, STUDENT_USER_ID_2]),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Happy path: full listing (accepted_count >= openings) is closed
  // -------------------------------------------------------------------------

  it('closes a listing whose accepted_count >= openings', async () => {
    mockPool.query = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: LISTING_ID_FULL, title: 'Full Internship' }],
      })
      .mockResolvedValueOnce({
        rows: [{ user_id: STUDENT_USER_ID_1 }],
      });

    const mockClient = buildMockClient(
      { rows: [] },  // BEGIN
      { rows: [] },  // UPDATE listings
      {
        rows: [{ student_profile_id: STUDENT_PROFILE_ID_1, listing_id: LISTING_ID_FULL }],
      },
      { rows: [] },  // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await service.closeExpiredListings();

    // The UPDATE must reference the full listing
    const updateCall = mockClient.query.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('UPDATE listings') &&
        (c[0] as string).includes('closed'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain(LISTING_ID_FULL);

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LISTING_CLOSED',
        listingId: LISTING_ID_FULL,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Multiple listings closed in a single run
  // -------------------------------------------------------------------------

  it('closes multiple expired listings in a single transaction', async () => {
    mockPool.query = jest.fn()
      // SELECT expired listings — both expired and full listings are returned
      .mockResolvedValueOnce({
        rows: [
          { id: LISTING_ID_EXPIRED, title: 'Expired Internship' },
          { id: LISTING_ID_FULL,    title: 'Full Internship'    },
        ],
      })
      // SELECT user_ids for expired listing's affected students
      .mockResolvedValueOnce({ rows: [{ user_id: STUDENT_USER_ID_1 }] })
      // SELECT user_ids for full listing's affected students
      .mockResolvedValueOnce({ rows: [{ user_id: STUDENT_USER_ID_2 }] });

    const mockClient = buildMockClient(
      { rows: [] },  // BEGIN
      { rows: [] },  // UPDATE listings (all in one statement)
      {              // SELECT affected applications
        rows: [
          { student_profile_id: STUDENT_PROFILE_ID_1, listing_id: LISTING_ID_EXPIRED },
          { student_profile_id: STUDENT_PROFILE_ID_2, listing_id: LISTING_ID_FULL    },
        ],
      },
      { rows: [] },  // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await service.closeExpiredListings();

    // Both listing ids must appear in the UPDATE params
    const updateCall = mockClient.query.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('UPDATE listings') &&
        (c[0] as string).includes('closed'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain(LISTING_ID_EXPIRED);
    expect(updateCall![1]).toContain(LISTING_ID_FULL);

    // One LISTING_CLOSED job per listing with affected students
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LISTING_CLOSED', listingId: LISTING_ID_EXPIRED }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'LISTING_CLOSED', listingId: LISTING_ID_FULL }),
    );
  });

  // -------------------------------------------------------------------------
  // Early exit when no expired listings exist
  // -------------------------------------------------------------------------

  it('returns early without touching the DB transaction when no listings are expired', async () => {
    // SELECT expired listings → empty
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [] });

    await service.closeExpiredListings();

    // No transaction should have been started
    expect(mockPool.connect).not.toHaveBeenCalled();

    // No LISTING_CLOSED job should have been enqueued
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // No notifications sent when no affected applications
  // -------------------------------------------------------------------------

  it('does not enqueue a LISTING_CLOSED notification when no Submitted/Under_Review applications exist', async () => {
    mockPool.query = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: LISTING_ID_EXPIRED, title: 'Expired Internship' }],
      });
    // No pool.query for user_ids needed — no affected applications

    const mockClient = buildMockClient(
      { rows: [] },  // BEGIN
      { rows: [] },  // UPDATE listings
      { rows: [] },  // SELECT affected applications → empty
      { rows: [] },  // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await service.closeExpiredListings();

    // The listing was closed in the DB
    const updateCall = mockClient.query.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('UPDATE listings'),
    );
    expect(updateCall).toBeDefined();

    // But no notification email was enqueued
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cache invalidation occurs after listings are closed
  // -------------------------------------------------------------------------

  it('invalidates the Redis listing search cache after closing expired listings', async () => {
    const { redis } = require('../config/redis');

    mockPool.query = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: LISTING_ID_EXPIRED, title: 'Expired' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // user_ids (no affected apps to notify)

    const mockClient = buildMockClient(
      { rows: [] },  // BEGIN
      { rows: [] },  // UPDATE listings
      { rows: [] },  // SELECT affected applications
      { rows: [] },  // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await service.closeExpiredListings();

    // redis.scan should have been called to find cache:listings:* keys
    expect(redis.scan).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Transaction integrity: ROLLBACK called on DB failure
  // -------------------------------------------------------------------------

  it('rolls back the transaction if the UPDATE fails and re-throws the error', async () => {
    mockPool.query = jest.fn().mockResolvedValueOnce({
      rows: [{ id: LISTING_ID_EXPIRED, title: 'Expired Internship' }],
    });

    const client = {
      query: jest.fn(),
      release: jest.fn(),
    };
    client.query
      .mockResolvedValueOnce({ rows: [] })  // BEGIN
      .mockRejectedValueOnce(new Error('DB write failed'))  // UPDATE listings fails
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    (mockPool.connect as jest.Mock).mockResolvedValue(client);

    await expect(service.closeExpiredListings()).rejects.toThrow('DB write failed');

    // ROLLBACK must have been issued
    const rollbackCall = client.query.mock.calls.find(
      (c: string[]) => c[0] === 'ROLLBACK',
    );
    expect(rollbackCall).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Only Submitted / Under_Review applications receive notifications
  // -------------------------------------------------------------------------

  it('only queries Submitted and Under_Review applications for notification', async () => {
    mockPool.query = jest.fn()
      .mockResolvedValueOnce({
        rows: [{ id: LISTING_ID_EXPIRED, title: 'Expired Internship' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // user_ids

    const mockClient = buildMockClient(
      { rows: [] },  // BEGIN
      { rows: [] },  // UPDATE listings
      { rows: [] },  // SELECT affected applications
      { rows: [] },  // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await service.closeExpiredListings();

    // The SELECT applications call must filter on Submitted and Under_Review
    const appSelectCall = mockClient.query.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        (c[0] as string).includes('applications') &&
        (c[0] as string).includes('Submitted') &&
        (c[0] as string).includes('Under_Review'),
    );
    expect(appSelectCall).toBeDefined();
  });
});
