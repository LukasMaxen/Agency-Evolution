import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

export default pool;