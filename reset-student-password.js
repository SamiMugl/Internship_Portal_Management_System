require('./bootstrap.js');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({ host:'localhost', port:5432, user:'postgres', password:'S@mi1724', database:'internship_portal' });

async function reset() {
  const hash = await bcrypt.hash('Student@1234', 12);
  await pool.query(
    `UPDATE users SET password_hash=$1, status='active', failed_login_attempts=0 WHERE email=$2`,
    [hash, 'samimugl1724@gmail.com']
  );
  console.log('');
  console.log('✅ Student password reset!');
  console.log('   Email:    samimugl1724@gmail.com');
  console.log('   Password: Student@1234');
  console.log('   Role:     student');
  console.log('');
  await pool.end();
}

reset().catch(e => { console.error(e.message); pool.end(); });
