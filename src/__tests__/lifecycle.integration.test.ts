/**
 * Integration tests — Full Application Lifecycle
 *
 * Exercises the complete lifecycle end-to-end through the service layer:
 *   register → verify → login → apply → review → shortlist → interview → offer → accept
 *
 * These tests run entirely in-memory; the PostgreSQL pool and Redis are mocked
 * so no real database or cache connection is required.  The service modules
 * exercise their real business logic (guards, state-machine transitions,
 * notification writes) against the mock responses.
 *
 * Requirements: 1.1, 1.2, 1.4, 6.1, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

// ---------------------------------------------------------------------------
// Module-level mocks (must be declared before any imports that use them)
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
    JWT_ACCESS_SECRET:         'test-access-secret',
    JWT_VERIFICATION_SECRET:   'test-verify-secret',
    JWT_REFRESH_SECRET:        'test-refresh-secret',
    JWT_RESET_SECRET:          'test-reset-secret',
    JWT_ACCESS_EXPIRES_IN:     900,
    JWT_REFRESH_EXPIRES_IN:    604800,
    JWT_RESET_EXPIRES_IN:      3600,
    EMAIL_VERIFICATION_EXPIRES_IN: 86400,
    BCRYPT_ROUNDS:             1,   // minimal cost for speed
    REDIS_URL:                 'redis://localhost:6379',
    APP_BASE_URL:              'http://localhost:3000',
    SMTP_HOST:                 'localhost',
    SMTP_PORT:                 587,
    SMTP_SECURE:               false,
    SMTP_USER:                 '',
    SMTP_PASS:                 '',
    EMAIL_FROM:                'test@example.com',
  },
}));

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------

import jwt from 'jsonwebtoken';
import { pool } from '../database/client';
import { enqueueEmail } from '../queues/emailQueue';

import { AuthService }        from '../services/authService';
import { ApplicationService } from '../services/applicationService';
import { InterviewService, ScheduleInterviewDTO } from '../services/interviewService';
import { OfferService, OfferDTO }                from '../services/offerService';
import {
  ApplicationStatus,
  InterviewMode,
  UserRole,
  UserStatus,
  ListingStatus,
  ApprovalStatus,
} from '../types';

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockPool     = pool as jest.Mocked<typeof pool>;
const mockEnqueue  = enqueueEmail as jest.MockedFunction<typeof enqueueEmail>;

// ---------------------------------------------------------------------------
// Shared UUIDs used across tests
// ---------------------------------------------------------------------------

const STUDENT_USER_ID     = 'student-user-uuid-001';
const STUDENT_PROFILE_ID  = 'student-profile-uuid-001';
const EMPLOYER_USER_ID    = 'employer-user-uuid-001';
const EMPLOYER_PROFILE_ID = 'employer-profile-uuid-001';
const LISTING_ID          = 'listing-uuid-001';
const RESUME_ID           = 'resume-uuid-001';
const APPLICATION_ID      = 'application-uuid-001';
const INTERVIEW_ID        = 'interview-uuid-001';
const OFFER_ID            = 'offer-uuid-001';
const ADMIN_USER_ID       = 'admin-user-uuid-001';

// ---------------------------------------------------------------------------
// Helper – build a mock PoolClient that replays provided query results in order
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
// 1. REGISTRATION
// ---------------------------------------------------------------------------

describe('1. Student registration', () => {
  let authService: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService();
  });

  it('creates a user with status pending_verification and enqueues a verification email', async () => {
    // Transaction: BEGIN, INSERT user, INSERT student_profile, COMMIT
    const userRow = {
      id:                    STUDENT_USER_ID,
      email:                 'student@example.com',
      password_hash:         '$2b$01$hashedpassword',
      role:                  UserRole.Student,
      status:                UserStatus.PendingVerification,
      failed_login_attempts: 0,
      locked_until:          null,
      created_at:            new Date(),
      updated_at:            new Date(),
    };
    const profileRow = {
      id:      STUDENT_PROFILE_ID,
      user_id: STUDENT_USER_ID,
      full_name: 'Jane Doe',
      institution: 'MIT',
      degree:      'B.Sc. CS',
      gpa:         null,
      graduation_year: null,
      skills:      null,
      bio:         null,
      photo_url:   null,
      completion_pct: null,
    };

    const mockClient = buildMockClient(
      { rows: [] },            // BEGIN
      { rows: [userRow] },     // INSERT user
      { rows: [profileRow] },  // INSERT student_profile
      { rows: [] },            // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    // INSERT refresh_token (issued after transaction, but not used here)
    mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

    const result = await authService.registerStudent({
      email:       'student@example.com',
      password:    'Password1',
      fullName:    'Jane Doe',
      institution: 'MIT',
      degree:      'B.Sc. CS',
    });

    // User returned must have correct initial status
    expect(result.user.status).toBe(UserStatus.PendingVerification);
    expect(result.user.role).toBe(UserRole.Student);
    expect(result.studentProfile.user_id).toBe(STUDENT_USER_ID);

    // Verification email must have been enqueued
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type:   'ACCOUNT_VERIFICATION',
        userId: STUDENT_USER_ID,
      }),
    );
  });

  it('throws DUPLICATE_EMAIL (409) when email already exists', async () => {
    const mockClient = buildMockClient(
      { rows: [] }, // BEGIN
    );
    // Simulate pg unique-constraint violation (code 23505)
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })      // BEGIN
      .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
      .mockResolvedValueOnce({ rows: [] });     // ROLLBACK

    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await expect(
      authService.registerStudent({
        email:    'student@example.com',
        password: 'Password1',
        fullName: 'Jane Doe',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_EMAIL' });
  });
});

// ---------------------------------------------------------------------------
// 2. EMAIL VERIFICATION
// ---------------------------------------------------------------------------

describe('2. Email verification', () => {
  let authService: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService();
  });

  it('transitions user to active when a valid verification token is provided', async () => {
    // Mint a valid verification token
    const token = jwt.sign(
      { sub: STUDENT_USER_ID, purpose: 'email_verification' },
      'test-verify-secret',
      { expiresIn: 86400 },
    );

    // UPDATE user status
    mockPool.query = jest.fn().mockResolvedValue({ rows: [{ id: STUDENT_USER_ID }] });

    await expect(authService.verifyEmail(token)).resolves.toBeUndefined();

    // The UPDATE … SET status = 'active' must have been called
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      expect.arrayContaining([UserStatus.Active]),
    );
  });

  it('throws INVALID_OR_EXPIRED_TOKEN when the token is expired', async () => {
    const expiredToken = jwt.sign(
      { sub: STUDENT_USER_ID, purpose: 'email_verification' },
      'test-verify-secret',
      { expiresIn: -1 },
    );

    await expect(authService.verifyEmail(expiredToken)).rejects.toMatchObject({
      statusCode: 400,
      code:       'INVALID_OR_EXPIRED_TOKEN',
    });
  });

  it('throws INVALID_OR_EXPIRED_TOKEN when the token has the wrong purpose', async () => {
    const wrongToken = jwt.sign(
      { sub: STUDENT_USER_ID, purpose: 'password_reset' },
      'test-verify-secret',
      { expiresIn: 3600 },
    );

    await expect(authService.verifyEmail(wrongToken)).rejects.toMatchObject({
      statusCode: 400,
      code:       'INVALID_OR_EXPIRED_TOKEN',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. LOGIN
// ---------------------------------------------------------------------------

describe('3. Login', () => {
  let authService: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService();
  });

  it('returns a TokenPair for valid credentials on an active account', async () => {
    // bcrypt hash of "Password1" with 1 round
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('Password1', 1);

    const activeUser = {
      id:                    STUDENT_USER_ID,
      email:                 'student@example.com',
      password_hash:         hash,
      role:                  UserRole.Student,
      status:                UserStatus.Active,
      failed_login_attempts: 0,
      locked_until:          null,
    };

    // SELECT user, UPDATE reset attempts, INSERT refresh_token
    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [activeUser] })  // SELECT user
      .mockResolvedValueOnce({ rows: [] })             // UPDATE reset attempts
      .mockResolvedValueOnce({ rows: [] });            // INSERT refresh_token

    const result = await authService.login({
      email:    'student@example.com',
      password: 'Password1',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');

    // Verify the JWT access token has the expected claims
    const decoded = jwt.decode(result.accessToken) as Record<string, unknown>;
    expect(decoded.sub).toBe(STUDENT_USER_ID);
    expect(decoded.role).toBe(UserRole.Student);
  });

  it('throws ACCOUNT_NOT_VERIFIED for a pending_verification account', async () => {
    const pendingUser = {
      id:                    STUDENT_USER_ID,
      email:                 'student@example.com',
      password_hash:         '$2b$01$hash',
      role:                  UserRole.Student,
      status:                UserStatus.PendingVerification,
      failed_login_attempts: 0,
      locked_until:          null,
    };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [pendingUser] });

    await expect(
      authService.login({ email: 'student@example.com', password: 'any' }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'ACCOUNT_NOT_VERIFIED' });
  });

  it('throws ACCOUNT_DEACTIVATED for a deactivated account', async () => {
    const deactivatedUser = {
      id:                    STUDENT_USER_ID,
      email:                 'student@example.com',
      password_hash:         '$2b$01$hash',
      role:                  UserRole.Student,
      status:                UserStatus.Deactivated,
      failed_login_attempts: 0,
      locked_until:          null,
    };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [deactivatedUser] });

    await expect(
      authService.login({ email: 'student@example.com', password: 'any' }),
    ).rejects.toMatchObject({ statusCode: 401, code: 'ACCOUNT_DEACTIVATED' });
  });
});

// ---------------------------------------------------------------------------
// 4. APPLICATION SUBMISSION
// ---------------------------------------------------------------------------

describe('4. Application submission', () => {
  let appService: ApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();
    appService = new ApplicationService();
  });

  it('creates an application with status Submitted and inserts a confirmation notification', async () => {
    const studentProfileRow = { id: STUDENT_PROFILE_ID, completion_pct: '75.00' };
    const activeResumeRow   = { id: RESUME_ID };
    const listingRow        = {
      id:                   LISTING_ID,
      status:               ListingStatus.Published,
      application_deadline: '2099-12-31',
      title:                'Software Engineering Intern',
    };
    const applicationRow = {
      id:           APPLICATION_ID,
      student_id:   STUDENT_PROFILE_ID,
      listing_id:   LISTING_ID,
      resume_id:    RESUME_ID,
      status:       ApplicationStatus.Submitted,
      submitted_at: new Date(),
      updated_at:   new Date(),
    };

    // Pool query calls: student profile, resume, listing, dup check
    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [studentProfileRow] })  // SELECT student profile
      .mockResolvedValueOnce({ rows: [activeResumeRow] })    // SELECT active resume
      .mockResolvedValueOnce({ rows: [listingRow] })         // SELECT listing
      .mockResolvedValueOnce({ rows: [] });                  // SELECT duplicate check

    // Transaction client: BEGIN, INSERT application, INSERT notification, COMMIT
    const mockClient = buildMockClient(
      { rows: [] },                // BEGIN
      { rows: [applicationRow] },  // INSERT application
      { rows: [] },                // INSERT notification
      { rows: [] },                // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    const result = await appService.submitApplication(STUDENT_USER_ID, LISTING_ID);

    expect(result.status).toBe(ApplicationStatus.Submitted);
    expect(result.listing_id).toBe(LISTING_ID);
    expect(result.resume_id).toBe(RESUME_ID);

    // Confirm notification INSERT was called
    const notifCall = mockClient.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO notifications'),
    );
    expect(notifCall).toBeDefined();
  });

  it('throws PROFILE_INCOMPLETE (422) when completion is below 60%', async () => {
    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: STUDENT_PROFILE_ID, completion_pct: '45.00' }] });

    await expect(
      appService.submitApplication(STUDENT_USER_ID, LISTING_ID),
    ).rejects.toMatchObject({ statusCode: 422, code: 'PROFILE_INCOMPLETE' });
  });

  it('throws DUPLICATE_APPLICATION (409) when already applied', async () => {
    const studentProfileRow = { id: STUDENT_PROFILE_ID, completion_pct: '75.00' };
    const activeResumeRow   = { id: RESUME_ID };
    const listingRow        = {
      id:                   LISTING_ID,
      status:               ListingStatus.Published,
      application_deadline: '2099-12-31',
      title:                'Software Engineering Intern',
    };

    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [studentProfileRow] })
      .mockResolvedValueOnce({ rows: [activeResumeRow] })
      .mockResolvedValueOnce({ rows: [listingRow] })
      .mockResolvedValueOnce({ rows: [{ id: APPLICATION_ID }] }); // duplicate found

    await expect(
      appService.submitApplication(STUDENT_USER_ID, LISTING_ID),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_APPLICATION' });
  });

  it('throws LISTING_CLOSED (422) when listing is not published', async () => {
    const studentProfileRow = { id: STUDENT_PROFILE_ID, completion_pct: '75.00' };
    const activeResumeRow   = { id: RESUME_ID };
    const closedListingRow  = {
      id:                   LISTING_ID,
      status:               ListingStatus.Closed,
      application_deadline: '2099-12-31',
      title:                'Software Engineering Intern',
    };

    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [studentProfileRow] })
      .mockResolvedValueOnce({ rows: [activeResumeRow] })
      .mockResolvedValueOnce({ rows: [closedListingRow] });

    await expect(
      appService.submitApplication(STUDENT_USER_ID, LISTING_ID),
    ).rejects.toMatchObject({ statusCode: 422, code: 'LISTING_CLOSED' });
  });

  it('throws DEADLINE_PASSED (422) when the application deadline has passed', async () => {
    const studentProfileRow = { id: STUDENT_PROFILE_ID, completion_pct: '75.00' };
    const activeResumeRow   = { id: RESUME_ID };
    const expiredListingRow = {
      id:                   LISTING_ID,
      status:               ListingStatus.Published,
      application_deadline: '2000-01-01', // in the past
      title:                'Software Engineering Intern',
    };

    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [studentProfileRow] })
      .mockResolvedValueOnce({ rows: [activeResumeRow] })
      .mockResolvedValueOnce({ rows: [expiredListingRow] });

    await expect(
      appService.submitApplication(STUDENT_USER_ID, LISTING_ID),
    ).rejects.toMatchObject({ statusCode: 422, code: 'DEADLINE_PASSED' });
  });
});

// ---------------------------------------------------------------------------
// 5. EMPLOYER REVIEWS APPLICATION (Under_Review → Shortlisted)
// ---------------------------------------------------------------------------

describe('5. Employer status transitions', () => {
  let appService: ApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();
    appService = new ApplicationService();
  });

  /**
   * Helper – stub pool.query to return an application row for the initial fetch,
   * then run the transaction via a mock client.
   */
  function stubTransition(
    fromStatus: ApplicationStatus,
    toStatus: ApplicationStatus,
  ) {
    const existingApp = {
      id:               APPLICATION_ID,
      student_id:       STUDENT_PROFILE_ID,
      listing_id:       LISTING_ID,
      resume_id:        RESUME_ID,
      status:           fromStatus,
      listing_title:    'Software Engineering Intern',
      student_user_id:  STUDENT_USER_ID,
      student_email:    'student@example.com',
      student_name:     'Jane Doe',
    };

    const updatedApp = { ...existingApp, status: toStatus };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [existingApp] });

    const mockClient = buildMockClient(
      { rows: [] },              // BEGIN
      { rows: [updatedApp] },    // UPDATE application
      { rows: [] },              // INSERT notification
      { rows: [] },              // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    return { updatedApp };
  }

  it('Submitted → Under_Review: updates status and notifies student', async () => {
    const { updatedApp } = stubTransition(ApplicationStatus.Submitted, ApplicationStatus.UnderReview);

    const result = await appService.updateStatus(
      APPLICATION_ID,
      EMPLOYER_USER_ID,
      ApplicationStatus.UnderReview,
    );

    expect(result.status).toBe(ApplicationStatus.UnderReview);
  });

  it('Under_Review → Shortlisted: updates status and notifies student', async () => {
    const { updatedApp } = stubTransition(ApplicationStatus.UnderReview, ApplicationStatus.Shortlisted);

    const result = await appService.updateStatus(
      APPLICATION_ID,
      EMPLOYER_USER_ID,
      ApplicationStatus.Shortlisted,
    );

    expect(result.status).toBe(ApplicationStatus.Shortlisted);
  });

  it('rejects an invalid transition (Submitted → Accepted) with INVALID_STATUS_TRANSITION', async () => {
    const existingApp = {
      id:               APPLICATION_ID,
      status:           ApplicationStatus.Submitted,
      listing_title:    'Software Engineering Intern',
      listing_id:       LISTING_ID,
      student_user_id:  STUDENT_USER_ID,
      student_email:    'student@example.com',
      student_name:     'Jane Doe',
    };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [existingApp] });

    await expect(
      appService.updateStatus(APPLICATION_ID, EMPLOYER_USER_ID, ApplicationStatus.Accepted),
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_STATUS_TRANSITION' });
  });

  it('Shortlisted → Rejected: employer can reject a shortlisted application', async () => {
    stubTransition(ApplicationStatus.Shortlisted, ApplicationStatus.Rejected);

    const result = await appService.updateStatus(
      APPLICATION_ID,
      EMPLOYER_USER_ID,
      ApplicationStatus.Rejected,
    );

    expect(result.status).toBe(ApplicationStatus.Rejected);
  });
});

