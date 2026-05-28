import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function runFix() {
  try {
    console.log('🛠️ Tentando GRANT ALL via script Node...');
    
    // Lista todas as tabelas na schema public
    const { rows: tables } = await pool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    
    for (const table of tables) {
      console.log(`- Granting ALL on public.${table.tablename}...`);
      await pool.query(`GRANT ALL PRIVILEGES ON TABLE public."${table.tablename}" TO authenticated, service_role, postgres`);
    }
    
    await pool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role, postgres`);
    await pool.query(`GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role, postgres`);
    
    console.log('✅ Grants aplicados com sucesso via script!');
  } catch (err) {
    console.error('❌ Erro no script de fix:', err.message);
  } finally {
    await pool.end();
  }
}

runFix();
