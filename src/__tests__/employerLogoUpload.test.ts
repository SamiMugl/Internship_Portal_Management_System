/**
 * Unit tests for employer company logo upload (task 6.2).
 *
 * Requirements: 3.7
 *
 * These tests exercise the validation and persistence path of
 * EmployerProfileService.uploadLogo without a live database connection by
 * monkey-patching only the minimum DB interaction needed.
 */

import fs from 'fs';
import path from 'path';
import {
  EmployerProfileService,
  ALLOWED_LOGO_MIME_TYPES,
  MAX_LOGO_SIZE_BYTES,
} from '../services/employerProfileService';
import { AppError } from '../services/authService';
import { EmployerProfile, ApprovalStatus } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Express.Multer.File-like object for tests. */
function makeFile(
  mimetype: string,
  sizeBytes: number,
  originalname = 'logo.png',
): Express.Multer.File {
  return {
    fieldname: 'logo',
    originalname,
    encoding: '7bit',
    mimetype,
    buffer: Buffer.alloc(sizeBytes),
    size: sizeBytes,
    stream: null as unknown as import('stream').Readable,
    destination: '',
    filename: '',
    path: '',
  };
}

/** A valid EmployerProfile stub returned by stubbed DB queries. */
const STUB_PROFILE: EmployerProfile = {
  id: 'emp-id-1',
  user_id: 'user-id-1',
  company_name: 'Acme Corp',
  industry: 'Tech',
  description: null,
  logo_url: null,
  website_url: null,
  contact_person: null,
  size_range: null,
  approval_status: ApprovalStatus.Pending,
};

// ---------------------------------------------------------------------------
// EmployerProfileService.uploadLogo — validation unit tests
// ---------------------------------------------------------------------------

describe('EmployerProfileService.uploadLogo — validation', () => {
  it('rejects an unsupported MIME type with FILE_VALIDATION_ERROR (422)', async () => {
    const service = new EmployerProfileService();
    const file = makeFile('application/pdf', 100);

    await expect(service.uploadLogo('user-id-1', file)).rejects.toMatchObject({
      statusCode: 422,
      code: 'FILE_VALIDATION_ERROR',
    });
  });

  it('rejects a file that exceeds 2 MB with FILE_VALIDATION_ERROR (422)', async () => {
    const service = new EmployerProfileService();
    const oversize = MAX_LOGO_SIZE_BYTES + 1;
    const file = makeFile('image/png', oversize);

    await expect(service.uploadLogo('user-id-1', file)).rejects.toMatchObject({
      statusCode: 422,
      code: 'FILE_VALIDATION_ERROR',
    });
  });

  it('accepts image/png MIME type (does not throw FILE_VALIDATION_ERROR)', async () => {
    const service = new EmployerProfileService();

    // Stub the DB calls so the method can complete without a live database.
    jest.spyOn(service, 'queryOne').mockResolvedValue(STUB_PROFILE as never);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const file = makeFile('image/png', 1024);

    const result = await service.uploadLogo('user-id-1', file);

    // logo_url should now be set
    expect(result).toBeDefined();

    jest.restoreAllMocks();
  });

  it('accepts image/jpeg MIME type (does not throw FILE_VALIDATION_ERROR)', async () => {
    const service = new EmployerProfileService();

    jest.spyOn(service, 'queryOne').mockResolvedValue(STUB_PROFILE as never);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const file = makeFile('image/jpeg', 512, 'photo.jpg');

    const result = await service.uploadLogo('user-id-1', file);
    expect(result).toBeDefined();

    jest.restoreAllMocks();
  });

  it('accepts a file exactly at the 2 MB limit', async () => {
    const service = new EmployerProfileService();

    jest.spyOn(service, 'queryOne').mockResolvedValue(STUB_PROFILE as never);
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const file = makeFile('image/png', MAX_LOGO_SIZE_BYTES);

    const result = await service.uploadLogo('user-id-1', file);
    expect(result).toBeDefined();

    jest.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// ALLOWED_LOGO_MIME_TYPES / MAX_LOGO_SIZE_BYTES constants
// ---------------------------------------------------------------------------

describe('Logo upload constants (Requirement 3.7)', () => {
  it('allows image/png', () => {
    expect(ALLOWED_LOGO_MIME_TYPES.has('image/png')).toBe(true);
  });

  it('allows image/jpeg', () => {
    expect(ALLOWED_LOGO_MIME_TYPES.has('image/jpeg')).toBe(true);
  });

  it('does not allow application/pdf', () => {
    expect(ALLOWED_LOGO_MIME_TYPES.has('application/pdf')).toBe(false);
  });

  it('does not allow image/gif', () => {
    expect(ALLOWED_LOGO_MIME_TYPES.has('image/gif')).toBe(false);
  });

  it('max size is exactly 2 MB (2 * 1024 * 1024 bytes)', () => {
    expect(MAX_LOGO_SIZE_BYTES).toBe(2 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// uploadLogo — persistence path
// ---------------------------------------------------------------------------

describe('EmployerProfileService.uploadLogo — persistence', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists logo_url to employer_profiles and returns the updated profile', async () => {
    const service = new EmployerProfileService();

    // First call to queryOne → getProfile() returning the existing profile
    // Second call to queryOne → the UPDATE … RETURNING row with logo_url populated
    const updatedProfile: EmployerProfile = {
      ...STUB_PROFILE,
      logo_url: '/uploads/logos/some-uuid_logo.png',
    };

    const queryOneSpy = jest
      .spyOn(service, 'queryOne')
      .mockResolvedValueOnce(STUB_PROFILE as never)   // getProfile check
      .mockResolvedValueOnce(updatedProfile as never); // UPDATE … RETURNING

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const file = makeFile('image/png', 1024);
    const result = await service.uploadLogo('user-id-1', file);

    // Returned profile must include a logo_url
    expect(result.logo_url).not.toBeNull();
    expect(typeof result.logo_url).toBe('string');
    expect(result.logo_url).toMatch(/^\/uploads\/logos\//);

    // queryOne must have been called twice (getProfile + UPDATE)
    expect(queryOneSpy).toHaveBeenCalledTimes(2);

    // The UPDATE call must include 'logo_url' in the SQL
    const updateCallArgs = queryOneSpy.mock.calls[1];
    expect(updateCallArgs[0]).toMatch(/logo_url/i);
  });

  it('throws PROFILE_NOT_FOUND (404) when the profile does not exist', async () => {
    const service = new EmployerProfileService();

    // getProfile() returns null → triggers 404 inside getProfile
    jest.spyOn(service, 'queryOne').mockResolvedValue(null);

    const file = makeFile('image/png', 512);

    await expect(service.uploadLogo('nonexistent-user', file)).rejects.toMatchObject({
      statusCode: 404,
      code: 'PROFILE_NOT_FOUND',
    });
  });
});