// ---------------------------------------------------------------------------
// 6. INTERVIEW SCHEDULING
// ---------------------------------------------------------------------------

describe('6. Interview scheduling', () => {
  let interviewService: InterviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    interviewService = new InterviewService();
  });

  it('Shortlisted → Interview_Scheduled: inserts interview and transitions status', async () => {
    const shortlistedApp = {
      id:               APPLICATION_ID,
      student_id:       STUDENT_PROFILE_ID,
      listing_id:       LISTING_ID,
      resume_id:        RESUME_ID,
      status:           ApplicationStatus.Shortlisted,
      employer_user_id: EMPLOYER_USER_ID,
      student_user_id:  STUDENT_USER_ID,
      student_email:    'student@example.com',
      listing_title:    'Software Engineering Intern',
    };

    const interviewRow = {
      id:               INTERVIEW_ID,
      application_id:   APPLICATION_ID,
      scheduled_at:     new Date('2025-09-15T10:00:00Z'),
      mode:             InterviewMode.Online,
      location_or_link: 'https://meet.example.com/xyz',
      created_at:       new Date(),
    };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [shortlistedApp] });

    const mockClient = buildMockClient(
      { rows: [] },               // BEGIN
      { rows: [interviewRow] },   // INSERT interviews
      { rows: [] },               // UPDATE application status
      { rows: [] },               // INSERT notification
      { rows: [] },               // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    const dto: ScheduleInterviewDTO = {
      scheduledAt:    new Date('2025-09-15T10:00:00Z'),
      mode:           InterviewMode.Online,
      locationOrLink: 'https://meet.example.com/xyz',
    };

    const result = await interviewService.scheduleInterview(
      APPLICATION_ID,
      EMPLOYER_USER_ID,
      dto,
    );

    expect(result.id).toBe(INTERVIEW_ID);
    expect(result.mode).toBe(InterviewMode.Online);
    expect(result.application_id).toBe(APPLICATION_ID);

    // Student notification email must have been enqueued
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type:          'INTERVIEW_SCHEDULED',
        userId:        STUDENT_USER_ID,
        applicationId: APPLICATION_ID,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 7. OFFER EXTENSION
