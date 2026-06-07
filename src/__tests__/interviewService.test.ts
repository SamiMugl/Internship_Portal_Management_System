/**
 * Unit tests for InterviewService.scheduleInterview
 *
 * These tests run entirely in-memory — no real database or Redis connection.
 * The pg Pool and Bull queue are mocked so that we can exercise the service
 * business-logic (guards, transaction structure, notification enqueue) without
 * external infrastructure.
 *
 * Requirements: 7.3, 7.4
 */

import { InterviewService, ScheduleInterviewDTO } from '../services/interviewService';
import { ApplicationStatus, InterviewMode, Interview } from '../types';

// ---------------------------------------------------------------------------
// Mock pg pool + Bull email queue
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
}));

jest.mock('../config/env', () => ({
  env: {
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-secret',
  },
}));

import { pool } from '../database/client';
import { enqueueEmail } from '../queues/emailQueue';

const mockPool = pool as jest.Mocked<typeof pool>;
const mockEnqueueEmail = enqueueEmail as jest.MockedFunction<typeof enqueueEmail>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APPLICATION_ID = 'app-uuid-001';
const EMPLOYER_USER_ID = 'emp-user-uuid-001';
const STUDENT_USER_ID = 'stu-user-uuid-001';
const LISTING_ID = 'listing-uuid-001';

const shortlistedApp = {
  id: APPLICATION_ID,
  student_id: 'stu-profile-uuid-001',
  listing_id: LISTING_ID,
  resume_id: 'resume-uuid-001',
  status: ApplicationStatus.Shortlisted,
  submitted_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-02'),
  employer_user_id: EMPLOYER_USER_ID,
  student_user_id: STUDENT_USER_ID,
  student_email: 'student@example.com',
  listing_title: 'Software Engineering Intern',
};

const createdInterview: Interview = {
  id: 'interview-uuid-001',
  application_id: APPLICATION_ID,
  scheduled_at: new Date('2025-09-01T10:00:00Z'),
  mode: InterviewMode.Online,
  location_or_link: 'https://meet.example.com/abc',
  created_at: new Date('2025-01-03'),
};

const validDto: ScheduleInterviewDTO = {
  scheduledAt: new Date('2025-09-01T10:00:00Z'),
  mode: InterviewMode.Online,
  locationOrLink: 'https://meet.example.com/abc',
};

// ---------------------------------------------------------------------------
// Helpers: build a mock PoolClient for transactions
// ---------------------------------------------------------------------------

