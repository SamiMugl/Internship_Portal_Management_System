/**
 * Zod validation schemas for student profile update requests.
 *
 * Requirement 2.1
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// PUT /students/me/profile — request body schema
// ---------------------------------------------------------------------------

export const updateStudentProfileSchema = z
  .object({
    fullName: z
      .string()
      .min(1, 'fullName cannot be empty')
      .max(255, 'fullName must be 255 characters or fewer')
      .trim()
      .optional(),

    institution: z
      .string()
      .max(255, 'institution must be 255 characters or fewer')
      .trim()
      .nullable()
      .optional(),

    degree: z
      .string()
      .max(255, 'degree must be 255 characters or fewer')
      .trim()
      .nullable()
      .optional(),

    gpa: z
      .number()
      .min(0, 'gpa must be 0.00 or greater')
      .max(4, 'gpa must be 4.00 or less')
      .nullable()
      .optional(),

    graduationYear: z
      .number()
      .int('graduationYear must be an integer')
      .min(1900, 'graduationYear must be 1900 or later')
      .max(2100, 'graduationYear must be 2100 or earlier')
      .nullable()
      .optional(),

    skills: z
      .array(z.string().min(1).max(100))
      .max(50, 'skills must contain 50 items or fewer')
      .nullable()
      .optional(),

    bio: z
      .string()
      .max(2000, 'bio must be 2000 characters or fewer')
      .trim()
      .nullable()
      .optional(),

    photoUrl: z
      .string()
      .url('photoUrl must be a valid URL')
      .max(2048, 'photoUrl must be 2048 characters or fewer')
      .nullable()
      .optional(),
  })
  .strict(); // Reject unknown keys to prevent accidental field injection

export type UpdateStudentProfileDTO = z.infer<typeof updateStudentProfileSchema>;
