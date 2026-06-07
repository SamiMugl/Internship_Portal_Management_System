/**
 * Email Worker
 *
 * Registers a Bull processor on the `email-notifications` queue that sends
 * transactional emails via nodemailer.
 *
 * Covered job types (Requirement 9.2):
 *   - ACCOUNT_VERIFICATION      — verify email link sent to students after registration
 *   - ACCOUNT_APPROVAL_PENDING  — confirmation to employer that their account is under review
 *   - ACCOUNT_LOCKED            — lockout notice after three failed login attempts
 *   - LISTING_APPROVED          — employer notified when their listing is published
 *   - LISTING_REJECTED          — employer notified when their listing is rejected
 *   - LISTING_CLOSED            — students notified when a listing they applied to closes
 *   - INTERVIEW_SCHEDULED       — student notified when an interview is scheduled
 *   - OFFER_RECEIVED            — student notified of an internship offer
 *   - APPLICATION_STATUS_CHANGED — student or employer notified of a status change
 *
 * Retry policy (configured on the queue in emailQueue.ts):
 *   - attempts: 3
 *   - backoff: exponential, starting at 1 s  (1 s → 5 s → 25 s)
 *   - Permanently failed jobs are logged by the `failed` handler in emailQueue.ts
 *
 * Requirements: 9.2
 */

import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { getMailTransporter, getPublicAppUrl } from '../config/mailTransport';
import {
  emailQueue,
  EmailJobData,
  AccountVerificationJobData,
  AccountApprovalPendingJobData,
  AccountLockedJobData,
  ListingApprovedJobData,
  ListingRejectedJobData,
  ListingClosedJobData,
  InterviewScheduledJobData,
  OfferReceivedJobData,
  ApplicationStatusChangedJobData,
  AccountVerifiedJobData,
  AccountApprovedJobData,
  AccountRejectedJobData,
  ShortlistNotificationJobData,
  InterviewScheduledNotifyJobData,
  OfferReceivedNotifyJobData,
  AccountDeactivatedJobData,
} from './emailQueue';
import { BaseRepository } from '../database/baseRepository';

// ---------------------------------------------------------------------------
// DB helper — used by LISTING_CLOSED to resolve student email addresses
// ---------------------------------------------------------------------------

class EmailWorkerRepository extends BaseRepository {}
const repo = new EmailWorkerRepository();

// ---------------------------------------------------------------------------
// Email content generators
// ---------------------------------------------------------------------------

interface EmailContent {
  subject: string;
  html: string;
}

function buildVerificationEmail(data: AccountVerificationJobData): EmailContent {
  const verifyUrl = `${getPublicAppUrl()}/api/v1/auth/verify-email?token=${data.verificationToken}`;
  return {
    subject: 'Verify your Internship Portal email address',
    html: `
      <h2>Welcome to the Internship Portal!</h2>
      <p>Please verify your email address by clicking the link below.
         The link expires in 24 hours.</p>
      <p><a href="${verifyUrl}" style="padding:10px 20px;background:#2563eb;color:#fff;border-radius:4px;text-decoration:none;">
        Verify Email Address
      </a></p>
      <p>If you did not create an account, please ignore this email.</p>
    `,
  };
}

function buildApprovalPendingEmail(data: AccountApprovalPendingJobData): EmailContent {
  return {
    subject: 'Your Internship Portal employer account is under review',
    html: `
      <h2>Thank you for registering, ${data.companyName}!</h2>
      <p>Your employer account is currently pending administrator approval.
         You will receive another email once your account has been reviewed.</p>
      <p>This process typically takes 1–2 business days.</p>
    `,
  };
}

function buildAccountLockedEmail(data: AccountLockedJobData): EmailContent {
  const lockUntil = new Date(data.lockUntil).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return {
    subject: 'Internship Portal — Account temporarily locked',
    html: `
      <h2>Account Temporarily Locked</h2>
      <p>Your account has been temporarily locked due to too many failed
         login attempts.</p>
      <p><strong>Locked until:</strong> ${lockUntil} (UTC)</p>
      <p>If you did not attempt to log in, please reset your password immediately
         using the link on the login page.</p>
    `,
  };
}

