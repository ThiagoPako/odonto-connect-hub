import pg from 'pg';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'odonto_db',
  user: process.env.PG_USER || 'odonto_user',
  password: process.env.PG_PASSWORD,
});

/**
 * Simula o verifyUser do server.mjs configurando o contexto da sessão DB
 */
async function setupDbSession(token) {
  const decoded = jwt.verify(token, JWT_SECRET);
  const tenantId = decoded.tenant_id || '';
  
  await pool.query('SELECT set_config($1, $2, true)', ['app.jwt_payload', JSON.stringify(decoded)]);
  await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
  
  return decoded;
}

async function runTests() {
  console.log('🚀 Iniciando testes de validação RLS e Multi-tenant...\n');
  
  const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  
  try {
    // 1. Setup inicial de dados de teste
    console.log('📦 Preparando dados de teste...');
    await pool.query('DELETE FROM pacientes WHERE nome LIKE \'TEST_%\'');
    await pool.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
    
    await pool.query('INSERT INTO tenants (id, nome, slug) VALUES ($1, \'Clinica A\', \'clinica-a\'), ($2, \'Clinica B\', \'clinica-b\')', [tenantA, tenantB]);
    
    // Inserir dados para cada tenant
    await pool.query('INSERT INTO pacientes (id, nome, tenant_id) VALUES (gen_random_uuid(), \'TEST_Paciente_A\', $1)', [tenantA]);
    await pool.query('INSERT INTO pacientes (id, nome, tenant_id) VALUES (gen_random_uuid(), \'TEST_Paciente_B\', $1)', [tenantB]); // Erro proposital no script se RLS falhar
    // Correção: Inserir com tenant_id correto
    await pool.query('INSERT INTO pacientes (id, nome, tenant_id) VALUES (gen_random_uuid(), \'TEST_Paciente_B_Real\', $1)', [tenantB]);

    // 2. Teste: Usuário Comum da Clínica A
    console.log('\n🔍 Teste 1: Usuário Comum (Clinica A)');
    const tokenA = jwt.sign({ sub: 'user-a', email: 'a@test.com', role: 'user', tenant_id: tenantA, is_super_admin: false }, JWT_SECRET);
    await setupDbSession(tokenA);
    
    const resA = await pool.query('SELECT nome FROM pacientes WHERE nome LIKE \'TEST_%\'');
    console.log(`- Pacientes visíveis para A: ${resA.rows.length}`);
    const onlyA = resA.rows.every(r => r.nome.includes('_A'));
    if (onlyA && resA.rows.length > 0) {
      console.log('✅ SUCESSO: Usuário A só vê dados da Clínica A.');
    } else {
      console.error('❌ FALHA: Usuário A vazou dados ou não viu seus próprios dados.');
      process.exit(1);
    }

    // 3. Teste: Usuário Comum da Clínica B
    console.log('\n🔍 Teste 2: Usuário Comum (Clinica B)');
    const tokenB = jwt.sign({ sub: 'user-b', email: 'b@test.com', role: 'user', tenant_id: tenantB, is_super_admin: false }, JWT_SECRET);
    await setupDbSession(tokenB);
    
    const resB = await pool.query('SELECT nome FROM pacientes WHERE nome LIKE \'TEST_%\'');
    console.log(`- Pacientes visíveis para B: ${resB.rows.length}`);
    const onlyB = resB.rows.every(r => r.nome.includes('_B'));
    if (onlyB && resB.rows.length > 0) {
      console.log('✅ SUCESSO: Usuário B só vê dados da Clínica B.');
    } else {
      console.error('❌ FALHA: Usuário B vazou dados.');
      process.exit(1);
    }

    // 4. Teste: Super Admin (Acesso Global)
    console.log('\n🔍 Teste 3: Super Admin (Acesso Global)');
    const tokenSuper = jwt.sign({ sub: 'super', email: 'super@test.com', role: 'admin', is_super_admin: true }, JWT_SECRET);
    await setupDbSession(tokenSuper);
    
    const resSuper = await pool.query('SELECT nome FROM pacientes WHERE nome LIKE \'TEST_%\'');
    console.log(`- Pacientes visíveis para Super: ${resSuper.rows.length}`);
    if (resSuper.rows.length >= 2) {
      console.log('✅ SUCESSO: Super Admin vê dados de todos os tenants.');
    } else {
      console.error('❌ FALHA: Super Admin teve acesso restrito.');
      process.exit(1);
    }

    // 5. Teste: Tentativa de inserção cruzada
    console.log('\n🔍 Teste 4: Inserção forçada em outro tenant');
    await setupDbSession(tokenA);
    try {
      await pool.query('INSERT INTO pacientes (nome, tenant_id) VALUES (\'TEST_Invasor\', $1)', [tenantB]);
      // Com RLS WITH CHECK, isso deve falhar se o tenant_id não bater com o da sessão
      console.error('❌ FALHA: Usuário A conseguiu inserir dados para o Tenant B!');
      process.exit(1);
    } catch (err) {
      console.log('✅ SUCESSO: Inserção cruzada bloqueada por RLS (Check Constraint).');
    }

    console.log('\n✨ Todos os testes de isolamento passaram com sucesso!');

  } catch (err) {
    console.error('\n❌ Erro durante a execução dos testes:', err.message);
    process.exit(1);
  } finally {
    // Cleanup
    await pool.query('DELETE FROM pacientes WHERE nome LIKE \'TEST_%\'');
    await pool.query('DELETE FROM tenants WHERE id IN ($1, $2)', [tenantA, tenantB]);
    await pool.end();
  }
}

runTests();
