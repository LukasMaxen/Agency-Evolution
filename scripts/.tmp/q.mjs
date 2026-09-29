import pg from 'pg'; import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('/Users/kasperaggerholm/Agency-Evolution/.env.local','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).replace(/^"|"$/g,'')]));
const pool = new pg.Pool({connectionString: env.DATABASE_URL, ssl:false});
const sql = process.argv[2];
const r = await pool.query(sql); console.log(JSON.stringify(r.rows,null,1)); await pool.end();
