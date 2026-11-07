// Migração do segredo do webhook da Clinicorp contra um Postgres real (o do CI).
// Roda o migration-clinicorp-segredo.sql e as mesmas instruções do boot
// (CLINICORP_SEGREDO_SQL) num schema próprio, que é apagado no fim.
// Sem Postgres acessível (PG_HOST/PG_PORT...), os testes só avisam e passam.
import pg from 'pg';
import { readFileSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { CLINICORP_SEGREDO_SQL } from '../clinicorp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'teste_clinicorp_segredo';
const sha = (v) => createHash('sha256').update(v, 'utf8').digest('hex');
const A = '44444444-4444-4444-4444-444444444444';
const B = '66666666-6666-6666-6666-666666666666';
const C = '77777777-7777-7777-7777-777777777777';

// Divide o arquivo em comandos, respeitando blocos $$ ... $$ (o CONCURRENTLY não
// pode ir junto de outros comandos numa só chamada).
function comandos(sqlText) {
  const semComentario = sqlText.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  const out = [];
  let atual = '';
  let emDolar = false;
  for (let i = 0; i < semComentario.length; i++) {
    if (semComentario.startsWith('$$', i)) { emDolar = !emDolar; atual += '$$'; i++; continue; }
    const ch = semComentario[i];
    if (ch === ';' && !emDolar) { if (atual.trim()) out.push(atual.trim()); atual = ''; continue; }
    atual += ch;
  }
  if (atual.trim()) out.push(atual.trim());
  return out;
}

const migracao = comandos(readFileSync(path.join(__dirname, '../migration-clinicorp-segredo.sql'), 'utf8'));

let client = null;

beforeAll(async () => {
  const c = new pg.Client({
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    connectionTimeoutMillis: 3000,
  });
  try {
    await c.connect();
    client = c;
  } catch (e) {
    console.warn(`[clinicorp-segredo-pg] sem Postgres acessível (${e.code || e.message}): testes não rodados`);
    return;
  }
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.query(`CREATE SCHEMA ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(`CREATE TABLE profiles (id UUID PRIMARY KEY, tenant_id UUID)`);
  await client.query(`CREATE TABLE clinicorp_user_settings (
    user_id UUID PRIMARY KEY REFERENCES profiles(id), enabled BOOLEAN DEFAULT FALSE,
    api_token TEXT, subscriber_id TEXT, webhook_secret TEXT, base_url TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
});

afterAll(async () => {
  if (!client) return;
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

const rodarMigracao = async () => { for (const sql of migracao) await client.query(sql); };
const rodarBoot = async () => { for (const sql of CLINICORP_SEGREDO_SQL) await client.query(sql); };
const linha = async (id) => (await client.query(
  'SELECT webhook_secret, webhook_secret_hash, webhook_secret_legado_ate FROM clinicorp_user_settings WHERE user_id = $1', [id])).rows[0];
// Quantas linhas o webhook aceitaria para este segredo (hash atual ou anterior).
const aceitos = async (secret) => Number((await client.query(
  `SELECT COUNT(*) FROM clinicorp_user_settings
    WHERE webhook_secret_hash = $1 OR (webhook_secret_anterior_hash = $1 AND anterior_expira_em > NOW())`,
  [sha(secret)])).rows[0].count);

test('segredo repetido entre A e B: depois que B gera um novo, o boot não reativa o antigo para A', async () => {
  if (!client) return;
  const repetido = 'mesmo-segredo-das-duas-clinicas-1234';
  const unico = 'segredo-legado-so-da-clinica-c-5678';
  await client.query(`INSERT INTO profiles VALUES ($1, gen_random_uuid()), ($2, gen_random_uuid()), ($3, gen_random_uuid())`, [A, B, C]);
  await client.query(`INSERT INTO clinicorp_user_settings (user_id, enabled, webhook_secret) VALUES
    ($1, true, $4), ($2, true, $4), ($3, true, $5)`, [A, B, C, repetido, unico]);

  await rodarMigracao();
  for (const id of [A, B]) {
    const r = await linha(id);
    expect(r.webhook_secret).toBeNull();
    expect(r.webhook_secret_hash).toBeNull();
  }
  expect((await linha(C)).webhook_secret_hash).toBe(sha(unico));
  expect((await linha(C)).webhook_secret_legado_ate).not.toBeNull();
  expect(await aceitos(repetido)).toBe(0);

  // B gera segredo novo (o que o rotate grava: hash novo, claro apagado).
  const novoB = 'n'.repeat(43);
  await client.query(
    `UPDATE clinicorp_user_settings SET webhook_secret_hash = $2, webhook_secret = NULL, webhook_secret_legado_ate = NULL WHERE user_id = $1`,
    [B, sha(novoB)]);

  await rodarBoot();
  await rodarMigracao();
  expect((await linha(A)).webhook_secret_hash).toBeNull();
  expect(await aceitos(repetido)).toBe(0);
  expect(await aceitos(novoB)).toBe(1);
  expect(await aceitos(unico)).toBe(1);
});

test('migração e boot rodam de novo sem erro e o índice único fica válido', async () => {
  if (!client) return;
  await rodarMigracao();
  await rodarBoot();
  const { rows } = await client.query(
    `SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'uq_clinicorp_user_settings_webhook_secret_hash' AND n.nspname = $1`, [SCHEMA]);
  expect(rows).toEqual([{ indisvalid: true }]);
  await expect(client.query(
    `UPDATE clinicorp_user_settings SET webhook_secret_hash = (SELECT webhook_secret_hash FROM clinicorp_user_settings WHERE user_id = $1) WHERE user_id = $2`,
    [C, A])).rejects.toMatchObject({ code: '23505' });
});