// ---------------------------------------------------------------------------

describe('7. Offer extension', () => {
  let offerService: OfferService;

  beforeEach(() => {
    jest.clearAllMocks();
    offerService = new OfferService();
  });

  it('Interview_Scheduled → Offered: inserts offer and enqueues student notification', async () => {
    const interviewedApp = {
      id:               APPLICATION_ID,
      student_id:       STUDENT_PROFILE_ID,
      listing_id:       LISTING_ID,
      resume_id:        RESUME_ID,
      status:           ApplicationStatus.InterviewScheduled,
      employer_user_id: EMPLOYER_USER_ID,
      student_user_id:  STUDENT_USER_ID,
      student_email:    'student@example.com',
      listing_title:    'Software Engineering Intern',
    };

    const offerRow = {
      id:             OFFER_ID,
      application_id: APPLICATION_ID,
      start_date:     '2025-10-01',
      duration_weeks: 12,
      stipend:        '2000.00',
      issued_at:      new Date(),
    };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [interviewedApp] });

    const mockClient = buildMockClient(
      { rows: [] },            // BEGIN
      { rows: [offerRow] },    // INSERT offers
      { rows: [] },            // UPDATE application status → Offered
      { rows: [] },            // INSERT notification
      { rows: [] },            // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    const dto: OfferDTO = {
      startDate:     '2025-10-01',
      durationWeeks: 12,
      stipend:       2000,
    };

    const result = await offerService.extendOffer(APPLICATION_ID, EMPLOYER_USER_ID, dto);

    expect(result.id).toBe(OFFER_ID);
    expect(result.duration_weeks).toBe(12);

    // Email must have been enqueued for student
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type:          'OFFER_RECEIVED',
        userId:        STUDENT_USER_ID,
        applicationId: APPLICATION_ID,
      }),
    );
  });

  it('throws INVALID_STATUS_TRANSITION when application is not Interview_Scheduled', async () => {
    const shortlistedApp = {
      id:               APPLICATION_ID,
      status:           ApplicationStatus.Shortlisted,
      employer_user_id: EMPLOYER_USER_ID,
      student_user_id:  STUDENT_USER_ID,
      student_email:    'student@example.com',
      listing_title:    'SW Engineering Intern',
    };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [shortlistedApp] });

    await expect(
      offerService.extendOffer(APPLICATION_ID, EMPLOYER_USER_ID, {
        startDate: '2025-10-01', durationWeeks: 12,
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_STATUS_TRANSITION' });
  });
});

