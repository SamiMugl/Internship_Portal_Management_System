/**
 * StudentProfileService
 *
 * Provides CRUD for student profiles and computes/caches the profile-completion
 * percentage according to the weighted-field formula defined in
 * `src/config/profileCompletion.ts`.
 *
 * All database access uses parameterised queries via BaseRepository to prevent
 * SQL injection.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from '../database/baseRepository';
import { StudentProfile, Resume } from '../types';
import { UpdateStudentProfileDTO } from '../validators/studentProfileValidators';
import {
  PROFILE_FIELD_WEIGHTS,
  TOTAL_WEIGHT,
  ProfileFields,
} from '../config/profileCompletion';
import { AppError } from './authService';

// ---------------------------------------------------------------------------
// Resume upload constants
// ---------------------------------------------------------------------------

/** Allowed MIME types for resume uploads (Requirement 2.2) */
export const ALLOWED_RESUME_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Maximum resume file size: 5 MB (Requirement 2.2) */
export const MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024;

/** Local storage directory for uploaded resumes */
const RESUME_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'resumes');

// ---------------------------------------------------------------------------
// StudentProfileService
// ---------------------------------------------------------------------------

export class StudentProfileService extends BaseRepository {
  // -------------------------------------------------------------------------
  // getProfile
  // -------------------------------------------------------------------------

  /**
   * Retrieve the student profile for the given user ID.
   *
   * @throws AppError(404, 'PROFILE_NOT_FOUND') when no profile row exists.
   */
  async getProfile(userId: string): Promise<StudentProfile> {
    const profile = await this.queryOne<StudentProfile>(
      `SELECT id, user_id, full_name, institution, degree, gpa,
              graduation_year, skills, bio, photo_url, completion_pct
       FROM   student_profiles
       WHERE  user_id = $1`,
      [userId],
    );

    if (!profile) {
      throw new AppError(404, 'PROFILE_NOT_FOUND', 'Student profile not found.');
    }

    return profile;
  }

  // -------------------------------------------------------------------------
  // updateProfile
  // -------------------------------------------------------------------------