function buildListingApprovedEmail(data: ListingApprovedJobData): EmailContent {
  return {
    subject: `Your listing "${data.listingTitle}" has been approved`,
    html: `
      <h2>Listing Approved</h2>
      <p>Your internship listing <strong>${data.listingTitle}</strong> has been
         approved by our administrators and is now published on the portal.</p>
      <p>Students can now discover and apply to your listing.</p>
    `,
  };
}

function buildListingRejectedEmail(data: ListingRejectedJobData): EmailContent {
  return {
    subject: `Your listing "${data.listingTitle}" was not approved`,
    html: `
      <h2>Listing Not Approved</h2>
      <p>Unfortunately, your internship listing <strong>${data.listingTitle}</strong>
         was not approved.</p>
      <p><strong>Reason:</strong> ${data.rejectionReason}</p>
      <p>You may update the listing to address the issue and resubmit it for review.</p>
    `,
  };
}

function buildInterviewScheduledEmail(data: InterviewScheduledJobData): EmailContent {
  const { scheduledAt, mode, locationOrLink } = data.interviewDetails;
  const scheduledDate = new Date(scheduledAt).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const modeLabel = mode === 'online' ? 'Online' : 'In-Person';
  const locationLabel = mode === 'online' ? 'Meeting Link' : 'Location';

  return {
    subject: 'You have an interview scheduled — Internship Portal',
    html: `
      <h2>Interview Scheduled</h2>
      <p>An interview has been scheduled for your application.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Date &amp; Time</td>
          <td style="padding:6px 12px;">${scheduledDate} (UTC)</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Mode</td>
          <td style="padding:6px 12px;">${modeLabel}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">${locationLabel}</td>
          <td style="padding:6px 12px;">${locationOrLink}</td>
        </tr>
      </table>
      <p>Please ensure you are available at the scheduled time. Log in to the portal
         for full application details.</p>
    `,
  };
}

function buildOfferReceivedEmail(data: OfferReceivedJobData): EmailContent {
  const { startDate, durationWeeks, stipend } = data.offerDetails;
  const startDateStr = new Date(startDate).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'long',
  });
  const stipendStr = stipend != null
    ? `$${Number(stipend).toLocaleString('en-US', { minimumFractionDigits: 2 })} / month`
    : 'Unpaid';

  return {
    subject: 'Congratulations! You have received an internship offer',
    html: `
      <h2>You Have Received an Internship Offer 🎉</h2>
      <p>An employer has extended an internship offer to you. Here are the details:</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Start Date</td>
          <td style="padding:6px 12px;">${startDateStr}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Duration</td>
          <td style="padding:6px 12px;">${durationWeeks} week${durationWeeks !== 1 ? 's' : ''}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Stipend</td>
          <td style="padding:6px 12px;">${stipendStr}</td>
        </tr>
      </table>
      <p>Log in to the portal to accept or reject this offer.</p>
    `,
  };
}

