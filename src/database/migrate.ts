/**
 * Database migration runner.
 *
 * Usage:
 *   npx ts-node src/database/migrate.ts
 *
 * How it works:
 *   1. Reads all *.sql files from src/database/migrations/ in filename order.
 *   2. Ensures a `schema_migrations` table exists to track applied migrations.
 *   3. Skips any migration whose filename already appears in `schema_migrations`.
 *   4. Executes each pending migration inside its own transaction; rolls back
 *      and aborts if any SQL statement fails.
 *
 * Configuration:
 *   Same environment variables as src/database/client.ts.
 *   Load them from .env by setting NODE_ENV or DOTENV_PATH before running,
 *   or simply export them in your shell.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load .env file if present (best-effort; silently skipped if missing)
dotenv.config();

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

// ---------------------------------------------------------------------------
// Schema-migrations table DDL
// ---------------------------------------------------------------------------
const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP    NOT NULL DEFAULT NOW()
  );
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildClientConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DB_SSL === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
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
  };
}

function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // lexicographic order — filenames are zero-padded (001_, 002_, …)
}

async function getAppliedMigrations(client: Client): Promise<Set<string>> {
  const res = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  return new Set(res.rows.map((r) => r.filename));
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runMigrations(): Promise<void> {
  const client = new Client(buildClientConfig());
  await client.connect();
  console.log('[migrate] Connected to database.');

  try {
    // Ensure the tracking table exists (outside any migration transaction)
    await client.query(CREATE_MIGRATIONS_TABLE);
    console.log('[migrate] schema_migrations table ready.');

    const files = getMigrationFiles();
    const applied = await getAppliedMigrations(client);

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log('[migrate] No pending migrations. Database is up to date.');
      return;
    }

    console.log(`[migrate] ${pending.length} pending migration(s) found.`);

    for (const filename of pending) {
      const filepath = path.join(MIGRATIONS_DIR, filename);
      const sql = fs.readFileSync(filepath, 'utf8');

      console.log(`[migrate] Applying: ${filename}`);

      // Run each migration in its own transaction
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
        console.log(`[migrate] ✓ Applied: ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[migrate] ✗ Failed: ${filename}\n  ${message}`);
        throw new Error(
          `Migration failed: ${filename}\n${message}`,
        );
      }
    }

    console.log('[migrate] All migrations applied successfully.');
  } finally {
    await client.end();
    console.log('[migrate] Database connection closed.');
  }
}

// Run when executed directly (not imported as a module)
if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('[migrate] Fatal error:', err.message);
    process.exit(1);
  });
}

export { runMigrations };
