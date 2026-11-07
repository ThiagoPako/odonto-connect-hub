// whatsapp_channels sincronizado com whatsapp_instances (revisão do Igor, M1), no Postgres de
// verdade (o mesmo da CI: PG_HOST/PG_PORT/...). Roda a migration-whatsapp-canais.sql num
// schema temporário, duas vezes (idempotente), e confere o gatilho: criar, reatribuir e apagar
// a instância mexem no canal NA MESMA TRANSAÇÃO; instância apagada na clínica A e recriada na B
// nunca deixa canal apontando para A; um principal por clínica; canal OpenWA respeitado.
import pg from 'pg';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { splitSqlStatements } from '../whatsapp/channels.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(path.join(__dirname, '../migration-whatsapp-canais.sql'), 'utf8');
const schema = `wa_sync_teste_${process.pid}_${Date.now()}`;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost', port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'postgres', user: process.env.PG_USER || 'postgres', password: process.env.PG_PASSWORD || '',
  max: 2, options: `-c search_path=${schema}`,
});
const q = (text, params) => pool.query(text, params);
const channelsOf = async (name) => (await q('SELECT tenant_id::text, provider, role, credentials_enc FROM whatsapp_channels WHERE instance_name = $1', [name])).rows;

async function applyMigration() {
  for (const st of splitSqlStatements(SQL)) await q(st);
}

beforeAll(async () => {
  const admin = new pg.Client({
    host: process.env.PG_HOST || 'localhost', port: Number(process.env.PG_PORT) || 5432,
    database: process.env.PG_DATABASE || 'postgres', user: process.env.PG_USER || 'postgres', password: process.env.PG_PASSWORD || '',
  });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  await q(`CREATE TABLE tenants (id UUID PRIMARY KEY)`);
  await q(`INSERT INTO tenants VALUES ($1), ($2)`, [A, B]);
  await q(`CREATE TABLE whatsapp_instances (instance_name TEXT PRIMARY KEY, tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ, paused_until TIMESTAMPTZ, pause_reason TEXT,
            connection_state TEXT, state_since TIMESTAMPTZ, last_checked_at TIMESTAMPTZ, last_alert_at TIMESTAMPTZ)`);
  await q(`CREATE TABLE automation_jobs (id SERIAL PRIMARY KEY)`);
  await q(`CREATE TABLE chat_messages (id TEXT PRIMARY KEY)`);
  // Estado anterior: duas instâncias da A (vão virar 1 principal + 1 reserva) e uma sem clínica.
  await q(`INSERT INTO whatsapp_instances (instance_name, tenant_id, created_at) VALUES
           ('11111111-a1', $1, NOW() - INTERVAL '2 days'), ('11111111-a2', $1, NOW() - INTERVAL '1 day'), ('orfa', NULL, NOW())`, [A]);
  await applyMigration();
  await applyMigration(); // idempotente
});

