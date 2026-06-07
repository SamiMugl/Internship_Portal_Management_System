/**
 * PostgreSQL connection pool.
 *
 * Configuration is read from environment variables in this priority order:
 *   1. DATABASE_URL  — a full connection string (recommended for production)
 *   2. Individual DB_* variables (useful for local development without a DSN)
 *
 * Required env vars (if DATABASE_URL is not set):
 *   DB_HOST     default: localhost
 *   DB_PORT     default: 5432
 *   DB_NAME     (required)
 *   DB_USER     (required)
 *   DB_PASSWORD (required)
 *
 * Optional:
 *   DB_POOL_MIN  default: 2
 *   DB_POOL_MAX  default: 10
 *   DB_SSL       set to "true" to enable SSL (needed for cloud databases)
 */

import { Pool, PoolConfig } from 'pg';

function buildPoolConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DB_SSL === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
      min: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
      max: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
    };
  }

  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:
      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
    min: parseInt(process.env.DB_POOL_MIN ?? '2', 10),
    max: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
  };
}

export const pool = new Pool(buildPoolConfig());

// Log pool-level errors so they don't become unhandled promise rejections.
pool.on('error', (err: Error) => {
  console.error('[db-pool] Unexpected error on idle client:', err.message);
});

/**
 * Verify the database connection on startup.
 * Call this from your application entry point.
 */
export async function connectDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('[db-pool] Database connection established.');
  } finally {
    client.release();
  }
}

/**
 * Gracefully drain and end the pool.
 * Call this during application shutdown (SIGTERM / SIGINT handlers).
 */
export async function disconnectDatabase(): Promise<void> {
  await pool.end();
  console.log('[db-pool] Database pool closed.');
}
