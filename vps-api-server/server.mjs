/**
 * Odonto Connect — VPS API Server
 * Runs alongside the frontend on the VPS
 * 
 * SETUP:
 * 1. cd vps-api-server && npm install
 * 2. cp .env.example .env  (preencha as variáveis)
 * 3. pm2 start server.mjs --name odonto-api
 */

import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
import path from 'path';
import { randomUUID, createHash, createHmac, timingSafeEqual } from 'crypto';
import { execFile } from 'child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'async_hooks';

// Compatibilidade para trechos legados deste arquivo que ainda chamam
// crypto.randomUUID(). O módulo importa randomUUID de forma nomeada; sem este
// alias, o webhook quebra ao criar lead/sessão e a mensagem não chega ao chat.
const crypto = { randomUUID };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, '.env'),
  override: true,
});

const { Pool } = pg;
const app = express();
const PORT = process.env.API_PORT || 3002;

// ─── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '64mb' }));

// Contexto de clínica por requisição. verifyUser/webhook preenchem o store e
// pool.query (abaixo) aplica o tenant dentro da mesma transação da consulta.
const tenantContext = new AsyncLocalStorage();
app.use((req, res, next) => tenantContext.run({ tenantId: null, isSuperAdmin: false }, next));

// Várias rotas fazem `catch (e) { res.status(500).json({ error: e.message }) }`
// e transformam o 'Unauthorized' do verifyUser em 500. O front só renova o
// token quando recebe 401, então corrigimos o status aqui de forma central.
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 500 && body && body.error === 'Unauthorized') res.status(401);
    return json(body);
  };
  next();
});

// ─── Media File Storage ─────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'media');
// Ensure uploads directory exists
(async () => {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
    console.log('📁 Created media uploads directory:', UPLOADS_DIR);
  }
})().catch((err) => console.error('Failed to create media uploads directory:', err.message));

// Serve uploaded media files statically
app.use('/uploads/media', express.static(UPLOADS_DIR, {
  maxAge: '30d',
  immutable: true,
}));

/**
 * Save a base64 data URI or raw base64 to disk and return the public URL.
 * Returns null on failure.
 */
async function saveMediaToDisk(base64OrDataUri, mimeType, originalFileName) {
  try {
    let base64Data = base64OrDataUri;
    let resolvedMime = mimeType || 'application/octet-stream';

    // Strip data URI prefix if present
    if (base64OrDataUri.startsWith('data:')) {
      const match = base64OrDataUri.match(/^data:([^;]+);base64,(.+)$/s);
      if (match) {
        resolvedMime = match[1];
        base64Data = match[2];
      }
    }

    // Determine file extension
    const extMap = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
      'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/aac': 'aac',
      'application/pdf': 'pdf', 'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    };
    const ext = extMap[resolvedMime.split(';')[0].trim()] || originalFileName?.split('.').pop() || 'bin';

    // Generate unique filename: YYYY-MM/uuid.ext
    const now = new Date();
    const subDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dirPath = path.join(UPLOADS_DIR, subDir);
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true });
    }

    const fileName = `${randomUUID()}.${ext}`;
    const filePath = path.join(dirPath, fileName);
    const buffer = Buffer.from(base64Data, 'base64');
    await writeFile(filePath, buffer);

    // Return relative URL path
    const publicUrl = `/uploads/media/${subDir}/${fileName}`;
    console.log(`💾 Media saved: ${publicUrl} (${(buffer.length / 1024).toFixed(1)} KB)`);
    return publicUrl;
  } catch (err) {
    console.error('Failed to save media to disk:', err.message);
    return null;
  }
}

/**
 * Save a raw Buffer to disk and return the public URL.
 */
async function saveBufferToDisk(buffer, mimeType, originalFileName) {
  try {
    const base64 = buffer.toString('base64');
    return await saveMediaToDisk(base64, mimeType, originalFileName);
  } catch (err) {
    console.error('Failed to save buffer to disk:', err.message);
    return null;
  }
}

// ─── PostgreSQL ─────────────────────────────────────────────
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'odonto_db',
  user: process.env.PG_USER || 'odonto_user',
  password: process.env.PG_PASSWORD,
});

// RLS da VPS lê app.tenant_id / app.is_super_admin. set_config de sessão num
// pool vaza entre requisições (cada query pode cair noutra conexão), então,
// dentro de uma requisição autenticada, cada query roda numa transação curta
// com o contexto local (is_local=true) na mesma conexão.
const rawPoolQuery = pool.query.bind(pool);
const rawPoolConnect = pool.connect.bind(pool);
const TENANT_SET_SQL = `SELECT set_config('app.tenant_id', $1, $3),
              set_config('app.current_tenant_id', $1, $3),
              set_config('app.is_super_admin', $2, $3)`;
const activeTenantCtx = () => {
  const ctx = tenantContext.getStore();
  return ctx && (ctx.tenantId || ctx.isSuperAdmin) ? ctx : null;
};

// Transações manuais (pool.connect) numa requisição autenticada recebem o
// contexto na sessão e ele é limpo antes de a conexão voltar ao pool.
pool.connect = async (...args) => {
  if (args.length) return rawPoolConnect(...args); // estilo callback (usado pelo próprio pg)
  const client = await rawPoolConnect();
  const ctx = activeTenantCtx();
  if (!ctx) return client;
  await client.query(TENANT_SET_SQL, [ctx.tenantId || '', ctx.isSuperAdmin ? 'true' : 'false', false]);
  const release = client.release;
  client.release = (err) => {
    client.release = release;
    client.query(TENANT_SET_SQL, ['', 'false', false]).catch(() => {}).finally(() => release.call(client, err));
  };
  return client;
};

pool.query = async (text, params) => {
  const ctx = activeTenantCtx();
  if (!ctx) return rawPoolQuery(text, params);
  const client = await rawPoolConnect();
  try {
    await client.query('BEGIN');
    await client.query(TENANT_SET_SQL, [ctx.tenantId || '', ctx.isSuperAdmin ? 'true' : 'false', true]);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// Um cliente ocioso que cai (ex.: restart do Postgres) emite 'error'; sem
// listener isso derruba o processo inteiro.
pool.on('error', (err) => console.error('Postgres idle client error:', err.message));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason instanceof Error ? reason.stack : reason);
});

console.log('🗄️ Postgres env loaded', {
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'odonto_db',
  user: process.env.PG_USER || 'odonto_user',
  hasPassword: Boolean(process.env.PG_PASSWORD),
  passwordLength: (process.env.PG_PASSWORD || '').length,
  envPath: path.join(__dirname, '.env'),
});

// ─── JWT Config ─────────────────────────────────────────────
// Login é só pela VPS: sem JWT_SECRET os tokens poderiam ser forjados com o
// segredo padrão, então o servidor não sobe.
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET não definido no .env da VPS. Defina um segredo longo e reinicie.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const LEGACY_JWT_ENABLED = true;
const JWT_EXPIRES_IN = '7d';

// Supabase foi desligado: o app roda só na VPS. As rotas que ainda checam
// SUPABASE_BRIDGE_ENABLED seguem pelo banco local.
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';
const SUPABASE_SERVICE_ROLE_KEY = '';
const SUPABASE_BRIDGE_ENABLED = false;

// Cache em memória: token → { user, exp }
const _supabaseUserCache = new Map();
const SUPABASE_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache for instance -> tenant_id mapping to avoid repeated DB hits in webhooks
const instanceToTenantCache = new Map();
const INSTANCE_TENANT_CACHE_TTL_MS = 5 * 60 * 1000;

// Placeholder/seed tenant that must NEVER be used to route real messages.
const PLACEHOLDER_TENANT_IDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
]);
function isValidTenantId(id) {
  if (!id) return false;
  const s = String(id).toLowerCase();
  return !PLACEHOLDER_TENANT_IDS.has(s);
}

function getCachedTenantId(instanceName) {
  const cached = instanceToTenantCache.get(instanceName);
  if (!cached) return null;

  // Backward compatible with older in-memory values during rolling restarts.
  if (typeof cached === 'string') return isValidTenantId(cached) ? cached : null;

  if (cached.expiresAt && cached.expiresAt > Date.now()) {
    return isValidTenantId(cached.tenantId) ? cached.tenantId : null;
  }
  instanceToTenantCache.delete(instanceName);
  return null;
}

function setCachedTenantId(instanceName, tenantId) {
  if (!instanceName || !isValidTenantId(tenantId)) return;
  instanceToTenantCache.set(instanceName, {
    tenantId,
    expiresAt: Date.now() + INSTANCE_TENANT_CACHE_TTL_MS,
  });
}

// Tarefas de fundo atravessam todas as clínicas: rodam como sistema
// (is_super_admin no RLS) em vez de herdar config de conexões anteriores.
function asSystemJob(fn) {
  return (...args) => tenantContext.run({ tenantId: null, isSuperAdmin: true }, () => fn(...args));
}

async function setDbTenantContext({ tenantId = null, isSuperAdmin = false } = {}) {
  const ctx = tenantContext.getStore();
  if (!ctx) return;
  ctx.tenantId = isValidTenantId(tenantId) ? String(tenantId) : null;
  ctx.isSuperAdmin = !!isSuperAdmin;
}

async function validateRequestedTenantForUser(user, requestedTenantId) {
  if (!isValidTenantId(requestedTenantId) || !user?.id) return null;
  const tenant = String(requestedTenantId);

  if (user.tenant_id && String(user.tenant_id) === tenant) return tenant;
  if (user.is_super_admin) return tenant;

  try {
    const { rows } = await pool.query(
      `SELECT tenant_id
         FROM profiles
        WHERE id = $1
          AND tenant_id = $2
        LIMIT 1`,
      [user.id, tenant]
    );
    if (rows[0]?.tenant_id) return tenant;
  } catch (err) {
    console.warn('Tenant header local validation failed:', err.message);
  }

  try {
    const { rows } = await pool.query(
      `SELECT tenant_id
         FROM user_roles
        WHERE user_id = $1
          AND tenant_id = $2
        LIMIT 1`,
      [user.id, tenant]
    );
    if (rows[0]?.tenant_id) return tenant;
  } catch (err) {
    if (err.code !== '42P01' && err.code !== '42703') {
      console.warn('Tenant header local role validation failed:', err.message);
    }
  }

  if (SUPABASE_BRIDGE_ENABLED) {
    try {
      const restAuthKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      const restBearer = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&tenant_id=eq.${encodeURIComponent(tenant)}&select=tenant_id&limit=1`,
        { headers: { apikey: restAuthKey, Authorization: `Bearer ${restBearer}` } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.[0]?.tenant_id) return tenant;
      }
    } catch (err) {
      console.warn('Tenant header Supabase validation failed:', err.message);
    }

    try {
      const restAuthKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      const restBearer = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(user.id)}&tenant_id=eq.${encodeURIComponent(tenant)}&select=tenant_id&limit=1`,
        { headers: { apikey: restAuthKey, Authorization: `Bearer ${restBearer}` } }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.[0]?.tenant_id) return tenant;
      }
    } catch (err) {
      console.warn('Tenant header Supabase role validation failed:', err.message);
    }
  }

  return null;
}

async function getTenantIdByInstance(instanceName) {
  if (!instanceName) return null;
  const cachedTenantId = getCachedTenantId(instanceName);
  if (cachedTenantId) return cachedTenantId;
  const prefixMatch = String(instanceName).match(/^([0-9a-f]{8})-/i);
  const prefix = prefixMatch ? prefixMatch[1].toLowerCase() : null;

  // 1. Try local DB whatsapp_instances
  try {
    const { rows } = await pool.query(
      'SELECT tenant_id FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1',
      [instanceName]
    );
    const localTenantId = rows[0]?.tenant_id ? String(rows[0].tenant_id) : '';
    if (localTenantId && isValidTenantId(localTenantId)) {
      // Non-prefixed legacy instance names (ex.: "testedg") can carry a stale
      // tenant mapping in the VPS local DB. Lovable Cloud is the canonical
      // mapping used by the logged-in app, so prefer it and repair local cache.
      if (!prefix && SUPABASE_BRIDGE_ENABLED) {
        try {
          const restAuthKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
          const cloudRes = await fetch(
            `${SUPABASE_URL}/rest/v1/whatsapp_instances?instance_name=eq.${encodeURIComponent(instanceName)}&select=tenant_id&limit=1`,
            { headers: { apikey: restAuthKey, Authorization: `Bearer ${restAuthKey}` } }
          );
          if (cloudRes.ok) {
            const cloudRows = await cloudRes.json();
            const cloudTenantId = cloudRows?.[0]?.tenant_id ? String(cloudRows[0].tenant_id) : '';
            if (isValidTenantId(cloudTenantId) && cloudTenantId !== localTenantId) {
              await pool.query(
                `UPDATE whatsapp_instances
                    SET tenant_id = $2, updated_at = NOW()
                  WHERE instance_name = $1`,
                [instanceName, cloudTenantId]
              ).catch(() => {});
              setCachedTenantId(instanceName, cloudTenantId);
              console.warn(`🔁 Repaired stale tenant mapping for ${instanceName}: ${localTenantId} → ${cloudTenantId}`);
              return cloudTenantId;
            }
          }
        } catch (err) {
          console.warn(`Cloud tenant mapping check failed for ${instanceName}:`, err.message);
        }
      }
      if (!prefix || localTenantId.toLowerCase().startsWith(prefix)) {
        setCachedTenantId(instanceName, localTenantId);
        return localTenantId;
      }
      console.warn(`⚠️ Ignoring stale tenant mapping for ${instanceName}: ${localTenantId} does not match prefix ${prefix}`);
    }
  } catch (err) {
    if (err.code !== '42P01') {
      console.error(`Error resolving tenant for instance ${instanceName}:`, err.message);
    }
  }

  // 1b. Infer tenant from instance name prefix "<first 8 chars of tenant_id>-<label>"
  // Search in local tenants and profiles tables.
  if (prefix) {
    for (const table of ['tenants', 'profiles']) {
      try {
        const col = table === 'tenants' ? 'id' : 'tenant_id';
        const { rows } = await pool.query(
          `SELECT DISTINCT ${col} AS tenant_id
             FROM ${table}
            WHERE ${col} IS NOT NULL
              AND substring(${col}::text from 1 for 8) = $1
            LIMIT 1`,
          [prefix]
        );
        if (rows[0]?.tenant_id && isValidTenantId(rows[0].tenant_id)) {
          await pool.query(
            `INSERT INTO whatsapp_instances (instance_name, tenant_id)
             VALUES ($1, $2)
             ON CONFLICT (instance_name) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
            [instanceName, rows[0].tenant_id]
          ).catch(() => {});
          setCachedTenantId(instanceName, rows[0].tenant_id);
          return rows[0].tenant_id;
        }
      } catch (err) {
        if (err.code !== '42P01') {
          console.error(`Tenant prefix inference (${table}) failed for ${instanceName}:`, err.message);
        }
      }
    }
  }

  // 2. Fallback to Supabase Cloud: exact instance, then prefix on tenants.id
  if (SUPABASE_BRIDGE_ENABLED) {
    const restAuthKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    const headers = { apikey: restAuthKey, Authorization: `Bearer ${restAuthKey}` };
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_instances?instance_name=eq.${encodeURIComponent(instanceName)}&select=tenant_id`,
        { headers }
      );
      if (res.ok) {
        const data = await res.json();
        const candidate = data?.[0]?.tenant_id;
        if (candidate && isValidTenantId(candidate)) {
          if (!prefix || String(candidate).toLowerCase().startsWith(prefix)) {
            setCachedTenantId(instanceName, candidate);
            return candidate;
          }
          console.warn(`⚠️ Ignoring stale Supabase tenant mapping for ${instanceName}: ${candidate} does not match prefix ${prefix}`);
        }
      }
    } catch (err) {
      console.error(`Supabase fallback failed for ${instanceName}:`, err.message);
    }
    if (prefix) {
      for (const lookup of [
        { table: 'tenants', column: 'id' },
        { table: 'profiles', column: 'tenant_id' },
      ]) {
        try {
          const res = await fetch(
            `${SUPABASE_URL}/rest/v1/${lookup.table}?${lookup.column}=like.${prefix}*&select=${lookup.column}&limit=1`,
            { headers }
          );
          if (res.ok) {
            const data = await res.json();
            const candidate = data?.[0]?.[lookup.column];
            if (candidate && isValidTenantId(candidate)) {
              setCachedTenantId(instanceName, candidate);
              return candidate;
            }
          }
        } catch (err) {
          console.error(`Supabase ${lookup.table} prefix fallback failed for ${instanceName}:`, err.message);
        }
      }
    }
  }

  return null;
}

async function getFallbackTenantIdForIncomingMessage({ instanceName, phoneSuffix }) {
  const suffix = String(phoneSuffix || '').replace(/\D/g, '').slice(-11);
  const prefixMatch = String(instanceName || '').match(/^([0-9a-f]{8})-/i);
  const prefix = prefixMatch ? prefixMatch[1].toLowerCase() : null;

  if (suffix) {
    try {
      const { rows } = await pool.query(
        `SELECT tenant_id
           FROM crm_leads
          WHERE tenant_id IS NOT NULL
            AND ($2 = '' OR substring(tenant_id::text from 1 for 8) = $2)
            AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(telefone, ''), ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1`,
        [suffix, prefix || '']
      );
      if (rows[0]?.tenant_id && isValidTenantId(rows[0].tenant_id)) return rows[0].tenant_id;
    } catch (err) {
      console.error(`Tenant fallback by phone failed (${maskPhone(suffix)}):`, err.message);
    }
  }

  if (instanceName) {
    try {
      const { rows } = await pool.query(
        `SELECT tenant_id
           FROM whatsapp_instances
          WHERE tenant_id IS NOT NULL
            AND tenant_id <> '00000000-0000-0000-0000-000000000001'::uuid
            AND tenant_id <> '00000000-0000-0000-0000-000000000000'::uuid
            AND ($1 = '' OR instance_name = $1)
            AND ($2 = '' OR substring(tenant_id::text from 1 for 8) = $2)
          ORDER BY created_at DESC NULLS LAST
          LIMIT 1`,
        [instanceName, prefix || '']
      );
      if (rows[0]?.tenant_id && isValidTenantId(rows[0].tenant_id)) return rows[0].tenant_id;
    } catch (err) {
      console.error(`Tenant fallback by instance failed (${instanceName}):`, err.message);
    }
  }

  // Try local tenants table by instance name prefix
  if (prefix) {
    for (const table of ['tenants', 'profiles']) {
      try {
        const col = table === 'tenants' ? 'id' : 'tenant_id';
        const { rows } = await pool.query(
          `SELECT DISTINCT ${col} AS tenant_id FROM ${table}
            WHERE ${col} IS NOT NULL
              AND substring(${col}::text from 1 for 8) = $1
            LIMIT 1`,
          [prefix]
        );
        if (rows[0]?.tenant_id && isValidTenantId(rows[0].tenant_id)) return rows[0].tenant_id;
      } catch (err) {
        if (err.code !== '42P01') {
          console.error(`Tenant fallback prefix (${table}) failed:`, err.message);
        }
      }
    }
  }

  // Supabase Cloud lookup by tenant prefix (covers tenants that only exist in Cloud, not on the VPS local DB)
  if (prefix && SUPABASE_BRIDGE_ENABLED) {
    try {
      const restAuthKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      const url = `${SUPABASE_URL}/rest/v1/tenants?select=id&id=like.${prefix}*&limit=1`;
      const r = await fetch(url, {
        headers: { apikey: restAuthKey, Authorization: `Bearer ${restAuthKey}` },
      });
      if (r.ok) {
        const rows = await r.json();
        if (rows?.[0]?.id && isValidTenantId(rows[0].id)) return rows[0].id;
      }
    } catch (err) {
      console.error('Tenant fallback Supabase prefix failed:', err.message);
    }
  }

  // NEVER fall back to "most common tenant" — when a prefix is known but no
  // match was found, returning a foreign tenant leaks messages to the wrong
  // clinic and SSE broadcast lands on 0 clients (since the real user is
  // connected under the correct tenant prefix).
  return null;
}

async function resolveSupabaseUser(token) {
  if (!SUPABASE_BRIDGE_ENABLED) throw new Error('Supabase bridge not configured');
  const cached = _supabaseUserCache.get(token);
  if (cached && cached.exp > Date.now()) return cached.user;

  // 1) Valida o token e obtém o user
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) throw new Error('Invalid Supabase token');
  const sbUser = await userRes.json();
  if (!sbUser?.id) throw new Error('Invalid Supabase user');

  const restAuthKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const restBearer = SUPABASE_SERVICE_ROLE_KEY || token;

  // 2) Busca profile (tenant_id, role, is_super_admin). Use select=* because
  // Lovable Cloud / local VPS schemas have varied between `name` and `nome`;
  // selecting a missing column makes PostgREST return 400 and leaves SSE
  // clients without tenant_id, so no WhatsApp alert reaches the browser.
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${sbUser.id}&select=*&limit=1`,
    {
      headers: {
        apikey: restAuthKey,
        Authorization: `Bearer ${restBearer}`,
      },
    }
  );
  let profiles = profRes.ok ? await profRes.json() : [];
  let profile = profiles?.[0] || {};

  // 2b) Fallback para o banco local da VPS. Isso cobre casos em que o token
  // é válido, mas a leitura do profile via REST fica sem tenant por diferença
  // de schema/RLS. Sem tenant_id o /api/events conecta como "anonymous" e o
  // broadcast filtrado por clínica nunca chega ao chat/notificador.
  if (!profile?.tenant_id) {
    try {
      const { rows } = await pool.query(
        `SELECT *
           FROM profiles
          WHERE id = $1 OR email = $2
          LIMIT 1`,
        [sbUser.id, sbUser.email]
      );
      if (rows[0]?.tenant_id) {
        profile = {
          ...profile,
          ...rows[0],
          name: rows[0].name || rows[0].nome || profile.name,
          role: rows[0].role || profile.role,
          is_super_admin: rows[0].is_super_admin ?? profile.is_super_admin,
        };
      }
    } catch (err) {
      console.warn('Local profile fallback failed:', err.message);
    }
  }

  // 3) Resolve role (admin/atendente/etc) a partir de user_roles
  let role = profile.role || 'user';
  try {
    const roleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${sbUser.id}&select=role,tenant_id&limit=1`,
      {
        headers: {
          apikey: restAuthKey,
          Authorization: `Bearer ${restBearer}`,
        },
      }
    );
    if (roleRes.ok) {
      const roles = await roleRes.json();
      if (roles?.[0]?.role) role = roles[0].role;
      if (!profile?.tenant_id && roles?.[0]?.tenant_id && isValidTenantId(roles[0].tenant_id)) {
        profile.tenant_id = roles[0].tenant_id;
      }
    }
  } catch { /* default user */ }

  const user = {
    sub: sbUser.id,
    id: sbUser.id,
    email: profile.email || sbUser.email,
    role,
    tenant_id: profile.tenant_id || null,
    is_super_admin: !!profile.is_super_admin,
    _source: 'supabase',
  };
  // Never cache an authenticated user without tenant_id. A transient profile/RLS
  // miss here used to poison the auth bridge for 5 minutes, making queue/chat
  // endpoints run with tenant_id=NULL and return an empty chat even though the
  // WhatsApp messages were already persisted correctly.
  if (user.tenant_id) {
    _supabaseUserCache.set(token, { user, exp: Date.now() + SUPABASE_CACHE_TTL_MS });
  } else {
    _supabaseUserCache.delete(token);
  }
  return user;
}

// ─── Evolution API Config ───────────────────────────────────
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'https://api.odontoconnect.tech').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const APP_URL = (process.env.APP_URL || 'https://odontoconnect.tech').replace(/\/$/, '').replace(':443', '');
const WEBHOOK_PUBLIC_URL = process.env.WEBHOOK_PUBLIC_URL?.replace(/\/$/, '');
const isLocalAppUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(APP_URL);
if (!EVOLUTION_API_KEY) {
  console.error('❌ EVOLUTION_API_KEY não definida no .env do VPS — envios do WhatsApp retornarão erro até configurar a chave.');
}

// Ensure the webhook URL points to the backend API endpoint
const WEBHOOK_URL = WEBHOOK_PUBLIC_URL || (isLocalAppUrl ? `${APP_URL.replace(/:\d+$/, `:${PORT}`)}/api/webhook/evolution` : `https://backend.odontoconnect.tech/api/webhook/evolution`);

// Metadados de credencial para logs/diagnóstico: só diz se existe e o tamanho,
// nunca trechos do valor. Usado em sendEvolutionTextMessage e /api/debug/config.
// Logs: telefone só com os 4 últimos dígitos; nunca nome, e-mail ou corpo de mensagem (LGPD).
function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? `***${digits.slice(-4)}` : '-';
}

function getCredentialDebugMeta(value) {
  const raw = String(value || '');
  return { present: raw.length > 0, length: raw.length };
}

// Segredo do webhook da Evolution. Vai na URL registrada (?token=...) e é
// conferido em cada chamada. Sem ele, qualquer pessoa podia forjar mensagens,
// leads e confirmações de consulta para qualquer clínica.
// WEBHOOK_URL continua sem o segredo para uso em logs e respostas da API.
const EVOLUTION_WEBHOOK_SECRET = String(process.env.EVOLUTION_WEBHOOK_SECRET || '').trim();
function webhookTokenForInstance(instanceName) {
  return createHmac('sha256', EVOLUTION_WEBHOOK_SECRET).update(String(instanceName || '')).digest('hex').slice(0, 48);
}

function webhookRegisterUrlFor(instanceName) {
  if (!EVOLUTION_WEBHOOK_SECRET) return WEBHOOK_URL;
  return `${WEBHOOK_URL}${WEBHOOK_URL.includes('?') ? '&' : '?'}token=${webhookTokenForInstance(instanceName)}`;
}

if (!EVOLUTION_WEBHOOK_SECRET) {
  console.warn('⚠️ EVOLUTION_WEBHOOK_SECRET não definida — o webhook do WhatsApp aceita chamadas sem autenticação. Defina no .env da VPS.');
}

function isValidEvolutionWebhookRequest(req, instanceName) {
  if (!EVOLUTION_WEBHOOK_SECRET) return true; // modo de compatibilidade até configurar
  if (!instanceName) return false;
  const provided = String(req.query?.token || req.headers['x-webhook-token'] || '');
  const expected = webhookTokenForInstance(instanceName);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Nunca devolver o token do webhook ao navegador nem gravá-lo em log.
function redactWebhookToken(data) {
  if (data == null) return data;
  try {
    return JSON.parse(JSON.stringify(data).replace(/token=[A-Za-z0-9%._~-]+/g, 'token=***'));
  } catch {
    return data;
  }
}

// ─── Web Push (VAPID) Config ────────────────────────────────
// Generate keys once: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:contato@odontoconnect.tech', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('🔔 Web Push VAPID configured');
} else {
  console.warn('⚠️ VAPID keys not set — push notifications disabled. Run: npx web-push generate-vapid-keys');
}

// ─── Send push to all subscriptions ─────────────────────────
async function sendPushToAll(payload, tenantId) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  // Sem tenant não envia: antes a prévia da mensagem ia para todas as clínicas.
  if (!tenantId) return;
  try {
    const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions WHERE tenant_id = $1', [tenantId]);
    const pushPayload = JSON.stringify(payload);
    for (const sub of subs) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      };
      try {
        await webpush.sendNotification(subscription, pushPayload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
          console.log('🗑️ Removed expired push subscription');
        }
      }
    }
  } catch (err) {
    console.error('Push send error:', err.message);
  }
}

// ─── Auto-register webhook on Evolution API instance ─────────
function webhookFindHasExpectedUrl(data, instanceName) {
  if (!data) return false;
  const raw = JSON.stringify(data);
  // Com segredo, só conta como registrado se a URL já tiver o token desta instância.
  if (!EVOLUTION_WEBHOOK_SECRET) return raw.includes(WEBHOOK_URL);
  return raw.includes(WEBHOOK_URL) && raw.includes(webhookTokenForInstance(instanceName));
}

async function verifyWebhookRegistration(instanceName) {
  const check = await evolutionFetch(`/webhook/find/${instanceName}`);
  if (!check.ok) return { ok: false, data: check.data, status: check.status };
  return { ok: webhookFindHasExpectedUrl(check.data, instanceName), data: redactWebhookToken(check.data), status: check.status };
}

async function registerWebhook(instanceName) {
  try {
    const webhookConfig = {
      enabled: true,
      url: webhookRegisterUrlFor(instanceName),
      // Evolution API v2 expects these exact property names. Keep legacy
      // aliases too so older deployments do not break during rolling updates.
      byEvents: false,
      base64: false,
      webhookByEvents: false,
      webhookBase64: false,
      webhook_by_events: false,
      webhook_base64: false,
      events: [
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'SEND_MESSAGE',
        'SEND_MESSAGE_UPDATE',
        'CONNECTION_UPDATE',
        'QRCODE_UPDATED',
        'PRESENCE_UPDATE',
      ],
    };

    // Evolution API v2 expects the config nested under `webhook` on many builds.
    // If we send only the root shape, some servers answer 200 but keep the old
    // callback, which leaves the channel connected while Chat receives nothing.
    // Register nested-first and use the root shape only as compatibility fallback.
    let result = await evolutionFetch(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ webhook: webhookConfig }),
    });

    let verified = result.ok ? await verifyWebhookRegistration(instanceName).catch((err) => ({ ok: false, error: err.message })) : null;

    if (!result.ok || !verified?.ok) {
      console.warn(`⚠️ Retrying webhook registration with root payload for ${instanceName}${result.ok ? ' (nested payload not verified)' : ''}`);
      result = await evolutionFetch(`/webhook/set/${instanceName}`, {
        method: 'POST',
        body: JSON.stringify(webhookConfig),
      });
      verified = result.ok ? await verifyWebhookRegistration(instanceName).catch((err) => ({ ok: false, error: err.message })) : verified;
    }

    if (result.ok && (verified?.ok || verified?.status === 404 || verified?.status === 405)) {
      console.log(`✅ Webhook registered for ${instanceName} → ${WEBHOOK_URL}${verified?.ok ? ' (verified)' : ''}`);
    } else {
      console.error(`⚠️ Webhook registration failed/not verified for ${instanceName} (${WEBHOOK_URL}):`, redactWebhookToken({
        set: result.data,
        verify: verified?.data || verified?.error,
      }));
    }
    return result.ok ? { ...result, verified: !!verified?.ok } : result;
  } catch (err) {
    console.error(`❌ Webhook registration error for ${instanceName}:`, err.message);
  }
}


// ─── Auth helpers ───────────────────────────────────────────
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function looksLikeSupabaseAccessToken(decoded) {
  if (!decoded || typeof decoded !== 'object') return false;
  const issuer = String(decoded.iss || '');
  const audience = String(decoded.aud || '');
  return issuer.includes('/auth/v1')
    || audience === 'authenticated'
    || !!decoded.app_metadata
    || !!decoded.user_metadata;
}

async function verifyUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized');
  const token = authHeader.replace('Bearer ', '');
  const requestedTenantId = req.headers['x-tenant-id'] || req.query?.tenantId || req.body?.tenantId;

  // 1) Tenta token legacy (HS256 com JWT_SECRET)
  let decoded = null;
  try {
    if (!LEGACY_JWT_ENABLED) throw new Error('legacy disabled');
    decoded = verifyToken(token);
    // If JWT_SECRET matches the Supabase project JWT secret, a Supabase access
    // token also verifies here. Do not treat it as our legacy VPS token, because
    // it does not contain tenant_id/is_super_admin in the legacy shape. Force the
    // Supabase bridge path so profile, tenant and role are resolved correctly.
    if (looksLikeSupabaseAccessToken(decoded)) decoded = null;
  } catch {
    decoded = null;
  }

  let user;
  if (decoded) {
    user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id || null,
      is_super_admin: !!decoded.is_super_admin,
    };
  } else if (SUPABASE_BRIDGE_ENABLED) {
    // 2) Fallback: tenta validar como token Supabase
    try {
      const sbUser = await resolveSupabaseUser(token);
      decoded = sbUser; // usa o shape para set_config
      user = {
        id: sbUser.id,
        email: sbUser.email,
        role: sbUser.role,
        tenant_id: sbUser.tenant_id,
        is_super_admin: sbUser.is_super_admin,
      };
    } catch (err) {
      throw new Error('Unauthorized');
    }
  } else {
    throw new Error('Unauthorized');
  }

  // Some Lovable/Supabase sessions authenticate correctly but the profile
  // lookup can return without tenant_id because of schema/RLS differences.
  // The frontend sends the active tenant in x-tenant-id; accept it only after
  // validating that this user belongs to that tenant, otherwise queue/chat
  // endpoints run with "sem tenant" and return empty messages.
  if (isValidTenantId(requestedTenantId)) {
    const validatedTenant = await validateRequestedTenantForUser(user, requestedTenantId);
    if (validatedTenant) user.tenant_id = validatedTenant;
  }

  // Set tenant context for RLS-backed queries. This must be session-level; the
  // previous transaction-local setting was cleared immediately after SELECT.
  await setDbTenantContext({
    tenantId: user.tenant_id,
    isSuperAdmin: user.is_super_admin,
    payload: decoded,
  });

  return { user };
}

async function getProfileDisplayName(userId, fallback = 'Atendente') {
  if (!userId) return fallback;

  try {
    const { rows } = await pool.query('SELECT * FROM profiles WHERE id = $1 LIMIT 1', [userId]);
    return rows[0]?.nome || rows[0]?.name || rows[0]?.full_name || rows[0]?.email || fallback;
  } catch (err) {
    console.warn('Profile display name lookup failed:', err.message);
    return fallback;
  }
}

async function verifySuperAdmin(req) {
  const { user } = await verifyUser(req);
  if (!user.is_super_admin) {
    console.warn(`[SECURITY] Unprivileged super-admin access attempt: user=${user.id}`);
    throw new Error('Super admin access required');
  }
  return { user };
}

async function verifyAdmin(req) {
  const { user } = await verifyUser(req);
  // Super Admins bypass normal admin checks for maintenance
  if (user.is_super_admin) return { user };
  
  if (user.role === 'admin') return { user };
  
  const { rows } = await pool.query(
    'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
    [user.id, 'admin']
  );
  if (rows.length === 0) {
    console.warn(`[SECURITY] Access denied: user=${user.id} is not an admin`);
    throw new Error('Admin access required');
  }
  return { user };
}

async function getProfileByEmail(email) {
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, avatar_url, password_hash,
              COALESCE(active, true) as active,
              tenant_id, COALESCE(is_super_admin, false) as is_super_admin
       FROM profiles WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );
    return rows[0] || null;
  } catch (error) {
    if (error?.code !== '42703') throw error;

    const { rows } = await pool.query(
      'SELECT id, name, email, role, avatar_url, password_hash, true as active, NULL::uuid as tenant_id, false as is_super_admin FROM profiles WHERE email = $1 LIMIT 1',
      [normalizedEmail]
    );
    return rows[0] || null;
  }
}

// Papéis que um admin de clínica pode atribuir (my-tenant e /api/auth/users).
const TENANT_ASSIGNABLE_ROLES = ['admin', 'dentista', 'recepcionista', 'comercial', 'user'];

// Um admin de clínica só pode mexer em usuários da própria clínica, e nunca
// em um super-admin. Super-admin pode tudo. Lança erro com status HTTP.
async function assertCanManageUser(actor, targetUserId) {
  if (!targetUserId) { const e = new Error('Usuário não informado'); e.status = 400; throw e; }
  const { rows } = await pool.query(
    'SELECT id, tenant_id, COALESCE(is_super_admin, false) AS is_super_admin FROM profiles WHERE id = $1',
    [targetUserId]
  );
  const target = rows[0];
  if (!target) { const e = new Error('Usuário não encontrado'); e.status = 404; throw e; }
  if (actor?.is_super_admin) return target;
  const sameTenant = actor?.tenant_id && target.tenant_id && String(actor.tenant_id) === String(target.tenant_id);
  if (!sameTenant || target.is_super_admin) {
    console.warn(`[SECURITY] Bloqueado: user=${actor?.id} tentou alterar o usuário ${targetUserId} de outra clínica/super-admin`);
    const e = new Error('Usuário não encontrado'); e.status = 404; throw e;
  }
  return target;
}

function httpStatusOf(error, fallback = 500) {
  if (error?.status) return error.status;
  if (error?.message === 'Unauthorized') return 401;
  if (error?.message === 'Admin access required' || error?.message === 'Super admin access required') return 403;
  return fallback;
}

// tenantId = null só para super-admin (lista todos)
async function listProfilesWithRoles(tenantId = null) {
  const where = tenantId ? 'WHERE p.tenant_id = $1' : '';
  // Lista de clínica nunca mostra super-admins (eles podem estar no tenant "Legado")
  const whereMain = tenantId ? 'WHERE p.tenant_id = $1 AND COALESCE(p.is_super_admin, false) = false' : '';
  const params = tenantId ? [tenantId] : [];
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.email, p.avatar_url, p.created_at, p.updated_at,
             COALESCE(p.active, true) as active,
             COALESCE(ur.role::text, p.role::text, 'user') as role
      FROM profiles p
      LEFT JOIN user_roles ur ON ur.user_id = p.id
      ${whereMain}
      ORDER BY p.created_at DESC
    `, params);

    return rows;
  } catch (error) {
    if (error?.code !== '42703') throw error;

    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.email, p.avatar_url, p.created_at, p.updated_at,
             true as active,
             COALESCE(ur.role::text, p.role::text, 'user') as role
      FROM profiles p
      LEFT JOIN user_roles ur ON ur.user_id = p.id
      ${where}
      ORDER BY p.created_at DESC
    `, params);

    return rows;
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

    const profile = await getProfileByEmail(email);
    if (!profile) return res.status(401).json({ error: 'Email ou senha inválidos' });
    if (!profile.active) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o administrador.' });
    if (!profile.password_hash) return res.status(401).json({ error: 'Senha não configurada' });

    const valid = await bcrypt.compare(password, profile.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email ou senha inválidos' });

    const { rows: roles } = await pool.query(
      'SELECT role FROM user_roles WHERE user_id = $1 LIMIT 1',
      [profile.id]
    );
    const role = roles[0]?.role || profile.role || 'user';

    const tokenPayload = {
      sub: profile.id,
      email: profile.email,
      role,
      tenant_id: profile.tenant_id || null,
      is_super_admin: !!profile.is_super_admin,
    };

    const token = signToken(tokenPayload);

    res.json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role,
        avatar_url: profile.avatar_url,
        tenant_id: profile.tenant_id || null,
        is_super_admin: !!profile.is_super_admin,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SAAS — TENANTS / PLANS / SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

app.get('/api/plans', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, nome, descricao, preco_mensal, preco_anual, trial_days,
              max_usuarios, max_dentistas, max_pacientes, max_whatsapp_instances,
              features, display_order
         FROM plans WHERE ativo = true ORDER BY display_order, preco_mensal`
    );
    res.json({ data: rows });
  } catch (error) {
    console.error('GET /api/plans error:', error);
    res.status(500).json({ error: 'Erro ao listar planos' });
  }
});

app.post('/api/auth/signup-clinic', async (req, res) => {
  const client = await pool.connect();
  try {
    const { clinic_name, admin_name, email, password, plan_slug, telefone, cnpj, termos_versao, politica_versao } = req.body || {};
    if (!clinic_name || !admin_name || !email || !password) {
      return res.status(400).json({ error: 'Campos obrigatórios: clinic_name, admin_name, email, password' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 8 caracteres' });
    }
    const normalizedEmail = String(email).toLowerCase().trim();

    const existing = await getProfileByEmail(normalizedEmail);
    if (existing) return res.status(409).json({ error: 'Email já cadastrado' });

    const planSlug = plan_slug || 'starter';
    const { rows: planRows } = await client.query('SELECT * FROM plans WHERE slug = $1 AND ativo = true', [planSlug]);
    const plan = planRows[0];
    if (!plan) return res.status(400).json({ error: 'Plano inválido' });

    await client.query('BEGIN');

    const baseSlug = slugify(clinic_name) || 'clinica';
    let slug = baseSlug;
    let i = 1;
    while ((await client.query('SELECT 1 FROM tenants WHERE slug = $1', [slug])).rowCount) {
      slug = `${baseSlug}-${i++}`;
    }

    const trialDays = plan.trial_days || 14;
    const { rows: tRows } = await client.query(
      `INSERT INTO tenants (nome, slug, cnpj, telefone, email_contato, status, trial_ends_at, plan_id,
                            termos_versao, politica_versao, termos_aceitos_em, termos_aceite_ip)
       VALUES ($1,$2,$3,$4,$5,'trial', NOW() + ($6 || ' days')::interval, $7, $8, $9, NOW(), $10) RETURNING *`,
      [clinic_name, slug, cnpj || null, telefone || null, normalizedEmail, String(trialDays), plan.id,
       termos_versao ? String(termos_versao) : null, politica_versao ? String(politica_versao) : null,
       req.headers['x-forwarded-for'] || req.ip || null]
    );
    const tenant = tRows[0];

    const password_hash = await bcrypt.hash(password, 10);
    const { rows: pRows } = await client.query(
      `INSERT INTO profiles (name, email, role, password_hash, active, tenant_id, is_super_admin)
       VALUES ($1,$2,'admin',$3,true,$4,false)
       RETURNING id, name, email, role, avatar_url, tenant_id`,
      [admin_name, normalizedEmail, password_hash, tenant.id]
    );
    const profile = pRows[0];

    await client.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1,'admin') ON CONFLICT DO NOTHING`,
      [profile.id]
    );

    await client.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end, gateway)
       VALUES ($1,$2,'active', NOW() + ($3 || ' days')::interval, 'manual')`,
      [tenant.id, plan.id, String(trialDays)]
    );

    await client.query('COMMIT');

    const token = signToken({
      sub: profile.id, email: profile.email, role: 'admin',
      tenant_id: tenant.id, is_super_admin: false,
    });

    res.json({
      token,
      user: { ...profile, is_super_admin: false },
      tenant,
      plan,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Signup error:', error);
    res.status(500).json({ error: error.message || 'Erro ao criar conta' });
  } finally {
    client.release();
  }
});

app.get('/api/my-tenant', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(404).json({ error: 'Usuário sem tenant' });
    const { rows } = await pool.query(
      `SELECT t.*, p.nome as plan_nome, p.slug as plan_slug, p.preco_mensal, p.features,
              p.max_usuarios, p.max_dentistas, p.max_pacientes
         FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
        WHERE t.id = $1`,
      [user.tenant_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Tenant não encontrado' });

    const { rows: subs } = await pool.query(
      `SELECT * FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [user.tenant_id]
    );
    const { rows: invs } = await pool.query(
      `SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 12`,
      [user.tenant_id]
    );

    res.json({ tenant: rows[0], subscription: subs[0] || null, invoices: invs });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

// ─── Tenant: list users in my tenant ────────────────────────
app.get('/api/my-tenant/users', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin do tenant' });
    if (!user.tenant_id) return res.status(404).json({ error: 'Usuário sem tenant' });
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.email, p.avatar_url, p.created_at, p.updated_at,
              COALESCE(p.active, true) as active,
              COALESCE(ur.role::text, p.role::text, 'user') as role
         FROM profiles p
         LEFT JOIN user_roles ur ON ur.user_id = p.id
        WHERE p.tenant_id = $1 AND COALESCE(p.is_super_admin, false) = false
        ORDER BY p.created_at DESC`,
      [user.tenant_id]
    );
    res.json({ data: rows });
  } catch (e) {
    const status = httpStatusOf(e);
    res.status(status).json({ error: status === 500 ? 'Erro interno' : e.message });
  }
});

app.post('/api/my-tenant/users', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin do tenant' });
    if (!user.tenant_id) return res.status(404).json({ error: 'Usuário sem tenant' });
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e senha obrigatórios' });
    if (password.length < 8) return res.status(400).json({ error: 'Senha mínima de 8 caracteres' });

    const userRole = TENANT_ASSIGNABLE_ROLES.includes(role) ? role : 'user';

    const normalizedEmail = email.toLowerCase().trim();
    const { rows: existing } = await pool.query('SELECT id FROM profiles WHERE email = $1', [normalizedEmail]);
    if (existing.length > 0) return res.status(409).json({ error: 'Email já cadastrado' });

    // Plan limit check
    const { rows: planRows } = await pool.query(
      `SELECT pl.max_usuarios FROM tenants t LEFT JOIN plans pl ON pl.id = t.plan_id WHERE t.id = $1`,
      [user.tenant_id]
    );
    const maxUsers = planRows[0]?.max_usuarios;
    if (maxUsers != null) {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int as c FROM profiles WHERE tenant_id = $1 AND COALESCE(active, true) = true`,
        [user.tenant_id]
      );
      if (countRows[0].c >= maxUsers) {
        return res.status(403).json({ error: `Limite de ${maxUsers} usuários do plano atingido` });
      }
    }

    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO profiles (id, name, email, role, password_hash, active, tenant_id, is_super_admin)
       VALUES ($1,$2,$3,$4,$5,true,$6,false)`,
      [id, name.trim(), normalizedEmail, userRole, hash, user.tenant_id]
    );
    await pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, userRole]);
    res.json({ success: true, user: { id, name: name.trim(), email: normalizedEmail, role: userRole, active: true } });
  } catch (e) {
    console.error('Tenant create user error:', e.message);
    const status = httpStatusOf(e);
    res.status(status).json({ error: status === 500 ? 'Erro interno' : e.message });
  }
});

app.patch('/api/my-tenant/users/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin do tenant' });
    if (!user.tenant_id) return res.status(404).json({ error: 'Usuário sem tenant' });
    const { id } = req.params;
    const { name, email, role, active } = req.body || {};

    // Mesma clínica e nunca um super-admin (assertCanManageUser), mesmo quando o ator é super-admin
    let target;
    try { target = await assertCanManageUser(user, id); }
    catch (err) { return res.status(err.status || 500).json({ error: err.status === 404 ? 'Usuário não encontrado neste tenant' : err.message }); }
    if (String(target.tenant_id || '') !== String(user.tenant_id) || (target.is_super_admin && !user.is_super_admin)) {
      return res.status(404).json({ error: 'Usuário não encontrado neste tenant' });
    }
    if (email !== undefined) {
      const { rows: taken } = await pool.query(
        'SELECT 1 FROM profiles WHERE email = $1 AND id <> $2 LIMIT 1', [String(email).toLowerCase().trim(), id]
      );
      if (taken.length) return res.status(409).json({ error: 'Email já em uso por outro usuário' });
    }
    if (id === user.id && active === false) {
      return res.status(400).json({ error: 'Você não pode desativar o próprio usuário' });
    }

    const updates = [];
    const values = [];
    let idx = 1;
    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(String(name).trim()); }
    if (email !== undefined) { updates.push(`email = $${idx++}`); values.push(String(email).toLowerCase().trim()); }
    if (active !== undefined) { updates.push(`active = $${idx++}`); values.push(!!active); }
    if (updates.length) {
      updates.push(`updated_at = NOW()`);
      values.push(id);
      await pool.query(`UPDATE profiles SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }
    if (role !== undefined) {
      if (!TENANT_ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
      await pool.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
      await pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
      await pool.query('UPDATE profiles SET role = $1, updated_at = NOW() WHERE id = $2', [role, id]);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Tenant update user error:', e.message);
    const status = httpStatusOf(e);
    res.status(status).json({ error: status === 500 ? 'Erro interno' : e.message });
  }
});

app.post('/api/my-tenant/users/:id/reset-password', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin do tenant' });
    if (!user.tenant_id) return res.status(404).json({ error: 'Usuário sem tenant' });
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password || password.length < 8) return res.status(400).json({ error: 'Senha mínima de 8 caracteres' });

    // Mesma clínica e nunca um super-admin (assertCanManageUser), mesmo quando o ator é super-admin
    let target;
    try { target = await assertCanManageUser(user, id); }
    catch (err) { return res.status(err.status || 500).json({ error: err.status === 404 ? 'Usuário não encontrado neste tenant' : err.message }); }
    if (String(target.tenant_id || '') !== String(user.tenant_id) || (target.is_super_admin && !user.is_super_admin)) {
      return res.status(404).json({ error: 'Usuário não encontrado neste tenant' });
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, id]);
    res.json({ success: true });
  } catch (e) {
    console.error('Tenant reset password error:', e.message);
    const status = httpStatusOf(e);
    res.status(status).json({ error: status === 500 ? 'Erro interno' : e.message });
  }
});

app.post('/api/my-tenant/change-plan', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin do tenant' });
    const { plan_slug } = req.body || {};
    const { rows } = await pool.query('SELECT * FROM plans WHERE slug = $1 AND ativo = true', [plan_slug]);
    if (!rows[0]) return res.status(400).json({ error: 'Plano inválido' });
    await pool.query('UPDATE tenants SET plan_id = $1, updated_at = NOW() WHERE id = $2', [rows[0].id, user.tenant_id]);
    res.json({ ok: true, plan: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/super-admin/tenants', async (req, res) => {
  try {
    await verifySuperAdmin(req);
    const { rows } = await pool.query(`
      SELECT t.*, p.nome as plan_nome, p.slug as plan_slug, p.preco_mensal,
             (SELECT COUNT(*) FROM profiles WHERE tenant_id = t.id) as users_count
      FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
      ORDER BY t.created_at DESC
    `);
    res.json({ data: rows });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

app.patch('/api/super-admin/tenants/:id', async (req, res) => {
  try {
    await verifySuperAdmin(req);
    const { id } = req.params;
    const { status, plan_slug, trial_ends_at, current_period_end } = req.body || {};
    const sets = [], vals = [];
    let i = 1;
    if (status) { sets.push(`status = $${i++}`); vals.push(status); }
    if (trial_ends_at !== undefined) { sets.push(`trial_ends_at = $${i++}`); vals.push(trial_ends_at); }
    if (current_period_end !== undefined) { sets.push(`current_period_end = $${i++}`); vals.push(current_period_end); }
    if (plan_slug) {
      const { rows: pr } = await pool.query('SELECT id FROM plans WHERE slug = $1', [plan_slug]);
      if (!pr[0]) return res.status(400).json({ error: 'Plano inválido' });
      sets.push(`plan_id = $${i++}`); vals.push(pr[0].id);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    res.json({ data: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/super-admin/plans', async (req, res) => {
  try {
    await verifySuperAdmin(req);
    const { rows } = await pool.query('SELECT * FROM plans ORDER BY display_order, preco_mensal');
    res.json({ data: rows });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

app.post('/api/super-admin/plans', async (req, res) => {
  try {
    await verifySuperAdmin(req);
    const b = req.body || {};
    if (!b.nome || !b.slug) return res.status(400).json({ error: 'nome e slug obrigatórios' });
    const { rows } = await pool.query(
      `INSERT INTO plans (slug, nome, descricao, preco_mensal, preco_anual, trial_days,
        max_usuarios, max_dentistas, max_pacientes, max_whatsapp_instances, features, ativo, display_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [b.slug, b.nome, b.descricao || null, b.preco_mensal || 0, b.preco_anual || null, b.trial_days || 14,
       b.max_usuarios || null, b.max_dentistas || null, b.max_pacientes || null, b.max_whatsapp_instances || null,
       b.features || {}, b.ativo !== false, b.display_order || 0]
    );
    res.json({ data: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/super-admin/plans/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await verifySuperAdmin(req);
    const { id } = req.params;
    const b = req.body || {};
    const fields = ['nome','descricao','preco_mensal','preco_anual','trial_days',
      'max_usuarios','max_dentistas','max_pacientes','max_whatsapp_instances','features','ativo','display_order'];
    const sets = [], vals = [];
    let i = 1;
    for (const f of fields) {
      if (b[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(b[f]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
    
    await client.query('BEGIN');
    
    sets.push('updated_at = NOW()');
    vals.push(id);
    const { rows } = await client.query(
      `UPDATE plans SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    const updatedPlan = rows[0];

    // Synchronization logic: Notify or log the change for affected tenants
    // In this architecture, limits are checked against the current plan in real-time.
    // However, if we had cached limits or specific quotas in the tenants table, 
    // we would update them here.
    
    // For now, we'll log the sync operation to ensure visibility in the VPS
    const { rowCount: affectedTenants } = await client.query(
      'SELECT 1 FROM tenants WHERE plan_id = $1',
      [id]
    );
    
    console.log(`[SYNC] Plan "${updatedPlan.nome}" updated. ${affectedTenants} tenants now reflect new limits: 
      Users: ${updatedPlan.max_usuarios || 'Unlimited'}, 
      WhatsApp: ${updatedPlan.max_whatsapp_instances || 'Unlimited'}`);

    await client.query('COMMIT');
    res.json({ data: updatedPlan, synced_tenants: affectedTenants });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Plan update sync error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/super-admin/stats', async (req, res) => {
  try {
    await verifySuperAdmin(req);
    
    // Aggregate metrics for MRR, ARR, and revenue
    // Using current date for monthly comparison
    const now = new Date();
    const firstDayCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const firstDayPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    
    const { rows: stats } = await pool.query(`
      WITH active_tenants AS (
        SELECT t.id, t.plan_id, p.preco_mensal 
        FROM tenants t
        JOIN plans p ON p.id = t.plan_id
        WHERE t.status = 'active'
      ),
      mrr_calc AS (
        SELECT SUM(preco_mensal) as mrr FROM active_tenants
      ),
      revenue_current_month AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM invoices
        WHERE status = 'paid' AND paid_at >= $1
      ),
      revenue_previous_month AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM invoices
        WHERE status = 'paid' AND paid_at >= $2 AND paid_at < $1
      ),
      pending_revenue AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM invoices
        WHERE status = 'pending'
      ),
      pix_total AS (
        SELECT COALESCE(SUM(amount), 0) as total
        FROM invoices
        WHERE status = 'paid' AND (payment_url LIKE '%pix%' OR id IN (SELECT id FROM invoices WHERE status = 'paid'))
      )
      SELECT 
        (SELECT COALESCE(mrr, 0) FROM mrr_calc) as mrr,
        (SELECT COALESCE(mrr * 12, 0) FROM mrr_calc) as arr,
        (SELECT total FROM revenue_current_month) as receita_mes,
        (SELECT total FROM revenue_previous_month) as receita_mes_anterior,
        (SELECT total FROM pending_revenue) as total_pendente,
        (SELECT total FROM pix_total) as total_pix,
        (SELECT COALESCE(mrr, 0) FROM mrr_calc) as receita_recorrente
    `, [firstDayCurrentMonth, firstDayPreviousMonth]);

    res.json({ data: stats[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Diagnostic Route ──────────────────────────────────────
app.get('/api/debug/config', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.is_super_admin) return res.status(403).json({ error: 'Super admin required' });
    
    res.json({
      environment: process.env.NODE_ENV,
      evolution_url: EVOLUTION_API_URL,
      evolution_api_key: getCredentialDebugMeta(EVOLUTION_API_KEY),
      webhook_url: WEBHOOK_URL,
      app_url: APP_URL,
      api_port: PORT,
      supabase_bridge: SUPABASE_BRIDGE_ENABLED,
      supabase_url: SUPABASE_URL,
      db_host: process.env.PG_HOST,
      db_database: process.env.PG_DATABASE,
      vapid_public_key: VAPID_PUBLIC_KEY ? 'Set' : 'Not set',
      sse_clients: sseClients.size,
      time: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Health check (used by deploy validation + monitoring) ──────────────
//
// Standardized error codes (stable contract — do not rename):
//   HEALTH_OK                     — all required deps healthy
//   DB_CONNECTION_FAILED          — Postgres unreachable / auth refused
//   DB_QUERY_FAILED               — connected but SELECT 1 returned unexpected
//   DB_TIMEOUT                    — query exceeded HEALTH_DB_TIMEOUT_MS
//   EVOLUTION_API_UNREACHABLE     — Evolution API did not respond (degraded)
//   EVOLUTION_API_TIMEOUT         — Evolution API exceeded timeout (degraded)
//   EVOLUTION_API_ERROR           — Evolution API returned non-2xx (degraded)
//   MISSING_ENV_VAR               — required env var not set (e.g. JWT_SECRET)
//   SCHEMA_MIGRATION_MISSING      — critical migration not applied (table/column absent)
//   SCHEMA_CHECK_FAILED           — could not introspect information_schema
//   REDIS_CONNECTION_FAILED       — Redis configured but unreachable (warning)
//   REDIS_PING_FAILED             — Redis connected but PING returned unexpected (warning)
//   REDIS_TIMEOUT                 — Redis exceeded HEALTH_REDIS_TIMEOUT_MS (warning)
//
// Severity:
//   critical → returns HTTP 503, blocks deploy
//   warning  → returns HTTP 200, surfaces in errors[] for visibility
//
// ─── Health check tunables (override via env vars) ─────────────────────
// Per-dependency timeout (ms) and max retry attempts. Retries use exponential
// backoff and only kick in for transient failures (timeouts, network errors,
// connection refused). Schema/env checks are deterministic and never retried.
const numEnv = (k, d) => {
  const v = parseInt(process.env[k] || '', 10);
  return Number.isFinite(v) && v >= 0 ? v : d;
};
const HEALTH_DB_TIMEOUT_MS        = numEnv('HEALTH_DB_TIMEOUT_MS',        5000);
const HEALTH_DB_RETRIES           = numEnv('HEALTH_DB_RETRIES',           2);
const HEALTH_EVOLUTION_TIMEOUT_MS = numEnv('HEALTH_EVOLUTION_TIMEOUT_MS', 3000);
const HEALTH_EVOLUTION_RETRIES    = numEnv('HEALTH_EVOLUTION_RETRIES',    1);
const HEALTH_REDIS_TIMEOUT_MS     = numEnv('HEALTH_REDIS_TIMEOUT_MS',     2000);
const HEALTH_REDIS_RETRIES        = numEnv('HEALTH_REDIS_RETRIES',        2);
const HEALTH_RETRY_BACKOFF_MS     = numEnv('HEALTH_RETRY_BACKOFF_MS',     200);
const HEALTH_RETRY_BACKOFF_MAX_MS = numEnv('HEALTH_RETRY_BACKOFF_MAX_MS', 1500);
const REQUIRED_ENV_VARS = ['JWT_SECRET', 'PG_HOST', 'PG_DATABASE', 'PG_USER'];

// Run `fn` with timeout + exponential backoff retries on transient errors.
// Returns { value, attempts, total_ms } on success.
// Throws { message, code, attempts, total_ms, last_error } on final failure.
async function withRetry(label, fn, { timeoutMs, retries }) {
  const t0 = Date.now();
  let lastErr = null;
  const maxAttempts = retries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => fn({ attempt })),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error(`${label}_TIMEOUT`), { _timeout: true })), timeoutMs)
        ),
      ]);
      return { value, attempts: attempt, total_ms: Date.now() - t0 };
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;
      const backoff = Math.min(HEALTH_RETRY_BACKOFF_MS * 2 ** (attempt - 1), HEALTH_RETRY_BACKOFF_MAX_MS);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  const e = new Error(lastErr?.message || `${label} failed`);
  e.attempts = maxAttempts;
  e.total_ms = Date.now() - t0;
  e.timedOut = !!lastErr?._timeout;
  e.cause = lastErr;
  throw e;
}

// ─── Optional Redis client (auto-detected) ─────────────────────────────
// If REDIS_URL or REDIS_HOST is set, we lazily create a singleton client
// used only for /api/health PINGs. Other modules can import getRedisClient()
// to reuse it for caches/queues. If neither env is set, the check is skipped.
const REDIS_URL = process.env.REDIS_URL
  || (process.env.REDIS_HOST
    ? `redis://${process.env.REDIS_PASSWORD ? `:${encodeURIComponent(process.env.REDIS_PASSWORD)}@` : ''}${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
    : null);

let _redisClient = null;
let _redisModule = null;
async function getRedisClient() {
  if (!REDIS_URL) return null;
  if (_redisClient && _redisClient.isOpen) return _redisClient;
  if (!_redisModule) {
    try {
      _redisModule = await import('redis');
    } catch {
      return null; // package not installed
    }
  }
  if (!_redisClient) {
    _redisClient = _redisModule.createClient({
      url: REDIS_URL,
      socket: { connectTimeout: HEALTH_REDIS_TIMEOUT_MS, reconnectStrategy: (r) => Math.min(r * 200, 5000) },
    });
    _redisClient.on('error', (e) => console.error('[redis] client error:', e?.message || e));
  }
  if (!_redisClient.isOpen) await _redisClient.connect();
  return _redisClient;
}
export { getRedisClient };

// Critical schema markers — each entry maps a migration to a table (and optional
// column) that MUST exist after the migration ran. If any are missing, the
// deploy is rejected with SCHEMA_MIGRATION_MISSING.
//
// Format: { migration, table, column? }  — column is optional (table-only check).
const REQUIRED_SCHEMA = [
  { migration: 'migration.sql',                   table: 'profiles' },
  { migration: 'migration.sql',                   table: 'user_roles' },
  { migration: 'migration-chat-messages.sql',     table: 'chat_messages' },
  { migration: 'migration-chat-messages.sql',     table: 'chat_read_status' },
  { migration: 'migration-attendance-sessions.sql', table: 'attendance_sessions', column: 'tenant_id' },
  { migration: 'migration-push-subscriptions.sql', table: 'push_subscriptions' },
  { migration: 'migration-crm-kanban.sql',        table: 'kanban_movements' },
  { migration: 'migration-crm-kanban.sql',        table: 'crm_leads', column: 'consciousness_level' },
  { migration: 'migration-crm-kanban.sql',        table: 'crm_leads', column: 'assigned_to' },
  { migration: 'migration-crm-kanban.sql',        table: 'crm_leads', column: 'paciente_id' },
  { migration: 'migration-priority-recovery.sql', table: 'crm_leads', column: 'priority' },
  { migration: 'migration-user-preferences.sql',  table: 'user_preferences' },
  { migration: 'migration-ai-settings.sql',       table: 'ai_settings' },
  { migration: 'migration-ai-settings.sql',       table: 'clinical_reports' },
  { migration: 'migration-reativacao.sql',        table: 'reactivation_rules' },
  { migration: 'migration-reativacao.sql',        table: 'reactivation_sends' },
  { migration: 'migration-finance-multitenant.sql', table: 'clinicorp_financial_entries', column: 'tenant_id' },
];

app.get('/api/health', async (req, res) => {
  const startedAt = Date.now();
  const errors = []; // standardized: { code, severity, dependency, message, detail? }
  const checks = {
    api: { status: 'ok' },
    env: { status: 'unknown' },
    database: { status: 'unknown' },
    schema: { status: 'unknown' },
    redis: { status: 'unknown' },
    evolution: { status: 'unknown' },
  };

  // ─── 1. Required env vars ──────────────────────────────────────────────
  const missingEnv = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missingEnv.length > 0) {
    checks.env = { status: 'down', missing: missingEnv };
    errors.push({
      code: 'MISSING_ENV_VAR',
      severity: 'critical',
      dependency: 'env',
      message: `Required environment variables not set: ${missingEnv.join(', ')}`,
      detail: { missing: missingEnv },
    });
  } else {
    checks.env = { status: 'ok' };
  }

  // ─── 2. Database (critical, retried) ───────────────────────────────────
  try {
    const { value: r, attempts, total_ms } = await withRetry(
      'DB',
      () => pool.query('SELECT 1 AS ok'),
      { timeoutMs: HEALTH_DB_TIMEOUT_MS, retries: HEALTH_DB_RETRIES }
    );
    if (r.rows?.[0]?.ok === 1) {
      checks.database = { status: 'ok', latency_ms: total_ms, attempts };
    } else {
      checks.database = { status: 'down', latency_ms: total_ms, attempts };
      errors.push({
        code: 'DB_QUERY_FAILED',
        severity: 'critical',
        dependency: 'database',
        message: 'Postgres connected but SELECT 1 returned unexpected result',
        detail: { rows: r.rows, attempts },
      });
    }
  } catch (err) {
    checks.database = {
      status: 'down',
      error: String(err?.message || err),
      attempts: err.attempts,
      latency_ms: err.total_ms,
    };
    errors.push({
      code: err.timedOut ? 'DB_TIMEOUT' : 'DB_CONNECTION_FAILED',
      severity: 'critical',
      dependency: 'database',
      message: err.timedOut
        ? `Postgres query exceeded ${HEALTH_DB_TIMEOUT_MS}ms after ${err.attempts} attempt(s)`
        : `Cannot connect to Postgres after ${err.attempts} attempt(s): ${err.message}`,
      detail: {
        host: process.env.PG_HOST,
        port: process.env.PG_PORT,
        db: process.env.PG_DATABASE,
        attempts: err.attempts,
        timeout_ms: HEALTH_DB_TIMEOUT_MS,
      },
    });
  }

  // ─── 3. Schema migrations (critical — only runs if DB is up) ───────────
  if (checks.database.status === 'ok') {
    try {
      const t0 = Date.now();
      // Single round-trip: fetch all required tables and columns
      const tableNames = [...new Set(REQUIRED_SCHEMA.map((s) => s.table))];
      const tablesRes = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [tableNames]
      );
      const presentTables = new Set(tablesRes.rows.map((r) => r.table_name));

      const colChecks = REQUIRED_SCHEMA.filter((s) => s.column);
      let presentColumns = new Set();
      if (colChecks.length > 0) {
        const colsRes = await pool.query(
          `SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public'
             AND (table_name, column_name) IN (${colChecks
               .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
               .join(',')})`,
          colChecks.flatMap((c) => [c.table, c.column])
        );
        presentColumns = new Set(colsRes.rows.map((r) => `${r.table_name}.${r.column_name}`));
      }

      const missing = [];
      for (const req of REQUIRED_SCHEMA) {
        if (!presentTables.has(req.table)) {
          missing.push({
            migration: req.migration,
            table: req.table,
            column: req.column || null,
            reason: 'table_missing',
          });
        } else if (req.column && !presentColumns.has(`${req.table}.${req.column}`)) {
          missing.push({
            migration: req.migration,
            table: req.table,
            column: req.column,
            reason: 'column_missing',
          });
        }
      }

      const latency = Date.now() - t0;
      if (missing.length === 0) {
        checks.schema = {
          status: 'ok',
          latency_ms: latency,
          checked: REQUIRED_SCHEMA.length,
        };
      } else {
        const missingMigrations = [...new Set(missing.map((m) => m.migration))];
        checks.schema = {
          status: 'down',
          latency_ms: latency,
          checked: REQUIRED_SCHEMA.length,
          missing_count: missing.length,
          missing_migrations: missingMigrations,
        };
        errors.push({
          code: 'SCHEMA_MIGRATION_MISSING',
          severity: 'critical',
          dependency: 'schema',
          message: `${missing.length} required schema element(s) missing — run pending migrations: ${missingMigrations.join(', ')}`,
          detail: { missing, missing_migrations: missingMigrations },
        });
      }
    } catch (err) {
      checks.schema = { status: 'down', error: String(err?.message || err) };
      errors.push({
        code: 'SCHEMA_CHECK_FAILED',
        severity: 'critical',
        dependency: 'schema',
        message: `Could not verify schema state: ${String(err?.message || err)}`,
      });
    }
  } else {
    checks.schema = { status: 'skipped', reason: 'database_unavailable' };
  }

  // ─── 4. Redis (warning — auto-detected, retried) ──────────────────────
  if (!REDIS_URL) {
    checks.redis = { status: 'not_configured', reason: 'REDIS_URL/REDIS_HOST not set' };
  } else {
    try {
      const { value: pong, attempts, total_ms } = await withRetry(
        'REDIS',
        async () => {
          const client = await getRedisClient();
          if (!client) throw new Error('redis package unavailable');
          return client.ping();
        },
        { timeoutMs: HEALTH_REDIS_TIMEOUT_MS, retries: HEALTH_REDIS_RETRIES }
      );
      if (pong === 'PONG') {
        checks.redis = { status: 'ok', latency_ms: total_ms, attempts };
      } else {
        checks.redis = { status: 'degraded', latency_ms: total_ms, attempts, response: pong };
        errors.push({
          code: 'REDIS_PING_FAILED',
          severity: 'warning',
          dependency: 'redis',
          message: `Redis PING returned unexpected response: ${String(pong)}`,
          detail: { response: pong, attempts },
        });
      }
    } catch (err) {
      checks.redis = {
        status: 'degraded',
        error: String(err?.message || err),
        attempts: err.attempts,
        latency_ms: err.total_ms,
      };
      errors.push({
        code: err.timedOut ? 'REDIS_TIMEOUT' : 'REDIS_CONNECTION_FAILED',
        severity: 'warning',
        dependency: 'redis',
        message: err.timedOut
          ? `Redis did not respond within ${HEALTH_REDIS_TIMEOUT_MS}ms after ${err.attempts} attempt(s)`
          : `Cannot connect to Redis after ${err.attempts} attempt(s): ${err.message}`,
        detail: {
          url: REDIS_URL.replace(/:[^:@/]+@/, ':***@'),
          attempts: err.attempts,
          timeout_ms: HEALTH_REDIS_TIMEOUT_MS,
        },
      });
    }
  }

  // ─── 5. Evolution API (warning, retried) ───────────────────────────────
  try {
    const { value: r, attempts, total_ms } = await withRetry(
      'EVOLUTION',
      async ({ attempt }) => {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), HEALTH_EVOLUTION_TIMEOUT_MS);
        try {
          return await fetch(`${EVOLUTION_API_URL}/`, { signal: ctrl.signal });
        } finally {
          clearTimeout(to);
        }
      },
      { timeoutMs: HEALTH_EVOLUTION_TIMEOUT_MS + 500, retries: HEALTH_EVOLUTION_RETRIES }
    );
    if (!r.ok) {
      checks.evolution = { status: 'degraded', latency_ms: total_ms, attempts, http_status: r.status };
      errors.push({
        code: 'EVOLUTION_API_ERROR',
        severity: 'warning',
        dependency: 'evolution',
        message: `Evolution API returned HTTP ${r.status} after ${attempts} attempt(s)`,
        detail: { url: EVOLUTION_API_URL, http_status: r.status, attempts },
      });
    } else {
      checks.evolution = { status: 'ok', latency_ms: total_ms, attempts };
    }
  } catch (err) {
    checks.evolution = {
      status: 'degraded',
      error: String(err?.message || err),
      attempts: err.attempts,
      latency_ms: err.total_ms,
    };
    errors.push({
      code: err.timedOut ? 'EVOLUTION_API_TIMEOUT' : 'EVOLUTION_API_UNREACHABLE',
      severity: 'warning',
      dependency: 'evolution',
      message: err.timedOut
        ? `Evolution API did not respond within ${HEALTH_EVOLUTION_TIMEOUT_MS}ms after ${err.attempts} attempt(s)`
        : `Cannot reach Evolution API after ${err.attempts} attempt(s): ${err.message}`,
      detail: {
        url: EVOLUTION_API_URL,
        attempts: err.attempts,
        timeout_ms: HEALTH_EVOLUTION_TIMEOUT_MS,
      },
    });
  }

  // ─── Aggregate ─────────────────────────────────────────────────────────
  const criticalErrors = errors.filter((e) => e.severity === 'critical');
  const warnings = errors.filter((e) => e.severity === 'warning');
  const overallOk = criticalErrors.length === 0;
  const status = !overallOk ? 'down' : warnings.length > 0 ? 'degraded' : 'ok';

  res.status(overallOk ? 200 : 503).json({
    status,
    code: overallOk ? 'HEALTH_OK' : criticalErrors[0].code,
    message: overallOk
      ? warnings.length > 0
        ? `API healthy with ${warnings.length} warning(s)`
        : 'All systems operational'
      : `Health check failed: ${criticalErrors.map((e) => e.code).join(', ')}`,
    uptime_s: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    response_time_ms: Date.now() - startedAt,
    checks,
    errors,
    summary: {
      critical: criticalErrors.length,
      warnings: warnings.length,
      failed_dependencies: [...new Set(errors.map((e) => e.dependency))],
      total_attempts: Object.values(checks).reduce((s, c) => s + (c?.attempts || 0), 0),
    },
    config: {
      db: { timeout_ms: HEALTH_DB_TIMEOUT_MS, retries: HEALTH_DB_RETRIES },
      redis: { timeout_ms: HEALTH_REDIS_TIMEOUT_MS, retries: HEALTH_REDIS_RETRIES },
      evolution: { timeout_ms: HEALTH_EVOLUTION_TIMEOUT_MS, retries: HEALTH_EVOLUTION_RETRIES },
      backoff_ms: HEALTH_RETRY_BACKOFF_MS,
      backoff_max_ms: HEALTH_RETRY_BACKOFF_MAX_MS,
    },
  });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM profiles WHERE id = $1 LIMIT 1', [user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Perfil não encontrado' });

    const profile = rows[0];
    let userRole = user.role || profile.role || 'user';
    let tenantMetadata = {};

    try {
      const { rows: roleRows } = await pool.query(
        'SELECT role FROM user_roles WHERE user_id = $1 LIMIT 1',
        [user.id]
      );
      if (roleRows[0]?.role) userRole = roleRows[0].role;
    } catch (roleError) {
      console.warn('auth/me role lookup failed:', roleError.message);
    }

    if (profile.tenant_id) {
      try {
        const { rows: tenantRows } = await pool.query(
          'SELECT metadata FROM tenants WHERE id = $1 LIMIT 1',
          [profile.tenant_id]
        );
        tenantMetadata = tenantRows[0]?.metadata || {};
      } catch (tenantError) {
        console.warn('auth/me tenant metadata lookup failed:', tenantError.message);
      }
    }

    res.json({
      id: profile.id,
      email: profile.email || user.email,
      name: profile.nome || profile.name || user.email || '',
      role: userRole,
      avatar_url: profile.avatar_url,
      tenant_id: profile.tenant_id || null,
      is_super_admin: !!profile.is_super_admin,
      tenant_features: tenantMetadata?.features || {},
    });
  } catch (error) {
    console.error('auth/me error:', error.message);
    res.status(401).json({ error: 'Não autenticado' });
  }
});

app.post('/api/auth/create-user', async (req, res) => {
  try {
    const { user: actor } = await verifyAdmin(req);
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e senha obrigatórios' });
    if (password.length < 8) return res.status(400).json({ error: 'Senha mínima de 8 caracteres' });
    if (!actor.tenant_id) return res.status(400).json({ error: 'Crie usuários a partir de uma clínica' });

    const { rows: existing } = await pool.query('SELECT id FROM profiles WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.length > 0) return res.status(409).json({ error: 'Email já cadastrado' });

    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 12);
    if (role !== undefined && role !== null && role !== '' && !TENANT_ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Perfil inválido' });
    }
    const userRole = role || 'user';

    await pool.query('INSERT INTO profiles (id, name, email, role, password_hash, tenant_id) VALUES ($1, $2, $3, $4, $5, $6)', [id, name, email.toLowerCase().trim(), userRole, hash, actor.tenant_id]);
    await pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, userRole]);

    res.json({ success: true, user: { id, name, email: email.toLowerCase().trim(), role: userRole } });
  } catch (error) {
    console.error('Create user error:', error.message);
    res.status(httpStatusOf(error)).json({ error: error.message });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Senha mínima de 8 caracteres' });

    const { rows } = await pool.query('SELECT password_hash FROM profiles WHERE id = $1', [user.id]);
    if (rows[0]?.password_hash) {
      // Sem a senha atual, um token roubado bastava para trocar a senha e tomar a conta.
      if (!currentPassword) return res.status(400).json({ error: 'Informe a senha atual' });
      const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Update Profile ─────────────────────────────────────────
app.put('/api/auth/profile', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { name, email } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });

    const updates = ['name = $1', 'updated_at = NOW()'];
    const values = [name.trim()];
    let idx = 2;

    if (email && email.trim()) {
      const normalizedEmail = email.toLowerCase().trim();
      // Check if email is taken by another user
      const { rows: existing } = await pool.query(
        'SELECT id FROM profiles WHERE email = $1 AND id != $2',
        [normalizedEmail, user.id]
      );
      if (existing.length > 0) return res.status(409).json({ error: 'Email já em uso por outro usuário' });
      updates.push(`email = $${idx}`);
      values.push(normalizedEmail);
      idx++;
    }

    values.push(user.id);
    await pool.query(
      `UPDATE profiles SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    // Return updated profile
    const { rows } = await pool.query(
      'SELECT id, name, email, avatar_url, role FROM profiles WHERE id = $1',
      [user.id]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Upload Avatar ──────────────────────────────────────────
app.post('/api/auth/avatar', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { avatar } = req.body; // base64 data URI

    if (!avatar) return res.status(400).json({ error: 'Imagem é obrigatória' });

    // Validate it's an image
    if (!avatar.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Formato inválido. Envie uma imagem.' });
    }

    // Check size (~5MB in base64 ≈ 6.67MB string)
    if (avatar.length > 7 * 1024 * 1024) {
      return res.status(400).json({ error: 'Imagem deve ter no máximo 5MB' });
    }

    const avatarUrl = await saveMediaToDisk(avatar, null, 'avatar.jpg');
    if (!avatarUrl) return res.status(500).json({ error: 'Erro ao salvar imagem' });

    await pool.query(
      'UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
      [avatarUrl, user.id]
    );

    res.json({ avatar_url: avatarUrl });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Forgot Password (notifica admin) ───────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email obrigatório' });

    const { rows } = await pool.query(
      'SELECT id, name FROM profiles WHERE email = $1 LIMIT 1',
      [email.toLowerCase().trim()]
    );

    // Always return success to prevent email enumeration
    if (rows.length === 0) return res.json({ success: true });

    const profile = rows[0];
    console.log(`🔑 [RESET REQUEST] usuário ${profile.id} solicitou recuperação de senha`);

    // Store notification for admin
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
        email TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(
      'INSERT INTO password_reset_requests (user_id, email) VALUES ($1, $2)',
      [profile.id, email.toLowerCase().trim()]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

// ─── Admin: list password reset requests ────────────────────
app.get('/api/auth/reset-requests', async (req, res) => {
  try {
    const { user: actor } = await verifyAdmin(req);
    const scoped = !actor.is_super_admin;
    const { rows } = await pool.query(`
      SELECT r.*, p.name as user_name FROM password_reset_requests r
      JOIN profiles p ON r.user_id = p.id
      ${scoped ? 'WHERE p.tenant_id = $1 AND COALESCE(p.is_super_admin, false) = false' : ''}
      ORDER BY r.created_at DESC LIMIT 50
    `, scoped ? [actor.tenant_id || null] : []);
    res.json(rows);
  } catch (error) {
    res.status(httpStatusOf(error)).json({ error: error.message });
  }
});

// ─── Admin: reset user password ─────────────────────────────
app.post('/api/auth/admin-reset-password', async (req, res) => {
  try {
    const { user: actor } = await verifyAdmin(req);
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: 'userId e newPassword obrigatórios' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Senha mínima de 8 caracteres' });
    await assertCanManageUser(actor, userId);

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, userId]);
    await pool.query("UPDATE password_reset_requests SET status = 'resolved' WHERE user_id = $1 AND status = 'pending'", [userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(httpStatusOf(error)).json({ error: error.message });
  }
});

// ─── Admin: upload avatar for any user ──────────────────────
app.post('/api/auth/users/:userId/avatar', async (req, res) => {
  try {
    const { user: actor } = await verifyAdmin(req);
    const { userId } = req.params;
    const { avatar } = req.body;
    await assertCanManageUser(actor, userId);

    if (!avatar) return res.status(400).json({ error: 'Imagem é obrigatória' });
    if (!avatar.startsWith('data:image/')) return res.status(400).json({ error: 'Formato inválido. Envie uma imagem.' });
    if (avatar.length > 7 * 1024 * 1024) return res.status(400).json({ error: 'Imagem deve ter no máximo 5MB' });

    // Verify user exists
    const { rows: users } = await pool.query('SELECT id FROM profiles WHERE id = $1', [userId]);
    if (users.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

    const avatarUrl = await saveMediaToDisk(avatar, null, 'avatar.jpg');
    if (!avatarUrl) return res.status(500).json({ error: 'Erro ao salvar imagem' });

    await pool.query('UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, userId]);
    res.json({ avatar_url: avatarUrl });
  } catch (error) {
    console.error('Admin avatar upload error:', error.message);
    res.status(httpStatusOf(error)).json({ error: error.message });
  }
});

app.get('/api/auth/users', async (req, res) => {
  try {
    const { user: actor } = await verifyAdmin(req);
    const rows = await listProfilesWithRoles(actor.is_super_admin ? null : (actor.tenant_id || '00000000-0000-0000-0000-000000000000'));
    res.json(rows);
  } catch (error) {
    res.status(httpStatusOf(error)).json({ error: error.message });
  }
});

// ─── Admin: update user ─────────────────────────────────────
app.put('/api/auth/users/:id', async (req, res) => {
  try {
    const { user: actor } = await verifyAdmin(req);
    const { id } = req.params;
    const { name, email, role, active } = req.body;
    await assertCanManageUser(actor, id);
    if (role !== undefined && !TENANT_ASSIGNABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Perfil inválido' });
    }
    if (email !== undefined) {
      const { rows: taken } = await pool.query(
        'SELECT 1 FROM profiles WHERE email = $1 AND id <> $2 LIMIT 1', [String(email).toLowerCase().trim(), id]
      );
      if (taken.length) return res.status(409).json({ error: 'Email já em uso por outro usuário' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (email !== undefined) { updates.push(`email = $${idx++}`); values.push(email.toLowerCase().trim()); }
    if (active !== undefined) { updates.push(`active = $${idx++}`); values.push(active); }
    updates.push(`updated_at = NOW()`);

    values.push(id);
    await pool.query(`UPDATE profiles SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    if (role !== undefined) {
      await pool.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
      await pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
      await pool.query('UPDATE profiles SET role = $1 WHERE id = $2', [role, id]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(httpStatusOf(error)).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// EVOLUTION API PROXY (WhatsApp)
// ═══════════════════════════════════════════════════════════════

const execFileAsync = promisify(execFile);

async function evolutionFetch(path, options = {}) {
  if (!EVOLUTION_API_KEY) {
    return {
      ok: false,
      status: 500,
      data: { error: 'EVOLUTION_API_KEY não configurada no VPS' },
    };
  }

  // Defesa contra "path traversal": um nome de instância como "abc/../outra"
  // seria normalizado pelo fetch para a instância de outra clínica.
  const pathOnly = String(path || '').split('?')[0];
  if (pathOnly.includes('\\') || pathOnly.split('/').some(seg => seg === '..' || seg === '.')) {
    console.warn(`[evolutionFetch] caminho recusado: ${pathOnly.slice(0, 120)}`);
    return { ok: false, status: 400, data: { error: 'Nome de instância inválido' } };
  }
  const url = `${EVOLUTION_API_URL}${path}`;
  const timeoutMs = Number(options.timeoutMs || process.env.EVOLUTION_API_REQUEST_TIMEOUT_MS || 15000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
    const res = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: EVOLUTION_API_KEY,
        ...fetchOptions.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`⚠️ Evolution API ${res.status} for ${path}:`, JSON.stringify(redactWebhookToken(data)).slice(0, 500));
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error(`❌ Evolution fetch error (${path}):`, err.message);
    return { ok: false, status: err.name === 'AbortError' ? 504 : 500, data: { error: err.name === 'AbortError' ? 'Evolution API timeout' : err.message } };
  } finally {
    clearTimeout(timeout);
  }
}

function extractEvolutionConnectionState(data) {
  const state = data?.instance?.state
    || data?.instance?.connectionStatus
    || data?.state
    || data?.connectionStatus
    || data?.status;
  return String(state || '').toLowerCase();
}

async function ensureEvolutionInstanceOpen(instanceName) {
  const result = await evolutionFetch(`/instance/connectionState/${instanceName}`, { timeoutMs: 8000 });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status || 502,
      data: {
        error: 'Não foi possível verificar a conexão do WhatsApp antes do envio.',
        details: result.data,
      },
    };
  }

  const state = extractEvolutionConnectionState(result.data);
  if (state !== 'open') {
    return {
      ok: false,
      status: 409,
      data: {
        error: `WhatsApp não está conectado para envio (estado: ${state || 'desconhecido'}). Reconecte o canal antes de enviar mensagens.`,
        state: state || null,
        details: result.data,
      },
    };
  }

  return { ok: true, status: 200, data: result.data, state };
}

function normalizeWhatsappNumber(value) {
  const digits = String(value || '')
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '')
    .replace(/:\d+$/, '')
    .replace(/\D/g, '');
  
  if (!digits) return '';
  // Prepende 55 (Brasil) se o número tiver 10 ou 11 dígitos e não começar com 55
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) {
    return `55${digits}`;
  }
  return digits;
}

function getWhatsappNumberVariants(value) {
  const normalized = normalizeWhatsappNumber(value);
  if (!normalized) return [];

  const variants = [];
  const add = (candidate) => {
    const digits = normalizeWhatsappNumber(candidate);
    if (digits && !variants.includes(digits)) variants.push(digits);
  };

  const withCountry = !normalized.startsWith('55') && (normalized.length === 10 || normalized.length === 11)
    ? `55${normalized}`
    : normalized;

  // BR mobile numbers migrated from 8 to 9 subscriber digits. A stale CRM lead
  // can still store 55 + DDD + 8 digits (ex.: 556285279808), while WhatsApp only
  // delivers to 55 + DDD + 9 + 8 digits (ex.: 5562985279808). Prefer the modern
  // form for sending, but keep both forms for lookup/reconciliation.
  if (/^55\d{10}$/.test(withCountry) && /^[6-9]/.test(withCountry.slice(4, 5))) {
    add(`${withCountry.slice(0, 4)}9${withCountry.slice(4)}`);
  }

  add(withCountry);

  if (/^55\d{11}$/.test(withCountry) && withCountry[4] === '9') {
    add(`${withCountry.slice(0, 4)}${withCountry.slice(5)}`);
  }

  return variants;
}

function getWhatsappPhoneSuffixVariants(value) {
  return [...new Set(getWhatsappNumberVariants(value).map((candidate) => candidate.slice(-11)).filter(Boolean))];
}

function isUsableWhatsappPhoneNumber(value) {
  const digits = normalizeWhatsappNumber(value);
  // Generic sanity check for identifiers we can reason about. Do not use this
  // alone to decide a value is a sendable phone number: WhatsApp LID values can
  // also be 14-16 digits and some of them start with 55.
  return digits.length >= 10 && digits.length <= 16;
}

function isSendableWhatsappPhoneNumber(value) {
  const digits = normalizeWhatsappNumber(value);
  // Evolution sendText expects the public phone number, not Baileys LID. For BR
  // contacts this is 55 + DDD + 8/9 digits (12-13 total). Values longer than 13
  // are LID-like and must be mapped back to a phone before sending.
  return digits.length >= 10 && digits.length <= 13;
}

function isLikelyLidIdentifier(value) {
  const raw = String(value || '');
  const digits = normalizeWhatsappNumber(raw);
  return raw.includes('@lid') || digits.length > 13;
}

function extractEvolutionMessageId(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const id = extractEvolutionMessageId(item);
      if (id) return id;
    }
    return null;
  }

  const pick = (value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // WhatsApp/Baileys message ids are string-like and normally contain more
      // entropy than wrapper request ids. Avoid accepting plain numeric wrapper
      // ids because ACK correlation then becomes impossible.
      if (trimmed && (!/^\d+$/.test(trimmed) || trimmed.length >= 12)) return trimmed;
    }
    return null;
  };

  const candidates = [
    data?.key?.id,
    data?.message?.key?.id,
    data?.data?.key?.id,
    data?.data?.message?.key?.id,
    data?.response?.key?.id,
    data?.response?.message?.key?.id,
    data?.messageId,
    data?.data?.messageId,
    data?.response?.messageId,
    data?.data?.id,
    data?.response?.id,
    data?.id,
  ];

  for (const candidate of candidates) {
    const id = pick(candidate);
    if (id) return id;
  }
  return null;
}

function getEvolutionErrorMessage(result, fallback = 'Falha ao enviar mensagem') {
  const data = result?.data || {};
  const raw = data?.response?.message?.[0]
    || data?.message
    || data?.error
    || data?.details?.message
    || (result?.status ? `Evolution API respondeu ${result.status}` : fallback);
  const text = Array.isArray(raw) ? raw.join(', ') : String(raw || fallback);
  if (result?.status === 401 || result?.status === 403 || /unauthori[sz]ed|forbidden/i.test(text)) {
    return 'Evolution recusou o envio por autenticação. Verifique a EVOLUTION_API_KEY no .env do VPS e reinicie o odonto-api.';
  }
  return text;
}

function getEvolutionResponseText(data) {
  const responseMessage = data?.response?.message;
  const raw = Array.isArray(responseMessage)
    ? responseMessage.join(' ')
    : responseMessage || data?.message || data?.error || '';
  return String(raw || '');
}

function isEvolutionInstanceAlreadyInUse(result, instanceName) {
  const text = getEvolutionResponseText(result?.data).toLowerCase();
  return result?.status === 403
    && text.includes('already in use')
    && (!instanceName || text.includes(String(instanceName).toLowerCase()));
}

function extractEvolutionStoredMessageRecords(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages?.records)) return data.messages.records;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.data?.records)) return data.data.records;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function getStoredEvolutionMessageStatus(record) {
  const updates = Array.isArray(record?.MessageUpdate) ? record.MessageUpdate : [];
  const latestUpdate = updates.length ? updates[updates.length - 1] : null;
  return latestUpdate?.status
    || latestUpdate?.ack
    || record?.status
    || record?.ack
    || null;
}

async function inspectEvolutionStoredMessage(instance, messageId, remoteJid) {
  if (!messageId) return { found: false, status: null, record: null };

  const where = remoteJid
    ? { key: { remoteJid, id: messageId } }
    : { key: { id: messageId } };

  const result = await evolutionFetch(`/chat/findMessages/${instance}`, {
    method: 'POST',
    timeoutMs: 5000,
    body: JSON.stringify({ where, page: 1, offset: 1 }),
  });

  if (!result.ok) return { found: false, status: null, record: null, error: result.data };
  const records = extractEvolutionStoredMessageRecords(result.data);
  // Some Evolution builds ignore part of the `where` object and return the
  // latest messages for the chat. Never inspect `records[0]` as a fallback: it
  // can belong to an older failed send and make a fresh successful send look
  // like an immediate ERROR.
  const record = records.find((item) => item?.key?.id === messageId) || null;
  return {
    found: !!record,
    status: getStoredEvolutionMessageStatus(record),
    record,
    inspectedCount: records.length,
  };
}

function isLidJid(value) {
  return String(value || '').includes('@lid');
}

function buildLidJid(value) {
  const digits = normalizeWhatsappNumber(value);
  return digits && digits.length >= 10 ? `${digits}@lid` : '';
}

async function getStoredSendTargetCandidates({ instance, leadId, tenantId }) {
  if (!leadId || !tenantId) return [];

  try {
    const { rows } = await pool.query(
      `SELECT phone, metadata
         FROM chat_messages
        WHERE lead_id = $1
          AND tenant_id = $2
          AND ($3 = '' OR instance = $3 OR instance IS NULL)
        ORDER BY timestamp DESC NULLS LAST
        LIMIT 30`,
      [leadId, tenantId, instance || '']
    );

    const candidates = [];
    const addSendableCandidate = (value) => {
      if (!value) return;
      const raw = String(value).trim();
      const digits = normalizeWhatsappNumber(raw);
      if (!digits) return;

      // Do not send to @lid. Evolution/Baileys can accept the request and create
      // a local one-check message that never reaches the patient. When a LID is
      // present, use the phone mapping learned from remoteJidAlt/senderPn instead.
      if (isLikelyLidIdentifier(raw)) {
        const mappedPhone = resolvePhoneFromLid(digits);
        if (mappedPhone && mappedPhone !== digits && isSendableWhatsappPhoneNumber(mappedPhone)) {
          candidates.push(mappedPhone);
        }
        return;
      }

      if (isSendableWhatsappPhoneNumber(digits)) candidates.push(digits);
    };

    for (const row of rows) {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const values = [
        // Prefer phone-number JIDs captured by newer Evolution fields before the
        // primary remoteJid, because the primary field may be an unsendable @lid.
        metadata.remoteJidAlt,
        metadata.senderPn,
        metadata.participantPn,
        metadata.participantAlt,
        row.phone,
        metadata.remoteJid,
      ];

      for (const value of values) {
        addSendableCandidate(value);
      }
    }

    return [...new Set(candidates.filter(Boolean))];
  } catch (err) {
    console.warn('Failed to load stored WhatsApp send target candidates:', err.message);
    return [];
  }
}

async function sendEvolutionTextMessage(instance, cleanNumber, text, quoted = null, context = {}) {
  const rawSubmitted = String(cleanNumber || '').trim();
  const normalizedSubmitted = normalizeWhatsappNumber(rawSubmitted);
  const mappedSubmittedPhone = resolvePhoneFromLid(normalizedSubmitted);
  const submittedNumber = mappedSubmittedPhone && mappedSubmittedPhone !== normalizedSubmitted
    ? normalizeWhatsappNumber(mappedSubmittedPhone)
    : normalizedSubmitted;

  const candidateTargets = [];
  const addCandidate = (value, source = 'number', prefer = false) => {
    const raw = String(value || '').trim();
    const normalized = normalizeWhatsappNumber(raw);
    if (!isUsableWhatsappPhoneNumber(normalized)) return;

    if (isLikelyLidIdentifier(raw)) {
      const mappedPhone = resolvePhoneFromLid(normalized);
      if (!mappedPhone || mappedPhone === normalized) return;
      const mappedDigits = normalizeWhatsappNumber(mappedPhone);
      if (!isSendableWhatsappPhoneNumber(mappedDigits)) return;
      if (candidateTargets.some((candidate) => candidate.target === mappedDigits)) return;
      const candidate = {
        target: mappedDigits,
        normalized: mappedDigits,
        source: `${source}-mapped-from-lid`,
        isLid: false,
      };
      if (prefer) candidateTargets.unshift(candidate);
      else candidateTargets.push(candidate);
      return;
    }

    const target = normalized;
    if (!isSendableWhatsappPhoneNumber(target)) return;
    if (!target || candidateTargets.some((candidate) => candidate.target === target)) return;

    const candidate = {
      target,
      normalized,
      source,
      isLid: isLidJid(target),
    };

    if (prefer) {
      candidateTargets.unshift(candidate);
    } else {
      candidateTargets.push(candidate);
    }
  };

  for (const storedCandidate of await getStoredSendTargetCandidates({
    instance,
    leadId: context.leadId,
    tenantId: context.tenantId,
  })) {
    addCandidate(storedCandidate, 'stored-phone', true);
  }

  // 1) Start with the exact number stored on the conversation. This preserves
  // legacy WhatsApp JIDs that still deliver with 8 subscriber digits. If the
  // submitted value is a LID, addCandidate only accepts it when a prior webhook
  // mapped it back to a public phone number.
  addCandidate(submittedNumber, 'submitted-phone');

  // 2) Try known BR variants (with/without 9th digit). Do not block sending via
  // /chat/whatsappNumbers here: on this Evolution build that endpoint can return
  // false negatives/canonical JIDs that accept the request but never deliver.
  // The send endpoint is the source of truth; failed attempts are surfaced below.
  // than forcing a single transformation because Evolution/Baileys deployments
  // disagree on whether old contacts deliver with the legacy or modern JID.
  if (isSendableWhatsappPhoneNumber(submittedNumber)) {
    for (const variant of getWhatsappNumberVariants(submittedNumber)) addCandidate(variant, 'br-variant');
  }

  if (candidateTargets.length === 0) {
    return {
      ok: false,
      status: 400,
      data: {
        error: isLikelyLidIdentifier(rawSubmitted)
          ? 'Esta conversa está identificada por LID (@lid), mas o backend ainda não encontrou um telefone comum no histórico. Importe/receba uma mensagem recente do contato para capturar remoteJidAlt/senderPn antes de enviar.'
          : 'Não foi possível resolver um número WhatsApp comum para esta conversa.',
        checkedNumber: cleanNumber,
        targetNumber: submittedNumber,
      },
    };
  }

  let lastResult = null;
  const attempted = [];

  for (const candidate of candidateTargets) {
    const targetNumber = candidate.target;
    const targetRemoteJid = candidate.isLid ? targetNumber : `${candidate.normalized}@s.whatsapp.net`;
    const persistedSentNumber = candidate.isLid ? submittedNumber : candidate.normalized;
    const normalizedQuoted = quoted?.key?.id
      ? {
          ...quoted,
          key: {
            ...quoted.key,
            remoteJid: quoted.key.remoteJid && !String(quoted.key.remoteJid).includes('@g.us')
              ? targetRemoteJid
              : quoted.key.remoteJid,
          },
        }
      : quoted;

    const basePayload = {
      number: targetNumber,
      delay: 800,
      linkPreview: true,
      ...(normalizedQuoted ? { quoted: normalizedQuoted } : {}),
    };

    const payloads = [
      { label: 'text', body: { ...basePayload, text } },
      // Fallback for Evolution builds that follow the newer documented v2 schema.
      { label: 'textMessage', body: { ...basePayload, textMessage: { text } } },
    ];

    for (const payload of payloads) {
      const result = await evolutionFetch(`/message/sendText/${instance}`, {
        method: 'POST',
        body: JSON.stringify(payload.body),
      });
      lastResult = result;
      attempted.push({ number: targetNumber, source: candidate.source, format: payload.label, status: result.status, ok: result.ok });

      console.log(`📤 sendText attempt ${instance}`, {
        numberLength: targetNumber.length,
        numberSuffix: targetNumber.slice(-4),
        source: candidate.source,
        format: payload.label,
        httpStatus: result.status,
        ok: result.ok,
        key: getCredentialDebugMeta(EVOLUTION_API_KEY),
      });

      if (result.ok) {
        const messageId = extractEvolutionMessageId(result.data);
        if (!messageId) {
          // Algumas versões da Evolution respondem HTTP 200 para o payload aceito
          // pelo endpoint, mas sem key.id quando o formato do corpo não gerou uma
          // mensagem real. Isso NÃO deve encerrar o loop.
          console.warn(`⚠️ sendText ${instance}: OK sem message id; tentando próximo formato/número`, {
            targetNumber,
            format: payload.label,
            response: JSON.stringify(result.data || {}).slice(0, 500),
          });
          continue;
        }

        // Evolution/Baileys writes the message store asynchronously. Immediately
        // after send, ACK/CLOCK can still be represented as status 0/ERROR on
        // some Evolution builds. Do not second-guess a 201 + key.id response;
        // later webhook ACK updates are responsible for marking true failures.
        if (result.status === 201) {
          return {
            ...result,
            data: { ...result.data, key: { ...(result.data?.key || {}), id: messageId }, sentNumber: persistedSentNumber, sentTarget: targetNumber, attempted },
          };
        }

        // For non-201 OK responses, keep a defensive inspection, but only when
        // the exact message id is found; inspectEvolutionStoredMessage never
        // falls back to unrelated records.
        const stored = await inspectEvolutionStoredMessage(instance, messageId, targetRemoteJid).catch((err) => ({
          found: false,
          status: null,
          error: err?.message,
        }));
        const storedStatus = normalizeEvolutionAckStatus(stored?.status);
        attempted[attempted.length - 1] = {
          ...attempted[attempted.length - 1],
          messageId,
          storedStatus: stored?.status || null,
        };
        if (stored?.found && storedStatus === 'failed') {
          lastResult = {
            ok: false,
            status: 502,
            data: {
              error: 'Evolution gerou a mensagem, mas marcou o envio como ERROR imediatamente.',
              key: { id: messageId },
              sentNumber: persistedSentNumber,
              sentTarget: targetNumber,
              attempted,
              storedStatus: stored?.status || null,
            },
          };
          console.warn(`❌ sendText ${instance}: Evolution marcou ERROR para ${messageId}; tentando próxima variante`, {
            targetNumber,
            format: payload.label,
          });
          continue;
        }

        return {
          ...result,
          data: { ...result.data, key: { ...(result.data?.key || {}), id: messageId }, sentNumber: persistedSentNumber, sentTarget: targetNumber, attempted },
        };
      }

      const errorText = JSON.stringify(result.data || {}).toLowerCase();
      const canRetryPayloadShape = result.status === 400
        || errorText.includes('textmessage')
        || errorText.includes('text message')
        || errorText.includes('required')
        || errorText.includes('validation');
      if (!canRetryPayloadShape) {
        // Auth, missing instance, disconnected instance, and server errors are
        // not fixed by changing the message body. Stop fast and surface it.
        break;
      }
    }

    const lastErrorText = JSON.stringify(lastResult?.data || {}).toLowerCase();
    const canRetryNumber = lastResult?.ok
      || lastResult?.status === 400
      || lastErrorText.includes('jid')
      || lastErrorText.includes('number')
      || lastErrorText.includes('not found')
      || lastErrorText.includes('exists')
      || lastErrorText.includes('valid');
    if (!canRetryNumber && lastResult) break;
  }

  if (lastResult?.ok && !extractEvolutionMessageId(lastResult.data)) {
    return {
      ok: false,
      status: 502,
      data: {
        error: 'Evolution aceitou a requisição, mas não retornou o id real da mensagem.',
        attempted,
        lastResponse: lastResult.data,
      },
    };
  }

  if (lastResult?.data && attempted.length > 0) {
    return {
      ...lastResult,
      data: {
        ...lastResult.data,
        attempted,
      },
    };
  }

  return lastResult || { ok: false, status: 502, data: { error: 'Falha ao enviar mensagem', attempted } };
}

function extractEvolutionInstanceName(body) {
  const candidates = [
    body?.instanceName,
    body?.instance,
    body?.instance?.instanceName,
    body?.instance?.name,
    body?.data?.instanceName,
    body?.data?.instance,
    body?.data?.instance?.instanceName,
    body?.data?.instance?.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  return '';
}

function normalizeEvolutionEventName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\./g, '_');
}

function isEvolutionEvent(event, ...names) {
  const normalized = normalizeEvolutionEventName(event);
  return names.some((name) => normalizeEvolutionEventName(name) === normalized);
}

function extractEvolutionMessages(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages?.records)) return data.messages.records;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.data?.records)) return data.data.records;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result?.records)) return data.result.records;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.message)) return data.message;
  if (Array.isArray(data?.records)) return data.records;
  if (data?.message?.key) return [data.message];
  if (data?.key) return [data];
  return [];
}

function extractEvolutionArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages?.records)) return data.messages.records;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.contacts?.records)) return data.contacts.records;
  if (Array.isArray(data?.contacts)) return data.contacts;
  if (Array.isArray(data?.data?.records)) return data.data.records;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.result?.records)) return data.result.records;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.records)) return data.records;
  return [];
}

function isUsableChatJid(jid) {
  const raw = String(jid || '');
  if (!raw || !raw.includes('@')) return false;
  if (
    raw.endsWith('@g.us') ||
    raw.endsWith('@broadcast') ||
    raw.endsWith('@newsletter') ||
    raw.includes('status@')
  ) return false;
  // LIDs are not directly usable as patient phone numbers in the CRM/chat list.
  if (raw.endsWith('@lid')) return false;
  const digits = normalizeWhatsappNumber(raw);
  return digits.length >= 10 && digits.length <= 13;
}

function extractActualRemoteJidFromMessage(msg) {
  const key = msg?.key || {};
  const primary = typeof key.remoteJid === 'string' ? key.remoteJid : '';
  const candidates = [
    key.remoteJidAlt,
    key.participantAlt,
    key.senderPn,
    key.participantPn,
    key.remoteJid,
    msg?.remoteJidAlt,
    msg?.participantAlt,
    msg?.senderPn,
    msg?.participantPn,
    msg?.remoteJid,
  ].filter((value) => typeof value === 'string' && value.includes('@'));

  if (primary.includes('@lid')) {
    const realJid = candidates.find(isUsableChatJid);
    if (realJid) return realJid;
  }

  return primary || candidates[0] || '';
}

function rememberLidMappingFromMessage(msg, resolvedRemoteJid) {
  const rawRemoteJid = msg?.key?.remoteJid;
  if (!rawRemoteJid?.includes?.('@lid') || !isUsableChatJid(resolvedRemoteJid)) return;

  const lidNumber = normalizeWhatsappNumber(rawRemoteJid);
  const phoneNumber = normalizeWhatsappNumber(resolvedRemoteJid);
  if (lidNumber && phoneNumber && lidNumber !== phoneNumber) {
    registerLidMapping(lidNumber, phoneNumber);
    console.log(`🔗 LID mapped from message → ${maskPhone(phoneNumber)}`);
  }
}

function parseEvolutionTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && value.trim() !== '') return parseEvolutionTimestamp(asNumber);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object') {
    // Some Baileys builds serialize protobuf Long as { low, high }.
    if (typeof value.low === 'number') return parseEvolutionTimestamp(value.low);
    if (typeof value.low === 'string') return parseEvolutionTimestamp(value.low);
  }
  return null;
}

function extractMessageTimestamp(msg) {
  return parseEvolutionTimestamp(
    msg?.messageTimestamp ||
    msg?.timestamp ||
    msg?.createdAt ||
    msg?.created_at ||
    msg?.dateTime
  );
}

function extractMessageContentAndType(msg) {
  const m = msg?.message || msg?.messageData || {};
  let content = '';
  let type = 'text';
  let fileName = null;
  let mimeType = null;

  if (m.conversation) content = m.conversation;
  else if (m.extendedTextMessage?.text) content = m.extendedTextMessage.text;
  else if (m.imageMessage) { type = 'image'; content = m.imageMessage.caption || '📷 Imagem'; mimeType = m.imageMessage.mimetype || null; }
  else if (m.videoMessage) { type = 'video'; content = m.videoMessage.caption || '🎥 Vídeo'; mimeType = m.videoMessage.mimetype || null; }
  else if (m.audioMessage) { type = 'audio'; content = '🎵 Áudio'; mimeType = m.audioMessage.mimetype || null; }
  else if (m.documentMessage) { type = 'document'; content = m.documentMessage.fileName || m.documentMessage.caption || '📄 Documento'; fileName = m.documentMessage.fileName || null; mimeType = m.documentMessage.mimetype || null; }
  else if (m.stickerMessage) { type = 'sticker'; content = '🏷️ Sticker'; mimeType = m.stickerMessage.mimetype || null; }
  else if (m.contactMessage) { type = 'contact'; content = `👤 ${m.contactMessage.displayName || 'Contato'}`; }
  else if (m.contactsArrayMessage) { type = 'contact'; content = '👥 Contatos'; }
  else if (m.locationMessage) { type = 'location'; content = '📍 Localização'; }
  else if (m.reactionMessage) { type = 'reaction'; content = m.reactionMessage.text || '👍 Reação'; }
  else if (m.buttonsResponseMessage) content = m.buttonsResponseMessage.selectedDisplayText || m.buttonsResponseMessage.selectedButtonId || '';
  else if (m.listResponseMessage) content = m.listResponseMessage.title || m.listResponseMessage.singleSelectReply?.selectedRowId || '';
  else if (m.templateButtonReplyMessage) content = m.templateButtonReplyMessage.selectedDisplayText || m.templateButtonReplyMessage.selectedId || '';
  else if (m.protocolMessage || m.senderKeyDistributionMessage || msg?.messageStubType) return null;
  else content = '[Mensagem não suportada]';

  if (!content) return null;
  return { content, type, fileName, mimeType };
}

async function ensureLeadForWhatsAppConversation({ tenantId, phone, name }) {
  if (!tenantId || !phone) return null;
  const suffix = normalizeWhatsappNumber(phone).slice(-11);
  const displayName = String(name || phone).trim() || phone;

  const { rows } = await pool.query(
    `SELECT id, nome as name, telefone as phone, queue_id, queue_name, awaiting_queue_selection, avatar_url
       FROM crm_leads
      WHERE tenant_id = $1
        AND REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') LIKE '%' || $2
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1`,
    [tenantId, suffix]
  );
  if (rows[0]) return rows[0];

  const id = randomUUID();
  await pool.query(
    `INSERT INTO crm_leads (id, nome, telefone, origem, status, kanban_stage, awaiting_queue_selection, tenant_id)
     VALUES ($1, $2, $3, 'whatsapp', 'novo', 'lead', false, $4)`,
    [id, displayName, phone, tenantId]
  );
  return { id, name: displayName, phone, queue_id: null, queue_name: null, awaiting_queue_selection: false, avatar_url: null };
}

const presenceStateCache = new Map();
const webhookEnsureTimestamps = new Map();
const mediaSendJobs = new Map();

// ─── LID ↔ Phone mapping ───────────────────────────────────
// WhatsApp uses Linked IDs (@lid) internally. Presence updates arrive with LIDs,
// but our leads are stored by phone number. We build this map dynamically.
const lidToPhoneMap = new Map(); // lid_number → phone_number
const phoneToLidMap = new Map(); // phone_number → lid_number

function registerLidMapping(lid, phone) {
  if (!lid || !phone || lid === phone) return;
  lidToPhoneMap.set(lid, phone);
  phoneToLidMap.set(phone, lid);
}

function resolvePhoneFromLid(lidOrPhone) {
  return lidToPhoneMap.get(lidOrPhone) || lidOrPhone;
}

// Resolve LID→phone by calling Evolution API whatsappNumbers
async function resolveLidForPhone(instance, phone) {
  try {
    const result = await evolutionFetch(`/chat/whatsappNumbers/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ numbers: [phone] }),
    });
    console.log(`🔍 whatsappNumbers response for ${maskPhone(phone)}: status=${result.status}`);
    if (result.ok && Array.isArray(result.data)) {
      for (const entry of result.data) {
        const jid = entry?.jid || entry?.id || '';
        const lid = entry?.lid || '';
        // Extract LID number
        const lidNum = normalizeWhatsappNumber(lid) || (jid.includes('@lid') ? normalizeWhatsappNumber(jid) : '');
        if (lidNum && lidNum.length >= 10) {
          registerLidMapping(lidNum, phone);
          console.log(`🔗 LID mapped → ${maskPhone(phone)}`);
          return lidNum;
        }
      }
    }
    // Fallback: try findContacts to get LID mapping
    try {
      const contactResult = await evolutionFetch(`/chat/findContacts/${instance}`, {
        method: 'POST',
        body: JSON.stringify({ where: { id: `${phone}@s.whatsapp.net` } }),
      });
      if (contactResult.ok && Array.isArray(contactResult.data)) {
        for (const c of contactResult.data) {
          const cLid = c?.lid || '';
          const lidNum = normalizeWhatsappNumber(cLid);
          if (lidNum && lidNum.length >= 10) {
            registerLidMapping(lidNum, phone);
            console.log(`🔗 LID mapped (findContacts) → ${maskPhone(phone)}`);
            return lidNum;
          }
        }
      }
    } catch (e2) { /* ignore findContacts fallback error */ }
  } catch (err) {
    console.error(`LID resolve error for ${maskPhone(phone)}:`, err.message);
  }
  return null;
}

// In-memory cache: instance|number → { exists, canonical, checkedAt }
const whatsappNumberValidationCache = new Map();
const WA_NUMBER_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Validates a Brazilian WhatsApp number against Evolution's /chat/whatsappNumbers
 * to avoid "silent send" — accepted by Evolution but never delivered because the
 * JID doesn't exist (typical for old 8-digit mobiles missing the leading 9).
 * Returns { exists, canonical } where canonical is the JID number WhatsApp knows.
 */
async function resolveValidWhatsAppNumber(instance, cleanNumber) {
  const cacheKey = `${instance}|${cleanNumber}`;
  const cached = whatsappNumberValidationCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < WA_NUMBER_CACHE_TTL_MS) {
    return { exists: cached.exists, canonical: cached.canonical };
  }

  const candidates = getWhatsappNumberVariants(cleanNumber);
  const preferredMobileCandidate = candidates.length > 1 && candidates[0] !== cleanNumber
    ? candidates[0]
    : null;

  const normalizeResultNumber = (entry) => {
    const raw = entry?.jid || entry?.number || entry?.id || '';
    if (String(raw).includes('@lid')) return '';
    const digits = normalizeWhatsappNumber(raw);
    return isUsableWhatsappPhoneNumber(digits) ? digits : '';
  };
  const normalizeSubmittedNumber = (entry) => {
    const raw = entry?.number || entry?.input || entry?.jid || entry?.id || '';
    const digits = normalizeWhatsappNumber(raw);
    return isUsableWhatsappPhoneNumber(digits) ? digits : '';
  };
  const pickResult = (entries) => {
    const existing = entries.filter((entry) => normalizeResultNumber(entry) && (entry?.exists === true || entry?.jid || entry?.number || entry?.id));
    if (preferredMobileCandidate) {
      const preferredHit = existing.find((entry) => normalizeResultNumber(entry) === preferredMobileCandidate && entry?.exists !== false);
      if (preferredHit) return preferredHit;
    }
    return existing.find((entry) => entry?.exists === true)
      || existing.find((entry) => entry?.exists !== false)
      || null;
  };

  try {
    const result = await evolutionFetch(`/chat/whatsappNumbers/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ numbers: candidates }),
    });

    if (result.ok && Array.isArray(result.data)) {
      if (preferredMobileCandidate) {
        const preferredEntry = result.data.find((entry) =>
          normalizeSubmittedNumber(entry) === preferredMobileCandidate || normalizeResultNumber(entry) === preferredMobileCandidate
        );
        if (preferredEntry && preferredEntry.exists !== false) {
          const canonical = normalizeResultNumber(preferredEntry) || preferredMobileCandidate;
          whatsappNumberValidationCache.set(cacheKey, { exists: true, canonical, checkedAt: Date.now() });
          return { exists: true, canonical };
        }
      }

      const hit = pickResult(result.data);
      if (hit) {
        const jidNum = normalizeResultNumber(hit);
        const canonical = jidNum || cleanNumber;
        const exists = hit.exists !== false;
        whatsappNumberValidationCache.set(cacheKey, { exists, canonical, checkedAt: Date.now() });
        return { exists, canonical };
      }
      // Empty array or no hit → number not on WhatsApp
      whatsappNumberValidationCache.set(cacheKey, { exists: false, canonical: cleanNumber, checkedAt: Date.now() });
      return { exists: false, canonical: cleanNumber };
    }
  } catch (err) {
    console.warn(`⚠️ whatsappNumbers check failed for ${maskPhone(cleanNumber)}:`, err.message);
  }

  // Failure to validate → don't block, but do not invent a destination number.
  // The installed Evolution build can return `number=55..9..` while the real JID
  // remains `55..8..`; forcing the invented 9-digit value makes sends disappear.
  return { exists: true, canonical: cleanNumber };
}

async function ensureWebhookRegistration(instanceName) {
  const lastEnsure = webhookEnsureTimestamps.get(instanceName) || 0;
  if (Date.now() - lastEnsure < 5 * 60 * 1000) return { ok: true, cached: true };
  const result = await registerWebhook(instanceName);
  if (!result?.ok) {
    // O webhook é necessário para receber respostas/ACKs, mas não pode bloquear
    // o envio. Em algumas versões da Evolution o /webhook/set retorna formato
    // inesperado mesmo mantendo a instância apta a enviar mensagens.
    console.warn(`⚠️ Webhook não confirmado para ${instanceName}; envio seguirá mesmo assim.`, result?.data || result?.error || 'sem detalhes');
    return result || { ok: false, error: 'Webhook não registrado' };
  }
  if (result.verified === false) {
    // Não grave cache quando a Evolution respondeu 200 mas /webhook/find não
    // confirmou a URL atual. Esse era o cenário em que o envio até podia sair,
    // porém respostas/ACKs não voltavam para o Chat.
    console.warn(`⚠️ Webhook set retornou OK, mas a URL atual não foi verificada para ${instanceName}; tentativa será repetida no próximo ciclo.`);
    return result;
  }
  webhookEnsureTimestamps.set(instanceName, Date.now());
  return result;
}

function cleanBase64Media(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  const withoutPrefix = trimmed.startsWith('data:') && trimmed.includes(',')
    ? trimmed.split(',')[1]
    : trimmed;
  return withoutPrefix.replace(/\s/g, '');
}

function getAudioInputExtension(mimeType) {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('aac') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  return 'webm';
}

async function transcodeAudioToWhatsAppOgg(base64Audio, mimeType) {
  const workDir = await mkdtemp(path.join(tmpdir(), 'odonto-audio-'));
  const inputPath = path.join(workDir, `input.${getAudioInputExtension(mimeType)}`);
  const outputPath = path.join(workDir, 'output.ogg');

  try {
    await writeFile(inputPath, Buffer.from(base64Audio, 'base64'));
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '1',
      outputPath,
    ], { maxBuffer: 20 * 1024 * 1024 });

    const transcodedBuffer = await readFile(outputPath);
    return {
      base64: transcodedBuffer.toString('base64'),
      mimeType: 'audio/ogg',
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function toPublicMediaUrl(mediaPath) {
  if (!mediaPath) return null;
  if (/^https?:\/\//i.test(mediaPath)) return mediaPath;
  const backendOrigin = (
    process.env.BACKEND_PUBLIC_URL
    || process.env.API_PUBLIC_URL
    || process.env.VPS_API_PUBLIC_URL
    || 'https://backend.odontoconnect.tech'
  ).replace(/\/$/, '').replace(/\/api$/, '');
  return `${backendOrigin}${mediaPath.startsWith('/') ? '' : '/'}${mediaPath}`;
}

function extractEvolutionErrorMessage(data) {
  const responseMessage = data?.response?.message;
  if (Array.isArray(responseMessage)) return responseMessage[0];
  return responseMessage || data?.error || data?.message || null;
}

function friendlyEvolutionErrorMessage(data, fallback = 'Falha ao enviar mídia') {
  const message = String(extractEvolutionErrorMessage(data) || fallback);
  if (/unauthorized|forbidden|api\s*key|apikey|401|403/i.test(message)) {
    return 'Evolution recusou o envio. Verifique se a instância do WhatsApp está conectada e se a EVOLUTION_API_KEY do VPS está correta.';
  }
  return message;
}

async function sendWhatsAppAudioWithFallback(instance, cleanNumber, base64Audio, mimeType, fileName, publicMediaUrl = null) {
  const sourceMime = String(mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  const originalBase64 = cleanBase64Media(base64Audio);

  if (!originalBase64 || originalBase64.length < 10) {
    return {
      ok: false,
      status: 400,
      data: { error: 'Áudio inválido ou vazio' },
    };
  }

  let outgoingMime = sourceMime;
  let outgoingBase64 = originalBase64;

  try {
    const transcoded = await transcodeAudioToWhatsAppOgg(originalBase64, sourceMime);
    outgoingBase64 = transcoded.base64;
    outgoingMime = transcoded.mimeType;
  } catch (transcodeError) {
    console.error('Audio transcode failed, falling back to original payload:', transcodeError.message);
  }

  const dataUriAudio = `data:${outgoingMime};base64,${outgoingBase64}`;
  const normalizedFileName = fileName || `audio-${Date.now()}.${outgoingMime.includes('ogg') ? 'ogg' : 'webm'}`;
  let audioUrl = publicMediaUrl;

  if (!audioUrl) {
    const savedAudioPath = await saveMediaToDisk(outgoingBase64, outgoingMime, normalizedFileName);
    audioUrl = toPublicMediaUrl(savedAudioPath);
  }

  const attempts = [
    ...(audioUrl ? [
      {
        label: 'sendWhatsAppAudio-url',
        path: `/message/sendWhatsAppAudio/${instance}`,
        body: {
          number: cleanNumber,
          audio: audioUrl,
          delay: 1200,
        },
      },
      {
        label: 'sendMedia-audio-url-flat',
        path: `/message/sendMedia/${instance}`,
        body: {
          number: cleanNumber,
          mediatype: 'audio',
          mimetype: outgoingMime,
          fileName: normalizedFileName,
          media: audioUrl,
          delay: 1200,
        },
      },
    ] : []),
    {
      label: 'sendWhatsAppAudio-base64',
      path: `/message/sendWhatsAppAudio/${instance}`,
      body: {
        number: cleanNumber,
        audio: outgoingBase64,
        delay: 1200,
        mimetype: outgoingMime,
      },
    },
    {
      label: 'sendWhatsAppAudio-datauri',
      path: `/message/sendWhatsAppAudio/${instance}`,
      body: {
        number: cleanNumber,
        audio: dataUriAudio,
        delay: 1200,
        mimetype: outgoingMime,
      },
    },
    {
      label: 'sendWhatsAppAudio-audioMessage',
      path: `/message/sendWhatsAppAudio/${instance}`,
      body: {
        number: cleanNumber,
        audioMessage: {
          audio: dataUriAudio,
          mimetype: outgoingMime,
        },
        options: {
          delay: 1200,
          presence: 'recording',
          encoding: true,
        },
      },
    },
    {
      label: 'sendMedia-audio-flat',
      path: `/message/sendMedia/${instance}`,
      body: {
        number: cleanNumber,
        mediatype: 'audio',
        mimetype: outgoingMime,
        fileName: normalizedFileName,
        media: dataUriAudio,
        delay: 1200,
      },
    },
    {
      label: 'sendMedia-audio-message',
      path: `/message/sendMedia/${instance}`,
      body: {
        number: cleanNumber,
        mediaMessage: {
          mediaType: 'audio',
          mimetype: outgoingMime,
          fileName: normalizedFileName,
          media: dataUriAudio,
        },
        options: { delay: 1200, presence: 'recording' },
      },
    },
  ];

  let lastResult = null;
  for (const attempt of attempts) {
    console.log(`📤 audio send trying ${attempt.label}, payload size: ${JSON.stringify(attempt.body).length} bytes`);
    lastResult = await evolutionFetch(attempt.path, {
      method: 'POST',
      body: JSON.stringify(attempt.body),
    });

    console.log(`📤 audio send result ${attempt.label} ok=${lastResult.ok} status=${lastResult.status}`);
    if (lastResult.ok) return lastResult;

    const errMsg = extractEvolutionErrorMessage(lastResult.data);
    console.error(`❌ audio send failed ${attempt.label}: ${errMsg || `HTTP ${lastResult.status}`}`);
  }

  return lastResult || {
    ok: false,
    status: 502,
    data: { error: 'Falha ao enviar áudio' },
  };
}

// List instances
// ─── Isolamento de instâncias do WhatsApp por clínica ─────────────────────
// Dono "estrito" de uma instância: só o mapeamento gravado em whatsapp_instances
// ou o prefixo do tenant no nome (`<tenant_id[0:8]>-...`). Diferente de
// getTenantIdByInstance, nunca cria mapeamento nem usa heurísticas por telefone.
async function getStrictInstanceOwner(instanceName) {
  if (!instanceName) return null;
  try {
    const { rows } = await pool.query(
      'SELECT tenant_id FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1',
      [instanceName]
    );
    if (rows[0]?.tenant_id) return String(rows[0].tenant_id);
  } catch (e) {
    console.error('[wa-owner] lookup failed:', e.message);
  }
  return null;
}

function instanceNameMatchesTenantPrefix(instanceName, tenantId) {
  if (!instanceName || !tenantId) return false;
  return String(instanceName).toLowerCase().startsWith(`${String(tenantId).slice(0, 8).toLowerCase()}-`);
}

async function userOwnsInstance(user, instanceName) {
  if (!user) return false;
  if (user.is_super_admin) return true;
  if (!user.tenant_id) return false;
  const owner = await getStrictInstanceOwner(instanceName);
  if (owner) return owner === String(user.tenant_id);
  return instanceNameMatchesTenantPrefix(instanceName, user.tenant_id);
}

// Rotas /api/whatsapp/<ação>/:instance (o nome vem no caminho)
const WA_PATH_INSTANCE_ACTIONS = new Set([
  'connect', 'sync-chat', 'state', 'logout', 'instances', 'restart', 'register-webhook', 'webhook',
]);

// Nome de instância aceitável: sem barra, contrabarra, "..", ?, #, % ou controle.
function isSafeInstanceName(name) {
  const v = String(name || '');
  return v.length > 0 && v.length <= 100 && !v.includes('..') && !/[\/\\?#%\u0000-\u001f]/.test(v);
}

function extractWhatsAppInstanceFromRequest(req) {
  const parts = String(req.path || '').split('/').filter(Boolean); // relativo a /api/whatsapp
  // Listar/criar instância: a rota aplica o prefixo do tenant ao nome novo.
  if (parts.length === 1 && parts[0] === 'instances') return null;
  // Status de job de mídia: checado na própria rota pelo tenant do job.
  if (parts[0] === 'send-media-status') return null;
  if (parts.length >= 2 && WA_PATH_INSTANCE_ACTIONS.has(parts[0])) {
    // req.path ainda vem codificado; parts.length > 2 indica "/" extra no nome
    if (parts.length > 2) return { invalid: true };
    try { return decodeURIComponent(parts[1]); } catch { return { invalid: true }; }
  }
  const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
  const names = [body.instance, body.newInstance, body.instanceName, req.query?.instance]
    .filter(v => v !== undefined && v !== null && v !== '');
  if (!names.length) return null;
  return names.length === 1 ? names[0] : { many: names };
}

// Garante que a clínica do usuário é dona da instância usada em QUALQUER rota
// /api/whatsapp/*. Sem isso, um usuário de uma clínica podia conectar, importar
// conversas, desconectar ou enviar pelo número de outra clínica.
app.use('/api/whatsapp', async (req, res, next) => {
  const extracted = extractWhatsAppInstanceFromRequest(req);
  if (!extracted) return next();
  const instanceNames = typeof extracted === 'string' ? [extracted] : (extracted.many || []);
  if (!instanceNames.length || instanceNames.some(n => typeof n !== 'string' || !isSafeInstanceName(n))) {
    return res.status(400).json({ error: 'Nome de instância inválido' });
  }
  const instanceName = instanceNames.join(',');
  try {
    const { user } = await verifyUser(req);
    let allOwned = true;
    for (const n of instanceNames) {
      if (!(await userOwnsInstance(user, n))) { allOwned = false; break; }
    }
    if (allOwned) return next();
    console.warn(`[wa-guard] bloqueado: user=${user?.id} tenant=${user?.tenant_id} instance=${instanceName} ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Este número de WhatsApp não pertence à sua clínica.' });
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
});

app.get('/api/whatsapp/instances', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const result = await evolutionFetch('/instance/fetchInstances');
    
    let instances = extractEvolutionArray(result.data);
    
    // Isolation by tenant
    let mappedInstanceNames = new Set();
    if (!user.is_super_admin && user.tenant_id) {
      const prefix = user.tenant_id.substring(0, 8);
      try {
        const { rows } = await pool.query(
          `SELECT instance_name
             FROM whatsapp_instances
            WHERE tenant_id = $1`,
          [user.tenant_id]
        );
        mappedInstanceNames = new Set(rows.map((row) => row.instance_name).filter(Boolean));
      } catch (err) {
        console.warn('Failed to load tenant WhatsApp instance mappings:', err.message);
      }

      instances = instances.filter(i => {
        const name = i.name || i.instanceName || i.instance?.instanceName || "";
        return name.startsWith(prefix) || mappedInstanceNames.has(name);
      });
    }

    // Safety net: re-ensure webhook registration for every connected instance
    // so incoming/outgoing messages always reach our /api/webhook/evolution endpoint.
    // ensureWebhookRegistration is internally throttled (5 min) per instance.
    for (const inst of instances) {
      const name = inst.name || inst.instanceName || inst.instance?.instanceName;
      const status = inst.connectionStatus || inst.status || inst.instance?.status || inst.instance?.state;
      if (name && user.tenant_id && (name.startsWith(user.tenant_id.substring(0, 8)) || mappedInstanceNames.has(name))) {
        await pool.query(
          `INSERT INTO whatsapp_instances (instance_name, tenant_id)
           VALUES ($1, $2)
           ON CONFLICT (instance_name) DO UPDATE SET tenant_id = $2`,
          [name, user.tenant_id]
        ).catch(e => console.error('Failed to refresh instance mapping locally:', e.message));
        setCachedTenantId(name, user.tenant_id);
      }
      if (name && status === 'open') {
        ensureWebhookRegistration(name).catch(() => {});
      }
    }

    res.json(instances);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Create instance (+ auto-register webhook)
app.post('/api/whatsapp/instances', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { instanceName } = req.body || {};
    if (!instanceName || typeof instanceName !== 'string' || !isSafeInstanceName(instanceName)) {
      return res.status(400).json({ error: 'Nome do número inválido. Use letras, números, hífen ou sublinhado.' });
    }
    
    // Isolation: prepend tenant prefix if not present
    let finalName = instanceName;
    if (user.tenant_id) {
      const prefix = user.tenant_id.substring(0, 8);
      if (!finalName.startsWith(prefix)) {
        finalName = `${prefix}-${finalName}`;
      }
    }

    const result = await evolutionFetch('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: finalName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      }),
    });

    if (!result.ok) {
      console.error(`❌ Evolution API instance creation failed:`, result.data);
      if (isEvolutionInstanceAlreadyInUse(result, finalName)) {
        console.warn(`ℹ️ Instance ${finalName} already exists in Evolution; reusing it and opening QR connection.`);

        if (user.tenant_id) {
          await pool.query(
            `INSERT INTO whatsapp_instances (instance_name, tenant_id)
             VALUES ($1, $2)
             ON CONFLICT (instance_name) DO UPDATE SET tenant_id = $2`,
            [finalName, user.tenant_id]
          ).catch(e => console.error('Failed to save existing instance mapping locally:', e.message));

          setCachedTenantId(finalName, user.tenant_id);
        }

        await registerWebhook(finalName);

        return res.json({
          reused: true,
          instanceName: finalName,
          instance: { instanceName: finalName },
          message: 'Instância já existia; reutilizando para conexão.',
        });
      }

      // Special case: 403 Forbidden may mean API Key is wrong, unless Evolution
      // explicitly says the requested instance name already exists (handled above).
      if (result.status === 403) {
         return res.status(403).json({ error: "Evolution API Unauthorized (403). Verifique a EVOLUTION_API_KEY no .env do VPS." });
      }
      return res.status(result.status || 500).json({ 
        error: result.data?.message || "Erro na Evolution API ao criar instância",
        details: result.data 
      });
    }

    if (result.ok && user.tenant_id) {
      // Save mapping locally for webhook resolution
      await pool.query(
        `INSERT INTO whatsapp_instances (instance_name, tenant_id) 
         VALUES ($1, $2) 
         ON CONFLICT (instance_name) DO UPDATE SET tenant_id = $2`,
        [finalName, user.tenant_id]
      ).catch(e => console.error('Failed to save instance mapping locally:', e.message));
      
      setCachedTenantId(finalName, user.tenant_id);
    }

    // Auto-register webhook
    await registerWebhook(finalName);

    res.json({
      ...(result.data || {}),
      instanceName: finalName,
      instance: {
        ...(result.data?.instance || {}),
        instanceName: result.data?.instance?.instanceName || finalName,
      },
    });
  } catch (error) {
    console.error('Create instance error:', error);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Connect (get QR Code) + ensure webhook is registered
app.get('/api/whatsapp/connect/:instance', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const instanceName = req.params.instance;
    if (user.tenant_id) {
      await pool.query(
        `INSERT INTO whatsapp_instances (instance_name, tenant_id)
         VALUES ($1, $2)
         ON CONFLICT (instance_name) DO NOTHING`,
        [instanceName, user.tenant_id]
      ).catch(e => console.error('Failed to save instance mapping on connect:', e.message));
      const realOwner = await getStrictInstanceOwner(instanceName);
      if (realOwner) setCachedTenantId(instanceName, realOwner);
    }
    const result = await evolutionFetch(`/instance/connect/${instanceName}`);

    // Ensure webhook is registered on every connect attempt
    registerWebhook(instanceName).catch(() => {});

    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// After a number is connected in Canais, bind it to the logged tenant, ensure
// webhook delivery, and import recent conversations so Comercial/Chat is filled.
app.post('/api/whatsapp/sync-chat/:instance', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const instanceName = req.params.instance;
    const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 365);

    if (!user.tenant_id) return res.status(400).json({ error: 'Usuário sem tenant_id' });

    await pool.query(
      `INSERT INTO whatsapp_instances (instance_name, tenant_id)
       VALUES ($1, $2)
       ON CONFLICT (instance_name) DO NOTHING`,
      [instanceName, user.tenant_id]
    );
    const realOwner = await getStrictInstanceOwner(instanceName);
    if (realOwner) setCachedTenantId(instanceName, realOwner);
    if (realOwner && realOwner !== String(user.tenant_id) && !user.is_super_admin) {
      return res.status(403).json({ error: 'Este número de WhatsApp não pertence à sua clínica.' });
    }
    await registerWebhook(instanceName).catch(() => undefined);

    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const result = await importWhatsAppMessagesForTenant({
      tenantId: realOwner || user.tenant_id,
      requestedInstances: [instanceName],
      start,
      end,
      createWaitingSessions: true,
      maxPages: 20,
      pageSize: 50,

    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('sync-chat error:', error);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Connection state
app.get('/api/whatsapp/state/:instance', async (req, res) => {
  try {
    await verifyUser(req);
    const result = await evolutionFetch(`/instance/connectionState/${req.params.instance}`);
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout
app.delete('/api/whatsapp/logout/:instance', async (req, res) => {
  try {
    await verifyAdmin(req);
    const result = await evolutionFetch(`/instance/logout/${req.params.instance}`, { method: 'DELETE' });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete instance
app.delete('/api/whatsapp/instances/:instance', async (req, res) => {
  try {
    await verifyAdmin(req);
    const result = await evolutionFetch(`/instance/delete/${req.params.instance}`, { method: 'DELETE' });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restart instance
app.put('/api/whatsapp/restart/:instance', async (req, res) => {
  try {
    await verifyAdmin(req);
    const result = await evolutionFetch(`/instance/restart/${req.params.instance}`, { method: 'PUT' });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual webhook registration / check
app.post('/api/whatsapp/register-webhook/:instance', async (req, res) => {
  try {
    await verifyAdmin(req);
    const result = await registerWebhook(req.params.instance);
    res.json({ success: true, webhookUrl: WEBHOOK_URL, result: redactWebhookToken(result?.data) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current webhook config for an instance
app.get('/api/whatsapp/webhook/:instance', async (req, res) => {
  try {
    await verifyUser(req);
    const result = await evolutionFetch(`/webhook/find/${encodeURIComponent(req.params.instance)}`);
    res.json(redactWebhookToken(result.data));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Track which numbers we already subscribed presence for (per instance)
const presenceSubscribed = new Set();
// Track LID resolution warnings to avoid log spam
let resolveLidWarned = new Set();
// Track subscribed phones per instance for LID resolution fallback
// Map<instance, Set<phone>>
const instanceSubscribedPhones = new Map();

// Subscribe to contact presence (typing, recording, online) — calls Evolution API
app.post('/api/whatsapp/subscribe-presence', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number } = req.body;
    if (!instance || !number) {
      return res.status(400).json({ error: 'instance and number are required' });
    }
    const cleanNumber = normalizeWhatsappNumber(number);
    await ensureWebhookRegistration(instance);

    const subKey = `${instance}:${cleanNumber}`;
    let didSubscribe = false;

    // Subscribe to presence by calling sendPresence — this triggers Baileys presenceSubscribe() internally
    // Evolution API's sendPresence expects a plain phone number (not JID), it resolves the JID internally
    if (!presenceSubscribed.has(subKey)) {
      try {
        const subResult = await evolutionFetch(`/chat/sendPresence/${instance}`, {
          method: 'POST',
          body: JSON.stringify({
            number: cleanNumber,
            delay: 1200,
            presence: 'composing',
          }),
        });
        console.log(`👁️ Presence subscribe attempt for ${maskPhone(cleanNumber)} on ${instance}: status=${subResult.status}`);
        if (subResult.ok || subResult.status === 201) {
          presenceSubscribed.add(subKey);
          didSubscribe = true;
          console.log(`✅ Presence subscribed for ${maskPhone(cleanNumber)} on ${instance}`);

          // Track subscribed phone for this instance (for LID resolution fallback)
          if (!instanceSubscribedPhones.has(instance)) instanceSubscribedPhones.set(instance, new Set());
          instanceSubscribedPhones.get(instance).add(cleanNumber);

          // Resolve LID mapping — await so it's ready for presence events
          const lid = await resolveLidForPhone(instance, cleanNumber);
          if (!lid) {
            // Log only once per number to avoid spam
            if (!resolveLidWarned) resolveLidWarned = new Set();
            if (!resolveLidWarned.has(cleanNumber)) {
              resolveLidWarned.add(cleanNumber);
              console.warn(`⚠️ Could not resolve LID for ${maskPhone(cleanNumber)} — presence updates may not match (suppressing future warnings for this number)`);
            }
          }
        } else {
          console.warn(`⚠️ Presence subscribe failed for ${maskPhone(cleanNumber)}: status=${subResult.status}`);
        }
      } catch (subErr) {
        console.error(`❌ Presence subscribe error for ${maskPhone(cleanNumber)}:`, subErr.message);
      }
    }

    const cachedPresence = presenceStateCache.get(cleanNumber)
      || Array.from(presenceStateCache.entries()).find(([phone]) => {
        if (!phone || !cleanNumber) return false;
        return phone === cleanNumber || phone.endsWith(cleanNumber.slice(-11)) || cleanNumber.endsWith(phone.slice(-11));
      })?.[1]
      // Also check if we have a LID mapped to this phone
      || (phoneToLidMap.has(cleanNumber) ? presenceStateCache.get(phoneToLidMap.get(cleanNumber)) : undefined);

    res.json({
      subscribed: didSubscribe || presenceSubscribed.has(subKey),
      number: cleanNumber,
      presence: cachedPresence?.status || 'unavailable',
      updatedAt: cachedPresence?.updatedAt || null,
    });
  } catch (error) {
    console.error('Presence subscribe error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Mark messages as read on WhatsApp (blue ticks) ───
app.post('/api/whatsapp/mark-read', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, messageIds } = req.body;
    if (!instance || !number) {
      return res.status(400).json({ error: 'instance e number são obrigatórios' });
    }
    const cleanNumber = normalizeWhatsappNumber(number);
    const keys = (messageIds || []).map(id => ({
      remoteJid: `${cleanNumber}@s.whatsapp.net`,
      id,
    }));

    if (keys.length === 0) {
      return res.json({ success: true, marked: 0 });
    }

    const result = await evolutionFetch(`/chat/markMessageAsRead/${instance}`, {
      method: 'PUT',
      body: JSON.stringify({ readMessages: keys }),
    });

    return res.json({ success: result.ok, marked: keys.length, data: result.data });
  } catch (error) {
    console.error('Mark read error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Delete message for everyone on WhatsApp ───
app.post('/api/whatsapp/delete-message', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, messageId, fromMe } = req.body;
    if (!instance || !number || !messageId) {
      return res.status(400).json({ error: 'instance, number e messageId são obrigatórios' });
    }
    const cleanNumber = normalizeWhatsappNumber(number);

    const result = await evolutionFetch(`/chat/deleteMessageForEveryone/${instance}`, {
      method: 'DELETE',
      body: JSON.stringify({
        id: messageId,
        remoteJid: `${cleanNumber}@s.whatsapp.net`,
        fromMe: fromMe !== false, // default true (attendant messages)
      }),
    });

    if (!result.ok) {
      return res.status(result.status || 502).json({
        error: result.data?.response?.message?.[0] || 'Falha ao apagar mensagem',
        details: result.data,
      });
    }

    return res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Delete message error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Archive/clear chat on WhatsApp ───
app.post('/api/whatsapp/archive-chat', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, archive } = req.body;
    if (!instance || !number) {
      return res.status(400).json({ error: 'instance e number são obrigatórios' });
    }
    const cleanNumber = normalizeWhatsappNumber(number);

    const result = await evolutionFetch(`/chat/archiveChat/${instance}`, {
      method: 'PUT',
      body: JSON.stringify({
        lastMessage: { key: { remoteJid: `${cleanNumber}@s.whatsapp.net` } },
        archive: archive !== false,
      }),
    });

    return res.json({ success: result.ok, data: result.data });
  } catch (error) {
    console.error('Archive chat error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/whatsapp/send-presence', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, presence, delay } = req.body;
    if (!instance || !number || !presence) {
      return res.status(400).json({ error: 'instance, number e presence são obrigatórios' });
    }

    const allowedPresence = new Set(['composing', 'recording', 'paused']);
    if (!allowedPresence.has(presence)) {
      return res.status(400).json({ error: 'presence inválido' });
    }

    const cleanNumber = normalizeWhatsappNumber(number);
    const result = await evolutionFetch(`/chat/sendPresence/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        number: cleanNumber,
        presence,
        delay: typeof delay === 'number' ? delay : 200,
      }),
    });

    if (!result.ok) {
      return res.status(result.status || 502).json({
        error: result.data?.response?.message?.[0] || result.data?.error || 'Falha ao enviar presence',
        details: result.data,
      });
    }

    return res.json(result.data || { success: true, presence });
  } catch (error) {
    console.error('Send presence error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


app.post('/api/whatsapp/send-text', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { instance, number, text, quoted, leadId } = req.body;
    if (!instance || !number || typeof text !== 'string') {
      return res.status(400).json({ error: 'instance, number e text são obrigatórios' });
    }
    // Envio isolado: não trocar o destino com /chat/whatsappNumbers aqui.
    // Esse endpoint pode retornar JID/canonical diferente e causar envio com
    // apenas 1 check sem chegar ao cliente. Mantemos o número normalizado que
    // veio da conversa, que era o comportamento funcional anterior.
    const cleanNumber = normalizeWhatsappNumber(number);

    const mappedTenantId = await getTenantIdByInstance(instance);
    if (user.tenant_id && mappedTenantId && String(mappedTenantId) !== String(user.tenant_id)) {
      return res.status(403).json({
        error: 'Esta instância do WhatsApp não pertence à clínica atual. Atualize a página e selecione o canal correto.',
      });
    }

    const connectionCheck = await ensureEvolutionInstanceOpen(instance);
    if (!connectionCheck.ok) {
      return res.status(connectionCheck.status || 409).json(connectionCheck.data);
    }

    // Make sure Evolution forwards events back to our webhook before sending.
    // If this is fire-and-forget, a newly/reconnected instance can send before
    // ACK/reply webhooks are registered, producing one-check messages forever.
    await ensureWebhookRegistration(instance).catch((webhookErr) => {
      console.warn(`⚠️ send-text: webhook registration check failed for ${instance}; continuing send:`, webhookErr?.message);
      return null;
    });

    const result = await sendEvolutionTextMessage(instance, cleanNumber, text, quoted || null, {
      leadId,
      tenantId: user?.tenant_id || null,
    });
    const sentNumber = result.data?.sentNumber || cleanNumber;

    if (!result.ok) {
      const errMsg = getEvolutionErrorMessage(result);
      console.error(`❌ send-text failed for ${instance} → ${maskPhone(sentNumber)}: ${errMsg} (status=${result.status})`);
      const httpStatus = result.status === 401 || result.status === 403 ? 502 : (result.status || 502);
      return res.status(httpStatus).json({ error: errMsg, details: result.data });
    }

    const messageId = extractEvolutionMessageId(result.data);
    if (!messageId) {
      // Sem key.id/messageId real não há como correlacionar ACK, persistir status
      // ou garantir entrega. Retornar sucesso aqui gera exatamente o falso
      // positivo visto na UI: "enviado", mas nada chega ao WhatsApp.
      console.error(`❌ send-text sem message id real para ${instance} → ${maskPhone(sentNumber)} (status=${result.status})`);
      return res.status(502).json({
        error: 'Evolution aceitou a requisição, mas não retornou confirmação real da mensagem. Envio não confirmado.',
        details: result.data,
      });
    }

    // Persistência defensiva no próprio endpoint de envio. Antes, o frontend só
    // salvava depois da resposta da Evolution; qualquer falha entre send-text e
    // POST /api/messages fazia a mensagem enviada sumir ao atualizar a página.
    // Persistimos apenas depois de confirmação real (messageId), então mensagens
    // não enviadas continuam sem entrar no histórico, como esperado.
    if (leadId && user?.tenant_id) {
      try {
        const attendantName = await getProfileDisplayName(user.id, 'Atendente');
        const pendingStatus = consumePendingMessageStatus(user.tenant_id, messageId);
        const initialStatus = pendingStatus && isHigherMessageStatus(pendingStatus, 'sent') ? pendingStatus : 'sent';

        await pool.query(
          `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, attendant_id, attendant_name, instance, phone, tenant_id)
           VALUES ($1,$2,$3,'attendant','text',$4,NOW(),$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE
             SET status = CASE
               WHEN chat_messages.status = 'read' THEN chat_messages.status
               WHEN chat_messages.status = 'delivered' AND EXCLUDED.status IN ('sent', 'sending') THEN chat_messages.status
               ELSE EXCLUDED.status
             END,
             instance = COALESCE(chat_messages.instance, EXCLUDED.instance),
             phone = COALESCE(chat_messages.phone, EXCLUDED.phone),
             tenant_id = COALESCE(chat_messages.tenant_id, EXCLUDED.tenant_id)`,
          [messageId, leadId, text || '', initialStatus, user.id, attendantName, instance, sentNumber, user.tenant_id]
        );
      } catch (persistErr) {
        console.error(`⚠️ send-text enviado mas não persistido (${messageId}):`, persistErr.message);
      }
    }

    res.json({ ...(result.data || {}), key: { ...(result.data?.key || {}), id: messageId }, messageId, sent: true, sentNumber });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Send media (image, video, document, audio)
app.post('/api/whatsapp/send-media', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, mediaType, media } = req.body;
    if (!instance || !number || !mediaType) {
      return res.status(400).json({ error: 'instance, number e mediaType são obrigatórios' });
    }

    const cleanNumber = normalizeWhatsappNumber(number);

    ensureWebhookRegistration(instance).catch((webhookErr) => {
      console.warn(`⚠️ send-media: webhook registration check failed for ${instance}; continuing send:`, webhookErr?.message);
    });

    if (mediaType === 'audio') {
      const result = await sendWhatsAppAudioWithFallback(
        instance,
        cleanNumber,
        media.base64,
        media.mimeType,
        media.fileName,
      );

      if (!result.ok) {
        return res.status(result.status || 502).json({
          error: result.data?.response?.message?.[0] || result.data?.error || 'Falha ao enviar áudio',
          details: result.data,
        });
      }
      return res.json(result.data);
    }

    const cleanedBase64 = media.base64 ? cleanBase64Media(media.base64) : null;
    const mimeType = media.mimeType || 'application/octet-stream';

    console.log(`📤 sendMedia [${mediaType}] to ${maskPhone(cleanNumber)}, base64 len: ${cleanedBase64 ? cleanedBase64.length : 0}, url: ${media.url || 'none'}, mime: ${mimeType}`);

    const payload = {
      number: cleanNumber,
      mediatype: mediaType,
      caption: media.caption || '',
      delay: 1200,
    };
    if (media.fileName) {
      payload.fileName = media.fileName;
    }
    if (mimeType) {
      payload.mimetype = mimeType;
    }
    if (cleanedBase64 && cleanedBase64.length > 10) {
      payload.media = cleanedBase64;
    } else if (media.url) {
      payload.media = media.url;
    } else {
      console.error('❌ sendMedia: no valid media (base64 or url). base64 length:', cleanedBase64?.length, 'url:', media.url);
      return res.status(400).json({ error: 'Nenhuma mídia válida fornecida (base64 vazio ou URL ausente)' });
    }

    console.log(`📤 sendMedia payload size: ${JSON.stringify(payload).length} bytes`);

    const result = await evolutionFetch(`/message/sendMedia/${instance}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      console.error('❌ sendMedia Evolution error:', JSON.stringify(result.data));
      return res.status(result.status || 502).json({
        error: result.data?.response?.message?.[0] || result.data?.error || 'Falha ao enviar mídia',
        details: result.data,
      });
    }

    console.log('✅ sendMedia success:', JSON.stringify(result.data?.key || {}));
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/whatsapp/send-media-upload', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
  let jobId;
  try {
    const { user: jobUser } = await verifyUser(req);
    const { instance, number, mediaType, fileName, caption, mimeType } = req.query;

    if (!instance || !number || !mediaType) {
      return res.status(400).json({ error: 'instance, number e mediaType são obrigatórios' });
    }

    const rawBody = req.body;
    if (!rawBody || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      return res.status(400).json({ error: 'Arquivo não enviado' });
    }

    const cleanNumber = normalizeWhatsappNumber(number);
    const resolvedMimeType = String(mimeType || req.headers['content-type'] || 'application/octet-stream');
    jobId = randomUUID();

    ensureWebhookRegistration(String(instance)).catch((webhookErr) => {
      console.warn(`⚠️ send-media-upload: webhook registration check failed for ${instance}; continuing send:`, webhookErr?.message);
    });

    mediaSendJobs.set(jobId, {
      status: 'processing',
      createdAt: Date.now(),
      tenantId: jobUser?.tenant_id ? String(jobUser.tenant_id) : null,
      instance: String(instance),
      number: cleanNumber,
      mediaType: String(mediaType),
      fileName: fileName ? String(fileName) : undefined,
      mimeType: resolvedMimeType,
    });

    res.status(202).json({ jobId, status: 'processing' });

    const base64Data = rawBody.toString('base64');
    const dataUri = `data:${resolvedMimeType};base64,${base64Data}`;
    const normalizedFileName = fileName
      ? String(fileName)
      : `upload.${resolvedMimeType.split('/')[1] || 'bin'}`;
    const mediaCaption = caption && String(caption).trim() ? String(caption).trim() : undefined;

    console.log(`📤 send-media-upload jobId=${jobId} [${String(mediaType)}] to ${maskPhone(cleanNumber)}, binary size: ${rawBody.length}, base64 len: ${base64Data.length}, mime: ${resolvedMimeType}`);

    if (String(mediaType) === 'audio') {
      const result = await sendWhatsAppAudioWithFallback(
        String(instance),
        cleanNumber,
        base64Data,
        resolvedMimeType,
        normalizedFileName,
      );

      if (!result.ok) {
        mediaSendJobs.set(jobId, {
          ...mediaSendJobs.get(jobId),
          status: 'failed',
          error: friendlyEvolutionErrorMessage(result?.data, 'Falha ao enviar áudio'),
          details: result?.data,
          finishedAt: Date.now(),
        });
        return;
      }

      const savedMediaUrl = await saveBufferToDisk(rawBody, resolvedMimeType, normalizedFileName);
      mediaSendJobs.set(jobId, {
        ...mediaSendJobs.get(jobId),
        status: 'sent',
        result: result.data,
        mediaUrl: savedMediaUrl,
        finishedAt: Date.now(),
      });
      return;
    }

    const captionField = mediaCaption ? { caption: mediaCaption } : {};

    // Image: data URI first (confirmed working), then raw base64 fallback
    // Video: multipart first (if available), then data URI, then raw base64
    const payloadVariants = [];

    // Multipart only for video — wrap in try/catch in case FormData/Blob unavailable
    if (String(mediaType) === 'video') {
      try {
        const multipartBody = new FormData();
        multipartBody.append('number', cleanNumber);
        multipartBody.append('mediatype', String(mediaType));
        multipartBody.append('mimetype', resolvedMimeType);
        multipartBody.append('fileName', normalizedFileName);
        multipartBody.append('filename', normalizedFileName);
        multipartBody.append('delay', '1200');
        if (mediaCaption) multipartBody.append('caption', mediaCaption);
        multipartBody.append('file', new Blob([rawBody], { type: resolvedMimeType }), normalizedFileName);
        payloadVariants.push({
          label: 'multipart-file-upload',
          kind: 'multipart',
          body: multipartBody,
        });
      } catch (e) {
        console.warn('FormData/Blob not available, skipping multipart variant:', e.message);
      }
    }

    payloadVariants.push(
      {
        label: 'datauri-primary',
        kind: 'json',
        body: {
          number: cleanNumber,
          mediatype: String(mediaType),
          mimetype: resolvedMimeType,
          ...captionField,
          fileName: normalizedFileName,
          media: dataUri,
        },
      },
      {
        label: 'raw-base64-fallback',
        kind: 'json',
        body: {
          number: cleanNumber,
          mediatype: String(mediaType),
          mimetype: resolvedMimeType,
          ...captionField,
          fileName: normalizedFileName,
          media: cleanBase64Media(base64Data),
        },
      },
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    let result = null;
    try {
      for (const variant of payloadVariants) {
        const attemptMeta = variant.kind === 'multipart'
          ? 'multipart/form-data upload'
          : `payload size: ${JSON.stringify(variant.body).length} bytes`;
        console.log(`📤 send-media-upload trying ${variant.label} jobId=${jobId}, ${attemptMeta}`);

        if (variant.kind === 'multipart') {
          const res = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${instance}`, {
            method: 'POST',
            headers: {
              apikey: EVOLUTION_API_KEY,
            },
            body: variant.body,
            signal: controller.signal,
          });
          const data = await res.json().catch(() => ({}));
          result = { ok: res.ok, status: res.status, data };
        } else {
          result = await evolutionFetch(`/message/sendMedia/${instance}`, {
            method: 'POST',
            body: JSON.stringify(variant.body),
            signal: controller.signal,
          });
        }

        console.log(`📤 send-media-upload result ${variant.label} ok=${result.ok} status=${result.status} jobId=${jobId}`);
        console.log(`📤 send-media-upload FULL RESPONSE ${variant.label} jobId=${jobId}:`, JSON.stringify(result.data, null, 2));
        if (result.ok) {
          console.log('✅ send-media-upload success jobId=' + jobId + ` variant=${variant.label} messageId=${result.data?.key?.id || 'N/A'}`);
          break;
        }
        console.error(`❌ send-media-upload variant FAILED ${variant.label} jobId=${jobId} HTTP ${result.status}:`);
        console.error(`   Response body:`, JSON.stringify(result.data));
        console.error(`   Error message:`, result.data?.response?.message || result.data?.error || result.data?.message || 'unknown');
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!result?.ok) {
      mediaSendJobs.set(jobId, {
        ...mediaSendJobs.get(jobId),
        status: 'failed',
        error: friendlyEvolutionErrorMessage(result?.data, 'Falha ao enviar mídia'),
        details: result?.data,
        finishedAt: Date.now(),
      });
      return;
    }

    // Save uploaded media to disk for persistence
    const savedMediaUrl = await saveBufferToDisk(rawBody, resolvedMimeType, fileName ? String(fileName) : undefined);

    mediaSendJobs.set(jobId, {
      ...mediaSendJobs.get(jobId),
      status: 'sent',
      result: result.data,
      mediaUrl: savedMediaUrl,
      finishedAt: Date.now(),
    });
  } catch (error) {
    console.error('send-media-upload failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Falha ao enviar mídia';
    if (typeof jobId !== 'undefined') {
      mediaSendJobs.set(jobId, {
        ...mediaSendJobs.get(jobId),
        status: 'failed',
        error: errorMessage,
        finishedAt: Date.now(),
      });
    }
    if (!res.headersSent) {
      return res.status(errorMessage === 'Unauthorized' ? 401 : 500).json({ error: errorMessage });
    }
  }
});

app.get('/api/whatsapp/send-media-status/:jobId', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const job = mediaSendJobs.get(req.params.jobId);
    const sameTenant = user.is_super_admin || (job && job.tenantId && job.tenantId === String(user.tenant_id || ''));
    if (!job || !sameTenant) {
      return res.status(404).json({ error: 'Job não encontrado' });
    }
    const { tenantId: _tenantId, ...publicJob } = job;
    res.json(publicJob);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Send location
app.post('/api/whatsapp/send-location', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, latitude, longitude, name, address } = req.body;
    const cleanNumber = normalizeWhatsappNumber(number);
    const result = await evolutionFetch(`/message/sendLocation/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        number: cleanNumber,
        name: name || '',
        address: address || '',
        latitude,
        longitude,
      }),
    });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send contact card
app.post('/api/whatsapp/send-contact', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, contact } = req.body;
    const cleanNumber = normalizeWhatsappNumber(number);
    const result = await evolutionFetch(`/message/sendContact/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        number: cleanNumber,
        contact: [{
          fullName: contact.fullName,
          wuid: contact.phone.replace(/\D/g, ''),
          phoneNumber: contact.phone,
          ...(contact.email ? { email: contact.email } : {}),
          ...(contact.company ? { organization: contact.company } : {}),
          ...(contact.url ? { url: contact.url } : {}),
        }],
      }),
    });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send poll
app.post('/api/whatsapp/send-poll', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, question, options } = req.body;
    const cleanNumber = normalizeWhatsappNumber(number);
    const result = await evolutionFetch(`/message/sendPoll/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        number: cleanNumber,
        name: question,
        values: options,
        selectableCount: 1,
      }),
    });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send sticker
app.post('/api/whatsapp/send-sticker', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, sticker } = req.body;
    const cleanNumber = number.replace(/\D/g, '');
    const result = await evolutionFetch(`/message/sendSticker/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ number: cleanNumber, sticker }),
    });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send interactive list
app.post('/api/whatsapp/send-list', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, title, description, buttonText, footerText, sections } = req.body;
    const cleanNumber = number.replace(/\D/g, '');
    const result = await evolutionFetch(`/message/sendList/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        number: cleanNumber,
        title,
        description: description || title,
        buttonText,
        footerText: footerText || '',
        sections: sections.map((s, si) => ({
          title: s.title,
          rows: s.rows.map((r, ri) => ({
            title: r.title,
            description: r.description || '',
            rowId: r.rowId || r.id || `row-${si}-${ri}`,
          })),
        })),
      }),
    });
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send reaction emoji
app.post('/api/whatsapp/send-reaction', async (req, res) => {
  try {
    let user;
    try {
      ({ user } = await verifyUser(req));
    } catch (authErr) {
      console.warn('[send-reaction] auth failed:', authErr.message);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { instance, number, messageId, reaction } = req.body || {};
    if (!instance || !number || !messageId || typeof reaction !== 'string') {
      return res.status(400).json({ error: 'instance, number, messageId e reaction são obrigatórios' });
    }

    const cleanNumber = String(number).replace(/\D/g, '');
    const { rows: messageRows } = await pool.query(
      `SELECT sender FROM chat_messages WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [messageId, user.tenant_id]
    );
    const fromMe = messageRows[0]?.sender === 'attendant';

    const payload = {
      key: {
        remoteJid: `${cleanNumber}@s.whatsapp.net`,
        fromMe,
        id: messageId,
      },
      reaction,
    };

    console.log('[send-reaction] enviando reação', { messageId, fromMe });

    const result = await evolutionFetch(`/message/sendReaction/${instance}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    console.log('[send-reaction] evolution response:', result.status);

    if (!result.ok) {
      const rawMsg = result.data?.response?.message ?? result.data?.error ?? result.data?.message;
      const errorMessage = Array.isArray(rawMsg) ? rawMsg.join('; ') : (rawMsg || `Evolution API HTTP ${result.status}`);
      // Não devolve 401 para evitar logout no frontend; mapeia para 400/502
      const safeStatus = result.status === 401 || result.status === 403 ? 400 : (result.status >= 400 && result.status < 600 ? result.status : 502);
      return res.status(safeStatus).json({ error: `Falha ao enviar reação: ${errorMessage}`, details: result.data });
    }

    await pool.query(
      `UPDATE chat_messages
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reactions', $2::jsonb)
       WHERE id = $1 AND tenant_id = $3`,
      [messageId, JSON.stringify(reaction ? [{ emoji: reaction, count: 1 }] : []), user.tenant_id]
    );

    res.json({ success: true, reaction, result: result.data });
  } catch (error) {
    console.error('[send-reaction] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// WHATSAPP PROFILE PICTURE
// ═══════════════════════════════════════════════════════════════

// Fetch profile picture from Evolution API and optionally save to lead
app.post('/api/whatsapp/profile-picture', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { instance, number, leadId } = req.body;
    if (!instance || !number) {
      return res.status(400).json({ error: 'instance e number são obrigatórios' });
    }

    // Clean phone number — Evolution API expects format: 5511999991234
    const cleanNumber = number.replace(/\D/g, '');

    // Fetch profile picture URL via Evolution API
    console.log(`📸 Fetching profile picture for ${maskPhone(cleanNumber)} on instance ${instance}`);
    const result = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ number: cleanNumber }),
    });

    console.log(`📸 Evolution API response:`, JSON.stringify(result));

    if (!result.ok) {
      console.error(`📸 Evolution API error [${result.status}]:`, JSON.stringify(result.data));
      return res.status(result.status).json({ error: 'Não foi possível buscar a foto de perfil', details: result.data });
    }

    const pictureUrl = result.data?.profilePictureUrl || result.data?.picture || result.data?.url || null;

    // If leadId provided AND is a valid UUID, save to crm_leads
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (leadId && pictureUrl && uuidRegex.test(leadId)) {
      await pool.query(
        'UPDATE crm_leads SET avatar_url = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
        [pictureUrl, leadId, user.tenant_id]
      );
    }

    res.json({ profilePictureUrl: pictureUrl });
  } catch (error) {
    console.error('Profile picture error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk fetch: update all leads without avatar_url
app.post('/api/whatsapp/sync-profile-pictures', async (req, res) => {
  let user;
  try {
    ({ user } = await verifyUser(req));
  } catch (error) {
    console.error('[sync-profile-pictures] auth failed:', error.message);
    return res.status(401).json({ error: 'Unauthorized: ' + error.message });
  }

  try {
    const { instance } = req.body;
    if (!instance) return res.status(400).json({ error: 'instance é obrigatório' });

    console.log(`🔄 Syncing profile pictures for tenant ${user.tenant_id} on instance ${instance} (user=${user.id}, SuperAdmin: ${user.is_super_admin})`);

    // Get leads (scoped to tenant when available) without avatar
    const tenantId = user.tenant_id || null;
    const { rows: leads } = tenantId
      ? await pool.query(
          "SELECT id, telefone FROM crm_leads WHERE tenant_id = $1 AND telefone IS NOT NULL AND (avatar_url IS NULL OR avatar_url = '')",
          [tenantId]
        )
      : await pool.query(
          "SELECT id, telefone FROM crm_leads WHERE telefone IS NOT NULL AND (avatar_url IS NULL OR avatar_url = '')"
        );

    console.log(`🔄 Found ${leads.length} leads to sync`);

    if (leads.length === 0) {
      return res.json({ total: 0, updated: 0, failed: 0, message: 'Nenhum contato pendente de foto.' });
    }

    // Cap per request to avoid proxy/idle timeouts (each lead waits ~500ms).
    const MAX_PER_RUN = 60;
    const batch = leads.slice(0, MAX_PER_RUN);

    let updated = 0;
    let failed = 0;

    for (const lead of batch) {
      try {
        const cleanNumber = lead.telefone.replace(/\D/g, '');
        if (!cleanNumber) continue;

        const result = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: cleanNumber }),
        });

        const pictureUrl = result.data?.profilePictureUrl || result.data?.picture || result.data?.url || null;
        if (pictureUrl) {
          await pool.query('UPDATE crm_leads SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [pictureUrl, lead.id]);
          updated++;
        }
      } catch {
        failed++;
      }

      await new Promise(r => setTimeout(r, 350));
    }

    res.json({ total: batch.length, updated, failed, remaining: Math.max(0, leads.length - batch.length) });
  } catch (error) {
    console.error('[sync-profile-pictures] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// WHATSAPP CALL — Offer call via Evolution API
// ═══════════════════════════════════════════════════════════════

app.post('/api/whatsapp/call', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, isVideo = false, callDuration = 5 } = req.body;
    if (!instance || !number) {
      return res.status(400).json({ error: 'instance e number são obrigatórios' });
    }

    const cleanNumber = number.replace(/\D/g, '');
    console.log(`📞 Initiating ${isVideo ? 'video' : 'voice'} call to ${maskPhone(cleanNumber)} on instance ${instance}`);

    const result = await evolutionFetch(`/call/offer/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        number: cleanNumber,
        isVideo,
        callDuration: callDuration || 5,
      }),
    });

    if (!result.ok) {
      console.error(`📞 Call error [${result.status}]:`, JSON.stringify(result.data));
      return res.status(result.status).json({ error: 'Não foi possível iniciar a ligação', details: result.data });
    }

    console.log(`📞 Call offered successfully to ${maskPhone(cleanNumber)}`);
    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Call error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════

const PACIENTE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ids de paciente/dentista recebidos no corpo precisam ser da clínica do usuário.
// Devolve a mensagem para responder 400, ou null se estiver tudo certo.
async function validarReferenciasDoTenant(tenantId, { pacienteId, dentistaId } = {}) {
  const checks = [
    ['pacientes', pacienteId, 'Paciente não encontrado'],
    ['dentistas', dentistaId, 'Dentista não encontrado'],
  ];
  for (const [tabela, id, msg] of checks) {
    if (id === undefined || id === null || id === '') continue;
    if (!tenantId || !PACIENTE_UUID_RE.test(String(id))) return msg;
    const { rows } = await pool.query(`SELECT 1 FROM ${tabela} WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
    if (!rows.length) return msg;
  }
  return null;
}

// Todas as rotas /api/pacientes/:id/* recebem um UUID; qualquer outro valor é
// "não encontrado" (sem chegar ao banco, que responderia 500 por cast inválido).
app.use('/api/pacientes/:id', (req, res, next) => {
  if (!PACIENTE_UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Paciente não encontrado' });
  next();
});

app.get('/api/pacientes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM pacientes WHERE tenant_id = $1 ORDER BY nome ASC', [user.tenant_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pacientes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, cpf, telefone, email, data_nascimento, sexo, convenio, endereco, observacoes } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO pacientes (id, nome, cpf, telefone, email, data_nascimento, sexo, convenio, endereco, observacoes, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, nome, cpf, telefone, email, data_nascimento, sexo, convenio, endereco, observacoes, user.tenant_id]
    );
    res.json({ id, nome, cpf, telefone, email, sexo, convenio });
    // Push to Clinicorp
    import('./clinicorp.mjs').then(m => m.clinicorpPush.pushPatient(pool, id)).catch(e => console.error('Clinicorp push failed:', e.message));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pacientes/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, cpf, telefone, email, data_nascimento, sexo, convenio, endereco, observacoes } = req.body;
    const { rowCount } = await pool.query(
      'UPDATE pacientes SET nome=$1, cpf=$2, telefone=$3, email=$4, data_nascimento=$5, sexo=$6, convenio=$7, endereco=$8, observacoes=$9, updated_at=NOW() WHERE id=$10 AND tenant_id=$11',
      [nome, cpf, telefone, email, data_nascimento, sexo, convenio, endereco, observacoes, req.params.id, user.tenant_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    res.json({ success: true });
    // Push to Clinicorp
    import('./clinicorp.mjs').then(m => m.clinicorpPush.pushPatient(pool, req.params.id)).catch(e => console.error('Clinicorp push failed:', e.message));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/pacientes/:id', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM pacientes WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ANAMNESE
// ═══════════════════════════════════════════════════════════════

app.get('/api/pacientes/:id/anamnese', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: pac } = await pool.query('SELECT 1 FROM pacientes WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (pac.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const { rows } = await pool.query('SELECT * FROM anamneses WHERE paciente_id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    res.json(rows[0] || null);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

app.put('/api/pacientes/:id/anamnese', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { id } = req.params;
    const {
      alergias, medicamentos, doencas_preexistentes, cirurgias_anteriores,
      fumante, etilista, gestante, diabetes, cardiopatia, hepatite, hiv,
      hemofilia, epilepsia, pressao_arterial, observacoes
    } = req.body;

    const { rows: pac } = await pool.query('SELECT 1 FROM pacientes WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id]);
    if (pac.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });

    const { rows: existing } = await pool.query('SELECT id FROM anamneses WHERE paciente_id = $1 AND tenant_id = $2', [id, user.tenant_id]);

    if (existing.length > 0) {
      await pool.query(
        `UPDATE anamneses SET
          alergias=$1, medicamentos=$2, doencas_preexistentes=$3, cirurgias_anteriores=$4,
          fumante=$5, etilista=$6, gestante=$7, diabetes=$8, cardiopatia=$9,
          hepatite=$10, hiv=$11, hemofilia=$12, epilepsia=$13,
          pressao_arterial=$14, observacoes=$15, updated_at=NOW()
        WHERE paciente_id=$16 AND tenant_id=$17`,
        [alergias||[], medicamentos||[], doencas_preexistentes||[], cirurgias_anteriores||[],
         fumante||false, etilista||false, gestante||false, diabetes||false, cardiopatia||false,
         hepatite||false, hiv||false, hemofilia||false, epilepsia||false,
         pressao_arterial||null, observacoes||null, id, user.tenant_id]
      );
    } else {
      await pool.query(
        `INSERT INTO anamneses (paciente_id, alergias, medicamentos, doencas_preexistentes, cirurgias_anteriores,
          fumante, etilista, gestante, diabetes, cardiopatia, hepatite, hiv, hemofilia, epilepsia,
          pressao_arterial, observacoes, tenant_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [id, alergias||[], medicamentos||[], doencas_preexistentes||[], cirurgias_anteriores||[],
         fumante||false, etilista||false, gestante||false, diabetes||false, cardiopatia||false,
         hepatite||false, hiv||false, hemofilia||false, epilepsia||false,
         pressao_arterial||null, observacoes||null, user.tenant_id]
      );
    }

    const { rows } = await pool.query('SELECT * FROM anamneses WHERE paciente_id = $1 AND tenant_id = $2', [id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('❌ Error saving anamnese:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ODONTOGRAMA
// ═══════════════════════════════════════════════════════════════

app.get('/api/pacientes/:id/odontograma', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: pac } = await pool.query('SELECT 1 FROM pacientes WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (pac.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const { rows } = await pool.query('SELECT * FROM odontogramas WHERE paciente_id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    res.json(rows[0] || null);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pacientes/:id/odontograma', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const id = req.params.id;
    const { dentes, observacoes } = req.body;

    const { rows: pac } = await pool.query('SELECT 1 FROM pacientes WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id]);
    if (pac.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });

    const { rows: existing } = await pool.query('SELECT id FROM odontogramas WHERE paciente_id = $1 AND tenant_id = $2', [id, user.tenant_id]);

    if (existing.length > 0) {
      await pool.query(
        `UPDATE odontogramas SET dentes=$1, observacoes=$2, updated_at=NOW() WHERE paciente_id=$3 AND tenant_id=$4`,
        [JSON.stringify(dentes), observacoes || null, id, user.tenant_id]
      );
    } else {
      await pool.query(
        `INSERT INTO odontogramas (paciente_id, dentes, observacoes, tenant_id) VALUES ($1, $2, $3, $4)`,
        [id, JSON.stringify(dentes), observacoes || null, user.tenant_id]
      );
    }

    const { rows } = await pool.query('SELECT * FROM odontogramas WHERE paciente_id = $1 AND tenant_id = $2', [id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('❌ Error saving odontograma:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// HISTORICO DE CONSULTAS (por paciente)
// ═══════════════════════════════════════════════════════════════

app.get('/api/pacientes/:id/historico', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: pac } = await pool.query('SELECT 1 FROM pacientes WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (pac.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const { rows } = await pool.query(
      `SELECT a.id, a.data, a.hora, a.duracao, a.procedimento, a.status, a.observacoes,
              d.nome as dentista_nome, d.especialidade as dentista_especialidade
       FROM agendamentos a
       LEFT JOIN dentistas d ON a.dentista_id = d.id AND d.tenant_id = a.tenant_id
       WHERE a.paciente_id = $1 AND a.tenant_id = $2
       ORDER BY a.data DESC, a.hora DESC`,
      [req.params.id, user.tenant_id]
    );
    res.json(rows);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AGENDA
// ═══════════════════════════════════════════════════════════════

app.get('/api/agenda', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.json([]);
    const { data_inicio, data_fim, dentista_id } = req.query;
    let query = 'SELECT a.*, p.nome as paciente_nome, d.nome as dentista_nome FROM agendamentos a LEFT JOIN pacientes p ON a.paciente_id = p.id AND p.tenant_id = a.tenant_id LEFT JOIN dentistas d ON a.dentista_id = d.id AND d.tenant_id = a.tenant_id WHERE a.tenant_id = $1';
    const params = [user.tenant_id];
    if (data_inicio) { params.push(data_inicio); query += ` AND a.data >= $${params.length}`; }
    if (data_fim) { params.push(data_fim); query += ` AND a.data <= $${params.length}`; }
    if (dentista_id) { params.push(dentista_id); query += ` AND a.dentista_id = $${params.length}`; }
    query += ' ORDER BY a.data ASC, a.hora ASC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Marcadores da agenda (tags coloridas) ─────────────────
app.get('/api/agenda/marcadores', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM agenda_marcadores WHERE tenant_id = $1 ORDER BY nome ASC', [user.tenant_id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/agenda/marcadores', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, cor } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const id = crypto.randomUUID();
    const corFinal = (cor || '#06b6d4').slice(0, 9);
    try {
      await pool.query('INSERT INTO agenda_marcadores (id, nome, cor, tenant_id) VALUES ($1,$2,$3,$4)', [id, nome.trim(), corFinal, user.tenant_id]);
      res.json({ id, nome: nome.trim(), cor: corFinal });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Marcador com este nome já existe' });
      throw err;
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/agenda/marcadores/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM agenda_marcadores WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Marcador não encontrado' });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/agenda', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem clínica vinculada' });
    const {
      paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes, lead_id,
      tipo, primeira_consulta, dia_inteiro, escopo, categoria, categoria_cor,
      confirmacao_canal, confirmacao_quando, alerta_retorno_canal, alerta_retorno_quando,
      evento_titulo, sala, serie_id, marcadores, como_conheceu,
    } = req.body;
    const refErro = await validarReferenciasDoTenant(user.tenant_id, { pacienteId: paciente_id, dentistaId: dentista_id });
    if (refErro) return res.status(400).json({ error: refErro });
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO agendamentos (
        id, paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes,
        tipo, primeira_consulta, dia_inteiro, escopo, categoria, categoria_cor,
        confirmacao_canal, confirmacao_quando, alerta_retorno_canal, alerta_retorno_quando,
        evento_titulo, sala, serie_id, marcadores, como_conheceu, tenant_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25)`,
      [
        id, paciente_id || null, dentista_id || null, data, hora, duracao || 30,
        procedimento || null, status || 'agendado', observacoes || null,
        tipo || 'consulta', !!primeira_consulta, !!dia_inteiro, escopo || 'dentista',
        categoria || null, categoria_cor || null,
        confirmacao_canal || null, confirmacao_quando || null,
        alerta_retorno_canal || null, alerta_retorno_quando || null,
        evento_titulo || null, sala || null, serie_id || null,
        JSON.stringify(Array.isArray(marcadores) ? marcadores : []),
        como_conheceu || null,
        user.tenant_id,
      ]
    );
    broadcastSSE('agendamento_changed', { action: 'created', id, data }, user.tenant_id);
    // Push to Clinicorp
    import('./clinicorp.mjs').then(m => m.clinicorpPush.pushAppointment(pool, id)).catch(e => console.error('Clinicorp push failed:', e.message));

    // Auto-move CRM lead to "paciente_agendado" if lead_id provided
    const resolvedLeadId = lead_id || paciente_id;
    if (resolvedLeadId) {
      await pool.query(
        `UPDATE crm_leads SET kanban_stage = 'paciente_agendado', status = 'paciente_agendado', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [resolvedLeadId, user.tenant_id]
      ).catch(err => console.error('Failed to update lead to paciente_agendado:', err.message));
    }

    res.json({ id, success: true });
  } catch (error) {
    console.error('❌ Error creating appointment:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/agenda/serie — múltiplo agendamento (recorrência)
app.post('/api/agenda/serie', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem clínica vinculada' });
    const {
      paciente_id, dentista_id, hora, duracao, procedimento, observacoes,
      data_inicio, quantidade, intervalo_dias,
      categoria, categoria_cor, primeira_consulta,
      confirmacao_canal, confirmacao_quando, sala,
    } = req.body;
    const qtd = Math.max(1, Math.min(52, Number(quantidade) || 1));
    const intDias = Math.max(1, Math.min(180, Number(intervalo_dias) || 7));
    if (!data_inicio || !/^\d{4}-\d{2}-\d{2}$/.test(data_inicio)) {
      return res.status(400).json({ error: 'data_inicio inválida (YYYY-MM-DD)' });
    }
    if (!hora || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
      return res.status(400).json({ error: 'hora inválida (HH:MM)' });
    }
    if (!dentista_id || !paciente_id) {
      return res.status(400).json({ error: 'paciente_id e dentista_id são obrigatórios' });
    }
    const refErroSerie = await validarReferenciasDoTenant(user.tenant_id, { pacienteId: paciente_id, dentistaId: dentista_id });
    if (refErroSerie) return res.status(400).json({ error: refErroSerie });
    const serie_id = crypto.randomUUID();
    const created = [];
    const start = new Date(data_inicio + 'T12:00:00Z');
    for (let i = 0; i < qtd; i++) {
      const d = new Date(start.getTime());
      d.setUTCDate(start.getUTCDate() + i * intDias);
      const dataStr = d.toISOString().slice(0, 10);
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO agendamentos (
          id, paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes,
          tipo, primeira_consulta, escopo, categoria, categoria_cor,
          confirmacao_canal, confirmacao_quando, sala, serie_id, tenant_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'agendado',$8,'consulta',$9,'dentista',$10,$11,$12,$13,$14,$15,$16)`,
        [
          id, paciente_id, dentista_id, dataStr, hora, duracao || 30,
          procedimento || null, observacoes || null,
          // primeira_consulta só na primeira data
          i === 0 ? !!primeira_consulta : false,
          categoria || null, categoria_cor || null,
          confirmacao_canal || null, confirmacao_quando || null,
          sala || null, serie_id, user.tenant_id,
        ]
      );
      created.push({ id, data: dataStr });
    }
    broadcastSSE('agendamento_changed', { action: 'created', serie_id }, user.tenant_id);
    res.json({ serie_id, total: created.length, agendamentos: created });
  } catch (error) {
    console.error('❌ Error creating series:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/agenda/:id — excluir agendamento
app.delete('/api/agenda/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const tId = user.tenant_id;
    if (!tId) return res.status(403).json({ error: 'Sem clínica vinculada' });
    const { serie } = req.query; // ?serie=true → exclui toda a série
    const changed = () => broadcastSSE('agendamento_changed', { action: 'deleted', id: req.params.id }, tId);
    if (serie === 'true') {
      const { rows } = await pool.query('SELECT serie_id FROM agendamentos WHERE id=$1 AND tenant_id=$2', [req.params.id, tId]);
      const sid = rows[0]?.serie_id;
      if (!sid) {
        const { rowCount } = await pool.query('DELETE FROM agendamentos WHERE id=$1 AND tenant_id=$2', [req.params.id, tId]);
        changed();
        return res.json({ success: true, deleted: rowCount });
      }
      const { rowCount } = await pool.query('DELETE FROM agendamentos WHERE serie_id=$1 AND tenant_id=$2', [sid, tId]);
      changed();
      return res.json({ success: true, deleted: rowCount });
    }
    // Push to Clinicorp: lê o vínculo ANTES do DELETE local (o push roda depois)
    const aptId = req.params.id;
    const { rows: cpRows } = await pool.query('SELECT clinicorp_appointment_id, tenant_id FROM agendamentos WHERE id=$1 AND tenant_id=$2', [aptId, tId]);
    const cpSnapshot = cpRows[0] || null;
    if (!cpSnapshot) return res.status(404).json({ error: 'Agendamento não encontrado' });
    await pool.query('DELETE FROM agendamentos WHERE id=$1 AND tenant_id=$2', [aptId, tId]);
    changed();
    if (cpSnapshot.clinicorp_appointment_id) {
      import('./clinicorp.mjs').then(m => m.clinicorpPush.deleteAppointment(pool, aptId, cpSnapshot)).catch(e => console.error('Clinicorp push failed:', e.message));
    }
    res.json({ success: true, deleted: 1 });
  } catch (error) {
    console.error('❌ Error deleting appointment:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/agenda/:id — update appointment (status, etc.)
app.put('/api/agenda/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem clínica vinculada' });
    const { id } = req.params;
    const { status, hora, duracao, procedimento, observacoes, sala, data, dentista_id, dentista_nome, marcadores, como_conheceu } = req.body;
    const refErro = await validarReferenciasDoTenant(user.tenant_id, { dentistaId: dentista_id });
    if (refErro) return res.status(400).json({ error: refErro });
    const sets = [];
    const params = [];
    if (status) { params.push(status); sets.push(`status = $${params.length}`); }
    if (hora) { params.push(hora); sets.push(`hora = $${params.length}`); }
    if (data) { params.push(data); sets.push(`data = $${params.length}`); }
    if (duracao) { params.push(duracao); sets.push(`duracao = $${params.length}`); }
    if (procedimento) { params.push(procedimento); sets.push(`procedimento = $${params.length}`); }
    if (observacoes !== undefined) { params.push(observacoes); sets.push(`observacoes = $${params.length}`); }
    if (sala) { params.push(sala); sets.push(`sala = $${params.length}`); }
    if (dentista_id) { params.push(dentista_id); sets.push(`dentista_id = $${params.length}`); }
    if (dentista_nome) { params.push(dentista_nome); sets.push(`dentista_nome = $${params.length}`); }
    if (Array.isArray(marcadores)) { params.push(JSON.stringify(marcadores)); sets.push(`marcadores = $${params.length}::jsonb`); }
    if (como_conheceu !== undefined) { params.push(como_conheceu || null); sets.push(`como_conheceu = $${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(id);
    params.push(user.tenant_id);
    const query = `UPDATE agendamentos SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length - 1} AND tenant_id = $${params.length} RETURNING *`;
    const { rows } = await pool.query(query, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado' });
    broadcastSSE('agendamento_changed', { action: 'updated', id, data: rows[0].data }, user.tenant_id);

    // Push to Clinicorp
    import('./clinicorp.mjs').then(m => m.clinicorpPush.pushAppointment(pool, id)).catch(e => console.error('Clinicorp push failed:', e.message));

    // If status changed to 'em_atendimento', update CRM lead
    if (status === 'em_atendimento' && rows[0].paciente_id) {
      pool.query(
        `UPDATE crm_leads SET kanban_stage = 'em_atendimento', status = 'em_atendimento', updated_at = NOW() WHERE id = $1`,
        [rows[0].paciente_id]
      ).catch(err => console.error('Failed to update lead status:', err.message));
    }
    // If status changed to 'finalizado' or 'realizado', update CRM lead
    if ((status === 'finalizado' || status === 'realizado') && rows[0].paciente_id) {
      pool.query(
        `UPDATE crm_leads SET kanban_stage = 'pos_consulta', status = 'pos_consulta', updated_at = NOW() WHERE id = $1`,
        [rows[0].paciente_id]
      ).catch(err => console.error('Failed to update lead status:', err.message));
    }

    const updated = rows[0];
    res.json(updated);

    // ── WhatsApp notification on reschedule (date or time changed) ──
    if ((data || hora) && updated.telefone && EVOLUTION_API_KEY) {
      (async () => {
        try {
          // Fetch connected instance
          const instResult = await evolutionFetch('/instance/fetchInstances');
          const instances = Array.isArray(instResult) ? instResult : [];
          const connected = instances.find(i => (i.connectionStatus || i.status) === 'open');
          if (!connected) return;
          const instName = connected.name || connected.instanceName;

          const phone = updated.telefone.replace(/\D/g, '');
          if (!phone) return;

          const dataFormatted = updated.data
            ? new Date(updated.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
          const firstName = (updated.paciente_nome || '').split(' ')[0] || 'Paciente';

          const clinica = await getTenantClinicName(user.tenant_id);
          const msg = `📋 *Consulta reagendada — ${clinica}*\n\nOlá, ${firstName}!\n\nSua consulta foi reagendada:\n📅 ${dataFormatted}\n⏰ ${updated.hora || '—'}\n👩‍⚕️ ${updated.dentista_nome || 'Equipe da clínica'}\n\nSe precisar remarcar de novo, é só mandar uma mensagem aqui.`;

          await evolutionFetch(`/message/sendText/${instName}`, {
            method: 'POST',
            body: JSON.stringify({ number: phone, text: msg }),
          });
          console.log(`📲 Reschedule notification sent to ${maskPhone(phone)}`);
        } catch (err) {
          console.error('⚠️ Failed to send reschedule notification:', err.message);
        }
      })();
    }
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('❌ Error updating appointment:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO
// ═══════════════════════════════════════════════════════════════

app.get('/api/financeiro', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { tipo, mes, ano } = req.query;
    let query = 'SELECT * FROM financeiro WHERE tenant_id = $1';
    const params = [user.tenant_id];
    if (tipo) { params.push(tipo); query += ` AND tipo = $${params.length}`; }
    if (mes && ano) { params.push(mes, ano); query += ` AND EXTRACT(MONTH FROM data) = $${params.length - 1} AND EXTRACT(YEAR FROM data) = $${params.length}`; }
    query += ' ORDER BY data DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/financeiro', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { tipo, descricao, valor, data, categoria, paciente_id, forma_pagamento } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO financeiro (id, tipo, descricao, valor, data, categoria, paciente_id, forma_pagamento, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, tipo, descricao, valor, data, categoria, paciente_id, forma_pagamento, user.tenant_id]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DENTISTAS
// ═══════════════════════════════════════════════════════════════

app.get('/api/dentistas', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    let { rows } = await pool.query('SELECT * FROM dentistas WHERE tenant_id = $1 ORDER BY nome ASC', [user.tenant_id]);
    if (rows.length === 0) {
      const fallback = await pool.query(`
        SELECT DISTINCT d.*
          FROM dentistas d
          JOIN agendamentos a ON a.dentista_id = d.id
         WHERE d.ativo IS DISTINCT FROM false
           AND a.tenant_id = $1
           AND (d.tenant_id IS NULL OR d.tenant_id = $1)
         ORDER BY d.nome ASC
      `, [user.tenant_id]);
      rows = fallback.rows;
    }
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dentistas', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    const { nome, cro, especialidade, telefone, email, comissao_percentual } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO dentistas (id, nome, cro, especialidade, telefone, email, comissao_percentual, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, nome, cro, especialidade, telefone, email, comissao_percentual || 0, user.tenant_id]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DENTISTAS — PUT / DELETE (missing)
// ═══════════════════════════════════════════════════════════════

app.put('/api/dentistas/:id', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, cro, especialidade, telefone, email, comissao_percentual, ativo, cor_agenda, sala } = req.body;
    const sets = []; const params = [];
    if (nome !== undefined) { params.push(nome); sets.push(`nome=$${params.length}`); }
    if (cro !== undefined) { params.push(cro); sets.push(`cro=$${params.length}`); }
    if (especialidade !== undefined) { params.push(especialidade); sets.push(`especialidade=$${params.length}`); }
    if (telefone !== undefined) { params.push(telefone); sets.push(`telefone=$${params.length}`); }
    if (email !== undefined) { params.push(email); sets.push(`email=$${params.length}`); }
    if (comissao_percentual !== undefined) { params.push(comissao_percentual); sets.push(`comissao_percentual=$${params.length}`); }
    if (ativo !== undefined) { params.push(ativo); sets.push(`ativo=$${params.length}`); }
    if (cor_agenda !== undefined) { params.push(cor_agenda); sets.push(`cor_agenda=$${params.length}`); }
    if (sala !== undefined) { params.push(sala); sets.push(`sala=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE dentistas SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Dentista não encontrado' });
    const { rows } = await pool.query('SELECT * FROM dentistas WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (error.message === 'Admin only') return res.status(403).json({ error: 'Admin only' });
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/dentistas/:id', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM dentistas WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Dentista não encontrado' });
    res.json({ success: true });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (error.message === 'Admin only') return res.status(403).json({ error: 'Admin only' });
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CLINICA CONFIG — horários globais + regras de agenda
// ═══════════════════════════════════════════════════════════════

const DEFAULT_HORARIOS = {
  dom: { ativo: false, inicio: '09:00', fim: '18:00' },
  seg: { ativo: true,  inicio: '09:00', fim: '18:00' },
  ter: { ativo: true,  inicio: '09:00', fim: '18:00' },
  qua: { ativo: true,  inicio: '09:00', fim: '18:00' },
  qui: { ativo: true,  inicio: '09:00', fim: '18:00' },
  sex: { ativo: true,  inicio: '09:00', fim: '18:00' },
  sab: { ativo: false, inicio: '09:00', fim: '13:00' },
};

function validateHorarios(h) {
  if (!h || typeof h !== 'object') return false;
  const dias = ['dom','seg','ter','qua','qui','sex','sab'];
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const d of dias) {
    const v = h[d];
    if (!v || typeof v.ativo !== 'boolean') return false;
    if (!re.test(v.inicio) || !re.test(v.fim)) return false;
    if (v.inicio >= v.fim) return false;
  }
  return true;
}

// Configuração por clínica (tenant_id). A linha legada id=1 (compartilhada) só serve
// de valor padrão de leitura enquanto a clínica não salvou a própria configuração.
async function getClinicaConfigRows(tenantId) {
  const { rows } = await pool.query('SELECT * FROM clinica_config WHERE tenant_id=$1 LIMIT 1', [tenantId]);
  if (rows.length > 0) return rows;
  const { rows: legacy } = await pool.query('SELECT * FROM clinica_config WHERE id=1');
  return legacy;
}

app.get('/api/clinica/config', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const rows = await getClinicaConfigRows(user.tenant_id);
    if (rows.length === 0) {
      // fallback: cria registro default (legado, usado só como padrão de leitura)
      await pool.query('INSERT INTO clinica_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
      const { rows: r2 } = await pool.query('SELECT * FROM clinica_config WHERE id=1');
      return res.json(r2[0]);
    }
    res.json(rows[0]);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clinica/config', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { horarios, intervalo_agenda, limitar_mesmo_horario, permitir_horario_indisponivel, habilitar_sessoes_procedimento } = req.body || {};
    const sets = []; const params = [];
    if (horarios !== undefined) {
      if (!validateHorarios(horarios)) return res.status(400).json({ error: 'Horários inválidos' });
      params.push(JSON.stringify(horarios)); sets.push(`horarios=$${params.length}::jsonb`);
    }
    if (intervalo_agenda !== undefined) {
      if (![5, 15, 20, 30, 60].includes(Number(intervalo_agenda))) return res.status(400).json({ error: 'Intervalo deve ser 5, 15, 20, 30 ou 60' });
      params.push(Number(intervalo_agenda)); sets.push(`intervalo_agenda=$${params.length}`);
    }
    if (limitar_mesmo_horario !== undefined) { params.push(!!limitar_mesmo_horario); sets.push(`limitar_mesmo_horario=$${params.length}`); }
    if (permitir_horario_indisponivel !== undefined) { params.push(!!permitir_horario_indisponivel); sets.push(`permitir_horario_indisponivel=$${params.length}`); }
    if (habilitar_sessoes_procedimento !== undefined) { params.push(!!habilitar_sessoes_procedimento); sets.push(`habilitar_sessoes_procedimento=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    // Upsert da linha da clínica: na primeira gravação copia os valores legados (id=1) como ponto de partida.
    await pool.query(
      `INSERT INTO clinica_config (tenant_id, horarios, intervalo_agenda, limitar_mesmo_horario, permitir_horario_indisponivel, habilitar_sessoes_procedimento)
       SELECT $1, horarios, intervalo_agenda, limitar_mesmo_horario, permitir_horario_indisponivel, habilitar_sessoes_procedimento
         FROM clinica_config WHERE id=1
       ON CONFLICT (tenant_id) DO NOTHING`,
      [user.tenant_id]
    );
    await pool.query('INSERT INTO clinica_config (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING', [user.tenant_id]);
    params.push(user.tenant_id);
    await pool.query(`UPDATE clinica_config SET ${sets.join(', ')}, updated_at=NOW() WHERE tenant_id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM clinica_config WHERE tenant_id=$1', [user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    const status = httpStatusOf(error);
    res.status(status).json({ error: status === 500 ? 'Erro interno' : error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DENTISTAS — Horários (override por profissional)
// ═══════════════════════════════════════════════════════════════

app.get('/api/dentistas/:id/horarios', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query(
      'SELECT id, nome, usar_horario_clinica, horarios FROM dentistas WHERE id=$1 AND tenant_id=$2',
      [req.params.id, user.tenant_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Dentista não encontrado' });
    const d = rows[0];
    if (d.usar_horario_clinica || !d.horarios) {
      const c = await getClinicaConfigRows(user.tenant_id);
      return res.json({ id: d.id, nome: d.nome, usar_horario_clinica: true, horarios: c[0]?.horarios || DEFAULT_HORARIOS, herdado: true });
    }
    res.json({ ...d, herdado: false });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/dentistas/:id/horarios', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { usar_horario_clinica, horarios } = req.body || {};
    const sets = []; const params = [];
    if (usar_horario_clinica !== undefined) {
      params.push(!!usar_horario_clinica); sets.push(`usar_horario_clinica=$${params.length}`);
    }
    if (horarios !== undefined) {
      if (horarios === null) {
        sets.push(`horarios=NULL`);
      } else {
        if (!validateHorarios(horarios)) return res.status(400).json({ error: 'Horários inválidos' });
        params.push(JSON.stringify(horarios)); sets.push(`horarios=$${params.length}::jsonb`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE dentistas SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Dentista não encontrado' });
    const { rows } = await pool.query('SELECT id, nome, usar_horario_clinica, horarios FROM dentistas WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (error.message === 'Admin only') return res.status(403).json({ error: 'Admin only' });
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════

app.put('/api/financeiro/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { tipo, descricao, valor, data, categoria, paciente_id, forma_pagamento, status, vencimento, observacoes } = req.body;
    const sets = []; const params = [];
    if (tipo !== undefined) { params.push(tipo); sets.push(`tipo=$${params.length}`); }
    if (descricao !== undefined) { params.push(descricao); sets.push(`descricao=$${params.length}`); }
    if (valor !== undefined) { params.push(valor); sets.push(`valor=$${params.length}`); }
    if (data !== undefined) { params.push(data); sets.push(`data=$${params.length}`); }
    if (categoria !== undefined) { params.push(categoria); sets.push(`categoria=$${params.length}`); }
    if (paciente_id !== undefined) { params.push(paciente_id); sets.push(`paciente_id=$${params.length}`); }
    if (forma_pagamento !== undefined) { params.push(forma_pagamento); sets.push(`forma_pagamento=$${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status=$${params.length}`); }
    if (vencimento !== undefined) { params.push(vencimento); sets.push(`vencimento=$${params.length}`); }
    if (observacoes !== undefined) { params.push(observacoes); sets.push(`observacoes=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE financeiro SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Lançamento não encontrado' });
    const { rows } = await pool.query('SELECT * FROM financeiro WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/financeiro/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM financeiro WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Lançamento não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — BANK ACCOUNTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/banks', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM fin_bank_accounts WHERE active=true AND tenant_id = $1 ORDER BY created_at', [user.tenant_id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/banks', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { name, bank, agency, account, type, balance, color } = req.body;
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_bank_accounts (id,name,bank,agency,account,type,balance,color,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, name, bank, agency || '', account || '', type || 'corrente', balance || 0, color || 'hsl(217,91%,60%)', user.tenant_id]
    );
    const { rows } = await pool.query('SELECT * FROM fin_bank_accounts WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/fin/banks/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const fields = ['name','bank','agency','account','type','balance','color'];
    const sets = []; const params = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); } });
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE fin_bank_accounts SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    const { rows } = await pool.query('SELECT * FROM fin_bank_accounts WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/fin/banks/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('UPDATE fin_bank_accounts SET active=false WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — EMPLOYEES
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/employees', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM fin_employees WHERE active=true AND tenant_id=$1 ORDER BY name', [user.tenant_id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/employees', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { name, role, cpf, admission_date, salary, benefits, bank_account_id } = req.body;
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_employees (id,name,role,cpf,admission_date,salary,benefits,bank_account_id,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, name, role, cpf || '', admission_date || '', salary || 0, benefits || 0, bank_account_id || null, user.tenant_id]
    );
    const { rows } = await pool.query('SELECT * FROM fin_employees WHERE id=$1 AND tenant_id=$2', [id, user.tenant_id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/fin/employees/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('UPDATE fin_employees SET active=false WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Funcionário não encontrado' });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — PAYROLLS
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/payrolls', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { month } = req.query;
    let q = 'SELECT * FROM fin_payrolls WHERE tenant_id = $1'; 
    const params = [user.tenant_id];
    if (month) { params.push(month); q += ` AND month=$${params.length}`; }
    q += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/payrolls', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { employee_id, employee_name, month, gross_salary, benefits, deductions, net_salary, status, payment_date, bank_account_id } = req.body;
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_payrolls (id,employee_id,employee_name,month,gross_salary,benefits,deductions,net_salary,status,payment_date,bank_account_id,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [id, employee_id, employee_name, month, gross_salary || 0, benefits || 0, deductions || 0, net_salary || 0, status || 'pendente', payment_date || null, bank_account_id || null, user.tenant_id]
    );
    const { rows } = await pool.query('SELECT * FROM fin_payrolls WHERE id=$1 AND tenant_id=$2', [id, user.tenant_id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/fin/payrolls/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const fields = ['status','payment_date','bank_account_id'];
    const sets = []; const params = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); } });
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE fin_payrolls SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Folha não encontrada' });
    const { rows } = await pool.query('SELECT * FROM fin_payrolls WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — BILLS (Contas a Pagar)
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/bills', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM fin_bills WHERE tenant_id=$1 ORDER BY due_date DESC', [user.tenant_id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/bills', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { description, category, value, due_date, status, supplier, recurrent } = req.body;
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_bills (id,description,category,value,due_date,status,supplier,recurrent,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, description, category, value, due_date, status || 'pendente', supplier || null, recurrent || false, user.tenant_id]
    );
    const { rows } = await pool.query('SELECT * FROM fin_bills WHERE id=$1 AND tenant_id=$2', [id, user.tenant_id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/fin/bills/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const fields = ['description','category','value','due_date','status','supplier','bank_account_id','payment_date','recurrent'];
    const sets = []; const params = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); } });
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE fin_bills SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    const { rows } = await pool.query('SELECT * FROM fin_bills WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/fin/bills/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM fin_bills WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — MOVEMENTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/movements', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM fin_movements WHERE tenant_id=$1 ORDER BY created_at DESC', [user.tenant_id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/movements', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { type, description, category, value, date, bank_account_id, bank_name, patient, bill_id, payroll_id } = req.body;
    if (bank_account_id) {
      const { rows: bank } = await pool.query('SELECT 1 FROM fin_bank_accounts WHERE id=$1 AND tenant_id=$2', [bank_account_id, user.tenant_id]);
      if (bank.length === 0) return res.status(404).json({ error: 'Conta não encontrada' });
    }
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_movements (id,type,description,category,value,date,bank_account_id,bank_name,patient,bill_id,payroll_id,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [id, type, description, category, value, date, bank_account_id || null, bank_name || '', patient || null, bill_id || null, payroll_id || null, user.tenant_id]
    );
    // Update bank balance
    if (bank_account_id) {
      const op = type === 'entrada' ? '+' : '-';
      await pool.query(`UPDATE fin_bank_accounts SET balance = balance ${op} $1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [value, bank_account_id, user.tenant_id]);
    }
    const { rows } = await pool.query('SELECT * FROM fin_movements WHERE id=$1 AND tenant_id=$2', [id, user.tenant_id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — OVERDUE (Inadimplentes)
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/overdue', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM fin_overdue WHERE tenant_id=$1 ORDER BY days_late DESC', [user.tenant_id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/overdue', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { patient, value, days_late, procedure: proc } = req.body;
    const id = randomUUID();
    await pool.query('INSERT INTO fin_overdue (id,patient,value,days_late,procedure,tenant_id) VALUES ($1,$2,$3,$4,$5,$6)', [id, patient, value, days_late || 0, proc || '', user.tenant_id]);
    const { rows } = await pool.query('SELECT * FROM fin_overdue WHERE id=$1 AND tenant_id=$2', [id, user.tenant_id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/fin/overdue/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM fin_overdue WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Registro não encontrado' });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// ESTOQUE — FULL CRUD + MOVIMENTAÇÕES
// ═══════════════════════════════════════════════════════════════

app.get('/api/estoque', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM estoque WHERE tenant_id=$1 ORDER BY nome ASC', [user.tenant_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/estoque', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, categoria, quantidade, quantidade_minima, unidade, valor_unitario, fornecedor, localizacao, validade, lote } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO estoque (id, nome, categoria, quantidade, quantidade_minima, unidade, valor_unitario, fornecedor, localizacao, validade, lote, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [id, nome, categoria, quantidade || 0, quantidade_minima || 5, unidade || 'un', valor_unitario, fornecedor, localizacao, validade, lote, user.tenant_id]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/estoque/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, categoria, quantidade, quantidade_minima, unidade, valor_unitario, fornecedor, localizacao, validade, lote } = req.body;
    const sets = []; const params = [];
    if (nome !== undefined) { params.push(nome); sets.push(`nome=$${params.length}`); }
    if (categoria !== undefined) { params.push(categoria); sets.push(`categoria=$${params.length}`); }
    if (quantidade !== undefined) { params.push(quantidade); sets.push(`quantidade=$${params.length}`); }
    if (quantidade_minima !== undefined) { params.push(quantidade_minima); sets.push(`quantidade_minima=$${params.length}`); }
    if (unidade !== undefined) { params.push(unidade); sets.push(`unidade=$${params.length}`); }
    if (valor_unitario !== undefined) { params.push(valor_unitario); sets.push(`valor_unitario=$${params.length}`); }
    if (fornecedor !== undefined) { params.push(fornecedor); sets.push(`fornecedor=$${params.length}`); }
    if (localizacao !== undefined) { params.push(localizacao); sets.push(`localizacao=$${params.length}`); }
    if (validade !== undefined) { params.push(validade); sets.push(`validade=$${params.length}`); }
    if (lote !== undefined) { params.push(lote); sets.push(`lote=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE estoque SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Item não encontrado' });
    const { rows } = await pool.query('SELECT * FROM estoque WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/estoque/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM estoque WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Item não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/estoque-movimentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query(`
      SELECT em.*, e.nome as item_nome FROM estoque_movimentos em
      LEFT JOIN estoque e ON e.id = em.item_id AND e.tenant_id = em.tenant_id
      WHERE em.tenant_id = $1
      ORDER BY em.created_at DESC LIMIT 100
    `, [user.tenant_id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});


app.get('/api/estoque/:id/movimentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: item } = await pool.query('SELECT 1 FROM estoque WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (item.length === 0) return res.status(404).json({ error: 'Item não encontrado' });
    const { rows } = await pool.query('SELECT * FROM estoque_movimentos WHERE item_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, user.tenant_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/estoque/:id/movimentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { tipo, quantidade, motivo, usuario_nome } = req.body;
    const { rows: item } = await pool.query('SELECT 1 FROM estoque WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (item.length === 0) return res.status(404).json({ error: 'Item não encontrado' });
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO estoque_movimentos (id, item_id, tipo, quantidade, motivo, usuario_nome, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, req.params.id, tipo, quantidade, motivo, usuario_nome, user.tenant_id]
    );
    // Update stock quantity
    const delta = tipo === 'entrada' ? quantidade : -quantidade;
    await pool.query('UPDATE estoque SET quantidade = GREATEST(0, quantidade + $1), updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [delta, req.params.id, user.tenant_id]);
    const { rows } = await pool.query('SELECT * FROM estoque WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json({ success: true, item: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TRATAMENTOS — FULL CRUD + ETAPAS
// ═══════════════════════════════════════════════════════════════

app.get('/api/tratamentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { paciente_id } = req.query;
    let query = `SELECT t.*, p.nome as paciente_nome, d.nome as dentista_nome
      FROM tratamentos t
      LEFT JOIN pacientes p ON t.paciente_id = p.id AND p.tenant_id = t.tenant_id
      LEFT JOIN dentistas d ON t.dentista_id = d.id AND d.tenant_id = t.tenant_id WHERE t.tenant_id = $1`;
    const params = [user.tenant_id];
    if (paciente_id) { params.push(paciente_id); query += ` AND t.paciente_id=$${params.length}`; }
    query += ' ORDER BY t.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tratamentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { paciente_id, dentista_id, descricao, dente, valor, status, plano, observacoes } = req.body;
    const refErro = await validarReferenciasDoTenant(user.tenant_id, { pacienteId: paciente_id, dentistaId: dentista_id });
    if (refErro) return res.status(400).json({ error: refErro });
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO tratamentos (id, paciente_id, dentista_id, descricao, dente, valor, status, plano, observacoes, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, paciente_id, dentista_id, descricao, dente, valor, status || 'planejado', plano, observacoes, user.tenant_id]
    );
    try {
      broadcastSSE('tratamento_changed', {
        action: 'created', id, paciente_id, dentista_id, descricao, dente, valor,
        status: status || 'planejado', plano, observacoes, ts: Date.now(),
      }, user.tenant_id);
    } catch (e) { console.error('SSE tratamento_changed error:', e); }
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tratamentos/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { descricao, dente, valor, status, plano, observacoes, dentista_id } = req.body;
    const refErro = await validarReferenciasDoTenant(user.tenant_id, { dentistaId: dentista_id });
    if (refErro) return res.status(400).json({ error: refErro });
    const sets = []; const params = [];
    if (descricao !== undefined) { params.push(descricao); sets.push(`descricao=$${params.length}`); }
    if (dente !== undefined) { params.push(dente); sets.push(`dente=$${params.length}`); }
    if (valor !== undefined) { params.push(valor); sets.push(`valor=$${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status=$${params.length}`); }
    if (plano !== undefined) { params.push(plano); sets.push(`plano=$${params.length}`); }
    if (observacoes !== undefined) { params.push(observacoes); sets.push(`observacoes=$${params.length}`); }
    if (dentista_id !== undefined) { params.push(dentista_id); sets.push(`dentista_id=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE tratamentos SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id = $${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Tratamento não encontrado' });
    const { rows } = await pool.query('SELECT * FROM tratamentos WHERE id=$1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    try {
      broadcastSSE('tratamento_changed', {
        action: 'updated', id: req.params.id,
        paciente_id: rows[0]?.paciente_id, dentista_id: rows[0]?.dentista_id,
        descricao: rows[0]?.descricao, dente: rows[0]?.dente, valor: rows[0]?.valor,
        status: rows[0]?.status, plano: rows[0]?.plano, observacoes: rows[0]?.observacoes,
        ts: Date.now(),
      }, user.tenant_id);
    } catch (e) { console.error('SSE tratamento_changed error:', e); }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tratamentos/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: prev } = await pool.query('SELECT paciente_id, dentista_id FROM tratamentos WHERE id=$1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    const { rowCount } = await pool.query('DELETE FROM tratamentos WHERE id=$1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Tratamento não encontrado' });
    try {
      broadcastSSE('tratamento_changed', {
        action: 'deleted', id: req.params.id,
        paciente_id: prev[0]?.paciente_id, dentista_id: prev[0]?.dentista_id,
        ts: Date.now(),
      }, user.tenant_id);
    } catch (e) { console.error('SSE tratamento_changed error:', e); }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Etapas de tratamento
app.get('/api/tratamentos/:id/etapas', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: trat } = await pool.query('SELECT 1 FROM tratamentos WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (trat.length === 0) return res.status(404).json({ error: 'Tratamento não encontrado' });
    const { rows } = await pool.query(
      `SELECT e.*, d.nome as dentista_nome FROM tratamento_etapas e
       LEFT JOIN dentistas d ON e.dentista_id = d.id AND d.tenant_id = e.tenant_id
       WHERE e.tratamento_id=$1 AND e.tenant_id=$2 ORDER BY e.ordem ASC, e.created_at ASC`,
      [req.params.id, user.tenant_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tratamentos/:id/etapas', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { descricao, dente, valor, status, dentista_id, observacoes, ordem } = req.body;
    const { rows: trat } = await pool.query('SELECT 1 FROM tratamentos WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (trat.length === 0) return res.status(404).json({ error: 'Tratamento não encontrado' });
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO tratamento_etapas (id, tratamento_id, descricao, dente, valor, status, dentista_id, observacoes, ordem, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, req.params.id, descricao, dente, valor || 0, status || 'pendente', dentista_id, observacoes, ordem || 0, user.tenant_id]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tratamentos/etapas/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { descricao, dente, valor, status, dentista_id, observacoes, ordem, data_realizada } = req.body;
    const sets = []; const params = [];
    if (descricao !== undefined) { params.push(descricao); sets.push(`descricao=$${params.length}`); }
    if (dente !== undefined) { params.push(dente); sets.push(`dente=$${params.length}`); }
    if (valor !== undefined) { params.push(valor); sets.push(`valor=$${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status=$${params.length}`); }
    if (dentista_id !== undefined) { params.push(dentista_id); sets.push(`dentista_id=$${params.length}`); }
    if (observacoes !== undefined) { params.push(observacoes); sets.push(`observacoes=$${params.length}`); }
    if (ordem !== undefined) { params.push(ordem); sets.push(`ordem=$${params.length}`); }
    if (data_realizada !== undefined) { params.push(data_realizada); sets.push(`data_realizada=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE tratamento_etapas SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Etapa não encontrada' });
    const { rows } = await pool.query('SELECT * FROM tratamento_etapas WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tratamentos/etapas/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM tratamento_etapas WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Etapa não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// COMISSÕES — FULL CRUD
// ═══════════════════════════════════════════════════════════════

app.get('/api/comissoes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { dentista_id, status: statusFilter, mes, ano } = req.query;
    let query = `SELECT c.*, d.nome as dentista_nome, p.nome as paciente_nome
      FROM comissoes c
      LEFT JOIN dentistas d ON c.dentista_id = d.id AND d.tenant_id = c.tenant_id
      LEFT JOIN pacientes p ON c.paciente_id = p.id AND p.tenant_id = c.tenant_id WHERE c.tenant_id = $1`;
    const params = [user.tenant_id];
    if (dentista_id) { params.push(dentista_id); query += ` AND c.dentista_id=$${params.length}`; }
    if (statusFilter) { params.push(statusFilter); query += ` AND c.status=$${params.length}`; }
    if (mes && ano) { params.push(mes, ano); query += ` AND EXTRACT(MONTH FROM c.data)=$${params.length - 1} AND EXTRACT(YEAR FROM c.data)=$${params.length}`; }
    query += ' ORDER BY c.data DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/comissoes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { dentista_id, tratamento_id, paciente_id, valor, percentual, data, procedimento, descricao, status } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO comissoes (id, dentista_id, tratamento_id, paciente_id, valor, percentual, data, procedimento, descricao, status, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, dentista_id, tratamento_id, paciente_id, valor, percentual, data || new Date().toISOString().split('T')[0], procedimento, descricao, status || 'pendente', user.tenant_id]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/comissoes/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { valor, percentual, status, pago, descricao } = req.body;
    const sets = []; const params = [];
    if (valor !== undefined) { params.push(valor); sets.push(`valor=$${params.length}`); }
    if (percentual !== undefined) { params.push(percentual); sets.push(`percentual=$${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status=$${params.length}`); }
    if (pago !== undefined) { params.push(pago); sets.push(`pago=$${params.length}`); }
    if (descricao !== undefined) { params.push(descricao); sets.push(`descricao=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE comissoes SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Comissão não encontrada' });
    const { rows } = await pool.query('SELECT * FROM comissoes WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/comissoes/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM comissoes WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Comissão não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PRONTUÁRIOS — FULL CRUD
// ═══════════════════════════════════════════════════════════════

app.get('/api/prontuarios', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { paciente_id } = req.query;
    let query = `SELECT pr.*, p.nome as paciente_nome, d.nome as dentista_nome
      FROM prontuarios pr
      LEFT JOIN pacientes p ON pr.paciente_id = p.id AND p.tenant_id = pr.tenant_id
      LEFT JOIN dentistas d ON pr.dentista_id = d.id AND d.tenant_id = pr.tenant_id WHERE pr.tenant_id = $1`;
    const params = [user.tenant_id];
    if (paciente_id) { params.push(paciente_id); query += ` AND pr.paciente_id=$${params.length}`; }
    query += ' ORDER BY pr.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/prontuarios', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { paciente_id, dentista_id, descricao, tipo, titulo, odontograma, anexos } = req.body;
    if (paciente_id) {
      const { rows: pac } = await pool.query('SELECT 1 FROM pacientes WHERE id=$1 AND tenant_id=$2', [paciente_id, user.tenant_id]);
      if (pac.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO prontuarios (id, paciente_id, dentista_id, descricao, tipo, titulo, odontograma, anexos, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, paciente_id, dentista_id, descricao, tipo || 'evolucao', titulo, odontograma ? JSON.stringify(odontograma) : '{}', anexos ? JSON.stringify(anexos) : '[]', user.tenant_id]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/prontuarios/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { descricao, tipo, titulo, odontograma, anexos } = req.body;
    const sets = []; const params = [];
    if (descricao !== undefined) { params.push(descricao); sets.push(`descricao=$${params.length}`); }
    if (tipo !== undefined) { params.push(tipo); sets.push(`tipo=$${params.length}`); }
    if (titulo !== undefined) { params.push(titulo); sets.push(`titulo=$${params.length}`); }
    if (odontograma !== undefined) { params.push(JSON.stringify(odontograma)); sets.push(`odontograma=$${params.length}`); }
    if (anexos !== undefined) { params.push(JSON.stringify(anexos)); sets.push(`anexos=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE prontuarios SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Prontuário não encontrado' });
    const { rows } = await pool.query('SELECT * FROM prontuarios WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/prontuarios/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM prontuarios WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Prontuário não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ORÇAMENTOS — POST completo (missing)
// ═══════════════════════════════════════════════════════════════

/**
 * Para cada item do orçamento que referencie `procedimento_id` mas não tenha
 * `procedimento_versao_id`, congela a versão atualmente vigente — assim o
 * orçamento mantém preços/requisitos históricos mesmo se o catálogo mudar.
 */
async function congelarVersoesItens(itens, tenantId) {
  if (!Array.isArray(itens) || itens.length === 0) return itens || [];
  const out = [];
  for (const it of itens) {
    if (it && it.procedimento_id && !it.procedimento_versao_id) {
      const { rows } = await pool.query(
        `SELECT v.id, v.versao FROM procedimentos_catalogo_versoes v
         JOIN procedimentos_catalogo pc ON pc.id = v.procedimento_id AND pc.tenant_id = $2
         WHERE v.procedimento_id=$1 AND v.valido_ate IS NULL
         ORDER BY v.versao DESC LIMIT 1`,
        [it.procedimento_id, tenantId]
      );
      if (rows[0]) {
        out.push({ ...it, procedimento_versao_id: rows[0].id, procedimento_versao: rows[0].versao });
        continue;
      }
    }
    out.push(it);
  }
  return out;
}

app.post('/api/orcamentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const {
      paciente_id, dentista_id, itens, valor_total, desconto, status, validade,
      observacoes, forma_pagamento, parcelas, titulo, print_config, odontograma_snapshot,
    } = req.body;
    const itensCongelados = await congelarVersoesItens(itens, user.tenant_id);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO orcamentos (
        id, paciente_id, dentista_id, itens, valor_total, desconto, status, validade,
        observacoes, forma_pagamento, parcelas, titulo, print_config, odontograma_snapshot, tenant_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, paciente_id, dentista_id, JSON.stringify(itensCongelados),
        valor_total, desconto || 0, status || 'pendente', validade,
        observacoes, forma_pagamento, parcelas || 1,
        titulo || null,
        print_config ? JSON.stringify(print_config) : null,
        odontograma_snapshot ? JSON.stringify(odontograma_snapshot) : null,
        user.tenant_id,
      ]
    );
    res.json({ id, success: true });
  } catch (error) {
    console.error('❌ POST orcamento:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orcamentos/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const {
      itens, valor_total, desconto, status, validade, observacoes,
      forma_pagamento, parcelas, titulo, print_config, odontograma_snapshot,
    } = req.body;
    const sets = []; const params = [];
    if (itens !== undefined) {
      const itensCongelados = await congelarVersoesItens(itens, user.tenant_id);
      params.push(JSON.stringify(itensCongelados)); sets.push(`itens=$${params.length}`);
    }
    if (valor_total !== undefined) { params.push(valor_total); sets.push(`valor_total=$${params.length}`); }
    if (desconto !== undefined) { params.push(desconto); sets.push(`desconto=$${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status=$${params.length}`); }
    if (validade !== undefined) { params.push(validade); sets.push(`validade=$${params.length}`); }
    if (observacoes !== undefined) { params.push(observacoes); sets.push(`observacoes=$${params.length}`); }
    if (forma_pagamento !== undefined) { params.push(forma_pagamento); sets.push(`forma_pagamento=$${params.length}`); }
    if (parcelas !== undefined) { params.push(parcelas); sets.push(`parcelas=$${params.length}`); }
    if (titulo !== undefined) { params.push(titulo); sets.push(`titulo=$${params.length}`); }
    if (print_config !== undefined) { params.push(JSON.stringify(print_config)); sets.push(`print_config=$${params.length}`); }
    if (odontograma_snapshot !== undefined) { params.push(JSON.stringify(odontograma_snapshot)); sets.push(`odontograma_snapshot=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rowCount } = await pool.query(`UPDATE orcamentos SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
    if (rowCount === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    const { rows } = await pool.query('SELECT * FROM orcamentos WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orcamentos/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM orcamentos WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PROCEDIMENTOS — Catálogo + Versionamento (Fase B)
// ═══════════════════════════════════════════════════════════════

/**
 * Cria uma nova versão imutável do procedimento (snapshot histórico).
 * - Fecha a versão anterior preenchendo `valido_ate`.
 * - Incrementa `versao_atual` no procedimento.
 * - Retorna o registro da versão criada.
 */
async function criarVersaoProcedimento(client, procedimentoId, motivo, alteradoPor) {
  // Busca o estado atual do procedimento (após o UPDATE/INSERT)
  const { rows } = await client.query(
    'SELECT * FROM procedimentos_catalogo WHERE id=$1',
    [procedimentoId]
  );
  if (!rows[0]) return null;
  const p = rows[0];

  // Fecha versão anterior (se existir)
  await client.query(
    `UPDATE procedimentos_catalogo_versoes
       SET valido_ate = NOW()
     WHERE procedimento_id = $1 AND valido_ate IS NULL`,
    [procedimentoId]
  );

  // Próxima versão sequencial
  const { rows: maxRows } = await client.query(
    `SELECT COALESCE(MAX(versao), 0) AS m FROM procedimentos_catalogo_versoes WHERE procedimento_id=$1`,
    [procedimentoId]
  );
  const proximaVersao = Number(maxRows[0].m) + 1;

  const versaoId = crypto.randomUUID();
  await client.query(
    `INSERT INTO procedimentos_catalogo_versoes
      (id, procedimento_id, versao, codigo, nome, categoria,
       valor_particular, valor_convenio, duracao_minutos, cor,
       requer_dente, requer_face, descricao, motivo, alterado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      versaoId, procedimentoId, proximaVersao,
      p.codigo, p.nome, p.categoria,
      p.valor_particular, p.valor_convenio, p.duracao_minutos, p.cor,
      p.requer_dente, p.requer_face, p.descricao,
      motivo || null, alteradoPor || null,
    ]
  );

  // Atualiza versao_atual no registro vivo
  await client.query(
    `UPDATE procedimentos_catalogo SET versao_atual=$1 WHERE id=$2`,
    [proximaVersao, procedimentoId]
  );

  return { id: versaoId, versao: proximaVersao };
}

/** Detecta se uma alteração realmente justifica nova versão (campos relevantes para histórico) */
function alteracaoExigeVersao(antes, depois) {
  const camposVersionaveis = [
    'codigo', 'nome', 'categoria', 'valor_particular', 'valor_convenio',
    'duracao_minutos', 'requer_dente', 'requer_face', 'descricao',
  ];
  return camposVersionaveis.some((c) => {
    if (depois[c] === undefined) return false;
    // normaliza numéricos para comparação tolerante
    const a = antes[c];
    const b = depois[c];
    if (typeof a === 'number' || typeof b === 'number') return Number(a) !== Number(b);
    return String(a ?? '') !== String(b ?? '');
  });
}

app.get('/api/procedimentos-catalogo', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query(
      `SELECT * FROM procedimentos_catalogo WHERE ativo = true AND tenant_id = $1 ORDER BY categoria NULLS LAST, nome ASC`,
      [user.tenant_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

app.post('/api/procedimentos-catalogo', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const {
      codigo, nome, categoria, valor_particular, valor_convenio,
      duracao_minutos, cor, requer_dente, requer_face, descricao,
    } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    await client.query('BEGIN');
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO procedimentos_catalogo
        (id, codigo, nome, categoria, valor_particular, valor_convenio, duracao_minutos, cor, requer_dente, requer_face, descricao, versao_atual, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12)`,
      [id, codigo || null, nome, categoria || null,
       valor_particular || 0, valor_convenio || 0, duracao_minutos || 30,
       cor || '#0d9488', requer_dente !== false, !!requer_face, descricao || null, user.tenant_id]
    );
    // Versão inicial (motivo: criação)
    await criarVersaoProcedimento(client, id, 'criação', user?.id || null);
    await client.query('COMMIT');

    const { rows } = await pool.query('SELECT * FROM procedimentos_catalogo WHERE id=$1 AND tenant_id=$2', [id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.put('/api/procedimentos-catalogo/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const procId = req.params.id;
    const fields = ['codigo','nome','categoria','valor_particular','valor_convenio','duracao_minutos','cor','requer_dente','requer_face','descricao','ativo'];

    // Snapshot anterior (para decidir se cria nova versão)
    const { rows: beforeRows } = await client.query('SELECT * FROM procedimentos_catalogo WHERE id=$1 AND tenant_id=$2', [procId, user.tenant_id]);
    const antes = beforeRows[0];
    if (!antes) return res.status(404).json({ error: 'Procedimento não encontrado' });

    const sets = []; const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });

    await client.query('BEGIN');
    params.push(procId, user.tenant_id);
    await client.query(`UPDATE procedimentos_catalogo SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);

    // Cria nova versão somente se houve mudança em campo versionável
    let novaVersao = null;
    if (alteracaoExigeVersao(antes, req.body)) {
      novaVersao = await criarVersaoProcedimento(
        client,
        procId,
        req.body.motivo_versao || 'atualização',
        user?.id || null
      );
    }
    await client.query('COMMIT');

    const { rows } = await pool.query('SELECT * FROM procedimentos_catalogo WHERE id=$1 AND tenant_id=$2', [procId, user.tenant_id]);
    res.json({ ...rows[0], _nova_versao: novaVersao });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/procedimentos-catalogo/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('UPDATE procedimentos_catalogo SET ativo=false, updated_at=NOW() WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Procedimento não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Histórico completo de versões de um procedimento
app.get('/api/procedimentos-catalogo/:id/versoes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: proc } = await pool.query('SELECT 1 FROM procedimentos_catalogo WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (proc.length === 0) return res.status(404).json({ error: 'Procedimento não encontrado' });
    const { rows } = await pool.query(
      `SELECT * FROM procedimentos_catalogo_versoes
       WHERE procedimento_id=$1
       ORDER BY versao DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Resolve a versão vigente em uma data específica (para reabrir orçamentos antigos)
app.get('/api/procedimentos-catalogo/:id/versao-em', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { data } = req.query; // ISO string
    if (!data) return res.status(400).json({ error: 'parâmetro `data` (ISO) obrigatório' });
    const { rows: proc } = await pool.query('SELECT 1 FROM procedimentos_catalogo WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (proc.length === 0) return res.status(404).json({ error: 'Procedimento não encontrado' });
    const { rows } = await pool.query(
      `SELECT * FROM procedimentos_catalogo_versoes
       WHERE procedimento_id=$1
         AND valido_desde <= $2
         AND (valido_ate IS NULL OR valido_ate > $2)
       ORDER BY versao DESC LIMIT 1`,
      [req.params.id, data]
    );
    res.json(rows[0] || null);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// FASE C — EXECUÇÃO DE PROCEDIMENTOS + ASSINATURAS ELETRÔNICAS
// ═══════════════════════════════════════════════════════════════

// Lista execuções de um orçamento
app.get('/api/orcamentos/:id/execucoes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: orc } = await pool.query('SELECT 1 FROM orcamentos WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (orc.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    const { rows } = await pool.query(
      `SELECT e.*, d.nome as dentista_nome,
              a.assinatura_base64, a.latitude, a.longitude, a.accuracy_m
       FROM procedimento_execucoes e
       LEFT JOIN dentistas d ON e.dentista_id = d.id AND d.tenant_id = $2
       LEFT JOIN assinaturas_eletronicas a ON e.assinatura_id = a.id
       WHERE e.orcamento_id = $1
       ORDER BY e.executado_em DESC`,
      [req.params.id, user.tenant_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Lista execuções de um paciente (histórico clínico-financeiro)
app.get('/api/pacientes/:id/execucoes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: pac } = await pool.query('SELECT 1 FROM pacientes WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
    if (pac.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    const { rows } = await pool.query(
      `SELECT e.*, d.nome as dentista_nome
       FROM procedimento_execucoes e
       LEFT JOIN dentistas d ON e.dentista_id = d.id AND d.tenant_id = $2
       WHERE e.paciente_id = $1
       ORDER BY e.executado_em DESC`,
      [req.params.id, user.tenant_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Cria uma execução (com ou sem assinatura)
app.post('/api/execucoes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const {
      orcamento_id, orcamento_item_id, paciente_id, dentista_id,
      procedimento_id, procedimento_nome, dente, faces, valor, observacoes,
      assinatura, // { base64, lat, lng, accuracy, canal, codigo }
    } = req.body;

    if (!paciente_id || !procedimento_nome) {
      return res.status(400).json({ error: 'paciente_id e procedimento_nome são obrigatórios' });
    }

    // Paciente, orçamento e dentista precisam ser da clínica
    const { rows: pacOk } = await pool.query('SELECT 1 FROM pacientes WHERE id=$1 AND tenant_id=$2', [paciente_id, user.tenant_id]);
    if (pacOk.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });
    if (orcamento_id) {
      const { rows: orcOk } = await pool.query('SELECT 1 FROM orcamentos WHERE id=$1 AND tenant_id=$2', [orcamento_id, user.tenant_id]);
      if (orcOk.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    }
    if (dentista_id) {
      const { rows: denOk } = await pool.query('SELECT 1 FROM dentistas WHERE id=$1 AND tenant_id=$2', [dentista_id, user.tenant_id]);
      if (denOk.length === 0) return res.status(404).json({ error: 'Dentista não encontrado' });
    }

    let assinaturaId = null;
    if (assinatura?.base64) {
      // Bloqueio LGPD: assinatura sem consentimento explícito é rejeitada
      if (!assinatura.consentimento_aceito) {
        return res.status(400).json({
          error: 'Consentimento LGPD obrigatório para registrar assinatura eletrônica.',
        });
      }
      const aId = crypto.randomUUID();
      const assinaturaSql = (withTenant) => `INSERT INTO assinaturas_eletronicas
          (id, paciente_id, dentista_id, contexto, assinatura_base64,
           latitude, longitude, accuracy_m, ip_address, user_agent,
           verificacao_canal, verificacao_codigo, verificacao_em,
           consentimento_aceito, consentimento_em, consentimento_versao, consentimento_texto${withTenant ? ', tenant_id' : ''})
         VALUES ($1,$2,$3,'execucao',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16${withTenant ? ',$17' : ''})`;
      const assinaturaParams = [
          aId, paciente_id, dentista_id || null, assinatura.base64,
          assinatura.lat ?? null, assinatura.lng ?? null, assinatura.accuracy ?? null,
          req.ip || req.headers['x-forwarded-for'] || null,
          req.headers['user-agent'] || null,
          assinatura.canal || 'none',
          assinatura.codigo || null,
          assinatura.codigo ? new Date() : null,
          true,
          assinatura.consentimento_em ? new Date(assinatura.consentimento_em) : new Date(),
          assinatura.consentimento_versao || '1.0',
          assinatura.consentimento_texto || null,
        ];
      try {
        await pool.query(assinaturaSql(true), [...assinaturaParams, user.tenant_id]);
      } catch (sigErr) {
        // 42703: coluna tenant_id ainda não criada (migração pendente)
        if (sigErr.code !== '42703') throw sigErr;
        await pool.query(assinaturaSql(false), assinaturaParams);
      }
      assinaturaId = aId;
    }

    const id = crypto.randomUUID();
    const execParams = [
      id, orcamento_id || null, orcamento_item_id || null,
      paciente_id, dentista_id || null,
      procedimento_id || null, procedimento_nome,
      dente || null, JSON.stringify(faces || []),
      valor || 0, observacoes || null, assinaturaId,
    ];
    try {
      await pool.query(
        `INSERT INTO procedimento_execucoes
          (id, orcamento_id, orcamento_item_id, paciente_id, dentista_id,
           procedimento_id, procedimento_nome, dente, faces, valor, observacoes, assinatura_id, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [...execParams, user.tenant_id]
      );
    } catch (insErr) {
      // 42703: coluna tenant_id ainda não criada (migração pendente) — escopo garantido pelo paciente/orçamento validados acima
      if (insErr.code !== '42703') throw insErr;
      await pool.query(
        `INSERT INTO procedimento_execucoes
          (id, orcamento_id, orcamento_item_id, paciente_id, dentista_id,
           procedimento_id, procedimento_nome, dente, faces, valor, observacoes, assinatura_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        execParams
      );
    }

    // Se todos os itens do orçamento foram executados → marca como 'finalizado'
    if (orcamento_id) {
      const { rows: orc } = await pool.query('SELECT itens FROM orcamentos WHERE id=$1 AND tenant_id=$2', [orcamento_id, user.tenant_id]);
      if (orc[0]) {
        let itens = orc[0].itens;
        if (typeof itens === 'string') { try { itens = JSON.parse(itens); } catch { itens = []; } }
        const totalItens = Array.isArray(itens) ? itens.length : 0;
        const { rows: cnt } = await pool.query(
          'SELECT COUNT(*)::int as c FROM procedimento_execucoes WHERE orcamento_id=$1', [orcamento_id]
        );
        if (totalItens > 0 && cnt[0].c >= totalItens) {
          await pool.query(`UPDATE orcamentos SET status='finalizado', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status NOT IN ('reprovado','finalizado')`, [orcamento_id, user.tenant_id]);
        } else if (totalItens > 0) {
          await pool.query(`UPDATE orcamentos SET status='em_tratamento', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='aprovado'`, [orcamento_id, user.tenant_id]);
        }
      }
    }

    const { rows } = await pool.query('SELECT * FROM procedimento_execucoes WHERE id=$1', [id]);
    res.json({ ...rows[0], assinatura_id: assinaturaId });
  } catch (error) {
    console.error('❌ POST execucao:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Remove uma execução (apenas se não tiver assinatura — segurança LGPD/MP 2200-2)
app.delete('/api/execucoes/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT e.assinatura_id FROM procedimento_execucoes e WHERE e.id=$1 AND EXISTS (SELECT 1 FROM pacientes p WHERE p.id::text = e.paciente_id::text AND p.tenant_id = $2)', [req.params.id, user.tenant_id]);
    if (!rows[0]) return res.status(404).json({ error: 'Execução não encontrada' });
    if (rows[0].assinatura_id) {
      return res.status(403).json({ error: 'Execução assinada eletronicamente não pode ser removida (MP 2200-2/2001).' });
    }
    const { rowCount } = await pool.query('DELETE FROM procedimento_execucoes e WHERE e.id=$1 AND EXISTS (SELECT 1 FROM pacientes p WHERE p.id::text = e.paciente_id::text AND p.tenant_id = $2)', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Execução não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Detalhe de uma assinatura (para auditoria)
app.get('/api/assinaturas/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query(
      `SELECT a.* FROM assinaturas_eletronicas a
        WHERE a.id=$1
          AND (EXISTS (SELECT 1 FROM pacientes p WHERE p.id::text = a.paciente_id::text AND p.tenant_id = $2)
               OR EXISTS (SELECT 1 FROM procedimento_execucoes e JOIN orcamentos o ON o.id = e.orcamento_id
                           WHERE e.assinatura_id = a.id AND o.tenant_id = $2))`,
      [req.params.id, user.tenant_id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Não encontrada' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard agregado — KPIs gerais
// Dashboard KPIs (handler compartilhado: /api/dashboard e /api/dashboard/kpis)
app.get(['/api/dashboard', '/api/dashboard/kpis'], async (req, res) => {
  try {
    await verifyUser(req);
    const today = new Date().toISOString().split('T')[0];
    const firstDayOfMonth = `${today.substring(0, 7)}-01`;

    // Helper: silencia erro se a tabela ainda não existe (migration pendente)
    const safe = async (sql, params = []) => {
      try {
        return await pool.query(sql, params);
      } catch (err) {
        if (err.code === '42P01' || err.code === '42703') return { rows: [] };
        throw err;
      }
    };

    const { user } = await verifyUser(req);
    const [
      pacientesTotal,
      agendaHojeRows,
      receitasMes,
      despesasMes,
      orcamentosRows,
      crmLeadsRows,
      pacientesAtivos,
      pacientesInativos,
      estoqueRows,
    ] = await Promise.all([
      safe('SELECT COUNT(*)::int AS total FROM pacientes WHERE tenant_id = $1', [user.tenant_id]),
      safe('SELECT status, COUNT(*)::int AS qtd FROM agendamentos WHERE data = $1 AND tenant_id = $2 GROUP BY status', [today, user.tenant_id]),
      safe('SELECT COALESCE(SUM(valor), 0)::numeric AS total FROM financeiro WHERE tipo = $1 AND data >= $2 AND tenant_id = $3', ['receita', firstDayOfMonth, user.tenant_id]),
      safe('SELECT COALESCE(SUM(valor), 0)::numeric AS total FROM financeiro WHERE tipo = $1 AND data >= $2 AND tenant_id = $3', ['despesa', firstDayOfMonth, user.tenant_id]),
      safe(`SELECT status, COUNT(*)::int AS qtd, COALESCE(SUM(valor_final), 0)::numeric AS soma
            FROM orcamentos WHERE tenant_id = $1 GROUP BY status`, [user.tenant_id]),
      safe(`SELECT stage, COUNT(*)::int AS qtd FROM crm_leads WHERE tenant_id = $1 GROUP BY stage`, [user.tenant_id]),
      safe("SELECT COUNT(*)::int AS total FROM pacientes WHERE (status = 'ativo' OR status IS NULL) AND tenant_id = $1", [user.tenant_id]),
      safe("SELECT COUNT(*)::int AS total FROM pacientes WHERE status = 'inativo' AND tenant_id = $1", [user.tenant_id]),
      safe(`SELECT id, nome AS name, quantidade_atual AS current_stock,
                   quantidade_minima AS min_stock, custo_unitario AS unit_cost
            FROM estoque WHERE tenant_id = $1`, [user.tenant_id]),
    ]);

    // ── AGENDA ──────────────────────────────────────────────────
    const agendaCounts = { finalizado: 0, em_atendimento: 0, aguardando: 0, confirmado: 0, faltou: 0, encaixe: 0 };
    let agendaTotal = 0;
    for (const r of agendaHojeRows.rows) {
      agendaCounts[r.status] = Number(r.qtd);
      agendaTotal += Number(r.qtd);
    }
    const taxaPresenca = agendaTotal > 0 ? Math.round(((agendaTotal - agendaCounts.faltou) / agendaTotal) * 100) : 0;

    // ── ORÇAMENTOS ──────────────────────────────────────────────
    const orcAgg = { total: 0, pendentes: 0, aprovados: 0, reprovados: 0, valorAprovado: 0 };
    for (const r of orcamentosRows.rows) {
      const qtd = Number(r.qtd);
      const soma = Number(r.soma);
      orcAgg.total += qtd;
      if (r.status === 'pendente') orcAgg.pendentes += qtd;
      if (['aprovado', 'em_tratamento', 'finalizado'].includes(r.status)) {
        orcAgg.aprovados += qtd;
        orcAgg.valorAprovado += soma;
      }
      if (r.status === 'reprovado') orcAgg.reprovados += qtd;
    }
    const taxaConversao = orcAgg.total > 0 ? Math.round((orcAgg.aprovados / orcAgg.total) * 100) : 0;
    const ticketMedio = orcAgg.aprovados > 0 ? Math.round(orcAgg.valorAprovado / orcAgg.aprovados) : 0;

    // ── CRM ────────────────────────────────────────────────────
    let totalLeadsKanban = 0;
    let semResposta = 0;
    for (const r of crmLeadsRows.rows) {
      totalLeadsKanban += Number(r.qtd);
      if (r.stage === 'sem_resposta') semResposta = Number(r.qtd);
    }

    // ── ESTOQUE ─────────────────────────────────────────────────
    const itensAbaixo = [];
    const itensSem = [];
    let valorEstoque = 0;
    for (const item of estoqueRows.rows) {
      const cur = Number(item.current_stock || 0);
      const min = Number(item.min_stock || 0);
      const cost = Number(item.unit_cost || 0);
      valorEstoque += cur * cost;
      if (cur === 0) itensSem.push(item.name);
      else if (cur < min) itensAbaixo.push(item.name);
    }

    res.json({
      // shape legado mantido para retro-compat
      totalPacientes: Number(pacientesTotal.rows[0]?.total || 0),
      agendaHoje: agendaTotal,
      receitaMensal: Number(receitasMes.rows[0]?.total || 0),
      despesaMensal: Number(despesasMes.rows[0]?.total || 0),

      // shape expandido consumido pela tela /dashboard
      agenda: {
        total: agendaTotal,
        finalizados: agendaCounts.finalizado,
        emAtendimento: agendaCounts.em_atendimento,
        aguardando: agendaCounts.aguardando + agendaCounts.confirmado,
        faltas: agendaCounts.faltou,
        encaixes: agendaCounts.encaixe,
        taxaPresenca,
      },
      orcamentos: {
        total: orcAgg.total,
        pendentes: orcAgg.pendentes,
        aprovados: orcAgg.aprovados,
        reprovados: orcAgg.reprovados,
        valorAprovado: orcAgg.valorAprovado,
        taxaConversao,
        ticketMedio,
      },
      crm: {
        totalLeadsKanban,
        semResposta,
        ativos: Number(pacientesAtivos.rows[0]?.total || 0),
        inativos: Number(pacientesInativos.rows[0]?.total || 0),
        receitaTotal: Number(receitasMes.rows[0]?.total || 0),
      },
      pacientes: {
        totalCadastrados: Number(pacientesTotal.rows[0]?.total || 0),
      },
      estoque: {
        totalItens: estoqueRows.rows.length,
        abaixoMinimo: itensAbaixo.length,
        itensAbaixoMinimo: itensAbaixo.slice(0, 5),
        semEstoque: itensSem.length,
        itensSemEstoque: itensSem.slice(0, 5),
        valorTotalEstoque: valorEstoque,
      },
    });
  } catch (error) {
    const status = error.message === 'Unauthorized' ? 401 : 500;
    res.status(status).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// PAINEL COMERCIAL — KPIs + follow-ups + conversão por origem
// GET /api/comercial/painel?attendantId=<uuid|me>
// Quando attendantId omitido OU = 'me' e role != admin → escopo do user logado
// ═══════════════════════════════════════════════════════════════
// ─── Dashboard KPIs (por clínica) ───────────────────────────
app.get('/api/dashboard/kpis', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const tId = user.tenant_id;
    if (!tId) return res.status(403).json({ error: 'Sem clínica vinculada' });

    // Tabela/coluna ausente em instalações antigas vira lista vazia, não 500.
    const safe = async (sql) => {
      try { return (await pool.query(sql, [tId])).rows; }
      catch (err) {
        if (err.code === '42P01' || err.code === '42703') return [];
        throw err;
      }
    };
    const TODAY = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
    const [pac, agenda, movs, orcs, leads, est] = await Promise.all([
      safe('SELECT COUNT(*)::int AS n FROM pacientes WHERE tenant_id = $1'),
      safe(`SELECT status FROM agendamentos WHERE tenant_id = $1 AND data = ${TODAY}`),
      safe(`SELECT type, value FROM fin_movements WHERE tenant_id = $1 AND date >= date_trunc('month', ${TODAY})`),
      safe('SELECT status, valor_total FROM orcamentos WHERE tenant_id = $1'),
      safe('SELECT kanban_stage, status, valor, origem, paciente_id FROM crm_leads WHERE tenant_id = $1'),
      safe('SELECT nome, quantidade, quantidade_minima, valor_unitario FROM estoque WHERE tenant_id = $1'),
    ]);

    const totalPacientes = pac[0]?.n || 0;
    const count = (rows, fn) => rows.filter(fn).length;
    const finalizados = count(agenda, (a) => a.status === 'concluido' || a.status === 'finalizado' || a.status === 'realizado');
    const agendaKpis = {
      total: agenda.length,
      finalizados,
      emAtendimento: count(agenda, (a) => a.status === 'em_atendimento'),
      aguardando: count(agenda, (a) => a.status === 'agendado' || a.status === 'aguardando' || a.status === 'confirmado'),
      faltas: count(agenda, (a) => a.status === 'cancelado' || a.status === 'faltou' || a.status === 'desmarcado'),
      encaixes: count(agenda, (a) => a.status === 'encaixe'),
      taxaPresenca: agenda.length ? Math.round((finalizados / agenda.length) * 100) : 0,
    };

    const sum = (rows, fn, val) => rows.filter(fn).reduce((acc, r) => acc + Number(val(r) || 0), 0);
    const receitaMensal = sum(movs, (m) => m.type === 'entrada', (m) => m.value);
    const despesaMensal = sum(movs, (m) => m.type === 'saida', (m) => m.value);

    const aprovados = orcs.filter((o) => o.status === 'aprovado' || o.status === 'finalizado');
    const valorAprovado = sum(aprovados, () => true, (o) => o.valor_total);
    const orcamentos = {
      total: orcs.length,
      pendentes: count(orcs, (o) => o.status === 'pendente'),
      aprovados: aprovados.length,
      reprovados: count(orcs, (o) => o.status === 'reprovado'),
      valorAprovado,
      taxaConversao: orcs.length ? Math.round((aprovados.length / orcs.length) * 100) : 0,
      ticketMedio: aprovados.length ? valorAprovado / aprovados.length : 0,
    };

    // Lead convertido = orçamento aprovado no Kanban ou já vinculado a paciente.
    const leadStatus = (l) => (l.kanban_stage === 'orcamento_aprovado' || l.paciente_id) ? 'convertido'
      : l.status === 'perdido' ? 'perdido'
      : (l.kanban_stage || 'lead') === 'lead' ? 'novo' : 'ativo';
    const ls = leads.map((l) => ({ ...l, st: leadStatus(l) }));
    const crm = {
      totalLeadsKanban: ls.length,
      semResposta: count(ls, (l) => l.st === 'novo'),
      ativos: count(ls, (l) => l.st !== 'perdido' && l.st !== 'convertido'),
      inativos: count(ls, (l) => l.st === 'perdido'),
      receitaTotal: sum(ls, (l) => l.st === 'convertido', (l) => l.valor),
    };
    const origins = new Map();
    for (const l of ls) {
      const k = l.origem || 'Outros';
      const o = origins.get(k) || { leads: 0, convertidos: 0 };
      o.leads++; if (l.st === 'convertido') o.convertidos++;
      origins.set(k, o);
    }
    const conversionByOrigin = [...origins].map(([origin, o]) => ({
      origin, leads: o.leads, convertidos: o.convertidos, rate: o.leads ? (o.convertidos / o.leads) * 100 : 0,
    }));

    const qtd = (i) => Number(i.quantidade || 0);
    const abaixoMinimo = est.filter((i) => qtd(i) > 0 && qtd(i) <= Number(i.quantidade_minima || 0));
    const semEstoque = est.filter((i) => qtd(i) <= 0);
    const estoque = {
      totalItens: est.length,
      abaixoMinimo: abaixoMinimo.length,
      itensAbaixoMinimo: abaixoMinimo.map((i) => i.nome),
      semEstoque: semEstoque.length,
      itensSemEstoque: semEstoque.map((i) => i.nome),
      valorTotalEstoque: est.reduce((acc, i) => acc + Number(i.valor_unitario || 0) * qtd(i), 0),
    };

    res.json({
      totalPacientes,
      agendaHoje: agendaKpis.total,
      receitaMensal,
      despesaMensal,
      agenda: agendaKpis,
      orcamentos,
      crm,
      pacientes: { totalCadastrados: totalPacientes },
      estoque,
      conversionByOrigin,
    });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('GET /api/dashboard/kpis error:', error);
    res.status(500).json({ error: 'Erro ao calcular KPIs' });
  }
});

app.get('/api/comercial/painel', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const today = new Date().toISOString().split('T')[0];
    const requested = (req.query.attendantId || '').toString();

    // Admin pode passar attendantId arbitrário; caso contrário usa o próprio.
    const attendantId = (user.role === 'admin' && requested && requested !== 'me')
      ? requested
      : user.id;

    const safe = async (sql, params = []) => {
      try { return await pool.query(sql, params); }
      catch (err) {
        if (err.code === '42P01' || err.code === '42703') return { rows: [] };
        throw err;
      }
    };

    const [
      atendimentosHojeRows,
      agendamentosHojeRows,
      leadsPendentesRows,
      conversionRows,
      followUpsRows,
    ] = await Promise.all([
      // Atendimentos do atendente hoje (sessões assumidas hoje)
      safe(
        `SELECT COUNT(*)::int AS total
           FROM attendance_sessions
          WHERE attendant_id = $1
            AND assigned_at::date = $2
            AND tenant_id = $3`,
        [attendantId, today, user.tenant_id]
      ),
      // Agendamentos criados hoje vinculados a leads atribuídos a este atendente
      safe(
        `SELECT COUNT(*)::int AS total
           FROM agendamentos a
           LEFT JOIN crm_leads l ON l.id::text = a.paciente_id::text
          WHERE a.created_at::date = $1
            AND (l.assigned_to = $2 OR a.created_by = $2)
            AND a.tenant_id = $3`,
        [today, attendantId, user.tenant_id]
      ),
      // Leads pendentes do atendente: sem_resposta ou aguardando ação
      safe(
        `SELECT COUNT(*)::int AS total
           FROM crm_leads
          WHERE assigned_to = $1
            AND kanban_stage IN ('sem_resposta','primeiro_contato','em_negociacao')
            AND tenant_id = $2`,
        [attendantId, user.tenant_id]
      ),
      // Conversão por origem (todos leads do atendente)
      safe(
        `SELECT COALESCE(NULLIF(origem,''), 'Outros') AS origin,
                COUNT(*)::int AS leads,
                COUNT(*) FILTER (WHERE kanban_stage IN ('paciente_agendado','em_atendimento','pos_consulta','finalizado'))::int AS convertidos
           FROM crm_leads
          WHERE (assigned_to = $1 OR $1 IS NULL)
            AND tenant_id = $2
          GROUP BY origem`,
        [attendantId, user.tenant_id]
      ),
      // Follow-ups: leads com follow_up_at <= now() OU em sem_resposta
      safe(
        `SELECT id, nome AS lead_name, kanban_stage, follow_up_at, last_message, updated_at
           FROM crm_leads
          WHERE assigned_to = $1
            AND tenant_id = $2
            AND (
              (follow_up_at IS NOT NULL AND follow_up_at <= NOW() + INTERVAL '2 days')
              OR kanban_stage IN ('sem_resposta','primeiro_contato')
            )
          ORDER BY COALESCE(follow_up_at, updated_at) ASC
          LIMIT 12`,
        [attendantId, user.tenant_id]
      ),
    ]);

    const atendimentosHoje = Number(atendimentosHojeRows.rows[0]?.total || 0);
    const agendamentosHoje = Number(agendamentosHojeRows.rows[0]?.total || 0);
    const leadsPendentes = Number(leadsPendentesRows.rows[0]?.total || 0);
    const taxaConversao = atendimentosHoje > 0
      ? Math.round((agendamentosHoje / atendimentosHoje) * 100)
      : 0;

    const conversionByOrigin = conversionRows.rows.map(r => ({
      origin: r.origin,
      leads: Number(r.leads),
      convertidos: Number(r.convertidos),
      rate: Number(r.leads) > 0
        ? Math.round((Number(r.convertidos) / Number(r.leads)) * 1000) / 10
        : 0,
    }));

    const stageToType = {
      sem_resposta: 'reativacao',
      primeiro_contato: 'retorno',
      em_negociacao: 'confirmacao',
    };

    const followUps = followUpsRows.rows.map(r => ({
      id: r.id,
      leadName: r.lead_name || 'Lead sem nome',
      type: stageToType[r.kanban_stage] || 'retorno',
      scheduledAt: r.follow_up_at
        ? new Date(r.follow_up_at).toISOString()
        : new Date(r.updated_at).toISOString(),
      note: r.last_message ? String(r.last_message).slice(0, 80) : 'Sem nota',
    }));

    res.json({
      attendantId,
      kpis: { atendimentosHoje, agendamentosHoje, taxaConversao, leadsPendentes },
      followUps,
      conversionByOrigin,
    });
  } catch (error) {
    const status = error.message === 'Unauthorized' ? 401 : 500;
    res.status(status).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// PAINEL DENTISTA — agregação para um dentista (KPIs + listas)
// GET /api/dentista/painel/:id?  (sem id => auto-detect pelo email do user)
// Admin pode consultar qualquer dentista; demais só o próprio (match por email).
// ═══════════════════════════════════════════════════════════════
app.get('/api/dentista/painel/:id?', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const today = new Date().toISOString().split('T')[0];

    const safe = async (sql, params = []) => {
      try { return await pool.query(sql, params); }
      catch (err) {
        if (err.code === '42P01' || err.code === '42703') return { rows: [] };
        throw err;
      }
    };

    // Resolve dentista alvo
    let dentista = null;
    if (req.params.id) {
      const r = await safe('SELECT * FROM dentistas WHERE id = $1 AND tenant_id = $2 LIMIT 1', [req.params.id, user.tenant_id]);
      dentista = r.rows[0] || null;
    } else if (user.email) {
      const r = await safe('SELECT * FROM dentistas WHERE LOWER(email) = LOWER($1) AND tenant_id = $2 LIMIT 1', [user.email, user.tenant_id]);
      dentista = r.rows[0] || null;
    }

    // Fallback: se admin e nada resolvido, pega o primeiro deste tenant
    if (!dentista && user.role === 'admin') {
      const r = await safe('SELECT * FROM dentistas WHERE tenant_id = $1 ORDER BY nome ASC LIMIT 1', [user.tenant_id]);
      dentista = r.rows[0] || null;
    }

    if (!dentista) {
      return res.status(404).json({ error: 'Dentista não encontrado para o usuário atual' });
    }

    // Autorização: admin pode tudo; demais só ver o próprio
    if (user.role !== 'admin' && (user.email || '').toLowerCase() !== (dentista.email || '').toLowerCase()) {
      return res.status(403).json({ error: 'Acesso negado a este painel' });
    }

    const dentistaId = dentista.id;

    const [atendHojeRows, agendaRows, orcamentosRows, prontuariosRows, comissoesRows, tratamentosRows] = await Promise.all([
      // Atendimentos de hoje
      safe(
        `SELECT a.id, a.paciente_id, a.paciente_nome, p.nome as p_nome, a.hora, a.procedimento,
                a.status, a.tipo, a.valor
           FROM agendamentos a
           LEFT JOIN pacientes p ON p.id = a.paciente_id
          WHERE a.dentista_id = $1 AND a.data = $2
          ORDER BY a.hora ASC`,
        [dentistaId, today]
      ),
      // Agenda completa (hoje + próximos 30 dias)
      safe(
        `SELECT a.id, a.paciente_id, a.paciente_nome, p.nome as p_nome, a.data, a.hora,
                a.duracao, a.tipo, a.status, a.observacoes, a.procedimento
           FROM agendamentos a
           LEFT JOIN pacientes p ON p.id = a.paciente_id
          WHERE a.dentista_id = $1 AND a.data >= $2 AND a.data <= ($2::date + INTERVAL '30 days')
          ORDER BY a.data ASC, a.hora ASC`,
        [dentistaId, today]
      ),
      // Orçamentos do dentista
      safe(
        `SELECT o.id, o.paciente_id, o.paciente_nome, p.nome as p_nome, o.itens,
                o.valor_total, o.status, o.created_at
           FROM orcamentos o
           LEFT JOIN pacientes p ON p.id = o.paciente_id
          WHERE o.dentista_id = $1
          ORDER BY o.created_at DESC
          LIMIT 50`,
        [dentistaId]
      ),
      // Prontuários do dentista
      safe(
        `SELECT pr.id, pr.paciente_id, pr.paciente_nome, p.nome as p_nome,
                pr.titulo, pr.descricao, pr.tipo, pr.created_at,
                p.alergias
           FROM prontuarios pr
           LEFT JOIN pacientes p ON p.id = pr.paciente_id
          WHERE pr.dentista_id = $1
          ORDER BY pr.created_at DESC
          LIMIT 50`,
        [dentistaId]
      ),
      // Comissões do dentista
      safe(
        `SELECT c.id, c.paciente_id, c.procedimento, c.descricao, c.valor, c.percentual,
                c.data, c.status, p.nome as paciente_nome
           FROM comissoes c
           LEFT JOIN pacientes p ON p.id = c.paciente_id
          WHERE c.dentista_id = $1
          ORDER BY c.data DESC
          LIMIT 100`,
        [dentistaId]
      ),
      // Tratamentos do dentista (todos os pacientes)
      safe(
        `SELECT t.id, t.paciente_id, t.descricao, t.dente, t.valor, t.status, t.plano,
                t.observacoes, t.created_at, t.updated_at, p.nome as paciente_nome
           FROM tratamentos t
           LEFT JOIN pacientes p ON p.id = t.paciente_id
          WHERE t.dentista_id = $1
          ORDER BY t.created_at DESC
          LIMIT 200`,
        [dentistaId]
      ),
    ]);

    // Normalização → shape esperado pelo frontend
    const atendimentos = atendHojeRows.rows.map(r => {
      const nome = r.p_nome || r.paciente_nome || 'Paciente';
      const parts = String(nome).trim().split(/\s+/);
      const iniciais = ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase();
      return {
        id: r.id,
        pacienteId: r.paciente_id || undefined,
        pacienteNome: nome,
        pacienteIniciais: iniciais || 'P',
        horario: (r.hora || '').slice(0, 5),
        tipo: r.tipo || 'consulta',
        status: r.status || 'agendado',
        procedimento: r.procedimento || '—',
        valor: r.valor != null ? Number(r.valor) : undefined,
      };
    });

    const agenda = agendaRows.rows.map(r => ({
      id: r.id,
      pacienteId: r.paciente_id || undefined,
      pacienteNome: r.p_nome || r.paciente_nome || 'Paciente',
      data: r.data,
      horario: (r.hora || '').slice(0, 5),
      duracao: Number(r.duracao || 30),
      tipo: r.tipo || 'consulta',
      status: r.status || 'agendado',
      observacao: r.observacoes || undefined,
    }));

    const orcamentos = orcamentosRows.rows.map(r => {
      let itens = r.itens;
      if (typeof itens === 'string') { try { itens = JSON.parse(itens); } catch { itens = []; } }
      if (!Array.isArray(itens)) itens = [];
      const norm = itens.map(i => ({
        procedimento: i.procedimento || i.descricao || '—',
        valor: Number(i.valor || i.valor_unitario || 0),
        quantidade: Number(i.quantidade || 1),
      }));
      return {
        id: r.id,
        pacienteId: r.paciente_id || undefined,
        pacienteNome: r.p_nome || r.paciente_nome || 'Paciente',
        itens: norm,
        total: Number(r.valor_total || norm.reduce((s, i) => s + i.valor * i.quantidade, 0)),
        status: r.status || 'pendente',
        criadoEm: r.created_at,
      };
    });

    const prontuarios = prontuariosRows.rows.map(r => {
      const nome = r.p_nome || r.paciente_nome || 'Paciente';
      const parts = String(nome).trim().split(/\s+/);
      const iniciais = ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase();
      let alergias = r.alergias;
      if (typeof alergias === 'string') { try { alergias = JSON.parse(alergias); } catch { alergias = []; } }
      if (!Array.isArray(alergias)) alergias = [];
      return {
        id: r.id,
        pacienteId: r.paciente_id || undefined,
        pacienteNome: nome,
        pacienteIniciais: iniciais || 'P',
        ultimaConsulta: r.created_at,
        diagnostico: r.titulo || r.tipo || '—',
        tratamento: r.descricao || '—',
        observacoes: r.descricao || '',
        alergias,
      };
    });

    const comissoes = comissoesRows.rows.map(r => ({
      id: r.id,
      pacienteNome: r.paciente_nome || '—',
      procedimento: r.procedimento || r.descricao || '—',
      data: r.data,
      valorProcedimento: Number(r.valor || 0),
      percentual: Number(r.percentual || 0),
      valorComissao: Number(r.valor || 0) * Number(r.percentual || 0) / 100,
      status: r.status || 'pendente',
    }));

    const tratamentos = tratamentosRows.rows.map(r => ({
      id: r.id,
      pacienteId: r.paciente_id || undefined,
      pacienteNome: r.paciente_nome || 'Paciente',
      descricao: r.descricao || '',
      dente: r.dente || '',
      valor: Number(r.valor || 0),
      status: r.status || 'planejado',
      plano: r.plano || '',
      observacoes: r.observacoes || '',
      criadoEm: r.created_at,
      atualizadoEm: r.updated_at,
    }));

    res.json({
      dentista: {
        id: dentista.id,
        nome: dentista.nome,
        email: dentista.email,
        telefone: dentista.telefone,
        cro: dentista.cro,
        especialidade: dentista.especialidade,
        comissao: Number(dentista.comissao_percentual || dentista.comissao || 0),
        status: dentista.ativo === false ? 'inativo' : 'ativo',
      },
      atendimentos,
      agenda,
      orcamentos,
      prontuarios,
      comissoes,
      tratamentos,
    });
  } catch (error) {
    const status = error.message === 'Unauthorized' ? 401 : 500;
    res.status(status).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// REATIVAÇÃO DE PACIENTES INATIVOS
// Regras configuráveis + envio em massa via WhatsApp
// ═══════════════════════════════════════════════════════════════

const REACTIVATION_VALID_ORIGINS = ['instagram','facebook','google','indicacao','whatsapp','site','todos'];
const REACTIVATION_VALID_STATUS  = ['ativo','pausado','rascunho'];

// Helpers locais
function reactivationFillTemplate(tpl, ctx) {
  if (!tpl) return '';
  return String(tpl)
    .replaceAll('{nome}', ctx.nome || '')
    .replaceAll('{clinica}', ctx.clinica || 'nossa clínica')
    .replaceAll('{tratamento}', ctx.tratamento || '')
    .replaceAll('{dias_inativo}', String(ctx.dias_inativo || 0));
}

function reactivationInitials(nome) {
  const parts = String(nome || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase() || 'P';
}

// Normaliza telefone (mantém apenas dígitos; prepende 55 se faltar DDI)
function reactivationNormalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length >= 10) return `55${digits}`;
  return digits;
}

// Resolve nome de paciente -> origem (cruza com crm_leads via telefone/email)
async function reactivationOriginsByPaciente(safeQuery) {
  // Mapa paciente_id -> origem (preferência: crm_leads)
  const r = await safeQuery(
    `SELECT p.id AS paciente_id, COALESCE(NULLIF(l.origem,''), 'site') AS origem
       FROM pacientes p
       LEFT JOIN crm_leads l
              ON (p.telefone IS NOT NULL AND regexp_replace(p.telefone,'\\D','','g') = regexp_replace(l.telefone,'\\D','','g'))
              OR (p.email IS NOT NULL AND LOWER(p.email) = LOWER(l.email))`
  );
  const map = new Map();
  for (const row of r.rows) map.set(row.paciente_id, row.origem || 'site');
  return map;
}

// Constrói lista de pacientes inativos que satisfazem a regra
async function reactivationFetchMatching(rule) {
  if (!isValidTenantId(rule?.tenant_id)) return [];
  const safe = async (sql, params = []) => {
    try { return await pool.query(sql, params); }
    catch (err) {
      if (err.code === '42P01' || err.code === '42703') return { rows: [] };
      throw err;
    }
  };

  // Última visita = MAX(agendamentos.data) com status concluido/finalizado/atendido
  // Pacientes sem nenhum agendamento contam como "inativos desde sempre" (usa created_at).
  const r = await safe(
    `WITH ult AS (
       SELECT a.paciente_id, MAX(a.data) AS ultima_visita
         FROM agendamentos a
        WHERE a.status IN ('concluido','finalizado','atendido','realizado')
          AND a.tenant_id = $2
        GROUP BY a.paciente_id
     )
     SELECT p.id, p.nome, p.telefone, p.email, p.created_at,
            COALESCE(ult.ultima_visita, p.created_at::date) AS ultima_visita,
            (CURRENT_DATE - COALESCE(ult.ultima_visita, p.created_at::date))::int AS dias_inativo,
            COALESCE(NULLIF(l.origem,''), 'site') AS origem,
            l.id AS lead_id
       FROM pacientes p
       LEFT JOIN ult ON ult.paciente_id = p.id
       LEFT JOIN crm_leads l
              ON l.tenant_id = p.tenant_id AND (
                 (p.telefone IS NOT NULL AND regexp_replace(p.telefone,'\\D','','g') = regexp_replace(l.telefone,'\\D','','g'))
              OR (p.email IS NOT NULL AND LOWER(p.email) = LOWER(l.email)))
      WHERE p.tenant_id = $2
        AND (CURRENT_DATE - COALESCE(ult.ultima_visita, p.created_at::date)) >= $1
      ORDER BY dias_inativo DESC
      LIMIT 500`,
    [rule.inactive_days, rule.tenant_id]
  );

  let rows = r.rows;
  if (rule.origin && rule.origin !== 'todos') {
    rows = rows.filter(x => (x.origem || 'site') === rule.origin);
  }
  return rows;
}

// Lista regras
app.get('/api/reativacao/rules', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT r.*,
              (SELECT COUNT(*)::int FROM reactivation_sends s WHERE s.rule_id = r.id) AS sent_count,
              (SELECT COUNT(*)::int FROM reactivation_sends s WHERE s.rule_id = r.id AND s.status = 'respondido') AS responded_count
         FROM reactivation_rules r
        WHERE r.tenant_id = $1
        ORDER BY r.created_at DESC`,
      [user.tenant_id || null]
    );

    // matched count (pode ser custoso → calcular sob demanda apenas para regras ativas/rascunho)
    const enriched = await Promise.all(rows.map(async (r) => {
      let matched = 0;
      try {
        const m = await reactivationFetchMatching(r);
        matched = m.length;
      } catch { matched = 0; }
      const responseRate = r.sent_count > 0
        ? Math.round((r.responded_count / r.sent_count) * 1000) / 10
        : 0;
      return {
        id: r.id,
        name: r.name,
        inactiveDays: r.inactive_days,
        origin: r.origin,
        messageTemplate: r.message_template,
        status: r.status,
        matchedPatients: matched,
        sentCount: r.sent_count,
        respondedCount: r.responded_count,
        responseRate,
        lastRun: r.last_run_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    }));

    res.json(enriched);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Cria regra
app.post('/api/reativacao/rules', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { name, inactiveDays, origin, messageTemplate, status } = req.body || {};
    if (!name || !messageTemplate) {
      return res.status(400).json({ error: 'name e messageTemplate são obrigatórios' });
    }
    const days = Number(inactiveDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return res.status(400).json({ error: 'inactiveDays deve ser inteiro entre 1 e 3650' });
    }
    const orig = REACTIVATION_VALID_ORIGINS.includes(origin) ? origin : 'todos';
    const st = REACTIVATION_VALID_STATUS.includes(status) ? status : 'rascunho';

    const { rows } = await pool.query(
      `INSERT INTO reactivation_rules (name, inactive_days, origin, message_template, status, created_by, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [String(name).slice(0, 200), days, orig, String(messageTemplate).slice(0, 4000), st, user.id, user.tenant_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Atualiza regra (incl. status)
app.put('/api/reativacao/rules/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { name, inactiveDays, origin, messageTemplate, status } = req.body || {};
    const sets = []; const params = [];
    if (name !== undefined) { params.push(String(name).slice(0, 200)); sets.push(`name=$${params.length}`); }
    if (inactiveDays !== undefined) {
      const d = Number(inactiveDays);
      if (!Number.isInteger(d) || d < 1 || d > 3650) {
        return res.status(400).json({ error: 'inactiveDays inválido' });
      }
      params.push(d); sets.push(`inactive_days=$${params.length}`);
    }
    if (origin !== undefined) {
      if (!REACTIVATION_VALID_ORIGINS.includes(origin)) {
        return res.status(400).json({ error: 'origin inválida' });
      }
      params.push(origin); sets.push(`origin=$${params.length}`);
    }
    if (messageTemplate !== undefined) {
      params.push(String(messageTemplate).slice(0, 4000)); sets.push(`message_template=$${params.length}`);
    }
    if (status !== undefined) {
      if (!REACTIVATION_VALID_STATUS.includes(status)) {
        return res.status(400).json({ error: 'status inválido' });
      }
      params.push(status); sets.push(`status=$${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id, user.tenant_id || null);
    await pool.query(
      `UPDATE reactivation_rules SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`,
      params
    );
    const { rows } = await pool.query('SELECT * FROM reactivation_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id || null]);
    if (!rows[0]) return res.status(404).json({ error: 'Regra não encontrada' });
    res.json(rows[0]);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Remove regra
app.delete('/api/reativacao/rules/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const r = await pool.query('DELETE FROM reactivation_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id || null]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Regra não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Lista pacientes que satisfazem a regra
app.get('/api/reativacao/rules/:id/patients', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows: rulRows } = await pool.query(
      'SELECT * FROM reactivation_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id || null]
    );
    const rule = rulRows[0];
    if (!rule) return res.status(404).json({ error: 'Regra não encontrada' });

    const matches = await reactivationFetchMatching(rule);
    const out = matches.map(m => ({
      id: m.id,
      leadId: m.lead_id || null,
      name: m.nome,
      initials: reactivationInitials(m.nome),
      phone: m.telefone || '',
      email: m.email || '',
      origin: m.origem || 'site',
      lastVisit: m.ultima_visita,
      daysSince: Number(m.dias_inativo || 0),
    }));
    res.json(out);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Dispara mensagens para pacientes selecionados
// body: { patientIds: string[] }   (se vazio → todos os matched)
app.post('/api/reativacao/rules/:id/send', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const tenantId = String(user.tenant_id);
    const { rows: rulRows } = await pool.query(
      'SELECT * FROM reactivation_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, tenantId]
    );
    const rule = rulRows[0];
    if (!rule) return res.status(404).json({ error: 'Regra não encontrada' });
    if (rule.status === 'pausado') {
      return res.status(400).json({ error: 'Regra está pausada' });
    }

    const instance = await getTenantDefaultInstance(tenantId);
    if (!instance) {
      return res.status(400).json({ error: 'Nenhum WhatsApp da sua clínica está conectado. Conecte em Canais.' });
    }

    const requested = Array.isArray(req.body?.patientIds) ? req.body.patientIds : [];
    let matches = await reactivationFetchMatching(rule);
    if (requested.length > 0) {
      const set = new Set(requested);
      matches = matches.filter(m => set.has(m.id));
    }
    // Só pacientes da própria clínica (não depende do RLS).
    if (matches.length) {
      const { rows: own } = await pool.query(
        'SELECT id FROM pacientes WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, matches.map(m => m.id).filter(Boolean)]
      ).catch(() => ({ rows: [] }));
      const ownIds = new Set(own.map(r => String(r.id)));
      matches = matches.filter(m => ownIds.has(String(m.id)));
    }
    if (!matches.length) {
      return res.status(400).json({ error: 'Nenhum paciente para enviar' });
    }

    // Não envia na hora: entra na fila anti-bloqueio, que espaça os envios,
    // respeita horário, limites do número e quem pediu para sair.
    let queued = 0, failed = 0, skippedOptOut = 0;
    const clinica = await getTenantClinicName(tenantId);
    const errors = [];
    for (const m of matches) {
      const phone = reactivationNormalizePhone(m.telefone);
      const message = reactivationFillTemplate(rule.message_template, {
        nome: (m.nome || '').split(/\s+/)[0],
        clinica,
        tratamento: '',
        dias_inativo: m.dias_inativo,
      });
      if (!phone) {
        failed++;
        await pool.query(
          `INSERT INTO reactivation_sends (rule_id, paciente_id, lead_id, phone, message, status, error_message)
           VALUES ($1,$2,$3,$4,$5,'falhou',$6)`,
          [rule.id, m.id, m.lead_id, '', message, 'Telefone ausente']
        ).catch(() => {});
        errors.push({ pacienteId: m.id, error: 'Telefone ausente' });
        continue;
      }
      if (await isWhatsAppOptedOut(tenantId, phone)) { skippedOptOut++; continue; }
      await enqueueWhatsAppJob({
        tenantId, instance, phone, message, category: 'marketing',
        flowId: `reactivation_${rule.id}`, flowName: rule.name || 'Reativação',
        patientName: m.nome || '', triggerEvent: 'reactivation',
        variables: { ruleId: rule.id, pacienteId: m.id, leadId: m.lead_id || null },
      });
      queued++;
    }

    await pool.query(
      `UPDATE reactivation_rules SET last_run_at=NOW(), status=CASE WHEN status='rascunho' THEN 'ativo' ELSE status END, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
      [rule.id, tenantId]
    );

    // `sent` mantido por compatibilidade com o frontend: agora significa "na fila".
    res.json({ success: true, queued: true, sent: queued, failed, skippedOptOut, total: matches.length, errors: errors.slice(0, 20) });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// KPIs agregados
app.get('/api/reativacao/kpis', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const tenantId = user.tenant_id || null;
    const safe = async (sql, params = []) => {
      try { return await pool.query(sql, params); }
      catch (err) {
        if (err.code === '42P01' || err.code === '42703') return { rows: [] };
        throw err;
      }
    };

    const [activeRules, sendsAgg, ruleList] = await Promise.all([
      safe(`SELECT COUNT(*)::int AS total FROM reactivation_rules WHERE status='ativo' AND tenant_id = $1`, [tenantId]),
      safe(`SELECT
              COUNT(*) FILTER (WHERE status='enviado')::int AS sent,
              COUNT(*) FILTER (WHERE status='respondido')::int AS responded
            FROM reactivation_sends WHERE tenant_id = $1`, [tenantId]),
      safe(`SELECT * FROM reactivation_rules WHERE tenant_id = $1`, [tenantId]),
    ]);

    let totalMatched = 0;
    for (const r of ruleList.rows) {
      try {
        const m = await reactivationFetchMatching(r);
        totalMatched += m.length;
      } catch { /* ignore */ }
    }

    const sent = Number(sendsAgg.rows[0]?.sent || 0);
    const responded = Number(sendsAgg.rows[0]?.responded || 0);
    const responseRate = sent > 0 ? Math.round((responded / sent) * 1000) / 10 : 0;

    res.json({
      activeRules: Number(activeRules.rows[0]?.total || 0),
      inactivePatients: totalMatched,
      messagesSent: sent,
      responseRate,
    });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// GENERIC TABLE (for CRM, estoque, etc.)
// ═══════════════════════════════════════════════════════════════

app.get('/api/generic/:tableName', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const allowedTables = ['crm_leads', 'estoque', 'tratamentos', 'orcamentos', 'comissoes', 'prontuarios'];
    const table = req.params.tableName;
    if (!allowedTables.includes(table)) return res.status(403).json({ error: 'Tabela não permitida' });
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE tenant_id = $1 ORDER BY created_at DESC`, [user.tenant_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ORÇAMENTOS (Budget management with CRM auto-move)
// ═══════════════════════════════════════════════════════════════

// List budgets
app.get('/api/orcamentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query(`
      SELECT o.*, p.nome as paciente_nome, d.nome as dentista_nome
      FROM orcamentos o
      LEFT JOIN pacientes p ON o.paciente_id = p.id AND p.tenant_id = o.tenant_id
      LEFT JOIN dentistas d ON o.dentista_id = d.id AND d.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1
      ORDER BY o.created_at DESC
    `, [user.tenant_id]);
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Update budget status (approve/reject) — auto-moves CRM lead
app.patch('/api/orcamentos/:id/status', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { status } = req.body;
    const validStatuses = ['pendente', 'aprovado', 'reprovado', 'em_tratamento', 'finalizado'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Válidos: ${validStatuses.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, req.params.id, user.tenant_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });

    const budget = rows[0];

    // ── Auto-move linked CRM lead based on budget status ──
    // Find lead linked to this budget (by orcamento_id) or by paciente_id
    let leadId = null;
    const { rows: linkedLeads } = await pool.query(
      `SELECT id FROM crm_leads WHERE orcamento_id = $1 AND tenant_id = $2 LIMIT 1`,
      [req.params.id, user.tenant_id]
    );
    if (linkedLeads.length > 0) {
      leadId = linkedLeads[0].id;
    } else if (budget.paciente_id) {
      // Try matching by paciente_id via telefone
      const { rows: patientLeads } = await pool.query(
        `SELECT cl.id FROM crm_leads cl
         JOIN pacientes p ON p.telefone = cl.telefone AND p.tenant_id = cl.tenant_id
         WHERE p.id = $1 AND cl.tenant_id = $2 LIMIT 1`,
        [budget.paciente_id, user.tenant_id]
      );
      if (patientLeads.length > 0) leadId = patientLeads[0].id;
    }

    if (leadId) {
      let newStage = null;
      if (status === 'reprovado') newStage = 'orcamento_reprovado';
      else if (status === 'aprovado') newStage = 'orcamento_aprovado';
      else if (status === 'em_tratamento') newStage = 'orcamento_aprovado';

      if (newStage) {
        // Get current stage for audit
        const { rows: currentLead } = await pool.query('SELECT kanban_stage FROM crm_leads WHERE id = $1 AND tenant_id = $2', [leadId, user.tenant_id]);
        const fromStage = currentLead[0]?.kanban_stage || 'lead';

        await pool.query(
          `UPDATE crm_leads SET kanban_stage = $1, status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          [newStage, leadId, user.tenant_id]
        );

        // Log movement
        const profile = await getProfileByEmail(user.email);
        await pool.query(
          `INSERT INTO kanban_movements (lead_id, from_stage, to_stage, moved_by, moved_by_name, reason, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [leadId, fromStage, newStage, user.id, profile?.name || user.email, `Orçamento #${req.params.id} ${status}`, user.tenant_id]
        ).catch(err => console.error('Failed to log kanban movement:', err.message));

        console.log(`🔄 Lead ${leadId} auto-moved to ${newStage} (budget ${req.params.id} → ${status})`);
      }
    }

    res.json({ success: true, budget: rows[0], leadMoved: !!leadId });
  } catch (error) {
    console.error('Budget status update error:', error);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE QUEUES (filas de atendimento)
// ═══════════════════════════════════════════════════════════════

app.get('/api/queues', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!isValidTenantId(user.tenant_id)) return res.json([]);
    const { rows } = await pool.query(
      `SELECT * FROM attendance_queues WHERE tenant_id = $1 ORDER BY name ASC`,
      [user.tenant_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/queues', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    const { name, color, icon, description, whatsapp_button_label, contact_numbers, team_member_ids } = req.body;
    if (!isValidTenantId(user.tenant_id)) return res.status(403).json({ error: 'Usuário sem clínica' });
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attendance_queues (id, name, color, icon, description, whatsapp_button_label, contact_numbers, team_member_ids, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, name, color || '#3B82F6', icon || '📋', description, whatsapp_button_label || name, JSON.stringify(contact_numbers || []), JSON.stringify(team_member_ids || []), user.tenant_id]
    );
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/queues/:id', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    const { name, color, icon, description, whatsapp_button_label, contact_numbers, team_member_ids, active } = req.body;
    if (!isValidTenantId(user.tenant_id)) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query(
      `UPDATE attendance_queues SET name=COALESCE($1,name), color=COALESCE($2,color), icon=COALESCE($3,icon),
       description=COALESCE($4,description), whatsapp_button_label=COALESCE($5,whatsapp_button_label),
       contact_numbers=COALESCE($6,contact_numbers), team_member_ids=COALESCE($7,team_member_ids),
       active=COALESCE($8,active), updated_at=NOW()
       WHERE id=$9 AND tenant_id = $10`,
      [name, color, icon, description, whatsapp_button_label, contact_numbers ? JSON.stringify(contact_numbers) : null, team_member_ids ? JSON.stringify(team_member_ids) : null, active, req.params.id, user.tenant_id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Fila não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/queues/:id', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!isValidTenantId(user.tenant_id)) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query(
      'DELETE FROM attendance_queues WHERE id = $1 AND tenant_id = $2',
      [req.params.id, user.tenant_id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Fila não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ═══════════════════════════════════════════════════════════════
// SSE — Real-time event stream for frontend
// ═══════════════════════════════════════════════════════════════

const sseClients = new Map();

// ACKs da Evolution podem chegar antes do frontend salvar a mensagem enviada
// em chat_messages. Sem essa reconciliação, a UI fica presa em um único check
// mesmo quando o WhatsApp já confirmou entrega/leitura.
const pendingMessageStatusByTenant = new Map();
const MESSAGE_STATUS_PRIORITY = { failed: -1, sending: 0, sent: 1, delivered: 2, read: 3 };

function normalizePendingStatusMessageId(messageId) {
  return String(messageId || '').trim().toLowerCase();
}

function pendingStatusKey(tenantId, messageId) {
  return `${tenantId || 'unknown'}:${normalizePendingStatusMessageId(messageId)}`;
}

function pendingStatusUnknownKey(messageId) {
  return pendingStatusKey('unknown', messageId);
}

function isHigherMessageStatus(nextStatus, currentStatus = 'sent') {
  return (MESSAGE_STATUS_PRIORITY[nextStatus] ?? 0) > (MESSAGE_STATUS_PRIORITY[currentStatus] ?? 0);
}

function normalizeEvolutionAckStatus(ack) {
  if (ack === null || ack === undefined) return null;

  const ackStr = String(ack).trim().toUpperCase();
  const ackNum = typeof ack === 'number' ? ack : Number.parseInt(ackStr, 10);

  if (ackStr === 'FAILED' || ackStr === 'NACK' || ackNum === -1) return 'failed';
  if (ackStr === 'PENDING' || ackStr === 'PENDING_ACK' || ackStr === 'CLOCK' || ackNum === 0 || ackNum === 1) return 'sent';
  // Evolution/Baileys versions can stringify ACK 0 as ERROR while the message is
  // still only pending. Treat webhook/store ERROR as failed only when no numeric
  // ACK is available; immediate send validation skips 201 responses above.
  if (ackStr === 'ERROR') return 'failed';
  if (ackStr === 'SERVER_ACK' || ackStr === 'SENT' || ackStr === 'SEND' || ackNum === 2) return 'sent';
  if (ackStr === 'DELIVERY_ACK' || ackStr === 'DELIVERED' || ackStr === 'RECEIVED' || ackStr === 'DEVICE_ACK' || ackNum === 3) return 'delivered';
  if (ackStr === 'READ' || ackStr === 'READ_ACK' || ackStr === 'PLAYED' || ackStr === 'PLAYED_ACK' || ackNum === 4 || ackNum === 5) return 'read';

  return null;
}

function extractStatusUpdates(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.updates)) return data.updates;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.data)) return data.data;
  return data ? [data] : [];
}

function extractStatusLookupIds(update) {
  const candidates = [
    update?.messageId,
    update?.message_id,
    update?.keyId,
    update?.key_id,
    update?.id,
    update?.key?.id,
    update?.message?.key?.id,
    update?.data?.key?.id,
    update?.data?.message?.key?.id,
    update?.update?.key?.id,
    update?.update?.messageId,
    update?.update?.message_id,
    extractEvolutionMessageId(update),
  ];

  return [...new Set(candidates
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map((value) => String(value).trim())
    .filter((value) => value && !value.includes('@'))
  )];
}

function extractStatusRemoteJid(update) {
  const candidates = [
    update?.key?.remoteJidAlt,
    update?.key?.participantAlt,
    update?.key?.senderPn,
    update?.key?.participantPn,
    update?.remoteJidAlt,
    update?.participantAlt,
    update?.senderPn,
    update?.participantPn,
    update?.message?.key?.remoteJidAlt,
    update?.message?.key?.participantAlt,
    update?.message?.key?.senderPn,
    update?.message?.key?.participantPn,
    update?.data?.key?.remoteJidAlt,
    update?.data?.key?.participantAlt,
    update?.data?.key?.senderPn,
    update?.data?.key?.participantPn,
    update?.update?.key?.remoteJidAlt,
    update?.update?.key?.participantAlt,
    update?.update?.key?.senderPn,
    update?.update?.key?.participantPn,
    update?.key?.remoteJid,
    update?.remoteJid,
    update?.remote_jid,
    update?.chatId,
    update?.chat_id,
    update?.jid,
    update?.message?.key?.remoteJid,
    update?.data?.key?.remoteJid,
    update?.update?.key?.remoteJid,
  ];

  const values = candidates.filter((value) => typeof value === 'string' && value.includes('@'));
  return values.find(isUsableChatJid) || values[0] || null;
}

function extractStatusAckValue(update) {
  return update?.update?.status
    ?? update?.update?.ack
    ?? update?.status
    ?? update?.ack
    ?? update?.message?.status
    ?? update?.message?.ack
    ?? update?.data?.status
    ?? update?.data?.ack
    ?? update?.key?.status
    ?? update?.key?.ack;
}

async function findMessageStatusContext({ tenantId, lookupIds = [], phone = '', instance = '' }) {
  const ids = [...new Set(lookupIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const clauses = [];
  const params = [];

  if (isValidTenantId(tenantId)) {
    params.push(tenantId);
    clauses.push(`cm.tenant_id = $${params.length}`);
  }

  const matchers = [];
  if (ids.length > 0) {
    params.push(ids);
    const idsParam = params.length;
    matchers.push(`cm.id = ANY($${idsParam}::text[])`);
    matchers.push(`EXISTS (SELECT 1 FROM unnest($${idsParam}::text[]) AS lookup(id) WHERE cm.metadata::text LIKE '%' || lookup.id || '%')`);
  }

  const phoneSuffix = normalizeWhatsappNumber(phone).slice(-11);
  if (phoneSuffix) {
    const phoneSuffixes = getWhatsappPhoneSuffixVariants(phone);
    params.push(phoneSuffixes.length ? phoneSuffixes : [phoneSuffix]);
    const phoneParam = params.length;
    matchers.push(`RIGHT(REGEXP_REPLACE(COALESCE(cm.phone, ''), '\\D', '', 'g'), 11) = ANY($${phoneParam}::text[])`);
  }

  if (instance) {
    params.push(instance);
    const instanceParam = params.length;
    clauses.push(`(cm.instance = $${instanceParam} OR cm.instance IS NULL)`);
  }

  if (matchers.length === 0) return null;

  const where = [...clauses, `(${matchers.join(' OR ')})`].join(' AND ');
  const { rows } = await pool.query(
    `SELECT cm.id, cm.lead_id, cm.phone, cm.instance, cm.tenant_id, cm.status
       FROM chat_messages cm
      WHERE ${where}
      ORDER BY cm.timestamp DESC
      LIMIT 1`,
    params,
  );

  return rows[0] || null;
}

async function applyMessageStatusUpdate({ tenantId, lookupIds = [], newStatus }) {
  const ids = [...new Set(lookupIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!isValidTenantId(tenantId) || ids.length === 0 || !newStatus) return [];

  const nextPriority = MESSAGE_STATUS_PRIORITY[newStatus] ?? 0;
  const { rows } = await pool.query(
    `UPDATE chat_messages cm
        SET status = $1
      WHERE cm.tenant_id = $2
        AND (
          cm.id = ANY($3::text[])
          OR EXISTS (SELECT 1 FROM unnest($3::text[]) AS lookup(id) WHERE cm.metadata::text LIKE '%' || lookup.id || '%')
        )
        AND CASE COALESCE(cm.status, 'sent')
              WHEN 'failed' THEN -1
              WHEN 'sending' THEN 0
              WHEN 'sent' THEN 1
              WHEN 'delivered' THEN 2
              WHEN 'read' THEN 3
              ELSE 1
            END < $4
      RETURNING cm.id, cm.lead_id, cm.phone, cm.instance, cm.status`,
    [newStatus, tenantId, ids, nextPriority],
  );

  return rows;
}

function rememberPendingMessageStatus(tenantId, messageId, status) {
  const normalizedMessageId = normalizePendingStatusMessageId(messageId);
  if (!normalizedMessageId || !status) return;
  const key = pendingStatusKey(tenantId, normalizedMessageId);
  const existing = pendingMessageStatusByTenant.get(key);
  if (!existing || isHigherMessageStatus(status, existing.status)) {
    pendingMessageStatusByTenant.set(key, { status, createdAt: Date.now() });
  }

  const expiresBefore = Date.now() - 10 * 60 * 1000;
  for (const [entryKey, entry] of pendingMessageStatusByTenant.entries()) {
    if (entry.createdAt < expiresBefore) pendingMessageStatusByTenant.delete(entryKey);
  }
}

function consumePendingMessageStatus(tenantId, messageId) {
  const normalizedMessageId = normalizePendingStatusMessageId(messageId);
  if (!tenantId || !normalizedMessageId) return null;
  const keys = [pendingStatusKey(tenantId, normalizedMessageId), pendingStatusUnknownKey(normalizedMessageId)];
  let entry = null;
  let hitKey = null;
  for (const key of keys) {
    entry = pendingMessageStatusByTenant.get(key);
    if (entry) {
      hitKey = key;
      break;
    }
  }
  if (!entry) return null;
  pendingMessageStatusByTenant.delete(hitKey);
  return entry.status;
}

function broadcastSSE(event, data, tenantId = null) {
  if (!isValidTenantId(tenantId)) {
    console.warn(`⚠️ SSE broadcast '${event}' bloqueado: tenant_id ausente ou inválido`);
    return;
  }
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const [client, info] of sseClients.entries()) {
    if (info.tenantId !== tenantId) continue;
    try {
      client.write(payload);
      sent++;
    } catch (err) {
      sseClients.delete(client);
    }
  }
  if (sent === 0) {
    console.warn(`⚠️ SSE broadcast '${event}' tenant=${tenantId || 'all'} delivered to 0 clients`);
  }
}

app.get('/api/events', async (req, res) => {
  let tenantId = null;
  let authenticated = false;
  let authenticatedUserId = null;
  let authenticatedIsSuperAdmin = false;
  const token = req.query.token;
  const requestedTenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : null;

  if (token) {
    try {
      // 1) Try legacy token
      let decoded = null;
      try {
        decoded = verifyToken(token);
        if (looksLikeSupabaseAccessToken(decoded)) {
          decoded = null;
          throw new Error('supabase_token_requires_bridge');
        }
        tenantId = decoded?.tenant_id;
        authenticatedUserId = decoded?.sub || decoded?.id || null;
        authenticatedIsSuperAdmin = !!decoded?.is_super_admin;
        authenticated = true;
      } catch {
        // 2) Fallback to Supabase
        if (SUPABASE_BRIDGE_ENABLED) {
          const sbUser = await resolveSupabaseUser(token);
          tenantId = sbUser.tenant_id;
          authenticatedUserId = sbUser.id || sbUser.sub || null;
          authenticatedIsSuperAdmin = !!sbUser.is_super_admin;
          authenticated = true;
        }
      }

      // EventSource cannot send custom X-Tenant-Id headers. Accept the tenant
      // query parameter after checking it belongs to the authenticated profile.
      // This also fixes old/legacy tokens carrying a stale/placeholder tenant_id,
      // which made the chat connect but miss all webhook broadcasts.
      if (authenticated && requestedTenantId && authenticatedUserId && tenantId !== requestedTenantId) {
        const validatedTenant = await validateRequestedTenantForUser(
          { id: authenticatedUserId, tenant_id: tenantId, is_super_admin: authenticatedIsSuperAdmin },
          requestedTenantId
        );
        if (validatedTenant) tenantId = validatedTenant;
      }
    } catch (err) {
      console.warn('📡 SSE connection failed: invalid token');
      return res.status(401).json({ error: 'Invalid realtime token' });
    }
  }

  if (!authenticated || !isValidTenantId(tenantId)) {
    console.warn('📡 SSE connection rejected: authenticated tenant not resolved');
    return res.status(401).json({ error: 'Authenticated tenant not resolved' });
  }

  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no', // Disable Nginx buffering for SSE
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now(), tenantId })}\n\n`);

  sseClients.set(res, { tenantId, authenticated });
  console.log(`📡 SSE client connected (tenant: ${tenantId || 'anonymous'}, total: ${sseClients.size})`);

  // Keepalive ping every 25s to prevent proxy/browser timeouts
  const keepalive = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
    console.log(`📡 SSE client disconnected (total: ${sseClients.size})`);
  });
});

// ═══════════════════════════════════════════════════════════════
// WEBHOOK — Evolution API (queue routing + real-time)
// ═══════════════════════════════════════════════════════════════

// Helper: check if currently within business hours (relógio de São Paulo, não o do servidor)
function isWithinBusinessHours(settings) {
  if (!settings?.businessHours) return true; // default: always open
  const clock = spClock();
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayKey = dayKeys[clock.weekday];
  const schedule = settings.businessHours[dayKey];
  if (!schedule?.enabled) return false;

  const currentMinutes = clock.minutes;
  const [openH, openM] = schedule.openTime.split(':').map(Number);
  const [closeH, closeM] = schedule.closeTime.split(':').map(Number);
  return currentMinutes >= (openH * 60 + openM) && currentMinutes <= (closeH * 60 + closeM);
}

// ─── Configurações por clínica (tabela tenant_settings, criada no boot e pela migration-tenant-m0.sql) ───
// Antes ficavam numa linha única global (app_settings/system_settings): a configuração
// de uma clínica valia para todas. Sem registro da clínica, vale o padrão do sistema
// (nunca o valor de outra clínica).
const tenantSettingsCache = new Map(); // `${tenantId}:${key}` -> { value, at }
const TENANT_SETTINGS_TTL_MS = 60_000;

// throwOnError: para envios automáticos — na falha de leitura lança em vez de devolver o
// padrão, para o chamador pular o envio (o padrão pode ser "ligado" quando a clínica desligou).
async function getTenantSetting(tenantId, key, { throwOnError = false } = {}) {
  if (!isValidTenantId(tenantId)) return null;
  const cacheKey = `${tenantId}:${key}`;
  const hit = tenantSettingsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < TENANT_SETTINGS_TTL_MS) return hit.value;
  let value = null;
  try {
    const { rows } = await pool.query(
      'SELECT value FROM tenant_settings WHERE tenant_id = $1 AND key = $2 LIMIT 1', [tenantId, key]
    );
    value = rows[0]?.value ?? null;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* texto simples */ } }
  } catch (err) {
    // 42P01: tabela ainda não criada (migração M0 não rodou) → padrão do sistema.
    // Outra falha (conexão, timeout): usa o padrão só nesta leitura, sem guardar no cache,
    // para não fixar por 60 s um valor que não é o da clínica (ex.: follow-up desligado).
    if (err.code !== '42P01') {
      console.error(`⚠️ tenant_settings ${key}:`, err.message);
      if (throwOnError) throw err;
      return null;
    }
  }
  tenantSettingsCache.set(cacheKey, { value, at: Date.now() });
  return value;
}

async function setTenantSetting(tenantId, key, value) {
  if (!isValidTenantId(tenantId)) throw new Error('Usuário sem clínica');
  await pool.query(
    `INSERT INTO tenant_settings (tenant_id, key, value, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [tenantId, key, JSON.stringify(value)]
  );
  tenantSettingsCache.set(`${tenantId}:${key}`, { value, at: Date.now() });
}

function tenantSettingsErrorStatus(error) {
  if (error.message === 'Unauthorized') return 401;
  if (error.message === 'Admin access required') return 403;
  if (error.code === '42P01') return 503; // migração M0 ainda não aplicada
  return 500;
}

app.get('/api/attendance-settings', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!isValidTenantId(user.tenant_id)) return res.json({});
    res.json((await getTenantSetting(user.tenant_id, 'attendance_settings')) || {});
  } catch (error) {
    res.status(tenantSettingsErrorStatus(error)).json({ error: error.message });
  }
});

app.put('/api/attendance-settings', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!isValidTenantId(user.tenant_id)) return res.status(403).json({ error: 'Usuário sem clínica' });
    const settings = req.body && typeof req.body === 'object' ? req.body : {};
    await setTenantSetting(user.tenant_id, 'attendance_settings', settings);
    console.log(`⚙️ Attendance settings salvas (clínica ${String(user.tenant_id).slice(0, 8)})`);
    res.json({ success: true });
  } catch (error) {
    res.status(tenantSettingsErrorStatus(error)).json({ error: error.message });
  }
});

// Helper: send WhatsApp button menu with active queues
async function sendQueueMenu(instance, phone, tenantId) {
  const { rows: queues } = await pool.query(
    `SELECT id, name, icon, whatsapp_button_label
       FROM attendance_queues
      WHERE active = true AND tenant_id = $1
      ORDER BY name ASC`,
    [isValidTenantId(tenantId) ? tenantId : null]
  );
  if (queues.length === 0) return; // No queues configured

  const clinica = await getTenantClinicName(tenantId);
  // Evolution API: sendButtons (Baileys)
  const buttons = queues.map((q, i) => ({
    buttonId: `queue_${q.id}`,
    buttonText: { displayText: q.whatsapp_button_label || `${q.icon} ${q.name}` },
    type: 1,
  }));

  // Try button message first
  const buttonPayload = {
    number: phone,
    title: '',
    description: `Olá! 👋 Aqui é da ${clinica}. Selecione o setor para ser atendido:`,
    footer: clinica,
    buttons,
  };

  const btnResult = await evolutionFetch(`/message/sendButtons/${instance}`, {
    method: 'POST',
    body: JSON.stringify(buttonPayload),
  });

  // Fallback: if buttons not supported, send numbered list as text
  if (!btnResult.ok) {
    console.log('⚠️ Buttons not supported, falling back to text list');
    const lines = [`Olá! 👋 Aqui é da ${clinica}. Selecione o setor desejado:`, ''];
    queues.forEach((q, i) => {
      lines.push(`*${i + 1}* - ${q.whatsapp_button_label || `${q.icon} ${q.name}`}`);
    });
    lines.push('', 'Responda com o *número* da opção desejada.');

    await evolutionFetch(`/message/sendText/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ number: phone, text: lines.join('\n') }),
    });
  }

  // Mark lead as awaiting queue selection
  await pool.query(
    `UPDATE crm_leads SET awaiting_queue_selection = true, updated_at = NOW()
     WHERE tenant_id = $2
       AND REPLACE(REPLACE(REPLACE(REPLACE(telefone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1`,
    [phone.slice(-11), tenantId]
  );

  console.log(`📋 Queue menu sent to ${maskPhone(phone)} (${queues.length} options)`);
}

// Helper: match queue from button response or number
async function matchQueue(content, tenantId) {
  if (!content) return null;
  const trimmed = content.trim();
  const tenantParam = isValidTenantId(tenantId) ? tenantId : null;
  if (!tenantParam) return null;

  // Match by button ID (queue_UUID)
  if (trimmed.startsWith('queue_')) {
    const queueId = trimmed.replace('queue_', '');
    const { rows } = await pool.query(
      `SELECT * FROM attendance_queues
        WHERE id = $1
          AND active = true
          AND tenant_id = $2`,
      [queueId, tenantParam]
    );
    return rows[0] || null;
  }

  // Match by number (1, 2, 3...)
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num > 0) {
    const { rows } = await pool.query(
      `SELECT * FROM attendance_queues
        WHERE active = true AND tenant_id = $1
        ORDER BY name ASC`,
      [tenantParam]
    );
    return rows[num - 1] || null;
  }

  // Match by name (fuzzy)
  const { rows } = await pool.query(
    `SELECT * FROM attendance_queues
      WHERE active = true AND tenant_id = $1`,
    [tenantParam]
  );
  const lower = trimmed.toLowerCase();
  return rows.find(q =>
    q.name.toLowerCase().includes(lower) ||
    (q.whatsapp_button_label || '').toLowerCase().includes(lower)
  ) || null;
}

async function persistIncomingMessage({ msgId, leadId, content, msgType, phone, instance, pushName, remoteJid, rawType, mediaUrl, fileName, mimeType, tenantId, sender = 'lead', messageTimestamp = null }) {
  try {
    const initialStatus = sender === 'lead' ? 'delivered' : 'sent';
    const timestamp = parseEvolutionTimestamp(messageTimestamp) || new Date();
    await pool.query(
      `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, phone, instance, media_url, file_name, mime_type, metadata, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE
         SET lead_id = COALESCE(chat_messages.lead_id, EXCLUDED.lead_id),
             content = COALESCE(NULLIF(chat_messages.content, ''), EXCLUDED.content),
             sender = COALESCE(chat_messages.sender, EXCLUDED.sender),
             type = COALESCE(chat_messages.type, EXCLUDED.type),
             status = CASE
               WHEN chat_messages.status = 'read' THEN chat_messages.status
               WHEN chat_messages.status = 'delivered' AND EXCLUDED.status IN ('sent', 'sending') THEN chat_messages.status
               ELSE COALESCE(EXCLUDED.status, chat_messages.status)
             END,
             timestamp = CASE
               WHEN EXCLUDED.timestamp IS NOT NULL AND (chat_messages.timestamp IS NULL OR EXCLUDED.timestamp < chat_messages.timestamp)
               THEN EXCLUDED.timestamp
               ELSE chat_messages.timestamp
             END,
             phone = COALESCE(chat_messages.phone, EXCLUDED.phone),
             instance = COALESCE(chat_messages.instance, EXCLUDED.instance),
             media_url = COALESCE(chat_messages.media_url, EXCLUDED.media_url),
             file_name = COALESCE(chat_messages.file_name, EXCLUDED.file_name),
             mime_type = COALESCE(chat_messages.mime_type, EXCLUDED.mime_type),
             metadata = COALESCE(chat_messages.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
             tenant_id = COALESCE(chat_messages.tenant_id, EXCLUDED.tenant_id)`,
      [
        msgId,
        leadId,
        content,
        sender,
        msgType,
        initialStatus,
        timestamp,
        phone,
        instance,
        mediaUrl || null,
        fileName || null,
        mimeType || null,
        JSON.stringify({ pushName, remoteJid, rawType }),
        tenantId,
      ]
    );
  } catch (dbErr) {
    console.error('DB insert error (incoming msg):', dbErr.message);
  }
}

// Active sessions left open from previous days were hiding new WhatsApp replies
// inside "Meus Atendimentos" instead of putting them back in the waiting queue.
// If a patient sends a new message after an old assigned session is stale, the
// conversation must be visible in Fila de Espera again until someone assumes it.
const STALE_ACTIVE_SESSION_REQUEUE_INTERVAL = '8 hours';

async function requeueStaleActiveSessionsForTenant(tenantId) {
  if (!tenantId) return 0;

  try {
    const { rowCount } = await pool.query(
      `WITH latest_inbound AS (
         SELECT DISTINCT ON (lead_id)
                lead_id,
                phone,
                timestamp,
                content,
                instance
           FROM chat_messages
          WHERE tenant_id = $1
            AND sender = 'lead'
          ORDER BY lead_id, timestamp DESC
       )
       UPDATE attendance_sessions s
          SET status = 'waiting',
              attendant_id = NULL,
              attendant_name = NULL,
              assigned_at = NULL,
              started_waiting_at = GREATEST(COALESCE(li.timestamp, NOW()), COALESCE(s.started_waiting_at, li.timestamp, NOW()))
         FROM latest_inbound li
        WHERE s.tenant_id = $1
          AND s.status = 'active'
          AND s.lead_id = li.lead_id
          AND COALESCE(s.assigned_at, s.created_at, s.started_waiting_at, NOW() - INTERVAL '30 days') < NOW() - ($2::text)::interval
          AND li.timestamp > COALESCE(s.assigned_at, s.created_at, s.started_waiting_at, '1970-01-01'::timestamptz)`,
      [tenantId, STALE_ACTIVE_SESSION_REQUEUE_INTERVAL]
    );

    if (rowCount > 0) {
      console.log(`📥 Requeued ${rowCount} stale active WhatsApp session(s) for tenant ${tenantId}`);
    }
    return rowCount || 0;
  } catch (err) {
    console.warn('Failed to requeue stale active sessions:', err.message);
    return 0;
  }
}

function broadcastIncomingMessage({ msgId, phone, pushName, leadId, leadName, content, msgType, instance, queueId = null, queueName, queueColor, mediaUrl, fileName, mimeType, tenantId, sender = 'lead' }) {
  broadcastSSE('new_message', {
    id: msgId,
    phone,
    pushName,
    leadId,
    leadName,
    content,
    type: msgType,
    timestamp: new Date().toISOString(),
    instance,
    queueId,
    queueName,
    queueColor,
    mediaUrl: mediaUrl || null,
    fileName: fileName || null,
    mimeType: mimeType || null,
    sender: sender || 'lead',
  }, tenantId);
}

async function ensureWaitingSessionForIncomingLead({ lead, phone, queueId = null, queueName = null, tenantId }) {
  if (!lead?.id || !tenantId) return null;

  try {
    const { rows: existing } = await pool.query(
      `SELECT id, status, assigned_at, created_at, started_waiting_at
         FROM attendance_sessions
        WHERE lead_id = $1
          AND tenant_id = $2
          AND status IN ('waiting', 'active')
        ORDER BY started_waiting_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [lead.id.toString(), tenantId]
    );

    if (existing[0]?.status === 'active') {
      const assignedAt = existing[0].assigned_at || existing[0].created_at || existing[0].started_waiting_at;
      const assignedTime = assignedAt ? new Date(assignedAt).getTime() : 0;
      const staleMs = 8 * 60 * 60 * 1000;
      if (!assignedTime || Date.now() - assignedTime > staleMs) {
        await pool.query(
          `UPDATE attendance_sessions
              SET status = 'waiting',
                  attendant_id = NULL,
                  attendant_name = NULL,
                  assigned_at = NULL,
                  started_waiting_at = NOW(),
                  lead_name = COALESCE($2, lead_name),
                  lead_phone = COALESCE($3, lead_phone),
                  queue_id = COALESCE($4, queue_id),
                  queue_name = COALESCE($5, queue_name)
            WHERE id = $1
              AND tenant_id = $6`,
          [existing[0].id, lead.name || null, phone || null, queueId || null, queueName || null, tenantId]
        );
        console.log(`📥 Stale active session returned to queue for ${maskPhone(phone)} (session=${existing[0].id})`);
      }
      return existing[0].id;
    }

    if (existing[0]?.status === 'waiting') {
      await pool.query(
        `UPDATE attendance_sessions
            SET lead_name = COALESCE($2, lead_name),
                lead_phone = COALESCE($3, lead_phone),
                queue_id = COALESCE($4, queue_id),
                queue_name = COALESCE($5, queue_name)
          WHERE id = $1
            AND tenant_id = $6`,
        [existing[0].id, lead.name || null, phone || null, queueId || null, queueName || null, tenantId]
      );
      return existing[0].id;
    }

    const sessionId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attendance_sessions (id, lead_id, lead_name, lead_phone, queue_id, queue_name, started_waiting_at, status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'waiting', $7)`,
      [sessionId, lead.id.toString(), lead.name || null, phone || null, queueId || null, queueName || null, tenantId]
    );
    console.log(`📥 Lead ${maskPhone(phone)} entrou na fila de espera (session=${sessionId})`);
    return sessionId;
  } catch (err) {
    console.error('Failed to ensure waiting session:', err.message);
    return null;
  }
}

app.post('/api/webhook/evolution', async (req, res) => {
  const authBody = Array.isArray(req.body) ? req.body[0] : req.body;
  let authInstance = null;
  try { authInstance = extractEvolutionInstanceName(authBody || {}); } catch { authInstance = null; }
  if (!isValidEvolutionWebhookRequest(req, authInstance)) {
    console.warn(`[webhook] chamada rejeitada (token inválido) de ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // Evolution must receive a response quickly. Some message paths do extra
    // work (media download, avatar lookup, queue menu) after the DB save; make
    // duplicate/late responses harmless if a branch has already acknowledged.
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);
    res.json = (payload) => (res.headersSent ? res : originalJson(payload));
    res.status = (code) => (res.headersSent ? res : originalStatus(code));

    const body = Array.isArray(req.body) ? req.body[0] : req.body;
    const event = normalizeEvolutionEventName(body.event || body.type || body.eventType);
    const instance = extractEvolutionInstanceName(body);
    let tenantId = await getTenantIdByInstance(instance);
    
    console.log(`📩 Webhook event: ${event} from ${instance} (tenant: ${tenantId})`);
    // ─── Presence updates (typing, recording, online) ───
    if (isEvolutionEvent(event, 'presence.update', 'presence_update')) {
      const presenceData = body.data;
      console.log(`👁️ PRESENCE_UPDATE raw:`, JSON.stringify(presenceData).slice(0, 500));

      // Extract participants — Baileys sends them in different shapes
      let participants = Array.isArray(presenceData?.participants) ? presenceData.participants : [];
      // Sometimes Evolution sends presences as an object keyed by JID
      if (participants.length === 0 && presenceData?.presences && typeof presenceData.presences === 'object') {
        participants = Object.entries(presenceData.presences).map(([jid, data]) => ({
          id: jid,
          ...(typeof data === 'object' ? data : { status: data }),
        }));
      }

      const fallbackPhone = [
        presenceData?.id,
        presenceData?.chatId,
        presenceData?.remoteJid,
      ]
        .map((v) => {
          const raw = String(v || '');
          const normalized = normalizeWhatsappNumber(raw);
          if (!normalized || normalized.length < 10) return '';
          // If the JID is a LID, try to resolve to real phone via mapping
          if (raw.includes('@lid')) {
            return resolvePhoneFromLid(normalized);
          }
          return normalized;
        })
        .find((value) => value.length >= 10) || '';

      // Skip group presence updates (id ends with @g.us)
      const chatJid = presenceData?.id || presenceData?.chatId || '';
      if (chatJid.includes('@g.us')) {
        console.log(`👁️ PRESENCE skipped (group chat): ${chatJid}`);
        return res.json({ processed: true, event: 'presence', skipped: 'group' });
      }

      // Global status from presenceData itself (Baileys sometimes puts it here)
      const globalStatus = presenceData?.status
        || presenceData?.lastKnownPresence
        || presenceData?.presence;

      if (participants.length > 0) {
        for (const participant of participants) {
          const participantPhone = [
            participant?.id,
            participant?.jid,
            participant?.participant,
            participant?.remoteJid,
            participant?.userJid,
          ]
            .map((v) => {
              const raw = String(v || '');
              const normalized = normalizeWhatsappNumber(raw);
              if (!normalized || normalized.length < 10) return '';
              // If the JID is a LID, try to resolve to real phone via mapping
              if (raw.includes('@lid')) {
                const resolved = resolvePhoneFromLid(normalized);
                // If resolved is still the LID (no mapping yet), return empty to try next
                return resolved !== normalized ? resolved : '';
              }
              return normalized;
            })
            .find((value) => value.length >= 10) || '';

          // Try LID→phone resolution from all available LIDs in this event
          let resolvedPhone = participantPhone || fallbackPhone;

          // Last resort: try resolving any raw LID from participant fields
          if (!resolvedPhone) {
            const rawLid = normalizeWhatsappNumber(
              participant?.id || participant?.jid || presenceData?.id || ''
            );
            if (rawLid && rawLid.length >= 10) {
              const mapped = resolvePhoneFromLid(rawLid);
              if (mapped !== rawLid) {
                resolvedPhone = mapped;
              } else {
                // Ultimate fallback: try to resolve LID by calling Evolution API now
                try {
                  const subscribedPhones = instanceSubscribedPhones.get(instance);
                  if (subscribedPhones && subscribedPhones.size > 0) {
                    // Try each subscribed phone to find which one has this LID
                    for (const subPhone of subscribedPhones) {
                      const phoneLid = phoneToLidMap.get(subPhone);
                      if (phoneLid === rawLid) {
                        resolvedPhone = subPhone;
                        break;
                      }
                    }
                    // If still not resolved, try API lookup for all subscribed phones
                    if (!resolvedPhone) {
                      for (const subPhone of subscribedPhones) {
                        if (phoneToLidMap.has(subPhone)) continue; // already checked
                        const lid = await resolveLidForPhone(instance, subPhone);
                        if (lid === rawLid) {
                          resolvedPhone = subPhone;
                          break;
                        }
                      }
                    }
                  }
                } catch (e) { /* ignore fallback error */ }
              }
            }
          }

          if (!resolvedPhone) {
            console.log(`⚠️ PRESENCE: unresolved LID ${participant?.id || presenceData?.id}, no mapping found`);
            continue;
          }

          const status = participant?.status
            || participant?.presence
            || participant?.lastKnownPresence
            || globalStatus
            || 'unavailable';

          console.log(`👁️ PRESENCE resolved: phone=${maskPhone(resolvedPhone)} status=${status}`);
          // Cache under both the resolved phone AND the raw LID for future lookups
          const cacheEntry = {
            status,
            instance,
            updatedAt: new Date().toISOString(),
          };
          presenceStateCache.set(resolvedPhone, cacheEntry);
          broadcastSSE('presence_update', {
            phone: resolvedPhone,
            status,
            instance,
          }, tenantId);
        }
      } else if (fallbackPhone && globalStatus) {
        const resolvedFallback = resolvePhoneFromLid(fallbackPhone);
        const finalPhone = resolvedFallback !== fallbackPhone ? resolvedFallback : fallbackPhone;
        console.log(`👁️ PRESENCE fallback: phone=${maskPhone(finalPhone)} status=${globalStatus}`);
        presenceStateCache.set(finalPhone, {
          status: globalStatus,
          instance,
          updatedAt: new Date().toISOString(),
        });
        broadcastSSE('presence_update', {
          phone: finalPhone,
          status: globalStatus,
          instance,
        }, tenantId);
      } else {
        console.log(`⚠️ PRESENCE_UPDATE: could not extract phone or status`);
      }
      return res.json({ processed: true, event: 'presence' });
    }

    // ─── Message ACK / status updates ───
    const isSendMessageEvent = isEvolutionEvent(event, 'send.message', 'send_message');
    if (isEvolutionEvent(event, 'messages.update', 'messages_update', 'send.message.update', 'send_message_update', 'message.update', 'message_update', 'send.message', 'send_message')) {
      const updates = extractStatusUpdates(body.data || body);
      console.log(`📩 MESSAGES_UPDATE: ${updates.length} updates`);
      for (const update of updates) {
        const lookupIds = extractStatusLookupIds(update);
        const primaryMessageId = lookupIds[0];
        const remoteJid = extractStatusRemoteJid(update);
        const ack = extractStatusAckValue(update) ?? (isSendMessageEvent ? 'SERVER_ACK' : null);

        if (!primaryMessageId) {
          console.log(`⚠️ ACK ignored: missing message id in update`, JSON.stringify(update).slice(0, 300));
          continue;
        }
        if (remoteJid && remoteJid.endsWith('@g.us')) continue;

        // Build LID→phone mapping from ACK events
        // remoteJid is often a LID; look up the real phone from our DB
        if (remoteJid?.includes('@lid')) {
          const lidNum = normalizeWhatsappNumber(remoteJid);
          if (lidNum && !lidToPhoneMap.has(lidNum)) {
            // Try to find the phone from the message in DB
            try {
              const { rows: msgRows } = await pool.query(
                `SELECT phone FROM chat_messages WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
                [primaryMessageId, tenantId]
              );
              if (msgRows[0]?.phone) {
                registerLidMapping(lidNum, msgRows[0].phone);
                console.log(`🔗 LID mapped from ACK → ${maskPhone(msgRows[0].phone)}`);
              }
            } catch (e) { /* ignore */ }
          }
        }

        const newStatus = normalizeEvolutionAckStatus(ack);

        if (!newStatus) {
          console.log(`⚠️ ACK ignored: ack=${ack}, messageIds=${lookupIds.join(',')}`);
          continue;
        }

        let phone = remoteJid ? String(remoteJid)
          .replace('@s.whatsapp.net', '')
          .replace('@c.us', '')
          .replace('@lid', '')
          .replace(/:\d+$/, '')
          .replace(/\D/g, '') : '';
        // Resolve LID to real phone if mapped
        phone = phone ? resolvePhoneFromLid(phone) : '';

        let messageContext = null;
        try {
          messageContext = await findMessageStatusContext({ tenantId, lookupIds, phone, instance });
          if (messageContext?.tenant_id && !tenantId) tenantId = messageContext.tenant_id;
          if (!phone && messageContext?.phone) phone = messageContext.phone;
        } catch (lookupErr) {
          console.warn('ACK context lookup failed:', lookupErr.message);
        }

        if (!tenantId) {
          tenantId = await getFallbackTenantIdForIncomingMessage({
            instanceName: instance,
            phoneSuffix: phone.slice(-11),
          });
          if (!tenantId) {
            console.warn(`⚠️ ACK ignored without tenant: instance=${instance || 'unknown'} phone=${maskPhone(phone)} ids=${lookupIds.join(',')}`);
            // Do not lose this ACK. It can arrive before the instance→tenant
            // mapping is warm or before /api/messages persists the outgoing row.
            // Store it globally by message id; /api/messages will consume it once
            // the frontend saves the real Evolution message id under the user tenant.
            for (const lookupId of lookupIds) rememberPendingMessageStatus(null, lookupId, newStatus);
            continue;
          }
        }

        console.log(`✅ ACK: ${lookupIds.join(',')} → ${newStatus} (ack=${ack}, phone=${maskPhone(phone || messageContext?.phone)})`);

        let updatedRows = [];
        try {
          updatedRows = await applyMessageStatusUpdate({ tenantId, lookupIds, newStatus });
          if (updatedRows.length === 0) {
            for (const lookupId of lookupIds) rememberPendingMessageStatus(tenantId, lookupId, newStatus);
          }
        } catch (ackErr) {
          console.error('ACK DB update error:', ackErr.message);
          for (const lookupId of lookupIds) rememberPendingMessageStatus(tenantId, lookupId, newStatus);
        }

        const broadcastIds = new Set([...lookupIds, ...updatedRows.map((row) => row.id).filter(Boolean)]);
        for (const lookupId of broadcastIds) {
          broadcastSSE('message_status_update', {
            messageId: lookupId,
            phone: phone || messageContext?.phone || null,
            status: newStatus,
            instance: instance || messageContext?.instance || null,
          }, tenantId);
        }
      }
      return res.json({ processed: true, event: 'messages.update' });
    }

    // Only process incoming messages from here
    if (!isEvolutionEvent(event, 'messages.upsert', 'messages_upsert')) {
      return res.json({ ignored: true, event });
    }

    const messages = extractEvolutionMessages(body.data);
    const message = messages.find((item) => {
      const jid = extractActualRemoteJidFromMessage(item);
      return jid && !String(jid).endsWith('@g.us');
    }) || messages[0];
    const remoteJid = extractActualRemoteJidFromMessage(message);
    rememberLidMappingFromMessage(message, remoteJid);

    // Skip group messages
    if (!remoteJid || remoteJid.endsWith('@g.us')) {
      return res.json({ ignored: true, reason: 'group_or_missing_jid' });
    }

    const isFromMe = !!message?.key?.fromMe;
    const senderRole = isFromMe ? 'attendant' : 'lead';

    // Resolve clean phone number from remoteJid (handles LID resolution)
    const phone = normalizeWhatsappNumber(remoteJid);
    const resolvedPhone = resolvePhoneFromLid(phone);
    const phoneSuffix = resolvedPhone.slice(-11);
    const phoneSuffixes = getWhatsappPhoneSuffixVariants(resolvedPhone);

    if (!tenantId) {
      tenantId = await getFallbackTenantIdForIncomingMessage({ instanceName: instance, phoneSuffix });
      if (tenantId) {
        console.log(`🔐 Tenant resolved by fallback for ${instance || 'unknown-instance'} / ${maskPhone(phoneSuffix)}: ${tenantId}`);
      } else {
        console.warn(`⚠️ Webhook message without tenant_id: instance=${instance || 'unknown'} phone=${maskPhone(phoneSuffix)}. Message will be ignored to avoid cross-clinic leakage.`);
        return res.status(202).json({ ignored: true, reason: 'tenant_not_resolved' });
      }
    }

    // Webhooks do not carry a user token, but all chat tables are tenant/RLS
    // protected. Set the resolved clinic context before looking up/creating the
    // lead, saving chat_messages and creating attendance_sessions; otherwise a
    // pooled connection can return an empty queue/chat or reject inserts.
    await setDbTenantContext({ tenantId, isSuperAdmin: false });

    // Extract message content
    const msgContent =
      message?.message?.conversation ||
      message?.message?.extendedTextMessage?.text ||
      message?.message?.buttonsResponseMessage?.selectedButtonId ||
      message?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
      message?.message?.imageMessage?.caption ||
      message?.message?.videoMessage?.caption ||
      '';
    const msgType =
      message?.message?.imageMessage ? 'image' :
      message?.message?.audioMessage ? 'audio' :
      message?.message?.videoMessage ? 'video' :
      message?.message?.documentMessage ? 'document' :
      message?.message?.stickerMessage ? 'sticker' :
      message?.message?.locationMessage ? 'location' :
      message?.message?.contactMessage ? 'contact' :
      message?.message?.buttonsResponseMessage ? 'button_response' :
      message?.message?.listResponseMessage ? 'list_response' :
      'text';

    // Acknowledge Evolution immediately after the message is accepted for
    // processing. Media download, avatar lookup, menu replies and automations can
    // take seconds; if Evolution waits for all of that it can retry/stall the
    // socket and the chat appears stuck in "digitando" with no message delivery.
    if (!res.headersSent) {
      res.json({ accepted: true, event: 'messages.upsert' });
    }

    // Extract media metadata
    const mediaMsg = message?.message?.imageMessage || message?.message?.audioMessage ||
      message?.message?.videoMessage || message?.message?.documentMessage || message?.message?.stickerMessage;
    const mediaMimeType = mediaMsg?.mimetype || mediaMsg?.mimeType || null;
    const mediaFileName = message?.message?.documentMessage?.fileName || null;

    // Fetch media from Evolution API and save to disk
    let mediaUrl = null;
    if (['image', 'audio', 'video', 'document', 'sticker'].includes(msgType) && message?.key?.id) {
      try {
        const mediaResult = await evolutionFetch(`/chat/getBase64FromMediaMessage/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ message: { key: message.key, message: message.message } }),
        });
        if (mediaResult.ok && mediaResult.data?.base64) {
          // Save to disk instead of storing base64 in DB
          const diskUrl = await saveMediaToDisk(
            mediaResult.data.base64,
            mediaMimeType,
            mediaFileName
          );
          mediaUrl = diskUrl || null;
        }
      } catch (mediaErr) {
        console.error('Media fetch error:', mediaErr.message);
      }
    }

    // Find lead by phone and tenant_id
    const { rows: leads } = await pool.query(
      `SELECT id, nome as name, avatar_url, telefone as phone, queue_id, queue_name, awaiting_queue_selection FROM crm_leads 
       WHERE tenant_id = $1
         AND RIGHT(REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g'), 11) = ANY($2::text[])
       LIMIT 1`,
      [tenantId, phoneSuffixes.length ? phoneSuffixes : [phoneSuffix]]
    );

    let lead = leads[0] || null;
    const pushName = message?.pushName || phone;
    const resolvedContent = msgContent || `[${msgType}]`;
    const msgId = message?.key?.id || `wh-${createHash('sha1')
      .update(`${instance || 'unknown'}:${resolvedPhone}:${resolvedContent}:${message?.messageTimestamp || body?.date_time || ''}`)
      .digest('hex')}`;
    const rawType = Object.keys(message?.message || {})[0] || null;

    // Mensagens geradas pelo próprio número conectado também chegam via
    // MESSAGES_UPSERT. Elas servem para sincronizar histórico, mas não podem
    // entrar no fluxo de "cliente respondeu": não criam fila, não reenviam menu,
    // não disparam automações e não geram notificação de entrada.
    if (isFromMe) {
      if (!lead) {
        console.log(`↪️ Outgoing webhook ignored without existing lead: ${maskPhone(resolvedPhone)} (${msgId})`);
        return res.json({ processed: true, fromMe: true, ignored: 'lead_not_found' });
      }

      await persistIncomingMessage({
        msgId,
        leadId: lead.id,
        content: resolvedContent,
        msgType,
        phone: resolvedPhone,
        instance,
        pushName,
        remoteJid,
        rawType,
        mediaUrl,
        fileName: mediaFileName,
        mimeType: mediaMimeType,
        tenantId,
        sender: 'attendant',
        messageTimestamp: message?.messageTimestamp || message?.timestamp || body?.date_time || body?.dateTime || body?.createdAt || null,
      });

      broadcastIncomingMessage({
        msgId,
        phone: resolvedPhone,
        pushName,
        leadId: lead.id,
        leadName: lead.name,
        content: resolvedContent,
        msgType,
        instance,
        queueId: lead.queue_id || null,
        queueName: lead.queue_name || null,
        queueColor: lead.queue_color || null,
        mediaUrl,
        fileName: mediaFileName,
        mimeType: mediaMimeType,
        tenantId,
        sender: 'attendant',
      });

      console.log(`↪️ Outgoing webhook synced: ${maskPhone(resolvedPhone)} (${msgId})`);
      return res.json({ processed: true, fromMe: true, leadId: lead.id });
    }

    // ─── Opt-out: paciente respondeu SAIR / PARAR / STOP ───
    // Registra o descadastro da clínica, cancela o que estava na fila e
    // confirma uma única vez. Não aciona menu, boas-vindas nem automações.
    if (tenantId && msgType === 'text' && isWhatsAppOptOutText(msgContent)) {
      const isNewOptOut = await recordWhatsAppOptOut(tenantId, resolvedPhone, { source: 'whatsapp', keyword: String(msgContent).trim().slice(0, 40) });
      if (lead) {
        await persistIncomingMessage({
          msgId, leadId: lead.id, content: resolvedContent, msgType, phone: resolvedPhone, instance, pushName,
          remoteJid, rawType, mediaUrl, fileName: mediaFileName, mimeType: mediaMimeType, tenantId,
          messageTimestamp: message?.messageTimestamp || message?.timestamp || body?.date_time || null,
        }).catch(e => console.error('[opt-out] persist failed:', e.message));
        broadcastIncomingMessage({
          msgId, phone: resolvedPhone, pushName, leadId: lead.id, leadName: lead.name, content: resolvedContent,
          msgType, instance, queueId: lead.queue_id || null, queueName: lead.queue_name || null,
          queueColor: lead.queue_color || null, mediaUrl, fileName: mediaFileName, mimeType: mediaMimeType, tenantId,
        });
      }
      if (isNewOptOut) {
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({
            number: resolvedPhone,
            text: `Pronto! A ${await getTenantClinicName(tenantId)} não vai mais enviar mensagens automáticas para este número, inclusive lembretes de consulta. Se precisar falar com a gente, é só mandar uma mensagem por aqui.`,
          }),
        });
      }
      console.log(`🚫 Opt-out registrado (tenant ${tenantId}, final ${String(resolvedPhone).slice(-4)})`);
      return res.json({ processed: true, optOut: true, leadId: lead?.id || null });
    }

    // ─── New contact: create lead + contato + check hours + send menu ───
    if (!lead) {
      // Boas-vindas e fora de horário da clínica dona do número (não de outra clínica).
      const attendanceSettingsCache = await getTenantSetting(tenantId, 'attendance_settings');
      const newId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm_leads (id, nome, telefone, origem, status, kanban_stage, awaiting_queue_selection, tenant_id)
         VALUES ($1, $2, $3, 'whatsapp', 'novo', 'lead', true, $4)`,
        [newId, pushName, resolvedPhone, tenantId]
      );
      lead = { id: newId, name: pushName, phone: resolvedPhone, queue_id: null, queue_name: null, awaiting_queue_selection: true, avatar_url: null };
      console.log(`🆕 New lead created: ${maskPhone(resolvedPhone)}`);

      // 🤖 Trigger "Lead entrou no CRM" automation
      triggerAutomationFlows('Lead entrou no CRM', { name: pushName, phone, tenantId }).catch(() => {});

      // Auto-save to contatos table (skip if phone already exists)
      try {
        const existingContato = await pool.query('SELECT id FROM contatos WHERE telefone = $1 AND tenant_id = $2', [resolvedPhone, tenantId]);
        if (existingContato.rows.length === 0) {
          await pool.query(
            'INSERT INTO contatos (id, nome, telefone, tipo, tenant_id) VALUES ($1, $2, $3, $4, $5)',
            [crypto.randomUUID(), pushName, resolvedPhone, 'pessoal', tenantId]
          );
          console.log(`📇 Auto-saved contact: ${maskPhone(resolvedPhone)}`);
        }
      } catch (contatoErr) {
        console.error('Failed to auto-save contato:', contatoErr.message);
      }

      // Check business hours
      if (!isFromMe && !isWithinBusinessHours(attendanceSettingsCache)) {
        const offMsg = attendanceSettingsCache?.offHoursMessage ||
          `Olá! Aqui é da ${await getTenantClinicName(tenantId)}. Nosso atendimento está fechado agora. Deixe sua mensagem que respondemos assim que abrirmos. 😊`;
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: resolvedPhone, text: offMsg }),
        });
        console.log(`🕐 Off-hours message sent to ${maskPhone(resolvedPhone)}`);
        if (!isFromMe) {
          await ensureWaitingSessionForIncomingLead({
            lead,
            phone: resolvedPhone,
            queueId: lead.queue_id || null,
            queueName: lead.queue_name || null,
            tenantId,
          });
        }
        await persistIncomingMessage({
          msgId,
          leadId: lead.id,
          content: resolvedContent,
          msgType,
          phone: resolvedPhone,
          instance,
          pushName,
          remoteJid,
          rawType,
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
          tenantId,
          sender: senderRole,
          messageTimestamp: message?.messageTimestamp || message?.timestamp || body?.date_time || body?.dateTime || body?.createdAt || null,
        });
        broadcastIncomingMessage({
          msgId,
          phone: resolvedPhone,
          pushName,
          leadId: lead.id,
          leadName: lead.name,
          content: resolvedContent,
          msgType,
          instance,
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
          tenantId,
          sender: senderRole,
          messageTimestamp: message?.messageTimestamp || message?.timestamp || body?.date_time || body?.dateTime || body?.createdAt || null,
        });
        return res.json({ processed: true, offHours: true, leadId: lead.id });
      }

      // Send welcome message if enabled
      if (!isFromMe && attendanceSettingsCache?.autoGreetingEnabled && attendanceSettingsCache?.welcomeMessage) {
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: resolvedPhone, text: attendanceSettingsCache.welcomeMessage }),
        });
      }

      // Send queue menu
      if (!isFromMe) {
        sendQueueMenu(instance, resolvedPhone, tenantId)
          .catch((err) => console.warn('Queue menu send failed:', err.message));
      }
    }

    if (!isFromMe) {
      await ensureWaitingSessionForIncomingLead({
        lead,
        phone: resolvedPhone,
        queueId: lead.queue_id || null,
        queueName: lead.queue_name || null,
        tenantId,
      });
    }

    // ─── Lead is awaiting queue selection ───
    if (!isFromMe && lead.awaiting_queue_selection && (msgType === 'text' || msgType === 'button_response' || msgType === 'list_response')) {
      const selectedQueue = await matchQueue(msgContent, tenantId);

      if (selectedQueue) {
        // Assign queue to lead
        await pool.query(
          `UPDATE crm_leads SET queue_id = $1, queue_name = $2, awaiting_queue_selection = false, updated_at = NOW() WHERE id = $3`,
          [selectedQueue.id, selectedQueue.name, lead.id]
        );
        lead.queue_id = selectedQueue.id;
        lead.queue_name = selectedQueue.name;

        if (!isFromMe) {
          await ensureWaitingSessionForIncomingLead({
            lead,
            phone: resolvedPhone,
            queueId: selectedQueue.id,
            queueName: selectedQueue.name,
            tenantId,
          });
        }

        // Send confirmation
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({
            number: resolvedPhone,
            text: `✅ Você foi direcionado para o setor *${selectedQueue.icon} ${selectedQueue.name}*.\n\nUm de nossos atendentes irá te ajudar em breve! 😊`,
          }),
        });

        console.log(`📌 Lead ${lead.id} routed to queue: ${selectedQueue.name}`);

        // Broadcast queue assignment to SSE
        broadcastSSE('queue_assigned', {
          leadId: lead.id,
          leadName: lead.name,
          phone: resolvedPhone,
          queueId: selectedQueue.id,
          queueName: selectedQueue.name,
          queueColor: selectedQueue.color,
          timestamp: new Date().toISOString(),
        }, tenantId);

        // Also persist and broadcast the queue-selection message itself so it
        // appears when the attendant opens the chat from a global notification.
        const queueSelectionContent = `[Selecionou: ${selectedQueue.name}]`;
        await persistIncomingMessage({
          msgId,
          leadId: lead.id,
          content: queueSelectionContent,
          msgType: 'text',
          phone: resolvedPhone,
          instance,
          pushName,
          remoteJid,
          rawType,
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
          tenantId,
          sender: senderRole,
          messageTimestamp: message?.messageTimestamp || message?.timestamp || body?.date_time || body?.dateTime || body?.createdAt || null,
        });

        broadcastIncomingMessage({
          msgId,
          phone: resolvedPhone,
          pushName,
          leadId: lead.id,
          leadName: lead.name,
          content: queueSelectionContent,
          msgType: 'text',
          instance,
          queueId: selectedQueue.id,
          queueName: selectedQueue.name,
          queueColor: selectedQueue.color,
          tenantId,
          sender: senderRole,
        });

        return res.json({ processed: true, leadId: lead.id, queueId: selectedQueue.id });
      } else {
        await persistIncomingMessage({
          msgId,
          leadId: lead.id,
          content: resolvedContent,
          msgType,
          phone: resolvedPhone,
          instance,
          pushName,
          remoteJid,
          rawType,
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
          tenantId,
          sender: senderRole,
          messageTimestamp: message?.messageTimestamp || message?.timestamp || body?.date_time || body?.dateTime || body?.createdAt || null,
        });
        broadcastIncomingMessage({
          msgId,
          phone: resolvedPhone,
          pushName,
          leadId: lead.id,
          leadName: lead.name,
          content: resolvedContent,
          msgType,
          instance,
          queueId: lead.queue_id || null,
          queueName: lead.queue_name || null,
          queueColor: lead.queue_color || null,
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
          tenantId,
          sender: senderRole,
        });
        // Invalid selection — resend menu in background so the webhook does not
        // block message delivery/realtime if Evolution is slow.
        sendQueueMenu(instance, resolvedPhone, tenantId)
          .catch((err) => console.warn('Queue menu resend failed:', err.message));
        console.log(`💬 Incoming message from ${maskPhone(resolvedPhone)} awaiting queue selection → saved + broadcast to ${sseClients.size} clients`);
        return res.json({ processed: true, resent_menu: true, leadId: lead.id });
      }
    }

    // ─── Check for satisfaction rating response ───
    // Chave com a clínica: o mesmo paciente pode ser atendido por duas clínicas.
    const ratingKey = `awaiting_rating_${tenantId}_${phone}`;
    const { rows: ratingCheck } = await pool.query("SELECT value FROM app_settings WHERE key = $1", [ratingKey]);
    if (ratingCheck.length > 0 && (msgType === 'text' || msgType === 'button_response')) {
      let rating = null;
      // Button response: rating_leadId_N
      const btnMatch = msgContent.match(/rating_[^_]+_(\d)/);
      if (btnMatch) rating = parseInt(btnMatch[1], 10);
      // Text response: just a number 1-5
      if (!rating) {
        const num = parseInt(msgContent.trim(), 10);
        if (num >= 1 && num <= 5) rating = num;
      }

      if (rating) {
        const ratingData = ratingCheck[0].value;
        const ratingId = crypto.randomUUID();
        await pool.query(
          `INSERT INTO satisfaction_ratings (id, session_id, lead_id, lead_phone, rating, attendant_id, attendant_name, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ratingId, ratingData.sessionId || null, ratingData.leadId, phone, rating, ratingData.attendantId || null, ratingData.attendantName || null, tenantId]
        );
        // Remove awaiting flag
        await pool.query("DELETE FROM app_settings WHERE key = $1", [ratingKey]);

        const stars = '⭐'.repeat(rating);
        const thanks = rating >= 4
          ? `${stars}\n\nMuito obrigado pela avaliação! Ficamos felizes em atendê-lo! 😊`
          : rating === 3
          ? `${stars}\n\nObrigado pela avaliação! Vamos trabalhar para melhorar. 🙏`
          : `${stars}\n\nObrigado pelo feedback. Vamos analisar e melhorar nosso atendimento. 🙏`;

        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: phone, text: thanks }),
        });

        console.log(`⭐ Rating ${rating}/5 received from ${maskPhone(phone)}`);
        return res.json({ processed: true, rating, leadId: ratingData.leadId });
      }
    }

    // ─── Auto-return from recovery stage to queue with priority ───
    if ((await getFollowupConfig(tenantId)).returnToQueueOnReply) {
      try {
        const { rows: leadStage } = await pool.query('SELECT kanban_stage FROM crm_leads WHERE id = $1', [lead.id]);
        const currentStage = leadStage[0]?.kanban_stage;
        if (currentStage && RECOVERY_STAGES.includes(currentStage)) {
          // Move lead back to "lead" stage (top of funnel)
          await pool.query(
            `UPDATE crm_leads SET kanban_stage = 'em_atendimento', status = 'em_atendimento', priority = true, updated_at = NOW() WHERE id = $1`,
            [lead.id]
          );
          // Log movement
          await pool.query(
            `INSERT INTO kanban_movements (lead_id, from_stage, to_stage, moved_by_name, reason, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [lead.id, currentStage, 'em_atendimento', 'Sistema (Auto-retorno)', 'Cliente respondeu durante recuperação — retornou à fila com prioridade', tenantId]
          ).catch(() => {});
          // Add "Recuperação de Lead" tag
          try {
            // Ensure the tag exists
            const { rows: existingTag } = await pool.query(
              "SELECT id FROM lead_tags WHERE name = 'Recuperação de Lead' AND tenant_id = $1 LIMIT 1",
              [tenantId]
            );
            let tagId;
            if (existingTag.length > 0) {
              tagId = existingTag[0].id;
            } else {
              tagId = crypto.randomUUID();
              await pool.query(
                "INSERT INTO lead_tags (id, name, color, tenant_id) VALUES ($1, $2, $3, $4)",
                [tagId, 'Recuperação de Lead', '#F59E0B', tenantId]
              );
            }
            // Assign tag to lead
            await pool.query(
              "INSERT INTO lead_tag_assignments (lead_id, tag_id, tenant_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [lead.id.toString(), tagId, tenantId]
            );
          } catch (tagErr) {
            console.error('Failed to assign recovery tag:', tagErr.message);
          }

          // Create a new waiting session so lead appears at top of queue
          const sessionId = crypto.randomUUID();
          await pool.query(
            `INSERT INTO attendance_sessions (id, lead_id, lead_phone, status, started_waiting_at, tenant_id)
             VALUES ($1, $2, $3, 'waiting', NOW(), $4)
             ON CONFLICT DO NOTHING`,
            [sessionId, lead.id.toString(), phone, tenantId]
          ).catch(() => {});

          console.log(`🔄 Lead ${lead.id} (${maskPhone(phone)}) replied from recovery stage ${currentStage} → returned to queue with priority`);
          broadcastSSE('lead_returned_from_recovery', {
            leadId: lead.id,
            leadName: lead.name || pushName,
            phone,
            fromStage: currentStage,
            timestamp: new Date().toISOString(),
          }, tenantId);
        }
      } catch (recoveryErr) {
        console.error('Recovery auto-return error:', recoveryErr.message);
      }
    }

    // ─── Normal message (queue already assigned) ───
    await persistIncomingMessage({
      msgId,
      leadId: lead.id,
      content: resolvedContent,
      msgType,
      phone: resolvedPhone,
      instance,
      pushName,
      remoteJid,
      rawType,
      mediaUrl,
      fileName: mediaFileName,
      mimeType: mediaMimeType,
      tenantId,
      sender: senderRole,
      messageTimestamp: message?.messageTimestamp || message?.timestamp || body?.date_time || body?.dateTime || body?.createdAt || null,
    });

    broadcastIncomingMessage({
      msgId,
      phone: resolvedPhone,
      pushName,
      leadId: lead.id,
      leadName: lead.name,
      content: resolvedContent,
      msgType,
      instance,
      queueId: lead.queue_id || null,
      queueName: lead.queue_name || null,
      queueColor: lead.queue_color || null,
      mediaUrl,
      fileName: mediaFileName,
      mimeType: mediaMimeType,
      tenantId,
      sender: senderRole,
    });

    console.log(`💬 New message from ${maskPhone(phone)} → saved + broadcast to ${sseClients.size} clients`);

    // Send Web Push notification to all subscribed attendants
    sendPushToAll({
      title: `💬 ${pushName || phone}`,
      body: msgContent || `[${msgType}]`,
      tag: `msg-${lead.id}`,
      url: `/chat?lead=${encodeURIComponent(lead.id)}`,
      leadId: lead.id,
    }, tenantId);

    if (lead && !lead.avatar_url) {
      (async () => {
        try {
          const result = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instance}`, {
            method: 'POST',
            body: JSON.stringify({ number: phone }),
            timeoutMs: 5000,
          });
          const pictureUrl = result.data?.profilePictureUrl || result.data?.picture || result.data?.url || null;
          if (pictureUrl) {
            await pool.query('UPDATE crm_leads SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [pictureUrl, lead.id]);
            console.log(`📸 Auto-synced avatar for lead ${lead.id}`);
          }
        } catch (fetchErr) {
          console.error('Webhook profile fetch error:', fetchErr.message);
        }
      })();
    }

    // ─── Auto-confirm appointment when patient replies SIM to reminder ───
    try {
      const normalizedReply = (resolvedContent || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const isConfirmation = ['sim', 'confirmo', 'confirmado', 'ok', 'yes', 'vou', 'estarei', 'pode confirmar', 'confirmada'].some(
        kw => normalizedReply === kw || normalizedReply.startsWith(kw + ' ') || normalizedReply.startsWith(kw + '!')
      );

      if (isConfirmation) {
        // Check if there's a recent reminder sent to this phone
        const { rows: reminderJobs } = await pool.query(
          `SELECT aj.id, aj.flow_id FROM automation_jobs aj
           WHERE aj.trigger_event = 'appointment_reminder'
             AND aj.status = 'sent'
             AND aj.tenant_id = $2
             AND aj.patient_phone LIKE $1
             AND aj.sent_at >= NOW() - INTERVAL '48 hours'
           ORDER BY aj.sent_at DESC LIMIT 1`,
          [`%${phoneSuffix}`, tenantId]
        );

        if (reminderJobs.length > 0) {
          const reminderId = reminderJobs[0].flow_id.replace('reminder_', '');
          // Só confirma consulta da mesma clínica que recebeu a resposta
          const { rowCount } = await pool.query(
            `UPDATE agendamentos SET status = 'confirmado', updated_at = NOW()
             WHERE id::text = $1 AND tenant_id = $2 AND status NOT IN ('finalizado', 'realizado', 'cancelado')`,
            [reminderId, tenantId]
          );

          if (rowCount > 0) {
            // Mark reminder as confirmed
            await pool.query(
              `UPDATE automation_jobs SET variables = jsonb_set(COALESCE(variables::jsonb, '{}'), '{confirmed}', 'true')
               WHERE id = $1`,
              [reminderJobs[0].id]
            ).catch(() => {});

            // Send confirmation reply
            const confirmMsg = `✅ *Presença confirmada!*\n\nObrigado por confirmar. A ${await getTenantClinicName(tenantId)} aguarda você na data agendada. 😊`;
            await evolutionFetch(`/message/sendText/${instance}`, {
              method: 'POST',
              body: JSON.stringify({ number: `${phone}@s.whatsapp.net`, text: confirmMsg }),
            }).catch(err => console.error('Failed to send confirm reply:', err.message));

            console.log(`✅ Auto-confirmed appointment ${reminderId} via WhatsApp reply from ${maskPhone(phone)}`);
          }
        }
      }
    } catch (confirmErr) {
      console.error('Auto-confirm error:', confirmErr.message);
    }

    res.json({ processed: true, leadId: lead.id });
  } catch (error) {
    console.error('Webhook error:', error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TRANSFER LOGS (auditoria)
// ═══════════════════════════════════════════════════════════════

app.post('/api/transfers', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { leadId, leadName, leadPhone, toUserId, toUserName, reason, queueId, queueName } = req.body;
    if (!leadId || !toUserId || !reason) {
      return res.status(400).json({ error: 'leadId, toUserId e reason são obrigatórios' });
    }

    const fromName = await getProfileDisplayName(user.id, 'Desconhecido');

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO transfer_logs (id, lead_id, lead_name, lead_phone, from_user_id, from_user_name, to_user_id, to_user_name, reason, queue_id, queue_name, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, leadId, leadName || null, leadPhone || null, user.id, fromName, toUserId, toUserName || null, reason, queueId || null, queueName || null, user.tenant_id]
    );

    console.log(`🔄 Transfer: ${fromName} → ${toUserName} | Lead: ${leadName} | Motivo: ${reason}`);
    res.json({ success: true, id });
  } catch (error) {
    console.error('Transfer log error:', error);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

app.get('/api/transfers', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { limit = '50', offset = '0' } = req.query;
    const { rows } = await pool.query(
      'SELECT * FROM transfer_logs WHERE tenant_id = $3 ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [Math.min(Number(limit), 100), Number(offset), user.tenant_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE SESSIONS & METRICS
// ═══════════════════════════════════════════════════════════════

// Start session (when lead enters queue)
app.post('/api/sessions/start', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { leadId, leadName, leadPhone, queueId, queueName } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
    
    // Check if there's already an open session for this lead
    const { rows: existing } = await pool.query(
      "SELECT id FROM attendance_sessions WHERE lead_id = $1 AND tenant_id = $2 AND status != 'closed' LIMIT 1",
      [leadId, user.tenant_id]
    );
    if (existing.length > 0) {
      return res.json({ success: true, id: existing[0].id, existing: true });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attendance_sessions (id, lead_id, lead_name, lead_phone, queue_id, queue_name, started_waiting_at, status, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6, NOW(), 'waiting', $7)`,
      [id, leadId, leadName || null, leadPhone || null, queueId || null, queueName || null, user.tenant_id]
    );
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Assign session (attendant takes lead)
app.post('/api/sessions/assign', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
    if (!isValidTenantId(user.tenant_id)) return res.status(400).json({ error: 'Tenant inválido para assumir atendimento' });

    const attendantName = await getProfileDisplayName(user.id, 'Atendente');

    const result = await pool.query(
      `WITH target_session AS (
         SELECT id
           FROM attendance_sessions s
          WHERE s.tenant_id = $4
            AND s.status = 'waiting'
            AND (
              s.lead_id = $3
              OR (
                REGEXP_REPLACE($3, '\\D', '', 'g') <> ''
                AND RIGHT(REGEXP_REPLACE(COALESCE(s.lead_phone, ''), '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE($3, '\\D', '', 'g'), 11)
              )
              OR EXISTS (
                SELECT 1
                  FROM crm_leads l
                 WHERE l.tenant_id = $4
                   AND (
                     l.id::text = $3
                     OR (
                       REGEXP_REPLACE($3, '\\D', '', 'g') <> ''
                       AND RIGHT(REGEXP_REPLACE(COALESCE(l.telefone, ''), '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE($3, '\\D', '', 'g'), 11)
                     )
                   )
                   AND (
                     s.lead_id = l.id::text
                     OR (
                       s.lead_phone IS NOT NULL
                       AND RIGHT(REGEXP_REPLACE(COALESCE(s.lead_phone, ''), '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE(COALESCE(l.telefone, ''), '\\D', '', 'g'), 11)
                     )
                   )
              )
            )
          ORDER BY s.created_at DESC
          LIMIT 1
       )
       UPDATE attendance_sessions s SET 
         attendant_id = $1,
         attendant_name = $2,
         assigned_at = NOW(),
         status = 'active',
         wait_time_seconds = COALESCE(EXTRACT(EPOCH FROM (NOW() - s.started_waiting_at))::INTEGER, 0)
       FROM target_session
       WHERE s.id = target_session.id
       RETURNING s.id, s.wait_time_seconds`,
      [user.id, attendantName, leadId, user.tenant_id]
    );

    // Auto-move lead to "em_atendimento" in CRM kanban
    await pool.query(
      `UPDATE crm_leads
          SET kanban_stage = 'em_atendimento', status = 'em_atendimento', updated_at = NOW()
        WHERE tenant_id = $2
          AND (
            id::text = $1
            OR (
              REGEXP_REPLACE($1, '\\D', '', 'g') <> ''
              AND RIGHT(REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE($1, '\\D', '', 'g'), 11)
            )
          )`,
      [String(leadId), user.tenant_id]
    ).catch(err => console.error('Failed to update kanban_stage:', err.message));

    if (result.rows.length === 0) {
      // No waiting session — try to enrich from chat_messages (orphan leads)
      let leadPhone = null;
      let leadName = null;
      try {
        const { rows: msgRows } = await pool.query(
          `SELECT
             cm.phone,
             COALESCE(
               NULLIF(cm.metadata->>'contactName', ''),
               NULLIF(cm.metadata->>'pushName', ''),
               NULLIF(cm.metadata->>'notifyName', ''),
               NULLIF(l.nome, '')
             ) AS lead_name,
             l.telefone AS crm_phone
           FROM chat_messages cm
           LEFT JOIN crm_leads l
             ON l.tenant_id = cm.tenant_id
            AND (
              l.id::text = cm.lead_id
              OR (cm.phone IS NOT NULL AND RIGHT(REGEXP_REPLACE(COALESCE(l.telefone, ''), '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE(cm.phone, '\\D', '', 'g'), 11))
            )
          WHERE cm.tenant_id = $1
            AND (
              cm.lead_id = $2
              OR cm.id::text = $2
              OR (
                REGEXP_REPLACE($2, '\\D', '', 'g') <> ''
                AND RIGHT(REGEXP_REPLACE(COALESCE(cm.phone, ''), '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE($2, '\\D', '', 'g'), 11)
              )
            )
          ORDER BY cm.timestamp DESC
          LIMIT 1`,
          [user.tenant_id, String(leadId)]
        );
        if (msgRows[0]) {
          leadPhone = msgRows[0].phone || msgRows[0].crm_phone || null;
          leadName = msgRows[0].lead_name || null;
        }
      } catch (e) {
        console.warn('[sessions/assign] enrich lookup failed:', e.message);
      }

      if (!leadName || !leadPhone) {
        try {
          const { rows: leadRows } = await pool.query(
            `SELECT nome, telefone
               FROM crm_leads
              WHERE tenant_id = $2
                AND (
                  id::text = $1
                  OR (
                    REGEXP_REPLACE($1, '\\D', '', 'g') <> ''
                    AND RIGHT(REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE($1, '\\D', '', 'g'), 11)
                  )
                )
              LIMIT 1`,
            [String(leadId), user.tenant_id]
          );
          leadName = leadName || leadRows[0]?.nome || null;
          leadPhone = leadPhone || leadRows[0]?.telefone || null;
        } catch (e) {
          console.warn('[sessions/assign] CRM enrich lookup failed:', e.message);
        }
      }

      const id = randomUUID();
      await pool.query(
        `INSERT INTO attendance_sessions (id, lead_id, lead_name, lead_phone, attendant_id, attendant_name, assigned_at, started_waiting_at, status, wait_time_seconds, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6, NOW(), NOW(), 'active', 0, $7)`,
        [id, leadId, leadName, leadPhone, user.id, attendantName, user.tenant_id]
      );
      return res.json({ success: true, id, waitTime: 0 });
    }

    res.json({ success: true, id: result.rows[0].id, waitTime: result.rows[0].wait_time_seconds });
  } catch (error) {
    console.error('[sessions/assign] error:', error);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CRM LEADS (Kanban + List)
// ═══════════════════════════════════════════════════════════════

const SALES_STAGES = ['lead', 'em_atendimento', 'orcamento', 'orcamento_enviado', 'orcamento_aprovado'];
const RECOVERY_STAGES = ['followup', 'followup_2', 'followup_3', 'sem_resposta', 'orcamento_reprovado', 'desqualificado'];
const ALL_KANBAN_STAGES = [...SALES_STAGES, ...RECOVERY_STAGES];
const VALID_CONSCIOUSNESS = ['inconsciente', 'consciente_problema', 'consciente_solucao', 'consciente_produto', 'consciente_total'];

// ─── Follow-up Automation: padrão do sistema; cada clínica sobrescreve em tenant_settings ───
let followupAutomationConfig = {
  enabled: true,
  stages: ['followup', 'followup_2', 'followup_3'],
  messages: {
    followup: 'Olá, {{nome}}! Aqui é da {{clinica}}. Ficou alguma dúvida sobre o que conversamos? É só responder esta mensagem. Responda SAIR para não receber mais.',
    followup_2: '{{nome}}, tudo bem? Aqui é da {{clinica}}. Se quiser retomar a conversa ou marcar uma avaliação, estamos por aqui. Responda SAIR para não receber mais.',
    followup_3: 'Oi, {{nome}}! Esta é a nossa última mensagem sobre esse assunto. Quando quiser agendar, é só chamar a {{clinica}} por aqui. Responda SAIR para não receber mais.',
  },
  delaySeconds: 30, // delay before sending (gives time to cancel)
  delayDays: { followup: 0, followup_2: 3, followup_3: 7 }, // days after stage entry before sending
  returnToQueueOnReply: true, // when client replies from recovery, return to queue with priority
};

async function getFollowupConfig(tenantId, opts) {
  const saved = (await getTenantSetting(tenantId, 'followup_automation', opts)) || {};
  const base = followupAutomationConfig;
  return {
    ...base, ...saved,
    messages: { ...base.messages, ...(saved.messages || {}) },
    delayDays: { ...base.delayDays, ...(saved.delayDays || {}) },
  };
}

// Helper: send follow-up WhatsApp message when lead enters a follow-up stage
async function triggerFollowupAutomation(leadId, toStage) {
  try {
    const { rows: leads } = await pool.query(
      'SELECT id, nome, telefone, tenant_id FROM crm_leads WHERE id = $1', [leadId]
    );
    if (leads.length === 0) return;
    const lead = leads[0];
    if (!lead.telefone) {
      console.log(`⚠️ Follow-up automation: lead ${leadId} has no phone number`);
      return;
    }
    if (!isValidTenantId(lead.tenant_id)) {
      console.warn(`⚠️ Follow-up automation: lead ${leadId} sem clínica, envio ignorado`);
      return;
    }
    // Configuração da clínica do lead (o nome local sobrepõe o padrão do módulo).
    // Falha ao ler a configuração: não envia (o padrão é "ligado"); cai no catch abaixo.
    const followupAutomationConfig = await getFollowupConfig(lead.tenant_id, { throwOnError: true });
    if (!followupAutomationConfig.enabled || !followupAutomationConfig.stages.includes(toStage)) return;

    const template = followupAutomationConfig.messages[toStage];
    if (!template) return;
    const clinica = await getTenantClinicName(lead.tenant_id);
    const message = template
      .replace(/\{\{nome\}\}/g, (lead.nome || 'Paciente').split(' ')[0])
      .replace(/\{\{clinica\}\}/g, clinica);

    const stageDays = (followupAutomationConfig.delayDays && followupAutomationConfig.delayDays[toStage]) || 0;
    const totalDelayMs = (stageDays * 86400000) + ((followupAutomationConfig.delaySeconds || 30) * 1000);

    // Antes: setTimeout de até 7 dias em memória (perdido a cada restart do PM2)
    // e pela primeira instância aberta de qualquer clínica. Agora vai para a
    // fila, que confere no envio se o lead ainda está na mesma etapa.
    await enqueueWhatsAppJob({
      // Follow-up de venda/recuperação é marketing (LGPD art. 6º I e II): ganha o rodapé SAIR.
      tenantId: String(lead.tenant_id), phone: lead.telefone, message, category: 'marketing',
      flowId: `followup_${toStage}`, flowName: `Follow-up ${toStage}`, patientName: lead.nome || '',
      triggerEvent: 'followup_stage', scheduledAt: new Date(Date.now() + totalDelayMs),
      variables: { leadId, requireStage: toStage },
    });
    console.log(`🤖 Follow-up automation: enfileirado para lead ${leadId} (etapa ${toStage}, em ${stageDays}d)`);
  } catch (err) {
    console.error('❌ Follow-up automation error:', err.message);
  }
}

// GET/PUT follow-up automation settings
app.get('/api/automations/followup', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!isValidTenantId(user.tenant_id)) return res.status(403).json({ error: 'Usuário sem clínica' });
    res.json(await getFollowupConfig(user.tenant_id));
  } catch (error) {
    res.status(tenantSettingsErrorStatus(error)).json({ error: error.message });
  }
});

app.put('/api/automations/followup', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!isValidTenantId(user.tenant_id)) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { enabled, messages, stages, delaySeconds, delayDays, returnToQueueOnReply } = req.body;
    if (delaySeconds !== undefined
      && (typeof delaySeconds !== 'number' || !Number.isFinite(delaySeconds) || delaySeconds < 0 || delaySeconds > 86400)) {
      return res.status(400).json({ error: 'delaySeconds deve ser um número entre 0 e 86400' });
    }
    const cfg = await getFollowupConfig(user.tenant_id);
    if (typeof enabled === 'boolean') cfg.enabled = enabled;
    if (messages && typeof messages === 'object') cfg.messages = { ...cfg.messages, ...messages };
    if (Array.isArray(stages)) cfg.stages = stages.filter(st => RECOVERY_STAGES.includes(st));
    if (typeof delaySeconds === 'number') cfg.delaySeconds = delaySeconds;
    if (delayDays && typeof delayDays === 'object') cfg.delayDays = { ...cfg.delayDays, ...delayDays };
    if (typeof returnToQueueOnReply === 'boolean') cfg.returnToQueueOnReply = returnToQueueOnReply;

    await setTenantSetting(user.tenant_id, 'followup_automation', cfg);
    res.json(cfg);
  } catch (error) {
    res.status(tenantSettingsErrorStatus(error)).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTOMATION FLOWS CRUD
// ═══════════════════════════════════════════════════════════════

// List all automation flows
app.get('/api/automations/flows', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT id, name, description, type, active, trigger_event as trigger, steps, stats, created_at, updated_at
       FROM automation_flows WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [user.tenant_id || null]
    );
    const flows = rows.map(r => ({
      ...r,
      steps: typeof r.steps === 'string' ? JSON.parse(r.steps) : r.steps,
      stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats,
      createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '',
      updatedAt: r.updated_at ? new Date(r.updated_at).toLocaleDateString('pt-BR') : undefined,
    }));
    res.json(flows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

const MARKETING_HEALTH_VARS_ERROR =
  'Mensagens de marketing não podem usar {{procedimento}} nem {{valor}}: são dados de saúde do paciente.';
function marketingFlowHasHealthVars(trigger, steps) {
  if (!AUTOMATION_MARKETING_TRIGGERS.has(trigger)) return false;
  return (Array.isArray(steps) ? steps : []).some(st => WA_MARKETING_FORBIDDEN_VARS.test(String(st?.message || '')));
}

// Create automation flow
app.post('/api/automations/flows', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id, name, description, type, active, trigger, steps, stats } = req.body;
    if (!name) return res.status(400).json({ error: 'name obrigatório' });
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    if (marketingFlowHasHealthVars(trigger, steps)) return res.status(400).json({ error: MARKETING_HEALTH_VARS_ERROR });
    const flowId = id || `af${Date.now()}`;

    await pool.query(
      `INSERT INTO automation_flows (id, name, description, type, active, trigger_event, steps, stats, created_by, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [flowId, name, description || '', type || 'custom', active || false, trigger || 'Personalizado',
       JSON.stringify(steps || []), JSON.stringify(stats || {sent:0,responded:0,converted:0}), user.id, user.tenant_id]
    );
    res.json({ success: true, id: flowId });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Update automation flow
app.put('/api/automations/flows/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id } = req.params;
    const { name, description, type, active, trigger, steps } = req.body;
    if (steps !== undefined || trigger !== undefined) {
      const { rows: cur } = await pool.query(
        'SELECT trigger_event, steps FROM automation_flows WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id || null]
      ).catch(() => ({ rows: [] }));
      const curSteps = typeof cur[0]?.steps === 'string' ? JSON.parse(cur[0].steps) : cur[0]?.steps;
      if (marketingFlowHasHealthVars(trigger ?? cur[0]?.trigger_event, steps ?? curSteps)) {
        return res.status(400).json({ error: MARKETING_HEALTH_VARS_ERROR });
      }
    }

    const sets = [];
    const vals = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
    if (type !== undefined) { sets.push(`type = $${idx++}`); vals.push(type); }
    if (active !== undefined) { sets.push(`active = $${idx++}`); vals.push(active); }
    if (trigger !== undefined) { sets.push(`trigger_event = $${idx++}`); vals.push(trigger); }
    if (steps !== undefined) { sets.push(`steps = $${idx++}`); vals.push(JSON.stringify(steps)); }
    sets.push(`updated_at = NOW()`);

    if (sets.length === 1) return res.json({ success: true }); // only updated_at

    vals.push(id, user.tenant_id || null);
    const { rowCount } = await pool.query(
      `UPDATE automation_flows SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1}`, vals
    );
    if (!rowCount) return res.status(404).json({ error: 'Fluxo não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Delete automation flow
app.delete('/api/automations/flows/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id } = req.params;
    const { rowCount } = await pool.query('DELETE FROM automation_flows WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id || null]);
    if (!rowCount) return res.status(404).json({ error: 'Fluxo não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Toggle automation flow active status
app.patch('/api/automations/flows/:id/toggle', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE automation_flows SET active = NOT active, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING active`,
      [id, user.tenant_id || null]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Fluxo não encontrado' });
    res.json({ success: true, active: rows[0].active });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTOMATION SOLUTIONS — Dynamic Patient Counts
// ═══════════════════════════════════════════════════════════════

app.get('/api/automations/solution-counts', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const today = new Date().toISOString().slice(0, 10);

    const [
      agendaSemConfirmacao,
      aniversariantes,
      desmarcacoes,
      faltas,
      faltasPrimeira,
      inadimplencia,
      orcamentosAbertos,
      tratamentoSemAgenda,
    ] = await Promise.all([
      // Agendamento sem Confirmação: agendamentos futuros com status 'agendado' (não confirmado)
      pool.query(
        `SELECT COUNT(DISTINCT paciente_id) as total FROM agendamentos WHERE data >= $1 AND status = 'agendado' AND tenant_id = $2`,
        [today, user.tenant_id]
      ),
      // Aniversariantes: pacientes com aniversário este mês
      pool.query(
        `SELECT COUNT(*) as total FROM pacientes WHERE EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(DAY FROM data_nascimento) >= EXTRACT(DAY FROM CURRENT_DATE) AND tenant_id = $1`,
        [user.tenant_id]
      ),
      // Desmarcações: agendamentos com status 'desmarcado' ou 'cancelado' nos últimos 30 dias
      pool.query(
        `SELECT COUNT(DISTINCT paciente_id) as total FROM agendamentos WHERE status IN ('desmarcado','cancelado') AND data >= CURRENT_DATE - INTERVAL '30 days' AND tenant_id = $1`,
        [user.tenant_id]
      ),
      // Faltas: agendamentos com status 'faltou' nos últimos 30 dias
      pool.query(
        `SELECT COUNT(DISTINCT paciente_id) as total FROM agendamentos WHERE status = 'faltou' AND data >= CURRENT_DATE - INTERVAL '30 days' AND tenant_id = $1`,
        [user.tenant_id]
      ),
      // Faltas 1ª Consulta: pacientes que faltaram e nunca tiveram consulta 'realizado'
      pool.query(
        `SELECT COUNT(DISTINCT a.paciente_id) as total FROM agendamentos a
         WHERE a.status = 'faltou'
         AND a.data >= CURRENT_DATE - INTERVAL '30 days'
         AND a.tenant_id = $1
         AND NOT EXISTS (SELECT 1 FROM agendamentos b WHERE b.paciente_id = a.paciente_id AND b.tenant_id = a.tenant_id AND b.status IN ('realizado','confirmado','atendido'))`,
        [user.tenant_id]
      ),
      // Inadimplência: financeiro com tipo receita e valor em parcelas vencidas (simplificado: orçamentos aprovados sem receita correspondente)
      pool.query(
        `SELECT COUNT(DISTINCT o.paciente_id) as total FROM orcamentos o
         WHERE o.status = 'aprovado'
         AND o.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM financeiro f WHERE f.paciente_id = o.paciente_id AND f.tenant_id = o.tenant_id AND f.tipo = 'receita' AND f.valor >= o.valor_total
         )`,
        [user.tenant_id]
      ),
      // Orçamentos em Aberto: orçamentos com status 'pendente'
      pool.query(
        `SELECT COUNT(DISTINCT paciente_id) as total FROM orcamentos WHERE status = 'pendente' AND tenant_id = $1`,
        [user.tenant_id]
      ),
      // Tratamento sem Agendamento: tratamentos ativos sem agendamento futuro
      pool.query(
        `SELECT COUNT(DISTINCT t.paciente_id) as total FROM tratamentos t
         WHERE t.status IN ('planejado','em_andamento','ativo')
         AND t.tenant_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM agendamentos a WHERE a.paciente_id = t.paciente_id AND a.tenant_id = t.tenant_id AND a.data >= $1 AND a.status NOT IN ('cancelado','desmarcado','faltou')
         )`,
        [today, user.tenant_id]
      ),
    ]);

    res.json({
      confirmacao_agenda: Number(agendaSemConfirmacao.rows[0].total),
      aniversario: Number(aniversariantes.rows[0].total),
      desmarcacao: Number(desmarcacoes.rows[0].total),
      faltas: Number(faltas.rows[0].total),
      faltas_primeira: Number(faltasPrimeira.rows[0].total),
      inadimplencia: Number(inadimplencia.rows[0].total),
      orcamento_aberto: Number(orcamentosAbertos.rows[0].total),
      tratamento_sem_agenda: Number(tratamentoSemAgenda.rows[0].total),
    });
  } catch (error) {
    console.error('Solution counts error:', error.message);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTOMATION SOLUTION HOURS CONFIG
// ═══════════════════════════════════════════════════════════════

const SOLUTION_HOURS_DEFAULT = { inicio: '08:00', fim: '18:00', diasSemana: ['SEG','TER','QUA','QUI','SEX'] };
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SOLUTION_DAYS = ['DOM','SEG','TER','QUA','QUI','SEX','SAB'];

async function getSolutionHours(tenantId, opts) {
  return (await getTenantSetting(tenantId, 'solution_hours', opts)) || SOLUTION_HOURS_DEFAULT;
}

// Horário em que os gatilhos automáticos podem enfileirar (relógio de São Paulo).
function isWithinSolutionHours(cfg, date = new Date()) {
  const clock = spClock(date);
  const hhmm = `${String(Math.floor(clock.minutes / 60)).padStart(2, '0')}:${String(clock.minutes % 60).padStart(2, '0')}`;
  if (cfg?.inicio && hhmm < cfg.inicio) return false;
  if (cfg?.fim && hhmm > cfg.fim) return false;
  if (Array.isArray(cfg?.diasSemana) && cfg.diasSemana.length > 0 && !cfg.diasSemana.includes(SOLUTION_DAYS[clock.weekday])) return false;
  return true;
}

app.get('/api/automations/solution-hours', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!isValidTenantId(user.tenant_id)) return res.json(SOLUTION_HOURS_DEFAULT);
    res.json(await getSolutionHours(user.tenant_id));
  } catch (error) {
    res.status(tenantSettingsErrorStatus(error)).json({ error: error.message });
  }
});

app.put('/api/automations/solution-hours', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!isValidTenantId(user.tenant_id)) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { inicio, fim, diasSemana } = req.body || {};
    if ((inicio && !HHMM_RE.test(inicio)) || (fim && !HHMM_RE.test(fim))) {
      return res.status(400).json({ error: 'Horário inválido (use HH:MM)' });
    }
    const config = {
      inicio: inicio || SOLUTION_HOURS_DEFAULT.inicio,
      fim: fim || SOLUTION_HOURS_DEFAULT.fim,
      diasSemana: Array.isArray(diasSemana) ? diasSemana.filter(d => SOLUTION_DAYS.includes(d)) : SOLUTION_HOURS_DEFAULT.diasSemana,
    };
    await setTenantSetting(user.tenant_id, 'solution_hours', config);
    res.json(config);
  } catch (error) {
    res.status(tenantSettingsErrorStatus(error)).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTOMATION SCHEDULER — Job Queue, Triggers & Real Send
// ═══════════════════════════════════════════════════════════════

// Helper: replace {{variables}} in message text
function replaceVariables(message, variables) {
  let out = message;
  for (const [key, value] of Object.entries(variables || {})) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fila central de envio automático do WhatsApp — regras anti-bloqueio
// Todo envio automático (lembretes, automações, campanhas, reativação,
// follow-ups) entra em automation_jobs via enqueueWhatsAppJob() e só sai
// por processAutomationJobs(), que aplica: número da própria clínica,
// opt-out (SAIR), janela de horário (America/Sao_Paulo), limites por hora e
// por dia conforme a idade do número, intervalo aleatório entre envios,
// "digitando..." antes de enviar e pausa automática quando há muitas falhas.
// Regras e números: docs/whatsapp/diagnostico.md.
// ═══════════════════════════════════════════════════════════════════════════
const WA_TZ = 'America/Sao_Paulo';

// Janela de envio automático (respostas de atendimento não passam por aqui).
// 0 = domingo ... 6 = sábado. null = não envia no dia.
const WA_SEND_WINDOWS = {
  0: null,
  1: [8 * 60, 20 * 60],
  2: [8 * 60, 20 * 60],
  3: [8 * 60, 20 * 60],
  4: [8 * 60, 20 * 60],
  5: [8 * 60, 20 * 60],
  6: [8 * 60, 13 * 60],
};

// Limites por número conforme a idade (dias desde o cadastro da instância).
const WA_RATE_TIERS = [
  { maxAgeDays: 3, perHour: 20, perDay: 50 },
  { maxAgeDays: 7, perHour: 30, perDay: 100 },
  { maxAgeDays: 14, perHour: 40, perDay: 200 },
  { maxAgeDays: 30, perHour: 60, perDay: 350 },
  { maxAgeDays: Infinity, perHour: 80, perDay: 500 },
];

const WA_GAP_MIN_MS = 8_000;          // intervalo mínimo entre envios do mesmo número
const WA_GAP_MAX_MS = 25_000;         // intervalo máximo
const WA_BREAK_EVERY_MIN = 15;        // pausa longa a cada 15–25 envios
const WA_BREAK_EVERY_MAX = 25;
const WA_BREAK_MIN_MS = 3 * 60_000;   // pausa longa de 3–8 min
const WA_BREAK_MAX_MS = 8 * 60_000;
const WA_CLAIM_TIMEOUT_SQL = "INTERVAL '10 minutes'";
const WA_FAILURE_WINDOW_MS = 60 * 60_000;
const WA_FAILURE_MIN_COUNT = 5;       // pausa o número com 5+ falhas e >30% de falha na última hora
const WA_FAILURE_RATE = 0.3;
const WA_FAILURE_PAUSE_MS = 2 * 60 * 60_000;

const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

function spClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: WA_TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map(p => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const hour = Number(parts.hour) % 24;
  return { weekday, minutes: hour * 60 + Number(parts.minute), day: `${parts.year}-${parts.month}-${parts.day}` };
}

function isWithinWhatsAppSendWindow(date = new Date()) {
  const { weekday, minutes } = spClock(date);
  const win = WA_SEND_WINDOWS[weekday];
  return !!win && minutes >= win[0] && minutes < win[1];
}

// Próximo início de janela, procurando em passos de 15 min por até 8 dias.
function nextWhatsAppSendWindowStart(date = new Date()) {
  const step = 15 * 60_000;
  let t = Math.ceil(date.getTime() / step) * step;
  for (let i = 0; i < 8 * 96; i++, t += step) {
    if (isWithinWhatsAppSendWindow(new Date(t))) return new Date(t);
  }
  return new Date(date.getTime() + 24 * 60 * 60_000);
}

// Chave de telefone tolerante ao 9º dígito brasileiro: DDD + 8 últimos dígitos.
function waPhoneKey(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length === 13) digits = digits.slice(0, 4) + digits.slice(5);
  if (digits.startsWith('55') && digits.length === 12) return digits.slice(2);
  return digits.slice(-10);
}

// Pedido de descadastro: só quando a mensagem inteira é a palavra-chave, para
// não confundir "quero cancelar a consulta" com opt-out. "Cancelar" fica de fora
// porque responde a lembrete de consulta.
const WA_OPT_OUT_PHRASES = new Set([
  'sair', 'parar', 'pare', 'stop', 'descadastrar', 'descadastre', 'remover',
  'nao quero', 'nao quero mais', 'nao quero receber', 'nao quero receber mensagens',
  'nao envie mais', 'nao mande mais', 'parar mensagens', 'sair da lista',
]);

function isWhatsAppOptOutText(text) {
  const normalized = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > 0 && normalized.length <= 40 && WA_OPT_OUT_PHRASES.has(normalized);
}

async function isWhatsAppOptedOut(tenantId, phone) {
  if (!tenantId || !phone) return false;
  const { rows } = await pool.query(
    'SELECT 1 FROM whatsapp_opt_outs WHERE tenant_id = $1 AND phone_key = $2 LIMIT 1',
    [tenantId, waPhoneKey(phone)]
  );
  return rows.length > 0;
}

async function recordWhatsAppOptOut(tenantId, phone, { source = 'whatsapp', keyword = null } = {}) {
  if (!tenantId || !phone) return false;
  const key = waPhoneKey(phone);
  const { rowCount } = await pool.query(
    `INSERT INTO whatsapp_opt_outs (tenant_id, phone_key, phone, source, keyword)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, phone_key) DO NOTHING`,
    [tenantId, key, String(phone).replace(/\D/g, ''), source, keyword]
  );
  // Cancela o que estava na fila para esse telefone nesta clínica.
  await pool.query(
    `UPDATE automation_jobs SET status = 'cancelled', error = 'Cancelado: paciente pediu para não receber (SAIR)', claimed_at = NULL
      WHERE status = 'pending' AND tenant_id = $1
        AND RIGHT(regexp_replace(patient_phone, '\\D', '', 'g'), 8) = RIGHT($2, 8)`,
    [tenantId, key]
  ).catch(e => console.error('[opt-out] cancel jobs failed:', e.message));
  return rowCount > 0;
}

// Instâncias abertas na Evolution (cache curto para não martelar a API).
let waOpenInstancesCache = { at: 0, names: new Set() };
async function getOpenEvolutionInstances() {
  if (Date.now() - waOpenInstancesCache.at < 60_000) return waOpenInstancesCache.names;
  const result = await evolutionFetch('/instance/fetchInstances');
  const list = Array.isArray(result.data) ? result.data : [];
  const names = new Set(
    list.filter(i => (i.connectionStatus || i.status || i.instance?.state) === 'open')
      .map(i => i.name || i.instanceName || i.instance?.instanceName)
      .filter(Boolean)
  );
  // Em falha, guarda o resultado vazio por ~30 s (cache negativo) para não
  // repetir a espera de timeout a cada mensagem enfileirada.
  waOpenInstancesCache = result.ok ? { at: Date.now(), names } : { at: Date.now() - 30_000, names: waOpenInstancesCache.names };
  return waOpenInstancesCache.names;
}

async function getTenantIdByInstancePrefix(instanceName) {
  const m = String(instanceName || '').match(/^([0-9a-f]{8})-/i);
  if (!m) return null;
  const { rows } = await pool.query(
    'SELECT id FROM tenants WHERE id::text LIKE $1 LIMIT 2', [`${m[1].toLowerCase()}%`]
  ).catch(() => ({ rows: [] }));
  return rows.length === 1 ? String(rows[0].id) : null;
}

async function resolveInstanceTenant(instanceName) {
  return (await getStrictInstanceOwner(instanceName)) || (await getTenantIdByInstancePrefix(instanceName));
}

// Número conectado da própria clínica (substitui o antigo getDefaultInstance,
// que devolvia a primeira instância aberta de QUALQUER clínica).
async function getTenantDefaultInstance(tenantId) {
  if (!isValidTenantId(tenantId)) return null;
  const open = await getOpenEvolutionInstances();
  const { rows } = await pool.query(
    'SELECT instance_name FROM whatsapp_instances WHERE tenant_id = $1 ORDER BY created_at ASC NULLS LAST',
    [tenantId]
  ).catch(() => ({ rows: [] }));
  const mapped = rows.map(r => r.instance_name).find(n => open.has(n));
  if (mapped) return mapped;
  for (const name of open) {
    if (instanceNameMatchesTenantPrefix(name, tenantId) && !(await getStrictInstanceOwner(name))) return name;
  }
  return null;
}

// Nome da clínica (controladora) para assinar as mensagens automáticas — LGPD art. 9º III.
// Cache curto: o nome muda raramente e o lembrete roda em lote.
const tenantClinicNameCache = new Map(); // tenantId -> { nome, at }
async function getTenantClinicName(tenantId) {
  if (!isValidTenantId(tenantId)) return 'nossa clínica';
  const hit = tenantClinicNameCache.get(String(tenantId));
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.nome;
  const { rows } = await pool.query('SELECT nome FROM tenants WHERE id = $1 LIMIT 1', [tenantId]).catch(() => ({ rows: [] }));
  const nome = String(rows[0]?.nome || '').trim() || 'nossa clínica';
  tenantClinicNameCache.set(String(tenantId), { nome, at: Date.now() });
  return nome;
}

// Marketing sempre diz como sair (LGPD art. 8º §5º e 18 §2º; política do WhatsApp).
const WA_MARKETING_OPT_OUT_FOOTER = 'Responda SAIR para não receber mais.';
function withMarketingOptOutFooter(message) {
  const text = String(message || '').trimEnd();
  if (!text || /\bSAIR\b/i.test(text)) return text;
  return `${text}\n\n${WA_MARKETING_OPT_OUT_FOOTER}`;
}

// Variáveis que revelam dado de saúde ou valor de tratamento: proibidas em marketing
// (LGPD art. 5º II, 6º III e 11 I).
const WA_MARKETING_FORBIDDEN_VARS = /\{\{\s*(procedimento|valor)\s*\}\}|\{tratamento\}/i;

async function enqueueWhatsAppJob({
  tenantId, instance = null, phone, message, category = 'transactional',
  flowId = null, flowName = '', stepIndex = 0, patientName = '', variables = null,
  scheduledAt = new Date(), triggerEvent = 'manual', id = null, expiresAt = null,
}) {
  if (!isValidTenantId(tenantId)) throw new Error('enqueueWhatsAppJob: tenantId obrigatório');
  const cleanPhone = normalizeWhatsappNumber(phone || '');
  if (!cleanPhone || !message) return null;
  if (category === 'marketing') message = withMarketingOptOutFooter(message);
  // Já fixa o número da clínica, para o ritmo por número valer desde o início.
  const resolvedInstance = instance || await getTenantDefaultInstance(tenantId).catch(() => null);
  // Mensagem automática perde o sentido depois de um tempo (número desconectado
  // por dias, fila parada): marketing vale 3 dias, o resto 7, se não informado.
  const start = new Date(scheduledAt || Date.now()).getTime();
  const validity = expiresAt || new Date(start + (category === 'marketing' ? 3 : 7) * 86_400_000);
  const cols = ['tenant_id', 'instance', 'patient_phone', 'message', 'category', 'flow_id', 'flow_name',
    'step_index', 'patient_name', 'variables', 'channel', 'status', 'scheduled_at', 'trigger_event', 'expires_at'];
  const vals = [tenantId, resolvedInstance || null, cleanPhone, message, category, flowId, flowName,
    stepIndex, patientName || '', variables ? JSON.stringify(variables) : null, 'whatsapp', 'pending', scheduledAt, triggerEvent, validity];
  if (id) { cols.unshift('id'); vals.unshift(id); }
  const { rows } = await pool.query(
    `INSERT INTO automation_jobs (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    vals
  );
  return rows[0]?.id || null;
}

// Estado em memória por número: ritmo e falhas recentes.
const waPacing = new Map();   // instance -> { nextAt, sinceBreak, breakEvery }
const waOutcomes = new Map(); // instance -> [{ at, ok }]

function scheduleNextWhatsAppSend(instance) {
  const p = waPacing.get(instance) || { nextAt: 0, sinceBreak: 0, breakEvery: randomBetween(WA_BREAK_EVERY_MIN, WA_BREAK_EVERY_MAX) };
  p.sinceBreak += 1;
  let gap = randomBetween(WA_GAP_MIN_MS, WA_GAP_MAX_MS);
  if (p.sinceBreak >= p.breakEvery) {
    gap += randomBetween(WA_BREAK_MIN_MS, WA_BREAK_MAX_MS);
    p.sinceBreak = 0;
    p.breakEvery = randomBetween(WA_BREAK_EVERY_MIN, WA_BREAK_EVERY_MAX);
  }
  p.nextAt = Date.now() + gap;
  waPacing.set(instance, p);
}

async function recordWhatsAppOutcome(instance, tenantId, ok) {
  const now = Date.now();
  const list = (waOutcomes.get(instance) || []).filter(o => now - o.at < WA_FAILURE_WINDOW_MS);
  list.push({ at: now, ok });
  waOutcomes.set(instance, list);
  const failures = list.filter(o => !o.ok).length;
  if (!ok && failures >= WA_FAILURE_MIN_COUNT && failures / list.length > WA_FAILURE_RATE) {
    const until = new Date(now + WA_FAILURE_PAUSE_MS);
    await pool.query(
      `INSERT INTO whatsapp_instances (instance_name, tenant_id, paused_until, pause_reason)
       VALUES ($1, $4, $2, $3)
       ON CONFLICT (instance_name) DO UPDATE SET paused_until = EXCLUDED.paused_until, pause_reason = EXCLUDED.pause_reason`,
      [instance, until, `Pausa automática: ${failures} falhas de ${list.length} envios na última hora`, tenantId]
    ).catch(e => console.error('[wa-breaker]', e.message));
    waOutcomes.set(instance, []);
    console.warn(`⛔ WhatsApp ${instance} (tenant ${tenantId}) pausado até ${until.toISOString()} por excesso de falhas`);
  }
}

function getRateTier(instanceCreatedAt) {
  const ageDays = instanceCreatedAt ? (Date.now() - new Date(instanceCreatedAt).getTime()) / 86_400_000 : Infinity;
  return WA_RATE_TIERS.find(t => ageDays <= t.maxAgeDays) || WA_RATE_TIERS[WA_RATE_TIERS.length - 1];
}

// Tempo de "digitando..." proporcional ao texto (Evolution mostra a presença durante o delay).
function typingDelayMs(text) {
  const base = Math.min(8000, Math.max(1500, String(text || '').length * 50));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

async function runWhatsAppJobHooks(job, ok, errorMessage) {
  let vars = job.variables;
  if (typeof vars === 'string') { try { vars = JSON.parse(vars); } catch { vars = {}; } }
  vars = vars || {};
  if (job.trigger_event === 'reactivation') {
    await pool.query(
      `INSERT INTO reactivation_sends (rule_id, paciente_id, lead_id, phone, message, status, error_message, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [vars.ruleId || null, vars.pacienteId || null, vars.leadId || null, job.patient_phone, job.message,
        ok ? 'enviado' : 'falhou', ok ? null : String(errorMessage || '').slice(0, 500), job.tenant_id || null]
    ).catch(e => console.error('[reactivation hook]', e.message));
    if (ok && vars.leadId) {
      await pool.query(
        `UPDATE crm_leads SET kanban_stage='reativacao', status='reativacao', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
        [vars.leadId, job.tenant_id]
      ).catch(() => {});
    }
  }
  // Estatísticas contam o resultado real do envio, não o enfileiramento.
  if (job.trigger_event === 'campaign' && job.flow_id) {
    const key = ok ? 'enviadas' : 'erros';
    await pool.query(
      `UPDATE broadcast_campaigns SET
         stats = jsonb_set(COALESCE(stats, '{}'::jsonb), ARRAY[$3::text], to_jsonb(COALESCE((stats->>$3)::int, 0) + 1))
       WHERE id::text = $1 AND tenant_id = $2`,
      [String(job.flow_id), job.tenant_id, key]
    ).catch(e => console.error('[campaign stats]', e.message));
  } else if (ok && job.flow_id) {
    await pool.query(
      `UPDATE automation_flows SET stats = jsonb_set(COALESCE(stats, '{}'::jsonb), '{sent}', to_jsonb(COALESCE((stats->>'sent')::int, 0) + 1))
        WHERE id = $1 AND tenant_id = $2`,
      [String(job.flow_id), job.tenant_id]
    ).catch(e => console.error('[flow stats]', e.message));
  }
  if (job.trigger_event === 'followup_stage' && ok && vars.leadId) {
    await pool.query(
      `INSERT INTO kanban_movements (lead_id, from_stage, to_stage, moved_by_name, reason, tenant_id)
       VALUES ($1, $2, $2, $3, $4, $5)`,
      [vars.leadId, vars.requireStage || null, 'Sistema (Automação)', 'Follow-up automático enviado via WhatsApp', job.tenant_id || null]
    ).catch(() => {});
  }
}

async function processOneWhatsAppJob(candidate, openInstances, usedInstances) {
  if (candidate.instance) {
    const pacing = waPacing.get(candidate.instance);
    if ((pacing && pacing.nextAt > Date.now()) || usedInstances.has(candidate.instance)) return;
  }

  const { rows: [job] } = await pool.query(
    `UPDATE automation_jobs SET claimed_at = NOW(), attempts = COALESCE(attempts, 0) + 1
      WHERE id = $1 AND status = 'pending' AND (claimed_at IS NULL OR claimed_at < NOW() - ${WA_CLAIM_TIMEOUT_SQL})
      RETURNING *`,
    [candidate.id]
  );
  if (!job) return;

  const release = (scheduledAt, note) => pool.query(
    `UPDATE automation_jobs SET claimed_at = NULL, scheduled_at = COALESCE($2, scheduled_at), error = COALESCE($3, error) WHERE id = $1`,
    [job.id, scheduledAt || null, note || null]
  );
  const fail = async (message) => {
    await pool.query(
      `UPDATE automation_jobs SET status = 'failed', error = $2, claimed_at = NULL WHERE id = $1`,
      [job.id, String(message).slice(0, 500)]
    );
    await runWhatsAppJobHooks(job, false, message);
  };

  // 0) Validade
  if (job.expires_at && new Date(job.expires_at) < new Date()) {
    return fail('Expirado: a mensagem não saiu a tempo (WhatsApp desconectado ou fila parada)');
  }

  // 1) Clínica dona do envio
  let tenantId = job.tenant_id ? String(job.tenant_id) : null;
  if (!tenantId && job.instance) tenantId = await resolveInstanceTenant(job.instance);
  if (!tenantId) return fail('Envio sem clínica definida (instância não mapeada)');

  // 2) Número da própria clínica
  let instance = job.instance;
  if (instance) {
    const owner = await resolveInstanceTenant(instance);
    if (owner && owner !== tenantId) return fail('Bloqueado: o número de envio pertence a outra clínica');
    if (!owner) instance = null;
  }
  if (!instance) instance = await getTenantDefaultInstance(tenantId);
  if (!instance) {
    const ageMs = Date.now() - new Date(job.created_at || job.scheduled_at || Date.now()).getTime();
    if (ageMs > 3 * 86_400_000) return fail('Nenhum WhatsApp da clínica conectado há mais de 3 dias');
    return release(new Date(Date.now() + 15 * 60_000), 'Aguardando WhatsApp da clínica conectar');
  }
  if (instance !== job.instance || String(job.tenant_id || '') !== tenantId) {
    await pool.query('UPDATE automation_jobs SET instance = $2, tenant_id = $3 WHERE id = $1', [job.id, instance, tenantId]);
    job.instance = instance; job.tenant_id = tenantId;
  }
  if (!openInstances.has(instance)) return release(new Date(Date.now() + 10 * 60_000), 'WhatsApp desconectado; nova tentativa em 10 min');

  // Ritmo por número: no máximo um envio por número por ciclo e respeitando o
  // intervalo aleatório. A reserva é feita antes de qualquer await seguinte.
  const pacingNow = waPacing.get(instance);
  if (usedInstances.has(instance) || (pacingNow && pacingNow.nextAt > Date.now())) return release(null, null);
  usedInstances.add(instance);

  const { rows: [inst] } = await pool.query(
    'SELECT created_at, paused_until FROM whatsapp_instances WHERE instance_name = $1', [instance]
  ).catch(() => ({ rows: [] }));
  if (inst?.paused_until && new Date(inst.paused_until) > new Date()) {
    return release(new Date(inst.paused_until), 'Número em pausa automática');
  }

  // 3) Opt-out e duplicidade
  if (await isWhatsAppOptedOut(tenantId, job.patient_phone)) {
    return fail('Paciente pediu para não receber mensagens (SAIR)');
  }
  const { rows: dup } = await pool.query(
    `SELECT 1 FROM automation_jobs
      WHERE tenant_id = $1 AND status = 'sent' AND id <> $2 AND message = $3
        AND RIGHT(regexp_replace(patient_phone, '\\D', '', 'g'), 8) = RIGHT(regexp_replace($4, '\\D', '', 'g'), 8)
        AND sent_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
    [tenantId, job.id, job.message, job.patient_phone]
  );
  if (dup.length) return fail('Mensagem idêntica já enviada a este paciente nas últimas 24h');

  // 4) Janela de horário (não vale para respostas de atendimento)
  if (job.category !== 'service' && !isWithinWhatsAppSendWindow()) {
    const next = nextWhatsAppSendWindowStart();
    return release(new Date(next.getTime() + randomBetween(0, 20) * 60_000), 'Fora do horário de envio');
  }

  // 5) Limites por número
  const tier = getRateTier(inst?.created_at);
  const { rows: [counts] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE sent_at > NOW() - INTERVAL '1 hour')::int AS last_hour,
            COUNT(*) FILTER (WHERE (sent_at AT TIME ZONE '${WA_TZ}')::date = (NOW() AT TIME ZONE '${WA_TZ}')::date)::int AS today
       FROM automation_jobs WHERE instance = $1 AND status = 'sent' AND sent_at > NOW() - INTERVAL '26 hours'`,
    [instance]
  );
  if (counts.today >= tier.perDay) {
    const tomorrow = nextWhatsAppSendWindowStart(new Date(Date.now() + 6 * 60 * 60_000));
    return release(new Date(tomorrow.getTime() + randomBetween(0, 30) * 60_000), `Limite diário do número (${tier.perDay})`);
  }
  if (counts.last_hour >= tier.perHour) {
    return release(new Date(Date.now() + randomBetween(15, 30) * 60_000), `Limite por hora do número (${tier.perHour})`);
  }

  // 6) Condições específicas do job
  let vars = job.variables;
  if (typeof vars === 'string') { try { vars = JSON.parse(vars); } catch { vars = {}; } }
  if (vars?.requireStage && vars?.leadId) {
    const { rows: lead } = await pool.query('SELECT kanban_stage FROM crm_leads WHERE id = $1 AND tenant_id = $2', [vars.leadId, tenantId]);
    if (!lead.length || lead[0].kanban_stage !== vars.requireStage) {
      return fail(`Cancelado: lead saiu da etapa ${vars.requireStage}`);
    }
  }

  // 7) Envio com "digitando..."
  scheduleNextWhatsAppSend(instance);
  const phone = normalizeWhatsappNumber(job.patient_phone);
  const result = await evolutionFetch(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    body: JSON.stringify({
      number: phone.includes('@') ? phone : `${phone}@s.whatsapp.net`,
      text: job.message,
      delay: typingDelayMs(job.message),
    }),
    timeoutMs: 45_000, // > tempo de "digitando" + margem; evita falso "falhou"
  });
  const ok = result.ok && !!(result.data?.key?.id || result.data?.message?.key?.id);
  await recordWhatsAppOutcome(instance, tenantId, ok);
  if (ok) {
    await pool.query(`UPDATE automation_jobs SET status = 'sent', sent_at = NOW(), claimed_at = NULL, error = NULL WHERE id = $1`, [job.id]);
    await runWhatsAppJobHooks(job, true);
    console.log(`   ✅ WhatsApp ${job.trigger_event || 'job'} → ${String(phone).slice(-4).padStart(8, '*')} via ${instance}`);
  } else {
    const errMsg = friendlyEvolutionErrorMessage(result.data, `Falha no envio (HTTP ${result.status})`);
    await fail(errMsg);
    console.error(`   ❌ WhatsApp job ${job.id} via ${instance}: ${errMsg}`);
  }
}

let waQueueRunning = false;
async function processAutomationJobs() {
  if (waQueueRunning) return; // nunca roda dois ciclos ao mesmo tempo
  waQueueRunning = true;
  try {
    await pool.query(
      `UPDATE automation_jobs SET status = 'failed', error = 'Canal "' || channel || '" não suportado ainda'
        WHERE status = 'pending' AND scheduled_at <= NOW() AND COALESCE(channel, 'whatsapp') <> 'whatsapp'`
    );
    // Um candidato por número (ou por clínica, quando o job ainda não tem número).
    const { rows: candidates } = await pool.query(
      `SELECT DISTINCT ON (COALESCE(NULLIF(instance, ''), 'tenant:' || COALESCE(tenant_id::text, 'none'))) *
         FROM automation_jobs
        WHERE status = 'pending' AND scheduled_at <= NOW() AND COALESCE(channel, 'whatsapp') = 'whatsapp'
          AND (claimed_at IS NULL OR claimed_at < NOW() - ${WA_CLAIM_TIMEOUT_SQL})
        ORDER BY COALESCE(NULLIF(instance, ''), 'tenant:' || COALESCE(tenant_id::text, 'none')), scheduled_at ASC
        LIMIT 200`
    );
    if (!candidates.length) return;
    const open = await getOpenEvolutionInstances();
    const usedInstances = new Set();
    const CONCURRENCY = 5;
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      await Promise.all(candidates.slice(i, i + CONCURRENCY).map(job =>
        processOneWhatsAppJob({ ...job, instance: job.instance || null }, open, usedInstances)
          .catch(err => console.error(`❌ WhatsApp job ${job.id} error:`, err.message))
      ));
    }
  } catch (err) {
    console.error('❌ WhatsApp queue error:', err.message);
  } finally {
    waQueueRunning = false;
  }
}

// Esquema da fila (idempotente; também em migration-whatsapp-fase1.sql).
async function ensureWhatsAppQueueSchema() {
  const statements = [
    `ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS tenant_id UUID`,
    `ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'transactional'`,
    `ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS attempts INT DEFAULT 0`,
    `ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS automation_jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
    `CREATE INDEX IF NOT EXISTS idx_automation_jobs_tenant_sent ON automation_jobs (tenant_id, sent_at) WHERE status = 'sent'`,
    `CREATE INDEX IF NOT EXISTS idx_automation_jobs_due ON automation_jobs (status, scheduled_at)`,
    `CREATE INDEX IF NOT EXISTS idx_automation_jobs_instance_sent ON automation_jobs (instance, sent_at)`,
    `CREATE INDEX IF NOT EXISTS idx_automation_jobs_tenant ON automation_jobs (tenant_id)`,
    `ALTER TABLE IF EXISTS automation_flows ADD COLUMN IF NOT EXISTS tenant_id UUID`,
    `ALTER TABLE IF EXISTS broadcast_campaigns ADD COLUMN IF NOT EXISTS tenant_id UUID`,
    `ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ`,
    `ALTER TABLE IF EXISTS whatsapp_instances ADD COLUMN IF NOT EXISTS pause_reason TEXT`,
    `CREATE TABLE IF NOT EXISTS whatsapp_opt_outs (
       tenant_id UUID NOT NULL,
       phone_key TEXT NOT NULL,
       phone TEXT,
       source TEXT,
       keyword TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (tenant_id, phone_key)
     )`,
    // Preenche a clínica de registros antigos (criados antes do isolamento).
    `UPDATE automation_flows f SET tenant_id = p.tenant_id FROM profiles p
      WHERE f.tenant_id IS NULL AND p.id::text = f.created_by::text AND p.tenant_id IS NOT NULL`,
    `UPDATE broadcast_campaigns c SET tenant_id = p.tenant_id FROM profiles p
      WHERE c.tenant_id IS NULL AND p.id::text = c.created_by::text AND p.tenant_id IS NOT NULL`,
    `UPDATE automation_jobs j SET tenant_id = w.tenant_id FROM whatsapp_instances w
      WHERE j.tenant_id IS NULL AND w.instance_name = j.instance AND w.tenant_id IS NOT NULL`,
    // Jobs pendentes antigos ganham validade de 7 dias a partir do agendamento
    `UPDATE automation_jobs SET expires_at = scheduled_at + INTERVAL '7 days'
      WHERE status = 'pending' AND expires_at IS NULL`,
  ];
  for (const sql of statements) {
    await pool.query(sql).catch(e => console.error('[wa-schema]', e.message, '→', sql.split('\n')[0].slice(0, 90)));
  }
}

// Isolamento por clínica de tabelas criadas fora do bootstrap (idempotente; também em
// migration-seguranca-p0.sql). clinica_config passa a ter uma linha por tenant; a linha
// legada id=1 fica só como valor padrão de leitura.
async function ensureTenantConfigSchema() {
  const statements = [
    `ALTER TABLE IF EXISTS clinica_config ADD COLUMN IF NOT EXISTS tenant_id UUID`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_clinica_config_tenant ON clinica_config (tenant_id)`,
    `CREATE SEQUENCE IF NOT EXISTS clinica_config_id_seq`,
    `SELECT setval('clinica_config_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM clinica_config), 1))`,
    `ALTER TABLE IF EXISTS clinica_config ALTER COLUMN id SET DEFAULT nextval('clinica_config_id_seq')`,
    `ALTER TABLE IF EXISTS agenda_marcadores ADD COLUMN IF NOT EXISTS tenant_id UUID`,
    `ALTER TABLE IF EXISTS agenda_marcadores ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id()`,
    `CREATE INDEX IF NOT EXISTS idx_agenda_marcadores_tenant ON agenda_marcadores (tenant_id)`,
    `ALTER TABLE IF EXISTS procedimentos_catalogo ADD COLUMN IF NOT EXISTS tenant_id UUID`,
    `ALTER TABLE IF EXISTS procedimentos_catalogo ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id()`,
    `CREATE INDEX IF NOT EXISTS idx_procedimentos_catalogo_tenant ON procedimentos_catalogo (tenant_id)`,
    // Registros antigos sem clínica: só atribui automaticamente quando existe uma única clínica.
    `UPDATE agenda_marcadores SET tenant_id = (SELECT id FROM tenants LIMIT 1)
      WHERE tenant_id IS NULL AND (SELECT COUNT(*) FROM tenants) = 1`,
    `UPDATE procedimentos_catalogo SET tenant_id = (SELECT id FROM tenants LIMIT 1)
      WHERE tenant_id IS NULL AND (SELECT COUNT(*) FROM tenants) = 1`,
    // Filas sem clínica deixam de aparecer no menu de todas as clínicas.
    `UPDATE attendance_queues SET tenant_id = (SELECT id FROM tenants LIMIT 1)
      WHERE tenant_id IS NULL AND (SELECT COUNT(*) FROM tenants) = 1`,
  ];
  for (const sql of statements) {
    await pool.query(sql).catch(e => console.error('[tenant-schema]', e.message, '→', sql.split('\n')[0].slice(0, 90)));
  }
  // tenant_settings também no boot (mesma definição da migration-tenant-m0.sql), para a
  // configuração por clínica não depender da M0. Sem permissão de DDL só registra o erro.
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, key)
    )`);
  } catch (e) {
    console.error('[tenant-schema] tenant_settings:', e.message);
  }
  await copyGlobalSettingsToTenants();
}

// A configuração global antiga (app_settings/system_settings) valia para todas as clínicas:
// vira o ponto de partida de cada clínica existente, para nada mudar de comportamento na troca
// (ex.: follow-up desligado não religa). Só campos sem texto livre: mensagens podem ter nome
// ou endereço de uma clínica e não podem ir para as outras. Roda uma única vez por chave
// (marcador em app_settings, gravado na mesma instrução); não sobrescreve o que a clínica já
// gravou; clínicas criadas depois começam no padrão do sistema.
const jsonbPick = (fields) =>
  `jsonb_strip_nulls(jsonb_build_object(${fields.map(f => `'${f}', s.value -> '${f}'`).join(', ')}))`;
const REAL_TENANTS_COUNT_SQL = '(SELECT COUNT(*) FROM tenants WHERE id::text <> ALL($3::text[]))';
const ATTENDANCE_SAFE_FIELDS = [
  'businessHours', 'autoGreetingEnabled', 'signatureEnabled', 'closingMessageEnabled',
  'inactivityTimeout', 'inactivityMessageEnabled',
];
const GLOBAL_SETTINGS_TO_TENANTS = [
  { table: 'app_settings', key: 'solution_hours', value: 's.value' },
  {
    // Com uma única clínica real o objeto inteiro era dela; com várias, só os campos seguros.
    table: 'app_settings', key: 'attendance_settings',
    value: `CASE WHEN ${REAL_TENANTS_COUNT_SQL} = 1 THEN s.value ELSE ${jsonbPick(ATTENDANCE_SAFE_FIELDS)} END`,
  },
  {
    // Sem messages: a linha global nunca foi aplicada e o seed tem texto promocional.
    table: 'system_settings', key: 'followup_automation',
    value: jsonbPick(['enabled', 'stages', 'delaySeconds', 'delayDays']),
  },
];

async function copyGlobalSettingsToTenants() {
  for (const { table, key, value } of GLOBAL_SETTINGS_TO_TENANTS) {
    try {
      const { rowCount } = await pool.query(
        `WITH marcador AS (
           INSERT INTO app_settings (key, value, updated_at) VALUES ($1, '{"feito": true}'::jsonb, NOW())
           ON CONFLICT (key) DO NOTHING
           RETURNING key
         ),
         origem AS (
           SELECT ${value} AS value FROM ${table} s
            WHERE s.key = $2 AND jsonb_typeof(s.value) = 'object'
         )
         INSERT INTO tenant_settings (tenant_id, key, value, updated_at)
         SELECT t.id, $2, o.value, NOW()
           FROM tenants t CROSS JOIN origem o
          WHERE EXISTS (SELECT 1 FROM marcador)
            AND t.id::text <> ALL($3::text[])
            AND o.value <> '{}'::jsonb
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        [`tenant_settings_copia_${key}`, key, [...PLACEHOLDER_TENANT_IDS]]
      );
      if (rowCount) console.log(`   ⚙️ Configuração global ${key} copiada para as clínicas: ${rowCount} registro(s)`);
    } catch (e) {
      // Tabela de origem/destino ausente: a instrução inteira é desfeita (marcador incluso)
      // e a cópia é tentada de novo no próximo boot.
      console.error(`[tenant-schema] cópia de ${key} para tenant_settings:`, e.message);
    }
  }
}

// Gatilhos de prospecção/retorno: contam como marketing (opt-out obrigatório, dedupe).
const AUTOMATION_MARKETING_TRIGGERS = new Set([
  'Paciente inativo há 60+ dias', 'Paciente inativo há 90+ dias', 'Paciente inativo há 180+ dias',
  'Data de aniversário do paciente', 'Orçamento criado e não fechado', 'Orçamento criado e não aprovado',
  'Lead entrou no CRM',
]);

// Map trigger_event strings to automation types
const TRIGGER_MAP = {
  'Após consulta finalizada': 'pos_consulta',
  'Atendimento finalizado sem agendamento': 'pos_consulta',
  'Lead entrou no CRM': 'custom',
  'Orçamento criado e não fechado': 'followup_orcamento',
  'Paciente inativo há 60+ dias': 'reativacao',
  'Paciente inativo há 90+ dias': 'reativacao',
  'Paciente inativo há 180+ dias': 'reativacao',
  '30 dias antes do retorno': 'lembrete_retorno',
  '7 dias antes do retorno': 'lembrete_retorno',
  'Data de aniversário do paciente': 'aniversario',
  'Agendamento criado sem confirmação': 'confirmacao_agenda',
  'Consulta desmarcada pelo paciente': 'desmarcacao',
  'Paciente não compareceu à consulta': 'faltas',
  'Paciente faltou à primeira consulta': 'faltas_primeira',
  'Parcela ou pagamento em atraso': 'inadimplencia',
  'Orçamento criado e não aprovado': 'orcamento_aberto',
  'Tratamento ativo sem agendamento futuro': 'tratamento_sem_agenda',
};

// Core: enqueue all steps of matching flows for a given trigger event
// patientData.tenantId é obrigatório: só fluxos e número da própria clínica.
async function triggerAutomationFlows(triggerEvent, patientData) {
  try {
    const tenantId = patientData?.tenantId || patientData?.tenant_id || null;
    if (!isValidTenantId(tenantId)) {
      console.warn(`⚠️ Automation trigger "${triggerEvent}" ignorado: clínica não informada`);
      return;
    }
    const { rows: flows } = await pool.query(
      `SELECT * FROM automation_flows WHERE active = true AND trigger_event = $1 AND tenant_id = $2`,
      [triggerEvent, tenantId]
    );
    if (flows.length === 0) return;

    // O número é escolhido pela fila no momento do envio (sempre da clínica).
    const instanceName = await getTenantDefaultInstance(tenantId);

    const phone = normalizeWhatsappNumber(patientData.phone || patientData.telefone || '');
    if (!phone) return;

    const vars = {
      nome: patientData.name || patientData.nome || '',
      primeiro_nome: (patientData.name || patientData.nome || '').split(' ')[0],
      telefone: phone,
      procedimento: patientData.procedimento || '',
      valor: patientData.valor || '',
      horario: patientData.horario || '',
      data: patientData.data || '',
      dentista: patientData.dentista || '',
      clinica: await getTenantClinicName(tenantId),
      link_agendamento: patientData.link_agendamento || '',
    };
    // Fluxo de marketing nunca revela procedimento nem valor (LGPD art. 11 I).
    if (AUTOMATION_MARKETING_TRIGGERS.has(triggerEvent)) { vars.procedimento = ''; vars.valor = ''; }

    let totalJobs = 0;
    for (const flow of flows) {
      const steps = typeof flow.steps === 'string' ? JSON.parse(flow.steps) : flow.steps;
      if (!steps || steps.length === 0) continue;

      // Check if we already have pending jobs for this flow+phone (avoid duplicates)
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM automation_jobs WHERE flow_id = $1 AND patient_phone = $2 AND status = 'pending' AND tenant_id = $3 LIMIT 1`,
        [flow.id, phone, tenantId]
      );
      if (existing.length > 0) continue;
      if (await isWhatsAppOptedOut(tenantId, phone)) continue;
      if (AUTOMATION_MARKETING_TRIGGERS.has(triggerEvent)) {
        const { rows: recent } = await pool.query(
          `SELECT 1 FROM automation_jobs WHERE flow_id = $1 AND tenant_id = $2
             AND RIGHT(regexp_replace(patient_phone, '\\D', '', 'g'), 8) = RIGHT($3, 8)
             AND created_at > NOW() - INTERVAL '30 days' LIMIT 1`,
          [flow.id, tenantId, phone]
        );
        if (recent.length > 0) continue;
      }

      const now = new Date();
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const delayMs = (step.delayMinutes || 0) * 60 * 1000;
        const scheduledAt = new Date(now.getTime() + delayMs);
        const finalMessage = replaceVariables(step.message, vars);

        if ((step.channel || 'whatsapp') === 'whatsapp') {
          await enqueueWhatsAppJob({
            tenantId, instance: instanceName, phone, message: finalMessage,
            category: AUTOMATION_MARKETING_TRIGGERS.has(triggerEvent) ? 'marketing' : 'transactional',
            flowId: flow.id, flowName: flow.name, stepIndex: i, patientName: vars.nome,
            variables: vars, scheduledAt, triggerEvent,
          });
        } else {
          await pool.query(
            `INSERT INTO automation_jobs (tenant_id, flow_id, flow_name, step_index, patient_name, patient_phone, instance, variables, message, channel, scheduled_at, trigger_event, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, $11::timestamptz + INTERVAL '7 days')`,
            [tenantId, flow.id, flow.name, i, vars.nome, phone, instanceName, JSON.stringify(vars), finalMessage, step.channel, scheduledAt, triggerEvent]
          );
        }
        totalJobs++;
      }

      // "sent" do fluxo é somado em runWhatsAppJobHooks, quando a mensagem sai de fato.
    }

    if (totalJobs > 0) {
      console.log(`🤖 Automation: ${totalJobs} jobs enqueued for trigger "${triggerEvent}" → ${maskPhone(phone)} (${flows.length} flows)`);
    }
  } catch (err) {
    console.error('❌ triggerAutomationFlows error:', err.message);
  }
}

// Manual enqueue endpoint
app.post('/api/automations/enqueue', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { flowId, patientName, patientPhone, variables, instance } = req.body;
    if (!flowId || !patientPhone) return res.status(400).json({ error: 'flowId e patientPhone obrigatórios' });

    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const tenantId = String(user.tenant_id);
    const { rows: flowRows } = await pool.query('SELECT * FROM automation_flows WHERE id = $1 AND tenant_id = $2', [flowId, tenantId]);
    if (flowRows.length === 0) return res.status(404).json({ error: 'Fluxo não encontrado' });
    const flow = flowRows[0];
    if (!flow.active) return res.status(400).json({ error: 'Fluxo está desativado' });

    const steps = typeof flow.steps === 'string' ? JSON.parse(flow.steps) : flow.steps;
    if (!steps || steps.length === 0) return res.status(400).json({ error: 'Fluxo sem etapas' });

    if (instance && !(await userOwnsInstance(user, instance))) {
      return res.status(403).json({ error: 'Este número de WhatsApp não pertence à sua clínica.' });
    }
    const instanceName = instance || await getTenantDefaultInstance(tenantId);
    if (!instanceName) return res.status(400).json({ error: 'Nenhum WhatsApp da sua clínica está conectado' });

    const phone = normalizeWhatsappNumber(patientPhone);
    if (await isWhatsAppOptedOut(tenantId, phone)) {
      return res.status(409).json({ error: 'Este paciente pediu para não receber mensagens (SAIR).' });
    }
    const vars = { nome: patientName || '', telefone: phone, ...(variables || {}) };
    const now = new Date();
    const jobIds = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const delayMs = (step.delayMinutes || 0) * 60 * 1000;
      const scheduledAt = new Date(now.getTime() + delayMs);
      const finalMessage = replaceVariables(step.message, vars);

      const { rows } = await pool.query(
        `INSERT INTO automation_jobs (tenant_id, category, flow_id, flow_name, step_index, patient_name, patient_phone, instance, variables, message, channel, scheduled_at, trigger_event, expires_at)
         VALUES ($1,'transactional',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual', $11::timestamptz + INTERVAL '7 days') RETURNING id`,
        [tenantId, flow.id, flow.name, i, patientName || '', phone, instanceName, JSON.stringify(vars), finalMessage, step.channel || 'whatsapp', scheduledAt]
      );
      jobIds.push(rows[0].id);
    }

    await pool.query(
      `UPDATE automation_flows SET stats = jsonb_set(stats, '{sent}', to_jsonb(COALESCE((stats->>'sent')::int, 0) + $1)) WHERE id = $2`,
      [steps.length, flow.id]
    ).catch(() => {});

    console.log(`🤖 Manual enqueue: ${steps.length} jobs for flow "${flow.name}" → ${maskPhone(phone)}`);
    res.json({ success: true, jobsCreated: jobIds.length, jobIds });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// List automation jobs
app.get('/api/automations/jobs', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { status, flowId, limit } = req.query;
    let sql = 'SELECT * FROM automation_jobs';
    const vals = [];
    const where = [];
    if (!user.is_super_admin) { vals.push(user.tenant_id || null); where.push(`tenant_id = $${vals.length}`); }
    if (status) { vals.push(status); where.push(`status = $${vals.length}`); }
    if (flowId) { vals.push(flowId); where.push(`flow_id = $${vals.length}`); }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY scheduled_at DESC';
    sql += ` LIMIT ${Math.min(parseInt(limit) || 100, 500)}`;
    const { rows } = await pool.query(sql, vals);
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Cancel pending jobs
app.delete('/api/automations/jobs/cancel', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { flowId, patientPhone } = req.body || {};
    let sql = `UPDATE automation_jobs SET status = 'cancelled' WHERE status = 'pending'`;
    const vals = [];
    if (!user.is_super_admin) { vals.push(user.tenant_id || null); sql += ` AND tenant_id = $${vals.length}`; }
    else if (!flowId && !patientPhone) return res.status(400).json({ error: 'Informe flowId ou patientPhone' });
    if (flowId) { vals.push(flowId); sql += ` AND flow_id = $${vals.length}`; }
    if (patientPhone) { vals.push(normalizeWhatsappNumber(patientPhone)); sql += ` AND patient_phone = $${vals.length}`; }
    const { rowCount } = await pool.query(sql, vals);
    res.json({ success: true, cancelled: rowCount });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Automation stats/report endpoint
app.get('/api/automations/stats', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { days = '30' } = req.query;
    const daysInt = Math.min(parseInt(days) || 30, 365);

    // Overall stats
    const { rows: [overall] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'sent') AS total_sent,
        COUNT(*) FILTER (WHERE status = 'failed') AS total_failed,
        COUNT(*) FILTER (WHERE status = 'pending') AS total_pending,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS total_cancelled,
        COUNT(*) AS total_jobs
      FROM automation_jobs
      WHERE created_at >= NOW() - INTERVAL '${daysInt} days' AND tenant_id = $1
    `, [user.tenant_id]);

    // Per-flow stats
    const { rows: perFlow } = await pool.query(`
      SELECT
        flow_id, flow_name,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending
      FROM automation_jobs
      WHERE created_at >= NOW() - INTERVAL '${daysInt} days' AND tenant_id = $1
      GROUP BY flow_id, flow_name
      ORDER BY total DESC
    `, [user.tenant_id]);

    // Daily timeline
    const { rows: timeline } = await pool.query(`
      SELECT
        DATE(scheduled_at) AS date,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) AS total
      FROM automation_jobs
      WHERE created_at >= NOW() - INTERVAL '${daysInt} days' AND tenant_id = $1
      GROUP BY DATE(scheduled_at)
      ORDER BY date ASC
    `, [user.tenant_id]);

    // Per-flow stats from automation_flows table (includes responded/converted)
    const { rows: flowStats } = await pool.query(`
      SELECT id, name, active,
        COALESCE((stats->>'sent')::int, 0) AS sent,
        COALESCE((stats->>'responded')::int, 0) AS responded,
        COALESCE((stats->>'converted')::int, 0) AS converted
      FROM automation_flows
      WHERE tenant_id = $1
      ORDER BY sent DESC
    `, [user.tenant_id]);

    res.json({
      overall: {
        totalJobs: parseInt(overall.total_jobs),
        totalSent: parseInt(overall.total_sent),
        totalFailed: parseInt(overall.total_failed),
        totalPending: parseInt(overall.total_pending),
        totalCancelled: parseInt(overall.total_cancelled),
        deliveryRate: parseInt(overall.total_sent) > 0
          ? ((parseInt(overall.total_sent) / (parseInt(overall.total_sent) + parseInt(overall.total_failed))) * 100).toFixed(1)
          : '0',
      },
      perFlow,
      timeline,
      flowStats,
      period: daysInt,
    });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// BROADCAST CAMPAIGNS (Disparos) CRUD
// ═══════════════════════════════════════════════════════════════

// List all campaigns
function mapCampaignRow(r) {
  return {
    id: r.id,
    nome: r.nome,
    template: typeof r.template === 'string' ? JSON.parse(r.template) : r.template,
    tipo: r.tipo,
    diasSemana: typeof r.dias_semana === 'string' ? JSON.parse(r.dias_semana) : r.dias_semana,
    horarioInicio: r.horario_inicio,
    horarioFim: r.horario_fim,
    dataInicio: r.data_inicio,
    dataFim: r.data_fim,
    campanhaPerpetua: r.campanha_perpetua,
    usarHorarioClinica: r.usar_horario_clinica,
    publico: r.publico,
    filtroCustom: r.filtro_custom,
    numeroEnvio: r.numero_envio,
    contatosAlcancaveis: r.contatos_alcancaveis || 0,
    capacidadeDiaria: r.capacidade_diaria || 232,
    intervaloSpam: r.intervalo_spam || 7,
    ativo: r.ativo,
    stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats,
    criadoEm: r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '',
  };
}

app.get('/api/campaigns', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT * FROM broadcast_campaigns WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [user.tenant_id || null]
    );
    res.json(rows.map(mapCampaignRow));
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Create campaign
app.post('/api/campaigns', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, template, tipo, diasSemana, horarioInicio, horarioFim, dataInicio, dataFim,
      campanhaPerpetua, usarHorarioClinica, publico, filtroCustom, numeroEnvio,
      contatosAlcancaveis, capacidadeDiaria, intervaloSpam, ativo } = req.body;

    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
    if (numeroEnvio && !(await userOwnsInstance(user, numeroEnvio))) {
      return res.status(403).json({ error: 'Este número de WhatsApp não pertence à sua clínica.' });
    }

    const id = `camp_${Date.now()}`;
    await pool.query(
      `INSERT INTO broadcast_campaigns
        (id, nome, template, tipo, dias_semana, horario_inicio, horario_fim, data_inicio, data_fim,
         campanha_perpetua, usar_horario_clinica, publico, filtro_custom, numero_envio,
         contatos_alcancaveis, capacidade_diaria, intervalo_spam, ativo, created_by, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [id, nome, JSON.stringify(template || {}), tipo || 'unico',
       JSON.stringify(diasSemana || []), horarioInicio, horarioFim, dataInicio, dataFim,
       campanhaPerpetua || false, usarHorarioClinica || false,
       publico || 'todos', filtroCustom, numeroEnvio,
       contatosAlcancaveis || 0, capacidadeDiaria || 232, intervaloSpam || 7,
       ativo || false, user.id, user.tenant_id]
    );
    res.json({ success: true, id });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Update campaign
app.put('/api/campaigns/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id } = req.params;
    const fields = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (fields.numeroEnvio && !(await userOwnsInstance(user, fields.numeroEnvio))) {
      return res.status(403).json({ error: 'Este número de WhatsApp não pertence à sua clínica.' });
    }

    const fieldMap = {
      nome: 'nome', tipo: 'tipo', publico: 'publico', filtroCustom: 'filtro_custom',
      numeroEnvio: 'numero_envio', horarioInicio: 'horario_inicio', horarioFim: 'horario_fim',
      dataInicio: 'data_inicio', dataFim: 'data_fim',
      campanhaPerpetua: 'campanha_perpetua', usarHorarioClinica: 'usar_horario_clinica',
      contatosAlcancaveis: 'contatos_alcancaveis', capacidadeDiaria: 'capacidade_diaria',
      intervaloSpam: 'intervalo_spam', ativo: 'ativo',
    };

    for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
      if (fields[jsKey] !== undefined) {
        sets.push(`${dbCol} = $${idx++}`);
        vals.push(fields[jsKey]);
      }
    }
    if (fields.template !== undefined) {
      sets.push(`template = $${idx++}`);
      vals.push(JSON.stringify(fields.template));
    }
    if (fields.diasSemana !== undefined) {
      sets.push(`dias_semana = $${idx++}`);
      vals.push(JSON.stringify(fields.diasSemana));
    }
    if (fields.stats !== undefined) {
      sets.push(`stats = $${idx++}`);
      vals.push(JSON.stringify(fields.stats));
    }

    if (sets.length === 0) return res.json({ success: true });
    sets.push(`updated_at = NOW()`);
    vals.push(id, user.tenant_id || null);
    const { rowCount } = await pool.query(
      `UPDATE broadcast_campaigns SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1}`, vals
    );
    if (!rowCount) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Delete campaign
app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id || null]
    );
    if (!rowCount) return res.status(404).json({ error: 'Campanha não encontrada' });
    // Mensagens ainda na fila desta campanha não devem sair depois de excluída.
    await pool.query(
      `UPDATE automation_jobs SET status = 'cancelled', error = 'Campanha excluída'
        WHERE flow_id = $1 AND trigger_event = 'campaign' AND status = 'pending' AND tenant_id = $2`,
      [id, user.tenant_id || null]
    ).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Toggle campaign active
app.patch('/api/campaigns/:id/toggle', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE broadcast_campaigns SET ativo = NOT ativo, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING ativo`,
      [id, user.tenant_id || null]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Campanha não encontrada' });
    if (!rows[0].ativo) {
      await pool.query(
        `UPDATE automation_jobs SET status = 'cancelled', error = 'Campanha pausada'
          WHERE flow_id = $1 AND trigger_event = 'campaign' AND status = 'pending' AND tenant_id = $2`,
        [id, user.tenant_id || null]
      ).catch(() => {});
    }
    res.json({ success: true, ativo: rows[0].ativo });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Duplicate campaign
app.post('/api/campaigns/:id/duplicate', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      'SELECT * FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id || null]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Campanha não encontrada' });
    const orig = rows[0];
    const newId = `camp_${Date.now()}`;
    await pool.query(
      `INSERT INTO broadcast_campaigns
        (id, nome, template, tipo, dias_semana, horario_inicio, horario_fim, data_inicio, data_fim,
         campanha_perpetua, usar_horario_clinica, publico, filtro_custom, numero_envio,
         contatos_alcancaveis, capacidade_diaria, intervalo_spam, ativo, created_by, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [newId, orig.nome + ' (cópia)', orig.template, orig.tipo, orig.dias_semana,
       orig.horario_inicio, orig.horario_fim, orig.data_inicio, orig.data_fim,
       orig.campanha_perpetua, orig.usar_horario_clinica, orig.publico, orig.filtro_custom,
       orig.numero_envio, orig.contatos_alcancaveis, orig.capacidade_diaria,
       orig.intervalo_spam, false, user.id, orig.tenant_id]
    );
    res.json({ success: true, id: newId });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Público da campanha — sempre só contatos da clínica dona da campanha.
async function resolveCampaignAudience(camp, tenantId) {
  const limit = Math.min(Number(camp.capacidade_diaria) || 232, 500);
  const publico = camp.publico || 'todos';
  const run = async (sql) => {
    try {
      const { rows } = await pool.query(sql, [limit, tenantId]);
      return rows;
    } catch (err) {
      console.error(`[campaign audience:${publico}]`, err.message);
      return [];
    }
  };
  if (publico === 'ativos') {
    return run(`SELECT DISTINCT cl.nome, cl.telefone FROM crm_leads cl
       INNER JOIN chat_messages cm ON cm.phone = cl.telefone AND cm.tenant_id = cl.tenant_id
       WHERE cl.tenant_id = $2 AND cl.telefone IS NOT NULL AND cl.telefone != '' AND cm.timestamp > NOW() - INTERVAL '180 days'
       LIMIT $1`);
  }
  if (publico === 'inativos') {
    return run(`SELECT DISTINCT cl.nome, cl.telefone FROM crm_leads cl
       LEFT JOIN chat_messages cm ON cm.phone = cl.telefone AND cm.tenant_id = cl.tenant_id AND cm.timestamp > NOW() - INTERVAL '90 days'
       WHERE cl.tenant_id = $2 AND cl.telefone IS NOT NULL AND cl.telefone != '' AND cm.id IS NULL
       LIMIT $1`);
  }
  if (publico === 'aniversariantes') {
    return run(`SELECT nome, telefone FROM contatos
       WHERE tenant_id = $2 AND telefone IS NOT NULL AND telefone != ''
         AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM NOW())
       LIMIT $1`);
  }
  return run(`SELECT DISTINCT COALESCE(c.nome, cl.nome) AS nome, COALESCE(c.telefone, cl.telefone) AS telefone
     FROM crm_leads cl LEFT JOIN contatos c ON c.telefone = cl.telefone AND c.tenant_id = cl.tenant_id
     WHERE cl.tenant_id = $2 AND COALESCE(c.telefone, cl.telefone) IS NOT NULL AND COALESCE(c.telefone, cl.telefone) != ''
     LIMIT $1`);
}

// Coloca a campanha na fila anti-bloqueio. A fila decide quando cada mensagem
// sai (horário, limites do número, intervalo aleatório, SAIR).
async function enqueueCampaignForTenant(camp, tenantId) {
  const template = typeof camp.template === 'string' ? JSON.parse(camp.template) : camp.template;
  const message = template?.mensagem || template?.message || '';
  if (!message) return { error: 'Template sem mensagem configurada', status: 400 };

  let instance = camp.numero_envio || null;
  if (instance && (await resolveInstanceTenant(instance)) !== tenantId) instance = null;
  if (!instance) instance = await getTenantDefaultInstance(tenantId);
  if (!instance) return { error: 'Nenhum WhatsApp da sua clínica está conectado', status: 400 };

  const contacts = await resolveCampaignAudience(camp, tenantId);
  if (contacts.length === 0) return { enqueued: 0, total: 0, skipped: 0, message: 'Nenhum contato encontrado para este público' };

  const spamDays = camp.intervalo_spam || 7;
  const { rows: recentlySent } = await pool.query(
    `SELECT DISTINCT patient_phone FROM automation_jobs
      WHERE trigger_event = 'campaign' AND status IN ('sent', 'pending') AND tenant_id = $3
        AND COALESCE(sent_at, created_at) > NOW() - INTERVAL '1 day' * $1 AND flow_id = $2`,
    [spamDays, camp.id, tenantId]
  );
  const recentKeys = new Set(recentlySent.map(r => waPhoneKey(r.patient_phone)));

  let enqueued = 0, optedOut = 0;
  const clinica = await getTenantClinicName(tenantId);
  for (const contact of contacts) {
    const phone = normalizeWhatsappNumber(contact.telefone);
    if (!phone || recentKeys.has(waPhoneKey(phone))) continue;
    if (await isWhatsAppOptedOut(tenantId, phone)) { optedOut++; continue; }
    recentKeys.add(waPhoneKey(phone));
    const personalizedMsg = message
      .replace(/\{\{nome\}\}/gi, (contact.nome || 'Cliente').split(' ')[0])
      .replace(/\{\{telefone\}\}/gi, contact.telefone || '')
      .replace(/\{\{clinica\}\}/gi, clinica)
      .replace(/\{\{\s*(procedimento|valor)\s*\}\}/gi, '');
    await enqueueWhatsAppJob({
      tenantId, instance, phone, message: personalizedMsg, category: 'marketing',
      flowId: camp.id, flowName: camp.nome, patientName: contact.nome || '', triggerEvent: 'campaign',
    });
    enqueued++;
  }

  if (enqueued > 0) {
    await pool.query(
      `UPDATE broadcast_campaigns SET
         stats = jsonb_set(COALESCE(stats, '{}'::jsonb), '{enfileiradas}', to_jsonb(COALESCE((stats->>'enfileiradas')::int, 0) + $1)),
         contatos_alcancaveis = $2, updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [enqueued, contacts.length, camp.id, tenantId]
    );
  }
  return { enqueued, total: contacts.length, skipped: contacts.length - enqueued, optedOut };
}

// Execute campaign — resolve contacts by audience, enqueue jobs
app.post('/api/campaigns/:id/execute', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: campRows } = await pool.query(
      'SELECT * FROM broadcast_campaigns WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]
    );
    if (campRows.length === 0) return res.status(404).json({ error: 'Campanha não encontrada' });
    const camp = campRows[0];
    const result = await enqueueCampaignForTenant(camp, String(user.tenant_id));
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    await pool.query(
      `UPDATE broadcast_campaigns SET ativo = true, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [camp.id, user.tenant_id]
    );
    console.log(`📢 Campaign "${camp.nome}" enfileirada: ${result.enqueued} (${result.skipped} ignorados)`);
    res.json({ success: true, queued: true, ...result });
  } catch (error) {
    console.error('❌ Campaign execute error:', error.message);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Campaign job stats
app.get('/api/campaigns/:id/jobs', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id } = req.params;
    const tenantId = user.tenant_id || null;
    const { rows: summary } = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM automation_jobs
        WHERE flow_id = $1 AND trigger_event = 'campaign' AND tenant_id = $2 GROUP BY status`, [id, tenantId]);
    const { rows: recent } = await pool.query(
      `SELECT patient_name, patient_phone, status, sent_at, error, scheduled_at
       FROM automation_jobs WHERE flow_id = $1 AND trigger_event = 'campaign' AND tenant_id = $2
       ORDER BY created_at DESC LIMIT 50`, [id, tenantId]);
    res.json({ summary: Object.fromEntries(summary.map(s => [s.status, s.count])), recent });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Campaign scheduler — auto-execute recurrent campaigns (horário de Brasília)
let campaignSchedulerInterval = null;

async function processCampaignScheduler() {
  try {
    const { rows: activeCampaigns } = await pool.query(
      `SELECT * FROM broadcast_campaigns WHERE ativo = true AND tipo = 'recorrente' AND tenant_id IS NOT NULL`);
    if (activeCampaigns.length === 0) return;

    const { weekday, minutes, day } = spClock();
    const currentDay = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'][weekday];
    const currentTime = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

    for (const camp of activeCampaigns) {
      const diasSemana = typeof camp.dias_semana === 'string' ? JSON.parse(camp.dias_semana) : (camp.dias_semana || []);
      if (diasSemana.length > 0 && !diasSemana.includes(currentDay)) continue;
      if (camp.horario_inicio && currentTime < camp.horario_inicio) continue;
      if (camp.horario_fim && currentTime > camp.horario_fim) continue;

      // Uma execução por dia (dia de Brasília)
      const { rows: todayJobs } = await pool.query(
        `SELECT 1 FROM automation_jobs WHERE flow_id = $1 AND trigger_event = 'campaign' AND tenant_id = $2
           AND (created_at AT TIME ZONE '${WA_TZ}')::date = $3::date LIMIT 1`,
        [camp.id, camp.tenant_id, day]
      );
      if (todayJobs.length > 0) continue;

      try {
        const result = await enqueueCampaignForTenant(camp, String(camp.tenant_id));
        if (result.enqueued > 0) console.log(`   ✅ Campaign "${camp.nome}" auto-enfileirada: ${result.enqueued}`);
      } catch (campErr) {
        console.error(`   ❌ Campaign "${camp.nome}" auto-execute error:`, campErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Campaign scheduler error:', err.message);
  }
}

let automationSchedulerInterval = null;

// ─── Cron: Appointment Reminders 24h (runs every 1h) ────────
let appointmentReminderInterval = null;

async function processAppointmentReminders() {
  try {
    // Consultas de amanhã (dia de Brasília) ainda sem lembrete. Cada lembrete
    // sai pelo WhatsApp da própria clínica; a fila segura até o horário de envio.
    const { rows: appointments } = await pool.query(`
      SELECT a.id, a.tenant_id, a.paciente_id, a.paciente_nome, a.dentista_nome, a.data, a.hora, a.procedimento, a.duracao,
             p.telefone
      FROM agendamentos a
      LEFT JOIN pacientes p ON p.id = a.paciente_id AND p.tenant_id = a.tenant_id
      WHERE a.tenant_id IS NOT NULL
        AND a.tenant_id <> '00000000-0000-0000-0000-000000000001'
        AND a.data = ((NOW() AT TIME ZONE '${WA_TZ}')::date + 1)
        AND a.status NOT IN ('cancelado', 'desmarcado', 'faltou', 'finalizado', 'realizado')
        AND NOT EXISTS (
          SELECT 1 FROM automation_jobs aj
           WHERE aj.trigger_event = 'appointment_reminder'
             AND aj.flow_id = 'reminder_' || a.id::text
             AND aj.created_at > NOW() - INTERVAL '3 days'
        )
    `);

    if (appointments.length === 0) return;
    console.log(`🔔 Reminder: ${appointments.length} consultas amanhã para lembrar`);

    const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    for (const appt of appointments) {
      try {
        const phone = normalizeWhatsappNumber(appt.telefone || '');
        if (!phone) continue;

        const isoDate = appt.data instanceof Date ? appt.data.toISOString().split('T')[0] : String(appt.data).slice(0, 10);
        const [y, m, d] = isoDate.split('-');
        const dataBR = `${d}/${m}/${y}`;
        const weekday = WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()] || '';
        const firstName = (appt.paciente_nome || '').split(' ')[0];
        const hora = String(appt.hora || '').slice(0, 5);

        // Data explícita em vez de "amanhã": o lembrete pode sair só no dia
        // seguinte à criação (fila fora do horário de envio).
        // Sem o procedimento: a mensagem aparece na tela bloqueada (LGPD art. 6º III e 46).
        const clinica = await getTenantClinicName(appt.tenant_id);
        const message = `🔔 *Lembrete de consulta — ${clinica}*\n\nOlá, ${firstName}!\n\nVocê tem uma consulta marcada:\n📅 ${weekday}, ${dataBR}\n⏰ ${hora || appt.hora}\n👩‍⚕️ ${appt.dentista_nome || 'Equipe da clínica'}\n\nResponda *SIM* para confirmar ou mande uma mensagem aqui para remarcar.`;

        // Validade: até o horário da consulta (horário de Brasília).
        let expiresAt = new Date(`${isoDate}T${/^\d{2}:\d{2}$/.test(hora) ? hora : '23:59'}:00-03:00`);
        if (Number.isNaN(expiresAt.getTime())) expiresAt = null;

        await enqueueWhatsAppJob({
          tenantId: String(appt.tenant_id), phone, message, category: 'transactional',
          flowId: `reminder_${appt.id}`, flowName: 'Lembrete 24h', patientName: appt.paciente_nome,
          triggerEvent: 'appointment_reminder', expiresAt,
        });
        console.log(`   📩 Lembrete enfileirado (consulta ${appt.id})`);
      } catch (apptErr) {
        console.error(`   ❌ Lembrete da consulta ${appt.id}:`, apptErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Appointment reminder cron error:', err.message);
  }
}

// ─── Cron: inactive patients & birthdays (runs every 6h) ────
let automationCronInterval = null;

async function checkInactivePatientsTrigger() {
  try {
    // Find patients inactive for 60+, 90+, 180+ days with no pending automation
    const thresholds = [
      { days: 60, trigger: 'Paciente inativo há 60+ dias' },
      { days: 90, trigger: 'Paciente inativo há 90+ dias' },
      { days: 180, trigger: 'Paciente inativo há 180+ dias' },
    ];

    for (const { days, trigger } of thresholds) {
      // Check if any active flow uses this trigger
      const { rows: activeFlows } = await pool.query(
        `SELECT 1 FROM automation_flows WHERE active = true AND trigger_event = $1 LIMIT 1`, [trigger]
      );
      if (activeFlows.length === 0) continue;

      // Find inactive leads (no message in X days)
      const { rows: inactiveLeads } = await pool.query(
        `SELECT DISTINCT cl.id, cl.tenant_id, cl.nome, cl.telefone FROM crm_leads cl
         LEFT JOIN chat_messages cm ON cm.phone = cl.telefone AND cm.tenant_id = cl.tenant_id
                                   AND cm.timestamp > NOW() - INTERVAL '${days} days'
         WHERE cl.tenant_id IS NOT NULL AND cl.telefone IS NOT NULL AND cl.telefone != '' AND cm.id IS NULL
           AND EXISTS (
             SELECT 1 FROM automation_flows f
              WHERE f.tenant_id = cl.tenant_id AND f.active = true AND f.trigger_event = $1)
           AND NOT EXISTS (
             SELECT 1 FROM whatsapp_opt_outs o
              WHERE o.tenant_id = cl.tenant_id
                AND RIGHT(o.phone_key, 8) = RIGHT(regexp_replace(cl.telefone, '\\D', '', 'g'), 8))
           AND NOT EXISTS (
             SELECT 1 FROM automation_jobs aj
              WHERE aj.tenant_id = cl.tenant_id AND aj.trigger_event = $1
                AND RIGHT(regexp_replace(aj.patient_phone, '\\D', '', 'g'), 8) = RIGHT(regexp_replace(cl.telefone, '\\D', '', 'g'), 8)
                AND aj.created_at > NOW() - INTERVAL '30 days')
         LIMIT 50`, [trigger]
      );

      for (const lead of inactiveLeads) {
        await triggerAutomationFlows(trigger, { name: lead.nome, phone: lead.telefone, tenantId: lead.tenant_id });
      }

      if (inactiveLeads.length > 0) {
        console.log(`🤖 Inactive check (${days}d): ${inactiveLeads.length} leads triggered`);
      }
    }

    // Birthday check
    const { rows: birthdayFlows } = await pool.query(
      `SELECT 1 FROM automation_flows WHERE active = true AND trigger_event = 'Data de aniversário do paciente' LIMIT 1`
    );
    if (birthdayFlows.length > 0) {
      // If we had birthday data in contatos, we'd check here
      // For now, this is a placeholder for when birthday field is added
      console.log('🎂 Birthday automation check: no birthday data available yet');
    }
  } catch (err) {
    console.error('❌ Inactive patients cron error:', err.message);
  }
}

// ─── Cron: Solution-Based Triggers (runs every 2h) ──────────
let solutionCronInterval = null;

async function processSolutionTriggers() {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // Cada gatilho roda separado por clínica: $1 é sempre o tenant_id. Antes a
    // query era global (LIMIT 100 dividido entre todas as clínicas) e o JOIN não
    // exigia que agendamento e paciente fossem da mesma clínica.
    const solutionQueries = [
      {
        trigger: 'Agendamento criado sem confirmação',
        query: `SELECT DISTINCT p.id, p.tenant_id, p.nome, p.telefone, a.procedimento, a.data::text, a.hora::text as horario,
                  d.nome as dentista
                FROM agendamentos a
                JOIN pacientes p ON a.paciente_id = p.id AND p.tenant_id = a.tenant_id
                LEFT JOIN dentistas d ON a.dentista_id = d.id
                WHERE a.tenant_id = $1
                AND a.data >= $2 AND a.data <= ($2::date + INTERVAL '2 days')
                AND a.status = 'agendado'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                LIMIT 100`,
        params: [today],
      },
      {
        trigger: 'Data de aniversário do paciente',
        query: `SELECT id, tenant_id, nome, telefone FROM pacientes
                WHERE tenant_id = $1
                AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(DAY FROM data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)
                AND telefone IS NOT NULL AND telefone != ''
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Consulta desmarcada pelo paciente',
        query: `SELECT DISTINCT p.id, p.tenant_id, p.nome, p.telefone, a.procedimento
                FROM agendamentos a
                JOIN pacientes p ON a.paciente_id = p.id AND p.tenant_id = a.tenant_id
                WHERE a.tenant_id = $1
                AND a.status IN ('desmarcado','cancelado')
                AND a.updated_at >= NOW() - INTERVAL '24 hours'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Paciente não compareceu à consulta',
        query: `SELECT DISTINCT p.id, p.tenant_id, p.nome, p.telefone, a.procedimento
                FROM agendamentos a
                JOIN pacientes p ON a.paciente_id = p.id AND p.tenant_id = a.tenant_id
                WHERE a.tenant_id = $1
                AND a.status = 'faltou'
                AND a.data >= CURRENT_DATE - INTERVAL '1 day'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Paciente faltou à primeira consulta',
        query: `SELECT DISTINCT p.id, p.tenant_id, p.nome, p.telefone, a.procedimento
                FROM agendamentos a
                JOIN pacientes p ON a.paciente_id = p.id AND p.tenant_id = a.tenant_id
                WHERE a.tenant_id = $1
                AND a.status = 'faltou'
                AND a.data >= CURRENT_DATE - INTERVAL '1 day'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                AND NOT EXISTS (
                  SELECT 1 FROM agendamentos b
                  WHERE b.paciente_id = a.paciente_id AND b.tenant_id = a.tenant_id
                  AND b.status IN ('realizado','confirmado','atendido')
                )
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Parcela ou pagamento em atraso',
        query: `SELECT DISTINCT p.id, p.tenant_id, p.nome, p.telefone, o.valor_total::text as valor
                FROM orcamentos o
                JOIN pacientes p ON o.paciente_id = p.id
                WHERE p.tenant_id = $1
                AND o.status = 'aprovado'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                AND NOT EXISTS (
                  SELECT 1 FROM financeiro f
                  WHERE f.paciente_id = o.paciente_id AND f.tipo = 'receita' AND f.valor >= o.valor_total
                )
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Orçamento criado e não aprovado',
        query: `SELECT DISTINCT p.id, p.tenant_id, p.nome, p.telefone,
                  (o.itens::jsonb->0->>'procedimento')::text as procedimento,
                  ('R$ ' || o.valor_total::text) as valor
                FROM orcamentos o
                JOIN pacientes p ON o.paciente_id = p.id
                WHERE p.tenant_id = $1
                AND o.status = 'pendente'
                AND o.created_at >= NOW() - INTERVAL '30 days'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Tratamento ativo sem agendamento futuro',
        query: `SELECT DISTINCT p.id, p.tenant_id, p.nome, p.telefone, t.descricao as procedimento
                FROM tratamentos t
                JOIN pacientes p ON t.paciente_id = p.id
                WHERE p.tenant_id = $1
                AND t.status IN ('planejado','em_andamento','ativo')
                AND p.telefone IS NOT NULL AND p.telefone != ''
                AND NOT EXISTS (
                  SELECT 1 FROM agendamentos a
                  WHERE a.paciente_id = t.paciente_id AND a.tenant_id = p.tenant_id
                  AND a.data >= $2
                  AND a.status NOT IN ('cancelado','desmarcado','faltou')
                )
                LIMIT 100`,
        params: [today],
      },
    ];

    let totalTriggered = 0;

    for (const sol of solutionQueries) {
      // Só as clínicas que têm fluxo ativo com este gatilho.
      const { rows: tenantRows } = await pool.query(
        `SELECT DISTINCT tenant_id FROM automation_flows
          WHERE active = true AND trigger_event = $1 AND tenant_id IS NOT NULL`,
        [sol.trigger]
      );
      for (const { tenant_id: solTenantId } of tenantRows) {
      if (!isValidTenantId(solTenantId)) continue;
      // Horário de gatilhos da própria clínica; sem conseguir ler, pula a clínica neste ciclo.
      let solHours;
      try { solHours = await getSolutionHours(solTenantId, { throwOnError: true }); } catch { continue; }
      if (!isWithinSolutionHours(solHours, now)) continue;
      const { rows: patients } = await pool.query(sol.query, [solTenantId, ...sol.params]);
      if (patients.length === 0) continue;
      let tenantTriggered = 0;

      for (const patient of patients) {
        if (String(patient.tenant_id) !== String(solTenantId)) continue;
        // Check cooldown: don't re-trigger same patient+trigger within 24h
        const { rows: recent } = await pool.query(
          `SELECT 1 FROM automation_jobs
           WHERE patient_phone LIKE '%' || $1 || '%'
           AND trigger_event = $2
           AND tenant_id = $3
           AND created_at > NOW() - INTERVAL '24 hours'
           LIMIT 1`,
          [patient.telefone.replace(/\D/g, '').slice(-11), sol.trigger, patient.tenant_id]
        );
        if (recent.length > 0) continue;

        await triggerAutomationFlows(sol.trigger, {
          tenantId: patient.tenant_id,
          name: patient.nome,
          phone: patient.telefone,
          procedimento: patient.procedimento || '',
          valor: patient.valor || '',
          horario: patient.horario || '',
          data: patient.data || '',
          dentista: patient.dentista || '',
        });
        totalTriggered++;
        tenantTriggered++;
      }

      console.log(`🤖 Solution "${sol.trigger}" (clínica ${String(solTenantId).slice(0, 8)}): ${patients.length} pacientes, ${tenantTriggered} enfileirados`);
      }
    }

    if (totalTriggered > 0) {
      console.log(`🤖 Solution triggers total: ${totalTriggered} pacientes enfileirados`);
    }
  } catch (err) {
    console.error('❌ Solution triggers cron error:', err.message);
  }
}

// Update lead kanban stage (manual move)
app.patch('/api/crm/leads/:id/stage', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { stage, reason } = req.body;
    if (!stage || !ALL_KANBAN_STAGES.includes(stage)) {
      return res.status(400).json({ error: `Stage inválido. Válidos: ${ALL_KANBAN_STAGES.join(', ')}` });
    }

    // Get current stage for audit
    const { rows: current } = await pool.query('SELECT kanban_stage FROM crm_leads WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (current.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    const fromStage = current[0].kanban_stage;

    const { rows } = await pool.query(
      `UPDATE crm_leads SET kanban_stage = $1, status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING id, nome, kanban_stage`,
      [stage, req.params.id, user.tenant_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });

    // Log movement
    const profile = await getProfileByEmail(user.email);
    await pool.query(
      `INSERT INTO kanban_movements (lead_id, from_stage, to_stage, moved_by, moved_by_name, reason, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.params.id, fromStage, stage, user.id, profile?.name || user.email, reason || null, user.tenant_id]
    ).catch(err => console.error('Failed to log kanban movement:', err.message));

    // 🤖 Trigger follow-up automation if entering a follow-up stage
    if (RECOVERY_STAGES.includes(stage) && stage.startsWith('followup')) {
      triggerFollowupAutomation(req.params.id, stage).catch(() => {});
    }

    // 🤖 Trigger automation flows based on stage change
    const leadForAutomation = rows[0];
    if (leadForAutomation) {
      const { rows: leadDetail } = await pool.query('SELECT nome, telefone, tenant_id FROM crm_leads WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]).catch(() => ({ rows: [] }));
      const ld = leadDetail[0];
      if (ld?.telefone) {
        // Orçamento stage → trigger budget follow-up
        if (stage === 'orcamento' || stage === 'orcamento_enviado') {
          triggerAutomationFlows('Orçamento criado e não fechado', { name: ld.nome, phone: ld.telefone, tenantId: ld.tenant_id }).catch(() => {});
        }
        // Lead entering CRM stage
        if (stage === 'lead' && fromStage !== 'lead') {
          triggerAutomationFlows('Lead entrou no CRM', { name: ld.nome, phone: ld.telefone, tenantId: ld.tenant_id }).catch(() => {});
        }
      }
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Update lead consciousness level
app.patch('/api/crm/leads/:id/consciousness', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { level } = req.body;
    if (!level || !VALID_CONSCIOUSNESS.includes(level)) {
      return res.status(400).json({ error: `Nível inválido. Válidos: ${VALID_CONSCIOUSNESS.join(', ')}` });
    }
    const { rows } = await pool.query(
      `UPDATE crm_leads SET consciousness_level = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING id, nome, consciousness_level`,
      [level, req.params.id, user.tenant_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json(rows[0]);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Assign lead to attendant
app.patch('/api/crm/leads/:id/assign', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { assignedTo, assignedToName } = req.body;
    const { rows } = await pool.query(
      `UPDATE crm_leads SET assigned_to = $1, assigned_to_name = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4 RETURNING id, nome, assigned_to, assigned_to_name`,
      [assignedTo || null, assignedToName || null, req.params.id, user.tenant_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    res.json(rows[0]);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// POST /api/crm/leads/:id/convert-to-patient — register lead as patient
app.post('/api/crm/leads/:id/convert-to-patient', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { id } = req.params;

    // Fetch lead data
    const { rows: leadRows } = await pool.query(
      'SELECT id, nome, telefone, email, cpf, origem, observacoes FROM crm_leads WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id]
    );
    if (leadRows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    const lead = leadRows[0];

    // Check if patient already exists with same phone
    if (lead.telefone) {
      const clean = lead.telefone.replace(/\D/g, '');
      const { rows: existing } = await pool.query(
        "SELECT id, nome, telefone FROM pacientes WHERE REPLACE(REPLACE(REPLACE(telefone, ' ', ''), '-', ''), '+', '') LIKE '%' || $1 AND tenant_id = $2", [clean.slice(-8), user.tenant_id]
      );
      if (existing.length > 0) {
        return res.json({
          success: false,
          conflict: true,
          paciente_id: existing[0].id,
          paciente_nome: existing[0].nome,
          paciente_telefone: existing[0].telefone,
        });
      }
    }

    // Create patient from lead data
    const pacienteId = crypto.randomUUID();
    await pool.query(
      'INSERT INTO pacientes (id, nome, cpf, telefone, email, observacoes, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [pacienteId, lead.nome, lead.cpf || null, lead.telefone || null, lead.email || null, `Origem CRM: ${lead.origem || '—'}. ${lead.observacoes || ''}`, user.tenant_id]
    );

    // Update lead status to 'paciente' and link paciente_id
    await pool.query("UPDATE crm_leads SET status = 'paciente', paciente_id = $2, updated_at = NOW() WHERE id = $1 AND tenant_id = $3", [id, pacienteId, user.tenant_id]);

    res.json({ success: true, paciente_id: pacienteId, nome: lead.nome });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('❌ Error converting lead to patient:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/crm/leads/:id/link-patient — link lead to existing patient
app.post('/api/crm/leads/:id/link-patient', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { id } = req.params;
    const { paciente_id } = req.body;
    if (!paciente_id) return res.status(400).json({ error: 'paciente_id obrigatório' });

    // Verify lead exists
    const { rows: leadRows } = await pool.query('SELECT id, nome FROM crm_leads WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id]);
    if (leadRows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });

    // Verify patient exists
    const { rows: pacRows } = await pool.query('SELECT id, nome FROM pacientes WHERE id = $1 AND tenant_id = $2', [paciente_id, user.tenant_id]);
    if (pacRows.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });

    // Link: update lead with paciente_id and status
    await pool.query("UPDATE crm_leads SET paciente_id = $2, status = 'paciente', updated_at = NOW() WHERE id = $1 AND tenant_id = $3", [id, paciente_id, user.tenant_id]);

    res.json({ success: true, paciente_id, paciente_nome: pacRows[0].nome, lead_nome: leadRows[0].nome });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('❌ Error linking lead to patient:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// GET /api/crm/leads/:id/history — appointment history for a lead
app.get('/api/crm/leads/:id/history', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { id } = req.params;

    // Get lead's paciente_id and phone
    const { rows: leadRows } = await pool.query('SELECT paciente_id, telefone FROM crm_leads WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id]);
    if (leadRows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    const { paciente_id, telefone } = leadRows[0];

    let appointments = [];
    if (paciente_id) {
      const { rows } = await pool.query(
        `SELECT a.id, a.data, a.hora, a.procedimento, a.status, d.nome as dentista_nome
         FROM agendamentos a LEFT JOIN dentistas d ON a.dentista_id = d.id AND d.tenant_id = a.tenant_id
         WHERE a.paciente_id = $1 AND a.tenant_id = $2 ORDER BY a.data DESC, a.hora DESC LIMIT 10`,
        [paciente_id, user.tenant_id]
      );
      appointments = rows;
    } else if (telefone) {
      // Try matching by phone
      const clean = telefone.replace(/\D/g, '');
      const { rows } = await pool.query(
        `SELECT a.id, a.data, a.hora, a.procedimento, a.status, d.nome as dentista_nome
         FROM agendamentos a
         LEFT JOIN dentistas d ON a.dentista_id = d.id AND d.tenant_id = a.tenant_id
         LEFT JOIN pacientes p ON a.paciente_id = p.id AND p.tenant_id = a.tenant_id
         WHERE REPLACE(REPLACE(REPLACE(p.telefone, ' ', ''), '-', ''), '+', '') LIKE '%' || $1
           AND a.tenant_id = $2
         ORDER BY a.data DESC, a.hora DESC LIMIT 10`,
        [clean.slice(-8), user.tenant_id]
      );
      appointments = rows;
    }

    res.json(appointments);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/crm/leads/:id/movements', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows: lead } = await pool.query('SELECT 1 FROM crm_leads WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (lead.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    const { rows } = await pool.query(
      `SELECT * FROM kanban_movements WHERE lead_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id, user.tenant_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// List all CRM leads (with optional kanban grouping + server-side pagination)
// Cadastro manual de lead (botão "Novo lead" do CRM). Sempre na clínica do usuário.
app.post('/api/crm/leads', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, telefone, email, origem, stage, value } = req.body || {};

    const nomeLimpo = typeof nome === 'string' ? nome.trim() : '';
    if (!nomeLimpo) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (nomeLimpo.length > 200) return res.status(400).json({ error: 'Nome muito longo' });

    const telefoneLimpo = typeof telefone === 'string' && telefone.trim() ? telefone.trim() : null;
    const digitos = telefoneLimpo ? telefoneLimpo.replace(/\D/g, '') : '';
    if (telefoneLimpo && (digitos.length < 8 || digitos.length > 15)) {
      return res.status(400).json({ error: 'Telefone inválido' });
    }
    const emailLimpo = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
    if (emailLimpo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }
    const etapa = stage === undefined || stage === null || stage === '' ? 'lead' : stage;
    if (!ALL_KANBAN_STAGES.includes(etapa)) return res.status(400).json({ error: 'Etapa inválida' });
    const valor = value === undefined || value === null || value === '' ? 0 : Number(value);
    if (!Number.isFinite(valor) || valor < 0) return res.status(400).json({ error: 'Valor inválido' });
    const origemLimpa = typeof origem === 'string' && origem.trim() ? origem.trim().slice(0, 60) : 'Manual';

    // O WhatsApp associa conversas ao lead pelo final do telefone: evita duplicar na mesma clínica.
    if (digitos) {
      const { rows: existente } = await pool.query(
        `SELECT id FROM crm_leads
          WHERE tenant_id = $1
            AND REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') LIKE '%' || $2
          LIMIT 1`,
        [user.tenant_id, digitos.slice(-11)]
      );
      if (existente[0]) {
        return res.status(409).json({ error: 'Já existe um lead com este telefone', id: existente[0].id });
      }
    }

    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO crm_leads (id, nome, telefone, email, origem, status, kanban_stage, valor, awaiting_queue_selection, tenant_id)
       VALUES ($1, $2, $3, $4, $5, 'novo', $6, $7, false, $8)
       RETURNING id, nome, telefone, email, origem, status, kanban_stage, valor, created_at`,
      [id, nomeLimpo, telefoneLimpo, emailLimpo, origemLimpa, etapa, valor, user.tenant_id]
    );
    res.status(201).json(rows[0] || { id });
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('[crm:leads:create]', error.message);
    res.status(500).json({ error: 'Erro ao criar lead' });
  }
});

app.get('/api/crm/leads', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { search, status, grouped, origin, sort_by, sort_dir } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Whitelist sortable columns to prevent SQL injection
    const SORTABLE_COLS = { nome: 'l.nome', origem: 'l.origem', status: 'l.status', valor: 'l.valor', updated_at: 'l.updated_at', created_at: 'l.created_at' };
    const sortColumn = SORTABLE_COLS[sort_by] || 'l.updated_at';
    const sortDirection = sort_dir === 'asc' ? 'ASC' : 'DESC';
    const orderClause = `ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, l.created_at DESC`;

    let whereClause = ' WHERE l.tenant_id = $1';
    const params = [user.tenant_id];
    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (l.nome ILIKE $${params.length} OR l.telefone ILIKE $${params.length} OR l.email ILIKE $${params.length})`;
    }
    if (status && status !== 'todos') {
      params.push(status);
      whereClause += ` AND l.status = $${params.length}`;
    }
    if (origin && origin !== 'Todos') {
      params.push(origin);
      whereClause += ` AND l.origem = $${params.length}`;
    }

    const baseFrom = `FROM crm_leads l
                 LEFT JOIN LATERAL (
                   SELECT attendant_name, status FROM attendance_sessions
                   WHERE lead_id = l.id::text ORDER BY created_at DESC LIMIT 1
                 ) s ON true`;

    // For kanban, return all (no pagination) grouped
    if (grouped === 'kanban') {
      const query = `SELECT l.*, s.attendant_name, s.status as session_status ${baseFrom} ${whereClause} ${orderClause}`;
      const { rows } = await pool.query(query, params);
      const kanban = {};
      for (const stage of ALL_KANBAN_STAGES) kanban[stage] = [];
      for (const row of rows) {
        const stage = ALL_KANBAN_STAGES.includes(row.kanban_stage) ? row.kanban_stage : 'lead';
        kanban[stage].push({
          id: row.id,
          name: row.nome,
          initials: (row.nome || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
          phone: row.telefone || '',
          origin: row.origem || 'WhatsApp',
          value: Number(row.valor) || 0,
          assignedTo: row.assigned_to_name || row.attendant_name || 'Sem atendente',
          assignedInitials: (row.assigned_to_name || row.attendant_name || 'SA').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
          lastContact: row.updated_at || row.created_at,
          avatarColor: 'bg-chart-1',
          avatarUrl: row.avatar_url || null,
          kanbanStage: stage,
          consciousnessLevel: row.consciousness_level || null,
          budgetId: row.orcamento_id || null,
        });
      }
      return res.json(kanban);
    }

    // Count total for pagination metadata
    const countQuery = `SELECT COUNT(*) as total ${baseFrom} ${whereClause}`;
    const { rows: countRows } = await pool.query(countQuery, params);
    const total = parseInt(countRows[0].total);

    // Paginated data query
    const pIdx1 = params.length + 1;
    const pIdx2 = params.length + 2;
    const dataQuery = `SELECT l.*, s.attendant_name, s.status as session_status ${baseFrom} ${whereClause} ${orderClause} LIMIT $${pIdx1} OFFSET $${pIdx2}`;
    const { rows } = await pool.query(dataQuery, [...params, limit, offset]);

    res.json({ rows, total, limit, offset });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Record first response (attendant sends first message)
app.post('/api/sessions/first-response', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });

    await pool.query(
      `UPDATE attendance_sessions SET 
         first_response_at = COALESCE(first_response_at, NOW()),
         response_time_seconds = COALESCE(response_time_seconds, EXTRACT(EPOCH FROM (NOW() - assigned_at))::INTEGER)
       WHERE lead_id = $1 AND status = 'active' AND first_response_at IS NULL AND tenant_id = $2`,
      [leadId, user.tenant_id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Close session + send satisfaction survey via WhatsApp
app.post('/api/sessions/close', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { leadId, leadPhone, instance } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });

    const result = await pool.query(
      `UPDATE attendance_sessions SET 
         closed_at = NOW(), status = 'closed',
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - COALESCE(assigned_at, started_waiting_at)))::INTEGER
       WHERE lead_id = $1 AND status = 'active' AND tenant_id = $2
       RETURNING id, duration_seconds, attendant_id, attendant_name`,
      [leadId, user.tenant_id || null]
    );

    const session = result.rows[0];
    const ownsSurveyInstance = session && instance ? await userOwnsInstance(user, instance) : false;
    const surveyOptedOut = leadPhone ? await isWhatsAppOptedOut(user.tenant_id, leadPhone).catch(() => false) : false;

    // Send satisfaction survey via WhatsApp buttons (só pelo número da clínica)
    if (session && leadPhone && instance && ownsSurveyInstance && !surveyOptedOut && isSafeInstanceName(instance) && EVOLUTION_API_KEY) {
      const phone = leadPhone.replace(/\D/g, '');
      try {
        // Try buttons first
        await evolutionFetch(`/message/sendButtons/${instance}`, {
          method: 'POST',
          body: JSON.stringify({
            number: phone,
            title: '⭐ Avalie nosso atendimento',
            description: 'Como você avalia o atendimento que recebeu?',
            buttons: [
              { buttonId: `rating_${leadId}_5`, buttonText: { displayText: '⭐⭐⭐⭐⭐ Excelente' } },
              { buttonId: `rating_${leadId}_4`, buttonText: { displayText: '⭐⭐⭐⭐ Bom' } },
              { buttonId: `rating_${leadId}_3`, buttonText: { displayText: '⭐⭐⭐ Regular' } },
            ],
          }),
        });
        console.log(`📊 Satisfaction survey sent to ${maskPhone(phone)}`);
      } catch (btnErr) {
        // Fallback: text-based survey
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({
            number: phone,
            text: `⭐ *Avalie nosso atendimento!*\n\nComo você avalia o atendimento que recebeu?\n\n5️⃣ Excelente\n4️⃣ Bom\n3️⃣ Regular\n2️⃣ Ruim\n1️⃣ Péssimo\n\nResponda com o número da sua avaliação.`,
          }),
        });
        console.log(`📊 Satisfaction survey (text fallback) sent to ${maskPhone(phone)}`);
      }

      // Mark lead as awaiting rating
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) 
         VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [`awaiting_rating_${user.tenant_id}_${phone}`, JSON.stringify({ leadId, sessionId: session?.id, attendantId: session?.attendant_id, attendantName: session?.attendant_name })]
      );
    }

    console.log(`✅ Session closed for lead ${leadId} (duration: ${session?.duration_seconds || 0}s)`);

    // 🤖 Trigger "Após consulta finalizada" automation
    if (leadPhone) {
      const leadName = session?.attendant_name || leadId;
      // Get lead name from DB
      const { rows: leadRows } = await pool.query('SELECT nome FROM crm_leads WHERE id = $1', [leadId]).catch(() => ({ rows: [] }));
      const name = leadRows[0]?.nome || leadId;
      triggerAutomationFlows('Após consulta finalizada', { name, phone: leadPhone, tenantId: user.tenant_id }).catch(() => {});
      triggerAutomationFlows('Atendimento finalizado sem agendamento', { name, phone: leadPhone, tenantId: user.tenant_id }).catch(() => {});
    }

    res.json({ success: true, sessionId: session?.id, duration: session?.duration_seconds });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Get metrics (general + per attendant)
app.get('/api/metrics/attendance', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { days = '30' } = req.query;
    const since = `NOW() - INTERVAL '${Math.min(Number(days), 365)} days'`;

    // General metrics
    const { rows: general } = await pool.query(`
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_sessions,
        ROUND(AVG(wait_time_seconds) FILTER (WHERE wait_time_seconds IS NOT NULL)) as avg_wait_time,
        ROUND(AVG(response_time_seconds) FILTER (WHERE response_time_seconds IS NOT NULL)) as avg_response_time,
        ROUND(AVG(duration_seconds) FILTER (WHERE duration_seconds IS NOT NULL)) as avg_duration,
        MAX(wait_time_seconds) as max_wait_time,
        MIN(wait_time_seconds) FILTER (WHERE wait_time_seconds > 0) as min_wait_time
      FROM attendance_sessions 
      WHERE created_at >= ${since} AND tenant_id = $1
    `, [user.tenant_id]);

    // Per attendant metrics
    const { rows: perAttendant } = await pool.query(`
      SELECT 
        attendant_id, attendant_name,
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_sessions,
        ROUND(AVG(wait_time_seconds) FILTER (WHERE wait_time_seconds IS NOT NULL)) as avg_wait_time,
        ROUND(AVG(response_time_seconds) FILTER (WHERE response_time_seconds IS NOT NULL)) as avg_response_time,
        ROUND(AVG(duration_seconds) FILTER (WHERE duration_seconds IS NOT NULL)) as avg_duration
      FROM attendance_sessions 
      WHERE attendant_id IS NOT NULL AND created_at >= ${since} AND tenant_id = $1
      GROUP BY attendant_id, attendant_name
      ORDER BY total_sessions DESC
    `, [user.tenant_id]);

    // Satisfaction metrics
    const { rows: satisfaction } = await pool.query(`
      SELECT 
        ROUND(AVG(rating)::NUMERIC, 1) as avg_rating,
        COUNT(*) as total_ratings,
        COUNT(*) FILTER (WHERE rating = 5) as five_star,
        COUNT(*) FILTER (WHERE rating = 4) as four_star,
        COUNT(*) FILTER (WHERE rating = 3) as three_star,
        COUNT(*) FILTER (WHERE rating = 2) as two_star,
        COUNT(*) FILTER (WHERE rating = 1) as one_star
      FROM satisfaction_ratings
      WHERE created_at >= ${since} AND tenant_id = $1
    `, [user.tenant_id]);

    // Satisfaction per attendant
    const { rows: satisfactionPerAttendant } = await pool.query(`
      SELECT 
        attendant_id, attendant_name,
        ROUND(AVG(rating)::NUMERIC, 1) as avg_rating,
        COUNT(*) as total_ratings
      FROM satisfaction_ratings
      WHERE attendant_id IS NOT NULL AND created_at >= ${since} AND tenant_id = $1
      GROUP BY attendant_id, attendant_name
      ORDER BY avg_rating DESC
    `, [user.tenant_id]);

    res.json({
      general: general[0],
      perAttendant,
      satisfaction: satisfaction[0],
      satisfactionPerAttendant,
    });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// LEAD TAGS
// ═══════════════════════════════════════════════════════════════

// List all tags
app.get('/api/tags', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT * FROM lead_tags WHERE tenant_id = $1 ORDER BY created_at ASC', [user.tenant_id]);
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Create tag
app.post('/api/tags', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { name, color, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const { rows } = await pool.query(
      'INSERT INTO lead_tags (name, color, icon, tenant_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), color || '#3B82F6', icon || '📌', user.tenant_id]
    );
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update tag
app.put('/api/tags/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { name, color, icon } = req.body;
    const { rowCount } = await pool.query(
      'UPDATE lead_tags SET name = COALESCE($1, name), color = COALESCE($2, color), icon = COALESCE($3, icon), updated_at = NOW() WHERE id = $4 AND tenant_id = $5',
      [name?.trim(), color, icon, req.params.id, user.tenant_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Etiqueta não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete tag
app.delete('/api/tags/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM lead_tags WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Etiqueta não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all lead-tag assignments
app.get('/api/tag-assignments', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT lead_id, tag_id FROM lead_tag_assignments WHERE tenant_id = $1 ORDER BY created_at ASC', [user.tenant_id]);
    // Group by lead_id
    const map = {};
    for (const r of rows) {
      if (!map[r.lead_id]) map[r.lead_id] = [];
      map[r.lead_id].push(r.tag_id);
    }
    res.json(map);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Toggle a tag on a lead (add or remove)
app.post('/api/tag-assignments/toggle', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { leadId, tagId } = req.body;
    if (!leadId || !tagId) return res.status(400).json({ error: 'leadId e tagId obrigatórios' });

    const { rows: own } = await pool.query(
      'SELECT 1 FROM crm_leads l, lead_tags t WHERE l.id = $1 AND t.id = $2 AND l.tenant_id = $3 AND t.tenant_id = $3',
      [leadId, tagId, user.tenant_id]
    );
    if (own.length === 0) return res.status(404).json({ error: 'Lead ou etiqueta não encontrado' });

    const { rows } = await pool.query(
      'SELECT id FROM lead_tag_assignments WHERE lead_id = $1 AND tag_id = $2 AND tenant_id = $3',
      [leadId, tagId, user.tenant_id]
    );

    if (rows.length > 0) {
      await pool.query('DELETE FROM lead_tag_assignments WHERE lead_id = $1 AND tag_id = $2 AND tenant_id = $3', [leadId, tagId, user.tenant_id]);
      res.json({ action: 'removed' });
    } else {
      await pool.query('INSERT INTO lead_tag_assignments (lead_id, tag_id, tenant_id) VALUES ($1, $2, $3)', [leadId, tagId, user.tenant_id]);
      res.json({ action: 'added' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CONTATOS
// ═══════════════════════════════════════════════════════════════

app.get('/api/contatos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { search, tipo } = req.query;
    let query = 'SELECT * FROM contatos WHERE tenant_id = $1';
    const params = [user.tenant_id];
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (nome ILIKE $${params.length} OR telefone ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    if (tipo) { params.push(tipo); query += ` AND tipo = $${params.length}`; }
    query += ' ORDER BY favorito DESC, nome ASC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

app.post('/api/contatos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, telefone, email, tipo, empresa, cargo, observacoes } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO contatos (id, nome, telefone, email, tipo, empresa, cargo, observacoes, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, nome.trim(), telefone || null, email || null, tipo || 'pessoal', empresa || null, cargo || null, observacoes || null, user.tenant_id]
    );
    const { rows } = await pool.query('SELECT * FROM contatos WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/contatos/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { nome, telefone, email, tipo, empresa, cargo, observacoes, favorito } = req.body;
    const { rowCount } = await pool.query(
      `UPDATE contatos SET nome=COALESCE($1,nome), telefone=$2, email=$3, tipo=COALESCE($4,tipo),
       empresa=$5, cargo=$6, observacoes=$7, favorito=COALESCE($8,favorito), updated_at=NOW() WHERE id=$9 AND tenant_id=$10`,
      [nome, telefone, email, tipo, empresa, cargo, observacoes, favorito, req.params.id, user.tenant_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Contato não encontrado' });
    const { rows } = await pool.query('SELECT * FROM contatos WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/contatos/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rowCount } = await pool.query('DELETE FROM contatos WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Contato não encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/contatos/:id/favorito', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query(
      'UPDATE contatos SET favorito = NOT favorito, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *',
      [req.params.id, user.tenant_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Contato não encontrado' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Bulk import contatos (WhatsApp) ────────────────────────
app.post('/api/contatos/import', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { contatos } = req.body;
    if (!Array.isArray(contatos) || contatos.length === 0) {
      return res.status(400).json({ error: 'Lista de contatos vazia' });
    }

    let imported = 0;
    let skipped = 0;

    for (const c of contatos) {
      const telefone = (c.telefone || c.id || '').replace(/\D/g, '');
      const nome = (c.nome || c.pushName || telefone).trim();
      if (!telefone) { skipped++; continue; }

      // Skip if phone already exists
      const existing = await pool.query('SELECT id FROM contatos WHERE telefone = $1 AND tenant_id = $2', [telefone, user.tenant_id]);
      if (existing.rows.length > 0) { skipped++; continue; }

      await pool.query(
        'INSERT INTO contatos (id, nome, telefone, tipo, tenant_id) VALUES ($1, $2, $3, $4, $5)',
        [crypto.randomUUID(), nome || telefone, telefone, 'pessoal', user.tenant_id]
      );
      imported++;
    }

    res.json({ imported, skipped, total: contatos.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Auto-sync WhatsApp contacts (runs every 30 min) ────────
let syncInterval = null;

// Clínica dona da instância para a sincronização de contatos. O tenant
// 00000000-0000-0000-0000-000000000001 é uma clínica real em algumas bases
// (migration-saas.sql): aceito quando há mapeamento explícito em whatsapp_instances.
async function resolveContactSyncTenant(instanceName) {
  const t = await getTenantIdByInstance(instanceName).catch(() => null);
  if (isValidTenantId(t)) return String(t);
  const { rows } = await pool.query(
    'SELECT tenant_id FROM whatsapp_instances WHERE instance_name = $1 AND tenant_id IS NOT NULL LIMIT 1',
    [instanceName]
  ).catch(() => ({ rows: [] }));
  const mapped = rows[0]?.tenant_id ? String(rows[0].tenant_id) : null;
  return mapped === '00000000-0000-0000-0000-000000000001' ? mapped : null;
}

async function syncWhatsAppContacts() {
  try {
    const normalizeEvolutionContacts = (payload) => {
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.contacts)
            ? payload.contacts
            : Array.isArray(payload?.result)
              ? payload.result
              : [];

      return list.filter((c) => {
        const id = c?.id || c?.remoteJid || c?.jid || '';
        return id.includes('@') && !id.endsWith('@g.us') && !id.endsWith('@broadcast');
      });
    };

    // 1. Fetch connected instances from Evolution API
    const instRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    });
    if (!instRes.ok) return;
    const instances = await instRes.json();
    const connected = instances.filter(i => (i.connectionStatus || i.status || i.instance?.status || i.instance?.state) === 'open');
    if (connected.length === 0) return;

    let totalImported = 0;
    for (const inst of connected) {
      const name = inst.name || inst.instanceName;
      const instTenantId = await resolveContactSyncTenant(name);
      if (!instTenantId) continue; // instância sem clínica: não importa
      try {
        let waContacts = [];
        const cRes = await fetch(`${EVOLUTION_API_URL}/chat/findContacts/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({ where: {} }),
        });
        if (cRes.ok) {
          const contacts = await cRes.json();
          waContacts = normalizeEvolutionContacts(contacts);
        }
        if (waContacts.length === 0) {
          try {
            const altRes = await fetch(`${EVOLUTION_API_URL}/contact/find/${name}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
              body: JSON.stringify({}),
            });
            if (altRes.ok) {
              const altContacts = await altRes.json();
              waContacts = normalizeEvolutionContacts(altContacts);
            }
          } catch (e) { /* ignore */ }
        }

        for (const c of waContacts) {
          const telefone = (c.id || c.remoteJid || c.jid || '').replace(/@.*$/, '').replace(/\D/g, '');
          const nome = (c.name || c.pushName || c.profileName || c.notify || telefone).trim();
          if (!telefone) continue;

          const existing = await pool.query('SELECT id, nome FROM contatos WHERE telefone = $1 AND tenant_id = $2', [telefone, instTenantId]);
          if (existing.rows.length > 0) {
            const currentName = (existing.rows[0].nome || '').trim();
            if (nome && nome !== telefone && (!currentName || currentName === telefone)) {
              await pool.query(
                `UPDATE contatos SET nome = $1, updated_at = NOW() WHERE telefone = $2 AND tenant_id = $3`,
                [nome, telefone, instTenantId]
              );
            }
            continue;
          }

          await pool.query(
            'INSERT INTO contatos (id, nome, telefone, tipo, tenant_id) VALUES ($1, $2, $3, $4, $5)',
            [crypto.randomUUID(), nome || telefone, telefone, 'pessoal', instTenantId]
          );
          totalImported++;
        }
      } catch (err) {
        console.error(`[sync] Erro ao sincronizar instância ${name}:`, err.message);
      }
    }

    if (totalImported > 0) {
      console.log(`[sync] ${totalImported} novos contatos importados do WhatsApp`);
    }
  } catch (err) {
    console.error('[sync] Erro na sincronização de contatos:', err.message);
  }
}

// Sync status & manual trigger endpoint
app.get('/api/contatos/sync/status', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { rows } = await pool.query('SELECT COUNT(*) as total FROM contatos WHERE tenant_id = $1', [user.tenant_id]);
    res.json({
      autoSync: !!syncInterval,
      intervalMinutes: 30,
      totalContatos: parseInt(rows[0].total),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/contatos/sync/now', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const allowedInstances = Array.isArray(req.body?.instances) ? req.body.instances : null;
    const normalizeEvolutionContacts = (payload) => {
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.contacts)
            ? payload.contacts
            : Array.isArray(payload?.result)
              ? payload.result
              : [];

      return list.filter((c) => {
        const id = c?.id || c?.remoteJid || c?.jid || '';
        return id.includes('@') && !id.endsWith('@g.us') && !id.endsWith('@broadcast');
      });
    };

    // 1. Fetch connected instances
    const instRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    });
    if (!instRes.ok) return res.json({ success: false, error: 'Falha ao buscar instâncias', instances: [] });
    const instances = await instRes.json();
    let connected = instances.filter(i => (i.connectionStatus || i.status) === 'open');

    if (allowedInstances && allowedInstances.length > 0) {
      connected = connected.filter(i => allowedInstances.includes(i.name || i.instanceName));
    }

    // Só instâncias da própria clínica
    const ownConnected = [];
    for (const i of connected) {
      const instTenant = await resolveContactSyncTenant(i.name || i.instanceName);
      if (instTenant && String(instTenant) === String(user.tenant_id)) ownConnected.push(i);
    }
    connected = ownConnected;

    if (connected.length === 0) {
      return res.json({ success: true, imported: 0, totalContatos: 0, instances: [], message: 'Nenhuma instância conectada/selecionada' });
    }

    const instanceResults = [];
    let totalImported = 0;

    for (const inst of connected) {
      const name = inst.name || inst.instanceName;
      const instResult = { name, imported: 0, skipped: 0, total: 0, error: null };

      try {
        let waContacts = [];
        console.log(`[sync][${name}] Tentando chat/findContacts...`);
        const cRes = await fetch(`${EVOLUTION_API_URL}/chat/findContacts/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({ where: {} }),
        });
        console.log(`[sync][${name}] findContacts status: ${cRes.status}`);
        if (cRes.ok) {
          const contacts = await cRes.json();
          const rawList = Array.isArray(contacts) ? contacts : Array.isArray(contacts?.data) ? contacts.data : Array.isArray(contacts?.contacts) ? contacts.contacts : Array.isArray(contacts?.result) ? contacts.result : [];
          console.log(`[sync][${name}] findContacts retornou ${rawList.length} items.`);
          waContacts = normalizeEvolutionContacts(contacts);
          console.log(`[sync][${name}] Após normalização: ${waContacts.length} contatos`);
        } else {
          const errText = await cRes.text().catch(() => '');
          console.log(`[sync][${name}] findContacts erro: ${errText.substring(0, 300)}`);
        }

        if (waContacts.length === 0) {
          console.log(`[sync][${name}] Tentando fallback contact/find...`);
          try {
            const altRes = await fetch(`${EVOLUTION_API_URL}/contact/find/${name}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
              body: JSON.stringify({}),
            });
            console.log(`[sync][${name}] contact/find status: ${altRes.status}`);
            if (altRes.ok) {
              const altContacts = await altRes.json();
              const rawAltList = Array.isArray(altContacts) ? altContacts : Array.isArray(altContacts?.data) ? altContacts.data : Array.isArray(altContacts?.contacts) ? altContacts.contacts : Array.isArray(altContacts?.result) ? altContacts.result : [];
              console.log(`[sync][${name}] contact/find retornou ${rawAltList.length} items.`);
              waContacts = normalizeEvolutionContacts(altContacts);
              console.log(`[sync][${name}] Após normalização fallback: ${waContacts.length} contatos`);
            } else {
              const errText2 = await altRes.text().catch(() => '');
              console.log(`[sync][${name}] contact/find erro: ${errText2.substring(0, 300)}`);
            }
          } catch (e) { console.log(`[sync][${name}] contact/find exception:`, e.message); }
        }

        console.log(`[sync] Instance ${name}: found ${waContacts.length} WhatsApp contacts`);
        instResult.total = waContacts.length;

        for (const c of waContacts) {
          const telefone = (c.id || c.remoteJid || c.jid || '').replace(/@.*$/, '').replace(/\D/g, '');
          const nome = (c.name || c.pushName || c.profileName || c.notify || telefone).trim();
          if (!telefone) continue;

          const existing = await pool.query('SELECT id, nome FROM contatos WHERE telefone = $1 AND tenant_id = $2', [telefone, user.tenant_id]);
          if (existing.rows.length > 0) {
            const currentName = (existing.rows[0].nome || '').trim();
            if (nome && nome !== telefone && (!currentName || currentName === telefone)) {
              await pool.query(
                `UPDATE contatos SET nome = $1, updated_at = NOW() WHERE telefone = $2 AND tenant_id = $3`,
                [nome, telefone, user.tenant_id]
              );
            }
            instResult.skipped++;
            continue;
          }

          await pool.query(
            'INSERT INTO contatos (id, nome, telefone, tipo, tenant_id) VALUES ($1, $2, $3, $4, $5)',
            [crypto.randomUUID(), nome || telefone, telefone, 'pessoal', user.tenant_id]
          );
          instResult.imported++;
          totalImported++;
        }
      } catch (err) {
        instResult.error = err.message;
      }
      instanceResults.push(instResult);
    }

    const after = await pool.query('SELECT COUNT(*) as total FROM contatos WHERE tenant_id = $1', [user.tenant_id]);
    res.json({
      success: true,
      imported: totalImported,
      totalContatos: parseInt(after.rows[0].total),
      instances: instanceResults,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function importWhatsAppMessagesForTenant({ tenantId, requestedInstances = null, start, end, createWaitingSessions = true, maxPages = 120, pageSize = 100, onProgress = null }) {
  if (!tenantId) throw new Error('tenant_id obrigatório para importar conversas');

  onProgress?.({ phase: 'init', message: 'Buscando instâncias conectadas...' });
  const instResult = await evolutionFetch('/instance/fetchInstances');
  if (!instResult.ok) throw new Error('Falha ao buscar instâncias na Evolution API');

  const requestedSet = Array.isArray(requestedInstances) && requestedInstances.length > 0
    ? new Set(requestedInstances.map(String))
    : null;
  const prefix = String(tenantId).slice(0, 8).toLowerCase();

  let connected = extractEvolutionArray(instResult.data)
    .map((i) => ({ raw: i, name: i?.name || i?.instanceName || i?.instance?.instanceName || i?.instance?.name, status: i?.connectionStatus || i?.status || i?.instance?.state }))
    .filter((i) => i.name && (i.status === 'open' || String(i.status).toLowerCase() === 'open'))
    .filter((i) => !requestedSet || requestedSet.has(i.name));

  // Strong tenant binding: only import instances owned by this clinic naming convention.
  let ownedInstanceNames = new Set();
  try {
    const { rows } = await pool.query(
      `SELECT instance_name FROM whatsapp_instances WHERE tenant_id = $1`,
      [tenantId]
    );
    ownedInstanceNames = new Set(rows.map((row) => String(row.instance_name || '')).filter(Boolean));
  } catch (ownedErr) {
    console.warn(`[import-whatsapp] could not load owned instances for tenant ${tenantId}:`, ownedErr.message);
  }

  connected = connected.filter((i) => {
    const name = String(i.name || '');
    return name.toLowerCase().startsWith(prefix) || ownedInstanceNames.has(name);
  });

  if (connected.length === 0) {
    return { imported: 0, skipped: 0, instances: [], message: 'Nenhuma instância conectada/selecionada deste tenant' };
  }

  const instanceResults = [];
  let totalImported = 0;
  let totalSkipped = 0;

  for (let ii = 0; ii < connected.length; ii++) {
    const { name } = connected[ii];
    const instStats = { name, imported: 0, skipped: 0, contacts: 0, scanned: 0, sessions: 0, error: null };
    instanceResults.push(instStats);

    await pool.query(
      `INSERT INTO whatsapp_instances (instance_name, tenant_id)
       VALUES ($1, $2)
       ON CONFLICT (instance_name) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`,
      [name, tenantId]
    ).catch(() => {});
    setCachedTenantId(name, tenantId);

    onProgress?.({ phase: 'instance', instance: name, instanceIndex: ii, totalInstances: connected.length, message: `Importando conversas de ${name}...` });

    const contactNames = new Map();
    try {
      const contactsResult = await evolutionFetch(`/chat/findContacts/${name}`, {
        method: 'POST',
        body: JSON.stringify({ where: {} }),
      });
      if (contactsResult.ok) {
        for (const c of extractEvolutionArray(contactsResult.data)) {
          const jid = c?.remoteJid || c?.jid || c?.id;
          if (!isUsableChatJid(jid)) continue;
          const phone = normalizeWhatsappNumber(jid);
          const display = String(c?.name || c?.pushName || c?.profileName || c?.notify || c?.verifiedName || phone).trim();
          contactNames.set(phone, display);
        }
        instStats.contacts = contactNames.size;
      }
    } catch (contactErr) {
      console.warn(`[import-whatsapp] contacts skipped for ${name}:`, contactErr.message);
    }

    const seenMessageIds = new Set();
    try {
      for (let page = 1; page <= maxPages; page++) {
        const messagesResult = await evolutionFetch(`/chat/findMessages/${name}`, {
          method: 'POST',
          body: JSON.stringify({ page, offset: pageSize }),
        });
        if (!messagesResult.ok) throw new Error(`findMessages HTTP ${messagesResult.status}`);

        const batch = extractEvolutionMessages(messagesResult.data);
        if (batch.length === 0) break;
        instStats.scanned += batch.length;

        for (const msg of batch) {
          const remoteJid = extractActualRemoteJidFromMessage(msg) || msg?.remoteJid || msg?.jid;
          rememberLidMappingFromMessage(msg, remoteJid);
          if (!isUsableChatJid(remoteJid)) { instStats.skipped++; totalSkipped++; continue; }

          const msgTimestamp = extractMessageTimestamp(msg);
          if (!msgTimestamp || msgTimestamp < start || msgTimestamp > end) { instStats.skipped++; totalSkipped++; continue; }

          const parsed = extractMessageContentAndType(msg);
          if (!parsed) { instStats.skipped++; totalSkipped++; continue; }

          const rawId = msg?.key?.id || msg?.id || createHash('sha1').update(JSON.stringify(msg).slice(0, 2000)).digest('hex');
          const msgId = String(rawId);
          if (seenMessageIds.has(msgId)) { instStats.skipped++; totalSkipped++; continue; }
          seenMessageIds.add(msgId);

          const phone = normalizeWhatsappNumber(remoteJid);
          const contactName = contactNames.get(phone) || msg?.pushName || msg?.participantName || phone;
          const fromMe = !!msg?.key?.fromMe;
          const sender = fromMe ? 'attendant' : 'lead';
          const lead = await ensureLeadForWhatsAppConversation({ tenantId, phone, name: contactName });
          if (!lead?.id) { instStats.skipped++; totalSkipped++; continue; }

          if (createWaitingSessions) {
            const sessionId = await ensureWaitingSessionForIncomingLead({
              lead,
              phone,
              queueId: lead.queue_id || null,
              queueName: lead.queue_name || null,
              tenantId,
            });
            if (sessionId) instStats.sessions++;
          }

          const insert = await pool.query(
            `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, media_url, file_name, mime_type, instance, phone, metadata, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (id) DO UPDATE
               SET lead_id = COALESCE(chat_messages.lead_id, EXCLUDED.lead_id),
                   content = COALESCE(NULLIF(chat_messages.content, ''), EXCLUDED.content),
                   sender = COALESCE(chat_messages.sender, EXCLUDED.sender),
                   type = COALESCE(chat_messages.type, EXCLUDED.type),
                   status = CASE
                     WHEN chat_messages.status = 'read' THEN chat_messages.status
                     WHEN chat_messages.status = 'delivered' AND EXCLUDED.status IN ('sent', 'sending') THEN chat_messages.status
                     ELSE COALESCE(EXCLUDED.status, chat_messages.status)
                   END,
                   timestamp = CASE
                     WHEN EXCLUDED.timestamp IS NOT NULL AND (chat_messages.timestamp IS NULL OR EXCLUDED.timestamp < chat_messages.timestamp)
                     THEN EXCLUDED.timestamp
                     ELSE chat_messages.timestamp
                   END,
                   file_name = COALESCE(chat_messages.file_name, EXCLUDED.file_name),
                   mime_type = COALESCE(chat_messages.mime_type, EXCLUDED.mime_type),
                   instance = COALESCE(chat_messages.instance, EXCLUDED.instance),
                   phone = COALESCE(chat_messages.phone, EXCLUDED.phone),
                   metadata = COALESCE(chat_messages.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                   tenant_id = COALESCE(chat_messages.tenant_id, EXCLUDED.tenant_id)`,
            [
              msgId,
              lead.id.toString(),
              parsed.content,
              sender,
              parsed.type,
              fromMe ? 'sent' : 'delivered',
              msgTimestamp,
              parsed.fileName,
              parsed.mimeType,
              name,
              phone,
              JSON.stringify({ importedFrom: 'whatsapp', contactName, remoteJid, rawType: Object.keys(msg?.message || {})[0] || null }),
              tenantId,
            ]
          );

          if (insert.rowCount > 0) {
            instStats.imported++;
            totalImported++;
          } else {
            instStats.skipped++;
            totalSkipped++;
          }
        }

        onProgress?.({ phase: 'page', instance: name, page, imported: totalImported, skipped: totalSkipped, scanned: instStats.scanned });
        const totalPages = messagesResult.data?.messages?.pages ?? messagesResult.data?.pages ?? null;
        if (totalPages && page >= totalPages) break;
        if (batch.length < pageSize) break;
        // Throttle: evita saturar Evolution/socket WhatsApp (proteção anti-ban / anti-freeze pós-import)
        await new Promise((r) => setTimeout(r, 300));
      }

    } catch (err) {
      instStats.error = err.message;
    }
  }

  return { imported: totalImported, skipped: totalSkipped, instances: instanceResults };
}

// ─── Import WhatsApp Messages by date range ─────────────────
app.post('/api/messages/import-whatsapp', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { startDate, endDate, instances: allowedInstances, stream } = req.body;

    console.log(`📥 Importing WhatsApp messages for tenant ${user.tenant_id} (user=${user.id}, SuperAdmin: ${user.is_super_admin})`);

    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate e endDate obrigatórios' });

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const isStream = stream === true;
    if (isStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    }
    const sendProgress = (data) => {
      if (isStream) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const result = await importWhatsAppMessagesForTenant({
      tenantId: user.tenant_id,
      requestedInstances: allowedInstances,
      start,
      end,
      createWaitingSessions: true,
      maxPages: 30,
      pageSize: 50,
      onProgress: sendProgress,

    });

    const finalResult = { phase: 'done', success: true, ...result };
    if (isStream) {
      sendProgress(finalResult);
      res.end();
    } else {
      res.json(finalResult);
    }
  } catch (error) {
    const isAuth = error.message === 'Unauthorized' || error.message === 'Invalid Supabase token';
    const status = isAuth ? 401 : 500;
    if (res.headersSent) {
      try { res.write(`data: ${JSON.stringify({ phase: 'done', success: false, error: error.message, instances: [] })}\n\n`); res.end(); } catch (_) {}
    } else {
      res.status(status).json({ error: error.message });
    }
  }
});

// List all active attendance sessions (for /dashboard widget)
app.get('/api/sessions/active', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const sql = `
      SELECT
        s.id,
        s.lead_id,
        COALESCE(l.nome, l.telefone, '—') AS lead_nome,
        COALESCE(s.attendant_name, '—') AS attendant_name,
        s.assigned_at AS started_at,
        (
          SELECT m.content FROM chat_messages m
          WHERE m.lead_id = s.lead_id
          ORDER BY m.timestamp DESC LIMIT 1
        ) AS last_message
      FROM attendance_sessions s
      LEFT JOIN crm_leads l ON l.id = s.lead_id
      WHERE s.status = 'active' AND s.tenant_id = $1
      ORDER BY s.assigned_at DESC
      LIMIT 30
    `;
    try {
      const { rows } = await pool.query(sql, [user.tenant_id]);
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') return res.json([]);
      throw err;
    }
  } catch (error) {
    const status = error.message === 'Unauthorized' ? 401 : 500;
    res.status(status).json({ error: error.message });
  }
});

// Check if a lead has an active attendance session
app.get('/api/sessions/active/:leadId', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { leadId } = req.params;
    if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });

    const { rows } = await pool.query(
      `SELECT s.id, s.attendant_id, s.attendant_name, s.assigned_at, s.status
       FROM attendance_sessions s
       WHERE s.lead_id = $1 AND s.tenant_id = $2 AND s.status = 'active'
       ORDER BY s.assigned_at DESC LIMIT 1`,
      [leadId, user.tenant_id]
    );

    if (rows.length === 0) {
      return res.json({ active: false });
    }

    const session = rows[0];
    res.json({
      active: true,
      attendantId: session.attendant_id,
      attendantName: session.attendant_name,
      isCurrentUser: session.attendant_id === user.id,
    });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ─── Switch Primary WhatsApp Instance ───────────────────────
app.post('/api/whatsapp/switch-primary', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const tenantId = String(user.tenant_id);
    const { newInstance, message } = req.body;
    if (!newInstance || typeof newInstance !== 'string') {
      return res.status(400).json({ error: 'newInstance é obrigatório' });
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      return res.status(400).json({ error: 'Mensagem deve ter no mínimo 10 caracteres' });
    }
    if (!isSafeInstanceName(newInstance) || !(await userOwnsInstance(user, newInstance))) {
      return res.status(403).json({ error: 'Este número de WhatsApp não pertence à sua clínica.' });
    }

    // 1. Find open attendances for the CURRENT tenant
    const { rows: openChats } = await pool.query(
      `SELECT DISTINCT c.phone as lead_phone, c.instance
       FROM chat_messages c
       WHERE c.instance IS NOT NULL
         AND c.instance != $1
         AND c.created_at > NOW() - INTERVAL '7 days'
         AND c.phone IS NOT NULL
         AND c.tenant_id = $2
       ORDER BY c.phone`,
      [newInstance, tenantId]
    );

    // Also check attendance queue for the CURRENT tenant
    const { rows: queueChats } = await pool.query(
      `SELECT DISTINCT lead_phone as phone FROM attendance_sessions
       WHERE status IN ('waiting', 'active')
         AND lead_phone IS NOT NULL
         AND tenant_id = $1`,
      [tenantId]
    );

    // Merge unique phone numbers
    const phoneSet = new Set();
    [...openChats, ...queueChats].forEach(r => {
      const phone = (r.lead_phone || r.phone || '').replace(/\D/g, '');
      if (phone.length >= 10) phoneSet.add(phone);
    });

    const phones = Array.from(phoneSet);
    let sent = 0;
    let failed = 0;
    const errors = [];

    // 2. Aviso pelo NOVO número, pela fila anti-bloqueio (antes: rajada de
    //    envios a cada 0,5 s, que é exatamente o padrão que bloqueia número novo).
    for (const phone of phones) {
      try {
        if (await isWhatsAppOptedOut(tenantId, phone)) continue;
        await enqueueWhatsAppJob({
          tenantId, instance: newInstance, phone, message: message.trim(), category: 'transactional',
          flowId: `switch_primary_${newInstance}`, flowName: 'Troca de número principal',
          triggerEvent: 'switch_primary',
        });
        sent++;
      } catch (err) {
        failed++;
        errors.push({ phone, error: err.message });
      }
    }

    // 3. Log the switch event
    try {
      await pool.query(
        `INSERT INTO system_logs (event, details, created_at)
         VALUES ('switch_primary_instance', $1, NOW())`,
        [JSON.stringify({ newInstance, totalPhones: phones.length, sent, failed })]
      );
    } catch (_) { /* table may not exist yet */ }

    res.json({
      success: true,
      queued: true,
      newInstance,
      totalPatients: phones.length,
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[switch-primary]', error);
    res.status(500).json({ error: error.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// CHAT MESSAGES (persistência de histórico)
// ═══════════════════════════════════════════════════════════════

// GET /api/messages/:leadId — histórico paginado (mais recentes primeiro, retorna em ordem cronológica)
app.get('/api/messages/:leadId', async (req, res, next) => {
  try {
    const { user } = await verifyUser(req);
    const { leadId } = req.params;
    if (leadId === 'unread' || leadId === 'search') return next('route');
    const { before, limit = '50' } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

    let query, params;
    if (before) {
      query = `
        WITH lead_lookup AS (
          SELECT COALESCE(
            (SELECT telefone FROM crm_leads WHERE id::text = $1 AND tenant_id = $4 LIMIT 1),
            (SELECT lead_phone FROM attendance_sessions WHERE lead_id = $1 AND tenant_id = $4 ORDER BY created_at DESC NULLS LAST LIMIT 1),
            $1
          ) AS phone
        )
        SELECT cm.*
          FROM chat_messages cm, lead_lookup ll
         WHERE cm.tenant_id = $4
           AND cm.timestamp < $2
           AND (
             cm.lead_id = $1
             OR (
               ll.phone IS NOT NULL
               AND cm.phone IS NOT NULL
               AND RIGHT(REGEXP_REPLACE(cm.phone, '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE(ll.phone, '\\D', '', 'g'), 11)
             )
           )
         ORDER BY cm.timestamp DESC
         LIMIT $3`;
      params = [leadId, before, safeLimit, user.tenant_id];
    } else {
      query = `
        WITH lead_lookup AS (
          SELECT COALESCE(
            (SELECT telefone FROM crm_leads WHERE id::text = $1 AND tenant_id = $3 LIMIT 1),
            (SELECT lead_phone FROM attendance_sessions WHERE lead_id = $1 AND tenant_id = $3 ORDER BY created_at DESC NULLS LAST LIMIT 1),
            $1
          ) AS phone
        )
        SELECT cm.*
          FROM chat_messages cm, lead_lookup ll
         WHERE cm.tenant_id = $3
           AND (
             cm.lead_id = $1
             OR (
               ll.phone IS NOT NULL
               AND cm.phone IS NOT NULL
               AND RIGHT(REGEXP_REPLACE(cm.phone, '\\D', '', 'g'), 11) = RIGHT(REGEXP_REPLACE(ll.phone, '\\D', '', 'g'), 11)
             )
           )
         ORDER BY cm.timestamp DESC
         LIMIT $2`;
      params = [leadId, safeLimit, user.tenant_id];
    }

    const { rows } = await pool.query(query, params);

    // Retornar em ordem cronológica (mais antigo primeiro)
    const messages = rows.reverse().map(r => ({
      id: r.id,
      lead_id: r.lead_id,
      content: r.content,
      sender: r.sender,
      type: r.type,
      timestamp: r.timestamp,
      status: r.status,
      media_url: r.media_url,
      file_name: r.file_name,
      mime_type: r.mime_type,
      reply_to_id: r.reply_to_id,
      reply_to_content: r.reply_to_content,
      reply_to_sender: r.reply_to_sender,
      attendant_name: r.attendant_name,
      reactions: Array.isArray(r.metadata?.reactions) ? r.metadata.reactions : [],
      metadata: r.metadata,
    }));

    // hasMore = se retornou exatamente o limite, provavelmente há mais
    const hasMore = rows.length === safeLimit;
    res.json({ messages, hasMore });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// POST /api/messages — salvar mensagem enviada pelo atendente
app.post('/api/messages', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id, leadId, content, type, status, fileName, fileUrl, mimeType, replyTo, instance, phone } = req.body;
    if (!leadId || !id) return res.status(400).json({ error: 'id e leadId obrigatórios' });

    const attendantName = await getProfileDisplayName(user.id, 'Atendente');

    // If fileUrl is a base64 data URI, save to disk for persistent storage
    let persistedMediaUrl = fileUrl || null;
    if (fileUrl && fileUrl.startsWith('data:')) {
      const diskUrl = await saveMediaToDisk(fileUrl, mimeType, fileName);
      if (diskUrl) persistedMediaUrl = diskUrl;
    }

    const pendingStatus = consumePendingMessageStatus(user.tenant_id, id);
    const initialStatus = pendingStatus && isHigherMessageStatus(pendingStatus, status || 'sent')
      ? pendingStatus
      : (status || 'sent');

    await pool.query(
      `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, media_url, file_name, mime_type, reply_to_id, reply_to_content, reply_to_sender, attendant_id, attendant_name, instance, phone, tenant_id)
       VALUES ($1,$2,$3,'attendant',$4,$5,NOW(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE
         SET lead_id = COALESCE(chat_messages.lead_id, EXCLUDED.lead_id),
             content = COALESCE(NULLIF(chat_messages.content, ''), EXCLUDED.content),
             type = COALESCE(chat_messages.type, EXCLUDED.type),
             status = CASE
               WHEN chat_messages.status = 'read' THEN chat_messages.status
               WHEN chat_messages.status = 'delivered' AND EXCLUDED.status IN ('sent', 'sending') THEN chat_messages.status
               ELSE COALESCE(EXCLUDED.status, chat_messages.status)
             END,
             media_url = COALESCE(chat_messages.media_url, EXCLUDED.media_url),
             file_name = COALESCE(chat_messages.file_name, EXCLUDED.file_name),
             mime_type = COALESCE(chat_messages.mime_type, EXCLUDED.mime_type),
             reply_to_id = COALESCE(chat_messages.reply_to_id, EXCLUDED.reply_to_id),
             reply_to_content = COALESCE(chat_messages.reply_to_content, EXCLUDED.reply_to_content),
             reply_to_sender = COALESCE(chat_messages.reply_to_sender, EXCLUDED.reply_to_sender),
             attendant_id = COALESCE(chat_messages.attendant_id, EXCLUDED.attendant_id),
             attendant_name = COALESCE(chat_messages.attendant_name, EXCLUDED.attendant_name),
             instance = COALESCE(chat_messages.instance, EXCLUDED.instance),
             phone = COALESCE(chat_messages.phone, EXCLUDED.phone),
             tenant_id = COALESCE(chat_messages.tenant_id, EXCLUDED.tenant_id)`,
      [
        id, leadId, content || '', type || 'text', initialStatus,
        persistedMediaUrl, fileName || null, mimeType || null,
        replyTo?.messageId || null, replyTo?.content || null, replyTo?.sender || null,
        user.id, attendantName, instance || null, phone || null, user.tenant_id,
      ]
    );

    broadcastSSE('new_message', {
      id,
      phone: phone || null,
      pushName: attendantName,
      leadId,
      leadName: attendantName,
      content: content || '',
      type: type || 'text',
      timestamp: new Date().toISOString(),
      instance: instance || null,
      mediaUrl: persistedMediaUrl || null,
      fileName: fileName || null,
      mimeType: mimeType || null,
      sender: 'attendant',
      status: initialStatus,
    }, user.tenant_id);

    res.json({ success: true, id, mediaUrl: persistedMediaUrl, status: initialStatus });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// POST /api/media/upload — upload media file and return persistent URL
app.post('/api/media/upload', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
  try {
    await verifyUser(req);
    const { fileName, mimeType } = req.query;
    const rawBody = req.body;

    if (!rawBody || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      return res.status(400).json({ error: 'Arquivo não enviado' });
    }

    const resolvedMime = String(mimeType || req.headers['content-type'] || 'application/octet-stream');
    const savedUrl = await saveBufferToDisk(rawBody, resolvedMime, fileName ? String(fileName) : undefined);

    if (!savedUrl) {
      return res.status(500).json({ error: 'Falha ao salvar arquivo' });
    }

    res.json({ url: savedUrl, fileName: fileName || null, mimeType: resolvedMime });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// PUT /api/messages/:id/status — atualizar status de entrega/leitura
app.put('/api/messages/:id/status', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { status } = req.body;
    if (!['sending', 'sent', 'delivered', 'read', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    const { rows } = await pool.query(
      `UPDATE chat_messages
          SET status = $1
        WHERE id = $2
          AND tenant_id = $3
        RETURNING id, lead_id, phone, instance, status`,
      [status, req.params.id, user.tenant_id]
    );
    if (rows[0]) {
      broadcastSSE('message_status_update', {
        messageId: rows[0].id,
        id: rows[0].id,
        leadId: rows[0].lead_id,
        phone: rows[0].phone,
        instance: rows[0].instance,
        status: rows[0].status,
      }, user.tenant_id);
    }
    res.json({ success: true, updated: rows.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/messages/mark-read — marcar mensagens como lidas
app.post('/api/messages/mark-read', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });

    await pool.query(
      `INSERT INTO chat_read_status (lead_id, user_id, last_read_at, tenant_id)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (lead_id, user_id) DO UPDATE SET last_read_at = NOW(), tenant_id = EXCLUDED.tenant_id`,
      [leadId, user.id, user.tenant_id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// QUEUE LEADS — load leads currently in the attendance queue
// ═══════════════════════════════════════════════════════════════

app.get('/api/queue/leads', async (req, res) => {
  try {
    const { user } = await verifyUser(req);

    if (!isValidTenantId(user.tenant_id)) {
      console.warn(`[queue/leads] user ${user.id || 'unknown'} has no valid tenant_id; returning explicit empty queue`);
      return res.json({ queue: [], active: [], _warn: 'tenant_not_resolved' });
    }

    // ─── Backfill safety net ────────────────────────────────────────────────
    // Any chat_messages row saved with NULL tenant_id (because webhook tenant
    // resolution failed at insert time) whose instance maps to this user's
    // tenant via whatsapp_instances gets stamped now so the queries below find
    // it. Also covers messages whose instance name starts with the first 8
    // chars of the tenant id (our naming convention). This makes BOTH historical
    // conversations imported from WhatsApp and brand new inbound messages
    // visible in the queue even if the tenant mapping was missing at write time.
    try {
      await pool.query(
        `UPDATE chat_messages cm
            SET tenant_id = wi.tenant_id
           FROM whatsapp_instances wi
          WHERE cm.tenant_id IS NULL
            AND cm.instance IS NOT NULL
            AND cm.instance = wi.instance_name
            AND wi.tenant_id = $1`,
        [user.tenant_id]
      );
      await pool.query(
        `UPDATE chat_messages
            SET tenant_id = $1
          WHERE tenant_id IS NULL
            AND instance IS NOT NULL
            AND lower(substring(instance from 1 for 8)) = lower(substring($1::text from 1 for 8))`,
        [user.tenant_id]
      );
    } catch (backfillErr) {
      console.warn('[queue/leads] tenant backfill skipped:', backfillErr.message);
    }

    await requeueStaleActiveSessionsForTenant(user.tenant_id);

    // Get leads that have an open attendance session AND also recover any
    // inbound WhatsApp message that was persisted but failed to create a
    // waiting session. This is the safety net that keeps the chat from looking
    // empty after refresh when the webhook saved chat_messages but the queue
    // row/session got missed by an older deployment or a transient DB error.
    const { rows } = await pool.query(`
      WITH open_sessions AS (
        SELECT DISTINCT ON (s.lead_id)
          COALESCE(l.id::text, s.lead_id) as id,
          COALESCE(l.nome, s.lead_name, latest.phone, s.lead_phone) as name,
          COALESCE(l.telefone, s.lead_phone, latest.phone) as phone,
          l.avatar_url,
          COALESCE(l.queue_id::text, s.queue_id) as queue_id,
          COALESCE(l.queue_name, s.queue_name) as queue_name,
          COALESCE(l.priority, false) as priority,
          s.id as session_id,
          s.status as session_status,
          s.attendant_id,
          s.attendant_name,
          s.started_waiting_at,
          latest.content as last_message,
          latest.timestamp as last_message_time,
          latest.instance as instance,
          (SELECT COUNT(*)
             FROM chat_messages cm_unread
            WHERE cm_unread.tenant_id = $2
              AND cm_unread.sender = 'lead'
              AND (
                cm_unread.lead_id = s.lead_id
                OR (s.lead_phone IS NOT NULL AND REGEXP_REPLACE(COALESCE(cm_unread.phone, ''), '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE(s.lead_phone, '\\D', '', 'g'), 11))
              )
              AND cm_unread.timestamp > COALESCE(
                (SELECT last_read_at FROM chat_read_status WHERE lead_id = s.lead_id AND user_id = $1 AND tenant_id = $2 LIMIT 1),
                '1970-01-01'
              )
          )::INTEGER as unread_count
        FROM attendance_sessions s
        LEFT JOIN crm_leads l ON l.id::text = s.lead_id AND l.tenant_id = $2
        LEFT JOIN LATERAL (
          SELECT cm.content, cm.timestamp, cm.phone, cm.instance
            FROM chat_messages cm
           WHERE cm.tenant_id = $2
             AND (
               cm.lead_id = s.lead_id
               OR (s.lead_phone IS NOT NULL AND REGEXP_REPLACE(COALESCE(cm.phone, ''), '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE(s.lead_phone, '\\D', '', 'g'), 11))
             )
           ORDER BY cm.timestamp DESC
           LIMIT 1
        ) latest ON true
        WHERE s.tenant_id = $2
          AND s.status IN ('waiting', 'active')
        ORDER BY s.lead_id, s.started_waiting_at DESC NULLS LAST, s.created_at DESC NULLS LAST
      ),
      message_candidates AS (
        SELECT
          cm.id as message_id,
          COALESCE(l.id::text, cm.lead_id, cm.phone) as id,
          COALESCE(l.nome, cm.metadata->>'pushName', cm.phone) as name,
          COALESCE(l.telefone, cm.phone) as phone,
          l.avatar_url,
          l.queue_id::text as queue_id,
          l.queue_name,
          COALESCE(l.priority, false) as priority,
          cm.content as last_message,
          cm.timestamp as last_message_time,
          cm.instance,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(l.id::text, cm.lead_id, cm.phone)
            ORDER BY cm.timestamp DESC
          ) as rn
        FROM chat_messages cm
        LEFT JOIN crm_leads l
          ON l.tenant_id = $2
         AND (
           l.id::text = cm.lead_id
           OR (
             cm.phone IS NOT NULL
             AND REGEXP_REPLACE(COALESCE(l.telefone, ''), '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE(cm.phone, '\\D', '', 'g'), 11)
           )
         )
        WHERE cm.tenant_id = $2
          AND cm.sender = 'lead'
      ),
      orphan_messages AS (
        SELECT
          mc.id,
          mc.name,
          mc.phone,
          mc.avatar_url,
          mc.queue_id,
          mc.queue_name,
          mc.priority,
          NULL::uuid as session_id,
          'waiting'::text as session_status,
          NULL::uuid as attendant_id,
          NULL::text as attendant_name,
          mc.last_message_time as started_waiting_at,
          mc.last_message,
          mc.last_message_time,
          mc.instance,
          (SELECT COUNT(*)
             FROM chat_messages cm_unread
            WHERE cm_unread.tenant_id = $2
              AND cm_unread.sender = 'lead'
              AND (
                cm_unread.lead_id = mc.id
                OR (mc.phone IS NOT NULL AND REGEXP_REPLACE(COALESCE(cm_unread.phone, ''), '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE(mc.phone, '\\D', '', 'g'), 11))
              )
              AND cm_unread.timestamp > COALESCE(
                (SELECT last_read_at FROM chat_read_status WHERE lead_id = mc.id AND user_id = $1 AND tenant_id = $2 LIMIT 1),
                '1970-01-01'
              )
          )::INTEGER as unread_count
        FROM message_candidates mc
        WHERE mc.rn = 1
          AND NOT EXISTS (
            SELECT 1
              FROM attendance_sessions closed_s
             WHERE closed_s.tenant_id = $2
               AND closed_s.status = 'closed'
               AND closed_s.closed_at IS NOT NULL
               AND closed_s.closed_at >= mc.last_message_time
               AND (
                 closed_s.lead_id = mc.id
                 OR (closed_s.lead_phone IS NOT NULL AND mc.phone IS NOT NULL AND REGEXP_REPLACE(closed_s.lead_phone, '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE(mc.phone, '\\D', '', 'g'), 11))
               )
          )
          AND NOT EXISTS (
            SELECT 1
              FROM open_sessions os
             WHERE os.id = mc.id
                OR (os.phone IS NOT NULL AND mc.phone IS NOT NULL AND REGEXP_REPLACE(os.phone, '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE(mc.phone, '\\D', '', 'g'), 11))
          )
      )
      SELECT * FROM open_sessions
      UNION ALL
      SELECT * FROM orphan_messages
    `, [user.id, user.tenant_id]);

    // Separate into queue (waiting) and active (assigned)
    const queueLeads = [];
    const activeLeads = [];

    for (const r of rows) {
      const lead = {
        id: r.id,
        name: r.name || r.phone,
        phone: r.phone,
        avatarUrl: r.avatar_url,
        queueId: r.queue_id,
        queueName: r.queue_name,
        lastMessage: r.last_message || '',
        lastMessageTime: r.last_message_time,
        unreadCount: r.unread_count || 0,
        sessionStatus: r.session_status,
        attendantId: r.attendant_id,
        attendantName: r.attendant_name,
        priority: r.priority || false,
        instance: r.instance,
      };

      if (r.session_status === 'active' && r.attendant_id) {
        activeLeads.push(lead);
      } else {
        queueLeads.push(lead);
      }
    }

    // Sort queue: priority leads first, then by last message time
    queueLeads.sort((a, b) => {
      if (a.priority && !b.priority) return -1;
      if (!a.priority && b.priority) return 1;
      return new Date(b.lastMessageTime || 0) - new Date(a.lastMessageTime || 0);
    });

    res.json({ queue: queueLeads, active: activeLeads });

    // Background: batch-sync missing avatars
    const leadsWithoutAvatar = rows.filter(r => !r.avatar_url && r.phone);
    if (leadsWithoutAvatar.length > 0) {
      // Find connected instance
      const instResult = await evolutionFetch('/instance/fetchInstances');
      const connectedInstance = instResult.ok && Array.isArray(instResult.data)
        ? instResult.data.find(i => i.connectionStatus === 'open')
        : null;

      if (connectedInstance) {
        const instanceName = connectedInstance.name || connectedInstance.instanceName;
        for (const r of leadsWithoutAvatar.slice(0, 10)) {
          try {
            const cleanPhone = r.phone.replace(/\D/g, '');
            const picResult = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instanceName}`, {
              method: 'POST',
              body: JSON.stringify({ number: cleanPhone }),
            });
            const pictureUrl = picResult.data?.profilePictureUrl || picResult.data?.picture || picResult.data?.url || null;
            if (pictureUrl) {
              await pool.query('UPDATE crm_leads SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [pictureUrl, r.id]);
              console.log(`📸 Background avatar sync: ${maskPhone(r.phone)} → OK`);
            }
          } catch (err) {
            console.error(`📸 Avatar sync error for ${maskPhone(r.phone)}:`, err.message);
          }
        }
      }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CHAT MESSAGES — Extended CRUD (batch, delete, unread, search)
// ═══════════════════════════════════════════════════════════════

// Save multiple messages (batch)
app.post('/api/messages/batch', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Array messages obrigatório' });
    }
    if (messages.length > 500) {
      return res.status(400).json({ error: 'Máximo 500 mensagens por batch' });
    }

    // Cada lead precisa ser da clínica (lead do CRM, sessão de atendimento ou conversa existente)
    const leadIds = [...new Set(messages.map(m => String(m?.lead_id || '')))];
    if (leadIds.some(l => !l)) return res.status(400).json({ error: 'lead_id obrigatório em cada mensagem' });
    const { rows: ownLeads } = await pool.query(
      `SELECT l.lead_id FROM unnest($1::text[]) AS l(lead_id)
        WHERE EXISTS (SELECT 1 FROM crm_leads c WHERE c.id::text = l.lead_id AND c.tenant_id = $2)
           OR EXISTS (SELECT 1 FROM attendance_sessions s WHERE s.lead_id::text = l.lead_id AND s.tenant_id = $2)
           OR EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.lead_id::text = l.lead_id AND cm.tenant_id = $2)`,
      [leadIds, user.tenant_id]
    );
    if (ownLeads.length !== leadIds.length) return res.status(404).json({ error: 'Lead não encontrado' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const m of messages) {
        await client.query(`
          INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, media_url, file_name, mime_type,
            reply_to_id, reply_to_content, reply_to_sender, attendant_id, attendant_name, instance, phone, metadata, tenant_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
          ON CONFLICT (id) DO NOTHING
        `, [
          m.id, m.lead_id, m.content || null, m.sender, m.type || 'text', m.status || 'sent',
          m.timestamp || new Date().toISOString(), m.media_url || null, m.file_name || null, m.mime_type || null,
          m.reply_to_id || null, m.reply_to_content || null, m.reply_to_sender || null,
          m.attendant_id || null, m.attendant_name || null, m.instance || null, m.phone || null,
          JSON.stringify(m.metadata || {}), user.tenant_id
        ]);
      }
      await client.query('COMMIT');
      res.json({ success: true, count: messages.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Batch save error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a message (soft or hard)
app.delete('/api/messages/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { id } = req.params;
    const hard = req.query.hard === 'true';

    let rowCount = 0;
    if (hard) {
      ({ rowCount } = await pool.query('DELETE FROM chat_messages WHERE id = $1 AND tenant_id = $2', [id, user.tenant_id]));
    } else {
      ({ rowCount } = await pool.query("UPDATE chat_messages SET content = NULL, type = 'text', media_url = NULL, metadata = '{\"deleted\":true}' WHERE id = $1 AND tenant_id = $2", [id, user.tenant_id]));
    }
    if (rowCount === 0) return res.status(404).json({ error: 'Mensagem não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get unread counts per lead for current user
app.get('/api/messages/unread', async (req, res) => {
  try {
    const { user } = await verifyUser(req);

    const { rows } = await pool.query(`
      SELECT m.lead_id, COUNT(*) as unread_count
      FROM chat_messages m
      LEFT JOIN chat_read_status r ON r.lead_id = m.lead_id AND r.user_id = $1 AND r.tenant_id = $2
      WHERE m.sender = 'lead'
        AND m.tenant_id = $2
        AND (r.last_read_at IS NULL OR m.timestamp > r.last_read_at)
      GROUP BY m.lead_id
    `, [user.id, user.tenant_id]);

    const counts = {};
    for (const row of rows) {
      counts[row.lead_id] = parseInt(row.unread_count);
    }
    res.json(counts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search messages globally or within a lead
app.get('/api/messages/search', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const q = req.query.q;
    const leadId = req.query.lead_id;
    if (!q || q.length < 2) return res.status(400).json({ error: 'Query mínima 2 caracteres' });

    let query = "SELECT m.*, l.nome as lead_name FROM chat_messages m LEFT JOIN crm_leads l ON l.id = m.lead_id AND l.tenant_id = m.tenant_id WHERE m.content ILIKE $1 AND m.tenant_id = $2";
    const values = [`%${q}%`, user.tenant_id];

    if (leadId) {
      query += ' AND m.lead_id = $3';
      values.push(leadId);
    }

    query += ' ORDER BY m.timestamp DESC LIMIT 50';

    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS (Web Push)
// ═══════════════════════════════════════════════════════════════

// Get VAPID public key (frontend needs this to subscribe)
app.get('/api/push/vapid-key', (_req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'VAPID not configured' });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Subscribe to push notifications
app.post('/api/push/subscribe', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    await pool.query(
      `INSERT INTO push_subscriptions (user_id, tenant_id, endpoint, keys_p256dh, keys_auth, updated_at)
       VALUES ($1, $5, $2, $3, $4, NOW())
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, tenant_id = $5, keys_p256dh = $3, keys_auth = $4, updated_at = NOW()`,
      [user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, user.tenant_id || null]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unsubscribe from push notifications
app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════

// /api/health is defined earlier with full dependency checks
// (db, schema, redis, evolution, env vars). Do not redefine here.

app.get('/api/version', (_req, res) => {
  res.json({
    app: 'Odonto Connect API',
    version: '1.8.0',
    build: '2026-04-12',
    node: process.version,
    uptime: Math.floor(process.uptime()) + 's',
  });
});

// ═══════════════════════════════════════════════════════════════
// USER PREFERENCES (notification settings sync)
// ═══════════════════════════════════════════════════════════════

app.get('/api/user/preferences', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows } = await pool.query(
      'SELECT sound_enabled, sound_type, sound_volume, recovery_sound_enabled, push_enabled FROM user_preferences WHERE user_id = $1',
      [user.id]
    );
    if (rows.length === 0) {
      return res.json({ sound_enabled: true, sound_type: 'ding', sound_volume: 70, recovery_sound_enabled: true, push_enabled: true });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/user/preferences', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { sound_enabled, sound_type, sound_volume, recovery_sound_enabled, push_enabled } = req.body;
    await pool.query(`
      INSERT INTO user_preferences (user_id, sound_enabled, sound_type, sound_volume, recovery_sound_enabled, push_enabled, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        sound_enabled = EXCLUDED.sound_enabled,
        sound_type = EXCLUDED.sound_type,
        sound_volume = EXCLUDED.sound_volume,
        recovery_sound_enabled = EXCLUDED.recovery_sound_enabled,
        push_enabled = EXCLUDED.push_enabled,
        updated_at = NOW()
    `, [user.id, sound_enabled, sound_type, sound_volume, recovery_sound_enabled, push_enabled]);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AI SETTINGS & TRANSCRIPTION
// ═══════════════════════════════════════════════════════════════

// GET all AI settings (keys masked for frontend)
app.get('/api/ai/settings', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    const { rows } = await pool.query('SELECT provider, api_key, model, enabled FROM ai_settings ORDER BY provider');
    // Nunca devolver a chave nem pedaços dela; super-admin vê só os 4 últimos.
    let masked = rows.map(r => ({
      provider: r.provider,
      model: r.model,
      enabled: r.enabled,
      configured: !!r.api_key,
      api_key: r.api_key ? (user.is_super_admin ? '...' + r.api_key.slice(-4) : '...configurada') : '',
      editable: !!user.is_super_admin,
    }));
    // Meta Ads (provider 'manus'): o token é da clínica, não da plataforma
    if (!user.is_super_admin) {
      let own = null;
      if (user.tenant_id) {
        try {
          const { rows: t } = await pool.query(
            `SELECT * FROM tenant_ai_settings WHERE tenant_id = $1 AND provider = 'manus'`,
            [user.tenant_id]
          );
          own = t[0] || null;
        } catch (e) {
          if (e.code !== '42P01') throw e; // tabela ainda não criada: trata como não configurado
        }
      }
      masked = masked.filter(r => r.provider !== 'manus');
      masked.push({
        provider: 'manus',
        model: own?.model || '',
        enabled: own ? own.enabled !== false : false,
        configured: !!own?.api_key,
        api_key: own?.api_key ? '...' + own.api_key.slice(-4) : '',
        editable: !!user.tenant_id,
        config: own?.config || {},
      });
    }
    for (const p of ['openai', 'manus']) {
      if (!masked.some(r => r.provider === p)) {
        masked.push({ provider: p, model: '', enabled: false, configured: false, api_key: '', editable: !!user.is_super_admin });
      }
    }
    res.json(masked);
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (err.message === 'Admin access required') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Save/update AI provider settings
app.post('/api/ai/settings', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    const { provider, api_key, model, enabled, config } = req.body;
    if (!provider) return res.status(400).json({ error: 'Provider é obrigatório' });

    // Meta Ads (provider 'manus'): token por clínica, gravado pelo admin da própria clínica
    if (provider === 'manus' && !user.is_super_admin) {
      if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
      const isNewTenantKey = api_key && !String(api_key).includes('...');
      const tenantConfig = config && typeof config === 'object' && !Array.isArray(config) ? JSON.stringify(config) : null;
      try {
        if (isNewTenantKey) {
          await pool.query(`
            INSERT INTO tenant_ai_settings (tenant_id, provider, api_key, model, enabled, updated_at)
            VALUES ($1, 'manus', $2, $3, $4, NOW())
            ON CONFLICT (tenant_id, provider) DO UPDATE SET
              api_key = EXCLUDED.api_key,
              model = EXCLUDED.model,
              enabled = EXCLUDED.enabled,
              updated_at = NOW()
          `, [user.tenant_id, api_key, model || '', enabled !== false]);
        } else {
          // Chave mascarada: mantém a atual, muda só modelo/ativação
          await pool.query(`
            INSERT INTO tenant_ai_settings (tenant_id, provider, api_key, model, enabled, updated_at)
            VALUES ($1, 'manus', '', $2, $3, NOW())
            ON CONFLICT (tenant_id, provider) DO UPDATE SET
              model = EXCLUDED.model,
              enabled = EXCLUDED.enabled,
              updated_at = NOW()
          `, [user.tenant_id, model || '', enabled !== false]);
        }
        if (tenantConfig) {
          try {
            await pool.query(
              `UPDATE tenant_ai_settings SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE tenant_id = $2 AND provider = 'manus'`,
              [tenantConfig, user.tenant_id]
            );
          } catch (cfgErr) {
            if (cfgErr.code === '42703') {
              return res.status(503).json({ error: 'Token salvo, mas o ID da conta de anúncios não pôde ser gravado (migração do banco pendente). Fale com o suporte.' });
            }
            throw cfgErr;
          }
        }
      } catch (e) {
        if (e.code === '42P01') {
          return res.status(503).json({ error: 'A configuração do Meta Ads por clínica ainda não está disponível neste servidor (migração do banco pendente). Fale com o suporte.' });
        }
        throw e;
      }
      return res.json({ success: true });
    }

    if (!user.is_super_admin) {
      return res.status(403).json({ error: 'As chaves de IA são da plataforma e só o super admin pode alterá-las.' });
    }

    // Only update api_key if a full key is provided (not masked)
    const isNewKey = api_key && !api_key.includes('...');

    if (isNewKey) {
      await pool.query(`
        INSERT INTO ai_settings (provider, api_key, model, enabled, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (provider) DO UPDATE SET
          api_key = EXCLUDED.api_key,
          model = EXCLUDED.model,
          enabled = EXCLUDED.enabled,
          updated_at = NOW()
      `, [provider, api_key, model || 'gpt-4o-mini', enabled !== false]);
    } else {
      // Update only model/enabled, keep existing key
      await pool.query(`
        INSERT INTO ai_settings (provider, api_key, model, enabled, updated_at)
        VALUES ($1, '', $2, $3, NOW())
        ON CONFLICT (provider) DO UPDATE SET
          model = EXCLUDED.model,
          enabled = EXCLUDED.enabled,
          updated_at = NOW()
      `, [provider, model || 'gpt-4o-mini', enabled !== false]);
    }

    res.json({ success: true });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (err.message === 'Admin access required') return res.status(403).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Consentimentos LGPD por paciente ───────────────────────
// Registro probatório do consentimento (LGPD arts. 8º §2º, 11 I) e revogação (art. 8º §5º).
const CONSENT_TIPOS = new Set(['gravacao_transcricao_ia']);

async function findActiveConsent(tenantId, pacienteId, tipo) {
  const { rows } = await pool.query(
    `SELECT id, tipo, versao, aceito_em, registrado_por_email
       FROM consentimentos_pacientes
      WHERE tenant_id = $1 AND paciente_id = $2 AND tipo = $3 AND revogado_em IS NULL
      ORDER BY aceito_em DESC LIMIT 1`,
    [tenantId, String(pacienteId), tipo]
  );
  return rows[0] || null;
}

app.get('/api/pacientes/:id/consentimentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const tipo = String(req.query.tipo || '');
    if (!CONSENT_TIPOS.has(tipo)) return res.status(400).json({ error: 'tipo inválido' });
    const consent = await findActiveConsent(user.tenant_id, req.params.id, tipo);
    res.json({ consent });
  } catch (err) {
    res.status(err.message === 'Unauthorized' ? 401 : 500).json({ error: err.message });
  }
});

app.post('/api/pacientes/:id/consentimentos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const { tipo, versao, texto } = req.body || {};
    if (!CONSENT_TIPOS.has(tipo) || !versao || !texto) {
      return res.status(400).json({ error: 'tipo, versao e texto são obrigatórios' });
    }
    // atendimento.tsx usa o id do agendamento quando o agendamento não tem paciente
    // vinculado; aceita os dois, desde que sejam desta clínica.
    const { rows: pac } = await pool.query(
      'SELECT 1 FROM pacientes WHERE id = $1 AND tenant_id = $2 LIMIT 1', [req.params.id, user.tenant_id]);
    let donoOk = pac.length > 0;
    if (!donoOk) {
      const { rows: apt } = await pool.query(
        'SELECT 1 FROM agendamentos WHERE id = $1 AND tenant_id = $2 LIMIT 1', [req.params.id, user.tenant_id]);
      donoOk = apt.length > 0;
    }
    if (!donoOk) return res.status(404).json({ error: 'Paciente não encontrado' });
    const { rows } = await pool.query(
      `INSERT INTO consentimentos_pacientes
         (tenant_id, paciente_id, tipo, versao, texto, registrado_por, registrado_por_email, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, tipo, versao, aceito_em, registrado_por_email`,
      [
        user.tenant_id, String(req.params.id), tipo, String(versao), String(texto).slice(0, 5000),
        user.id || null, user.email || null,
        req.headers['x-forwarded-for'] || req.ip || null,
        req.headers['user-agent'] || null,
      ]
    );
    res.json({ consent: rows[0] });
  } catch (err) {
    res.status(err.message === 'Unauthorized' ? 401 : 500).json({ error: err.message });
  }
});

app.post('/api/consentimentos/:id/revogar', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const { rowCount } = await pool.query(
      `UPDATE consentimentos_pacientes SET revogado_em = NOW(), revogado_por = $3
        WHERE id = $1 AND tenant_id = $2 AND revogado_em IS NULL`,
      [req.params.id, user.tenant_id, user.id || null]
    );
    res.json({ success: rowCount > 0 });
  } catch (err) {
    res.status(err.message === 'Unauthorized' ? 401 : 500).json({ error: err.message });
  }
});

// ─── Transcribe audio via OpenAI Whisper ────────────────────
// O áudio fica só num arquivo temporário durante a chamada e é apagado em seguida
// (LGPD art. 16). Exige consentimento ativo do paciente para gravação/transcrição por IA.
app.post('/api/ai/transcribe', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '50mb' }), async (req, res) => {
  let tmpDir = null;
  try {
    const { user } = await verifyUser(req);

    const pacienteId = req.query.paciente_id ? String(req.query.paciente_id) : '';
    if (!pacienteId || !user.tenant_id) {
      return res.status(400).json({ error: 'Selecione o paciente antes de transcrever.', code: 'CONSENT_REQUIRED' });
    }
    const consent = await findActiveConsent(user.tenant_id, pacienteId, 'gravacao_transcricao_ia');
    if (!consent) {
      return res.status(403).json({
        error: 'O paciente ainda não autorizou a gravação e transcrição por IA.',
        code: 'CONSENT_REQUIRED',
      });
    }

    // Get OpenAI key from DB
    const { rows } = await pool.query("SELECT api_key, enabled FROM ai_settings WHERE provider = 'openai' LIMIT 1");
    if (rows.length === 0 || !rows[0].api_key || !rows[0].enabled) {
      return res.status(400).json({ error: 'OpenAI não está configurada. Vá em Configurações > IA para adicionar a API key.' });
    }

    const openaiKey = rows[0].api_key;

    // Save audio to temp file
    tmpDir = await mkdtemp(path.join(tmpdir(), 'whisper-'));
    const audioPath = path.join(tmpDir, 'audio.webm');
    await writeFile(audioPath, req.body);

    // Call OpenAI Whisper
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    const { createReadStream } = await import('fs');
    form.append('file', createReadStream(audioPath), { filename: 'audio.webm', contentType: 'audio/webm' });
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    form.append('response_format', 'text');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    // Cleanup temp
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error('Whisper error:', whisperRes.status, errText);
      return res.status(500).json({ error: `Erro na transcrição: ${whisperRes.status}` });
    }

    const transcription = await whisperRes.text();
    res.json({ transcription });
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(err.message === 'Unauthorized' ? 401 : 500).json({ error: err.message });
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// ─── Generate clinical report via OpenAI GPT ────────────────
app.post('/api/ai/clinical-report', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { transcription, queixaPrincipal, procedimento, dente, prescricoes, patientId, patientName, durationSeconds } = req.body;

    if (!transcription) return res.status(400).json({ error: 'Transcrição é obrigatória' });

    // Get OpenAI settings
    const { rows } = await pool.query("SELECT api_key, model, enabled FROM ai_settings WHERE provider = 'openai' LIMIT 1");
    if (rows.length === 0 || !rows[0].api_key || !rows[0].enabled) {
      return res.status(400).json({ error: 'OpenAI não está configurada.' });
    }

    const { api_key: openaiKey, model } = rows[0];

    const systemPrompt = `Você é um assistente clínico odontológico. Gere um relatório clínico estruturado e profissional baseado na transcrição da consulta. O relatório deve conter:

1. **Resumo da Consulta** — breve parágrafo sobre o que foi discutido
2. **Queixa do Paciente** — o que o paciente relatou
3. **Exame Clínico** — achados durante o exame
4. **Diagnóstico** — hipótese diagnóstica baseada na transcrição
5. **Procedimento Realizado** — o que foi feito durante a consulta
6. **Prescrições** — medicamentos prescritos (se houver)
7. **Orientações ao Paciente** — recomendações pós-consulta
8. **Plano de Tratamento** — próximos passos sugeridos
9. **Follow-up Sugerido** — quando retornar e pontos a acompanhar

Use linguagem técnica odontológica mas clara. Formato Markdown.`;

    const userMsg = `## Contexto do atendimento:
- Queixa principal: ${queixaPrincipal || 'Não informada'}
- Procedimento: ${procedimento || 'Não informado'}
- Dente/Região: ${dente || 'Não especificado'}
- Prescrições: ${prescricoes?.length > 0 ? prescricoes.map(p => `${p.medicamento} ${p.dosagem} ${p.posologia}`).join('; ') : 'Nenhuma'}
- Duração: ${durationSeconds ? Math.round(durationSeconds / 60) + ' minutos' : 'Não informada'}

## Transcrição da consulta:
${transcription}`;

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!gptRes.ok) {
      const errText = await gptRes.text();
      console.error('GPT error:', gptRes.status, errText);
      return res.status(500).json({ error: `Erro ao gerar relatório: ${gptRes.status}` });
    }

    const gptData = await gptRes.json();
    const report = gptData.choices?.[0]?.message?.content || 'Erro: relatório vazio';

    // Save to DB
    const reportId = randomUUID();
    await pool.query(`
      INSERT INTO clinical_reports (id, patient_id, patient_name, attendant_id, attendant_name, transcription, report, queixa_principal, procedimento, dente_regiao, prescricoes, duration_seconds, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [reportId, patientId || 'unknown', patientName || '', user.id, '', transcription, report, queixaPrincipal || '', procedimento || '', dente || '', JSON.stringify(prescricoes || []), durationSeconds || 0, user.tenant_id]);

    res.json({ id: reportId, report, transcription });
  } catch (err) {
    console.error('Clinical report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Get clinical reports for a patient ─────────────────────
app.get('/api/ai/reports/:patientId', async (req, res, next) => {
  // export.csv tem rota própria (registrada depois); sem isto ela nunca era alcançada
  if (req.params.patientId === 'export.csv') return next();
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { patientId } = req.params;
    const { rows } = await pool.query(
      'SELECT id, patient_name, transcription, report, queixa_principal, procedimento, dente_regiao, prescricoes, duration_seconds, created_at FROM clinical_reports WHERE patient_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50',
      [patientId, user.tenant_id]
    );
    res.json(rows);
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

// ─── List clinical reports with filters (period, status, patient, dentist) ──
// GET /api/ai/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&status=com_prescricao|sem_prescricao|todos&patientId=&attendantId=&q=
app.get('/api/ai/reports', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { from, to, status, patientId, attendantId, q, limit } = req.query;

    const where = [];
    const params = [];
    let idx = 1;
    where.push(`tenant_id = $${idx++}`); params.push(user.tenant_id);

    if (from) { where.push(`created_at >= $${idx++}`); params.push(from); }
    if (to)   { where.push(`created_at <= ($${idx++}::date + INTERVAL '1 day')`); params.push(to); }
    if (patientId) { where.push(`patient_id = $${idx++}`); params.push(patientId); }
    if (attendantId) { where.push(`attendant_id = $${idx++}`); params.push(attendantId); }
    if (q) {
      where.push(`(LOWER(patient_name) LIKE $${idx} OR LOWER(queixa_principal) LIKE $${idx} OR LOWER(procedimento) LIKE $${idx})`);
      params.push(`%${String(q).toLowerCase()}%`); idx++;
    }
    if (status === 'com_prescricao') where.push(`jsonb_array_length(COALESCE(prescricoes, '[]'::jsonb)) > 0`);
    if (status === 'sem_prescricao') where.push(`(prescricoes IS NULL OR jsonb_array_length(COALESCE(prescricoes, '[]'::jsonb)) = 0)`);

    // Non-admin users only see their own reports
    if (user.role !== 'admin' && user.role !== 'gerente') {
      where.push(`attendant_id = $${idx++}`);
      params.push(user.id);
    }

    const lim = Math.min(parseInt(limit) || 200, 1000);
    const sql = `
      SELECT id, patient_id, patient_name, attendant_id, attendant_name,
             transcription, report, queixa_principal, procedimento, dente_regiao,
             prescricoes, duration_seconds, created_at
      FROM clinical_reports
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT ${lim}
    `;
    const { rows } = await pool.query(sql, params);

    // Aggregated stats
    const total = rows.length;
    const comPrescricao = rows.filter(r => Array.isArray(r.prescricoes) ? r.prescricoes.length > 0 : (r.prescricoes && JSON.parse(r.prescricoes || '[]').length > 0)).length;
    const totalDuration = rows.reduce((s, r) => s + (r.duration_seconds || 0), 0);
    const pacientesUnicos = new Set(rows.map(r => r.patient_id)).size;

    res.json({
      reports: rows,
      stats: {
        total,
        com_prescricao: comPrescricao,
        sem_prescricao: total - comPrescricao,
        pacientes_unicos: pacientesUnicos,
        duracao_total_min: Math.round(totalDuration / 60),
      },
    });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('❌ List clinical reports error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Export clinical reports as CSV ─────────────────────────
// GET /api/ai/reports/export.csv?from=&to=&status=&patientId=&attendantId=&token=<JWT>
app.get('/api/ai/reports/export.csv', async (req, res) => {
  try {
    // Allow token via query string for direct browser download links
    if (req.query.token && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { from, to, status, patientId, attendantId, q } = req.query;

    const where = [];
    const params = [];
    let idx = 1;
    where.push(`tenant_id = $${idx++}`); params.push(user.tenant_id);
    if (from) { where.push(`created_at >= $${idx++}`); params.push(from); }
    if (to)   { where.push(`created_at <= ($${idx++}::date + INTERVAL '1 day')`); params.push(to); }
    if (patientId) { where.push(`patient_id = $${idx++}`); params.push(patientId); }
    if (attendantId) { where.push(`attendant_id = $${idx++}`); params.push(attendantId); }
    if (q) {
      where.push(`(LOWER(patient_name) LIKE $${idx} OR LOWER(queixa_principal) LIKE $${idx} OR LOWER(procedimento) LIKE $${idx})`);
      params.push(`%${String(q).toLowerCase()}%`); idx++;
    }
    if (status === 'com_prescricao') where.push(`jsonb_array_length(COALESCE(prescricoes, '[]'::jsonb)) > 0`);
    if (status === 'sem_prescricao') where.push(`(prescricoes IS NULL OR jsonb_array_length(COALESCE(prescricoes, '[]'::jsonb)) = 0)`);
    if (user.role !== 'admin' && user.role !== 'gerente') {
      where.push(`attendant_id = $${idx++}`);
      params.push(user.id);
    }

    const sql = `
      SELECT created_at, patient_name, attendant_name, queixa_principal, procedimento,
             dente_regiao, duration_seconds, prescricoes
      FROM clinical_reports
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC LIMIT 5000
    `;
    const { rows } = await pool.query(sql, params);

    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""').replace(/\r?\n/g, ' ');
      return `"${s}"`;
    };
    const header = ['Data', 'Hora', 'Paciente', 'Dentista', 'Queixa', 'Procedimento', 'Dente/Região', 'Duração (min)', 'Nº Prescrições'].map(esc).join(',');
    const lines = rows.map(r => {
      const d = new Date(r.created_at);
      const presc = Array.isArray(r.prescricoes) ? r.prescricoes : (typeof r.prescricoes === 'string' ? JSON.parse(r.prescricoes || '[]') : []);
      return [
        d.toLocaleDateString('pt-BR'),
        d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        r.patient_name || '',
        r.attendant_name || '',
        r.queixa_principal || '',
        r.procedimento || '',
        r.dente_regiao || '',
        Math.round((r.duration_seconds || 0) / 60),
        presc.length,
      ].map(esc).join(',');
    });

    const csv = '\uFEFF' + [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorios-clinicos-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('❌ Export CSV error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Consultations — finalize & history ─────────────────────

// POST /api/consultations — save a finalized consultation
app.post('/api/consultations', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const {
      patient_id, patient_name, appointment_id,
      queixa_principal, procedimento, dente_regiao, observacoes,
      prescricoes, duration_seconds, gravacoes_count,
      clinical_report_id, started_at,
    } = req.body;

    if (!patient_id) return res.status(400).json({ error: 'patient_id é obrigatório' });

    const { rows } = await pool.query(
      `INSERT INTO consultations
        (patient_id, patient_name, appointment_id, dentist_id, dentist_name,
         queixa_principal, procedimento, dente_regiao, observacoes,
         prescricoes, duration_seconds, gravacoes_count, clinical_report_id,
         started_at, finished_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15)
       RETURNING id, finished_at`,
      [
        patient_id, patient_name || null, appointment_id || null,
        user.id, user.name,
        queixa_principal || null, procedimento || null, dente_regiao || null, observacoes || null,
        JSON.stringify(prescricoes || []), duration_seconds || 0, gravacoes_count || 0,
        clinical_report_id || null, started_at || null,
        user.tenant_id,
      ]
    );

    res.json({ id: rows[0].id, finished_at: rows[0].finished_at });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('❌ Error saving consultation:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/consultations/:patientId — consultation history for a patient
app.get('/api/consultations/:patientId', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { patientId } = req.params;
    const { rows } = await pool.query(
      `SELECT id, patient_name, dentist_name, queixa_principal, procedimento,
              dente_regiao, observacoes, prescricoes, duration_seconds,
              gravacoes_count, clinical_report_id, status, started_at, finished_at
       FROM consultations
       WHERE patient_id = $1 AND tenant_id = $2
       ORDER BY finished_at DESC
       LIMIT 50`,
      [patientId, user.tenant_id]
    );
    res.json(rows);
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate AI follow-up messages based on clinical report ─
app.post('/api/ai/followup-messages', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const { reportId, patientName, patientPhone } = req.body;
    if (!reportId) return res.status(400).json({ error: 'reportId é obrigatório' });

    // Fetch the clinical report
    const { rows: reports } = await pool.query(
      'SELECT report, queixa_principal, procedimento, dente_regiao, prescricoes FROM clinical_reports WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [reportId, user.tenant_id]
    );
    if (reports.length === 0) return res.status(404).json({ error: 'Relatório não encontrado' });
    const report = reports[0];

    // Get OpenAI settings
    const { rows: aiRows } = await pool.query("SELECT api_key, model, enabled FROM ai_settings WHERE provider = 'openai' LIMIT 1");
    if (aiRows.length === 0 || !aiRows[0].api_key || !aiRows[0].enabled) {
      return res.status(400).json({ error: 'OpenAI não está configurada.' });
    }
    const { api_key: openaiKey, model } = aiRows[0];

    const systemPrompt = `Você é um assistente de follow-up odontológico. Baseado no relatório clínico de uma consulta, gere 3 mensagens de follow-up personalizadas para enviar ao paciente via WhatsApp.

As mensagens devem:
- Ser calorosas, empáticas e profissionais
- NÃO citar procedimento, dente, região, medicamento, prescrição, diagnóstico ou valor
  (a mensagem aparece na tela do celular e pode ser lida por outra pessoa)
- Referir-se apenas a "seu atendimento" ou "sua consulta"
- Orientações clínicas: só "siga as orientações que recebeu; qualquer dúvida, fale com a gente"
- Não oferecer desconto, promoção, brinde ou avaliação gratuita
- Ser curtas (máx 200 caracteres) e usar no máximo 1 emoji
- Identificar a clínica como {{clinica}}

Retorne em formato JSON:
{
  "messages": [
    {"delay_days": 1, "text": "mensagem 1 - pós-consulta imediato, verificar se está tudo bem"},
    {"delay_days": 3, "text": "mensagem 2 - acompanhamento, reforçar orientações"},
    {"delay_days": 7, "text": "mensagem 3 - follow-up final, lembrar próximo retorno"}
  ],
  "summary": "breve resumo do que o follow-up aborda"
}`;

    const userMsg = `## Relatório Clínico:
${report.report}

## Dados:
- Paciente: ${patientName || 'Não informado'}
- Queixa: ${report.queixa_principal || 'N/A'}
- Procedimento: ${report.procedimento || 'N/A'}
- Região: ${report.dente_regiao || 'N/A'}
- Prescrições: ${JSON.stringify(report.prescricoes || [])}

Gere as mensagens de follow-up personalizadas. Use {{nome}} como variável para o nome do paciente.`;

    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!gptRes.ok) {
      const errText = await gptRes.text();
      console.error('GPT followup error:', gptRes.status, errText);
      return res.status(500).json({ error: `Erro ao gerar mensagens: ${gptRes.status}` });
    }

    const gptData = await gptRes.json();
    const content = gptData.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = { messages: [], summary: '' }; }

    res.json(parsed);
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Followup messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Schedule follow-up from clinical report ────────────────
app.post('/api/ai/schedule-followup', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { reportId, patientName, patientPhone, messages, instance } = req.body;

    if (!reportId || !patientPhone || !messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'reportId, patientPhone e messages são obrigatórios' });
    }

    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });
    const tenantId = String(user.tenant_id);
    // Só um número da própria clínica (antes: o primeiro aberto de qualquer clínica).
    if (instance && !(await userOwnsInstance(user, instance))) {
      return res.status(403).json({ error: 'Este número de WhatsApp não pertence à sua clínica.' });
    }
    const instanceName = instance || await getTenantDefaultInstance(tenantId);

    const flowId = `followup-report-${reportId}`;
    const flowName = `Follow-up IA: ${patientName || patientPhone}`;
    const now = new Date();

    // Create a temporary automation flow for tracking
    await pool.query(`
      INSERT INTO automation_flows (id, name, description, type, active, trigger_event, steps, stats, created_by, tenant_id)
      VALUES ($1, $2, $3, 'pos_consulta', true, 'Relatório clínico IA', $4, '{"sent":0,"responded":0,"converted":0}', $5, $6)
      ON CONFLICT (id) DO UPDATE SET steps = EXCLUDED.steps, updated_at = NOW()
        WHERE automation_flows.tenant_id = EXCLUDED.tenant_id
    `, [
      flowId, flowName,
      `Follow-up automático gerado pela IA baseado no relatório clínico ${reportId}`,
      JSON.stringify(messages.map((m, i) => ({
        id: `s-${Date.now()}-${i}`,
        delay: `${m.delay_days} dia(s)`,
        delayMinutes: m.delay_days * 1440,
        channel: 'whatsapp',
        message: m.text,
        variables: ['nome'],
      }))),
      user.id,
      tenantId,
    ]);

    // Schedule automation jobs
    const jobIds = [];
    const phone = patientPhone.replace(/\D/g, '');
    const formattedPhone = phone.startsWith('55') ? phone : `55${phone}`;

    const clinicaNome = await getTenantClinicName(tenantId);
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const scheduledAt = new Date(now.getTime() + (msg.delay_days * 86400000));
      const personalizedMsg = (msg.text || '')
        .replace(/\{\{nome\}\}/g, patientName || 'Paciente')
        .replace(/\{\{clinica\}\}/g, clinicaNome);

      const jobId = randomUUID();
      await enqueueWhatsAppJob({
        id: jobId, tenantId, instance: instanceName || null, phone: formattedPhone,
        message: personalizedMsg, category: 'transactional',
        flowId, flowName, stepIndex: i, patientName: patientName || '',
        variables: { nome: patientName || 'Paciente', reportId },
        scheduledAt, triggerEvent: 'clinical_report_followup',
      });
      jobIds.push({ id: jobId, scheduled_at: scheduledAt, delay_days: msg.delay_days, message: personalizedMsg });
    }

    // Link report to follow-up
    await pool.query(`
      UPDATE clinical_reports SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{followup_flow_id}', $1)
      WHERE id = $2
    `, [JSON.stringify(flowId), reportId]);

    console.log(`🤖 Follow-up IA agendado: ${jobIds.length} mensagens para ${maskPhone(formattedPhone)}`);
    res.json({ success: true, flowId, jobs: jobIds });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Schedule followup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// META ADS — MANUS AI INTEGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Helper: get Manus AI settings from ai_settings table
 */
// Meta Ads: tabelas meta_ads_* isoladas por clínica. Upsert manual por (tenant_id, chave)
// para não depender da ordem da migração (constraint única antiga é só por campaign_id/account_id).
const META_ADS_MIGRATION_MSG = 'O Meta Ads por clínica ainda não está disponível neste servidor (migração do banco pendente). Fale com o suporte.';
async function metaAdsUpsert(table, tenantId, keys, values) {
  const keyNames = Object.keys(keys);
  const where = keyNames.map((k, i) => `${k} = $${i + 2}`).join(' AND ');
  const keyParams = [tenantId, ...keyNames.map(k => keys[k])];
  const valNames = Object.keys(values);
  const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1 AND ${where} LIMIT 1`, keyParams);
  if (rows.length > 0) {
    const sets = valNames.map((k, i) => `${k} = $${keyParams.length + i + 1}`).join(', ');
    await pool.query(`UPDATE ${table} SET ${sets} WHERE tenant_id = $1 AND ${where}`, [...keyParams, ...valNames.map(k => values[k])]);
  } else {
    const cols = ['tenant_id', ...keyNames, ...valNames];
    const all = [tenantId, ...keyNames.map(k => keys[k]), ...valNames.map(k => values[k])];
    await pool.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, all);
  }
}

// Token do Meta Ads da clínica (tenant_ai_settings). A configuração global (ai_settings)
// só é usada como fallback para super-admin.
async function getManusSettings(tenantId, allowGlobalFallback = false) {
  if (tenantId) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM tenant_ai_settings WHERE tenant_id = $1 AND provider = 'manus' AND enabled = true`,
        [tenantId]
      );
      if (rows[0]?.api_key) return { ...rows[0], _source: 'tenant' };
    } catch (err) {
      if (err.code !== '42P01') throw err; // tabela ainda não criada (migração pendente)
      console.warn('[meta-ads] tenant_ai_settings não existe — aplique a migração de segurança P0');
    }
  }
  if (!allowGlobalFallback) return null;
  const result = await pool.query(`SELECT * FROM ai_settings WHERE provider = 'manus' AND enabled = true`);
  return result.rows[0] ? { ...result.rows[0], _source: 'global' } : null;
}

/**
 * Helper: call Meta Graph API with access token from Manus config
 */
async function metaGraphFetch(path, accessToken, params = {}) {
  const url = new URL(`https://graph.facebook.com/v19.0${path}`);
  url.searchParams.set('access_token', accessToken);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Meta API ${resp.status}: ${JSON.stringify(err.error || err)}`);
  }
  return resp.json();
}

/**
 * Helper: use Manus AI (or OpenAI fallback) to analyze campaign data
 */
async function generateMetaAdsInsight(campaigns) {
  // Try OpenAI for analysis since Manus AI may not have a direct analysis endpoint
  const openaiSettings = await pool.query(`SELECT * FROM ai_settings WHERE provider = 'openai' AND enabled = true`);
  const openai = openaiSettings.rows[0];
  if (!openai?.api_key) return null;

  const summary = campaigns.map(c =>
    `- ${c.name}: R$${c.spend} investido, ${c.impressions} impressões, ${c.clicks} cliques, CTR ${c.ctr}%, ${c.leads} leads, CPL R$${c.cost_per_lead || 'N/A'}`
  ).join('\n');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openai.api_key}` },
    body: JSON.stringify({
      model: openai.model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Você é um analista de marketing digital para clínicas odontológicas. Analise as campanhas do Meta Ads e forneça insights acionáveis em português. Seja direto, máximo 4 frases.' },
        { role: 'user', content: `Analise essas campanhas do Meta Ads:\n${summary}\n\nDê insights sobre performance, otimização e recomendações.` },
      ],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || null;
}

// GET /api/ai/meta-ads/overview — return aggregated Meta Ads data
app.get('/api/ai/meta-ads/overview', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });

    const manus = await getManusSettings(user.tenant_id, false);
    const connected = !!manus?.api_key;

    // Try to get cached insights from DB
    const campaignsResult = await pool.query(`
      SELECT c.campaign_id, c.name, c.status, c.objective,
        COALESCE(SUM(i.impressions), 0)::int AS impressions,
        COALESCE(SUM(i.clicks), 0)::int AS clicks,
        COALESCE(SUM(i.spend), 0)::numeric AS spend,
        COALESCE(SUM(i.reach), 0)::int AS reach,
        CASE WHEN COALESCE(SUM(i.impressions), 0) > 0
          THEN ROUND((COALESCE(SUM(i.clicks), 0)::numeric / SUM(i.impressions) * 100), 2)
          ELSE 0 END AS ctr,
        CASE WHEN COALESCE(SUM(i.clicks), 0) > 0
          THEN ROUND(COALESCE(SUM(i.spend), 0) / SUM(i.clicks), 2)
          ELSE 0 END AS cpc,
        CASE WHEN COALESCE(SUM(i.impressions), 0) > 0
          THEN ROUND(COALESCE(SUM(i.spend), 0) / SUM(i.impressions) * 1000, 2)
          ELSE 0 END AS cpm,
        COALESCE(SUM(i.leads), 0)::int AS leads,
        COALESCE(SUM(i.conversions), 0)::int AS conversions,
        CASE WHEN COALESCE(SUM(i.leads), 0) > 0
          THEN ROUND(COALESCE(SUM(i.spend), 0) / SUM(i.leads), 2)
          ELSE NULL END AS cost_per_lead,
        CASE WHEN COALESCE(SUM(i.conversions), 0) > 0
          THEN ROUND(COALESCE(SUM(i.spend), 0) / SUM(i.conversions), 2)
          ELSE NULL END AS cost_per_conversion
      FROM meta_ads_campaigns c
      LEFT JOIN meta_ads_insights i ON c.campaign_id = i.campaign_id AND i.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1
      GROUP BY c.campaign_id, c.name, c.status, c.objective
      ORDER BY spend DESC
    `, [user.tenant_id]);

    const campaigns = campaignsResult.rows.map(r => ({
      ...r,
      spend: parseFloat(r.spend) || 0,
      ctr: parseFloat(r.ctr) || 0,
      cpc: parseFloat(r.cpc) || 0,
      cpm: parseFloat(r.cpm) || 0,
      cost_per_lead: r.cost_per_lead ? parseFloat(r.cost_per_lead) : null,
      cost_per_conversion: r.cost_per_conversion ? parseFloat(r.cost_per_conversion) : null,
    }));

    const total_spend = campaigns.reduce((s, c) => s + c.spend, 0);
    const total_impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
    const total_clicks = campaigns.reduce((s, c) => s + c.clicks, 0);
    const total_leads = campaigns.reduce((s, c) => s + c.leads, 0);
    const total_conversions = campaigns.reduce((s, c) => s + c.conversions, 0);

    // Get last sync time
    const syncResult = await pool.query(`SELECT last_sync FROM meta_ads_accounts WHERE tenant_id = $1 ORDER BY last_sync DESC NULLS LAST LIMIT 1`, [user.tenant_id]);
    const lastSync = syncResult.rows[0]?.last_sync;

    res.json({
      connected,
      total_spend,
      total_impressions,
      total_clicks,
      total_leads,
      total_conversions,
      avg_ctr: total_impressions > 0 ? parseFloat(((total_clicks / total_impressions) * 100).toFixed(2)) : 0,
      avg_cpc: total_clicks > 0 ? parseFloat((total_spend / total_clicks).toFixed(2)) : 0,
      avg_cpl: total_leads > 0 ? parseFloat((total_spend / total_leads).toFixed(2)) : 0,
      campaigns,
      last_sync: lastSync ? new Date(lastSync).toLocaleString('pt-BR') : null,
    });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (err.code === '42703') return res.status(503).json({ error: META_ADS_MIGRATION_MSG });
    console.error('Meta Ads overview error:', err);
    res.status(500).json({ error: err?.code === '23505' ? 'Esta conta ou campanha já está sendo sincronizada. Tente de novo em instantes.' : 'Erro interno ao processar o Meta Ads' });
  }
});

// POST /api/ai/meta-ads/sync — sync campaigns from Meta Graph API
app.post('/api/ai/meta-ads/sync', async (req, res) => {
  try {
    const { user } = await verifyAdmin(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });

    const manus = await getManusSettings(user.tenant_id, false);
    if (!manus?.api_key) {
      return res.status(400).json({ error: 'Manus AI não configurado. Vá em Configurações → IA e adicione a API key.' });
    }

    // The Manus api_key field stores the Meta Ads access token
    const accessToken = manus.api_key;

    // Manus config may store ad_account_id in the config JSONB
    const config = typeof manus.config === 'string' ? JSON.parse(manus.config) : (manus.config || {});
    let adAccountId = config.ad_account_id;

    // Sem ad_account_id configurado na clínica: descobre a primeira conta do token
    let adAccountName = adAccountId;
    if (!adAccountId) {
      const meData = await metaGraphFetch('/me/adaccounts', accessToken, { fields: 'id,name,account_status' });
      if (meData.data && meData.data.length > 0) {
        adAccountId = meData.data[0].id;
        adAccountName = meData.data[0].name || adAccountId;
        // Guarda a conta descoberta na configuração de quem forneceu o token
        if (manus._source === 'global') {
          await pool.query(`UPDATE ai_settings SET config = config || $1::jsonb WHERE provider = 'manus'`, [
            JSON.stringify({ ad_account_id: adAccountId }),
          ]);
        } else {
          await pool.query(
            `UPDATE tenant_ai_settings SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb WHERE tenant_id = $2 AND provider = 'manus'`,
            [JSON.stringify({ ad_account_id: adAccountId }), user.tenant_id]
          ).catch(e => { if (e.code !== '42703') throw e; });
        }
      } else {
        return res.status(400).json({ error: 'Nenhuma conta de anúncio encontrada. Verifique o token de acesso.' });
      }
    }
    // Conta da clínica (o token fica só em tenant_ai_settings/ai_settings, não aqui)
    await metaAdsUpsert('meta_ads_accounts', user.tenant_id, { account_id: adAccountId }, {
      account_name: adAccountName, access_token: '', connected: true,
    });

    // Fetch campaigns
    const campaignsData = await metaGraphFetch(`/${adAccountId}/campaigns`, accessToken, {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
      limit: 50,
    });

    const campaigns = campaignsData.data || [];
    let synced = 0;

    for (const c of campaigns) {
      await metaAdsUpsert('meta_ads_campaigns', user.tenant_id, { campaign_id: c.id }, {
        account_id: adAccountId, name: c.name, status: c.status, objective: c.objective,
        daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
        start_time: c.start_time || null, stop_time: c.stop_time || null, updated_at: new Date(),
      });

      // Fetch insights for each campaign (last 30 days)
      try {
        const insightsData = await metaGraphFetch(`/${c.id}/insights`, accessToken, {
          fields: 'impressions,clicks,spend,reach,ctr,cpc,cpm,actions',
          date_preset: 'last_30d',
          time_increment: 'all_days',
        });

        for (const ins of (insightsData.data || [])) {
          const actions = ins.actions || [];
          const leads = actions.find(a => a.action_type === 'lead')?.value || 0;
          const conversions = actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || 0;

          await metaAdsUpsert('meta_ads_insights', user.tenant_id, { campaign_id: c.id, date_start: ins.date_start }, {
            date_stop: ins.date_stop,
            impressions: parseInt(ins.impressions) || 0, clicks: parseInt(ins.clicks) || 0,
            spend: parseFloat(ins.spend) || 0, reach: parseInt(ins.reach) || 0,
            ctr: parseFloat(ins.ctr) || 0, cpc: parseFloat(ins.cpc) || 0, cpm: parseFloat(ins.cpm) || 0,
            actions: JSON.stringify(actions), leads: parseInt(leads) || 0, conversions: parseInt(conversions) || 0,
            cost_per_lead: leads > 0 ? parseFloat(ins.spend) / parseInt(leads) : null,
            cost_per_conversion: conversions > 0 ? parseFloat(ins.spend) / parseInt(conversions) : null,
          });
        }
      } catch (insErr) {
        if (insErr.code === '42703') throw insErr;
        console.warn(`⚠️ Insights fetch failed for campaign ${c.id}: ${insErr.message}`);
      }

      synced++;
    }

    // Update last_sync
    await pool.query(`UPDATE meta_ads_accounts SET last_sync = NOW() WHERE account_id = $1 AND tenant_id = $2`, [adAccountId, user.tenant_id]);

    // Generate AI insight
    let aiInsight = null;
    if (synced > 0) {
      try {
        const freshCampaigns = await pool.query(`
          SELECT c.name, COALESCE(SUM(i.spend),0) AS spend, COALESCE(SUM(i.impressions),0) AS impressions,
            COALESCE(SUM(i.clicks),0) AS clicks,
            CASE WHEN SUM(i.impressions)>0 THEN ROUND(SUM(i.clicks)::numeric/SUM(i.impressions)*100,2) ELSE 0 END AS ctr,
            COALESCE(SUM(i.leads),0) AS leads,
            CASE WHEN SUM(i.leads)>0 THEN ROUND(SUM(i.spend)/SUM(i.leads),2) ELSE NULL END AS cost_per_lead
          FROM meta_ads_campaigns c LEFT JOIN meta_ads_insights i ON c.campaign_id=i.campaign_id AND i.tenant_id = c.tenant_id
          WHERE c.tenant_id = $1
          GROUP BY c.name ORDER BY spend DESC LIMIT 10
        `, [user.tenant_id]);
        aiInsight = await generateMetaAdsInsight(freshCampaigns.rows);
      } catch (aiErr) {
        console.warn('⚠️ AI insight generation failed:', aiErr.message);
      }
    }

    console.log(`📊 Meta Ads sync: ${synced} campanhas sincronizadas`);
    res.json({ success: true, synced, ai_insight: aiInsight });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (err.code === '42703') return res.status(503).json({ error: META_ADS_MIGRATION_MSG });
    console.error('Meta Ads sync error:', err);
    res.status(500).json({ error: err?.code === '23505' ? 'Esta conta ou campanha já está sendo sincronizada. Tente de novo em instantes.' : 'Erro interno ao processar o Meta Ads' });
  }
});

// GET /api/ai/meta-ads/insight — generate AI insight on demand
app.get('/api/ai/meta-ads/insight', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica' });

    const campaignsResult = await pool.query(`
      SELECT c.name, COALESCE(SUM(i.spend),0) AS spend, COALESCE(SUM(i.impressions),0) AS impressions,
        COALESCE(SUM(i.clicks),0) AS clicks,
        CASE WHEN SUM(i.impressions)>0 THEN ROUND(SUM(i.clicks)::numeric/SUM(i.impressions)*100,2) ELSE 0 END AS ctr,
        COALESCE(SUM(i.leads),0) AS leads,
        CASE WHEN SUM(i.leads)>0 THEN ROUND(SUM(i.spend)/SUM(i.leads),2) ELSE NULL END AS cost_per_lead
      FROM meta_ads_campaigns c LEFT JOIN meta_ads_insights i ON c.campaign_id=i.campaign_id AND i.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1
      GROUP BY c.name ORDER BY spend DESC LIMIT 10
    `, [user.tenant_id]);

    if (campaignsResult.rows.length === 0) {
      return res.json({ insight: 'Nenhuma campanha encontrada. Sincronize os dados primeiro.' });
    }

    const insight = await generateMetaAdsInsight(campaignsResult.rows);
    res.json({ insight: insight || 'Não foi possível gerar análise. Verifique a API key da OpenAI.' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (err.code === '42703') return res.status(503).json({ error: META_ADS_MIGRATION_MSG });
    console.error('Meta Ads insight error:', err);
    res.status(500).json({ error: err?.code === '23505' ? 'Esta conta ou campanha já está sendo sincronizada. Tente de novo em instantes.' : 'Erro interno ao processar o Meta Ads' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CLINICORP INTEGRATION
import { registerClinicorp, reconciliationTick } from './clinicorp.mjs';
registerClinicorp(app, pool, { verifyUser });

// ── Per-user Clinicorp credentials (SaaS multi-tenant) ─────────
// Each authenticated user has their own row in clinicorp_user_settings.
// O middleware de /api/clinicorp (registerClinicorp) já verificou o token e
// preencheu req.clinicorpUser; cada usuário só lê/grava a própria linha.
const CLINICORP_DEFAULT_BASE_URL = 'https://api.clinicorp.com/rest/v1';
async function clinicorpUserOf(req) {
  if (req.clinicorpUser) return req.clinicorpUser;
  const { user } = await verifyUser(req);
  return user;
}

app.get('/api/clinicorp/my-settings', async (req, res) => {
  let user;
  try { user = await clinicorpUserOf(req); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }
  try {
    const { rows } = await pool.query(
      `SELECT enabled, subscriber_id, base_url,
              api_token IS NOT NULL AND api_token <> '' AS has_api_token,
              webhook_secret IS NOT NULL AND webhook_secret <> '' AS has_webhook_secret,
              CASE WHEN webhook_secret IS NOT NULL AND length(webhook_secret) >= 8
                   THEN substring(webhook_secret from 1 for 4) || '…' || substring(webhook_secret from length(webhook_secret) - 3)
                   ELSE '' END AS webhook_secret_preview,
              last_sync_at, last_sync_status, last_sync_error, sync_progress, updated_at
         FROM clinicorp_user_settings WHERE user_id = $1`,
      [user.id]
    );
    const s = rows[0] || {};
    res.json({
      enabled: s.enabled ?? false,
      subscriber_id: s.subscriber_id || '',
      base_url: s.base_url || CLINICORP_DEFAULT_BASE_URL,
      has_api_token: Boolean(s.has_api_token),
      has_webhook_secret: Boolean(s.has_webhook_secret),
      webhook_secret_preview: s.webhook_secret_preview || '',
      last_sync_at: s.last_sync_at || null,
      last_sync_status: s.last_sync_status || null,
      last_sync_error: s.last_sync_error || null,
      sync_progress: s.sync_progress || null,
      updated_at: s.updated_at || null,
      is_super_admin: Boolean(user.is_super_admin),
    });
  } catch (e) {
    console.error('[clinicorp my-settings GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/clinicorp/my-settings', async (req, res) => {
  let user;
  try { user = await clinicorpUserOf(req); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }
  try {
    const { enabled, api_token, subscriber_id, webhook_secret, base_url } = req.body || {};

    // Validation
    if (subscriber_id !== undefined && subscriber_id !== null && subscriber_id !== '') {
      if (typeof subscriber_id !== 'string' || subscriber_id.length > 128) {
        return res.status(400).json({ error: 'subscriber_id inválido (máx 128 chars)' });
      }
    }
    if (base_url !== undefined && base_url !== null && base_url !== '') {
      try { new URL(base_url); } catch { return res.status(400).json({ error: 'base_url inválida' }); }
    }
    if (api_token !== undefined && api_token !== '' && api_token !== null) {
      if (typeof api_token !== 'string' || api_token.length < 8 || api_token.length > 2048) {
        return res.status(400).json({ error: 'api_token inválido (8–2048 chars)' });
      }
    }
    if (webhook_secret !== undefined && webhook_secret !== '' && webhook_secret !== null) {
      if (typeof webhook_secret !== 'string' || webhook_secret.length < 8 || webhook_secret.length > 256) {
        return res.status(400).json({ error: 'webhook_secret inválido (8–256 chars)' });
      }
    }

    await pool.query(
      `INSERT INTO clinicorp_user_settings (user_id, enabled, api_token, subscriber_id, webhook_secret, base_url, updated_at)
       VALUES ($1, COALESCE($2, FALSE), NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), COALESCE(NULLIF($6, ''), '${CLINICORP_DEFAULT_BASE_URL}'), NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = COALESCE($2, clinicorp_user_settings.enabled),
         api_token = COALESCE(NULLIF($3, ''), clinicorp_user_settings.api_token),
         subscriber_id = COALESCE(NULLIF($4, ''), clinicorp_user_settings.subscriber_id),
         webhook_secret = COALESCE(NULLIF($5, ''), clinicorp_user_settings.webhook_secret),
         base_url = COALESCE(NULLIF($6, ''), clinicorp_user_settings.base_url),
         updated_at = NOW()`,
      [
        user.id,
        typeof enabled === 'boolean' ? enabled : null,
        typeof api_token === 'string' ? api_token.trim().replace(/^Bearer\s+/i, '') : '',
        typeof subscriber_id === 'string' ? subscriber_id.trim() : '',
        webhook_secret ?? '',
        base_url ?? '',
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    // webhook_secret é usado para achar o tenant do webhook: precisa ser único.
    if (e.code === '23505') return res.status(409).json({ error: 'Este webhook secret já está em uso. Gere outro.' });
    console.error('[clinicorp my-settings PUT]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/clinicorp/my-settings', async (req, res) => {
  let user;
  try { user = await clinicorpUserOf(req); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }
  try {
    await pool.query('DELETE FROM clinicorp_user_settings WHERE user_id = $1', [user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Test connection (validates credentials BEFORE saving) ──────
// Uses credentials from the request body if provided, otherwise falls back
// to the saved per-user settings. Returns per-endpoint diagnostics.
const clinicorpTestCooldowns = new Map();

function getClinicorpTestCooldownSeconds(settings) {
  const cooldownKey = `${settings.base_url}|${settings.subscriber_id}`;
  const cooldownUntil = clinicorpTestCooldowns.get(cooldownKey) || 0;
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

function setClinicorpTestCooldown(settings, retryAfterSeconds) {
  const cooldownKey = `${settings.base_url}|${settings.subscriber_id}`;
  const waitSeconds = Math.min(Math.max(Number(retryAfterSeconds) || 60, 60), 60 * 60);
  clinicorpTestCooldowns.set(cooldownKey, Date.now() + waitSeconds * 1000);
  return waitSeconds;
}

app.post('/api/clinicorp/my-settings/test', async (req, res) => {
  let user;
  try { user = await clinicorpUserOf(req); }
  catch { return res.status(401).json({ ok: false, error: 'Unauthorized' }); }
  try {
    let { api_token, subscriber_id, base_url } = req.body || {};

    if (!api_token || !subscriber_id) {
      const { rows } = await pool.query(
        'SELECT api_token, subscriber_id, base_url FROM clinicorp_user_settings WHERE user_id = $1',
        [user.id]
      );
      const saved = rows[0] || {};
      api_token = api_token || saved.api_token;
      subscriber_id = subscriber_id || saved.subscriber_id;
      base_url = base_url || saved.base_url;
    }
    base_url = base_url || CLINICORP_DEFAULT_BASE_URL;
    const emptyResult = { total_latency_ms: 0, base_url, subscriber_id: subscriber_id || '', results: [] };

    if (!api_token) return res.json({ ok: false, auth: 'invalid_token', error: 'Informe o API Token', ...emptyResult });
    if (!subscriber_id) return res.json({ ok: false, auth: 'invalid_token', error: 'Informe o Subscriber ID', ...emptyResult });
    try { new URL(base_url); } catch { return res.status(400).json({ ok: false, error: 'URL base inválida' }); }

    const settings = { api_token, subscriber_id, base_url };

    const cooldownSeconds = getClinicorpTestCooldownSeconds(settings);
    if (cooldownSeconds > 0) {
      return res.json({
        ok: false,
        auth: 'rate_limited',
        rate_limited: true,
        retry_after_seconds: cooldownSeconds,
        error: `A Clinicorp limitou temporariamente as chamadas desta integração. Aguarde ${Math.ceil(cooldownSeconds / 60)} min antes de testar de novo.`,
        ...emptyResult,
      });
    }

    // Um endpoint (da spec oficial) por módulo, em sequência com pausa curta
    // para não acionar 429.
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const probes = [
      { key: 'clinics',       label: 'Clínicas',      path: '/business/list' },
      { key: 'appointments',  label: 'Agenda',        path: '/appointment/list',                    query: { from: dateStr, to: dateStr } },
      { key: 'professionals', label: 'Profissionais', path: '/professional/list_all_professionals' },
      { key: 'patients',      label: 'Pacientes',     path: '/patient/birthdays',                   query: { date: dateStr } },
      { key: 'estimates',     label: 'Orçamentos',    path: '/estimates/list',                      query: { from: dateStr, to: dateStr } },
      { key: 'financial',     label: 'Financeiro',    path: '/financial/list_invoices',             query: { from: dateStr, to: dateStr } },
    ];

    console.log(`[ClinicorpTest] user ${user.id} subscriber ${subscriber_id}`);
    const startedAt = Date.now();
    const results = [];
    for (const p of probes) {
      const t0 = Date.now();
      try {
        const data = await clinicorpFetchProbe(settings, p.path, { timeoutMs: 15_000, query: p.query });
        const list = Array.isArray(data) ? data : null;
        results.push({ ...p, ok: true, latency_ms: Date.now() - t0, count: list ? list.length : (data ? 1 : 0) });
      } catch (e) {
        results.push({
          ...p,
          ok: false,
          latency_ms: Date.now() - t0,
          status: e.status || null,
          error: e.message || 'timeout',
          retry_after_seconds: e.retryAfter ?? null,
        });
        // 401/403 (credencial) ou 429 (limite): as demais chamadas falhariam igual.
        if (e.status === 401 || e.status === 403 || e.status === 429) break;
      }
      await clinicorpProbeSleep(350);
    }

    const ok = results.length === probes.length && results.every((r) => r.ok);
    const rateLimit = results.find((r) => r.status === 429);
    const invalid = results.some((r) => r.status === 401 || r.status === 403);
    const auth = invalid ? 'invalid_token' : (rateLimit ? 'rate_limited' : (ok ? 'valid' : 'partial'));
    const retryAfterSeconds = rateLimit?.retry_after_seconds ?? null;
    if (rateLimit) setClinicorpTestCooldown(settings, retryAfterSeconds);
    else if (ok) clinicorpTestCooldowns.delete(`${settings.base_url}|${settings.subscriber_id}`);

    res.json({
      ok,
      auth,
      rate_limited: Boolean(rateLimit),
      retry_after_seconds: retryAfterSeconds,
      error: invalid
        ? 'Credenciais Clinicorp inválidas. Confira o Usuário API e o Token API em Gerenciar Assinatura → Acesso Externo e Integrações.'
        : rateLimit
          ? `A Clinicorp limitou temporariamente as chamadas desta integração. Aguarde ${Math.ceil((retryAfterSeconds || 60) / 60)} min antes de testar de novo.`
          : undefined,
      total_latency_ms: Date.now() - startedAt,
      base_url: settings.base_url,
      subscriber_id: settings.subscriber_id,
      results,
    });

    try {
      await pool.query(
        `INSERT INTO clinicorp_push_log (entity_type, local_id, clinicorp_id, action, status, payload, response, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        ['connection_test', user.id, subscriber_id, 'test', ok ? 'success' : 'error',
         JSON.stringify({ base_url: settings.base_url }), JSON.stringify({ ok, auth, results }), user.tenant_id || null]
      );
    } catch (auditErr) { console.error('[ClinicorpTest] audit log failed:', auditErr.message); }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

// Sincronização manual completa do usuário logado (única sincronização da
// integração — roda na VPS e grava nas tabelas que o app lê). O progresso fica
// em clinicorp_user_settings.sync_progress para a tela acompanhar.
app.post('/api/clinicorp/sync/now', async (req, res) => {
  let user;
  try { user = await clinicorpUserOf(req); }
  catch { return res.status(401).json({ error: 'Unauthorized' }); }
  try {
    if (!user.tenant_id) return res.status(403).json({ error: 'Usuário sem clínica (tenant) associada' });
    const { rows } = await pool.query(
      'SELECT enabled, api_token, subscriber_id, base_url FROM clinicorp_user_settings WHERE user_id = $1',
      [user.id]
    );
    const settings = rows[0];
    if (!settings || !settings.api_token || !settings.subscriber_id) {
      return res.status(400).json({ error: 'Configure as credenciais primeiro' });
    }
    if (settings.enabled === false) {
      return res.status(400).json({ error: 'Ative a sincronização Clinicorp antes de sincronizar' });
    }

    const normalizedSettings = { ...settings, base_url: settings.base_url || CLINICORP_DEFAULT_BASE_URL };
    const cooldownSeconds = getClinicorpTestCooldownSeconds(normalizedSettings);
    if (cooldownSeconds > 0) {
      return res.status(429).json({
        error: `Clinicorp em limite de chamadas. Aguarde ${Math.ceil(cooldownSeconds / 60)} min antes de sincronizar de novo.`,
        rate_limited: true,
        retry_after_seconds: cooldownSeconds,
      });
    }

    const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const { runFullSync } = await import('./clinicorp.mjs');
    const result = await runFullSync(pool, {
      api_token: normalizedSettings.api_token,
      subscriber_id: normalizedSettings.subscriber_id,
      base_url: normalizedSettings.base_url,
      tenant_id: user.tenant_id,
      user_id: user.id,
      from: isDate(req.body?.from) ? req.body.from : undefined,
      to: isDate(req.body?.to) ? req.body.to : undefined,
      force_metadata: req.body?.force_metadata === true,
    });
    res.json(result);
  } catch (e) {
    console.error('[clinicorp manual sync error]', e.message);
    if (e.invalidCredentials) return res.status(400).json({ error: e.message, auth: 'invalid_token' });
    const retryAfterSeconds = Number(e.retry_after_seconds ?? e.retryAfter);
    if (e.status === 429 || /HTTP 429|rate limit/i.test(String(e.message || ''))) {
      return res.status(429).json({
        error: e.message,
        rate_limited: true,
        retry_after_seconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
      });
    }
    if (/sincronização em andamento/i.test(String(e.message || ''))) return res.status(409).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// Probe leve para o teste de conexão (sem a fila/pausa global do sync).
// A Clinicorp só aceita HTTP Basic (Usuário API : Token API); o token nunca
// vai na URL.
async function clinicorpFetchProbe(settings, pathName, opts = {}) {
  const base = (settings.base_url || CLINICORP_DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = new URL(base + pathName);
  const apiUser = String(settings.subscriber_id || '').trim();
  const apiToken = String(settings.api_token || '').trim().replace(/^Bearer\s+/i, '');
  url.searchParams.set('subscriber_id', apiUser);
  for (const [k, v] of Object.entries(opts.query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs || 45_000);
  try {
    const r = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${apiUser}:${apiToken}`).toString('base64')}`,
      },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (r.status === 429) {
      const retryAfter = Number(r.headers.get('retry-after'));
      const err = new Error(`HTTP 429 (rate limited by Clinicorp${Number.isFinite(retryAfter) ? `, retry-after ${retryAfter}s` : ''})`);
      err.status = 429;
      err.retryAfter = Number.isFinite(retryAfter) ? retryAfter : null;
      throw err;
    }
    if (!r.ok) {
      const msg = data && typeof data === 'object' && 'message' in data ? String(data.message) : (typeof data === 'string' ? data.slice(0, 200) : '');
      const err = new Error(`HTTP ${r.status}${msg ? `: ${msg}` : ''}`);
      err.status = r.status;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('timeout');
      err.status = null;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

const clinicorpProbeSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════════
// MÓDULO EXAMES (Cfaz) — Pedidos de exames de imagem odontológica
// ═══════════════════════════════════════════════════════════════

// Listar tipos de exame do tenant
const EXAME_STATUS = ['novo', 'em_andamento', 'aguardando_laudo', 'concluido', 'entregue', 'cancelado'];
const EXAME_PRIORIDADE = ['baixa', 'normal', 'alta', 'urgente'];
const EXAME_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resposta de erro do módulo de exames: 401 para sessão inválida, 500 genérico
// (sem repassar a mensagem do banco) para o resto. Nada de dado do paciente no log.
function responderErroExame(res, err, tag) {
  if (err?.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
  console.error(`[${tag}]`, err?.message);
  return res.status(500).json({ error: 'Erro interno ao processar o exame' });
}

// Confere status/prioridade/tipo enviados pelo cliente antes de gravar.
// Devolve a mensagem para 400 ou null.
async function validarCamposExame(tenantId, body) {
  if (body.status !== undefined && body.status !== null && !EXAME_STATUS.includes(body.status)) return 'Status inválido';
  if (body.prioridade !== undefined && body.prioridade !== null && !EXAME_PRIORIDADE.includes(body.prioridade)) return 'Prioridade inválida';
  if (body.tipo_exame_id) {
    if (!EXAME_UUID_RE.test(String(body.tipo_exame_id))) return 'Tipo de exame não encontrado';
    const { rows } = await pool.query('SELECT 1 FROM exame_tipos WHERE id = $1 AND tenant_id = $2', [body.tipo_exame_id, tenantId]);
    if (!rows.length) return 'Tipo de exame não encontrado';
  }
  if (body.valor !== undefined && body.valor !== null && body.valor !== '' && !(Number.isFinite(Number(body.valor)) && Number(body.valor) >= 0)) return 'Valor inválido';
  for (const campo of ['data_realizacao', 'data_entrega']) {
    const v = body[campo];
    if (v !== undefined && v !== null && v !== '' && Number.isNaN(Date.parse(String(v)))) return 'Data inválida';
  }
  return validarReferenciasDoTenant(tenantId, {
    pacienteId: body.paciente_id, dentistaId: body.dentista_solicitante_id,
  });
}

app.get('/api/exame-tipos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.json([]);
    const { rows } = await pool.query(
      `SELECT id, nome, categoria, codigo_tiss, preco, ativo
         FROM exame_tipos
        WHERE tenant_id = $1
        ORDER BY categoria NULLS LAST, nome`,
      [user.tenant_id]
    );
    res.json(rows);
  } catch (err) {
    responderErroExame(res, err, 'exame-tipos:list');
  }
});

app.post('/api/exame-tipos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const { nome, categoria, codigo_tiss, preco, ativo } = req.body || {};
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    if (preco !== undefined && preco !== null && preco !== '' && !(Number.isFinite(Number(preco)) && Number(preco) >= 0)) {
      return res.status(400).json({ error: 'Preço inválido' });
    }
    const { rows } = await pool.query(
      `INSERT INTO exame_tipos (tenant_id, nome, categoria, codigo_tiss, preco, ativo)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,true))
       ON CONFLICT (tenant_id, nome) DO UPDATE
         SET categoria=EXCLUDED.categoria,
             codigo_tiss=EXCLUDED.codigo_tiss,
             preco=EXCLUDED.preco,
             ativo=EXCLUDED.ativo
       RETURNING *`,
      [user.tenant_id, nome.trim(), categoria || null, codigo_tiss || null, preco || 0, ativo]
    );
    res.json(rows[0]);
  } catch (err) {
    responderErroExame(res, err, 'exame-tipos:post');
  }
});

app.delete('/api/exame-tipos/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    if (!EXAME_UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Tipo de exame não encontrado' });
    // Os exames já pedidos guardam o nome (tipo_nome) e ficam com tipo_exame_id NULL (FK SET NULL).
    const { rowCount } = await pool.query(
      `DELETE FROM exame_tipos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, user.tenant_id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Tipo de exame não encontrado' });
    res.json({ success: true });
  } catch (err) {
    responderErroExame(res, err, 'exame-tipos:delete');
  }
});

// Listar exames com filtros
app.get('/api/exames', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.json([]);
    const { status, paciente_id, q, from, to, terceirizado } = req.query;
    if (paciente_id && !EXAME_UUID_RE.test(String(paciente_id))) return res.json([]);
    if (status && !EXAME_STATUS.includes(String(status))) return res.status(400).json({ error: 'Status inválido' });
    if ((from && Number.isNaN(Date.parse(String(from)))) || (to && Number.isNaN(Date.parse(String(to))))) {
      return res.status(400).json({ error: 'Data inválida' });
    }
    const params = [user.tenant_id];
    const where = ['e.tenant_id = $1'];
    if (status)       { params.push(status);       where.push(`e.status = $${params.length}`); }
    if (paciente_id)  { params.push(paciente_id);  where.push(`e.paciente_id = $${params.length}`); }
    if (terceirizado != null) { params.push(terceirizado === 'true'); where.push(`e.terceirizado = $${params.length}`); }
    if (from) { params.push(from); where.push(`e.data_solicitacao >= $${params.length}`); }
    if (to)   { params.push(to);   where.push(`e.data_solicitacao <= $${params.length}`); }
    if (q)    {
      params.push(`%${q}%`);
      where.push(`(e.codigo ILIKE $${params.length} OR e.tipo_nome ILIKE $${params.length} OR p.nome ILIKE $${params.length})`);
    }
    const { rows } = await pool.query(
      `SELECT e.*,
              p.nome AS paciente_nome,
              d.nome AS dentista_nome,
              lp.name AS laudado_por_nome
         FROM exames e
         LEFT JOIN pacientes p ON p.id = e.paciente_id AND p.tenant_id = e.tenant_id
         LEFT JOIN dentistas d ON d.id = e.dentista_solicitante_id AND d.tenant_id = e.tenant_id
         LEFT JOIN profiles lp ON lp.id = e.laudado_por AND lp.tenant_id = e.tenant_id
        WHERE ${where.join(' AND ')}
        ORDER BY e.data_solicitacao DESC
        LIMIT 500`,
      params
    );
    // Contagem de imagens por exame em consulta separada: se a tabela ainda não existir
    // (primeiros segundos do boot, antes da auto-migração), a lista continua funcionando.
    if (rows.length) {
      try {
        const { rows: cont } = await pool.query(
          `SELECT exame_id, COUNT(*)::int AS total FROM exame_arquivos
            WHERE tenant_id = $1 AND exame_id = ANY($2::uuid[]) AND removido_em IS NULL
            GROUP BY exame_id`,
          [user.tenant_id, rows.map(r => r.id)]
        );
        const porExame = new Map(cont.map(c => [c.exame_id, c.total]));
        for (const r of rows) r.arquivos_count = porExame.get(r.id) || 0;
      } catch (e) {
        console.warn('[exames:list] contagem de arquivos indisponível:', e.message);
      }
    }
    res.json(rows);
  } catch (err) {
    responderErroExame(res, err, 'exames:list');
  }
});

app.get('/api/exames/stats', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.json({});
    const { rows } = await pool.query(
      `SELECT status, COUNT(*)::int AS total
         FROM exames WHERE tenant_id=$1 GROUP BY status`,
      [user.tenant_id]
    );
    const stats = { novo:0, em_andamento:0, aguardando_laudo:0, concluido:0, entregue:0, cancelado:0, total:0 };
    for (const r of rows) { stats[r.status] = r.total; stats.total += r.total; }
    res.json(stats);
  } catch (err) {
    responderErroExame(res, err, 'exames:stats');
  }
});

app.post('/api/exames', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const body = req.body || {};
    const {
      paciente_id, dentista_solicitante_id, clinica_origem,
      tipo_exame_id, tipo_nome, prioridade, valor, modo_entrega,
      observacoes, terceirizado, fornecedor_terc, status
    } = body;
    if (!tipo_nome?.trim()) return res.status(400).json({ error: 'tipo_nome obrigatório' });
    const campoErro = await validarCamposExame(user.tenant_id, body);
    if (campoErro) return res.status(400).json({ error: campoErro });

    // Gera código sequencial simples por tenant
    const { rows: [{ next_code }] } = await pool.query(
      `SELECT 'EX-' || LPAD((COALESCE(MAX(SUBSTRING(codigo FROM '[0-9]+')::int),0)+1)::text, 6, '0') AS next_code
         FROM exames WHERE tenant_id=$1 AND codigo ~ '^EX-[0-9]+$'`,
      [user.tenant_id]
    );

    const { rows } = await pool.query(
      `INSERT INTO exames
         (tenant_id, codigo, paciente_id, dentista_solicitante_id, clinica_origem,
          tipo_exame_id, tipo_nome, status, prioridade, valor, modo_entrega,
          observacoes, terceirizado, fornecedor_terc, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'novo'),COALESCE($9,'normal'),
               COALESCE($10,0),$11,$12,COALESCE($13,false),$14,$15)
       RETURNING *`,
      [
        user.tenant_id, next_code,
        paciente_id || null, dentista_solicitante_id || null, clinica_origem || null,
        tipo_exame_id || null, tipo_nome.trim(),
        status || null, prioridade || null, valor === '' ? null : valor, modo_entrega || null,
        observacoes || null, terceirizado, fornecedor_terc || null, user.id
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    responderErroExame(res, err, 'exames:create');
  }
});

app.patch('/api/exames/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    if (!EXAME_UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Exame não encontrado' });
    const body = req.body || {};
    const allowed = ['status','prioridade','valor','modo_entrega','laudo_texto','arquivo_url',
                     'observacoes','terceirizado','fornecedor_terc','data_realizacao','data_entrega',
                     'paciente_id','dentista_solicitante_id','clinica_origem','tipo_exame_id','tipo_nome'];
    // tipo_nome é NOT NULL: vazio apagaria o nome do exame (o banco recusaria com erro 500)
    if (body.tipo_nome !== undefined && !String(body.tipo_nome ?? '').trim()) {
      return res.status(400).json({ error: 'tipo_nome obrigatório' });
    }
    const sets = []; const params = [];
    for (const k of allowed) {
      if (body[k] !== undefined) {
        // '' vira NULL nos campos opcionais (o banco recusaria '' em uuid/data/número)
        const v = body[k] === '' ? null : body[k];
        params.push(k === 'tipo_nome' ? String(v).trim() : v);
        sets.push(`${k}=$${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada a atualizar' });
    // arquivo_url é o link antigo (público). Só pode ser desvinculado; arquivo novo vai
    // por POST /api/exames/:id/arquivos (com dono e acesso autenticado).
    if (body.arquivo_url !== undefined && body.arquivo_url !== null && body.arquivo_url !== '') {
      return res.status(400).json({ error: 'Envie a imagem pelo botão de arquivos do exame' });
    }
    for (const k of ['status', 'prioridade', 'terceirizado']) {
      if (body[k] === null || body[k] === '') return res.status(400).json({ error: `${k} não pode ficar vazio` });
    }
    const campoErro = await validarCamposExame(user.tenant_id, body);
    if (campoErro) return res.status(400).json({ error: campoErro });
    if (body.updated_at_esperado != null && Number.isNaN(Date.parse(String(body.updated_at_esperado)))) {
      return res.status(400).json({ error: 'updated_at_esperado inválido' });
    }
    // Texto de laudo só é gravado contra a versão que a pessoa estava vendo
    if (body.laudo_texto !== undefined && body.updated_at_esperado == null) {
      return res.status(400).json({ error: 'updated_at_esperado obrigatório ao alterar o laudo' });
    }
    const { rows: atuais } = await pool.query(
      'SELECT laudo_texto, laudado_em, status FROM exames WHERE id = $1 AND tenant_id = $2',
      [req.params.id, user.tenant_id]
    );
    if (!atuais.length) return res.status(404).json({ error: 'Exame não encontrado' });
    const laudoMudou = body.laudo_texto !== undefined && (body.laudo_texto || null) !== (atuais[0].laudo_texto || null);
    const camposClinicos = EXAME_CAMPOS_CLINICOS.filter((k) => body[k] !== undefined);
    const statusMuda = body.status !== undefined && body.status !== atuais[0].status;
    // Laudo finalizado: texto e dados clínicos não mudam (reabrir antes); status só vai para Entregue
    if (atuais[0].laudado_em) {
      if (laudoMudou) return res.status(409).json({ error: 'Este laudo já foi finalizado. Use "Reabrir laudo" para corrigir.' });
      if (camposClinicos.length) return res.status(409).json({ error: 'Exame com laudo finalizado: paciente, tipo e datas não podem ser alterados. Reabra o laudo para corrigir.' });
      if (statusMuda && body.status !== 'entregue') return res.status(409).json({ error: 'Exame com laudo finalizado só pode passar para Entregue. Reabra o laudo para mudar o status.' });
    } else if (statusMuda && body.status === 'concluido') {
      return res.status(409).json({ error: 'Para concluir o exame, finalize o laudo.' });
    }
    // Mesma regra no UPDATE: se alguém finalizar entre a leitura e a gravação, nada muda
    const exigeNaoFinalizado = laudoMudou || camposClinicos.length > 0 || (statusMuda && body.status !== 'entregue');
    // "Concluído" só com laudo finalizado, também se alguém reabrir no meio
    const exigeFinalizado = statusMuda && body.status === 'concluido';
    if (laudoMudou) {
      params.push(user.id);
      sets.push(`laudo_atualizado_por=$${params.length}`, 'laudo_atualizado_em=NOW()');
    }
    params.push(req.params.id, user.tenant_id);
    let filtroVersao = '';
    // Duas pessoas editando o mesmo exame: quem salvar por último com versão velha recebe 409
    if (body.updated_at_esperado != null) {
      params.push(body.updated_at_esperado);
      filtroVersao = ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${params.length}::timestamptz)`;
    }
    const idIdx = body.updated_at_esperado != null ? params.length - 2 : params.length - 1;
    const { rows } = await pool.query(
      `UPDATE exames SET ${sets.join(', ')}
        WHERE id=$${idIdx} AND tenant_id=$${idIdx + 1}${filtroVersao}${exigeNaoFinalizado ? ' AND laudado_em IS NULL' : ''}${exigeFinalizado ? ' AND laudado_em IS NOT NULL' : ''}
        RETURNING *`,
      params
    );
    if (!rows[0]) {
      if (filtroVersao || exigeNaoFinalizado || exigeFinalizado) return res.status(409).json({ error: 'Outra pessoa alterou este exame enquanto você editava. Feche e abra de novo para ver a versão atual.' });
      return res.status(404).json({ error: 'Exame não encontrado' });
    }
    res.json(rows[0]);
  } catch (err) {
    responderErroExame(res, err, 'exames:patch');
  }
});

// Campos clínicos travados depois que o laudo é finalizado
const EXAME_CAMPOS_CLINICOS = ['paciente_id', 'dentista_solicitante_id', 'tipo_exame_id', 'tipo_nome', 'data_realizacao'];
// Quem pode finalizar/reabrir laudo
const PODE_LAUDAR = (user) => ['admin', 'dentista'].includes(String(user?.role || ''));

// Histórico do laudo (cada finalização e reabertura, com o texto daquele momento)
app.get('/api/exames/:id/laudo/historico', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    if (!EXAME_UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Exame não encontrado' });
    const exame = await pool.query('SELECT 1 FROM exames WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    if (!exame.rows.length) return res.status(404).json({ error: 'Exame não encontrado' });
    const { rows } = await pool.query(
      `SELECT h.id, h.acao, h.laudo_texto, h.criado_em, pr.name AS autor_nome
         FROM exame_laudo_historico h
         LEFT JOIN profiles pr ON pr.id = h.autor_id AND pr.tenant_id = h.tenant_id
        WHERE h.exame_id = $1 AND h.tenant_id = $2
        ORDER BY h.criado_em DESC`,
      [req.params.id, user.tenant_id]
    );
    res.json(rows);
  } catch (err) {
    responderErroExame(res, err, 'exames:laudo:historico');
  }
});

// Um exame com nomes de paciente, solicitante, quem laudou e a clínica (tela de laudo e impressão)
app.get('/api/exames/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    if (!EXAME_UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Exame não encontrado' });
    const { rows } = await pool.query(
      `SELECT e.*,
              p.nome AS paciente_nome, to_char(p.data_nascimento, 'YYYY-MM-DD') AS paciente_data_nascimento,
              d.nome AS dentista_nome,
              lp.name AS laudado_por_nome,
              t.nome AS clinica_nome
         FROM exames e
         LEFT JOIN pacientes p ON p.id = e.paciente_id AND p.tenant_id = e.tenant_id
         LEFT JOIN dentistas d ON d.id = e.dentista_solicitante_id AND d.tenant_id = e.tenant_id
         LEFT JOIN profiles lp ON lp.id = e.laudado_por AND lp.tenant_id = e.tenant_id
         LEFT JOIN tenants t ON t.id = e.tenant_id
        WHERE e.id = $1 AND e.tenant_id = $2`,
      [req.params.id, user.tenant_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Exame não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    responderErroExame(res, err, 'exames:get');
  }
});

// Finalizar (assinar) o laudo: grava o texto, quem laudou e quando, e conclui o exame
app.post('/api/exames/:id/laudo/finalizar', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    if (!EXAME_UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Exame não encontrado' });
    if (!PODE_LAUDAR(user)) return res.status(403).json({ error: 'Só dentista ou administrador pode finalizar o laudo' });
    const texto = String(req.body?.laudo_texto ?? '').trim();
    if (!texto) return res.status(400).json({ error: 'Escreva o laudo antes de finalizar' });
    const esperado = req.body?.updated_at_esperado;
    if (esperado != null && Number.isNaN(Date.parse(String(esperado)))) return res.status(400).json({ error: 'updated_at_esperado inválido' });
    const params = [req.params.id, user.tenant_id, texto, user.id];
    let filtroVersao = '';
    if (esperado != null) {
      params.push(esperado);
      filtroVersao = ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $5::timestamptz)`;
    }
    // UPDATE e histórico na mesma instrução: ou os dois gravam, ou nenhum
    const { rows } = await pool.query(
      `WITH upd AS (
         UPDATE exames
            SET laudo_texto = $3, laudado_por = $4, laudado_em = NOW(),
                laudo_atualizado_por = $4, laudo_atualizado_em = NOW(),
                status = CASE WHEN status IN ('entregue') THEN status ELSE 'concluido' END,
                data_realizacao = COALESCE(data_realizacao, NOW())
          WHERE id = $1 AND tenant_id = $2 AND laudado_em IS NULL AND status <> 'cancelado'${filtroVersao}
          RETURNING *
       ), hist AS (
         INSERT INTO exame_laudo_historico (tenant_id, exame_id, acao, laudo_texto, autor_id)
         SELECT tenant_id, id, 'finalizado', laudo_texto, $4 FROM upd
       )
       SELECT * FROM upd`,
      params
    );
    if (!rows.length) {
      const { rows: atual } = await pool.query('SELECT status, laudado_em FROM exames WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
      if (!atual.length) return res.status(404).json({ error: 'Exame não encontrado' });
      if (atual[0].laudado_em) return res.status(409).json({ error: 'Este laudo já foi finalizado.' });
      if (atual[0].status === 'cancelado') return res.status(409).json({ error: 'Exame cancelado não pode ser laudado.' });
      return res.status(409).json({ error: 'Outra pessoa alterou este exame enquanto você editava. Feche e abra de novo para ver a versão atual.' });
    }
    res.json(rows[0]);
  } catch (err) {
    responderErroExame(res, err, 'exames:laudo:finalizar');
  }
});

// Reabrir um laudo finalizado para correção: volta para "aguardando laudo" (exame já entregue
// continua Entregue) e limpa a finalização; o texto finalizado fica no histórico
// (a última edição continua registrada em laudo_atualizado_por/em)
app.post('/api/exames/:id/laudo/reabrir', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    if (!EXAME_UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Exame não encontrado' });
    if (!PODE_LAUDAR(user)) return res.status(403).json({ error: 'Só dentista ou administrador pode reabrir o laudo' });
    // O texto finalizado fica guardado no histórico antes de a assinatura sair
    const { rows } = await pool.query(
      `WITH upd AS (
         UPDATE exames
            SET laudado_por = NULL, laudado_em = NULL,
                laudo_atualizado_por = $3, laudo_atualizado_em = NOW(),
                status = CASE WHEN status = 'concluido' THEN 'aguardando_laudo' ELSE status END
          WHERE id = $1 AND tenant_id = $2 AND laudado_em IS NOT NULL
          RETURNING *
       ), hist AS (
         INSERT INTO exame_laudo_historico (tenant_id, exame_id, acao, laudo_texto, autor_id)
         SELECT tenant_id, id, 'reaberto', laudo_texto, $3 FROM upd
       )
       SELECT * FROM upd`,
      [req.params.id, user.tenant_id, user.id]
    );
    if (!rows.length) {
      const { rows: atual } = await pool.query('SELECT 1 FROM exames WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
      if (!atual.length) return res.status(404).json({ error: 'Exame não encontrado' });
      return res.status(409).json({ error: 'Este laudo não está finalizado.' });
    }
    res.json(rows[0]);
  } catch (err) {
    responderErroExame(res, err, 'exames:laudo:reabrir');
  }
});

app.delete('/api/exames/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    if (!EXAME_UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: 'Exame não encontrado' });
    // Exame com laudo ou imagem é parte do prontuário (guarda mínima de 20 anos, Lei 13.787/2018):
    // não é apagado; a clínica cancela o exame. Só pedidos sem resultado podem ser excluídos.
    const { rows } = await pool.query(
      `SELECT (COALESCE(btrim(e.laudo_texto), '') <> '' OR e.arquivo_url IS NOT NULL
               OR EXISTS (SELECT 1 FROM exame_arquivos a WHERE a.exame_id = e.id AND a.tenant_id = e.tenant_id)) AS tem_resultado
         FROM exames e WHERE e.id=$1 AND e.tenant_id=$2`,
      [req.params.id, user.tenant_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Exame não encontrado' });
    if (rows[0].tem_resultado) {
      return res.status(409).json({ error: 'Este exame já tem laudo ou imagem e faz parte do prontuário. Em vez de excluir, mude o status para Cancelado.' });
    }
    // Arquivo retirado também conta: o DELETE em cascata apagaria o registro dele (prontuário)
    const { rowCount } = await pool.query(
      `DELETE FROM exames e WHERE e.id=$1 AND e.tenant_id=$2
          AND COALESCE(btrim(e.laudo_texto), '') = '' AND e.arquivo_url IS NULL
          AND NOT EXISTS (SELECT 1 FROM exame_arquivos a WHERE a.exame_id = e.id AND a.tenant_id = e.tenant_id)`,
      [req.params.id, user.tenant_id]
    );
    // Recebeu laudo/imagem entre a leitura e a exclusão: nada foi apagado
    if (!rowCount) return res.status(409).json({ error: 'O exame mudou enquanto você excluía. Atualize a lista e tente de novo.' });
    res.json({ success: true });
  } catch (err) {
    responderErroExame(res, err, 'exames:delete');
  }
});


// ─── Imagens e arquivos do exame (raio-x, tomografia, PDF do laudo) ───────────
// Dado de saúde (LGPD art. 11): ficam FORA de /uploads/media (que é público) e só
// são entregues a quem é da clínica — por Bearer ou por link assinado de vida curta
// (o <img> do navegador não manda Authorization). O banco guarda o dono (tenant_id).
const EXAMES_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'exames');
const EXAME_ARQUIVO_MAX_BYTES = 64 * 1024 * 1024;
const EXAME_ARQUIVO_LINK_TTL_S = 60 * 60; // 1 h
const EXAME_ARQUIVO_SECRET = process.env.MEDIA_SIGNING_SECRET
  || createHmac('sha256', String(JWT_SECRET || randomUUID())).update('exame-arquivos-v1').digest('hex');

// Tipo real pelo conteúdo (não confia no nome nem no Content-Type do cliente).
function detectarTipoArquivoExame(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg', imagem: true };
  if (hex.startsWith('89504e470d0a1a0a')) return { mime: 'image/png', ext: 'png', imagem: true };
  if (hex.startsWith('47494638')) return { mime: 'image/gif', ext: 'gif', imagem: true };
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp', imagem: true };
  if (hex.startsWith('424d')) return { mime: 'image/bmp', ext: 'bmp', imagem: true };
  if (hex.startsWith('25504446')) return { mime: 'application/pdf', ext: 'pdf', imagem: false };
  if (hex.startsWith('504b0304')) return { mime: 'application/zip', ext: 'zip', imagem: false };
  if (buf.length >= 132 && buf.subarray(128, 132).toString('latin1') === 'DICM') return { mime: 'application/dicom', ext: 'dcm', imagem: false };
  return null;
}

function assinarArquivoExame(arquivoId, tenantId, download = false) {
  const exp = Math.floor(Date.now() / 1000) + EXAME_ARQUIVO_LINK_TTL_S;
  const sig = createHmac('sha256', EXAME_ARQUIVO_SECRET).update(`${arquivoId}|${tenantId}|${exp}`).digest('hex');
  const base = `/api/exame-arquivos/${arquivoId}/conteudo?t=${tenantId}&exp=${exp}&sig=${sig}`;
  return download ? `${base}&download=1` : base;
}

function assinaturaArquivoExameValida(arquivoId, tenantId, exp, sig) {
  if (!EXAME_UUID_RE.test(String(tenantId || '')) || !/^\d{1,12}$/.test(String(exp || '')) || !/^[0-9a-f]{64}$/.test(String(sig || ''))) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const esperado = createHmac('sha256', EXAME_ARQUIVO_SECRET).update(`${arquivoId}|${tenantId}|${exp}`).digest();
  return timingSafeEqual(esperado, Buffer.from(String(sig), 'hex'));
}

function arquivoExameParaResposta(row) {
  return {
    id: row.id,
    exame_id: row.exame_id,
    nome_original: row.nome_original,
    mime_type: row.mime_type,
    tamanho_bytes: Number(row.tamanho_bytes) || 0,
    descricao: row.descricao ?? null,
    created_at: row.created_at,
    enviado_por_nome: row.enviado_por_nome ?? null,
    imagem: /^image\//.test(row.mime_type || ''),
    url: assinarArquivoExame(row.id, row.tenant_id),
    url_download: assinarArquivoExame(row.id, row.tenant_id, true),
  };
}

async function exameDaClinica(exameId, tenantId) {
  if (!EXAME_UUID_RE.test(String(exameId))) return null;
  const { rows } = await pool.query('SELECT id, paciente_id, status, laudado_em FROM exames WHERE id = $1 AND tenant_id = $2', [exameId, tenantId]);
  return rows[0] || null;
}

// Listar imagens/arquivos de um exame (com links assinados)
app.get('/api/exames/:id/arquivos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const exame = await exameDaClinica(req.params.id, user.tenant_id);
    if (!exame) return res.status(404).json({ error: 'Exame não encontrado' });
    const { rows } = await pool.query(
      `SELECT a.*, pr.name AS enviado_por_nome
         FROM exame_arquivos a
         LEFT JOIN profiles pr ON pr.id = a.enviado_por AND pr.tenant_id = a.tenant_id
        WHERE a.exame_id = $1 AND a.tenant_id = $2 AND a.removido_em IS NULL
        ORDER BY a.created_at`,
      [exame.id, user.tenant_id]
    );
    res.json(rows.map(arquivoExameParaResposta));
  } catch (err) {
    responderErroExame(res, err, 'exames:arquivos:list');
  }
});

// Enviar imagem/arquivo para o exame. Corpo = bytes do arquivo; nome em X-Nome-Arquivo
// (codificado, fora da URL: o nome pode conter o nome do paciente).
app.post('/api/exames/:id/arquivos', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const exame = await exameDaClinica(req.params.id, user.tenant_id);
    if (!exame) return res.status(404).json({ error: 'Exame não encontrado' });
    // Laudo finalizado: imagens do exame não mudam sem reabrir
    if (exame.laudado_em) return res.status(409).json({ error: 'Laudo finalizado. Reabra o laudo para alterar as imagens.' });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'Arquivo não enviado' });
    if (buf.length > EXAME_ARQUIVO_MAX_BYTES) return res.status(413).json({ error: 'Arquivo maior que 64 MB' });
    const tipo = detectarTipoArquivoExame(buf);
    if (!tipo) return res.status(415).json({ error: 'Formato não aceito. Envie JPG, PNG, WEBP, GIF, BMP, PDF, DICOM (.dcm) ou ZIP.' });

    let nomeOriginal = '';
    try { nomeOriginal = decodeURIComponent(String(req.headers['x-nome-arquivo'] || '')); } catch { nomeOriginal = ''; }
    nomeOriginal = nomeOriginal.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 200) || `arquivo.${tipo.ext}`;
    const descricao = String(req.headers['x-descricao'] ? decodeURIComponent(String(req.headers['x-descricao'])) : '').trim().slice(0, 300) || null;

    const id = randomUUID();
    const subDir = user.tenant_id;
    const caminho = `${subDir}/${id}.${tipo.ext}`;
    const dir = path.join(EXAMES_UPLOADS_DIR, subDir);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const absArquivo = path.join(EXAMES_UPLOADS_DIR, caminho);
    await writeFile(absArquivo, buf);
    let rows;
    try {
      ({ rows } = await pool.query(
        `INSERT INTO exame_arquivos
           (id, tenant_id, exame_id, paciente_id, caminho, nome_original, mime_type, tamanho_bytes, descricao, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [id, user.tenant_id, exame.id, exame.paciente_id || null, caminho, nomeOriginal, tipo.mime, buf.length, descricao, user.id]
      ));
    } catch (insErr) {
      // Sem registro o arquivo nunca seria servido: não deixa órfão no disco
      await rm(absArquivo, { force: true }).catch(() => {});
      throw insErr;
    }
    // Chegou imagem: o exame foi realizado e passa a aguardar laudo
    await pool.query(
      `UPDATE exames SET status = 'aguardando_laudo', data_realizacao = COALESCE(data_realizacao, NOW())
        WHERE id = $1 AND tenant_id = $2 AND status IN ('novo', 'em_andamento')`,
      [exame.id, user.tenant_id]
    );
    res.json(arquivoExameParaResposta(rows[0]));
  } catch (err) {
    responderErroExame(res, err, 'exames:arquivos:upload');
  }
});

// Tirar o arquivo do exame. Não apaga do disco nem do banco: é prontuário
// (guarda de 20 anos); só some da tela. Fica registrado quem tirou e quando.
app.delete('/api/exames/:id/arquivos/:arquivoId', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    if (!EXAME_UUID_RE.test(String(req.params.id)) || !EXAME_UUID_RE.test(String(req.params.arquivoId))) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    const exame = await exameDaClinica(req.params.id, user.tenant_id);
    if (!exame) return res.status(404).json({ error: 'Arquivo não encontrado' });
    if (exame.laudado_em) return res.status(409).json({ error: 'Laudo finalizado. Reabra o laudo para alterar as imagens.' });
    const { rowCount } = await pool.query(
      `UPDATE exame_arquivos a SET removido_em = NOW(), removido_por = $4
        WHERE a.id = $1 AND a.exame_id = $2 AND a.tenant_id = $3 AND a.removido_em IS NULL
          AND NOT EXISTS (SELECT 1 FROM exames e WHERE e.id = a.exame_id AND e.tenant_id = a.tenant_id AND e.laudado_em IS NOT NULL)`,
      [req.params.arquivoId, req.params.id, user.tenant_id, user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Arquivo não encontrado' });
    res.json({ success: true });
  } catch (err) {
    responderErroExame(res, err, 'exames:arquivos:delete');
  }
});

// Entregar o conteúdo: link assinado (t/exp/sig) OU Bearer da mesma clínica.
app.get('/api/exame-arquivos/:arquivoId/conteudo', async (req, res) => {
  try {
    const arquivoId = String(req.params.arquivoId);
    if (!EXAME_UUID_RE.test(arquivoId)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    let tenantId = null;
    if (req.query.sig) {
      if (!assinaturaArquivoExameValida(arquivoId, req.query.t, req.query.exp, req.query.sig)) {
        return res.status(403).json({ error: 'Link expirado ou inválido. Abra o exame de novo.' });
      }
      tenantId = String(req.query.t);
    } else {
      const { user } = await verifyUser(req);
      if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
      tenantId = user.tenant_id;
    }
    const { rows } = await pool.query(
      `SELECT caminho, nome_original, mime_type FROM exame_arquivos
        WHERE id = $1 AND tenant_id = $2 AND removido_em IS NULL`,
      [arquivoId, tenantId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const { caminho, nome_original, mime_type } = rows[0];
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(caminho)) return res.status(404).json({ error: 'Arquivo não encontrado' });
    const abs = path.join(EXAMES_UPLOADS_DIR, caminho);
    if (!existsSync(abs)) return res.status(404).json({ error: 'Arquivo não encontrado' });

    const inline = req.query.download !== '1' && (/^image\//.test(mime_type) || mime_type === 'application/pdf');
    const nomeSeguro = String(nome_original || 'arquivo').replace(/["\\\r\n]/g, '');
    const nomeAscii = nomeSeguro.normalize('NFD').replace(/[^\x20-\x7e]/g, '') || 'arquivo';
    res.setHeader('Content-Type', mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(nomeSeguro)}`);
    // PDF pode ter JavaScript embutido: abre isolado, sem acesso à origem da API
    if (!/^image\//.test(mime_type)) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.sendFile(abs, { headers: { 'Content-Type': mime_type } }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Arquivo não encontrado' });
    });
  } catch (err) {
    responderErroExame(res, err, 'exames:arquivos:conteudo');
  }
});

// ═══════════════════════════════════════════════════════════════
// START SERVER

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, async () => {
  console.log(`🦷 Odonto Connect API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Webhook URL: ${WEBHOOK_URL}`);
  console.log(`   Clinicorp webhook: ${APP_URL}/api/webhook/clinicorp?user_api=<secret>`);

  // ─── Auto-migration: ensure required columns/tables exist ───
  let checkedStatements = 0;
  try {
    const migrations = [
      // ─── 0. Enable RLS and tenant session support ───
      `CREATE OR REPLACE FUNCTION set_tenant(t_id UUID) RETURNS VOID AS $$
       BEGIN
         PERFORM set_config('app.current_tenant_id', t_id::text, false);
       END;
       $$ LANGUAGE plpgsql;`,

      // ─── 1. Basic Profiles & Auth ───
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`,
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT`,
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT false`,
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,
      
      // ─── 2. Operational Tables ───
      `CREATE TABLE IF NOT EXISTS attendance_queues (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        color TEXT DEFAULT '#3B82F6',
        icon TEXT DEFAULT '📋',
        description TEXT,
        whatsapp_button_label TEXT,
        contact_numbers JSONB DEFAULT '[]',
        team_member_ids JSONB DEFAULT '[]',
        active BOOLEAN DEFAULT true,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `ALTER TABLE attendance_queues ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS idx_attendance_queues_tenant ON attendance_queues(tenant_id)`, 
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS queue_id UUID`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS queue_name TEXT`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS awaiting_queue_selection BOOLEAN DEFAULT false`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,

      `CREATE TABLE IF NOT EXISTS user_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        UNIQUE (user_id, role)
      )`,

      `CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        lead_id TEXT,
        content TEXT,
        sender TEXT,
        type TEXT DEFAULT 'text',
        status TEXT DEFAULT 'sent',
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        media_url TEXT,
        file_name TEXT,
        mime_type TEXT,
        reply_to_id TEXT,
        reply_to_content TEXT,
        reply_to_sender TEXT,
        attendant_id UUID,
        attendant_name TEXT,
        instance TEXT,
        phone TEXT,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        metadata JSONB DEFAULT '{}'
      )`,

      `CREATE TABLE IF NOT EXISTS attendance_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id TEXT NOT NULL,
        lead_name TEXT,
        lead_phone TEXT,
        attendant_id UUID REFERENCES profiles(id),
        attendant_name TEXT,
        queue_id TEXT,
        queue_name TEXT,
        started_waiting_at TIMESTAMPTZ,
        assigned_at TIMESTAMPTZ,
        first_response_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ,
        status TEXT DEFAULT 'waiting',
        wait_time_seconds INTEGER,
        response_time_seconds INTEGER,
        duration_seconds INTEGER,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,

      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS lead_name TEXT`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS lead_phone TEXT`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS attendant_id UUID REFERENCES profiles(id)`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS attendant_name TEXT`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS queue_id TEXT`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS queue_name TEXT`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS started_waiting_at TIMESTAMPTZ`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'waiting'`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS wait_time_seconds INTEGER`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS response_time_seconds INTEGER`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER`,
      `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
      `CREATE INDEX IF NOT EXISTS idx_attendance_sessions_tenant ON attendance_sessions(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_attendance_sessions_open ON attendance_sessions(tenant_id, status, lead_id)`,
      `ALTER TABLE chat_read_status ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS idx_chat_read_status_tenant ON chat_read_status(tenant_id)`,
      `UPDATE attendance_sessions s SET tenant_id = l.tenant_id FROM crm_leads l WHERE s.tenant_id IS NULL AND l.id::text = s.lead_id AND l.tenant_id IS NOT NULL`,
      `UPDATE chat_read_status r SET tenant_id = l.tenant_id FROM crm_leads l WHERE r.tenant_id IS NULL AND l.id::text = r.lead_id AND l.tenant_id IS NOT NULL`,

      // Backfill tenant_id on legacy chat_messages tables created before multi-tenant
      `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_tenant ON chat_messages(tenant_id)`,
      `ALTER TABLE chat_messages NO FORCE ROW LEVEL SECURITY`,
      `ALTER TABLE crm_leads NO FORCE ROW LEVEL SECURITY`,
      `ALTER TABLE attendance_sessions NO FORCE ROW LEVEL SECURITY`,
      `ALTER TABLE whatsapp_instances NO FORCE ROW LEVEL SECURITY`,
      `ALTER TABLE chat_read_status NO FORCE ROW LEVEL SECURITY`,
      `UPDATE chat_messages cm
          SET tenant_id = l.tenant_id
         FROM crm_leads l
        WHERE cm.tenant_id IS NULL
          AND l.tenant_id IS NOT NULL
          AND (
            l.id::text = cm.lead_id
            OR (cm.phone IS NOT NULL AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(l.telefone, ''), ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || RIGHT(REGEXP_REPLACE(cm.phone, '\\D', '', 'g'), 11))
          )`,
      `UPDATE attendance_sessions s
          SET tenant_id = cm.tenant_id
         FROM chat_messages cm
        WHERE s.tenant_id IS NULL
          AND cm.tenant_id IS NOT NULL
          AND (
            cm.lead_id = s.lead_id
            OR (s.lead_phone IS NOT NULL AND cm.phone IS NOT NULL AND REGEXP_REPLACE(cm.phone, '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE(s.lead_phone, '\\D', '', 'g'), 11))
          )`,
      `UPDATE chat_messages cm
          SET tenant_id = s.tenant_id
         FROM attendance_sessions s
        WHERE cm.tenant_id IS NULL
          AND s.tenant_id IS NOT NULL
          AND (
            cm.lead_id = s.lead_id
            OR (s.lead_phone IS NOT NULL AND cm.phone IS NOT NULL AND REGEXP_REPLACE(cm.phone, '\\D', '', 'g') LIKE '%' || RIGHT(REGEXP_REPLACE(s.lead_phone, '\\D', '', 'g'), 11))
          )`,

      `CREATE TABLE IF NOT EXISTS pacientes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        cpf TEXT,
        telefone TEXT,
        email TEXT,
        data_nascimento DATE,
        sexo TEXT,
        convenio TEXT,
        endereco TEXT,
        observacoes TEXT,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS dentistas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        especialidade TEXT,
        cro TEXT,
        telefone TEXT,
        email TEXT,
        ativo BOOLEAN DEFAULT true,
        usar_horario_clinica BOOLEAN DEFAULT true,
        horarios JSONB,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,

      // ─── Exames (radiologia): tabelas base, depois de pacientes/dentistas (FKs). DDL igual ao de
      // migration-schema-alinhamento.sql (#39): quem rodar primeiro cria, o outro vira no-op. ───
      `CREATE TABLE IF NOT EXISTS exame_tipos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
        nome text NOT NULL,
        categoria text,
        codigo_tiss text,
        preco numeric(10,2) DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, nome)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_exame_tipos_tenant ON exame_tipos (tenant_id)`,
      `CREATE TABLE IF NOT EXISTS exames (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
        codigo text,
        paciente_id uuid REFERENCES pacientes(id) ON DELETE SET NULL,
        dentista_solicitante_id uuid REFERENCES dentistas(id) ON DELETE SET NULL,
        clinica_origem text,
        tipo_exame_id uuid REFERENCES exame_tipos(id) ON DELETE SET NULL,
        tipo_nome text NOT NULL,
        status text NOT NULL DEFAULT 'novo'
          CHECK (status IN ('novo','em_andamento','aguardando_laudo','concluido','entregue','cancelado')),
        prioridade text NOT NULL DEFAULT 'normal'
          CHECK (prioridade IN ('baixa','normal','alta','urgente')),
        data_solicitacao timestamptz NOT NULL DEFAULT now(),
        data_realizacao timestamptz,
        data_entrega timestamptz,
        valor numeric(10,2) DEFAULT 0,
        modo_entrega text,
        laudo_texto text,
        arquivo_url text,
        observacoes text,
        terceirizado boolean NOT NULL DEFAULT false,
        fornecedor_terc text,
        created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_exames_tenant ON exames (tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_exames_status ON exames (tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_exames_paciente ON exames (tenant_id, paciente_id)`,
      `CREATE INDEX IF NOT EXISTS idx_exames_data_solic ON exames (tenant_id, data_solicitacao DESC)`,
      // Função só é criada se faltar: se o deploy (postgres) já a criou, CREATE OR REPLACE
      // pela API falharia ("must be owner") e geraria aviso em todo boot
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'exames_touch_updated_at') THEN
           EXECUTE 'CREATE FUNCTION exames_touch_updated_at() RETURNS trigger AS $f$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $f$ LANGUAGE plpgsql';
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exames_updated' AND tgrelid = 'public.exames'::regclass) THEN
           CREATE TRIGGER trg_exames_updated BEFORE UPDATE ON exames FOR EACH ROW EXECUTE FUNCTION exames_touch_updated_at();
         END IF;
         IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_exame_tipos_updated' AND tgrelid = 'public.exame_tipos'::regclass) THEN
           CREATE TRIGGER trg_exame_tipos_updated BEFORE UPDATE ON exame_tipos FOR EACH ROW EXECUTE FUNCTION exames_touch_updated_at();
         END IF;
       END $$`,

      // ─── Exames: imagens/arquivos com dono (migration-exame-arquivos.sql) ───
      `CREATE TABLE IF NOT EXISTS exame_arquivos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        exame_id UUID NOT NULL REFERENCES exames(id) ON DELETE CASCADE,
        paciente_id UUID,
        caminho TEXT NOT NULL UNIQUE,
        nome_original TEXT,
        mime_type TEXT NOT NULL,
        tamanho_bytes BIGINT NOT NULL DEFAULT 0,
        descricao TEXT,
        enviado_por UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        removido_em TIMESTAMPTZ,
        removido_por UUID
      )`,
      `CREATE INDEX IF NOT EXISTS idx_exame_arquivos_tenant_exame ON exame_arquivos (tenant_id, exame_id)`,
      `CREATE INDEX IF NOT EXISTS idx_exame_arquivos_tenant_paciente ON exame_arquivos (tenant_id, paciente_id)`,

      // ─── Exames: autoria do laudo (migration-exames-laudo.sql) ───
      `ALTER TABLE exames ADD COLUMN IF NOT EXISTS laudado_por UUID`,
      `ALTER TABLE exames ADD COLUMN IF NOT EXISTS laudado_em TIMESTAMPTZ`,
      `ALTER TABLE exames ADD COLUMN IF NOT EXISTS laudo_atualizado_por UUID`,
      `ALTER TABLE exames ADD COLUMN IF NOT EXISTS laudo_atualizado_em TIMESTAMPTZ`,
      `CREATE TABLE IF NOT EXISTS exame_laudo_historico (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        exame_id UUID NOT NULL REFERENCES exames(id) ON DELETE CASCADE,
        acao TEXT NOT NULL CHECK (acao IN ('finalizado', 'reaberto')),
        laudo_texto TEXT,
        autor_id UUID,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_exame_laudo_historico_tenant_exame ON exame_laudo_historico (tenant_id, exame_id, criado_em DESC)`,

      `CREATE TABLE IF NOT EXISTS agendamentos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE,
        dentista_id UUID REFERENCES dentistas(id) ON DELETE CASCADE,
        data DATE NOT NULL,
        hora TEXT NOT NULL,
        duracao INTEGER DEFAULT 30,
        procedimento TEXT,
        status TEXT DEFAULT 'agendado',
        observacoes TEXT,
        tipo TEXT DEFAULT 'consulta',
        primeira_consulta BOOLEAN DEFAULT false,
        dia_inteiro BOOLEAN DEFAULT false,
        escopo TEXT DEFAULT 'dentista',
        categoria TEXT,
        categoria_cor TEXT,
        confirmacao_canal TEXT,
        confirmacao_quando TEXT,
        alerta_retorno_canal TEXT,
        alerta_retorno_quando TEXT,
        evento_titulo TEXT,
        sala TEXT,
        serie_id UUID,
        marcadores JSONB DEFAULT '[]'::jsonb,
        como_conheceu TEXT,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS financeiro (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
        descricao TEXT NOT NULL,
        valor NUMERIC(12,2) NOT NULL,
        data DATE NOT NULL,
        categoria TEXT,
        status TEXT DEFAULT 'pendente',
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS tratamentos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paciente_id UUID REFERENCES pacientes(id) ON DELETE CASCADE,
        dentista_id UUID REFERENCES dentistas(id) ON DELETE CASCADE,
        descricao TEXT NOT NULL,
        dente TEXT,
        valor NUMERIC(12,2) DEFAULT 0,
        status TEXT DEFAULT 'planejado',
        plano TEXT,
        observacoes TEXT,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS estoque (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        categoria TEXT,
        quantidade NUMERIC(12,2) DEFAULT 0,
        quantidade_minima NUMERIC(12,2) DEFAULT 0,
        unidade TEXT DEFAULT 'un',
        valor_unitario NUMERIC(12,2) DEFAULT 0,
        fornecedor TEXT,
        localizacao TEXT,
        validade DATE,
        lote TEXT,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,

      `CREATE TABLE IF NOT EXISTS whatsapp_instances (
        instance_name TEXT PRIMARY KEY,
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,

      // ─── 3. Apply RLS to all multi-tenant tables ───
      // Function to dynamically apply RLS to a table
      `CREATE OR REPLACE FUNCTION apply_tenant_rls(table_name TEXT) RETURNS VOID AS $$
       BEGIN
         EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
         EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', table_name);
         EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', table_name);
         EXECUTE format('CREATE POLICY tenant_isolation_policy ON %I USING (
           (current_setting(''app.is_super_admin'', true) = ''true'') OR 
           (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)
         ) WITH CHECK (
           (current_setting(''app.is_super_admin'', true) = ''true'') OR 
           (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)
         )', table_name);
       END;
       $$ LANGUAGE plpgsql;`,

      // Apply to all relevant tables
      `SELECT apply_tenant_rls(t) FROM unnest(ARRAY[
        'profiles', 'user_roles', 'chat_messages', 'pacientes', 'dentistas', 
        'agendamentos', 'financeiro', 'tratamentos', 'estoque', 'crm_leads', 'whatsapp_instances'
      ]) t;`,

      // ─── 4. Clinicorp Integration columns for local projection ───
      `ALTER TABLE dentistas ADD COLUMN IF NOT EXISTS clinicorp_professional_id TEXT`,
      `ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS clinicorp_patient_id TEXT`,
      `ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS last_clinicorp_sync_at TIMESTAMPTZ`,
      `ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS keep_local BOOLEAN DEFAULT false`,
      `ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS clinicorp_appointment_id TEXT`,
      `ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS last_clinicorp_sync_at TIMESTAMPTZ`,
      `ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS keep_local BOOLEAN DEFAULT false`,
      `CREATE TABLE IF NOT EXISTS orcamentos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID,
        paciente_id UUID,
        dentista_id UUID,
        valor NUMERIC(12,2) DEFAULT 0,
        status TEXT DEFAULT 'pendente',
        data TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS clinicorp_estimate_id TEXT`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS clinicorp_patient_id TEXT`,
      `ALTER TABLE clinicorp_financial_entries ADD COLUMN IF NOT EXISTS tenant_id UUID`,
      `ALTER TABLE clinicorp_monthly_summary ADD COLUMN IF NOT EXISTS tenant_id UUID`,
      `UPDATE clinicorp_financial_entries SET tenant_id = (SELECT tenant_id FROM profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1) WHERE tenant_id IS NULL`,
      `UPDATE clinicorp_monthly_summary SET tenant_id = (SELECT tenant_id FROM profiles WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1) WHERE tenant_id IS NULL`,
      `ALTER TABLE clinicorp_monthly_summary DROP CONSTRAINT IF EXISTS clinicorp_monthly_summary_source_period_month_business_id_key`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_clinicorp_monthly_summary_tenant_period ON clinicorp_monthly_summary(source, period_month, business_id, tenant_id)`,

      // ─── Aceite dos Termos de Uso / Política de Privacidade no cadastro da clínica ───
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS termos_versao TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS politica_versao TEXT`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS termos_aceitos_em TIMESTAMPTZ`,
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS termos_aceite_ip TEXT`,

      // ─── Consentimentos LGPD por paciente (art. 8º §2º: ônus da prova é do controlador) ───
      `CREATE TABLE IF NOT EXISTS consentimentos_pacientes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL DEFAULT get_current_tenant_id(),
        paciente_id TEXT NOT NULL,
        tipo TEXT NOT NULL,
        versao TEXT NOT NULL,
        texto TEXT NOT NULL,
        registrado_por UUID,
        registrado_por_email TEXT,
        ip_address TEXT,
        user_agent TEXT,
        aceito_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revogado_em TIMESTAMPTZ,
        revogado_por UUID
      )`,
      `CREATE INDEX IF NOT EXISTS idx_consentimentos_pacientes_lookup ON consentimentos_pacientes(tenant_id, paciente_id, tipo)`,
      `ALTER TABLE consentimentos_pacientes ENABLE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS tenant_isolation_policy ON consentimentos_pacientes`,
      `CREATE POLICY tenant_isolation_policy ON consentimentos_pacientes FOR ALL
         USING (is_super_admin() OR tenant_id = get_current_tenant_id())
         WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id())`
    ];

    for (const sql of migrations) {
      try {
        await pool.query(sql);
        checkedStatements++;
      } catch (migErr) {
        // 42701 = column already exists, 42P07 = relation already exists — both are fine
        if (!['42701', '42P07', '42723'].includes(migErr?.code)) {
          console.warn(`⚠️ Auto-migration warning on statement ${checkedStatements}: ${migErr.message.slice(0, 120)}`);
        }
      }
    }
    console.log(`   ✅ Auto-migration: ${checkedStatements}/${migrations.length} statements checked`);
  } catch (migErr) {
    console.error('❌ Auto-migration failed:', migErr.message);
    console.error(`   ↪ Auto-migration progress before failure: ${checkedStatements} statement(s) executed`);
  }

  // Auto-register webhook for all connected instances on startup
  try {
    const result = await evolutionFetch('/instance/fetchInstances');
    const instances = Array.isArray(result.data) ? result.data : [];
    // Todas as instâncias (não só as abertas): uma instância que reconecta
    // sozinha precisa já ter a URL com o token, senão o webhook dá 401.
    const names = instances.map(inst => inst.name || inst.instanceName).filter(n => n && isSafeInstanceName(n));
    (async () => {
      for (let i = 0; i < names.length; i += 5) {
        await Promise.all(names.slice(i, i + 5).map(n => registerWebhook(n).catch(() => null)));
      }
      if (names.length > 0) console.log(`   📡 Webhook registrado em ${names.length} instância(s)`);
    })().catch(err => console.error('⚠️ Webhook boot registration error:', err.message));
  } catch (err) {
    console.error('⚠️ Could not auto-register webhooks on startup:', err.message);
  }

  // Start auto-sync every 30 minutes
  asSystemJob(syncWhatsAppContacts)(); // Run once on startup
  syncInterval = setInterval(asSystemJob(syncWhatsAppContacts), 30 * 60 * 1000);
  console.log('   📇 Auto-sync de contatos WhatsApp ativo (a cada 30 min)');

  // Fila de envio do WhatsApp: garante o esquema e roda a cada 5 s
  // (o intervalo real entre mensagens é controlado por número dentro da fila)
  await asSystemJob(ensureWhatsAppQueueSchema)();
  await asSystemJob(ensureTenantConfigSchema)();
  asSystemJob(processAutomationJobs)();
  automationSchedulerInterval = setInterval(asSystemJob(processAutomationJobs), 5 * 1000);
  console.log('   🤖 Fila anti-bloqueio do WhatsApp ativa (ciclo de 5s)');

  // Start inactive patients cron (every 6h)
  asSystemJob(checkInactivePatientsTrigger)();
  automationCronInterval = setInterval(asSystemJob(checkInactivePatientsTrigger), 6 * 60 * 60 * 1000);
  console.log('   📅 Cron de pacientes inativos ativo (a cada 6h)');

  // Start solution triggers cron (every 2h)
  setTimeout(asSystemJob(processSolutionTriggers), 10000); // delay 10s to let DB settle
  solutionCronInterval = setInterval(asSystemJob(processSolutionTriggers), 2 * 60 * 60 * 1000);
  console.log('   🩺 Cron de soluções automáticas ativo (a cada 2h)');

  // Start campaign scheduler (every 60s)
  asSystemJob(processCampaignScheduler)();
  campaignSchedulerInterval = setInterval(asSystemJob(processCampaignScheduler), 60 * 1000);
  console.log('   📢 Campaign scheduler ativo (a cada 60s)');

  // Start appointment reminder cron (every 1h)
  asSystemJob(processAppointmentReminders)();
  appointmentReminderInterval = setInterval(asSystemJob(processAppointmentReminders), 60 * 60 * 1000);
  console.log('   🔔 Lembrete de consulta 24h ativo (a cada 1h)');

  // Clinicorp auto-reconciliation: tick a cada 60s, decide via DB se executa
  // (lock + next_sync_at em clinicorp_settings garantem idempotência e catch-up
  // automático após reinício/interrupção do servidor)
  // Clinicorp sync loop removed as requested by user. 
  // Automation should be triggered via individual user integration panel.
  console.log('   🦷 Clinicorp auto-reconcile ativo (tick a cada 60s, intervalo configurável em clinicorp_settings)');
  });
  server.timeout = 15 * 60 * 1000; // 15 minutes timeout for long-running sync operations
}


export { app, pool };
// Exportados só para os testes de jobs (tests/jobs-metricas-isolamento.test.js).
export { processSolutionTriggers, runWhatsAppJobHooks, ensureTenantConfigSchema, triggerFollowupAutomation };
export function clearTenantSettingsCacheForTests() { tenantSettingsCache.clear(); }