function buildApplicationStatusChangedEmail(data: ApplicationStatusChangedJobData): EmailContent {
  const statusLabels: Record<string, string> = {
    Submitted:            'Submitted ✅',
    Under_Review:         'Under Review 🔍',
    Shortlisted:          'Shortlisted ⭐',
    Interview_Scheduled:  'Interview Scheduled 📅',
    Offered:              'Offered 🎁',
    Accepted:             'Accepted 🏆',
    Rejected:             'Not Selected ❌',
    Withdrawn:            'Withdrawn',
  };
  const statusLabel = statusLabels[data.newStatus] ?? data.newStatus;

  const isAccepted = data.newStatus === 'Accepted' || data.newStatus === 'Shortlisted' || data.newStatus === 'Offered' || data.newStatus === 'Interview_Scheduled'
  const isRejected = data.newStatus === 'Rejected'
  const isSubmitted = data.newStatus === 'Submitted'

  let headerColor = '#667eea'
  let headerEmoji = '📋'
  let headerMsg = 'Application Status Update'
  let bodyMsg = `The status of your application for <strong>${data.listingTitle}</strong> has been updated to: <strong>${statusLabel}</strong>.`

  if (isSubmitted) {
    headerColor = '#16a34a'; headerEmoji = '✅'; headerMsg = 'Application Submitted Successfully!'
    bodyMsg = `Your application for <strong>${data.listingTitle}</strong> has been submitted. The employer will review your profile and CV.`
  } else if (data.newStatus === 'Shortlisted') {
    headerColor = '#7c3aed'; headerEmoji = '⭐'; headerMsg = 'You have been Shortlisted!'
    bodyMsg = `Congratulations! You have been shortlisted for <strong>${data.listingTitle}</strong>. The employer may contact you to schedule an interview.`
  } else if (data.newStatus === 'Interview_Scheduled') {
    headerColor = '#4f46e5'; headerEmoji = '📅'; headerMsg = 'Interview Scheduled!'
    bodyMsg = `An interview has been scheduled for your application to <strong>${data.listingTitle}</strong>. Check your notifications for interview details.`
  } else if (data.newStatus === 'Offered') {
    headerColor = '#059669'; headerEmoji = '🎁'; headerMsg = 'You have received an Offer!'
    bodyMsg = `Congratulations! You have received an internship offer for <strong>${data.listingTitle}</strong>. Please log in to accept or decline the offer.`
  } else if (data.newStatus === 'Accepted') {
    headerColor = '#16a34a'; headerEmoji = '🏆'; headerMsg = 'Congratulations — You got the internship!'
    bodyMsg = `Your application for <strong>${data.listingTitle}</strong> has been accepted. Welcome aboard!`
  } else if (isRejected) {
    headerColor = '#dc2626'; headerEmoji = '📧'; headerMsg = 'Application Status Update'
    bodyMsg = `Thank you for your interest in <strong>${data.listingTitle}</strong>. After careful review, the employer has decided not to move forward with your application at this time. We encourage you to keep applying to other opportunities!`
  }

  return {
    subject: `${headerEmoji} ${headerMsg} — ${data.listingTitle}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:20px;border-radius:12px;">
        <div style="background:${headerColor};padding:30px;border-radius:12px;text-align:center;margin-bottom:20px;">
          <div style="font-size:48px;margin-bottom:10px;">${headerEmoji}</div>
          <h1 style="color:white;margin:0;font-size:22px;">${headerMsg}</h1>
        </div>
        <div style="background:white;padding:25px;border-radius:12px;margin-bottom:15px;border:1px solid #e5e7eb;">
          <p style="color:#374151;font-size:15px;line-height:1.6;">${bodyMsg}</p>
          <div style="margin-top:15px;padding:12px;background:#f3f4f6;border-radius:8px;">
            <p style="margin:0;color:#6b7280;font-size:13px;"><strong>Position:</strong> ${data.listingTitle}</p>
            <p style="margin:4px 0 0;color:#6b7280;font-size:13px;"><strong>Status:</strong> ${statusLabel}</p>
          </div>
        </div>
        <div style="text-align:center;margin:20px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/my-applications"
             style="display:inline-block;background:${headerColor};color:white;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;">
            View My Applications
          </a>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:15px;">
          This is an automated notification from Internship Portal.
        </p>
      </div>
    `,
  };
}

function buildAccountVerifiedEmail(data: AccountVerifiedJobData): EmailContent {
  return {
    subject: 'Your Internship Portal email address has been verified',
    html: `
      <h2>Email Verified Successfully</h2>
      <p>Hi ${data.name},</p>
      <p>Your email address has been verified. Your account is now active and
         you can log in to explore internship opportunities.</p>
      <p><a href="${env.APP_BASE_URL}/login"
            style="padding:10px 20px;background:#16a34a;color:#fff;border-radius:4px;text-decoration:none;">
        Log In Now
      </a></p>
    `,
  };
}

