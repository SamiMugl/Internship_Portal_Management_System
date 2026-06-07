require('./bootstrap.js');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ host:'localhost', port:5432, user:'postgres', password:'S@mi1724', database:'internship_portal' });

async function run() {
  const hash = await bcrypt.hash('Test@1234', 12);
  const userId = uuidv4();
  
  // Delete existing test student if exists
  await pool.query("DELETE FROM student_profiles WHERE user_id IN (SELECT id FROM users WHERE email='test.student@portal.com')");
  await pool.query("DELETE FROM users WHERE email='test.student@portal.com'");
  
  // Create fresh student
  await pool.query(
    `INSERT INTO users (id, email, password_hash, role, status) VALUES ($1, $2, $3, 'student', 'active')`,
    [userId, 'test.student@portal.com', hash]
  );
  await pool.query(
    `INSERT INTO student_profiles (user_id, full_name, completion_pct) VALUES ($1, $2, 0)`,
    [userId, 'Test Student']
  );
  
  console.log('');
  console.log('✅ Fresh student account created!');
  console.log('   Email:    test.student@portal.com');
  console.log('   Password: Test@1234');
  console.log('   Role:     student (VERIFIED - active status)');
  console.log('');
  console.log('Login with these credentials to see the STUDENT portal.');
  console.log('');
  await pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); });