  /**
   * Apply the supplied DTO fields to the student's profile row, recompute the
   * completion percentage, cache it back to `completion_pct`, and return the
   * updated profile.
   *
   * Only the fields present in the DTO are modified; unrecognised keys are
   * ignored by the Zod validator before this method is called.
   *
   * @throws AppError(404, 'PROFILE_NOT_FOUND') when no profile row exists.
   */
  async updateProfile(
    userId: string,
    dto: UpdateStudentProfileDTO,
  ): Promise<StudentProfile> {
    // 1. Verify the profile exists.
    const existing = await this.getProfile(userId);

    // 2. Build SET clause dynamically from the DTO's own keys only.
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const fieldMap: Record<keyof UpdateStudentProfileDTO, string> = {
      fullName:       'full_name',
      institution:    'institution',
      degree:         'degree',
      gpa:            'gpa',
      graduationYear: 'graduation_year',
      skills:         'skills',
      bio:            'bio',
      photoUrl:       'photo_url',
    };

    for (const [dtoKey, columnName] of Object.entries(fieldMap) as [
      keyof UpdateStudentProfileDTO,
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

    // 3. Compute the completion percentage from the merged profile snapshot.
    const merged: ProfileFields = {
      full_name:       Object.prototype.hasOwnProperty.call(dto, 'fullName')
                         ? (dto.fullName ?? null)
                         : existing.full_name,
      institution:     Object.prototype.hasOwnProperty.call(dto, 'institution')
                         ? (dto.institution ?? null)
                         : existing.institution,
      degree:          Object.prototype.hasOwnProperty.call(dto, 'degree')
                         ? (dto.degree ?? null)
                         : existing.degree,
      gpa:             Object.prototype.hasOwnProperty.call(dto, 'gpa')
                         ? (dto.gpa !== undefined ? String(dto.gpa) : null)
                         : existing.gpa,
      graduation_year: Object.prototype.hasOwnProperty.call(dto, 'graduationYear')
                         ? (dto.graduationYear ?? null)
                         : existing.graduation_year,
      skills:          Object.prototype.hasOwnProperty.call(dto, 'skills')
                         ? (dto.skills ?? null)
                         : existing.skills,
      bio:             Object.prototype.hasOwnProperty.call(dto, 'bio')
                         ? (dto.bio ?? null)
                         : existing.bio,
      photo_url:       Object.prototype.hasOwnProperty.call(dto, 'photoUrl')
                         ? (dto.photoUrl ?? null)
                         : existing.photo_url,
    };

    const completionPct = this.computeCompletionPct(merged);

    // Always update completion_pct.
    setClauses.push(`completion_pct = $${paramIndex}`);
    values.push(completionPct);
    paramIndex++;

    if (setClauses.length === 1) {
      // Only completion_pct changed — still execute so we cache the new value.
    }

    // 4. Execute the UPDATE.
    values.push(userId); // WHERE user_id = $N
    const updated = await this.queryOne<StudentProfile>(
      `UPDATE student_profiles
       SET    ${setClauses.join(', ')}
       WHERE  user_id = $${paramIndex}
       RETURNING id, user_id, full_name, institution, degree, gpa,
                 graduation_year, skills, bio, photo_url, completion_pct`,
      values,
    );

    if (!updated) {
      throw new AppError(404, 'PROFILE_NOT_FOUND', 'Student profile not found.');
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // uploadResume
  // -------------------------------------------------------------------------

  /**
   * Validate and store a resume file for the authenticated student.
   *
   * Validation (before any I/O to storage):
   *   - MIME type must be PDF or DOCX          → 422 FILE_VALIDATION_ERROR
   *   - File size must be ≤ 5 MB               → 422 FILE_VALIDATION_ERROR
   *
   * On success:
   *   1. Writes the file to `uploads/resumes/<uuid>_<originalname>` locally
   *      (acting as local object storage for dev environments).
   *   2. Sets all existing active resumes for this student to is_active = false.
   *   3. Inserts a new resume row with is_active = true.
   *
   * @throws AppError(422, 'FILE_VALIDATION_ERROR') on MIME or size violations.
   * @throws AppError(404, 'PROFILE_NOT_FOUND')     when no student_profile exists.
   *
   * Requirements: 2.2, 2.3
   */
  async uploadResume(
    userId: string,
    file: Express.Multer.File,
  ): Promise<Resume> {
    // 1. Validate MIME type BEFORE touching storage.
    if (!ALLOWED_RESUME_MIME_TYPES.has(file.mimetype)) {
      throw new AppError(
        422,
        'FILE_VALIDATION_ERROR',
        'Invalid file type. Only PDF and DOCX files are accepted.',
        { allowedTypes: [...ALLOWED_RESUME_MIME_TYPES], received: file.mimetype },
      );
    }

    // 2. Validate file size BEFORE touching storage.
    if (file.size > MAX_RESUME_SIZE_BYTES) {
      throw new AppError(
        422,
        'FILE_VALIDATION_ERROR',
        `File size exceeds the 5 MB limit. Received ${(file.size / (1024 * 1024)).toFixed(2)} MB.`,
        { maxBytes: MAX_RESUME_SIZE_BYTES, receivedBytes: file.size },
      );
    }

    // 3. Resolve the student profile (needed for the student_id FK).
    const profile = await this.getProfile(userId);

    // 4. Ensure the upload directory exists.
    if (!fs.existsSync(RESUME_UPLOAD_DIR)) {
      fs.mkdirSync(RESUME_UPLOAD_DIR, { recursive: true });
    }

    // 5. Write file to local storage (dev-environment object storage).
    const fileId = uuidv4();
    const safeOriginalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedFilename = `${fileId}_${safeOriginalName}`;
    const storedPath = path.join(RESUME_UPLOAD_DIR, storedFilename);

    fs.writeFileSync(storedPath, file.buffer);

    // Relative URL served from the uploads directory.
    const fileUrl = `/uploads/resumes/${storedFilename}`;

    // 6. Atomically deactivate previous resumes and insert the new one.
    const resume = await this.transaction(async (client) => {
      // Deactivate all currently active resumes for this student.
      await this.queryWithClient(
        client,
        `UPDATE resumes
         SET    is_active = FALSE
         WHERE  student_id = $1
           AND  is_active  = TRUE`,
        [profile.id],
      );

      // Insert the new resume as active.
      const inserted = await this.queryOneWithClient<Resume>(
        client,
        `INSERT INTO resumes (student_id, file_url, original_name, file_size_bytes, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id, student_id, file_url, original_name, file_size_bytes, uploaded_at, is_active`,
        [profile.id, fileUrl, file.originalname, file.size],
      );

      return inserted!;
    });

    return resume;
  }

  // -------------------------------------------------------------------------
  // getCompletionPercentage
  // -------------------------------------------------------------------------

  /**
   * Compute the current completion percentage, cache it on the DB row, and
   * return the numeric value (0–100).
   *
   * @throws AppError(404, 'PROFILE_NOT_FOUND') when no profile row exists.
   */
  async getCompletionPercentage(userId: string): Promise<number> {
    const profile = await this.getProfile(userId);

    const fields: ProfileFields = {
      full_name:       profile.full_name,
      institution:     profile.institution,
      degree:          profile.degree,
      gpa:             profile.gpa,
      graduation_year: profile.graduation_year,
      skills:          profile.skills,
      bio:             profile.bio,
      photo_url:       profile.photo_url,
    };

    const completionPct = this.computeCompletionPct(fields);

    // Cache the computed value back to the DB row.
    await this.query(
      `UPDATE student_profiles
       SET    completion_pct = $1
       WHERE  user_id = $2`,
      [completionPct, userId],
    );

    return completionPct;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Evaluate the weighted-field formula against the given profile snapshot.
   *
   * Returns a value in [0, 100] rounded to 2 decimal places.
   */
  private computeCompletionPct(fields: ProfileFields): number {
    let earned = 0;

    for (const { field, weight } of PROFILE_FIELD_WEIGHTS) {
      if (this.isFieldPopulated(field, fields)) {
        earned += weight;
      }
    }

    if (TOTAL_WEIGHT === 0) return 0;

    const pct = (earned / TOTAL_WEIGHT) * 100;
    // Round to 2 decimal places (matches NUMERIC(5,2) column precision).
    return Math.round(pct * 100) / 100;
  }

  /**
   * Determine whether a specific profile field is considered "populated":
   *  - string  → not null AND trimmed length > 0
   *  - numeric → not null
   *  - array   → not null AND length > 0
   */
  private isFieldPopulated(field: keyof ProfileFields, fields: ProfileFields): boolean {
    const value = fields[field];

    if (value === null || value === undefined) return false;

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    // number (graduation_year) or string-encoded numeric (gpa)
    return true;
  }
}

// Singleton instance
export const studentProfileService = new StudentProfileService();
