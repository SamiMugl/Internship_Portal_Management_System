const { Pool } = require('pg');
const p = new Pool({ host:'localhost',port:5432,user:'postgres',password:'S@mi1724',database:'internship_portal' });
p.query("SELECT COUNT(*) as cnt FROM employer_profiles WHERE approval_status = 'pending'")
  .then(r => { console.log('Pending employers in DB:', r.rows[0].cnt); p.end(); })
  .catch(e => { console.error(e.message); p.end(); });
