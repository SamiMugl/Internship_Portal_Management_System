/**
 * Bull queue for outbound email jobs.
 *
 * Consumers (email workers) will process jobs from the "email-notifications"
 * queue.  Producers call `enqueueEmail()` to add jobs without blocking the
 * HTTP request cycle.
 *
 * Job types used by the auth registration flow:
 *   - ACCOUNT_VERIFICATION  – sent to students after registration
 *   - ACCOUNT_APPROVAL_PENDING – sent to admins / recorded for employers after registration
 *
 * Additional notification-service job types (Requirement 9.2):
 *   - ACCOUNT_VERIFIED           – confirmation email once student verifies their address
 *   - ACCOUNT_APPROVED           – sent to employer when their account is approved by admin
 *   - ACCOUNT_REJECTED           – sent to employer when their account is rejected by admin
 *   - SHORTLIST_NOTIFICATION     – sent to student when shortlisted for a listing
 *   - INTERVIEW_SCHEDULED_NOTIFY – flat-field variant for NotificationService.enqueueEmail()
 *   - OFFER_RECEIVED_NOTIFY      – flat-field variant for NotificationService.enqueueEmail()
 */

import Bull from 'bull';
import { env } from '../config/env';

// ---------------------------------------------------------------------------
// Job payload types
// ---------------------------------------------------------------------------

export interface AccountVerificationJobData {
  type: 'ACCOUNT_VERIFICATION';
  userId: string;
  email: string;
  /** HMAC-signed JWT token embedded in the verification link */
  verificationToken: string;
}

export interface AccountApprovalPendingJobData {
  type: 'ACCOUNT_APPROVAL_PENDING';
  userId: string;
  email: string;
  companyName: string;
}

export interface AccountLockedJobData {
  type: 'ACCOUNT_LOCKED';
  userId: string;
  email: string;
  /** ISO-8601 timestamp of when the lockout expires */
  lockUntil: string;
}

export interface ListingApprovedJobData {
  type: 'LISTING_APPROVED';
  /** The employer's users.id (used for routing the email) */
  userId: string;
  email: string;
  listingId: string;
  listingTitle: string;
}

export interface ListingRejectedJobData {
  type: 'LISTING_REJECTED';
  /** The employer's users.id (used for routing the email) */
  userId: string;
  email: string;
  listingId: string;
  listingTitle: string;
  rejectionReason: string;
}

export interface ListingClosedJobData {
  type: 'LISTING_CLOSED';
  /** UUID of the listing that was closed */
  listingId: string;
  /** UUIDs of affected students (those with Submitted or Under_Review applications) */
  affectedStudentIds: string[];
}

export interface InterviewScheduledJobData {
  type: 'INTERVIEW_SCHEDULED';
  /** The student's users.id */
  userId: string;
  email: string;
  applicationId: string;
  interviewDetails: {
    scheduledAt: Date | string;
    mode: string;
    locationOrLink: string;
  };
}

export interface OfferReceivedJobData {
  type: 'OFFER_RECEIVED';
  /** The student's users.id */
  userId: string;
  email: string;
  applicationId: string;
  offerDetails: {
    startDate: Date | string;
    durationWeeks: number;
    stipend: number | null;
  };
}

export interface ApplicationStatusChangedJobData {
  type: 'APPLICATION_STATUS_CHANGED';
  /** The recipient's users.id (student for status updates, employer for accept/reject) */
  userId: string;
  email: string;
  applicationId: string;
  listingId: string;
  listingTitle: string;
  newStatus: string;
}

// ---------------------------------------------------------------------------
// Notification-service event types (Requirement 9.2)
// These are the flat-field shapes used by NotificationService.enqueueEmail()
// ---------------------------------------------------------------------------

export interface AccountVerifiedJobData {
  type: 'ACCOUNT_VERIFIED';
  userId: string;
  email: string;
  name: string;
}

export interface AccountApprovedJobData {
  type: 'ACCOUNT_APPROVED';
  userId: string;
  email: string;
  name: string;
}

export interface AccountRejectedJobData {
  type: 'ACCOUNT_REJECTED';
  userId: string;
  email: string;
  name: string;
  reason: string;
}

export interface ShortlistNotificationJobData {
  type: 'SHORTLIST_NOTIFICATION';
  userId: string;
  email: string;
  name: string;
  listingTitle: string;
  companyName: string;
}

export interface InterviewScheduledNotifyJobData {
  type: 'INTERVIEW_SCHEDULED_NOTIFY';
  userId: string;
  email: string;
  name: string;
  listingTitle: string;
  scheduledAt: string;
  mode: string;
  locationOrLink: string;
}

export interface OfferReceivedNotifyJobData {
  type: 'OFFER_RECEIVED_NOTIFY';
  userId: string;
  email: string;
  name: string;
  listingTitle: string;
  startDate: string;
  durationWeeks: number;
  stipend: number | null;
}

export interface AccountDeactivatedJobData {
  type: 'ACCOUNT_DEACTIVATED';
  userId: string;
  email: string;
  name: string;
}

export interface AdminEmployerPendingJobData {
  type: 'ADMIN_EMPLOYER_PENDING';
  userId: string;
  email: string;          // admin email
  companyName: string;
  employerEmail: string;  // the employer who registered
  employerId: string;     // employer_profiles.id for approve link
}

export type EmailJobData =
  | AccountVerificationJobData
  | AccountApprovalPendingJobData
  | AccountLockedJobData
  | ListingApprovedJobData
  | ListingRejectedJobData
  | ListingClosedJobData
  | InterviewScheduledJobData
  | OfferReceivedJobData
  | ApplicationStatusChangedJobData
  | AccountVerifiedJobData
  | AccountApprovedJobData
  | AccountRejectedJobData
  | ShortlistNotificationJobData
  | InterviewScheduledNotifyJobData
  | OfferReceivedNotifyJobData
  | AccountDeactivatedJobData
  | AdminEmployerPendingJobData;

// ---------------------------------------------------------------------------
// Queue instance
// ---------------------------------------------------------------------------

const useMock =
  process.env.NODE_ENV === 'test' ||
  process.env.USE_REDIS_MOCK === 'true';

let emailQueue: Bull.Queue<EmailJobData>;

if (useMock) {
  console.log('[email-queue] Using in-memory queue mock (no Redis server required).');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MockQueue } = require('./mockQueue');
  emailQueue = new MockQueue('email-notifications') as unknown as Bull.Queue<EmailJobData>;
} else {
  emailQueue = new Bull<EmailJobData>('email-notifications', {
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

  // Log queue-level errors so they don't become unhandled rejections.
  emailQueue.on('error', (err: Error) => {
    console.error('[email-queue] Queue error:', err.message);
  });

  emailQueue.on('failed', (job, err: Error) => {
    console.error(
      `[email-queue] Job ${job.id} (${(job.data as EmailJobData).type}) permanently failed:`,
      err.message,
    );
  });
}

export { emailQueue };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Add an email job to the queue.
 * Returns the created Bull Job instance.
 */
export async function enqueueEmail(data: EmailJobData): Promise<Bull.Job<EmailJobData>> {
  return emailQueue.add(data);
}
