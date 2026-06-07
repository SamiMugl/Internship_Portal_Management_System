/**
 * Zod validation schemas for auth registration request bodies.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field definitions
// ---------------------------------------------------------------------------

const emailField = z
  .string({ required_error: 'email is required' })
  .email('email must be a valid email address')
  .max(255, 'email must be 255 characters or fewer')
  .toLowerCase();

const passwordField = z
  .string({ required_error: 'password is required' })
  .min(8, 'password must be at least 8 characters')
  .max(128, 'password must be 128 characters or fewer');

const fullNameField = z
  .string({ required_error: 'fullName is required' })
  .min(1, 'fullName cannot be empty')
  .max(255, 'fullName must be 255 characters or fewer')
  .trim();

// ---------------------------------------------------------------------------
// Student registration
// ---------------------------------------------------------------------------

export const registerStudentSchema = z.object({
  email: emailField,
  password: passwordField,
  fullName: fullNameField,
  institution: z.string().max(255).optional(),
  degree: z.string().max(255).optional(),
});

export type RegisterStudentDTO = z.infer<typeof registerStudentSchema>;

// ---------------------------------------------------------------------------
// Employer registration
// ---------------------------------------------------------------------------

export const registerEmployerSchema = z.object({
  email: emailField,
  password: passwordField,
  companyName: z
    .string({ required_error: 'companyName is required' })
    .min(1, 'companyName cannot be empty')
    .max(255, 'companyName must be 255 characters or fewer')
    .trim(),
  industry: z.string().max(100).optional(),
  contactPerson: z
    .string({ required_error: 'contactPerson is required' })
    .min(1, 'contactPerson cannot be empty')
    .max(255, 'contactPerson must be 255 characters or fewer')
    .trim(),
});

export type RegisterEmployerDTO = z.infer<typeof registerEmployerSchema>;
