// One-shot script: do a complete Clinicorp sync for Thiago's tenant.
// Forces metadata refresh, broad date window (180 days back, 365 days ahead),
// and populates all mirror tables (clinics, professionals, chairs, categories,
// specialties, patients, appointments, estimates, invoices, payments, cashflow).
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

const TENANT = '426e9a3e-9216-41be-99a9-7b345c74d62b';
const SUBSCRIBER = 'sorrisominacu';
const TOKEN = '1af93b09-189a-4491-99c8-7a374e677e4a';

const now = new Date();
const back = new Date(now); back.setDate(back.getDate() - 180);
const ahead = new Date(now); ahead.setDate(ahead.getDate() + 365);
const fmt = (d) => d.toISOString().slice(0, 10);

try {
  console.log(`▶ Backfill total ${fmt(back)} → ${fmt(ahead)}`);
  const result = await runFullSync(pool, {
    tenant_id: TENANT,
    api_token: TOKEN,
    subscriber_id: SUBSCRIBER,
    from: fmt(back),
    to: fmt(ahead),
    apptFrom: fmt(back),
    apptTo: fmt(ahead),
    estFrom: fmt(back),
    estTo: fmt(ahead),
    force_metadata: true,
  });
  console.log('✅ Status:', result.status);
  console.log('Resumo:', JSON.stringify(result.summary, null, 2));
  if (result.errors?.length) console.warn('⚠️ Errors:', result.errors.slice(0, 10));
} catch (e) {
  console.error('❌ FAIL:', e.message);
  console.error(e.stack);
} finally {
  await pool.end();
}
