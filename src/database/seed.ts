/**
 * Seed default admin account for local / demo use.
 *
 *   Email:    admin@internshipportal.com
 *   Password: Admin@123456
 */

import * as dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { Client } from 'pg';

dotenv.config();

const ADMIN_EMAIL = 'admin@internshipportal.com';
const ADMIN_PASSWORD = 'Admin@123456';

function buildClientConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

async function seedAdmin(): Promise<void> {
  const client = new Client(buildClientConfig());
  await client.connect();

  try {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [ADMIN_EMAIL]);
    if (existing.rows.length > 0) {
      console.log('[seed] Admin account already exists:', ADMIN_EMAIL);
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await client.query(
      `INSERT INTO users (email, password_hash, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [ADMIN_EMAIL, passwordHash],
    );

    console.log('[seed] Admin account created successfully.');
    console.log(`[seed]   Email:    ${ADMIN_EMAIL}`);
    console.log(`[seed]   Password: ${ADMIN_PASSWORD}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  seedAdmin().catch((err) => {
    console.error('[seed] Failed:', err.message);
    process.exit(1);
  });
}

export { seedAdmin };