afterAll(async () => {
  await q(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
  await pool.end();
});

test('backfill: um canal por instância com clínica; um principal por clínica; sem canal para instância sem clínica', async () => {
  const rows = (await q(`SELECT instance_name, tenant_id::text, role FROM whatsapp_channels ORDER BY instance_name`)).rows;
  expect(rows).toEqual([
    { instance_name: '11111111-a1', tenant_id: A, role: 'primary' },
    { instance_name: '11111111-a2', tenant_id: A, role: 'backup' },
  ]);
});

test('instância nova cria o canal na mesma transação (rollback desfaz os dois)', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO whatsapp_instances (instance_name, tenant_id) VALUES ('22222222-b1', $1)`, [B]);
    expect((await c.query(`SELECT role FROM whatsapp_channels WHERE instance_name = '22222222-b1'`)).rows).toEqual([{ role: 'primary' }]);
    await c.query('ROLLBACK');
  } finally { c.release(); }
  expect(await channelsOf('22222222-b1')).toEqual([]);
});

test('instância apagada na A e recriada na B: canal só na B (nada sobra apontando para A)', async () => {
  await q(`INSERT INTO whatsapp_instances (instance_name, tenant_id) VALUES ('compartilhada', $1)`, [A]);
  expect((await channelsOf('compartilhada')).map(r => r.tenant_id)).toEqual([A]);
  await q(`DELETE FROM whatsapp_instances WHERE instance_name = 'compartilhada'`);
  expect(await channelsOf('compartilhada')).toEqual([]);
  await q(`INSERT INTO whatsapp_instances (instance_name, tenant_id) VALUES ('compartilhada', $1)`, [B]);
  const rows = await channelsOf('compartilhada');
  expect(rows.map(r => r.tenant_id)).toEqual([B]);
  expect((await q(`SELECT 1 FROM whatsapp_channels WHERE instance_name = 'compartilhada' AND tenant_id = $1`, [A])).rows).toEqual([]);
});

test('reatribuição (ON CONFLICT DO UPDATE SET tenant_id): canal muda de clínica, vira reserva e perde a credencial', async () => {
  await q(`UPDATE whatsapp_channels SET credentials_enc = 'v1:x:y:z' WHERE instance_name = '11111111-a2'`);
  await q(`INSERT INTO whatsapp_instances (instance_name, tenant_id) VALUES ('11111111-a2', $1)
           ON CONFLICT (instance_name) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`, [B]);
  const [row] = await channelsOf('11111111-a2');
  expect(row.tenant_id).toBe(B);
  expect(row.role).toBe('backup'); // B já tem principal ('compartilhada')
  expect(row.credentials_enc).toBeNull();
});

test('instância sem clínica (tenant_id NULL) não mantém canal', async () => {
  await q(`UPDATE whatsapp_instances SET tenant_id = NULL WHERE instance_name = '11111111-a2'`);
  expect(await channelsOf('11111111-a2')).toEqual([]);
});

test('canal OpenWA criado antes é respeitado (não vira canal Evolution duplicado)', async () => {
  await q(`INSERT INTO whatsapp_channels (tenant_id, provider, role, external_id, instance_name)
           VALUES ($1, 'openwa', 'backup', 'sessao-uuid-1', '11111111-owa-1')`, [A]);
  await q(`INSERT INTO whatsapp_instances (instance_name, tenant_id) VALUES ('11111111-owa-1', $1)`, [A]);
  expect((await channelsOf('11111111-owa-1')).map(r => r.provider)).toEqual(['openwa']);
  await q(`DELETE FROM whatsapp_instances WHERE instance_name = '11111111-owa-1'`);
  expect(await channelsOf('11111111-owa-1')).toEqual([]);
});

test('migração reaplicada com canal OpenWA existente não quebra nem duplica (revisão F1, B2)', async () => {
  await q(`INSERT INTO whatsapp_channels (tenant_id, provider, role, external_id, instance_name)
           VALUES ($1, 'openwa', 'backup', 'sessao-uuid-b2', '11111111-owa-b2')`, [A]);
  await q(`INSERT INTO whatsapp_instances (instance_name, tenant_id) VALUES ('11111111-owa-b2', $1)`, [A]);
  await applyMigration();
  await applyMigration();
  expect((await channelsOf('11111111-owa-b2')).map(r => r.provider)).toEqual(['openwa']);
});

test('canal OpenWA reatribuído a outra clínica: desativado, sem sessão/telefone (revisão F1, M1)', async () => {
  await q(`UPDATE whatsapp_channels SET display_phone = '5562900000000', credentials_enc = 'v1:a:b:c', connection_state = 'open'
            WHERE instance_name = '11111111-owa-b2'`);
  await q(`INSERT INTO whatsapp_instances (instance_name, tenant_id) VALUES ('11111111-owa-b2', $1)
           ON CONFLICT (instance_name) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`, [B]);
  const { rows: [c] } = await q(`SELECT id::text, tenant_id::text, status, role, external_id, display_phone, credentials_enc, connection_state
                                   FROM whatsapp_channels WHERE instance_name = '11111111-owa-b2'`);
  expect(c).toMatchObject({ tenant_id: B, status: 'disabled', role: 'backup', display_phone: null, credentials_enc: null, connection_state: null });
  expect(c.external_id).toBe(`revogado:${c.id}`);
  expect((await q(`SELECT 1 FROM whatsapp_channels WHERE external_id = 'sessao-uuid-b2'`)).rows).toEqual([]);
  await applyMigration(); // continua idempotente com canal desativado
  expect((await channelsOf('11111111-owa-b2')).map(r => r.provider)).toEqual(['openwa']);
});

test('dois principais ativos na mesma clínica: recusado pelo índice', async () => {
  await expect(q(`INSERT INTO whatsapp_channels (tenant_id, provider, role, external_id, instance_name)
                  VALUES ($1, 'openwa', 'primary', 'sessao-uuid-2', '11111111-owa-2')`, [A])).rejects.toThrow(/uq_wa_channels_one_primary/);
});
