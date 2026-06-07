require('./bootstrap.js');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'S@mi1724',
  database: 'internship_portal'
});

async function createAdmin() {
  const hash = await bcrypt.hash('Admin@1234', 12);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
     SET password_hash = $2, role = $3, status = $4`,
    ['admin@portal.com', hash, 'admin', 'active']
  );
  console.log('');
  console.log('✅ Admin account created successfully!');
  console.log('   Email:    admin@portal.com');
  console.log('   Password: Admin@1234');
  console.log('');
  await pool.end();
}

createAdmin().catch(e => {
  console.error('Error:', e.message);
  pool.end();
  process.exit(1);
});
