/**
 * Zod validation schemas for internship listing requests.
 *
 * Requirements: 4.1, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /listings — create a draft listing
// ---------------------------------------------------------------------------

export const createListingSchema = z
  .object({
    title: z
      .string()
      .min(1, 'title cannot be empty')
      .max(255, 'title must be 255 characters or fewer')
      .trim(),

    description: z
      .string()
      .min(1, 'description cannot be empty')
      .trim(),

    requiredSkills: z
      .array(z.string().min(1).trim())
      .optional()
      .default([]),

    durationWeeks: z
      .number()
      .int('durationWeeks must be an integer')
      .positive('durationWeeks must be a positive integer'),

    location: z
      .string()
      .min(1, 'location cannot be empty')
      .max(255, 'location must be 255 characters or fewer')
      .trim(),

    stipendMonthly: z
      .number()
      .nonnegative('stipendMonthly must be non-negative')
      .nullable()
      .optional(),

    applicationDeadline: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        'applicationDeadline must be a date in YYYY-MM-DD format',
      )
      .refine(
        (v) => !isNaN(Date.parse(v)),
        'applicationDeadline must be a valid date',
      ),

    openings: z
      .number()
      .int('openings must be an integer')
      .positive('openings must be a positive integer'),
  })
  .strict();

export type CreateListingDTO = z.infer<typeof createListingSchema>;

// ---------------------------------------------------------------------------
// PUT /listings/:id — update listing fields
// ---------------------------------------------------------------------------

export const updateListingSchema = z
  .object({
    title: z
      .string()
      .min(1, 'title cannot be empty')
      .max(255, 'title must be 255 characters or fewer')
      .trim()
      .optional(),

    description: z
      .string()
      .min(1, 'description cannot be empty')
      .trim()
      .optional(),

    requiredSkills: z
      .array(z.string().min(1).trim())
      .optional(),

    durationWeeks: z
      .number()
      .int('durationWeeks must be an integer')
      .positive('durationWeeks must be a positive integer')
      .optional(),

    location: z
      .string()
      .min(1, 'location cannot be empty')
      .max(255, 'location must be 255 characters or fewer')
      .trim()
      .optional(),

    stipendMonthly: z
      .number()
      .nonnegative('stipendMonthly must be non-negative')
      .nullable()
      .optional(),

    applicationDeadline: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        'applicationDeadline must be a date in YYYY-MM-DD format',
      )
      .refine(
        (v) => !isNaN(Date.parse(v)),
        'applicationDeadline must be a valid date',
      )
      .optional(),

    openings: z
      .number()
      .int('openings must be an integer')
      .positive('openings must be a positive integer')
      .optional(),
  })
  .strict();

export type UpdateListingDTO = z.infer<typeof updateListingSchema>;

// ---------------------------------------------------------------------------
// GET /listings — search / filter published listings
// ---------------------------------------------------------------------------

/**
 * Query-parameter schema for the public listing search endpoint.
 *
 * All fields are optional.  Numeric range params are accepted as strings
 * (query params are always strings) and coerced to numbers.
 *
 * Requirements: 5.1, 5.2, 5.3
 */
export const listingFilterSchema = z
  .object({
    /** Full-text keyword applied to title, description, and required_skills */
    keyword: z.string().trim().optional(),

    /** Filter by the employer's industry (exact, case-insensitive) */
    industry: z.string().trim().optional(),

    /** Filter by listing location (ILIKE) */
    location: z.string().trim().optional(),

    /** Minimum duration in weeks */
    durationWeeksMin: z.coerce
      .number()
      .int()
      .positive()
      .optional(),

    /** Maximum duration in weeks */
    durationWeeksMax: z.coerce
      .number()
      .int()
      .positive()
      .optional(),

    /** Minimum monthly stipend */
    stipendMonthlyMin: z.coerce
      .number()
      .nonnegative()
      .optional(),

    /** Maximum monthly stipend */
    stipendMonthlyMax: z.coerce
      .number()
      .nonnegative()
      .optional(),

    /**
     * Comma-separated list of required skills.
     * The search returns listings that have ANY overlap with this list.
     */
    skills: z
      .string()
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .optional(),

    /**
     * Return only listings whose application_deadline is on or before this
     * date.  Accepts YYYY-MM-DD strings.
     */
    deadlineBefore: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        'deadlineBefore must be a date in YYYY-MM-DD format',
      )
      .refine((v) => !isNaN(Date.parse(v)), 'deadlineBefore must be a valid date')
      .optional(),

    /** 1-based page number (default: 1) */
    page: z.coerce.number().int().positive().optional().default(1),

    /** Number of results per page (default: 20, max: 100) */
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(100, 'pageSize must be 100 or fewer')
      .optional()
      .default(20),
  })
  .strict();

export type ListingFilterDTO = z.infer<typeof listingFilterSchema>;