function buildAccountApprovedEmail(data: AccountApprovedJobData): EmailContent {
  return {
    subject: 'Your Internship Portal employer account has been approved',
    html: `
      <h2>Account Approved!</h2>
      <p>Hi ${data.name},</p>
      <p>Your employer account has been approved by our administrators.
         You can now log in, complete your company profile, and start posting
         internship listings.</p>
      <p><a href="${env.APP_BASE_URL}/login"
            style="padding:10px 20px;background:#16a34a;color:#fff;border-radius:4px;text-decoration:none;">
        Log In to Your Account
      </a></p>
    `,
  };
}

function buildAccountRejectedEmail(data: AccountRejectedJobData): EmailContent {
  return {
    subject: 'Your Internship Portal employer account application was not approved',
    html: `
      <h2>Account Application Not Approved</h2>
      <p>Hi ${data.name},</p>
      <p>We regret to inform you that your employer account application has not been approved.</p>
      <p><strong>Reason:</strong> ${data.reason}</p>
      <p>If you believe this decision was made in error or would like to provide
         additional information, please contact our support team.</p>
    `,
  };
}

function buildShortlistNotificationEmail(data: ShortlistNotificationJobData): EmailContent {
  return {
    subject: `You've been shortlisted for "${data.listingTitle}" at ${data.companyName}`,
    html: `
      <h2>Congratulations — You've Been Shortlisted! 🎉</h2>
      <p>Hi ${data.name},</p>
      <p>Great news! You have been shortlisted for the internship position
         <strong>${data.listingTitle}</strong> at <strong>${data.companyName}</strong>.</p>
      <p>The employer may reach out to schedule an interview. Keep an eye on your
         portal notifications for updates.</p>
      <p>Log in to the portal to view your application details.</p>
    `,
  };
}

function buildInterviewScheduledNotifyEmail(data: InterviewScheduledNotifyJobData): EmailContent {
  const scheduledDate = new Date(data.scheduledAt).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  const modeLabel = data.mode === 'online' ? 'Online' : 'In-Person';
  const locationLabel = data.mode === 'online' ? 'Meeting Link' : 'Location';

  return {
    subject: `Interview scheduled for "${data.listingTitle}" — Internship Portal`,
    html: `
      <h2>Interview Scheduled</h2>
      <p>Hi ${data.name},</p>
      <p>An interview has been scheduled for your application to
         <strong>${data.listingTitle}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Date &amp; Time</td>
          <td style="padding:6px 12px;">${scheduledDate} (UTC)</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Mode</td>
          <td style="padding:6px 12px;">${modeLabel}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">${locationLabel}</td>
          <td style="padding:6px 12px;">${data.locationOrLink}</td>
        </tr>
      </table>
      <p>Please ensure you are available at the scheduled time. Log in to the portal
         for full application details.</p>
    `,
  };
}

function buildOfferReceivedNotifyEmail(data: OfferReceivedNotifyJobData): EmailContent {
  const startDateStr = new Date(data.startDate).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'long',
  });
  const stipendStr = data.stipend != null
    ? `$${Number(data.stipend).toLocaleString('en-US', { minimumFractionDigits: 2 })} / month`
    : 'Unpaid';

  return {
    subject: `Congratulations! You have received an offer for "${data.listingTitle}"`,
    html: `
      <h2>You Have Received an Internship Offer 🎉</h2>
      <p>Hi ${data.name},</p>
      <p>An employer has extended an internship offer to you for the position
         <strong>${data.listingTitle}</strong>. Here are the details:</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Start Date</td>
          <td style="padding:6px 12px;">${startDateStr}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Duration</td>
          <td style="padding:6px 12px;">${data.durationWeeks} week${data.durationWeeks !== 1 ? 's' : ''}</td>
        </tr>
        <tr>
          <td style="padding:6px 12px;font-weight:bold;background:#f3f4f6;">Stipend</td>
          <td style="padding:6px 12px;">${stipendStr}</td>
        </tr>
      </table>
      <p>Log in to the portal to accept or reject this offer.</p>
    `,
  };
}

