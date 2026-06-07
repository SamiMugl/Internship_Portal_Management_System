/**
 * EmployerProfileService
 *
 * Provides CRUD for employer profiles and company logo upload.
 *
 * All database access uses parameterised queries via BaseRepository to prevent
 * SQL injection.
 *
 * Requirements: 3.5, 3.6, 3.7
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from '../database/baseRepository';
import { EmployerProfile } from '../types';
import { UpdateEmployerProfileDTO } from '../validators/employerProfileValidators';
import { AppError } from './authService';

// ---------------------------------------------------------------------------
// Logo upload constants
// ---------------------------------------------------------------------------

/** Allowed MIME types for logo uploads (Requirement 3.7) */
export const ALLOWED_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg']);

/** Maximum logo file size: 2 MB (Requirement 3.7) */
export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

/** Local storage directory for uploaded logos */
const LOGO_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'logos');

// ---------------------------------------------------------------------------
// EmployerProfileService
// ---------------------------------------------------------------------------

export class EmployerProfileService extends BaseRepository {
  // -------------------------------------------------------------------------
  // getProfile
  // -------------------------------------------------------------------------

  /**
   * Retrieve the employer profile for the given user ID.
   *
   * @throws AppError(404, 'PROFILE_NOT_FOUND') when no profile row exists.
   *
   * Requirement 3.5
   */
  async getProfile(employerId: string): Promise<EmployerProfile> {
    const profile = await this.queryOne<EmployerProfile>(
      `SELECT id, user_id, company_name, industry, description, logo_url,
              website_url, contact_person, size_range, approval_status
       FROM   employer_profiles
       WHERE  user_id = $1`,
      [employerId],
    );

    if (!profile) {
      throw new AppError(404, 'PROFILE_NOT_FOUND', 'Employer profile not found.');
    }

    return profile;
  }

  // -------------------------------------------------------------------------
  // updateProfile
  // -------------------------------------------------------------------------

  /**
   * Apply the supplied DTO fields to the employer's profile row and return the
   * updated record.
   *
   * Only the fields present in the DTO are modified; unrecognised keys are
   * ignored by the Zod validator before this method is called.
   *
   * @throws AppError(404, 'PROFILE_NOT_FOUND') when no profile row exists.
   *
   * Requirement 3.6
   */
  async updateProfile(
    employerId: string,
    dto: UpdateEmployerProfileDTO,
  ): Promise<EmployerProfile> {
    // 1. Verify the profile exists.
    await this.getProfile(employerId);

    // 2. Build SET clause dynamically from the DTO's own keys only.
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const fieldMap: Record<keyof UpdateEmployerProfileDTO, string> = {
      companyName:   'company_name',
      industry:      'industry',
      description:   'description',
      websiteUrl:    'website_url',
      contactPerson: 'contact_person',
      sizeRange:     'size_range',
    };

    for (const [dtoKey, columnName] of Object.entries(fieldMap) as [
      keyof UpdateEmployerProfileDTO,
      string,
    ][]) {
      if (Object.prototype.hasOwnProperty.call(dto, dtoKey)) {
        setClauses.push(`${columnName} = $${paramIndex}`);
        const val = dto[dtoKey];
        // Convert undefined → null for optional nullable columns
        values.push(val === undefined ? null : val);
        paramIndex++;
      }
    }

    // If no updatable fields were provided, just return the existing profile.
    if (setClauses.length === 0) {
      return this.getProfile(employerId);
    }

    // 3. Execute the UPDATE.
    values.push(employerId); // WHERE user_id = $N
    const updated = await this.queryOne<EmployerProfile>(
      `UPDATE employer_profiles
       SET    ${setClauses.join(', ')}
       WHERE  user_id = $${paramIndex}
       RETURNING id, user_id, company_name, industry, description, logo_url,
                 website_url, contact_person, size_range, approval_status`,
      values,
    );

    if (!updated) {
      throw new AppError(404, 'PROFILE_NOT_FOUND', 'Employer profile not found.');
    }

    return updated;
  }
  // -------------------------------------------------------------------------
  // uploadLogo
  // -------------------------------------------------------------------------

  /**
   * Validate and store a company logo for the authenticated employer.
   *
   * Validation (before any I/O to storage):
   *   - MIME type must be PNG or JPEG              → 422 FILE_VALIDATION_ERROR
   *   - File size must be ≤ 2 MB                   → 422 FILE_VALIDATION_ERROR
   *
   * On success:
   *   1. Writes the file to `uploads/logos/<uuid>_<originalname>` locally
   *      (acting as local object storage for dev environments).
   *   2. Updates `employer_profiles.logo_url` with the resulting storage URL.
   *   3. Returns the updated EmployerProfile.
   *
   * @throws AppError(422, 'FILE_VALIDATION_ERROR') on MIME or size violations.
   * @throws AppError(404, 'PROFILE_NOT_FOUND')     when no employer_profile exists.
   *
   * Requirement 3.7
   */
  async uploadLogo(
    userId: string,
    file: Express.Multer.File,
  ): Promise<EmployerProfile> {
    // 1. Validate MIME type BEFORE touching storage.
    if (!ALLOWED_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new AppError(
        422,
        'FILE_VALIDATION_ERROR',
        'Invalid file type. Only PNG and JPG images are accepted.',
        { allowedTypes: [...ALLOWED_LOGO_MIME_TYPES], received: file.mimetype },
      );
    }

    // 2. Validate file size BEFORE touching storage.
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      throw new AppError(
        422,
        'FILE_VALIDATION_ERROR',
        `File size exceeds the 2 MB limit. Received ${(file.size / (1024 * 1024)).toFixed(2)} MB.`,
        { maxBytes: MAX_LOGO_SIZE_BYTES, receivedBytes: file.size },
      );
    }

    // 3. Verify the employer profile exists (needed for the WHERE clause below).
    await this.getProfile(userId);

    // 4. Ensure the upload directory exists.
    if (!fs.existsSync(LOGO_UPLOAD_DIR)) {
      fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });
    }

    // 5. Write file to local storage (dev-environment object storage).
    const fileId = uuidv4();
    const safeOriginalName = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedFilename = `${fileId}_${safeOriginalName}`;
    const storedPath = path.join(LOGO_UPLOAD_DIR, storedFilename);

    fs.writeFileSync(storedPath, file.buffer);

    // Relative URL served from the uploads directory.
    const logoUrl = `/uploads/logos/${storedFilename}`;

    // 6. Persist the URL to employer_profiles.logo_url and return the updated row.
    const updated = await this.queryOne<EmployerProfile>(
      `UPDATE employer_profiles
       SET    logo_url = $1
       WHERE  user_id  = $2
       RETURNING id, user_id, company_name, industry, description, logo_url,
                 website_url, contact_person, size_range, approval_status`,
      [logoUrl, userId],
    );

    if (!updated) {
      throw new AppError(404, 'PROFILE_NOT_FOUND', 'Employer profile not found.');
    }

    return updated;
  }
}

// Singleton instance
export const employerProfileService = new EmployerProfileService();
