import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { runFullSync } from './clinicorp.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false }
});

async function runTestSync() {
  try {
    console.log('🚀 Iniciando sincronização de teste para Thiago...');
    
    // Thiago's IDs
    const userId = 'e0fde435-4cb1-4b6b-8b85-d0b7590de6d0';
    const tenantId = '426e9a3e-9216-41be-99a9-7b345c74d62b';
    
    // Credentials provided by user
    const apiToken = '1af93b09-189a-4491-99c8-7a374e677e4a';
    const subscriberId = 'sorrisominacu';

    const today = new Date().toISOString().slice(0, 10);
    
    const result = await runFullSync(pool, {
      user_id: userId,
      tenant_id: tenantId,
      api_token: apiToken,
      subscriber_id: subscriberId,
      from: today,
      to: today,
      apptFrom: today,
      apptTo: today,
      force_metadata: true 
    });
    
    console.log('✅ Sincronização concluída!');
    console.log('Status:', result.status);
    console.log('Resumo:', JSON.stringify(result.summary, null, 2));
    if (result.errors && result.errors.length > 0) {
      console.warn('⚠️ Erros durante a sync:', result.errors.join(' | '));
    }
  } catch (err) {
    console.error('❌ Falha fatal na sincronização de teste:', err.message);
  } finally {
    await pool.end();
  }
}

runTestSync();