function buildAccountDeactivatedEmail(data: AccountDeactivatedJobData): EmailContent {
  return {
    subject: 'Your Internship Portal account has been deactivated',
    html: `
      <h2>Account Deactivated</h2>
      <p>Hi ${data.name},</p>
      <p>Your Internship Portal account has been deactivated by an administrator.</p>
      <p>If you believe this was done in error, please contact support.</p>
    `,
  };
}

function buildAdminEmployerPendingEmail(data: import('./emailQueue').AdminEmployerPendingJobData): EmailContent {
  const appUrl = process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || 'http://localhost:3001';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const approveUrl = `${appUrl}/api/v1/admin/employers/${data.employerId}/approve-link`;
  const adminUrl = `${frontendUrl}/admin/employers`;
  return {
    subject: `🏢 New Employer Registration: ${data.companyName} — Action Required`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;padding:20px;border-radius:12px;">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;border-radius:12px;text-align:center;margin-bottom:20px;">
          <h1 style="color:white;margin:0;font-size:24px;">🏢 New Employer Registration</h1>
          <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;">Action Required — Admin Approval Needed</p>
        </div>

        <div style="background:white;padding:25px;border-radius:12px;margin-bottom:15px;border:1px solid #e5e7eb;">
          <h2 style="color:#1f2937;margin-top:0;">Company Details</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6b7280;font-weight:bold;">Company Name:</td><td style="padding:8px 0;color:#1f2937;">${data.companyName}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-weight:bold;">Email:</td><td style="padding:8px 0;color:#1f2937;">${data.employerEmail}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-weight:bold;">Status:</td><td style="padding:8px 0;"><span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:20px;font-size:13px;font-weight:bold;">⏳ Pending Approval</span></td></tr>
          </table>
        </div>

        <div style="text-align:center;margin:25px 0;">
          <p style="color:#6b7280;margin-bottom:15px;">Click the button below to approve this employer:</p>
          <a href="${approveUrl}"
             style="display:inline-block;background:#16a34a;color:white;padding:18px 40px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:18px;margin:5px;box-shadow:0 4px 12px rgba(22,163,74,0.3);">
            ⚡ Approve Employer
          </a>
          <br/><br/>
          <a href="${adminUrl}"
             style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;">
            📊 Open Admin Panel
          </a>
        </div>

        <div style="background:#eff6ff;border:1px solid #bfdbfe;padding:15px;border-radius:8px;margin-top:15px;">
          <p style="color:#1e40af;margin:0;font-size:13px;">
            <strong>Admin Login:</strong> ${frontendUrl}/login<br>
            <strong>Email:</strong> admin@portal.com &nbsp;|&nbsp; <strong>Password:</strong> Admin@1234
          </p>
        </div>
      </div>
    `,
  };
}

// ---------------------------------------------------------------------------
// Worker processor registration
// ---------------------------------------------------------------------------

/**
 * Register the email worker on the Bull queue.
 *
 * This function is idempotent — calling it multiple times is safe because Bull
 * replaces any previously registered processor for the same queue.
 *
 * Call this once at application startup (see `src/server.ts`).
 */
export function registerEmailWorker(): void {
  emailQueue.process(async (job) => {
    const data = job.data as EmailJobData;

    // LISTING_CLOSED is a broadcast job — it doesn't have a single `email`
    // field.  We need to resolve addresses from the DB first.
    if (data.type === 'LISTING_CLOSED') {
      await handleListingClosed(data);
      return;
    }

    // All other job types carry a single recipient `email`.
    const { subject, html } = buildEmailContent(data);
    await sendEmail(data.email, subject, html);

    console.log(
      `[email-worker] Sent ${data.type} to ${data.email} (job ${job.id})`,
    );
  });

  console.log('[email-worker] Email worker registered on the email-notifications queue.');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Dispatch to the appropriate content builder based on job type.
 */
function buildEmailContent(
  data: Exclude<EmailJobData, ListingClosedJobData>,
): EmailContent {
  switch (data.type) {
    case 'ACCOUNT_VERIFICATION':
      return buildVerificationEmail(data);
    case 'ACCOUNT_APPROVAL_PENDING':
      return buildApprovalPendingEmail(data);
    case 'ACCOUNT_LOCKED':
      return buildAccountLockedEmail(data);
    case 'LISTING_APPROVED':
      return buildListingApprovedEmail(data);
    case 'LISTING_REJECTED':
      return buildListingRejectedEmail(data);
    case 'INTERVIEW_SCHEDULED':
      return buildInterviewScheduledEmail(data);
    case 'OFFER_RECEIVED':
      return buildOfferReceivedEmail(data);
    case 'APPLICATION_STATUS_CHANGED':
      return buildApplicationStatusChangedEmail(data);
    case 'ACCOUNT_VERIFIED':
      return buildAccountVerifiedEmail(data);
    case 'ACCOUNT_APPROVED':
      return buildAccountApprovedEmail(data);
    case 'ACCOUNT_REJECTED':
      return buildAccountRejectedEmail(data);
    case 'SHORTLIST_NOTIFICATION':
      return buildShortlistNotificationEmail(data);
    case 'INTERVIEW_SCHEDULED_NOTIFY':
      return buildInterviewScheduledNotifyEmail(data);
    case 'OFFER_RECEIVED_NOTIFY':
      return buildOfferReceivedNotifyEmail(data);
    case 'ACCOUNT_DEACTIVATED':
      return buildAccountDeactivatedEmail(data);
    case 'ADMIN_EMPLOYER_PENDING':
      return buildAdminEmployerPendingEmail(data as import('./emailQueue').AdminEmployerPendingJobData);
    default: {
      // Exhaustiveness check — TypeScript will error here if a new type is
      // added to EmailJobData without a corresponding case above.
      const _exhaustive: never = data;
      throw new Error(`Unknown email job type: ${(_exhaustive as EmailJobData).type}`);
    }
  }
}

/**
 * Handle the LISTING_CLOSED broadcast — resolve email addresses for every
 * affected student user ID and send them a notification.
 */
async function handleListingClosed(data: ListingClosedJobData): Promise<void> {
  if (data.affectedStudentIds.length === 0) return;

  // Resolve email addresses for all affected student user IDs in a single query.
  const rows = await repo.query<{ id: string; email: string }>(
    `SELECT id, email
     FROM   users
     WHERE  id = ANY($1::uuid[])`,
    [data.affectedStudentIds],
  );

  const subject = 'An internship listing you applied to has been closed';
  const html = `
    <h2>Listing Closed</h2>
    <p>An internship listing you applied to has been closed and is no longer
       accepting applications.</p>
    <p>Log in to the portal to view your applications and explore other
       available opportunities.</p>
  `;

  const sends = rows.map((row) => sendEmail(row.email, subject, html));
  const results = await Promise.allSettled(sends);

  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length > 0) {
    console.error(
      `[email-worker] LISTING_CLOSED: ${failed.length}/${rows.length} emails failed for listing ${data.listingId}:`,
      failed.map((f) => f.reason).join('; '),
    );
    // Rethrow so Bull retries the job if any individual send failed.
    throw new Error(
      `${failed.length} of ${rows.length} LISTING_CLOSED emails failed to send.`,
    );
  }

  console.log(
    `[email-worker] LISTING_CLOSED: sent to ${rows.length} student(s) for listing ${data.listingId}`,
  );
}

/**
 * Send a single email via the nodemailer transporter.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const info = await getMailTransporter().sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    html,
  });

  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) {
    console.log(`[email-worker] Ethereal preview: ${preview}`);
  }

  console.log(`[email-worker] Sent to ${to}: ${subject}`);
}