// ---------------------------------------------------------------------------
// 8. OFFER ACCEPTANCE
// ---------------------------------------------------------------------------

describe('8. Offer acceptance', () => {
  let offerService: OfferService;

  beforeEach(() => {
    jest.clearAllMocks();
    offerService = new OfferService();
  });

  it('Offered → Accepted: transitions application, increments accepted_count, notifies employer', async () => {
    const offeredApp = {
      id:                  APPLICATION_ID,
      student_id:          STUDENT_PROFILE_ID,
      listing_id:          LISTING_ID,
      resume_id:           RESUME_ID,
      status:              ApplicationStatus.Offered,
      student_profile_id:  STUDENT_PROFILE_ID,
      listing_title:       'Software Engineering Intern',
      openings:            5,
      employer_user_id:    EMPLOYER_USER_ID,
      employer_email:      'employer@corp.com',
    };

    const acceptedApp = { ...offeredApp, status: ApplicationStatus.Accepted };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [offeredApp] });

    const mockClient = buildMockClient(
      { rows: [] },                            // BEGIN
      { rows: [acceptedApp] },                 // UPDATE application → Accepted
      { rows: [{ accepted_count: 1 }] },       // UPDATE listing.accepted_count
      { rows: [] },                            // INSERT notification (employer)
      { rows: [] },                            // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    const result = await offerService.acceptOffer(APPLICATION_ID, STUDENT_USER_ID);

    expect(result.status).toBe(ApplicationStatus.Accepted);

    // accepted_count was incremented
    const incrementCall = mockClient.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('accepted_count'),
    );
    expect(incrementCall).toBeDefined();

    // Employer email notification must have been enqueued
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type:      'APPLICATION_STATUS_CHANGED',
        userId:    EMPLOYER_USER_ID,
        newStatus: ApplicationStatus.Accepted,
      }),
    );
  });

  it('Offered → Rejected (reject offer): student can reject an offer', async () => {
    const offeredApp = {
      id:               APPLICATION_ID,
      status:           ApplicationStatus.Offered,
      listing_id:       LISTING_ID,
      listing_title:    'Software Engineering Intern',
      employer_user_id: EMPLOYER_USER_ID,
      employer_email:   'employer@corp.com',
    };

    const rejectedApp = { ...offeredApp, status: ApplicationStatus.Rejected };

    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [offeredApp] });

    const mockClient = buildMockClient(
      { rows: [] },              // BEGIN
      { rows: [rejectedApp] },   // UPDATE application → Rejected
      { rows: [] },              // INSERT notification
      { rows: [] },              // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    const result = await offerService.rejectOffer(APPLICATION_ID, STUDENT_USER_ID);
    expect(result.status).toBe(ApplicationStatus.Rejected);
  });
});

