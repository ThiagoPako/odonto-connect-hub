import pg from 'pg';
import { runFullSync } from './clinicorp.mjs';

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

const settings = {
  tenant_id: '426e9a3e-9216-41be-99a9-7b345c74d62b',
  api_token: '1af93b09-189a-4491-99c8-7a374e677e4a',
  subscriber_id: 'sorrisominacu',
  force_metadata: true,
};

async function testSync() {
  try {
    console.log('Starting sync...');
    const result = await runFullSync(pool, settings);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Sync failed:', e);
  } finally {
    await pool.end();
  }
}

testSync();
