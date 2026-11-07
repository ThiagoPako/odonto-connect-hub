// Canais de WhatsApp por clínica (whatsapp_channels). Uma clínica pode ter vários canais
// (ex.: oficial da Meta + reserva OpenWA em outro número), com UM principal ativo.
// Toda query filtra por tenant_id explicitamente (a RLS não protege: NO FORCE).
// O tenant de um canal vem sempre do banco, nunca do provedor.
import { channelAad } from './crypto.mjs';

// Divide um arquivo SQL em comandos respeitando blocos $$ ... $$ (funções/gatilhos), para o
// boot aplicar a mesma migração do deploy. Linhas só de comentário são removidas.
export function splitSqlStatements(sql) {
  const out = [];
  let buf = [];
  let inDollar = false;
  for (const line of String(sql || '').split('\n')) {
    if (!inDollar && /^\s*--/.test(line)) continue;
    buf.push(line);
    const count = (line.match(/\$\$/g) || []).length;
    if (count % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) {
      const st = buf.join('\n').trim().replace(/;\s*$/, '');
      if (st) out.push(st);
      buf = [];
    }
  }
  const rest = buf.join('\n').trim();
  if (rest) out.push(rest);
  return out;
}

const CHANNEL_COLUMNS = `id, tenant_id, provider, role, status, external_id, instance_name, waba_id, display_phone,
  credentials_enc, credentials_key_version, connection_state, state_since, paused_until, created_at, connected_at`;

export function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
}

// Consulta que nunca lança (erro de banco = "sem canal": quem chama cai no comportamento antigo).
async function safeQuery(pool, sql, params) {
  try {
    const r = await pool.query(sql, params);
    return Array.isArray(r?.rows) ? r.rows : [];
  } catch {
    return [];
  }
}

export function createChannelStore({ pool, cipher = null, cacheMs = 30_000 }) {
  const byInstance = new Map(); // instance_name -> { at, channel|null }

  function invalidate(instanceName) {
    if (instanceName) byInstance.delete(String(instanceName));
    else byInstance.clear();
  }

  // Canal dono de um instance_name (chave usada pela fila e pelo chat). Cache curto.
  async function getByInstance(instanceName) {
    const key = String(instanceName || '');
    if (!key) return null;
    const hit = byInstance.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.channel;
    const rows = await safeQuery(pool,
      `SELECT ${CHANNEL_COLUMNS} FROM whatsapp_channels WHERE instance_name = $1 AND status = 'active' LIMIT 1`, [key]);
    const channel = rows[0] || null;
    byInstance.set(key, { at: Date.now(), channel });
    return channel;
  }

  async function getById(channelId) {
    if (!isUuid(channelId)) return null;
    const rows = await safeQuery(pool, `SELECT ${CHANNEL_COLUMNS} FROM whatsapp_channels WHERE id = $1 LIMIT 1`, [channelId]);
    return rows[0] || null;
  }

  // Canal da clínica pelo id, conferindo o dono (rotas autenticadas).
  async function getForTenant(tenantId, channelId) {
    if (!isUuid(channelId) || !isUuid(tenantId)) return null;
    const rows = await safeQuery(pool,
      `SELECT ${CHANNEL_COLUMNS} FROM whatsapp_channels WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [channelId, tenantId]);
    return rows[0] || null;
  }

  async function listForTenant(tenantId) {
    if (!isUuid(tenantId)) return [];
    return safeQuery(pool,
      `SELECT ${CHANNEL_COLUMNS} FROM whatsapp_channels WHERE tenant_id = $1 ORDER BY (role = 'primary') DESC, created_at ASC`, [tenantId]);
  }

  async function getPrimary(tenantId) {
    if (!isUuid(tenantId)) return null;
    const rows = await safeQuery(pool,
      `SELECT ${CHANNEL_COLUMNS} FROM whatsapp_channels
        WHERE tenant_id = $1 AND status = 'active' AND role = 'primary' LIMIT 1`, [tenantId]);
    return rows[0] || null;
  }

  async function listByProvider(provider) {
    return safeQuery(pool,
      `SELECT ${CHANNEL_COLUMNS} FROM whatsapp_channels WHERE provider = $1 AND status = 'active'`, [provider]);
  }

  function decryptCredentials(channel) {
    if (!channel?.credentials_enc) return { ok: false, error: 'Canal sem credenciais' };
    if (!cipher) return { ok: false, error: 'WA_CREDENTIALS_KEY ausente' };
    const r = cipher.decrypt(channel.credentials_enc, channelAad(channel.id, channel.tenant_id));
    if (!r.ok) return r;
    try { return { ok: true, value: JSON.parse(r.value) }; } catch { return { ok: false, error: 'Credencial ilegível' }; }
  }

  function encryptCredentials(channel, value) {
    if (!cipher) return { ok: false, error: 'WA_CREDENTIALS_KEY ausente' };
    return cipher.encrypt(JSON.stringify(value), channelAad(channel.id, channel.tenant_id));
  }

  // Torna um canal o principal da clínica (rebaixa os outros) numa transação.
  async function setPrimary(tenantId, channelId) {
    if (!isUuid(tenantId) || !isUuid(channelId)) return { ok: false, error: 'Canal inválido' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id FROM whatsapp_channels WHERE id = $1 AND tenant_id = $2 AND status = 'active' FOR UPDATE`, [channelId, tenantId]);
      if (!rows.length) { await client.query('ROLLBACK'); return { ok: false, error: 'Canal não encontrado' }; }
      await client.query(
        `UPDATE whatsapp_channels SET role = 'backup', updated_at = NOW() WHERE tenant_id = $1 AND id <> $2 AND role = 'primary'`, [tenantId, channelId]);
      await client.query(
        `UPDATE whatsapp_channels SET role = 'primary', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [channelId, tenantId]);
      await client.query('COMMIT');
      invalidate();
      return { ok: true };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      client.release();
    }
  }

  return {
    invalidate, getByInstance, getById, getForTenant, listForTenant, getPrimary, listByProvider,
    decryptCredentials, encryptCredentials, setPrimary,
  };
}