function buildMockClient(
  interviewRow: Interview | null = createdInterview,
) {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };

  // BEGIN
  client.query.mockResolvedValueOnce({ rows: [] });
  // INSERT interviews → returns the interview row
  client.query.mockResolvedValueOnce({ rows: interviewRow ? [interviewRow] : [] });
  // UPDATE applications
  client.query.mockResolvedValueOnce({ rows: [] });
  // INSERT notifications
  client.query.mockResolvedValueOnce({ rows: [] });
  // COMMIT
  client.query.mockResolvedValueOnce({ rows: [] });

  return client;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InterviewService.scheduleInterview', () => {
  let service: InterviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InterviewService();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('inserts interview row, updates status, enqueues notification, and returns the interview', async () => {
    // queryOne → returns the shortlisted application
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [shortlistedApp] });

    const mockClient = buildMockClient(createdInterview);
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    const result = await service.scheduleInterview(APPLICATION_ID, EMPLOYER_USER_ID, validDto);

    expect(result).toMatchObject({
      id: createdInterview.id,
      application_id: APPLICATION_ID,
      mode: InterviewMode.Online,
      location_or_link: 'https://meet.example.com/abc',
    });

    // Email should have been enqueued for the student
    expect(mockEnqueueEmail).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'INTERVIEW_SCHEDULED',
        userId: STUDENT_USER_ID,
        email: 'student@example.com',
        applicationId: APPLICATION_ID,
      }),
    );
  });

  it('passes all three fields from the DTO to the INSERT statement', async () => {
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [shortlistedApp] });

    const mockClient = buildMockClient(createdInterview);
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    const inPersonDto: ScheduleInterviewDTO = {
      scheduledAt: new Date('2025-10-15T14:00:00Z'),
      mode: InterviewMode.InPerson,
      locationOrLink: '123 Main St, City',
    };

    await service.scheduleInterview(APPLICATION_ID, EMPLOYER_USER_ID, inPersonDto);

    // The second client.query call is the INSERT interviews
    const insertCall = mockClient.query.mock.calls[1];
    const insertParams = insertCall[1] as unknown[];
    expect(insertParams).toEqual([
      APPLICATION_ID,
      inPersonDto.scheduledAt,
      inPersonDto.mode,
      inPersonDto.locationOrLink,
    ]);
  });

  it('updates the application status to Interview_Scheduled within the transaction', async () => {
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [shortlistedApp] });

    const mockClient = buildMockClient(createdInterview);
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await service.scheduleInterview(APPLICATION_ID, EMPLOYER_USER_ID, validDto);

    // The third client.query call is the UPDATE applications
    const updateCall = mockClient.query.mock.calls[2];
    expect(updateCall[0]).toMatch(/UPDATE applications/i);
    expect(updateCall[1]).toContain(ApplicationStatus.InterviewScheduled);
    expect(updateCall[1]).toContain(APPLICATION_ID);
  });

  it('inserts an INTERVIEW_SCHEDULED in-app notification within the transaction', async () => {
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [shortlistedApp] });

    const mockClient = buildMockClient(createdInterview);
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    await service.scheduleInterview(APPLICATION_ID, EMPLOYER_USER_ID, validDto);

    // The fourth client.query call is the INSERT notifications
    const notifCall = mockClient.query.mock.calls[3];
    expect(notifCall[0]).toMatch(/INSERT INTO notifications/i);
    expect(notifCall[1][0]).toBe(STUDENT_USER_ID);
    const payload = JSON.parse(notifCall[1][1] as string);
    expect(payload).toMatchObject({
      applicationId: APPLICATION_ID,
      newStatus: ApplicationStatus.InterviewScheduled,
    });
  });

  // -------------------------------------------------------------------------
  // Guard: application not found
  // -------------------------------------------------------------------------

  it('throws 404 APPLICATION_NOT_FOUND when the application does not exist', async () => {
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [] });

    await expect(
      service.scheduleInterview('non-existent-id', EMPLOYER_USER_ID, validDto),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'APPLICATION_NOT_FOUND',
    });
  });

  // -------------------------------------------------------------------------
  // Guard: employer does not own the listing
  // -------------------------------------------------------------------------

  it('throws 403 FORBIDDEN when the employer does not own the listing', async () => {
    const differentEmployerApp = {
      ...shortlistedApp,
      employer_user_id: 'different-employer-uuid',
    };
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [differentEmployerApp] });

    await expect(
      service.scheduleInterview(APPLICATION_ID, EMPLOYER_USER_ID, validDto),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
  });

  // -------------------------------------------------------------------------
  // Guard: application is not Shortlisted
  // -------------------------------------------------------------------------

  it.each([
    ApplicationStatus.Submitted,
    ApplicationStatus.UnderReview,
    ApplicationStatus.InterviewScheduled,
    ApplicationStatus.Offered,
    ApplicationStatus.Accepted,
    ApplicationStatus.Rejected,
    ApplicationStatus.Withdrawn,
  ])(
    'throws 422 INVALID_STATUS_TRANSITION when status is %s (not Shortlisted)',
    async (status) => {
      const nonShortlistedApp = { ...shortlistedApp, status };
      mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [nonShortlistedApp] });

      await expect(
        service.scheduleInterview(APPLICATION_ID, EMPLOYER_USER_ID, validDto),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_STATUS_TRANSITION',
      });
    },
  );

  // -------------------------------------------------------------------------
  // Error resilience: queue failure does not surface as an error
  // -------------------------------------------------------------------------

  it('does not throw if the email queue fails after a successful DB transaction', async () => {
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [shortlistedApp] });

    const mockClient = buildMockClient(createdInterview);
    (mockPool.connect as jest.Mock).mockResolvedValue(mockClient);

    mockEnqueueEmail.mockRejectedValueOnce(new Error('Redis connection refused'));

    // Should resolve successfully even if queue throws
    await expect(
      service.scheduleInterview(APPLICATION_ID, EMPLOYER_USER_ID, validDto),
    ).resolves.toMatchObject({ id: createdInterview.id });
  });

  // -------------------------------------------------------------------------
  // Transaction rollback on failure
  // -------------------------------------------------------------------------

  it('rolls back the transaction and rethrows when the INSERT fails', async () => {
    mockPool.query = jest.fn().mockResolvedValueOnce({ rows: [shortlistedApp] });

    const client = {
      query: jest.fn(),
      release: jest.fn(),
    };
    client.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('unique_violation: duplicate key')) // INSERT interviews fails
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    (mockPool.connect as jest.Mock).mockResolvedValue(client);

    await expect(
      service.scheduleInterview(APPLICATION_ID, EMPLOYER_USER_ID, validDto),
    ).rejects.toThrow('unique_violation: duplicate key');

    // ROLLBACK must have been called
    const rollbackCall = client.query.mock.calls.find(
      (c: string[]) => c[0] === 'ROLLBACK',
    );
    expect(rollbackCall).toBeDefined();
  });
});