// ---------------------------------------------------------------------------
// 9. APPLICATION WITHDRAWAL
// ---------------------------------------------------------------------------

describe('9. Application withdrawal', () => {
  let appService: ApplicationService;

  beforeEach(() => {
    jest.clearAllMocks();
    appService = new ApplicationService();
  });

  it.each([
    ApplicationStatus.Submitted,
    ApplicationStatus.UnderReview,
  ])('allows withdrawal when status is %s', async (status) => {
    const studentProfile  = { id: STUDENT_PROFILE_ID };
    const existingApp = {
      id:               APPLICATION_ID,
      student_id:       STUDENT_PROFILE_ID,
      listing_id:       LISTING_ID,
      status,
      listing_title:    'SW Intern',
      employer_user_id: EMPLOYER_USER_ID,
    };
    const withdrawnApp = { ...existingApp, status: ApplicationStatus.Withdrawn };

    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [studentProfile] })  // SELECT student profile
      .mockResolvedValueOnce({ rows: [existingApp] })     // SELECT application
      .mockResolvedValueOnce({ rows: [{ email: 'emp@corp.com' }] }); // SELECT employer email

    const mockClient = buildMockClient(
      { rows: [] },                // BEGIN
      { rows: [withdrawnApp] },    // UPDATE application
      { rows: [] },                // INSERT notification
      { rows: [] },                // COMMIT
    );
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    const result = await appService.withdrawApplication(APPLICATION_ID, STUDENT_USER_ID);
    expect(result.status).toBe(ApplicationStatus.Withdrawn);
  });

  it.each([
    ApplicationStatus.Shortlisted,
    ApplicationStatus.InterviewScheduled,
    ApplicationStatus.Offered,
    ApplicationStatus.Accepted,
    ApplicationStatus.Rejected,
  ])('blocks withdrawal when status is %s', async (status) => {
    const studentProfile = { id: STUDENT_PROFILE_ID };
    const existingApp = {
      id:               APPLICATION_ID,
      student_id:       STUDENT_PROFILE_ID,
      listing_id:       LISTING_ID,
      status,
      listing_title:    'SW Intern',
      employer_user_id: EMPLOYER_USER_ID,
    };

    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ rows: [studentProfile] })
      .mockResolvedValueOnce({ rows: [existingApp] });

    await expect(
      appService.withdrawApplication(APPLICATION_ID, STUDENT_USER_ID),
    ).rejects.toMatchObject({ statusCode: 422, code: 'WITHDRAWAL_NOT_ALLOWED' });
  });
});
