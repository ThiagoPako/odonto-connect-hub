import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'odonto_db',
  user: process.env.PG_USER || 'odonto_user',
  password: process.env.PG_PASSWORD,
});

async function testRLS() {
  const client = await pool.connect();
  try {
    console.log('--- Starting RLS Verification Test ---');

    // 1. Create two test tenants
    const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    console.log(`Setting up test data for Tenant A (${tenantA}) and Tenant B (${tenantB})...`);
    
    // Ensure table exists and has tenant_id
    await client.query('CREATE TABLE IF NOT EXISTS test_rls_table (id UUID PRIMARY KEY, name TEXT, tenant_id UUID)');
    await client.query('ALTER TABLE test_rls_table ENABLE ROW LEVEL SECURITY');
    await client.query('DROP POLICY IF EXISTS tenant_isolation_policy ON test_rls_table');
    await client.query(`
      CREATE POLICY tenant_isolation_policy ON test_rls_table USING (
        (current_setting('app.is_super_admin', true) = 'true') OR 
        (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      )
    `);

    // Clean up old test data
    await client.query('DELETE FROM test_rls_table WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);

    // Insert records directly (bypassing RLS because we are the owner/superuser here, but we'll test visibility next)
    await client.query('INSERT INTO test_rls_table (id, name, tenant_id) VALUES (gen_random_uuid(), $1, $2)', ['Data A', tenantA]);
    await client.query('INSERT INTO test_rls_table (id, name, tenant_id) VALUES (gen_random_uuid(), $1, $2)', ['Data B', tenantB]);

    console.log('Test data created.');

    // 2. Test Tenant A visibility
    console.log('\nTesting visibility for Tenant A...');
    await client.query("SELECT set_config('app.is_super_admin', 'false', true)");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);
    
    const resA = await client.query('SELECT * FROM test_rls_table');
    console.log(`Tenant A sees ${resA.rowCount} records.`);
    resA.rows.forEach(r => console.log(` - ${r.name} (tenant_id: ${r.tenant_id})`));

    if (resA.rowCount === 1 && resA.rows[0].tenant_id === tenantA) {
      console.log('✅ PASS: Tenant A only sees their own data.');
    } else {
      console.log('❌ FAIL: Tenant A visibility incorrect.');
    }

    // 3. Test Tenant B visibility
    console.log('\nTesting visibility for Tenant B...');
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantB]);
    
    const resB = await client.query('SELECT * FROM test_rls_table');
    console.log(`Tenant B sees ${resB.rowCount} records.`);
    resB.rows.forEach(r => console.log(` - ${r.name} (tenant_id: ${r.tenant_id})`));

    if (resB.rowCount === 1 && resB.rows[0].tenant_id === tenantB) {
      console.log('✅ PASS: Tenant B only sees their own data.');
    } else {
      console.log('❌ FAIL: Tenant B visibility incorrect.');
    }

    // 4. Test Super Admin visibility
    console.log('\nTesting visibility for Super Admin...');
    await client.query("SELECT set_config('app.is_super_admin', 'true', true)");
    await client.query("SELECT set_config('app.current_tenant_id', '', true)");
    
    const resAdmin = await client.query('SELECT * FROM test_rls_table');
    console.log(`Super Admin sees ${resAdmin.rowCount} records.`);
    
    if (resAdmin.rowCount >= 2) {
      console.log('✅ PASS: Super Admin sees all data.');
    } else {
      console.log('❌ FAIL: Super Admin visibility restricted.');
    }

    // Cleanup
    await client.query('DROP TABLE test_rls_table');
    console.log('\n--- RLS Verification Test Complete ---');

  } catch (err) {
    console.error('Error during RLS test:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

testRLS();
