import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

async function test() {
  console.log('Testing DB connection...');
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('DB Time:', res.rows[0].now);
  } catch (e) {
    console.error('DB failed:', e.message);
  } finally {
    await pool.end();
  }
}

test();
