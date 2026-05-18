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

async function verifyRLS() {
  const client = await pool.connect();
  try {
    console.log('--- Iniciando Verificação de Segurança RLS ---');

    const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    console.log(`Preparando cenário: Tenant A (${tenantA}) e Tenant B (${tenantB})`);

    // 1. Criar tabela de teste com RLS
    await client.query('CREATE TABLE IF NOT EXISTS test_rls_security (id UUID PRIMARY KEY, name TEXT, tenant_id UUID)');
    await client.query('ALTER TABLE test_rls_security ENABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE test_rls_security FORCE ROW LEVEL SECURITY');
    await client.query('DROP POLICY IF EXISTS tenant_isolation_policy ON test_rls_security');
    await client.query(`
      CREATE POLICY tenant_isolation_policy ON test_rls_security USING (
        (current_setting('app.is_super_admin', true) = 'true') OR 
        (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      ) WITH CHECK (
        (current_setting('app.is_super_admin', true) = 'true') OR 
        (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
      )
    `);

    // Limpar dados anteriores
    await client.query('DELETE FROM test_rls_security WHERE tenant_id IN ($1, $2)', [tenantA, tenantB]);

    // Inserir registros iniciais como Super Admin para garantir que os dados existam no banco
    await client.query("SELECT set_config('app.is_super_admin', 'true', true)");
    const { rows: rowA } = await client.query('INSERT INTO test_rls_security (id, name, tenant_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id', ['Segredo do Tenant A', tenantA]);
    const { rows: rowB } = await client.query('INSERT INTO test_rls_security (id, name, tenant_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id', ['Segredo do Tenant B', tenantB]);
    
    const idA = rowA[0].id;
    const idB = rowB[0].id;

    console.log('Dados de teste inseridos com sucesso.');

    // Mudar para contexto de usuário comum (Tenant A)
    await client.query("SELECT set_config('app.is_super_admin', 'false', true)");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantA]);

    console.log('\n--- Testando Tenant A tentando acessar dados do Tenant B ---');

    let hasFailure = false;

    // TESTE 1: SELECT cruzado
    const selectRes = await client.query('SELECT * FROM test_rls_security WHERE id = $1', [idB]);
    if (selectRes.rowCount === 0) {
      console.log('✅ SUCESSO: SELECT cruzado bloqueado (registro não encontrado).');
    } else {
      console.log('❌ FALHA: Tenant A conseguiu ver dados do Tenant B!');
      hasFailure = true;
    }

    // TESTE 2: UPDATE cruzado
    const updateRes = await client.query('UPDATE test_rls_security SET name = \'HACKED\' WHERE id = $1', [idB]);
    if (updateRes.rowCount === 0) {
      console.log('✅ SUCESSO: UPDATE cruzado bloqueado (0 linhas afetadas).');
    } else {
      console.log('❌ FALHA: Tenant A conseguiu alterar dados do Tenant B!');
      hasFailure = true;
    }

    // TESTE 3: DELETE cruzado
    const deleteRes = await client.query('DELETE FROM test_rls_security WHERE id = $1', [idB]);
    if (deleteRes.rowCount === 0) {
      console.log('✅ SUCESSO: DELETE cruzado bloqueado (0 linhas afetadas).');
    } else {
      console.log('❌ FALHA: Tenant A conseguiu deletar dados do Tenant B!');
      hasFailure = true;
    }

    // Verificação de consistência: Tenant A ainda vê seus próprios dados?
    const selfRes = await client.query('SELECT * FROM test_rls_security WHERE id = $1', [idA]);
    if (selfRes.rowCount === 1) {
      console.log('✅ CONSISTÊNCIA: Tenant A continua acessando seus próprios dados normalmente.');
    } else {
      console.log('❌ ERRO: Tenant A perdeu acesso aos seus próprios dados!');
      hasFailure = true;
    }

    if (hasFailure) {
      process.exit(1);
    }

    // Limpeza
    await client.query("SELECT set_config('app.is_super_admin', 'true', true)");
    await client.query('DROP TABLE test_rls_security');
    console.log('\n--- Verificação Finalizada ---');

  } catch (err) {
    console.error('❌ Erro crítico no script de segurança:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

verifyRLS();
