const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
pool.query('SELECT slug, name, email_bison_instance_url, email_bison_api_key FROM workspaces ORDER BY slug').then(res => {
  console.log(JSON.stringify(res.rows, null, 2));
  pool.end();
}).catch(e => { console.error(e); process.exit(1); });
