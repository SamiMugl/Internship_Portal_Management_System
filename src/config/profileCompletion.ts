/**
 * profileCompletion.ts
 *
 * Configuration constants for the student-profile completion-percentage formula.
 *
 * Each entry maps a profile field name to a weight (points).  Mandatory fields
 * carry a higher weight than optional fields.  The completion percentage is:
 *
 *   completionPct = (sum of weights for populated fields / TOTAL_WEIGHT) * 100
 *
 * "Populated" means:
 *   - string fields   → not null AND trimmed length > 0
 *   - numeric fields  → not null
 *   - array fields    → not null AND length > 0
 *
 * Requirement 2.4
 */

export interface FieldWeight {
  /** The column name on the student_profiles row. */
  field: keyof ProfileFields;
  /** Weight assigned to this field when it is populated. */
  weight: number;
  /** Whether this field is considered mandatory (for UI prompts). */
  mandatory: boolean;
}

/**
 * Subset of StudentProfile fields that are evaluated for completion.
 * (Excludes id, user_id, and completion_pct itself.)
 */
export interface ProfileFields {
  full_name: string | null;
  institution: string | null;
  degree: string | null;
  gpa: string | null;
  graduation_year: number | null;
  skills: string[] | null;
  bio: string | null;
  photo_url: string | null;
}

/**
 * Weighted field definitions.
 * Total weight = sum of all weights = 100 (for clean percentage arithmetic).
 */
export const PROFILE_FIELD_WEIGHTS: FieldWeight[] = [
  { field: 'full_name',        weight: 20, mandatory: true  },
  { field: 'institution',      weight: 15, mandatory: true  },
  { field: 'degree',           weight: 15, mandatory: true  },
  { field: 'gpa',              weight: 10, mandatory: false },
  { field: 'graduation_year',  weight: 10, mandatory: false },
  { field: 'skills',           weight: 15, mandatory: false },
  { field: 'bio',              weight: 10, mandatory: false },
  { field: 'photo_url',        weight: 5,  mandatory: false },
];

/**
 * The sum of all field weights — used as the denominator in the formula.
 * Computed once at module load to avoid repeated iteration.
 */
export const TOTAL_WEIGHT: number = PROFILE_FIELD_WEIGHTS.reduce(
  (sum, fw) => sum + fw.weight,
  0,
);

/**
 * Profile-completion threshold (0–100) below which students are prompted
 * to complete their profile before applying to listings.
 *
 * Requirement 2.6
 */
export const COMPLETION_THRESHOLD = 60;
