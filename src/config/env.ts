/**
 * Environment configuration.
 * All env vars are read here and exported as typed constants so the rest of
 * the code never calls `process.env` directly.
 */

export const env = {
  /** Node environment */
  NODE_ENV: process.env.NODE_ENV ?? 'development',

  /** HTTP port the server listens on */
  PORT: parseInt(process.env.PORT ?? '3000', 10),

  /** Redis connection URL used by Bull and ioredis */
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',

  /** JWT secret for access tokens */
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'change-me-access-secret',

  /** JWT secret for email verification tokens */
  JWT_VERIFICATION_SECRET:
    process.env.JWT_VERIFICATION_SECRET ?? 'change-me-verify-secret',

  /** JWT secret for refresh tokens (used to sign the opaque refresh token value) */
  JWT_REFRESH_SECRET:
    process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh-secret',

  /** JWT secret for password-reset tokens */
  JWT_RESET_SECRET:
    process.env.JWT_RESET_SECRET ?? 'change-me-reset-secret',

  /** Access token TTL in seconds (15 minutes) */
  JWT_ACCESS_EXPIRES_IN: parseInt(process.env.JWT_ACCESS_EXPIRES_IN ?? '900', 10),

  /** Refresh token TTL in seconds (7 days) */
  JWT_REFRESH_EXPIRES_IN: parseInt(process.env.JWT_REFRESH_EXPIRES_IN ?? '604800', 10),

  /** Password-reset token TTL in seconds (1 hour) */
  JWT_RESET_EXPIRES_IN: parseInt(process.env.JWT_RESET_EXPIRES_IN ?? '3600', 10),

  /** Email verification token TTL in seconds (24 hours) */
  EMAIL_VERIFICATION_EXPIRES_IN: parseInt(
    process.env.EMAIL_VERIFICATION_EXPIRES_IN ?? '86400',
    10,
  ),

  /** bcrypt cost factor */
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),

  // ---------------------------------------------------------------------------
  // SMTP / Email config
  // ---------------------------------------------------------------------------

  /** SMTP host (e.g. smtp.gmail.com) */
  SMTP_HOST: process.env.SMTP_HOST ?? 'smtp.ethereal.email',

  /** SMTP port (587 for STARTTLS, 465 for SSL) */
  SMTP_PORT: parseInt(process.env.SMTP_PORT ?? '587', 10),

  /** Whether to use TLS (true for port 465) */
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',

  /** SMTP authentication username */
  SMTP_USER: process.env.SMTP_USER ?? '',

  /** SMTP authentication password */
  SMTP_PASS: process.env.SMTP_PASS ?? '',

  /** From address shown in outbound emails */
  EMAIL_FROM: process.env.EMAIL_FROM ?? 'Internship Portal <noreply@internshipportal.local>',

  /** Base URL for links embedded in emails (e.g. verification links) */
  APP_BASE_URL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
} as const;
