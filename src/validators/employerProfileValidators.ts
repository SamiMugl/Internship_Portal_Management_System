/**
 * Zod validation schemas for employer profile update requests.
 *
 * Requirements: 3.5, 3.6
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// PUT /employers/me/profile — request body schema
// ---------------------------------------------------------------------------

export const updateEmployerProfileSchema = z
  .object({
    companyName: z
      .string()
      .min(1, 'companyName cannot be empty')
      .max(255, 'companyName must be 255 characters or fewer')
      .trim()
      .optional(),

    industry: z
      .string()
      .max(100, 'industry must be 100 characters or fewer')
      .trim()
      .nullable()
      .optional(),

    description: z
      .string()
      .trim()
      .nullable()
      .optional(),

    websiteUrl: z
      .string()
      .url('websiteUrl must be a valid URL')
      .max(2048, 'websiteUrl must be 2048 characters or fewer')
      .nullable()
      .optional(),

    contactPerson: z
      .string()
      .max(255, 'contactPerson must be 255 characters or fewer')
      .trim()
      .nullable()
      .optional(),

    sizeRange: z
      .string()
      .max(50, 'sizeRange must be 50 characters or fewer')
      .trim()
      .nullable()
      .optional(),
  })
  .strict(); // Reject unknown keys to prevent accidental field injection

export type UpdateEmployerProfileDTO = z.infer<typeof updateEmployerProfileSchema>;
