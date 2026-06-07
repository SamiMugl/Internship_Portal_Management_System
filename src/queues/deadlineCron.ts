/**
 * Deadline-enforcement cron job
 *
 * Registers a daily Bull repeatable job (00:00 UTC) that triggers
 * `ListingService.closeExpiredListings()`.
 *
 * Closed listings:
 *   - Were `published` AND (application_deadline < TODAY OR accepted_count >= openings)
 *   - Transitioned atomically to `closed` inside a DB transaction
 *   - Affected students (Submitted / Under_Review applications) receive a
 *     LISTING_CLOSED notification job
 *
 * Requirements: 4.4, 5.6, 9.6
 */

import Bull from 'bull';
import { env } from '../config/env';
import { listingService } from '../services/listingService';

// ---------------------------------------------------------------------------
// Queue — uses a mock when Redis is not available
// ---------------------------------------------------------------------------

const useMock =
  process.env.NODE_ENV === 'test' ||
  process.env.USE_REDIS_MOCK === 'true';

let deadlineCronQueue: Bull.Queue;

if (useMock) {
  console.log('[deadline-cron] Using in-memory queue mock (no Redis server required).');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MockQueue } = require('./mockQueue');
  deadlineCronQueue = new MockQueue('deadline-cron') as unknown as Bull.Queue;
} else {
  deadlineCronQueue = new Bull('deadline-cron', {
    redis: env.REDIS_URL,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000, // 1 s, 5 s, 25 s
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

  // Log queue-level errors.
  deadlineCronQueue.on('error', (err: Error) => {
    console.error('[deadline-cron] Queue error:', err.message);
  });

  deadlineCronQueue.on('failed', (_job: Bull.Job, err: Error) => {
    console.error('[deadline-cron] Job permanently failed:', err.message);
  });

  // Worker — processes CLOSE_EXPIRED_LISTINGS jobs (real queue only)
  deadlineCronQueue.process('CLOSE_EXPIRED_LISTINGS', async () => {
    console.log('[deadline-cron] Running closeExpiredListings …');
    await listingService.closeExpiredListings();
    console.log('[deadline-cron] closeExpiredListings completed.');
  });
}

// ---------------------------------------------------------------------------
// Register daily repeatable cron job (runs at midnight UTC every day)
// ---------------------------------------------------------------------------

/**
 * Register the deadline-enforcement cron job.
 *
 * Safe to call multiple times — Bull's `add` with a `repeat` option is
 * idempotent when the cron key stays constant.
 *
 * In mock mode this is a no-op (no real cron scheduling).
 * Call this once at application startup (see `src/server.ts`).
 */
export async function registerDeadlineCron(): Promise<void> {
  if (useMock) {
    console.log('[deadline-cron] Mock mode — skipping cron job registration.');
    return;
  }

  await deadlineCronQueue.add(
    'CLOSE_EXPIRED_LISTINGS',
    {},
    {
      repeat: {
        // Run at 00:00 UTC every day
        cron: '0 0 * * *',
      },
      jobId: 'deadline-cron-daily', // stable key prevents duplicate registrations
    },
  );
  console.log('[deadline-cron] Daily deadline-enforcement cron job registered.');
}

export { deadlineCronQueue };
