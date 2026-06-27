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
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

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

// ─── Media File Storage ─────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'media');
// Ensure uploads directory exists
(async () => {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
    console.log('📁 Created media uploads directory:', UPLOADS_DIR);
  }
})();

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
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const JWT_EXPIRES_IN = '7d';

// ─── Supabase Auth Bridge ───────────────────────────────────
// Aceita access_tokens emitidos pela Supabase. Quando o token não é o
// legacy (HS256 com JWT_SECRET), validamos via REST /auth/v1/user e
// resolvemos o profile/tenant na tabela `profiles` via service role.
const SUPABASE_PUBLIC_URL_FALLBACK = 'https://ncgcwdwrkikfwbmvpunq.supabase.co';
const SUPABASE_PUBLIC_ANON_KEY_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jZ2N3ZHdya2lrZndibXZwdW5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzUwNzcsImV4cCI6MjA5NTMxMTA3N30.g6RhHAhsSiTQ0pA2yGXZ09j7I6zQu6QhqucUCMYZQe4';
const SUPABASE_URL = (process.env.SUPABASE_URL || SUPABASE_PUBLIC_URL_FALLBACK).replace(/\/$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLIC_ANON_KEY_FALLBACK;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BRIDGE_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
if (SUPABASE_BRIDGE_ENABLED) {
  console.log('🔐 Supabase auth bridge enabled →', SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ? '(service role)' : '(user token)');
} else {
  console.warn('⚠️ Supabase auth bridge disabled — set SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_PUBLISHABLE_KEY) no .env do VPS');
}

// Cache em memória: token → { user, exp }
const _supabaseUserCache = new Map();
const SUPABASE_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache for instance -> tenant_id mapping to avoid repeated DB hits in webhooks
const instanceToTenantCache = new Map();
const INSTANCE_TENANT_CACHE_TTL_MS = 5 * 60 * 1000;

function getCachedTenantId(instanceName) {
  const cached = instanceToTenantCache.get(instanceName);
  if (!cached) return null;

  // Backward compatible with older in-memory values during rolling restarts.
  if (typeof cached === 'string') return cached;

  if (cached.expiresAt && cached.expiresAt > Date.now()) return cached.tenantId;
  instanceToTenantCache.delete(instanceName);
  return null;
}

function setCachedTenantId(instanceName, tenantId) {
  if (!instanceName || !tenantId) return;
  instanceToTenantCache.set(instanceName, {
    tenantId,
    expiresAt: Date.now() + INSTANCE_TENANT_CACHE_TTL_MS,
  });
}

async function getTenantIdByInstance(instanceName) {
  if (!instanceName) return null;
  const cachedTenantId = getCachedTenantId(instanceName);
  if (cachedTenantId) return cachedTenantId;

  // 1. Try local DB
  try {
    const { rows } = await pool.query(
      'SELECT tenant_id FROM whatsapp_instances WHERE instance_name = $1 LIMIT 1',
      [instanceName]
    );
    if (rows[0]?.tenant_id) {
      setCachedTenantId(instanceName, rows[0].tenant_id);
      return rows[0].tenant_id;
    }
  } catch (err) {
    if (err.code !== '42P01') { // 42P01 = table does not exist
      console.error(`Error resolving tenant for instance ${instanceName}:`, err.message);
    }
  }

  // 2. Fallback to Supabase
  if (SUPABASE_BRIDGE_ENABLED) {
    try {
      const restAuthKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_instances?instance_name=eq.${instanceName}&select=tenant_id`,
        {
          headers: {
            apikey: restAuthKey,
            Authorization: `Bearer ${restAuthKey}`,
          },
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.[0]?.tenant_id) {
          setCachedTenantId(instanceName, data[0].tenant_id);
          return data[0].tenant_id;
        }
      }
    } catch (err) {
      console.error(`Supabase fallback failed for ${instanceName}:`, err.message);
    }
  }

  return null;
}

async function getFallbackTenantIdForIncomingMessage({ instanceName, phoneSuffix }) {
  const suffix = String(phoneSuffix || '').replace(/\D/g, '').slice(-11);

  if (suffix) {
    try {
      const { rows } = await pool.query(
        `SELECT tenant_id
           FROM crm_leads
          WHERE tenant_id IS NOT NULL
            AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(telefone, ''), ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1`,
        [suffix]
      );
      if (rows[0]?.tenant_id) return rows[0].tenant_id;
    } catch (err) {
      console.error(`Tenant fallback by phone failed (${suffix}):`, err.message);
    }
  }

  if (instanceName) {
    try {
      const { rows } = await pool.query(
        `SELECT tenant_id
           FROM whatsapp_instances
          WHERE tenant_id IS NOT NULL
            AND ($1 = '' OR instance_name = $1)
          ORDER BY created_at DESC NULLS LAST
          LIMIT 1`,
        [instanceName]
      );
      if (rows[0]?.tenant_id) return rows[0].tenant_id;
    } catch (err) {
      console.error(`Tenant fallback by instance failed (${instanceName}):`, err.message);
    }
  }

  try {
    const { rows } = await pool.query(
      `SELECT tenant_id
         FROM profiles
        WHERE tenant_id IS NOT NULL
        GROUP BY tenant_id
        ORDER BY COUNT(*) DESC
        LIMIT 1`
    );
    if (rows[0]?.tenant_id) return rows[0].tenant_id;
  } catch (err) {
    console.error('Tenant fallback by profiles failed:', err.message);
  }

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
        `SELECT id, email, name, role, tenant_id, COALESCE(is_super_admin, false) as is_super_admin
           FROM profiles
          WHERE id = $1 OR email = $2
          LIMIT 1`,
        [sbUser.id, sbUser.email]
      );
      if (rows[0]?.tenant_id) {
        profile = { ...profile, ...rows[0] };
      }
    } catch (err) {
      console.warn('Local profile fallback failed:', err.message);
    }
  }

  // 3) Resolve role (admin/atendente/etc) a partir de user_roles
  let role = profile.role || 'user';
  try {
    const roleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${sbUser.id}&select=role&limit=1`,
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
  _supabaseUserCache.set(token, { user, exp: Date.now() + SUPABASE_CACHE_TTL_MS });
  return user;
}

// ─── Evolution API Config ───────────────────────────────────
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || 'https://api.odontoconnect.tech').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const APP_URL = (process.env.APP_URL || 'https://odontoconnect.tech').replace(/\/$/, '').replace(':443', '');
const WEBHOOK_PUBLIC_URL = process.env.WEBHOOK_PUBLIC_URL?.replace(/\/$/, '');
const isLocalAppUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(APP_URL);

// Ensure the webhook URL points to the backend API endpoint
const WEBHOOK_URL = WEBHOOK_PUBLIC_URL || (isLocalAppUrl ? `${APP_URL.replace(/:\d+$/, `:${PORT}`)}/api/webhook/evolution` : `https://backend.odontoconnect.tech/api/webhook/evolution`);

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
async function sendPushToAll(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  try {
    const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions');
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
async function registerWebhook(instanceName) {
  try {
    const webhookConfig = {
      enabled: true,
      url: WEBHOOK_URL,
      // Evolution API v2 expects these exact property names. Keep legacy
      // aliases too so older deployments do not break during rolling updates.
      byEvents: false,
      base64: false,
      webhookByEvents: false,
      webhookBase64: false,
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

    const result = await evolutionFetch(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: webhookConfig,
      }),
    });
    if (result.ok) {
      console.log(`✅ Webhook registered for ${instanceName} → ${WEBHOOK_URL}`);
    } else {
      console.error(`⚠️ Webhook registration failed for ${instanceName} (${WEBHOOK_URL}):`, result.data);
    }
    return result;
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

async function verifyUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized');
  const token = authHeader.replace('Bearer ', '');

  // 1) Tenta token legacy (HS256 com JWT_SECRET)
  let decoded = null;
  try {
    decoded = verifyToken(token);
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

  // Set context in DB session for RLS
  try {
    await pool.query('SELECT set_config($1, $2, true)', ['app.jwt_payload', JSON.stringify(decoded)]);
    await pool.query('SELECT set_config($1, $2, true)', ['app.is_super_admin', user.is_super_admin ? 'true' : 'false']);

    if (user.tenant_id) {
      await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', user.tenant_id]);
      await pool.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', user.tenant_id]);
    } else {
      await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', '']);
      await pool.query('SELECT set_config($1, $2, true)', ['app.current_tenant_id', '']);
    }
  } catch (err) {
    console.error('Failed to set DB session context:', err.message);
  }

  return { user };
}

async function verifySuperAdmin(req) {
  const { user } = await verifyUser(req);
  if (!user.is_super_admin) {
    console.warn(`[SECURITY] Unprivileged super-admin access attempt: ${user.email}`);
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
    console.warn(`[SECURITY] Access denied: User ${user.email} is not an admin`);
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

async function listProfilesWithRoles() {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.email, p.avatar_url, p.created_at, p.updated_at,
             COALESCE(p.active, true) as active,
             COALESCE(ur.role::text, p.role::text, 'user') as role
      FROM profiles p
      LEFT JOIN user_roles ur ON ur.user_id = p.id
      ORDER BY p.created_at DESC
    `);

    return rows;
  } catch (error) {
    if (error?.code !== '42703') throw error;

    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.email, p.avatar_url, p.created_at, p.updated_at,
             true as active,
             COALESCE(ur.role::text, p.role::text, 'user') as role
      FROM profiles p
      LEFT JOIN user_roles ur ON ur.user_id = p.id
      ORDER BY p.created_at DESC
    `);

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
    const { clinic_name, admin_name, email, password, plan_slug, telefone, cnpj } = req.body || {};
    if (!clinic_name || !admin_name || !email || !password) {
      return res.status(400).json({ error: 'Campos obrigatórios: clinic_name, admin_name, email, password' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
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
      `INSERT INTO tenants (nome, slug, cnpj, telefone, email_contato, status, trial_ends_at, plan_id)
       VALUES ($1,$2,$3,$4,$5,'trial', NOW() + ($6 || ' days')::interval, $7) RETURNING *`,
      [clinic_name, slug, cnpj || null, telefone || null, normalizedEmail, String(trialDays), plan.id]
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
        WHERE p.tenant_id = $1
        ORDER BY p.created_at DESC`,
      [user.tenant_id]
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/my-tenant/users', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin do tenant' });
    if (!user.tenant_id) return res.status(404).json({ error: 'Usuário sem tenant' });
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e senha obrigatórios' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha mínima de 6 caracteres' });

    const allowed = ['admin', 'dentista', 'recepcionista', 'comercial', 'user'];
    const userRole = allowed.includes(role) ? role : 'user';

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
    console.error('Tenant create user error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/my-tenant/users/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin do tenant' });
    if (!user.tenant_id) return res.status(404).json({ error: 'Usuário sem tenant' });
    const { id } = req.params;
    const { name, email, role, active } = req.body || {};

    // Ensure target belongs to same tenant
    const { rows: target } = await pool.query('SELECT id, tenant_id FROM profiles WHERE id = $1', [id]);
    if (!target[0] || target[0].tenant_id !== user.tenant_id) {
      return res.status(404).json({ error: 'Usuário não encontrado neste tenant' });
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
      const allowed = ['admin', 'dentista', 'recepcionista', 'comercial', 'user'];
      if (!allowed.includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
      await pool.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
      await pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, role]);
      await pool.query('UPDATE profiles SET role = $1, updated_at = NOW() WHERE id = $2', [role, id]);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Tenant update user error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/my-tenant/users/:id/reset-password', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin do tenant' });
    if (!user.tenant_id) return res.status(404).json({ error: 'Usuário sem tenant' });
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password || password.length < 6) return res.status(400).json({ error: 'Senha mínima de 6 caracteres' });

    const { rows: target } = await pool.query('SELECT id, tenant_id FROM profiles WHERE id = $1', [id]);
    if (!target[0] || target[0].tenant_id !== user.tenant_id) {
      return res.status(404).json({ error: 'Usuário não encontrado neste tenant' });
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
    
    res.json({
      environment: process.env.NODE_ENV,
      evolution_url: EVOLUTION_API_URL,
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
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.email, p.avatar_url, p.role, ur.role as user_role,
              p.tenant_id, COALESCE(p.is_super_admin, false) as is_super_admin,
              t.features as tenant_features
         FROM profiles p 
         LEFT JOIN user_roles ur ON ur.user_id = p.id
         LEFT JOIN tenants t ON t.id = p.tenant_id
        WHERE p.id = $1 LIMIT 1`,
      [user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Perfil não encontrado' });
    const profile = rows[0];
    res.json({
      id: profile.id, email: profile.email, name: profile.name,
      role: profile.user_role || profile.role, avatar_url: profile.avatar_url,
      tenant_id: profile.tenant_id || null,
      is_super_admin: !!profile.is_super_admin,
      tenant_features: profile.tenant_features || {},
    });
  } catch (error) {
    res.status(401).json({ error: 'Não autenticado' });
  }
});

app.post('/api/auth/create-user', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e senha obrigatórios' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha mínima de 6 caracteres' });

    const { rows: existing } = await pool.query('SELECT id FROM profiles WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.length > 0) return res.status(409).json({ error: 'Email já cadastrado' });

    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 12);
    const userRole = role || 'user';

    await pool.query('INSERT INTO profiles (id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5)', [id, name, email.toLowerCase().trim(), userRole, hash]);
    await pool.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [id, userRole]);

    res.json({ success: true, user: { id, name, email: email.toLowerCase().trim(), role: userRole } });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Nova senha mínima 6 chars' });

    const { rows } = await pool.query('SELECT password_hash FROM profiles WHERE id = $1', [user.id]);
    if (rows[0]?.password_hash && currentPassword) {
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
    console.log(`🔑 [RESET REQUEST] "${profile.name}" (${email}) solicitou recuperação de senha em ${new Date().toISOString()}`);

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
    await verifyAdmin(req);
    const { rows } = await pool.query(`
      SELECT r.*, p.name as user_name FROM password_reset_requests r
      JOIN profiles p ON r.user_id = p.id
      ORDER BY r.created_at DESC LIMIT 50
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Admin: reset user password ─────────────────────────────
app.post('/api/auth/admin-reset-password', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: 'userId e newPassword obrigatórios' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Senha mínima de 6 caracteres' });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, userId]);
    await pool.query("UPDATE password_reset_requests SET status = 'resolved' WHERE user_id = $1 AND status = 'pending'", [userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Admin: upload avatar for any user ──────────────────────
app.post('/api/auth/users/:userId/avatar', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { userId } = req.params;
    const { avatar } = req.body;

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
    console.error('Admin avatar upload error:', error);
    res.status(error.message === 'Admin access required' ? 403 : 500).json({ error: error.message });
  }
});

app.get('/api/auth/users', async (req, res) => {
  try {
    await verifyAdmin(req);
    const rows = await listProfilesWithRoles();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Admin: update user ─────────────────────────────────────
app.put('/api/auth/users/:id', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { id } = req.params;
    const { name, email, role, active } = req.body;

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
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// EVOLUTION API PROXY (WhatsApp)
// ═══════════════════════════════════════════════════════════════

const execFileAsync = promisify(execFile);

async function evolutionFetch(path, options = {}) {
  const url = `${EVOLUTION_API_URL}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: EVOLUTION_API_KEY,
        ...options.headers,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`⚠️ Evolution API ${res.status} for ${path}:`, JSON.stringify(data).slice(0, 500));
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error(`❌ Evolution fetch error (${path}):`, err.message);
    return { ok: false, status: 500, data: { error: err.message } };
  }
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
    console.log(`🔍 whatsappNumbers response for ${phone}:`, JSON.stringify(result.data).slice(0, 500));
    if (result.ok && Array.isArray(result.data)) {
      for (const entry of result.data) {
        const jid = entry?.jid || entry?.id || '';
        const lid = entry?.lid || '';
        // Extract LID number
        const lidNum = normalizeWhatsappNumber(lid) || (jid.includes('@lid') ? normalizeWhatsappNumber(jid) : '');
        if (lidNum && lidNum.length >= 10) {
          registerLidMapping(lidNum, phone);
          console.log(`🔗 LID mapped: ${lidNum} → ${phone}`);
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
            console.log(`🔗 LID mapped (findContacts): ${lidNum} → ${phone}`);
            return lidNum;
          }
        }
      }
    } catch (e2) { /* ignore findContacts fallback error */ }
  } catch (err) {
    console.error(`LID resolve error for ${phone}:`, err.message);
  }
  return null;
}

async function ensureWebhookRegistration(instanceName) {
  const lastEnsure = webhookEnsureTimestamps.get(instanceName) || 0;
  if (Date.now() - lastEnsure < 5 * 60 * 1000) return;
  await registerWebhook(instanceName);
  webhookEnsureTimestamps.set(instanceName, Date.now());
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
app.get('/api/whatsapp/instances', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const result = await evolutionFetch('/instance/fetchInstances');
    
    let instances = Array.isArray(result.data) ? result.data : [];
    
    // Isolation by tenant
    if (!user.is_super_admin && user.tenant_id) {
      const prefix = user.tenant_id.substring(0, 8);
      instances = instances.filter(i => {
        const name = i.name || i.instanceName || i.instance?.instanceName || "";
        return name.startsWith(prefix);
      });
    }

    // Safety net: re-ensure webhook registration for every connected instance
    // so incoming/outgoing messages always reach our /api/webhook/evolution endpoint.
    // ensureWebhookRegistration is internally throttled (5 min) per instance.
    for (const inst of instances) {
      const name = inst.name || inst.instanceName || inst.instance?.instanceName;
      const status = inst.connectionStatus || inst.status || inst.instance?.status;
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
    const { user } = await verifyAdmin(req);
    const { instanceName } = req.body;
    
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
      // Special case: 403 Forbidden on /instance/create usually means API Key is wrong
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

    res.json(result.data);
  } catch (error) {
    console.error('Create instance error:', error);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Connect (get QR Code) + ensure webhook is registered
app.get('/api/whatsapp/connect/:instance', async (req, res) => {
  try {
    await verifyUser(req);
    const instanceName = req.params.instance;
    const result = await evolutionFetch(`/instance/connect/${instanceName}`);

    // Ensure webhook is registered on every connect attempt
    registerWebhook(instanceName).catch(() => {});

    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.json({ success: true, webhookUrl: WEBHOOK_URL, result: result?.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current webhook config for an instance
app.get('/api/whatsapp/webhook/:instance', async (req, res) => {
  try {
    await verifyUser(req);
    const result = await evolutionFetch(`/webhook/find/${req.params.instance}`);
    res.json(result.data);
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
        console.log(`👁️ Presence subscribe attempt for ${cleanNumber} on ${instance}: status=${subResult.status}, data=${JSON.stringify(subResult.data).slice(0, 200)}`);
        if (subResult.ok || subResult.status === 201) {
          presenceSubscribed.add(subKey);
          didSubscribe = true;
          console.log(`✅ Presence subscribed for ${cleanNumber} on ${instance}`);

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
              console.warn(`⚠️ Could not resolve LID for ${cleanNumber} — presence updates may not match (suppressing future warnings for this number)`);
            }
          }
        } else {
          console.warn(`⚠️ Presence subscribe failed for ${cleanNumber}:`, JSON.stringify(subResult.data).slice(0, 300));
        }
      } catch (subErr) {
        console.error(`❌ Presence subscribe error for ${cleanNumber}:`, subErr.message);
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
    await verifyUser(req);
    const { instance, number, text, quoted } = req.body;
    if (!instance || !number || typeof text !== 'string') {
      return res.status(400).json({ error: 'instance, number e text são obrigatórios' });
    }
    // Make sure Evolution forwards events back to our webhook before sending,
    // otherwise the outgoing message ACK + the recipient reply never arrive.
    ensureWebhookRegistration(instance).catch(() => {});

    const cleanNumber = normalizeWhatsappNumber(number);
    const payload = { number: cleanNumber, text };
    if (quoted) payload.quoted = quoted;
    const result = await evolutionFetch(`/message/sendText/${instance}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!result.ok) {
      const errMsg = result.data?.response?.message?.[0]
        || result.data?.message
        || result.data?.error
        || `Evolution API respondeu ${result.status}`;
      console.error(`❌ send-text failed for ${instance} → ${cleanNumber}: ${errMsg}`, result.data);
      return res.status(result.status || 502).json({ error: errMsg, details: result.data });
    }

    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    console.log(`📤 sendMedia [${mediaType}] to ${cleanNumber}, base64 len: ${cleanedBase64 ? cleanedBase64.length : 0}, url: ${media.url || 'none'}, mime: ${mimeType}`);

    const payload = {
      number: cleanNumber,
      mediaMessage: {
        mediaType,
        fileName: media.fileName || undefined,
        caption: media.caption || '',
      },
      options: {
        delay: 1200,
        presence: 'composing',
      },
    };
    if (mimeType) {
      payload.mediaMessage.mimetype = mimeType;
    }
    if (cleanedBase64 && cleanedBase64.length > 10) {
      payload.mediaMessage.media = cleanedBase64;
    } else if (media.url) {
      payload.mediaMessage.media = media.url;
    } else {
      console.error('❌ sendMedia: no valid media (base64 or url). base64 length:', cleanedBase64?.length, 'url:', media.url);
      return res.status(400).json({ error: 'Nenhuma mídia válida fornecida (base64 vazio ou URL ausente)' });
    }

    console.log(`📤 sendMedia payload size: ${JSON.stringify(payload).length} bytes, media field starts with: ${String(payload.mediaMessage.media).substring(0, 50)}`);

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
    await verifyUser(req);
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

    mediaSendJobs.set(jobId, {
      status: 'processing',
      createdAt: Date.now(),
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

    console.log(`📤 send-media-upload jobId=${jobId} [${String(mediaType)}] to ${cleanNumber}, binary size: ${rawBody.length}, base64 len: ${base64Data.length}, mime: ${resolvedMimeType}`);

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
    await verifyUser(req);
    const job = mediaSendJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job não encontrado' });
    }
    res.json(job);
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
    try {
      await verifyUser(req);
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
      `SELECT sender FROM chat_messages WHERE id = $1 LIMIT 1`,
      [messageId]
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

    console.log('[send-reaction] payload:', JSON.stringify(payload));

    const result = await evolutionFetch(`/message/sendReaction/${instance}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    console.log('[send-reaction] evolution response:', result.status, JSON.stringify(result.data).slice(0, 500));

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
       WHERE id = $1`,
      [messageId, JSON.stringify(reaction ? [{ emoji: reaction, count: 1 }] : [])]
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
    await verifyUser(req);
    const { instance, number, leadId } = req.body;
    if (!instance || !number) {
      return res.status(400).json({ error: 'instance e number são obrigatórios' });
    }

    // Clean phone number — Evolution API expects format: 5511999991234
    const cleanNumber = number.replace(/\D/g, '');

    // Fetch profile picture URL via Evolution API
    console.log(`📸 Fetching profile picture for ${cleanNumber} on instance ${instance}`);
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
        'UPDATE crm_leads SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
        [pictureUrl, leadId]
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
  try {
    const { user } = await verifyUser(req);
    const { instance } = req.body;
    if (!instance) return res.status(400).json({ error: 'instance é obrigatório' });

    console.log(`🔄 Syncing profile pictures for tenant ${user.tenant_id} on instance ${instance} (User: ${user.email}, SuperAdmin: ${user.is_super_admin})`);

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

    let updated = 0;
    let failed = 0;

    for (const lead of leads) {
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

      // Rate limit: 500ms between requests
      await new Promise(r => setTimeout(r, 500));
    }

    res.json({ total: leads.length, updated, failed });
  } catch (error) {
    const isAuth = error.message === 'Unauthorized' || error.message === 'Invalid Supabase token';
    res.status(isAuth ? 401 : 500).json({ error: error.message });
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
    console.log(`📞 Initiating ${isVideo ? 'video' : 'voice'} call to ${cleanNumber} on instance ${instance}`);

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

    console.log(`📞 Call offered successfully to ${cleanNumber}`);
    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Call error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════

app.get('/api/pacientes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM pacientes WHERE tenant_id = $1 ORDER BY nome ASC', [user.tenant_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pacientes', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
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
    await verifyUser(req);
    const { nome, cpf, telefone, email, data_nascimento, sexo, convenio, endereco, observacoes } = req.body;
    await pool.query(
      'UPDATE pacientes SET nome=$1, cpf=$2, telefone=$3, email=$4, data_nascimento=$5, sexo=$6, convenio=$7, endereco=$8, observacoes=$9, updated_at=NOW() WHERE id=$10',
      [nome, cpf, telefone, email, data_nascimento, sexo, convenio, endereco, observacoes, req.params.id]
    );
    res.json({ success: true });
    // Push to Clinicorp
    import('./clinicorp.mjs').then(m => m.clinicorpPush.pushPatient(pool, req.params.id)).catch(e => console.error('Clinicorp push failed:', e.message));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/pacientes/:id', async (req, res) => {
  try {
    await verifyAdmin(req);
    await pool.query('DELETE FROM pacientes WHERE id = $1', [req.params.id]);
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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM anamneses WHERE paciente_id = $1', [req.params.id]);
    res.json(rows[0] || null);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

app.put('/api/pacientes/:id/anamnese', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    const {
      alergias, medicamentos, doencas_preexistentes, cirurgias_anteriores,
      fumante, etilista, gestante, diabetes, cardiopatia, hepatite, hiv,
      hemofilia, epilepsia, pressao_arterial, observacoes
    } = req.body;

    const { rows: existing } = await pool.query('SELECT id FROM anamneses WHERE paciente_id = $1', [id]);

    if (existing.length > 0) {
      await pool.query(
        `UPDATE anamneses SET
          alergias=$1, medicamentos=$2, doencas_preexistentes=$3, cirurgias_anteriores=$4,
          fumante=$5, etilista=$6, gestante=$7, diabetes=$8, cardiopatia=$9,
          hepatite=$10, hiv=$11, hemofilia=$12, epilepsia=$13,
          pressao_arterial=$14, observacoes=$15, updated_at=NOW()
        WHERE paciente_id=$16`,
        [alergias||[], medicamentos||[], doencas_preexistentes||[], cirurgias_anteriores||[],
         fumante||false, etilista||false, gestante||false, diabetes||false, cardiopatia||false,
         hepatite||false, hiv||false, hemofilia||false, epilepsia||false,
         pressao_arterial||null, observacoes||null, id]
      );
    } else {
      await pool.query(
        `INSERT INTO anamneses (paciente_id, alergias, medicamentos, doencas_preexistentes, cirurgias_anteriores,
          fumante, etilista, gestante, diabetes, cardiopatia, hepatite, hiv, hemofilia, epilepsia,
          pressao_arterial, observacoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, alergias||[], medicamentos||[], doencas_preexistentes||[], cirurgias_anteriores||[],
         fumante||false, etilista||false, gestante||false, diabetes||false, cardiopatia||false,
         hepatite||false, hiv||false, hemofilia||false, epilepsia||false,
         pressao_arterial||null, observacoes||null]
      );
    }

    const { rows } = await pool.query('SELECT * FROM anamneses WHERE paciente_id = $1', [id]);
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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM odontogramas WHERE paciente_id = $1', [req.params.id]);
    res.json(rows[0] || null);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pacientes/:id/odontograma', async (req, res) => {
  try {
    await verifyUser(req);
    const id = req.params.id;
    const { dentes, observacoes } = req.body;

    const { rows: existing } = await pool.query('SELECT id FROM odontogramas WHERE paciente_id = $1', [id]);

    if (existing.length > 0) {
      await pool.query(
        `UPDATE odontogramas SET dentes=$1, observacoes=$2, updated_at=NOW() WHERE paciente_id=$3`,
        [JSON.stringify(dentes), observacoes || null, id]
      );
    } else {
      await pool.query(
        `INSERT INTO odontogramas (paciente_id, dentes, observacoes) VALUES ($1, $2, $3)`,
        [id, JSON.stringify(dentes), observacoes || null]
      );
    }

    const { rows } = await pool.query('SELECT * FROM odontogramas WHERE paciente_id = $1', [id]);
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
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT a.id, a.data, a.hora, a.duracao, a.procedimento, a.status, a.observacoes,
              d.nome as dentista_nome, d.especialidade as dentista_especialidade
       FROM agendamentos a
       LEFT JOIN dentistas d ON a.dentista_id = d.id
       WHERE a.paciente_id = $1
       ORDER BY a.data DESC, a.hora DESC`,
      [req.params.id]
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
    await verifyUser(req);
    const { data_inicio, data_fim, dentista_id } = req.query;
    let query = 'SELECT a.*, p.nome as paciente_nome, d.nome as dentista_nome FROM agendamentos a LEFT JOIN pacientes p ON a.paciente_id = p.id LEFT JOIN dentistas d ON a.dentista_id = d.id WHERE 1=1';
    const params = [];
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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM agenda_marcadores ORDER BY nome ASC');
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/agenda/marcadores', async (req, res) => {
  try {
    await verifyUser(req);
    const { nome, cor } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const id = crypto.randomUUID();
    const corFinal = (cor || '#06b6d4').slice(0, 9);
    try {
      await pool.query('INSERT INTO agenda_marcadores (id, nome, cor) VALUES ($1,$2,$3)', [id, nome.trim(), corFinal]);
      res.json({ id, nome: nome.trim(), cor: corFinal });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Marcador com este nome já existe' });
      throw err;
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/agenda/marcadores/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM agenda_marcadores WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/agenda', async (req, res) => {
  try {
    await verifyUser(req);
    const {
      paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes, lead_id,
      tipo, primeira_consulta, dia_inteiro, escopo, categoria, categoria_cor,
      confirmacao_canal, confirmacao_quando, alerta_retorno_canal, alerta_retorno_quando,
      evento_titulo, sala, serie_id, marcadores, como_conheceu,
    } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO agendamentos (
        id, paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes,
        tipo, primeira_consulta, dia_inteiro, escopo, categoria, categoria_cor,
        confirmacao_canal, confirmacao_quando, alerta_retorno_canal, alerta_retorno_quando,
        evento_titulo, sala, serie_id, marcadores, como_conheceu
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24)`,
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
      ]
    );
    // Push to Clinicorp
    import('./clinicorp.mjs').then(m => m.clinicorpPush.pushAppointment(pool, id)).catch(e => console.error('Clinicorp push failed:', e.message));

    // Auto-move CRM lead to "paciente_agendado" if lead_id provided
    const resolvedLeadId = lead_id || paciente_id;
    if (resolvedLeadId) {
      await pool.query(
        `UPDATE crm_leads SET kanban_stage = 'paciente_agendado', status = 'paciente_agendado', updated_at = NOW() WHERE id = $1`,
        [resolvedLeadId]
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
    await verifyUser(req);
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
          confirmacao_canal, confirmacao_quando, sala, serie_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'agendado',$8,'consulta',$9,'dentista',$10,$11,$12,$13,$14,$15)`,
        [
          id, paciente_id, dentista_id, dataStr, hora, duracao || 30,
          procedimento || null, observacoes || null,
          // primeira_consulta só na primeira data
          i === 0 ? !!primeira_consulta : false,
          categoria || null, categoria_cor || null,
          confirmacao_canal || null, confirmacao_quando || null,
          sala || null, serie_id,
        ]
      );
      created.push({ id, data: dataStr });
    }
    res.json({ serie_id, total: created.length, agendamentos: created });
  } catch (error) {
    console.error('❌ Error creating series:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/agenda/:id — excluir agendamento
app.delete('/api/agenda/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { serie } = req.query; // ?serie=true → exclui toda a série
    if (serie === 'true') {
      const { rows } = await pool.query('SELECT serie_id FROM agendamentos WHERE id=$1', [req.params.id]);
      const sid = rows[0]?.serie_id;
      if (!sid) {
        await pool.query('DELETE FROM agendamentos WHERE id=$1', [req.params.id]);
        return res.json({ success: true, deleted: 1 });
      }
      const { rowCount } = await pool.query('DELETE FROM agendamentos WHERE serie_id=$1', [sid]);
      return res.json({ success: true, deleted: rowCount });
    }
    // Push to Clinicorp before deleting locally if it exists
    const aptId = req.params.id;
    import('./clinicorp.mjs').then(m => m.clinicorpPush.deleteAppointment(pool, aptId)).catch(e => console.error('Clinicorp push failed:', e.message));
    await pool.query('DELETE FROM agendamentos WHERE id=$1', [req.params.id]);
    res.json({ success: true, deleted: 1 });
  } catch (error) {
    console.error('❌ Error deleting appointment:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/agenda/:id — update appointment (status, etc.)
app.put('/api/agenda/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    const { status, hora, duracao, procedimento, observacoes, sala, data, dentista_id, dentista_nome, marcadores, como_conheceu } = req.body;
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
    const query = `UPDATE agendamentos SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`;
    const { rows } = await pool.query(query, params);
    if (rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado' });

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

          const msg = `📋 *Consulta Reagendada*\n\nOlá, ${firstName}! 👋\n\nSua consulta foi reagendada:\n\n📅 *Nova data:* ${dataFormatted}\n⏰ *Horário:* ${updated.hora || '—'}\n🦷 *Procedimento:* ${updated.procedimento || 'Consulta'}\n👨‍⚕️ *Profissional:* ${updated.dentista_nome || '—'}\n\nCaso precise reagendar novamente, entre em contato.\n\n_Odonto Connect_`;

          await evolutionFetch(`/message/sendText/${instName}`, {
            method: 'POST',
            body: JSON.stringify({ number: phone, text: msg }),
          });
          console.log(`📲 Reschedule notification sent to ${phone}`);
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
    await verifyUser(req);
    const { tipo, mes, ano } = req.query;
    let query = 'SELECT * FROM financeiro WHERE 1=1';
    const params = [];
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
    await verifyUser(req);
    const { tipo, descricao, valor, data, categoria, paciente_id, forma_pagamento } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO financeiro (id, tipo, descricao, valor, data, categoria, paciente_id, forma_pagamento) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, tipo, descricao, valor, data, categoria, paciente_id, forma_pagamento]
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
    let { rows } = await pool.query('SELECT * FROM dentistas WHERE tenant_id = $1 ORDER BY nome ASC', [user.tenant_id]);
    if (rows.length === 0) {
      const fallback = await pool.query(`
        SELECT DISTINCT d.*
          FROM dentistas d
          JOIN agendamentos a ON a.dentista_id = d.id
         WHERE d.ativo IS DISTINCT FROM false
         ORDER BY d.nome ASC
      `);
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
    await verifyAdmin(req);
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
    params.push(req.params.id);
    await pool.query(`UPDATE dentistas SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM dentistas WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (error.message === 'Admin only') return res.status(403).json({ error: 'Admin only' });
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/dentistas/:id', async (req, res) => {
  try {
    await verifyAdmin(req);
    await pool.query('DELETE FROM dentistas WHERE id=$1', [req.params.id]);
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

app.get('/api/clinica/config', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM clinica_config WHERE id=1');
    if (rows.length === 0) {
      // fallback: cria registro default
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
    await verifyAdmin(req);
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
    await pool.query(`UPDATE clinica_config SET ${sets.join(', ')}, updated_at=NOW() WHERE id=1`, params);
    const { rows } = await pool.query('SELECT * FROM clinica_config WHERE id=1');
    res.json(rows[0]);
  } catch (error) {
    if (error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (error.message === 'Admin only') return res.status(403).json({ error: 'Admin only' });
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DENTISTAS — Horários (override por profissional)
// ═══════════════════════════════════════════════════════════════

app.get('/api/dentistas/:id/horarios', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query(
      'SELECT id, nome, usar_horario_clinica, horarios FROM dentistas WHERE id=$1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Dentista não encontrado' });
    const d = rows[0];
    if (d.usar_horario_clinica || !d.horarios) {
      const { rows: c } = await pool.query('SELECT horarios FROM clinica_config WHERE id=1');
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
    await verifyAdmin(req);
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
    params.push(req.params.id);
    await pool.query(`UPDATE dentistas SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT id, nome, usar_horario_clinica, horarios FROM dentistas WHERE id=$1', [req.params.id]);
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
    await verifyUser(req);
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
    params.push(req.params.id);
    await pool.query(`UPDATE financeiro SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM financeiro WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/financeiro/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM financeiro WHERE id=$1', [req.params.id]);
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
    const { rows } = await pool.query('SELECT * FROM fin_bank_accounts WHERE active=true AND tenant_id = $1 ORDER BY created_at', [user.tenant_id]);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/banks', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
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
    await verifyUser(req);
    const fields = ['name','bank','agency','account','type','balance','color'];
    const sets = []; const params = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); } });
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await pool.query(`UPDATE fin_bank_accounts SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM fin_bank_accounts WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/fin/banks/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('UPDATE fin_bank_accounts SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — EMPLOYEES
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/employees', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM fin_employees WHERE active=true ORDER BY name');
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/employees', async (req, res) => {
  try {
    await verifyUser(req);
    const { name, role, cpf, admission_date, salary, benefits, bank_account_id } = req.body;
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_employees (id,name,role,cpf,admission_date,salary,benefits,bank_account_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, name, role, cpf || '', admission_date || '', salary || 0, benefits || 0, bank_account_id || null]
    );
    const { rows } = await pool.query('SELECT * FROM fin_employees WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/fin/employees/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('UPDATE fin_employees SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — PAYROLLS
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/payrolls', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
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
    await verifyUser(req);
    const { employee_id, employee_name, month, gross_salary, benefits, deductions, net_salary, status, payment_date, bank_account_id } = req.body;
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_payrolls (id,employee_id,employee_name,month,gross_salary,benefits,deductions,net_salary,status,payment_date,bank_account_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, employee_id, employee_name, month, gross_salary || 0, benefits || 0, deductions || 0, net_salary || 0, status || 'pendente', payment_date || null, bank_account_id || null]
    );
    const { rows } = await pool.query('SELECT * FROM fin_payrolls WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/fin/payrolls/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const fields = ['status','payment_date','bank_account_id'];
    const sets = []; const params = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); } });
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await pool.query(`UPDATE fin_payrolls SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM fin_payrolls WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — BILLS (Contas a Pagar)
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/bills', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM fin_bills ORDER BY due_date DESC');
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/bills', async (req, res) => {
  try {
    await verifyUser(req);
    const { description, category, value, due_date, status, supplier, recurrent } = req.body;
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_bills (id,description,category,value,due_date,status,supplier,recurrent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, description, category, value, due_date, status || 'pendente', supplier || null, recurrent || false]
    );
    const { rows } = await pool.query('SELECT * FROM fin_bills WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/fin/bills/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const fields = ['description','category','value','due_date','status','supplier','bank_account_id','payment_date','recurrent'];
    const sets = []; const params = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); } });
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await pool.query(`UPDATE fin_bills SET ${sets.join(',')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM fin_bills WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/fin/bills/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM fin_bills WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — MOVEMENTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/movements', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM fin_movements ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/movements', async (req, res) => {
  try {
    await verifyUser(req);
    const { type, description, category, value, date, bank_account_id, bank_name, patient, bill_id, payroll_id } = req.body;
    const id = randomUUID();
    await pool.query(
      'INSERT INTO fin_movements (id,type,description,category,value,date,bank_account_id,bank_name,patient,bill_id,payroll_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, type, description, category, value, date, bank_account_id || null, bank_name || '', patient || null, bill_id || null, payroll_id || null]
    );
    // Update bank balance
    if (bank_account_id) {
      const op = type === 'entrada' ? '+' : '-';
      await pool.query(`UPDATE fin_bank_accounts SET balance = balance ${op} $1, updated_at=NOW() WHERE id=$2`, [value, bank_account_id]);
    }
    const { rows } = await pool.query('SELECT * FROM fin_movements WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// FINANCEIRO — OVERDUE (Inadimplentes)
// ═══════════════════════════════════════════════════════════════

app.get('/api/fin/overdue', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM fin_overdue ORDER BY days_late DESC');
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/fin/overdue', async (req, res) => {
  try {
    await verifyUser(req);
    const { patient, value, days_late, procedure: proc } = req.body;
    const id = randomUUID();
    await pool.query('INSERT INTO fin_overdue (id,patient,value,days_late,procedure) VALUES ($1,$2,$3,$4,$5)', [id, patient, value, days_late || 0, proc || '']);
    const { rows } = await pool.query('SELECT * FROM fin_overdue WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/fin/overdue/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM fin_overdue WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ═══════════════════════════════════════════════════════════════
// ESTOQUE — FULL CRUD + MOVIMENTAÇÕES
// ═══════════════════════════════════════════════════════════════

app.get('/api/estoque', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM estoque ORDER BY nome ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/estoque', async (req, res) => {
  try {
    await verifyUser(req);
    const { nome, categoria, quantidade, quantidade_minima, unidade, valor_unitario, fornecedor, localizacao, validade, lote } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO estoque (id, nome, categoria, quantidade, quantidade_minima, unidade, valor_unitario, fornecedor, localizacao, validade, lote) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, nome, categoria, quantidade || 0, quantidade_minima || 5, unidade || 'un', valor_unitario, fornecedor, localizacao, validade, lote]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/estoque/:id', async (req, res) => {
  try {
    await verifyUser(req);
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
    params.push(req.params.id);
    await pool.query(`UPDATE estoque SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM estoque WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/estoque/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM estoque WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/estoque-movimentos', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query(`
      SELECT em.*, e.nome as item_nome FROM estoque_movimentos em
      LEFT JOIN estoque e ON e.id = em.item_id
      ORDER BY em.created_at DESC LIMIT 100
    `);
    res.json(rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});


app.get('/api/estoque/:id/movimentos', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM estoque_movimentos WHERE item_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/estoque/:id/movimentos', async (req, res) => {
  try {
    await verifyUser(req);
    const { tipo, quantidade, motivo, usuario_nome } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO estoque_movimentos (id, item_id, tipo, quantidade, motivo, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, req.params.id, tipo, quantidade, motivo, usuario_nome]
    );
    // Update stock quantity
    const delta = tipo === 'entrada' ? quantidade : -quantidade;
    await pool.query('UPDATE estoque SET quantidade = GREATEST(0, quantidade + $1), updated_at=NOW() WHERE id=$2', [delta, req.params.id]);
    const { rows } = await pool.query('SELECT * FROM estoque WHERE id=$1', [req.params.id]);
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
    await verifyUser(req);
    const { paciente_id } = req.query;
    let query = `SELECT t.*, p.nome as paciente_nome, d.nome as dentista_nome
      FROM tratamentos t
      LEFT JOIN pacientes p ON t.paciente_id = p.id
      LEFT JOIN dentistas d ON t.dentista_id = d.id WHERE 1=1`;
    const params = [];
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
    const { paciente_id, dentista_id, descricao, dente, valor, status, plano, observacoes } = req.body;
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
    const { descricao, dente, valor, status, plano, observacoes, dentista_id } = req.body;
    const sets = []; const params = [];
    if (descricao !== undefined) { params.push(descricao); sets.push(`descricao=$${params.length}`); }
    if (dente !== undefined) { params.push(dente); sets.push(`dente=$${params.length}`); }
    if (valor !== undefined) { params.push(valor); sets.push(`valor=$${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status=$${params.length}`); }
    if (plano !== undefined) { params.push(plano); sets.push(`plano=$${params.length}`); }
    if (observacoes !== undefined) { params.push(observacoes); sets.push(`observacoes=$${params.length}`); }
    if (dentista_id !== undefined) { params.push(dentista_id); sets.push(`dentista_id=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await pool.query(`UPDATE tratamentos SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length} AND tenant_id = '${user.tenant_id}'`, params);
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
    const { rows: prev } = await pool.query('SELECT paciente_id, dentista_id FROM tratamentos WHERE id=$1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
    await pool.query('DELETE FROM tratamentos WHERE id=$1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
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
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT e.*, d.nome as dentista_nome FROM tratamento_etapas e
       LEFT JOIN dentistas d ON e.dentista_id = d.id
       WHERE e.tratamento_id=$1 ORDER BY e.ordem ASC, e.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tratamentos/:id/etapas', async (req, res) => {
  try {
    await verifyUser(req);
    const { descricao, dente, valor, status, dentista_id, observacoes, ordem } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO tratamento_etapas (id, tratamento_id, descricao, dente, valor, status, dentista_id, observacoes, ordem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, req.params.id, descricao, dente, valor || 0, status || 'pendente', dentista_id, observacoes, ordem || 0]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tratamentos/etapas/:id', async (req, res) => {
  try {
    await verifyUser(req);
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
    params.push(req.params.id);
    await pool.query(`UPDATE tratamento_etapas SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM tratamento_etapas WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tratamentos/etapas/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM tratamento_etapas WHERE id=$1', [req.params.id]);
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
    await verifyUser(req);
    const { dentista_id, status: statusFilter, mes, ano } = req.query;
    let query = `SELECT c.*, d.nome as dentista_nome, p.nome as paciente_nome
      FROM comissoes c
      LEFT JOIN dentistas d ON c.dentista_id = d.id
      LEFT JOIN pacientes p ON c.paciente_id = p.id WHERE 1=1`;
    const params = [];
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
    await verifyUser(req);
    const { dentista_id, tratamento_id, paciente_id, valor, percentual, data, procedimento, descricao, status } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO comissoes (id, dentista_id, tratamento_id, paciente_id, valor, percentual, data, procedimento, descricao, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, dentista_id, tratamento_id, paciente_id, valor, percentual, data || new Date().toISOString().split('T')[0], procedimento, descricao, status || 'pendente']
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/comissoes/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { valor, percentual, status, pago, descricao } = req.body;
    const sets = []; const params = [];
    if (valor !== undefined) { params.push(valor); sets.push(`valor=$${params.length}`); }
    if (percentual !== undefined) { params.push(percentual); sets.push(`percentual=$${params.length}`); }
    if (status !== undefined) { params.push(status); sets.push(`status=$${params.length}`); }
    if (pago !== undefined) { params.push(pago); sets.push(`pago=$${params.length}`); }
    if (descricao !== undefined) { params.push(descricao); sets.push(`descricao=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await pool.query(`UPDATE comissoes SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM comissoes WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/comissoes/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM comissoes WHERE id=$1', [req.params.id]);
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
    await verifyUser(req);
    const { paciente_id } = req.query;
    let query = `SELECT pr.*, p.nome as paciente_nome, d.nome as dentista_nome
      FROM prontuarios pr
      LEFT JOIN pacientes p ON pr.paciente_id = p.id
      LEFT JOIN dentistas d ON pr.dentista_id = d.id WHERE 1=1`;
    const params = [];
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
    await verifyUser(req);
    const { paciente_id, dentista_id, descricao, tipo, titulo, odontograma, anexos } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO prontuarios (id, paciente_id, dentista_id, descricao, tipo, titulo, odontograma, anexos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, paciente_id, dentista_id, descricao, tipo || 'evolucao', titulo, odontograma ? JSON.stringify(odontograma) : '{}', anexos ? JSON.stringify(anexos) : '[]']
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/prontuarios/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { descricao, tipo, titulo, odontograma, anexos } = req.body;
    const sets = []; const params = [];
    if (descricao !== undefined) { params.push(descricao); sets.push(`descricao=$${params.length}`); }
    if (tipo !== undefined) { params.push(tipo); sets.push(`tipo=$${params.length}`); }
    if (titulo !== undefined) { params.push(titulo); sets.push(`titulo=$${params.length}`); }
    if (odontograma !== undefined) { params.push(JSON.stringify(odontograma)); sets.push(`odontograma=$${params.length}`); }
    if (anexos !== undefined) { params.push(JSON.stringify(anexos)); sets.push(`anexos=$${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await pool.query(`UPDATE prontuarios SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM prontuarios WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/prontuarios/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM prontuarios WHERE id=$1', [req.params.id]);
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
async function congelarVersoesItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) return itens || [];
  const out = [];
  for (const it of itens) {
    if (it && it.procedimento_id && !it.procedimento_versao_id) {
      const { rows } = await pool.query(
        `SELECT id, versao FROM procedimentos_catalogo_versoes
         WHERE procedimento_id=$1 AND valido_ate IS NULL
         ORDER BY versao DESC LIMIT 1`,
        [it.procedimento_id]
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
    await verifyUser(req);
    const {
      paciente_id, dentista_id, itens, valor_total, desconto, status, validade,
      observacoes, forma_pagamento, parcelas, titulo, print_config, odontograma_snapshot,
    } = req.body;
    const itensCongelados = await congelarVersoesItens(itens);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO orcamentos (
        id, paciente_id, dentista_id, itens, valor_total, desconto, status, validade,
        observacoes, forma_pagamento, parcelas, titulo, print_config, odontograma_snapshot
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id, paciente_id, dentista_id, JSON.stringify(itensCongelados),
        valor_total, desconto || 0, status || 'pendente', validade,
        observacoes, forma_pagamento, parcelas || 1,
        titulo || null,
        print_config ? JSON.stringify(print_config) : null,
        odontograma_snapshot ? JSON.stringify(odontograma_snapshot) : null,
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
    await verifyUser(req);
    const {
      itens, valor_total, desconto, status, validade, observacoes,
      forma_pagamento, parcelas, titulo, print_config, odontograma_snapshot,
    } = req.body;
    const sets = []; const params = [];
    if (itens !== undefined) {
      const itensCongelados = await congelarVersoesItens(itens);
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
    params.push(req.params.id);
    await pool.query(`UPDATE orcamentos SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);
    const { rows } = await pool.query('SELECT * FROM orcamentos WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orcamentos/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM orcamentos WHERE id=$1', [req.params.id]);
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
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT * FROM procedimentos_catalogo WHERE ativo = true ORDER BY categoria NULLS LAST, nome ASC`
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
    const {
      codigo, nome, categoria, valor_particular, valor_convenio,
      duracao_minutos, cor, requer_dente, requer_face, descricao,
    } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    await client.query('BEGIN');
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO procedimentos_catalogo
        (id, codigo, nome, categoria, valor_particular, valor_convenio, duracao_minutos, cor, requer_dente, requer_face, descricao, versao_atual)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)`,
      [id, codigo || null, nome, categoria || null,
       valor_particular || 0, valor_convenio || 0, duracao_minutos || 30,
       cor || '#0d9488', requer_dente !== false, !!requer_face, descricao || null]
    );
    // Versão inicial (motivo: criação)
    await criarVersaoProcedimento(client, id, 'criação', user?.id || null);
    await client.query('COMMIT');

    const { rows } = await pool.query('SELECT * FROM procedimentos_catalogo WHERE id=$1', [id]);
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
    const procId = req.params.id;
    const fields = ['codigo','nome','categoria','valor_particular','valor_convenio','duracao_minutos','cor','requer_dente','requer_face','descricao','ativo'];

    // Snapshot anterior (para decidir se cria nova versão)
    const { rows: beforeRows } = await client.query('SELECT * FROM procedimentos_catalogo WHERE id=$1', [procId]);
    const antes = beforeRows[0];
    if (!antes) return res.status(404).json({ error: 'Procedimento não encontrado' });

    const sets = []; const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { params.push(req.body[f]); sets.push(`${f}=$${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para atualizar' });

    await client.query('BEGIN');
    params.push(procId);
    await client.query(`UPDATE procedimentos_catalogo SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`, params);

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

    const { rows } = await pool.query('SELECT * FROM procedimentos_catalogo WHERE id=$1', [procId]);
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
    await verifyUser(req);
    await pool.query('UPDATE procedimentos_catalogo SET ativo=false, updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Histórico completo de versões de um procedimento
app.get('/api/procedimentos-catalogo/:id/versoes', async (req, res) => {
  try {
    await verifyUser(req);
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
    await verifyUser(req);
    const { data } = req.query; // ISO string
    if (!data) return res.status(400).json({ error: 'parâmetro `data` (ISO) obrigatório' });
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
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT e.*, d.nome as dentista_nome,
              a.assinatura_base64, a.latitude, a.longitude, a.accuracy_m
       FROM procedimento_execucoes e
       LEFT JOIN dentistas d ON e.dentista_id = d.id
       LEFT JOIN assinaturas_eletronicas a ON e.assinatura_id = a.id
       WHERE e.orcamento_id = $1
       ORDER BY e.executado_em DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Lista execuções de um paciente (histórico clínico-financeiro)
app.get('/api/pacientes/:id/execucoes', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT e.*, d.nome as dentista_nome
       FROM procedimento_execucoes e
       LEFT JOIN dentistas d ON e.dentista_id = d.id
       WHERE e.paciente_id = $1
       ORDER BY e.executado_em DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Cria uma execução (com ou sem assinatura)
app.post('/api/execucoes', async (req, res) => {
  try {
    await verifyUser(req);
    const {
      orcamento_id, orcamento_item_id, paciente_id, dentista_id,
      procedimento_id, procedimento_nome, dente, faces, valor, observacoes,
      assinatura, // { base64, lat, lng, accuracy, canal, codigo }
    } = req.body;

    if (!paciente_id || !procedimento_nome) {
      return res.status(400).json({ error: 'paciente_id e procedimento_nome são obrigatórios' });
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
      await pool.query(
        `INSERT INTO assinaturas_eletronicas
          (id, paciente_id, dentista_id, contexto, assinatura_base64,
           latitude, longitude, accuracy_m, ip_address, user_agent,
           verificacao_canal, verificacao_codigo, verificacao_em,
           consentimento_aceito, consentimento_em, consentimento_versao, consentimento_texto)
         VALUES ($1,$2,$3,'execucao',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
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
        ]
      );
      assinaturaId = aId;
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO procedimento_execucoes
        (id, orcamento_id, orcamento_item_id, paciente_id, dentista_id,
         procedimento_id, procedimento_nome, dente, faces, valor, observacoes, assinatura_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id, orcamento_id || null, orcamento_item_id || null,
        paciente_id, dentista_id || null,
        procedimento_id || null, procedimento_nome,
        dente || null, JSON.stringify(faces || []),
        valor || 0, observacoes || null, assinaturaId,
      ]
    );

    // Se todos os itens do orçamento foram executados → marca como 'finalizado'
    if (orcamento_id) {
      const { rows: orc } = await pool.query('SELECT itens FROM orcamentos WHERE id=$1', [orcamento_id]);
      if (orc[0]) {
        let itens = orc[0].itens;
        if (typeof itens === 'string') { try { itens = JSON.parse(itens); } catch { itens = []; } }
        const totalItens = Array.isArray(itens) ? itens.length : 0;
        const { rows: cnt } = await pool.query(
          'SELECT COUNT(*)::int as c FROM procedimento_execucoes WHERE orcamento_id=$1', [orcamento_id]
        );
        if (totalItens > 0 && cnt[0].c >= totalItens) {
          await pool.query(`UPDATE orcamentos SET status='finalizado', updated_at=NOW() WHERE id=$1 AND status NOT IN ('reprovado','finalizado')`, [orcamento_id]);
        } else if (totalItens > 0) {
          await pool.query(`UPDATE orcamentos SET status='em_tratamento', updated_at=NOW() WHERE id=$1 AND status='aprovado'`, [orcamento_id]);
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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT assinatura_id FROM procedimento_execucoes WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Execução não encontrada' });
    if (rows[0].assinatura_id) {
      return res.status(403).json({ error: 'Execução assinada eletronicamente não pode ser removida (MP 2200-2/2001).' });
    }
    await pool.query('DELETE FROM procedimento_execucoes WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Detalhe de uma assinatura (para auditoria)
app.get('/api/assinaturas/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM assinaturas_eletronicas WHERE id=$1', [req.params.id]);
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
            AND (
              (follow_up_at IS NOT NULL AND follow_up_at <= NOW() + INTERVAL '2 days')
              OR kanban_stage IN ('sem_resposta','primeiro_contato')
            )
          ORDER BY COALESCE(follow_up_at, updated_at) ASC
          LIMIT 12`,
        [attendantId]
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
              ON (p.telefone IS NOT NULL AND regexp_replace(p.telefone,'\\D','','g') = regexp_replace(l.telefone,'\\D','','g'))
              OR (p.email IS NOT NULL AND LOWER(p.email) = LOWER(l.email))
      WHERE (CURRENT_DATE - COALESCE(ult.ultima_visita, p.created_at::date)) >= $1
      ORDER BY dias_inativo DESC
      LIMIT 500`,
    [rule.inactive_days]
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
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT r.*,
              (SELECT COUNT(*)::int FROM reactivation_sends s WHERE s.rule_id = r.id) AS sent_count,
              (SELECT COUNT(*)::int FROM reactivation_sends s WHERE s.rule_id = r.id AND s.status = 'respondido') AS responded_count
         FROM reactivation_rules r
        ORDER BY r.created_at DESC`
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
      `INSERT INTO reactivation_rules (name, inactive_days, origin, message_template, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [String(name).slice(0, 200), days, orig, String(messageTemplate).slice(0, 4000), st, user.id]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Atualiza regra (incl. status)
app.put('/api/reativacao/rules/:id', async (req, res) => {
  try {
    await verifyUser(req);
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
    params.push(req.params.id);
    await pool.query(
      `UPDATE reactivation_rules SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${params.length}`,
      params
    );
    const { rows } = await pool.query('SELECT * FROM reactivation_rules WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Regra não encontrada' });
    res.json(rows[0]);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Remove regra
app.delete('/api/reativacao/rules/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const r = await pool.query('DELETE FROM reactivation_rules WHERE id=$1', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Regra não encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Lista pacientes que satisfazem a regra
app.get('/api/reativacao/rules/:id/patients', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows: rulRows } = await pool.query('SELECT * FROM reactivation_rules WHERE id=$1', [req.params.id]);
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
    await verifyUser(req);
    const { rows: rulRows } = await pool.query('SELECT * FROM reactivation_rules WHERE id=$1', [req.params.id]);
    const rule = rulRows[0];
    if (!rule) return res.status(404).json({ error: 'Regra não encontrada' });
    if (rule.status === 'pausado') {
      return res.status(400).json({ error: 'Regra está pausada' });
    }

    const instance = await getDefaultInstance();
    if (!instance) {
      return res.status(400).json({ error: 'Nenhuma instância WhatsApp ativa configurada' });
    }

    const requested = Array.isArray(req.body?.patientIds) ? req.body.patientIds : [];
    let matches = await reactivationFetchMatching(rule);
    if (requested.length > 0) {
      const set = new Set(requested);
      matches = matches.filter(m => set.has(m.id));
    }
    if (!matches.length) {
      return res.status(400).json({ error: 'Nenhum paciente para enviar' });
    }

    let sent = 0, failed = 0;
    const errors = [];

    for (const m of matches) {
      const phone = reactivationNormalizePhone(m.telefone);
      const message = reactivationFillTemplate(rule.message_template, {
        nome: (m.nome || '').split(/\s+/)[0],
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

      try {
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: phone, text: message }),
        });
        sent++;
        await pool.query(
          `INSERT INTO reactivation_sends (rule_id, paciente_id, lead_id, phone, message, status)
           VALUES ($1,$2,$3,$4,$5,'enviado')`,
          [rule.id, m.id, m.lead_id, phone, message]
        ).catch(() => {});

        // Move o lead correspondente para a fase 'reativacao' do CRM (se existir)
        if (m.lead_id) {
          await pool.query(
            `UPDATE crm_leads SET kanban_stage='reativacao', status='reativacao', updated_at=NOW() WHERE id=$1`,
            [m.lead_id]
          ).catch(() => {});
        }
      } catch (err) {
        failed++;
        const errMsg = String(err?.message || err).slice(0, 500);
        await pool.query(
          `INSERT INTO reactivation_sends (rule_id, paciente_id, lead_id, phone, message, status, error_message)
           VALUES ($1,$2,$3,$4,$5,'falhou',$6)`,
          [rule.id, m.id, m.lead_id, phone, message, errMsg]
        ).catch(() => {});
        errors.push({ pacienteId: m.id, error: errMsg });
      }
    }

    await pool.query(
      `UPDATE reactivation_rules SET last_run_at=NOW(), status=CASE WHEN status='rascunho' THEN 'ativo' ELSE status END, updated_at=NOW() WHERE id=$1`,
      [rule.id]
    );

    res.json({ success: true, sent, failed, total: matches.length, errors: errors.slice(0, 20) });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// KPIs agregados
app.get('/api/reativacao/kpis', async (req, res) => {
  try {
    await verifyUser(req);
    const safe = async (sql, params = []) => {
      try { return await pool.query(sql, params); }
      catch (err) {
        if (err.code === '42P01' || err.code === '42703') return { rows: [] };
        throw err;
      }
    };

    const [activeRules, sendsAgg, ruleList] = await Promise.all([
      safe(`SELECT COUNT(*)::int AS total FROM reactivation_rules WHERE status='ativo'`),
      safe(`SELECT
              COUNT(*) FILTER (WHERE status='enviado')::int AS sent,
              COUNT(*) FILTER (WHERE status='respondido')::int AS responded
            FROM reactivation_sends`),
      safe(`SELECT * FROM reactivation_rules`),
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
    await verifyUser(req);
    const allowedTables = ['crm_leads', 'estoque', 'tratamentos', 'orcamentos', 'comissoes', 'prontuarios'];
    const table = req.params.tableName;
    if (!allowedTables.includes(table)) return res.status(403).json({ error: 'Tabela não permitida' });
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY created_at DESC`);
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
    await verifyUser(req);
    const { rows } = await pool.query(`
      SELECT o.*, p.nome as paciente_nome, d.nome as dentista_nome
      FROM orcamentos o
      LEFT JOIN pacientes p ON o.paciente_id = p.id
      LEFT JOIN dentistas d ON o.dentista_id = d.id
      ORDER BY o.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Update budget status (approve/reject) — auto-moves CRM lead
app.patch('/api/orcamentos/:id/status', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { status } = req.body;
    const validStatuses = ['pendente', 'aprovado', 'reprovado', 'em_tratamento', 'finalizado'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Válidos: ${validStatuses.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });

    const budget = rows[0];

    // ── Auto-move linked CRM lead based on budget status ──
    // Find lead linked to this budget (by orcamento_id) or by paciente_id
    let leadId = null;
    const { rows: linkedLeads } = await pool.query(
      `SELECT id FROM crm_leads WHERE orcamento_id = $1 LIMIT 1`,
      [req.params.id]
    );
    if (linkedLeads.length > 0) {
      leadId = linkedLeads[0].id;
    } else if (budget.paciente_id) {
      // Try matching by paciente_id via telefone
      const { rows: patientLeads } = await pool.query(
        `SELECT cl.id FROM crm_leads cl
         JOIN pacientes p ON p.telefone = cl.telefone
         WHERE p.id = $1 LIMIT 1`,
        [budget.paciente_id]
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
        const { rows: currentLead } = await pool.query('SELECT kanban_stage FROM crm_leads WHERE id = $1', [leadId]);
        const fromStage = currentLead[0]?.kanban_stage || 'lead';

        await pool.query(
          `UPDATE crm_leads SET kanban_stage = $1, status = $1, updated_at = NOW() WHERE id = $2`,
          [newStage, leadId]
        );

        // Log movement
        const profile = await getProfileByEmail(user.email);
        await pool.query(
          `INSERT INTO kanban_movements (lead_id, from_stage, to_stage, moved_by, moved_by_name, reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [leadId, fromStage, newStage, user.id, profile?.name || user.email, `Orçamento #${req.params.id} ${status}`]
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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM attendance_queues ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/queues', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { name, color, icon, description, whatsapp_button_label, contact_numbers, team_member_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attendance_queues (id, name, color, icon, description, whatsapp_button_label, contact_numbers, team_member_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, name, color || '#3B82F6', icon || '📋', description, whatsapp_button_label || name, JSON.stringify(contact_numbers || []), JSON.stringify(team_member_ids || [])]
    );
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/queues/:id', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { name, color, icon, description, whatsapp_button_label, contact_numbers, team_member_ids, active } = req.body;
    await pool.query(
      `UPDATE attendance_queues SET name=COALESCE($1,name), color=COALESCE($2,color), icon=COALESCE($3,icon),
       description=COALESCE($4,description), whatsapp_button_label=COALESCE($5,whatsapp_button_label),
       contact_numbers=COALESCE($6,contact_numbers), team_member_ids=COALESCE($7,team_member_ids),
       active=COALESCE($8,active), updated_at=NOW() WHERE id=$9`,
      [name, color, icon, description, whatsapp_button_label, contact_numbers ? JSON.stringify(contact_numbers) : null, team_member_ids ? JSON.stringify(team_member_ids) : null, active, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/queues/:id', async (req, res) => {
  try {
    await verifyAdmin(req);
    await pool.query('DELETE FROM attendance_queues WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ═══════════════════════════════════════════════════════════════
// SSE — Real-time event stream for frontend
// ═══════════════════════════════════════════════════════════════

const sseClients = new Map();

function broadcastSSE(event, data, tenantId = null) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const [client, info] of sseClients.entries()) {
    // If tenantId is provided, only send to clients belonging to that tenant.
    // Clients that authenticated but temporarily resolved without tenant_id are
    // still allowed to receive the event; otherwise realtime can fail silently
    // even though the message was persisted in the correct clinic queue.
    if (tenantId) {
      if (info.tenantId && info.tenantId !== tenantId) continue;
      if (!info.tenantId && !info.authenticated) continue;
    }
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
  const token = req.query.token;

  if (token) {
    try {
      // 1) Try legacy token
      let decoded = null;
      try {
        decoded = verifyToken(token);
        tenantId = decoded?.tenant_id;
        authenticated = true;
      } catch {
        // 2) Fallback to Supabase
        if (SUPABASE_BRIDGE_ENABLED) {
          const sbUser = await resolveSupabaseUser(token);
          tenantId = sbUser.tenant_id;
          authenticated = true;
        }
      }
    } catch (err) {
      console.warn('📡 SSE connection failed: invalid token');
    }
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

// Helper: check if currently within business hours
function isWithinBusinessHours(settings) {
  if (!settings?.businessHours) return true; // default: always open
  const now = new Date();
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayKey = dayKeys[now.getDay()];
  const schedule = settings.businessHours[dayKey];
  if (!schedule?.enabled) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = schedule.openTime.split(':').map(Number);
  const [closeH, closeM] = schedule.closeTime.split(':').map(Number);
  return currentMinutes >= (openH * 60 + openM) && currentMinutes <= (closeH * 60 + closeM);
}

// ─── Attendance Settings (persisted in PostgreSQL) ──────────
let attendanceSettingsCache = null;

async function loadAttendanceSettings() {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'attendance_settings'");
    attendanceSettingsCache = rows.length > 0 ? rows[0].value : null;
  } catch (err) {
    console.error('⚠️ Could not load attendance settings from DB:', err.message);
  }
}

// Load on startup
loadAttendanceSettings();

app.get('/api/attendance-settings', async (req, res) => {
  try {
    await verifyUser(req);
    if (!attendanceSettingsCache) await loadAttendanceSettings();
    res.json(attendanceSettingsCache || {});
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.put('/api/attendance-settings', async (req, res) => {
  try {
    await verifyAdmin(req);
    const settings = req.body;
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('attendance_settings', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(settings)]
    );
    attendanceSettingsCache = settings;
    console.log('⚙️ Attendance settings saved to database');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: send WhatsApp button menu with active queues
async function sendQueueMenu(instance, phone) {
  const { rows: queues } = await pool.query(
    "SELECT id, name, icon, whatsapp_button_label FROM attendance_queues WHERE active = true ORDER BY name ASC"
  );
  if (queues.length === 0) return; // No queues configured

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
    description: 'Olá! 👋 Selecione o setor desejado para ser atendido:',
    footer: 'Odonto Connect',
    buttons,
  };

  const btnResult = await evolutionFetch(`/message/sendButtons/${instance}`, {
    method: 'POST',
    body: JSON.stringify(buttonPayload),
  });

  // Fallback: if buttons not supported, send numbered list as text
  if (!btnResult.ok) {
    console.log('⚠️ Buttons not supported, falling back to text list');
    const lines = ['Olá! 👋 Selecione o setor desejado:', ''];
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
     WHERE REPLACE(REPLACE(REPLACE(REPLACE(telefone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1`,
    [phone.slice(-11)]
  );

  console.log(`📋 Queue menu sent to ${phone} (${queues.length} options)`);
}

// Helper: match queue from button response or number
async function matchQueue(content) {
  if (!content) return null;
  const trimmed = content.trim();

  // Match by button ID (queue_UUID)
  if (trimmed.startsWith('queue_')) {
    const queueId = trimmed.replace('queue_', '');
    const { rows } = await pool.query('SELECT * FROM attendance_queues WHERE id = $1 AND active = true', [queueId]);
    return rows[0] || null;
  }

  // Match by number (1, 2, 3...)
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num > 0) {
    const { rows } = await pool.query('SELECT * FROM attendance_queues WHERE active = true ORDER BY name ASC');
    return rows[num - 1] || null;
  }

  // Match by name (fuzzy)
  const { rows } = await pool.query('SELECT * FROM attendance_queues WHERE active = true');
  const lower = trimmed.toLowerCase();
  return rows.find(q =>
    q.name.toLowerCase().includes(lower) ||
    (q.whatsapp_button_label || '').toLowerCase().includes(lower)
  ) || null;
}

async function persistIncomingMessage({ msgId, leadId, content, msgType, phone, instance, pushName, remoteJid, rawType, mediaUrl, fileName, mimeType, tenantId, sender = 'lead' }) {
  try {
    await pool.query(
      `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, phone, instance, media_url, file_name, mime_type, metadata, tenant_id)
       VALUES ($1,$2,$3,$12,$4,'delivered',NOW(),$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [msgId, leadId, content, msgType, phone, instance, mediaUrl || null, fileName || null, mimeType || null, JSON.stringify({
        pushName,
        remoteJid,
        rawType,
      }), tenantId, sender]
    );
  } catch (dbErr) {
    console.error('DB insert error (incoming msg):', dbErr.message);
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
      `SELECT id, status
         FROM attendance_sessions
        WHERE lead_id = $1
          AND tenant_id = $2
          AND status IN ('waiting', 'active')
        ORDER BY started_waiting_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [lead.id.toString(), tenantId]
    );

    if (existing[0]?.status === 'active') {
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
    console.log(`📥 Lead ${lead.name || phone} entrou na fila de espera (session=${sessionId})`);
    return sessionId;
  } catch (err) {
    console.error('Failed to ensure waiting session:', err.message);
    return null;
  }
}

app.post('/api/webhook/evolution', async (req, res) => {
  try {
    const body = req.body;
    const event = typeof body.event === 'string' ? body.event.toLowerCase().replace(/_/g, '.') : '';
    const instance = body.instance || body.instanceName;
    let tenantId = await getTenantIdByInstance(instance);
    
    console.log(`📩 Webhook event: ${event} from ${instance} (tenant: ${tenantId})`);
    if (event !== 'presence.update') {
      console.log(`📦 Webhook Body:`, JSON.stringify(body).slice(0, 1000));
    }

    // ─── Presence updates (typing, recording, online) ───
    if (event === 'presence.update') {
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

          console.log(`👁️ PRESENCE resolved: phone=${resolvedPhone} status=${status}${participantPhone !== resolvedPhone ? ` (LID fallback from ${chatJid})` : ''}`);
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
        console.log(`👁️ PRESENCE fallback: phone=${finalPhone} status=${globalStatus}${finalPhone !== fallbackPhone ? ` (resolved from LID ${fallbackPhone})` : ''}`);
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
        console.log(`⚠️ PRESENCE_UPDATE: could not extract phone or status from:`, JSON.stringify(presenceData).slice(0, 300));
      }
      return res.json({ processed: true, event: 'presence' });
    }

    // ─── Message ACK / status updates ───
    if (event === 'messages.update') {
      const updates = Array.isArray(body.data) ? body.data : [body.data];
      console.log(`📩 MESSAGES_UPDATE: ${updates.length} updates, raw:`, JSON.stringify(body.data).slice(0, 500));
      for (const update of updates) {
        const key = update?.key || {};
        const lookupIds = [...new Set([update?.messageId, key?.id, update?.keyId].filter(Boolean))];
        const primaryMessageId = lookupIds[0];
        const remoteJid = key?.remoteJid || update?.remoteJid;
        const ack = update?.update?.status ?? update?.status ?? key?.status;

        if (!primaryMessageId || !remoteJid || remoteJid.endsWith('@g.us')) continue;

        // Build LID→phone mapping from ACK events
        // remoteJid is often a LID; look up the real phone from our DB
        if (remoteJid.includes('@lid')) {
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
                console.log(`🔗 LID mapped from ACK: ${lidNum} → ${msgRows[0].phone}`);
              }
            } catch (e) { /* ignore */ }
          }
        }

        let newStatus = null;
        const ackStr = String(ack).toUpperCase();
        const ackNum = typeof ack === 'number' ? ack : parseInt(ack);

        if (ackStr === 'SERVER_ACK' || ackNum === 2) newStatus = 'sent';
        else if (ackStr === 'DELIVERY_ACK' || ackNum === 3) newStatus = 'delivered';
        else if (ackStr === 'READ' || ackStr === 'PLAYED' || ackNum === 4 || ackNum === 5) newStatus = 'read';
        else if (ackStr === 'ERROR' || ackNum === 0) newStatus = 'failed';

        if (!newStatus) {
          console.log(`⚠️ ACK ignored: ack=${ack}, messageIds=${lookupIds.join(',')}`);
          continue;
        }

        let phone = String(remoteJid)
          .replace('@s.whatsapp.net', '')
          .replace('@c.us', '')
          .replace('@lid', '')
          .replace(/:\d+$/, '')
          .replace(/\D/g, '');
        // Resolve LID to real phone if mapped
        phone = resolvePhoneFromLid(phone);

        for (const lookupId of lookupIds) {
          console.log(`✅ ACK: ${lookupId} → ${newStatus} (ack=${ack}, phone=${phone})`);

          try {
            await pool.query(
              `UPDATE chat_messages SET status = $1 WHERE tenant_id = $3 AND (id = $2 OR (metadata::text LIKE '%' || $2 || '%'))`,
              [newStatus, lookupId, tenantId]
            );
          } catch (ackErr) {
            console.error('ACK DB update error:', ackErr.message);
          }

          broadcastSSE('message_status_update', {
            messageId: lookupId,
            phone,
            status: newStatus,
            instance,
          }, tenantId);
        }
      }
      return res.json({ processed: true, event: 'messages.update' });
    }

    // Only process incoming messages from here
    if (event !== 'messages.upsert') {
      return res.json({ ignored: true, event });
    }

    const message = body.data;
    const remoteJid = message?.key?.remoteJid;

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

    if (!tenantId) {
      tenantId = await getFallbackTenantIdForIncomingMessage({ instanceName: instance, phoneSuffix });
      if (tenantId) {
        console.log(`🔐 Tenant resolved by fallback for ${instance || 'unknown-instance'} / ${phoneSuffix}: ${tenantId}`);
      } else {
        console.warn(`⚠️ Webhook message without tenant_id: instance=${instance || 'unknown'} phone=${phoneSuffix}. Message will be ignored to avoid cross-clinic leakage.`);
        return res.status(202).json({ ignored: true, reason: 'tenant_not_resolved' });
      }
    }

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
       WHERE tenant_id = $1 AND REGEXP_REPLACE(COALESCE(telefone, ''), '\\D', '', 'g') LIKE '%' || $2
       LIMIT 1`,
      [tenantId, phoneSuffix]
    );

    let lead = leads[0] || null;
    const pushName = message?.pushName || phone;
    const msgId = message?.key?.id || `wh-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const resolvedContent = msgContent || `[${msgType}]`;
    const rawType = Object.keys(message?.message || {})[0] || null;

    // ─── New contact: create lead + contato + check hours + send menu ───
    if (!lead) {
      const newId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm_leads (id, nome, telefone, origem, status, kanban_stage, awaiting_queue_selection, tenant_id)
         VALUES ($1, $2, $3, 'whatsapp', 'novo', 'lead', true, $4)`,
        [newId, pushName, resolvedPhone, tenantId]
      );
      lead = { id: newId, name: pushName, phone: resolvedPhone, queue_id: null, queue_name: null, awaiting_queue_selection: true, avatar_url: null };
      console.log(`🆕 New lead created: ${pushName} (${resolvedPhone})`);

      // 🤖 Trigger "Lead entrou no CRM" automation
      triggerAutomationFlows('Lead entrou no CRM', { name: pushName, phone }).catch(() => {});

      // Auto-save to contatos table (skip if phone already exists)
      try {
        const existingContato = await pool.query('SELECT id FROM contatos WHERE telefone = $1', [resolvedPhone]);
        if (existingContato.rows.length === 0) {
          await pool.query(
            'INSERT INTO contatos (id, nome, telefone, tipo) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), pushName, resolvedPhone, 'pessoal']
          );
          console.log(`📇 Auto-saved contact: ${pushName} (${resolvedPhone})`);
        }
      } catch (contatoErr) {
        console.error('Failed to auto-save contato:', contatoErr.message);
      }

      // Check business hours
      if (!isWithinBusinessHours(attendanceSettingsCache)) {
        const offMsg = attendanceSettingsCache?.offHoursMessage ||
          'Olá! Nosso horário de atendimento encerrou. Deixe sua mensagem que retornaremos assim que possível! 😊';
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: resolvedPhone, text: offMsg }),
        });
        console.log(`🕐 Off-hours message sent to ${resolvedPhone}`);
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
        });
        return res.json({ processed: true, offHours: true, leadId: lead.id });
      }

      // Send welcome message if enabled
      if (attendanceSettingsCache?.autoGreetingEnabled && attendanceSettingsCache?.welcomeMessage) {
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: resolvedPhone, text: attendanceSettingsCache.welcomeMessage }),
        });
      }

      // Send queue menu
      await sendQueueMenu(instance, resolvedPhone);
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
    if (lead.awaiting_queue_selection && (msgType === 'text' || msgType === 'button_response' || msgType === 'list_response')) {
      const selectedQueue = await matchQueue(msgContent);

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

        console.log(`📌 Lead ${lead.name} routed to queue: ${selectedQueue.name}`);

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
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
          tenantId,
          sender: senderRole,
        });
        // Invalid selection — resend menu
        await sendQueueMenu(instance, phone);
        console.log(`💬 Incoming message from ${pushName} (${phone}) awaiting queue selection → saved + broadcast to ${sseClients.size} clients`);
        return res.json({ processed: true, resent_menu: true, leadId: lead.id });
      }
    }

    // ─── Check for satisfaction rating response ───
    const ratingKey = `awaiting_rating_${phone}`;
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
          `INSERT INTO satisfaction_ratings (id, session_id, lead_id, lead_phone, rating, attendant_id, attendant_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [ratingId, ratingData.sessionId || null, ratingData.leadId, phone, rating, ratingData.attendantId || null, ratingData.attendantName || null]
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

        console.log(`⭐ Rating ${rating}/5 received from ${phone}`);
        return res.json({ processed: true, rating, leadId: ratingData.leadId });
      }
    }

    // ─── Auto-return from recovery stage to queue with priority ───
    if (followupAutomationConfig.returnToQueueOnReply) {
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
            `INSERT INTO kanban_movements (lead_id, from_stage, to_stage, moved_by_name, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [lead.id, currentStage, 'em_atendimento', 'Sistema (Auto-retorno)', 'Cliente respondeu durante recuperação — retornou à fila com prioridade']
          ).catch(() => {});
          // Add "Recuperação de Lead" tag
          try {
            // Ensure the tag exists
            const { rows: existingTag } = await pool.query(
              "SELECT id FROM lead_tags WHERE name = 'Recuperação de Lead' LIMIT 1"
            );
            let tagId;
            if (existingTag.length > 0) {
              tagId = existingTag[0].id;
            } else {
              tagId = crypto.randomUUID();
              await pool.query(
                "INSERT INTO lead_tags (id, name, color) VALUES ($1, $2, $3)",
                [tagId, 'Recuperação de Lead', '#F59E0B']
              );
            }
            // Assign tag to lead
            await pool.query(
              "INSERT INTO lead_tag_assignments (lead_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
              [lead.id.toString(), tagId]
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

          console.log(`🔄 Lead ${lead.name} (${phone}) replied from recovery stage ${currentStage} → returned to queue with priority`);
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

    console.log(`💬 New message from ${pushName} (${phone}) → saved + broadcast to ${sseClients.size} clients`);

    // Send Web Push notification to all subscribed attendants
    sendPushToAll({
      title: `💬 ${pushName || phone}`,
      body: msgContent || `[${msgType}]`,
      tag: `msg-${lead.id}`,
      url: `/chat?lead=${encodeURIComponent(lead.id)}`,
      leadId: lead.id,
    });

    if (lead && !lead.avatar_url) {
      try {
        const result = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: phone }),
        });
        const pictureUrl = result.data?.profilePictureUrl || result.data?.picture || result.data?.url || null;
        if (pictureUrl) {
          await pool.query('UPDATE crm_leads SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [pictureUrl, lead.id]);
          console.log(`📸 Auto-synced avatar for lead ${lead.id} (${phone})`);
        }
      } catch (fetchErr) {
        console.error('Webhook profile fetch error:', fetchErr.message);
      }
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
             AND aj.patient_phone LIKE $1
             AND aj.sent_at >= NOW() - INTERVAL '48 hours'
           ORDER BY aj.sent_at DESC LIMIT 1`,
          [`%${phoneSuffix}`]
        );

        if (reminderJobs.length > 0) {
          const reminderId = reminderJobs[0].flow_id.replace('reminder_', '');
          // Update appointment status to confirmed
          const { rowCount } = await pool.query(
            `UPDATE agendamentos SET status = 'confirmado', updated_at = NOW()
             WHERE id = $1 AND status NOT IN ('finalizado', 'realizado', 'cancelado')`,
            [reminderId]
          );

          if (rowCount > 0) {
            // Mark reminder as confirmed
            await pool.query(
              `UPDATE automation_jobs SET variables = jsonb_set(COALESCE(variables::jsonb, '{}'), '{confirmed}', 'true')
               WHERE id = $1`,
              [reminderJobs[0].id]
            ).catch(() => {});

            // Send confirmation reply
            const confirmMsg = `✅ *Presença confirmada!*\n\nObrigado por confirmar. Aguardamos você na data agendada. 😊\n\n_Odonto Connect_`;
            await evolutionFetch(`/message/sendText/${instance}`, {
              method: 'POST',
              body: JSON.stringify({ number: `${phone}@s.whatsapp.net`, text: confirmMsg }),
            }).catch(err => console.error('Failed to send confirm reply:', err.message));

            console.log(`✅ Auto-confirmed appointment ${reminderId} via WhatsApp reply from ${phone}`);
          }
        }
      }
    } catch (confirmErr) {
      console.error('Auto-confirm error:', confirmErr.message);
    }

    res.json({ processed: true, leadId: lead.id });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TRANSFER LOGS (auditoria)
// ═══════════════════════════════════════════════════════════════

app.post('/api/transfers', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { leadId, leadName, leadPhone, toUserId, toUserName, reason, queueId, queueName } = req.body;
    if (!leadId || !toUserId || !reason) {
      return res.status(400).json({ error: 'leadId, toUserId e reason são obrigatórios' });
    }

    const { rows } = await pool.query('SELECT name FROM profiles WHERE id = $1', [user.id]);
    const fromName = rows[0]?.name || 'Desconhecido';

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO transfer_logs (id, lead_id, lead_name, lead_phone, from_user_id, from_user_name, to_user_id, to_user_name, reason, queue_id, queue_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, leadId, leadName || null, leadPhone || null, user.id, fromName, toUserId, toUserName || null, reason, queueId || null, queueName || null]
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
    await verifyAdmin(req);
    const { limit = '50', offset = '0' } = req.query;
    const { rows } = await pool.query(
      'SELECT * FROM transfer_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [Math.min(Number(limit), 100), Number(offset)]
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

    const { rows } = await pool.query('SELECT name FROM profiles WHERE id = $1', [user.id]);
    const attendantName = rows[0]?.name || 'Atendente';

    const result = await pool.query(
      `UPDATE attendance_sessions SET 
         attendant_id = $1, attendant_name = $2, assigned_at = NOW(), status = 'active',
         wait_time_seconds = EXTRACT(EPOCH FROM (NOW() - started_waiting_at))::INTEGER
       WHERE lead_id = $3 AND tenant_id = $4 AND status = 'waiting'
       RETURNING id, wait_time_seconds`,
      [user.id, attendantName, leadId, user.tenant_id]
    );

    // Auto-move lead to "em_atendimento" in CRM kanban
    await pool.query(
      `UPDATE crm_leads SET kanban_stage = 'em_atendimento', status = 'em_atendimento', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [leadId, user.tenant_id]
    ).catch(err => console.error('Failed to update kanban_stage:', err.message));

    if (result.rows.length === 0) {
      // No waiting session, create one as active directly
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO attendance_sessions (id, lead_id, attendant_id, attendant_name, assigned_at, started_waiting_at, status, wait_time_seconds, tenant_id)
         VALUES ($1,$2,$3,$4, NOW(), NOW(), 'active', 0, $5)`,
        [id, leadId, user.id, attendantName, user.tenant_id]
      );
      return res.json({ success: true, id, waitTime: 0 });
    }

    res.json({ success: true, id: result.rows[0].id, waitTime: result.rows[0].wait_time_seconds });
  } catch (error) {
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

// ─── Follow-up Automation Config (in-memory, persisted to DB) ───
let followupAutomationConfig = {
  enabled: true,
  stages: ['followup', 'followup_2', 'followup_3'],
  messages: {
    followup: 'Olá {{nome}}! 😊 Obrigado pelo seu contato com a Odonto Connect. Gostaríamos de saber: podemos ajudar com mais alguma informação sobre o tratamento que conversamos? Estamos à disposição!',
    followup_2: '{{nome}}, passando para dar um oi! 👋 Ainda temos condições especiais para o procedimento que conversamos. Quer saber mais? Responda esta mensagem!',
    followup_3: 'Oi {{nome}}, última chamada! 🦷 Seu orçamento ainda está disponível e temos horários esta semana. Posso agendar uma avaliação para você?',
  },
  delaySeconds: 30, // delay before sending (gives time to cancel)
  delayDays: { followup: 0, followup_2: 3, followup_3: 7 }, // days after stage entry before sending
  returnToQueueOnReply: true, // when client replies from recovery, return to queue with priority
};

// Load config from DB on startup
(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'followup_automation' LIMIT 1`
    );
    if (rows.length > 0) {
      followupAutomationConfig = { ...followupAutomationConfig, ...JSON.parse(rows[0].value) };
      console.log('✅ Follow-up automation config loaded from DB');
    }
  } catch {
    console.log('ℹ️ No follow-up automation config in DB, using defaults');
  }
})();

// Helper: send follow-up WhatsApp message when lead enters a follow-up stage
async function triggerFollowupAutomation(leadId, toStage) {
  if (!followupAutomationConfig.enabled) return;
  if (!followupAutomationConfig.stages.includes(toStage)) return;

  try {
    // Get lead data
    const { rows: leads } = await pool.query(
      'SELECT id, nome, telefone FROM crm_leads WHERE id = $1', [leadId]
    );
    if (leads.length === 0) return;
    const lead = leads[0];
    if (!lead.telefone) {
      console.log(`⚠️ Follow-up automation: lead ${leadId} has no phone number`);
      return;
    }

    // Get message template
    const template = followupAutomationConfig.messages[toStage];
    if (!template) return;

    // Replace variables
    const message = template.replace(/\{\{nome\}\}/g, lead.nome || 'Paciente');

    // Find first connected WhatsApp instance
    const instResult = await evolutionFetch('/instance/fetchInstances');
    const instances = instResult.data || [];
    const connected = instances.find(i => i.status === 'open' || i.connectionStatus === 'open');
    if (!connected) {
      console.log('⚠️ Follow-up automation: no connected WhatsApp instance');
      return;
    }

    const instanceName = connected.instanceName || connected.instance?.instanceName;
    const phone = lead.telefone.replace(/\D/g, '');

    console.log(`🤖 Follow-up automation: sending message to ${phone} via ${instanceName} (stage: ${toStage})`);

    // Calculate total delay: delayDays + delaySeconds
    const stageDays = (followupAutomationConfig.delayDays && followupAutomationConfig.delayDays[toStage]) || 0;
    const totalDelayMs = (stageDays * 86400000) + ((followupAutomationConfig.delaySeconds || 30) * 1000);

    console.log(`🤖 Follow-up automation: scheduling message to ${phone} via ${instanceName} (stage: ${toStage}, delay: ${stageDays}d + ${followupAutomationConfig.delaySeconds}s)`);

    // Send with delay
    setTimeout(async () => {
      try {
        // Re-check if lead is still in the same stage (may have been moved/replied)
        const { rows: checkLead } = await pool.query('SELECT kanban_stage FROM crm_leads WHERE id = $1', [leadId]);
        if (checkLead.length === 0 || checkLead[0].kanban_stage !== toStage) {
          console.log(`⏭️ Follow-up automation: lead ${leadId} no longer in ${toStage}, skipping send`);
          return;
        }

        await evolutionFetch(`/message/sendText/${instanceName}`, {
          method: 'POST',
          body: JSON.stringify({ number: phone, text: message }),
        });
        console.log(`✅ Follow-up automation: message sent to ${lead.nome} (${phone})`);

        // Log in kanban_movements
        await pool.query(
          `INSERT INTO kanban_movements (lead_id, from_stage, to_stage, moved_by_name, reason)
           VALUES ($1, $2, $2, $3, $4)`,
          [leadId, toStage, 'Sistema (Automação)', `Follow-up automático enviado via WhatsApp`]
        ).catch(() => {});
      } catch (err) {
        console.error(`❌ Follow-up automation: failed to send to ${phone}:`, err.message);
      }
    }, totalDelayMs);

  } catch (err) {
    console.error('❌ Follow-up automation error:', err.message);
  }
}

// GET/PUT follow-up automation settings
app.get('/api/automations/followup', async (req, res) => {
  try {
    await verifyUser(req);
    res.json(followupAutomationConfig);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

app.put('/api/automations/followup', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { enabled, messages, stages, delaySeconds, delayDays, returnToQueueOnReply } = req.body;
    if (typeof enabled === 'boolean') followupAutomationConfig.enabled = enabled;
    if (messages && typeof messages === 'object') {
      followupAutomationConfig.messages = { ...followupAutomationConfig.messages, ...messages };
    }
    if (Array.isArray(stages)) followupAutomationConfig.stages = stages;
    if (typeof delaySeconds === 'number') followupAutomationConfig.delaySeconds = delaySeconds;
    if (delayDays && typeof delayDays === 'object') {
      followupAutomationConfig.delayDays = { ...followupAutomationConfig.delayDays, ...delayDays };
    }
    if (typeof returnToQueueOnReply === 'boolean') followupAutomationConfig.returnToQueueOnReply = returnToQueueOnReply;

    // Persist to DB
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ('followup_automation', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(followupAutomationConfig)]
    ).catch(err => console.error('Failed to persist followup automation config:', err.message));

    res.json(followupAutomationConfig);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTOMATION FLOWS CRUD
// ═══════════════════════════════════════════════════════════════

// List all automation flows
app.get('/api/automations/flows', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT id, name, description, type, active, trigger_event as trigger, steps, stats, created_at, updated_at
       FROM automation_flows ORDER BY created_at DESC`
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

// Create automation flow
app.post('/api/automations/flows', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { id, name, description, type, active, trigger, steps, stats } = req.body;
    if (!name) return res.status(400).json({ error: 'name obrigatório' });
    const flowId = id || `af${Date.now()}`;

    await pool.query(
      `INSERT INTO automation_flows (id, name, description, type, active, trigger_event, steps, stats, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [flowId, name, description || '', type || 'custom', active || false, trigger || 'Personalizado',
       JSON.stringify(steps || []), JSON.stringify(stats || {sent:0,responded:0,converted:0}), user.id]
    );
    res.json({ success: true, id: flowId });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Update automation flow
app.put('/api/automations/flows/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    const { name, description, type, active, trigger, steps } = req.body;

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

    vals.push(id);
    await pool.query(
      `UPDATE automation_flows SET ${sets.join(', ')} WHERE id = $${idx}`, vals
    );
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Delete automation flow
app.delete('/api/automations/flows/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    await pool.query('DELETE FROM automation_flows WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Toggle automation flow active status
app.patch('/api/automations/flows/:id/toggle', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE automation_flows SET active = NOT active, updated_at = NOW() WHERE id = $1 RETURNING active`, [id]
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
    await verifyUser(req);
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
        `SELECT COUNT(DISTINCT paciente_id) as total FROM agendamentos WHERE data >= $1 AND status = 'agendado'`,
        [today]
      ),
      // Aniversariantes: pacientes com aniversário este mês
      pool.query(
        `SELECT COUNT(*) as total FROM pacientes WHERE EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(DAY FROM data_nascimento) >= EXTRACT(DAY FROM CURRENT_DATE)`
      ),
      // Desmarcações: agendamentos com status 'desmarcado' ou 'cancelado' nos últimos 30 dias
      pool.query(
        `SELECT COUNT(DISTINCT paciente_id) as total FROM agendamentos WHERE status IN ('desmarcado','cancelado') AND data >= CURRENT_DATE - INTERVAL '30 days'`
      ),
      // Faltas: agendamentos com status 'faltou' nos últimos 30 dias
      pool.query(
        `SELECT COUNT(DISTINCT paciente_id) as total FROM agendamentos WHERE status = 'faltou' AND data >= CURRENT_DATE - INTERVAL '30 days'`
      ),
      // Faltas 1ª Consulta: pacientes que faltaram e nunca tiveram consulta 'realizado'
      pool.query(
        `SELECT COUNT(DISTINCT a.paciente_id) as total FROM agendamentos a
         WHERE a.status = 'faltou'
         AND a.data >= CURRENT_DATE - INTERVAL '30 days'
         AND NOT EXISTS (SELECT 1 FROM agendamentos b WHERE b.paciente_id = a.paciente_id AND b.status IN ('realizado','confirmado','atendido'))`
      ),
      // Inadimplência: financeiro com tipo receita e valor em parcelas vencidas (simplificado: orçamentos aprovados sem receita correspondente)
      pool.query(
        `SELECT COUNT(DISTINCT o.paciente_id) as total FROM orcamentos o
         WHERE o.status = 'aprovado'
         AND NOT EXISTS (
           SELECT 1 FROM financeiro f WHERE f.paciente_id = o.paciente_id AND f.tipo = 'receita' AND f.valor >= o.valor_total
         )`
      ),
      // Orçamentos em Aberto: orçamentos com status 'pendente'
      pool.query(
        `SELECT COUNT(DISTINCT paciente_id) as total FROM orcamentos WHERE status = 'pendente'`
      ),
      // Tratamento sem Agendamento: tratamentos ativos sem agendamento futuro
      pool.query(
        `SELECT COUNT(DISTINCT t.paciente_id) as total FROM tratamentos t
         WHERE t.status IN ('planejado','em_andamento','ativo')
         AND NOT EXISTS (
           SELECT 1 FROM agendamentos a WHERE a.paciente_id = t.paciente_id AND a.data >= $1 AND a.status NOT IN ('cancelado','desmarcado','faltou')
         )`,
        [today]
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

app.get('/api/automations/solution-hours', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'solution_hours'`);
    const defaults = { inicio: '08:00', fim: '18:00', diasSemana: ['SEG','TER','QUA','QUI','SEX'] };
    res.json(rows.length > 0 ? rows[0].value : defaults);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

app.put('/api/automations/solution-hours', async (req, res) => {
  try {
    await verifyUser(req);
    const { inicio, fim, diasSemana } = req.body;
    const config = { inicio: inicio || '08:00', fim: fim || '18:00', diasSemana: diasSemana || ['SEG','TER','QUA','QUI','SEX'] };
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('solution_hours', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(config)]
    );
    res.json(config);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
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

// Helper: get first connected WhatsApp instance
async function getDefaultInstance() {
  try {
    const result = await evolutionFetch('/instance/fetchInstances');
    const instances = Array.isArray(result.data) ? result.data : [];
    const connected = instances.find(i => (i.connectionStatus || i.status) === 'open');
    return connected ? (connected.name || connected.instanceName) : null;
  } catch { return null; }
}

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
async function triggerAutomationFlows(triggerEvent, patientData) {
  try {
    const { rows: flows } = await pool.query(
      `SELECT * FROM automation_flows WHERE active = true AND trigger_event = $1`, [triggerEvent]
    );
    if (flows.length === 0) return;

    const instanceName = await getDefaultInstance();
    if (!instanceName) {
      console.warn('⚠️ Automation trigger: no connected WhatsApp instance');
      return;
    }

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
      clinica: 'Odonto Connect',
      link_agendamento: patientData.link_agendamento || '',
    };

    let totalJobs = 0;
    for (const flow of flows) {
      const steps = typeof flow.steps === 'string' ? JSON.parse(flow.steps) : flow.steps;
      if (!steps || steps.length === 0) continue;

      // Check if we already have pending jobs for this flow+phone (avoid duplicates)
      const { rows: existing } = await pool.query(
        `SELECT 1 FROM automation_jobs WHERE flow_id = $1 AND patient_phone = $2 AND status = 'pending' LIMIT 1`,
        [flow.id, phone]
      );
      if (existing.length > 0) continue;

      const now = new Date();
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const delayMs = (step.delayMinutes || 0) * 60 * 1000;
        const scheduledAt = new Date(now.getTime() + delayMs);
        const finalMessage = replaceVariables(step.message, vars);

        await pool.query(
          `INSERT INTO automation_jobs (flow_id, flow_name, step_index, patient_name, patient_phone, instance, variables, message, channel, scheduled_at, trigger_event)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [flow.id, flow.name, i, vars.nome, phone, instanceName, JSON.stringify(vars), finalMessage, step.channel || 'whatsapp', scheduledAt, triggerEvent]
        );
        totalJobs++;
      }

      // Update flow stats
      await pool.query(
        `UPDATE automation_flows SET stats = jsonb_set(stats, '{sent}', to_jsonb(COALESCE((stats->>'sent')::int, 0) + $1)) WHERE id = $2`,
        [steps.length, flow.id]
      ).catch(() => {});
    }

    if (totalJobs > 0) {
      console.log(`🤖 Automation: ${totalJobs} jobs enqueued for trigger "${triggerEvent}" → ${phone} (${flows.length} flows)`);
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

    const { rows: flowRows } = await pool.query('SELECT * FROM automation_flows WHERE id = $1', [flowId]);
    if (flowRows.length === 0) return res.status(404).json({ error: 'Fluxo não encontrado' });
    const flow = flowRows[0];
    if (!flow.active) return res.status(400).json({ error: 'Fluxo está desativado' });

    const steps = typeof flow.steps === 'string' ? JSON.parse(flow.steps) : flow.steps;
    if (!steps || steps.length === 0) return res.status(400).json({ error: 'Fluxo sem etapas' });

    const instanceName = instance || await getDefaultInstance();
    if (!instanceName) return res.status(400).json({ error: 'Nenhuma instância WhatsApp conectada' });

    const phone = normalizeWhatsappNumber(patientPhone);
    const vars = { nome: patientName || '', telefone: phone, ...(variables || {}) };
    const now = new Date();
    const jobIds = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const delayMs = (step.delayMinutes || 0) * 60 * 1000;
      const scheduledAt = new Date(now.getTime() + delayMs);
      const finalMessage = replaceVariables(step.message, vars);

      const { rows } = await pool.query(
        `INSERT INTO automation_jobs (flow_id, flow_name, step_index, patient_name, patient_phone, instance, variables, message, channel, scheduled_at, trigger_event)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual') RETURNING id`,
        [flow.id, flow.name, i, patientName || '', phone, instanceName, JSON.stringify(vars), finalMessage, step.channel || 'whatsapp', scheduledAt]
      );
      jobIds.push(rows[0].id);
    }

    await pool.query(
      `UPDATE automation_flows SET stats = jsonb_set(stats, '{sent}', to_jsonb(COALESCE((stats->>'sent')::int, 0) + $1)) WHERE id = $2`,
      [steps.length, flow.id]
    ).catch(() => {});

    console.log(`🤖 Manual enqueue: ${steps.length} jobs for flow "${flow.name}" → ${phone}`);
    res.json({ success: true, jobsCreated: jobIds.length, jobIds });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// List automation jobs
app.get('/api/automations/jobs', async (req, res) => {
  try {
    await verifyUser(req);
    const { status, flowId, limit } = req.query;
    let sql = 'SELECT * FROM automation_jobs';
    const vals = [];
    const where = [];
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
    await verifyUser(req);
    const { flowId, patientPhone } = req.body || {};
    let sql = `UPDATE automation_jobs SET status = 'cancelled' WHERE status = 'pending'`;
    const vals = [];
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
    await verifyUser(req);
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
      WHERE created_at >= NOW() - INTERVAL '${daysInt} days'
    `);

    // Per-flow stats
    const { rows: perFlow } = await pool.query(`
      SELECT
        flow_id, flow_name,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending
      FROM automation_jobs
      WHERE created_at >= NOW() - INTERVAL '${daysInt} days'
      GROUP BY flow_id, flow_name
      ORDER BY total DESC
    `);

    // Daily timeline
    const { rows: timeline } = await pool.query(`
      SELECT
        DATE(scheduled_at) AS date,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) AS total
      FROM automation_jobs
      WHERE created_at >= NOW() - INTERVAL '${daysInt} days'
      GROUP BY DATE(scheduled_at)
      ORDER BY date ASC
    `);

    // Per-flow stats from automation_flows table (includes responded/converted)
    const { rows: flowStats } = await pool.query(`
      SELECT id, name, active,
        COALESCE((stats->>'sent')::int, 0) AS sent,
        COALESCE((stats->>'responded')::int, 0) AS responded,
        COALESCE((stats->>'converted')::int, 0) AS converted
      FROM automation_flows
      ORDER BY sent DESC
    `);

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
app.get('/api/campaigns', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT * FROM broadcast_campaigns ORDER BY created_at DESC`
    );
    const campaigns = rows.map(r => ({
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
    }));
    res.json(campaigns);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Create campaign
app.post('/api/campaigns', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { nome, template, tipo, diasSemana, horarioInicio, horarioFim, dataInicio, dataFim,
      campanhaPerpetua, usarHorarioClinica, publico, filtroCustom, numeroEnvio,
      contatosAlcancaveis, capacidadeDiaria, intervaloSpam, ativo } = req.body;

    if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });

    const id = `camp_${Date.now()}`;
    await pool.query(
      `INSERT INTO broadcast_campaigns
        (id, nome, template, tipo, dias_semana, horario_inicio, horario_fim, data_inicio, data_fim,
         campanha_perpetua, usar_horario_clinica, publico, filtro_custom, numero_envio,
         contatos_alcancaveis, capacidade_diaria, intervalo_spam, ativo, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id, nome, JSON.stringify(template || {}), tipo || 'unico',
       JSON.stringify(diasSemana || []), horarioInicio, horarioFim, dataInicio, dataFim,
       campanhaPerpetua || false, usarHorarioClinica || false,
       publico || 'todos', filtroCustom, numeroEnvio,
       contatosAlcancaveis || 0, capacidadeDiaria || 232, intervaloSpam || 7,
       ativo || false, user.id]
    );
    res.json({ success: true, id });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Update campaign
app.put('/api/campaigns/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    const fields = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

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
    vals.push(id);
    await pool.query(`UPDATE broadcast_campaigns SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Delete campaign
app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    await pool.query('DELETE FROM broadcast_campaigns WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Toggle campaign active
app.patch('/api/campaigns/:id/toggle', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    const { rows } = await pool.query(
      `UPDATE broadcast_campaigns SET ativo = NOT ativo, updated_at = NOW() WHERE id = $1 RETURNING ativo`, [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json({ success: true, ativo: rows[0].ativo });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Duplicate campaign
app.post('/api/campaigns/:id/duplicate', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    const { rows } = await pool.query('SELECT * FROM broadcast_campaigns WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Campanha não encontrada' });
    const orig = rows[0];
    const newId = `camp_${Date.now()}`;
    await pool.query(
      `INSERT INTO broadcast_campaigns
        (id, nome, template, tipo, dias_semana, horario_inicio, horario_fim, data_inicio, data_fim,
         campanha_perpetua, usar_horario_clinica, publico, filtro_custom, numero_envio,
         contatos_alcancaveis, capacidade_diaria, intervalo_spam, ativo, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [newId, orig.nome + ' (cópia)', orig.template, orig.tipo, orig.dias_semana,
       orig.horario_inicio, orig.horario_fim, orig.data_inicio, orig.data_fim,
       orig.campanha_perpetua, orig.usar_horario_clinica, orig.publico, orig.filtro_custom,
       orig.numero_envio, orig.contatos_alcancaveis, orig.capacidade_diaria,
       orig.intervalo_spam, false, orig.created_by]
    );
    res.json({ success: true, id: newId });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Execute campaign — resolve contacts by audience, enqueue jobs
app.post('/api/campaigns/:id/execute', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;

    const { rows: campRows } = await pool.query('SELECT * FROM broadcast_campaigns WHERE id = $1', [id]);
    if (campRows.length === 0) return res.status(404).json({ error: 'Campanha não encontrada' });
    const camp = campRows[0];
    const template = typeof camp.template === 'string' ? JSON.parse(camp.template) : camp.template;
    const message = template?.mensagem || template?.message || '';
    if (!message) return res.status(400).json({ error: 'Template sem mensagem configurada' });

    // Resolve instance
    let instance = camp.numero_envio;
    if (!instance) {
      try {
        const instResult = await evolutionFetch('/instance/fetchInstances');
        const connected = (Array.isArray(instResult.data) ? instResult.data : [])
          .filter(i => (i.connectionStatus || i.status) === 'open');
        if (connected.length > 0) instance = connected[0].name || connected[0].instanceName;
      } catch {}
    }
    if (!instance) return res.status(400).json({ error: 'Nenhuma instância WhatsApp conectada' });

    // Resolve contacts by audience type
    let contacts = [];
    const publico = camp.publico || 'todos';

    if (publico === 'todos') {
      const { rows } = await pool.query(
        `SELECT DISTINCT COALESCE(c.nome, cl.nome) AS nome, COALESCE(c.telefone, cl.telefone) AS telefone
         FROM crm_leads cl LEFT JOIN contatos c ON c.telefone = cl.telefone
         WHERE COALESCE(c.telefone, cl.telefone) IS NOT NULL AND COALESCE(c.telefone, cl.telefone) != ''
         LIMIT $1`, [camp.capacidade_diaria || 232]);
      contacts = rows;
    } else if (publico === 'ativos') {
      const { rows } = await pool.query(
        `SELECT DISTINCT cl.nome, cl.telefone FROM crm_leads cl
         INNER JOIN chat_messages cm ON cm.phone = cl.telefone
         WHERE cl.telefone IS NOT NULL AND cl.telefone != '' AND cm.timestamp > NOW() - INTERVAL '180 days'
         LIMIT $1`, [camp.capacidade_diaria || 232]);
      contacts = rows;
    } else if (publico === 'inativos') {
      const { rows } = await pool.query(
        `SELECT DISTINCT cl.nome, cl.telefone FROM crm_leads cl
         LEFT JOIN chat_messages cm ON cm.phone = cl.telefone AND cm.timestamp > NOW() - INTERVAL '90 days'
         WHERE cl.telefone IS NOT NULL AND cl.telefone != '' AND cm.id IS NULL
         LIMIT $1`, [camp.capacidade_diaria || 232]);
      contacts = rows;
    } else if (publico === 'aniversariantes') {
      const { rows } = await pool.query(
        `SELECT nome, telefone FROM contatos
         WHERE telefone IS NOT NULL AND telefone != '' AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM NOW())
         LIMIT $1`, [camp.capacidade_diaria || 232]);
      contacts = rows;
    } else {
      const { rows } = await pool.query(
        `SELECT DISTINCT COALESCE(c.nome, cl.nome) AS nome, COALESCE(c.telefone, cl.telefone) AS telefone
         FROM crm_leads cl LEFT JOIN contatos c ON c.telefone = cl.telefone
         WHERE COALESCE(c.telefone, cl.telefone) IS NOT NULL AND COALESCE(c.telefone, cl.telefone) != ''
         LIMIT $1`, [camp.capacidade_diaria || 232]);
      contacts = rows;
    }

    if (contacts.length === 0) return res.json({ success: true, enqueued: 0, message: 'Nenhum contato encontrado para este público' });

    // Anti-spam: skip contacts that received this campaign within intervalo_spam days
    const spamDays = camp.intervalo_spam || 7;
    const { rows: recentlySent } = await pool.query(
      `SELECT DISTINCT patient_phone FROM automation_jobs
       WHERE trigger_event = 'campaign' AND status = 'sent' AND sent_at > NOW() - INTERVAL '1 day' * $1 AND flow_id = $2`,
      [spamDays, id]);
    const recentPhones = new Set(recentlySent.map(r => normalizeWhatsappNumber(r.patient_phone)));

    // Enqueue jobs with 2s stagger
    let enqueued = 0;
    const now = new Date();
    for (const contact of contacts) {
      const phone = normalizeWhatsappNumber(contact.telefone);
      if (recentPhones.has(phone)) continue;

      const personalizedMsg = message
        .replace(/\{\{nome\}\}/gi, contact.nome || 'Cliente')
        .replace(/\{\{telefone\}\}/gi, contact.telefone || '');

      const scheduledAt = new Date(now.getTime() + enqueued * 2000);
      await pool.query(
        `INSERT INTO automation_jobs (flow_id, flow_name, step_index, patient_name, patient_phone, instance, message, channel, status, scheduled_at, trigger_event)
         VALUES ($1, $2, 0, $3, $4, $5, $6, 'whatsapp', 'pending', $7, 'campaign')`,
        [id, camp.nome, contact.nome, phone, instance, personalizedMsg, scheduledAt]);
      enqueued++;
    }

    // Update campaign stats
    await pool.query(
      `UPDATE broadcast_campaigns SET ativo = true,
        stats = jsonb_set(stats, '{enviadas}', to_jsonb(COALESCE((stats->>'enviadas')::int, 0) + $1)),
        contatos_alcancaveis = $2, updated_at = NOW()
       WHERE id = $3`, [enqueued, contacts.length, id]);

    console.log(`📢 Campaign "${camp.nome}" executed: ${enqueued} enqueued (${contacts.length - enqueued} skipped by spam filter)`);
    res.json({ success: true, enqueued, total: contacts.length, skipped: contacts.length - enqueued });
  } catch (error) {
    console.error('❌ Campaign execute error:', error.message);
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Campaign job stats
app.get('/api/campaigns/:id/jobs', async (req, res) => {
  try {
    await verifyUser(req);
    const { id } = req.params;
    const { rows: summary } = await pool.query(
      `SELECT status, COUNT(*)::int AS count FROM automation_jobs WHERE flow_id = $1 AND trigger_event = 'campaign' GROUP BY status`, [id]);
    const { rows: recent } = await pool.query(
      `SELECT patient_name, patient_phone, status, sent_at, error, scheduled_at
       FROM automation_jobs WHERE flow_id = $1 AND trigger_event = 'campaign' ORDER BY created_at DESC LIMIT 50`, [id]);
    res.json({ summary: Object.fromEntries(summary.map(s => [s.status, s.count])), recent });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Campaign scheduler — auto-execute recurrent campaigns
let campaignSchedulerInterval = null;

async function processCampaignScheduler() {
  try {
    const { rows: activeCampaigns } = await pool.query(
      `SELECT * FROM broadcast_campaigns WHERE ativo = true AND tipo = 'recorrente'`);
    if (activeCampaigns.length === 0) return;

    const now = new Date();
    const currentDay = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'][now.getDay()];
    const currentTime = now.toTimeString().slice(0, 5);

    for (const camp of activeCampaigns) {
      const diasSemana = typeof camp.dias_semana === 'string' ? JSON.parse(camp.dias_semana) : (camp.dias_semana || []);
      if (diasSemana.length > 0 && !diasSemana.includes(currentDay)) continue;
      if (camp.horario_inicio && currentTime < camp.horario_inicio) continue;
      if (camp.horario_fim && currentTime > camp.horario_fim) continue;

      // Skip if already executed today
      const { rows: todayJobs } = await pool.query(
        `SELECT 1 FROM automation_jobs WHERE flow_id = $1 AND trigger_event = 'campaign' AND created_at::date = CURRENT_DATE LIMIT 1`, [camp.id]);
      if (todayJobs.length > 0) continue;

      console.log(`📢 Auto-executing campaign "${camp.nome}" (${currentDay} ${currentTime})`);
      try {
        const template = typeof camp.template === 'string' ? JSON.parse(camp.template) : camp.template;
        const message = template?.mensagem || template?.message || '';
        if (!message) continue;

        let instance = camp.numero_envio;
        if (!instance) {
          const instResult = await evolutionFetch('/instance/fetchInstances');
          const connected = (Array.isArray(instResult.data) ? instResult.data : [])
            .filter(i => (i.connectionStatus || i.status) === 'open');
          if (connected.length > 0) instance = connected[0].name || connected[0].instanceName;
        }
        if (!instance) continue;

        let contacts = [];
        const publico = camp.publico || 'todos';
        const limit = [camp.capacidade_diaria || 232];

        if (publico === 'ativos') {
          const { rows } = await pool.query(
            `SELECT DISTINCT cl.nome, cl.telefone FROM crm_leads cl
             INNER JOIN chat_messages cm ON cm.phone = cl.telefone
             WHERE cl.telefone IS NOT NULL AND cl.telefone != '' AND cm.timestamp > NOW() - INTERVAL '180 days'
             LIMIT $1`, limit);
          contacts = rows;
        } else if (publico === 'inativos') {
          const { rows } = await pool.query(
            `SELECT DISTINCT cl.nome, cl.telefone FROM crm_leads cl
             LEFT JOIN chat_messages cm ON cm.phone = cl.telefone AND cm.timestamp > NOW() - INTERVAL '90 days'
             WHERE cl.telefone IS NOT NULL AND cl.telefone != '' AND cm.id IS NULL LIMIT $1`, limit);
          contacts = rows;
        } else if (publico === 'aniversariantes') {
          const { rows } = await pool.query(
            `SELECT nome, telefone FROM contatos
             WHERE telefone IS NOT NULL AND telefone != '' AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM NOW())
             LIMIT $1`, limit);
          contacts = rows;
        } else {
          const { rows } = await pool.query(
            `SELECT DISTINCT COALESCE(c.nome, cl.nome) AS nome, COALESCE(c.telefone, cl.telefone) AS telefone
             FROM crm_leads cl LEFT JOIN contatos c ON c.telefone = cl.telefone
             WHERE COALESCE(c.telefone, cl.telefone) IS NOT NULL AND COALESCE(c.telefone, cl.telefone) != ''
             LIMIT $1`, limit);
          contacts = rows;
        }

        const spamDays = camp.intervalo_spam || 7;
        const { rows: recentlySent } = await pool.query(
          `SELECT DISTINCT patient_phone FROM automation_jobs
           WHERE trigger_event = 'campaign' AND status = 'sent' AND sent_at > NOW() - INTERVAL '1 day' * $1 AND flow_id = $2`,
          [spamDays, camp.id]);
        const recentPhones = new Set(recentlySent.map(r => normalizeWhatsappNumber(r.patient_phone)));

        let enqueued = 0;
        const enqueueTime = new Date();
        for (const contact of contacts) {
          const phone = normalizeWhatsappNumber(contact.telefone);
          if (recentPhones.has(phone)) continue;
          const personalizedMsg = message.replace(/\{\{nome\}\}/gi, contact.nome || 'Cliente').replace(/\{\{telefone\}\}/gi, contact.telefone || '');
          const scheduledAt = new Date(enqueueTime.getTime() + enqueued * 2000);
          await pool.query(
            `INSERT INTO automation_jobs (flow_id, flow_name, step_index, patient_name, patient_phone, instance, message, channel, status, scheduled_at, trigger_event)
             VALUES ($1, $2, 0, $3, $4, $5, $6, 'whatsapp', 'pending', $7, 'campaign')`,
            [camp.id, camp.nome, contact.nome, phone, instance, personalizedMsg, scheduledAt]);
          enqueued++;
        }

        if (enqueued > 0) {
          await pool.query(
            `UPDATE broadcast_campaigns SET stats = jsonb_set(stats, '{enviadas}', to_jsonb(COALESCE((stats->>'enviadas')::int, 0) + $1)), updated_at = NOW() WHERE id = $2`,
            [enqueued, camp.id]);
          console.log(`   ✅ Campaign "${camp.nome}" auto-enqueued ${enqueued} messages`);
        }
      } catch (campErr) {
        console.error(`   ❌ Campaign "${camp.nome}" auto-execute error:`, campErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Campaign scheduler error:', err.message);
  }
}

let automationSchedulerInterval = null;

async function processAutomationJobs() {
  try {
    const { rows: dueJobs } = await pool.query(
      `SELECT * FROM automation_jobs WHERE status = 'pending' AND scheduled_at <= NOW() ORDER BY scheduled_at ASC LIMIT 20`
    );
    if (dueJobs.length === 0) return;

    console.log(`🤖 Scheduler: processing ${dueJobs.length} due jobs`);

    for (const job of dueJobs) {
      try {
        if (job.channel === 'whatsapp') {
          const phone = normalizeWhatsappNumber(job.patient_phone);
          const whatsappNumber = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;

          const result = await evolutionFetch(`/message/sendText/${job.instance}`, {
            method: 'POST',
            body: JSON.stringify({ number: whatsappNumber, text: job.message }),
          });

          if (result.ok) {
            await pool.query(`UPDATE automation_jobs SET status = 'sent', sent_at = NOW() WHERE id = $1`, [job.id]);
            console.log(`   ✅ Sent step ${job.step_index} to ${job.patient_phone} (${job.flow_name})`);
          } else {
            const errMsg = JSON.stringify(result.data).slice(0, 200);
            await pool.query(`UPDATE automation_jobs SET status = 'failed', error = $1 WHERE id = $2`, [errMsg, job.id]);
            console.error(`   ❌ Failed step ${job.step_index} to ${job.patient_phone}: ${errMsg}`);
          }
        } else {
          await pool.query(
            `UPDATE automation_jobs SET status = 'failed', error = $1 WHERE id = $2`,
            [`Canal "${job.channel}" não suportado ainda`, job.id]
          );
        }
      } catch (jobErr) {
        await pool.query(
          `UPDATE automation_jobs SET status = 'failed', error = $1 WHERE id = $2`,
          [jobErr.message.slice(0, 500), job.id]
        );
        console.error(`   ❌ Job ${job.id} error:`, jobErr.message);
      }
    }
  } catch (err) {
    console.error('❌ Automation scheduler error:', err.message);
  }
}

// ─── Cron: Appointment Reminders 24h (runs every 1h) ────────
let appointmentReminderInterval = null;

async function processAppointmentReminders() {
  try {
    const instanceName = await getDefaultInstance();
    if (!instanceName) return;

    // Find appointments scheduled for tomorrow that haven't been reminded yet
    const { rows: appointments } = await pool.query(`
      SELECT a.id, a.paciente_id, a.paciente_nome, a.dentista_nome, a.data, a.hora, a.procedimento, a.duracao,
             p.telefone
      FROM agendamentos a
      LEFT JOIN pacientes p ON p.id = a.paciente_id
      WHERE a.data = (CURRENT_DATE + INTERVAL '1 day')::date
        AND a.status NOT IN ('cancelado', 'desmarcado', 'faltou', 'finalizado', 'realizado')
        AND a.id NOT IN (
          SELECT REPLACE(flow_id, 'reminder_', '') FROM automation_jobs
          WHERE trigger_event = 'appointment_reminder' AND status IN ('pending', 'sent')
        )
    `);

    if (appointments.length === 0) return;
    console.log(`🔔 Reminder: ${appointments.length} consultas amanhã para lembrar`);

    for (const appt of appointments) {
      const phone = normalizeWhatsappNumber(appt.telefone || '');
      if (!phone) continue;

      const [y, m, d] = (appt.data instanceof Date ? appt.data.toISOString().split('T')[0] : String(appt.data)).split('-');
      const dataBR = `${d}/${m}/${y}`;
      const firstName = (appt.paciente_nome || '').split(' ')[0];

      const message = `🔔 *Lembrete de Consulta*\n\nOlá, ${firstName}! 👋\n\nLembramos que você tem uma consulta agendada para *amanhã*:\n\n📅 *Data:* ${dataBR}\n⏰ *Horário:* ${appt.hora}\n🦷 *Procedimento:* ${appt.procedimento || 'Consulta'}\n👨‍⚕️ *Profissional:* ${appt.dentista_nome || '—'}\n\nPor favor, confirme sua presença respondendo *SIM* ou entre em contato para reagendar.\n\n_Odonto Connect_`;

      await pool.query(
        `INSERT INTO automation_jobs (flow_id, flow_name, step_index, patient_name, patient_phone, instance, message, channel, scheduled_at, trigger_event, status)
         VALUES ($1, $2, 0, $3, $4, $5, $6, 'whatsapp', NOW(), 'appointment_reminder', 'pending')`,
        [`reminder_${appt.id}`, 'Lembrete 24h', appt.paciente_nome, phone, instanceName, message]
      );
      console.log(`   📩 Lembrete enfileirado para ${appt.paciente_nome} (${phone})`);
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
        `SELECT DISTINCT cl.id, cl.nome, cl.telefone FROM crm_leads cl
         LEFT JOIN chat_messages cm ON cm.phone = cl.telefone AND cm.timestamp > NOW() - INTERVAL '${days} days'
         WHERE cl.telefone IS NOT NULL AND cl.telefone != '' AND cm.id IS NULL
         LIMIT 50`
      );

      for (const lead of inactiveLeads) {
        await triggerAutomationFlows(trigger, { name: lead.nome, phone: lead.telefone });
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
    // Check business hours config
    const { rows: settingsRows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'solution_hours'`
    );
    const hoursConfig = settingsRows.length > 0 ? settingsRows[0].value : { inicio: '08:00', fim: '18:00', diasSemana: ['SEG','TER','QUA','QUI','SEX'] };

    const now = new Date();
    const currentTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
    const currentDay = ['DOM','SEG','TER','QUA','QUI','SEX','SAB'][now.getDay()];

    if (hoursConfig.inicio && currentTime < hoursConfig.inicio) {
      return; // Before business hours
    }
    if (hoursConfig.fim && currentTime > hoursConfig.fim) {
      return; // After business hours
    }
    if (hoursConfig.diasSemana && hoursConfig.diasSemana.length > 0 && !hoursConfig.diasSemana.includes(currentDay)) {
      return; // Not a business day
    }

    const today = now.toISOString().slice(0, 10);

    // Map each solution trigger to its query
    const solutionQueries = [
      {
        trigger: 'Agendamento criado sem confirmação',
        query: `SELECT DISTINCT p.id, p.nome, p.telefone, a.procedimento, a.data::text, a.hora::text as horario,
                  d.nome as dentista
                FROM agendamentos a
                JOIN pacientes p ON a.paciente_id = p.id
                LEFT JOIN dentistas d ON a.dentista_id = d.id
                WHERE a.data >= $1 AND a.data <= ($1::date + INTERVAL '2 days')
                AND a.status = 'agendado'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                LIMIT 100`,
        params: [today],
      },
      {
        trigger: 'Data de aniversário do paciente',
        query: `SELECT id, nome, telefone FROM pacientes
                WHERE EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
                AND EXTRACT(DAY FROM data_nascimento) = EXTRACT(DAY FROM CURRENT_DATE)
                AND telefone IS NOT NULL AND telefone != ''
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Consulta desmarcada pelo paciente',
        query: `SELECT DISTINCT p.id, p.nome, p.telefone, a.procedimento
                FROM agendamentos a
                JOIN pacientes p ON a.paciente_id = p.id
                WHERE a.status IN ('desmarcado','cancelado')
                AND a.updated_at >= NOW() - INTERVAL '24 hours'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Paciente não compareceu à consulta',
        query: `SELECT DISTINCT p.id, p.nome, p.telefone, a.procedimento
                FROM agendamentos a
                JOIN pacientes p ON a.paciente_id = p.id
                WHERE a.status = 'faltou'
                AND a.data >= CURRENT_DATE - INTERVAL '1 day'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Paciente faltou à primeira consulta',
        query: `SELECT DISTINCT p.id, p.nome, p.telefone, a.procedimento
                FROM agendamentos a
                JOIN pacientes p ON a.paciente_id = p.id
                WHERE a.status = 'faltou'
                AND a.data >= CURRENT_DATE - INTERVAL '1 day'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                AND NOT EXISTS (
                  SELECT 1 FROM agendamentos b
                  WHERE b.paciente_id = a.paciente_id
                  AND b.status IN ('realizado','confirmado','atendido')
                )
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Parcela ou pagamento em atraso',
        query: `SELECT DISTINCT p.id, p.nome, p.telefone, o.valor_total::text as valor
                FROM orcamentos o
                JOIN pacientes p ON o.paciente_id = p.id
                WHERE o.status = 'aprovado'
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
        query: `SELECT DISTINCT p.id, p.nome, p.telefone,
                  (o.itens::jsonb->0->>'procedimento')::text as procedimento,
                  ('R$ ' || o.valor_total::text) as valor
                FROM orcamentos o
                JOIN pacientes p ON o.paciente_id = p.id
                WHERE o.status = 'pendente'
                AND o.created_at >= NOW() - INTERVAL '30 days'
                AND p.telefone IS NOT NULL AND p.telefone != ''
                LIMIT 100`,
        params: [],
      },
      {
        trigger: 'Tratamento ativo sem agendamento futuro',
        query: `SELECT DISTINCT p.id, p.nome, p.telefone, t.descricao as procedimento
                FROM tratamentos t
                JOIN pacientes p ON t.paciente_id = p.id
                WHERE t.status IN ('planejado','em_andamento','ativo')
                AND p.telefone IS NOT NULL AND p.telefone != ''
                AND NOT EXISTS (
                  SELECT 1 FROM agendamentos a
                  WHERE a.paciente_id = t.paciente_id
                  AND a.data >= $1
                  AND a.status NOT IN ('cancelado','desmarcado','faltou')
                )
                LIMIT 100`,
        params: [today],
      },
    ];

    let totalTriggered = 0;

    for (const sol of solutionQueries) {
      // Check if there's an active flow using this trigger
      const { rows: activeFlows } = await pool.query(
        `SELECT 1 FROM automation_flows WHERE active = true AND trigger_event = $1 LIMIT 1`,
        [sol.trigger]
      );
      if (activeFlows.length === 0) continue;

      // Run the query to find matching patients
      const { rows: patients } = await pool.query(sol.query, sol.params);
      if (patients.length === 0) continue;

      for (const patient of patients) {
        // Check cooldown: don't re-trigger same patient+trigger within 24h
        const { rows: recent } = await pool.query(
          `SELECT 1 FROM automation_jobs
           WHERE patient_phone LIKE '%' || $1 || '%'
           AND trigger_event = $2
           AND created_at > NOW() - INTERVAL '24 hours'
           LIMIT 1`,
          [patient.telefone.replace(/\D/g, '').slice(-11), sol.trigger]
        );
        if (recent.length > 0) continue;

        await triggerAutomationFlows(sol.trigger, {
          name: patient.nome,
          phone: patient.telefone,
          procedimento: patient.procedimento || '',
          valor: patient.valor || '',
          horario: patient.horario || '',
          data: patient.data || '',
          dentista: patient.dentista || '',
        });
        totalTriggered++;
      }

      if (patients.length > 0) {
        console.log(`🤖 Solution "${sol.trigger}": ${patients.length} pacientes encontrados, ${totalTriggered} triggered`);
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
    const { stage, reason } = req.body;
    if (!stage || !ALL_KANBAN_STAGES.includes(stage)) {
      return res.status(400).json({ error: `Stage inválido. Válidos: ${ALL_KANBAN_STAGES.join(', ')}` });
    }

    // Get current stage for audit
    const { rows: current } = await pool.query('SELECT kanban_stage FROM crm_leads WHERE id = $1', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    const fromStage = current[0].kanban_stage;

    const { rows } = await pool.query(
      `UPDATE crm_leads SET kanban_stage = $1, status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, nome, kanban_stage`,
      [stage, req.params.id]
    );

    // Log movement
    const profile = await getProfileByEmail(user.email);
    await pool.query(
      `INSERT INTO kanban_movements (lead_id, from_stage, to_stage, moved_by, moved_by_name, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, fromStage, stage, user.id, profile?.name || user.email, reason || null]
    ).catch(err => console.error('Failed to log kanban movement:', err.message));

    // 🤖 Trigger follow-up automation if entering a follow-up stage
    if (RECOVERY_STAGES.includes(stage) && stage.startsWith('followup')) {
      triggerFollowupAutomation(req.params.id, stage).catch(() => {});
    }

    // 🤖 Trigger automation flows based on stage change
    const leadForAutomation = rows[0];
    if (leadForAutomation) {
      const { rows: leadDetail } = await pool.query('SELECT nome, telefone FROM crm_leads WHERE id = $1', [req.params.id]).catch(() => ({ rows: [] }));
      const ld = leadDetail[0];
      if (ld?.telefone) {
        // Orçamento stage → trigger budget follow-up
        if (stage === 'orcamento' || stage === 'orcamento_enviado') {
          triggerAutomationFlows('Orçamento criado e não fechado', { name: ld.nome, phone: ld.telefone }).catch(() => {});
        }
        // Lead entering CRM stage
        if (stage === 'lead' && fromStage !== 'lead') {
          triggerAutomationFlows('Lead entrou no CRM', { name: ld.nome, phone: ld.telefone }).catch(() => {});
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
    await verifyUser(req);
    const { level } = req.body;
    if (!level || !VALID_CONSCIOUSNESS.includes(level)) {
      return res.status(400).json({ error: `Nível inválido. Válidos: ${VALID_CONSCIOUSNESS.join(', ')}` });
    }
    const { rows } = await pool.query(
      `UPDATE crm_leads SET consciousness_level = $1, updated_at = NOW() WHERE id = $2 RETURNING id, nome, consciousness_level`,
      [level, req.params.id]
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
    await verifyUser(req);
    const { assignedTo, assignedToName } = req.body;
    const { rows } = await pool.query(
      `UPDATE crm_leads SET assigned_to = $1, assigned_to_name = $2, updated_at = NOW() WHERE id = $3 RETURNING id, nome, assigned_to, assigned_to_name`,
      [assignedTo || null, assignedToName || null, req.params.id]
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
    await verifyUser(req);
    const { id } = req.params;

    // Fetch lead data
    const { rows: leadRows } = await pool.query(
      'SELECT id, nome, telefone, email, cpf, origem, observacoes FROM crm_leads WHERE id = $1', [id]
    );
    if (leadRows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    const lead = leadRows[0];

    // Check if patient already exists with same phone
    if (lead.telefone) {
      const clean = lead.telefone.replace(/\D/g, '');
      const { rows: existing } = await pool.query(
        "SELECT id, nome, telefone FROM pacientes WHERE REPLACE(REPLACE(REPLACE(telefone, ' ', ''), '-', ''), '+', '') LIKE '%' || $1", [clean.slice(-8)]
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
      'INSERT INTO pacientes (id, nome, cpf, telefone, email, observacoes) VALUES ($1,$2,$3,$4,$5,$6)',
      [pacienteId, lead.nome, lead.cpf || null, lead.telefone || null, lead.email || null, `Origem CRM: ${lead.origem || '—'}. ${lead.observacoes || ''}`]
    );

    // Update lead status to 'paciente' and link paciente_id
    await pool.query("UPDATE crm_leads SET status = 'paciente', paciente_id = $2, updated_at = NOW() WHERE id = $1", [id, pacienteId]);

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
    await verifyUser(req);
    const { id } = req.params;
    const { paciente_id } = req.body;
    if (!paciente_id) return res.status(400).json({ error: 'paciente_id obrigatório' });

    // Verify lead exists
    const { rows: leadRows } = await pool.query('SELECT id, nome FROM crm_leads WHERE id = $1', [id]);
    if (leadRows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });

    // Verify patient exists
    const { rows: pacRows } = await pool.query('SELECT id, nome FROM pacientes WHERE id = $1', [paciente_id]);
    if (pacRows.length === 0) return res.status(404).json({ error: 'Paciente não encontrado' });

    // Link: update lead with paciente_id and status
    await pool.query("UPDATE crm_leads SET paciente_id = $2, status = 'paciente', updated_at = NOW() WHERE id = $1", [id, paciente_id]);

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
    await verifyUser(req);
    const { id } = req.params;

    // Get lead's paciente_id and phone
    const { rows: leadRows } = await pool.query('SELECT paciente_id, telefone FROM crm_leads WHERE id = $1', [id]);
    if (leadRows.length === 0) return res.status(404).json({ error: 'Lead não encontrado' });
    const { paciente_id, telefone } = leadRows[0];

    let appointments = [];
    if (paciente_id) {
      const { rows } = await pool.query(
        `SELECT a.id, a.data, a.hora, a.procedimento, a.status, d.nome as dentista_nome
         FROM agendamentos a LEFT JOIN dentistas d ON a.dentista_id = d.id
         WHERE a.paciente_id = $1 ORDER BY a.data DESC, a.hora DESC LIMIT 10`,
        [paciente_id]
      );
      appointments = rows;
    } else if (telefone) {
      // Try matching by phone
      const clean = telefone.replace(/\D/g, '');
      const { rows } = await pool.query(
        `SELECT a.id, a.data, a.hora, a.procedimento, a.status, d.nome as dentista_nome
         FROM agendamentos a
         LEFT JOIN dentistas d ON a.dentista_id = d.id
         LEFT JOIN pacientes p ON a.paciente_id = p.id
         WHERE REPLACE(REPLACE(REPLACE(p.telefone, ' ', ''), '-', ''), '+', '') LIKE '%' || $1
         ORDER BY a.data DESC, a.hora DESC LIMIT 10`,
        [clean.slice(-8)]
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
    await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT * FROM kanban_movements WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// List all CRM leads (with optional kanban grouping + server-side pagination)
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
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });

    await pool.query(
      `UPDATE attendance_sessions SET 
         first_response_at = COALESCE(first_response_at, NOW()),
         response_time_seconds = COALESCE(response_time_seconds, EXTRACT(EPOCH FROM (NOW() - assigned_at))::INTEGER)
       WHERE lead_id = $1 AND status = 'active' AND first_response_at IS NULL`,
      [leadId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
       WHERE lead_id = $1 AND status = 'active'
       RETURNING id, duration_seconds, attendant_id, attendant_name`,
      [leadId]
    );

    const session = result.rows[0];

    // Send satisfaction survey via WhatsApp buttons
    if (leadPhone && instance && EVOLUTION_API_KEY) {
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
        console.log(`📊 Satisfaction survey sent to ${phone}`);
      } catch (btnErr) {
        // Fallback: text-based survey
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({
            number: phone,
            text: `⭐ *Avalie nosso atendimento!*\n\nComo você avalia o atendimento que recebeu?\n\n5️⃣ Excelente\n4️⃣ Bom\n3️⃣ Regular\n2️⃣ Ruim\n1️⃣ Péssimo\n\nResponda com o número da sua avaliação.`,
          }),
        });
        console.log(`📊 Satisfaction survey (text fallback) sent to ${phone}`);
      }

      // Mark lead as awaiting rating
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) 
         VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [`awaiting_rating_${phone}`, JSON.stringify({ leadId, sessionId: session?.id, attendantId: session?.attendant_id, attendantName: session?.attendant_name })]
      );
    }

    console.log(`✅ Session closed for lead ${leadId} (duration: ${session?.duration_seconds || 0}s)`);

    // 🤖 Trigger "Após consulta finalizada" automation
    if (leadPhone) {
      const leadName = session?.attendant_name || leadId;
      // Get lead name from DB
      const { rows: leadRows } = await pool.query('SELECT nome FROM crm_leads WHERE id = $1', [leadId]).catch(() => ({ rows: [] }));
      const name = leadRows[0]?.nome || leadId;
      triggerAutomationFlows('Após consulta finalizada', { name, phone: leadPhone }).catch(() => {});
      triggerAutomationFlows('Atendimento finalizado sem agendamento', { name, phone: leadPhone }).catch(() => {});
    }

    res.json({ success: true, sessionId: session?.id, duration: session?.duration_seconds });
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Get metrics (general + per attendant)
app.get('/api/metrics/attendance', async (req, res) => {
  try {
    await verifyUser(req);
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
      WHERE created_at >= ${since}
    `);

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
      WHERE attendant_id IS NOT NULL AND created_at >= ${since}
      GROUP BY attendant_id, attendant_name
      ORDER BY total_sessions DESC
    `);

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
      WHERE created_at >= ${since}
    `);

    // Satisfaction per attendant
    const { rows: satisfactionPerAttendant } = await pool.query(`
      SELECT 
        attendant_id, attendant_name,
        ROUND(AVG(rating)::NUMERIC, 1) as avg_rating,
        COUNT(*) as total_ratings
      FROM satisfaction_ratings
      WHERE attendant_id IS NOT NULL AND created_at >= ${since}
      GROUP BY attendant_id, attendant_name
      ORDER BY avg_rating DESC
    `);

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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM lead_tags ORDER BY created_at ASC');
    res.json(rows);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Create tag
app.post('/api/tags', async (req, res) => {
  try {
    await verifyUser(req);
    const { name, color, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const { rows } = await pool.query(
      'INSERT INTO lead_tags (name, color, icon) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), color || '#3B82F6', icon || '📌']
    );
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update tag
app.put('/api/tags/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { name, color, icon } = req.body;
    await pool.query(
      'UPDATE lead_tags SET name = COALESCE($1, name), color = COALESCE($2, color), icon = COALESCE($3, icon), updated_at = NOW() WHERE id = $4',
      [name?.trim(), color, icon, req.params.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete tag
app.delete('/api/tags/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM lead_tags WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all lead-tag assignments
app.get('/api/tag-assignments', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query('SELECT lead_id, tag_id FROM lead_tag_assignments ORDER BY created_at ASC');
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
    await verifyUser(req);
    const { leadId, tagId } = req.body;
    if (!leadId || !tagId) return res.status(400).json({ error: 'leadId e tagId obrigatórios' });

    const { rows } = await pool.query(
      'SELECT id FROM lead_tag_assignments WHERE lead_id = $1 AND tag_id = $2',
      [leadId, tagId]
    );

    if (rows.length > 0) {
      await pool.query('DELETE FROM lead_tag_assignments WHERE lead_id = $1 AND tag_id = $2', [leadId, tagId]);
      res.json({ action: 'removed' });
    } else {
      await pool.query('INSERT INTO lead_tag_assignments (lead_id, tag_id) VALUES ($1, $2)', [leadId, tagId]);
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
    await verifyUser(req);
    const { search, tipo } = req.query;
    let query = 'SELECT * FROM contatos WHERE 1=1';
    const params = [];
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
    await verifyUser(req);
    const { nome, telefone, email, tipo, empresa, cargo, observacoes } = req.body;
    if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO contatos (id, nome, telefone, email, tipo, empresa, cargo, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, nome.trim(), telefone || null, email || null, tipo || 'pessoal', empresa || null, cargo || null, observacoes || null]
    );
    const { rows } = await pool.query('SELECT * FROM contatos WHERE id = $1', [id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/contatos/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { nome, telefone, email, tipo, empresa, cargo, observacoes, favorito } = req.body;
    await pool.query(
      `UPDATE contatos SET nome=COALESCE($1,nome), telefone=$2, email=$3, tipo=COALESCE($4,tipo),
       empresa=$5, cargo=$6, observacoes=$7, favorito=COALESCE($8,favorito), updated_at=NOW() WHERE id=$9`,
      [nome, telefone, email, tipo, empresa, cargo, observacoes, favorito, req.params.id]
    );
    const { rows } = await pool.query('SELECT * FROM contatos WHERE id = $1', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/contatos/:id', async (req, res) => {
  try {
    await verifyUser(req);
    await pool.query('DELETE FROM contatos WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/contatos/:id/favorito', async (req, res) => {
  try {
    await verifyUser(req);
    const { rows } = await pool.query(
      'UPDATE contatos SET favorito = NOT favorito, updated_at = NOW() WHERE id = $1 RETURNING *',
      [req.params.id]
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
    await verifyUser(req);
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
      const existing = await pool.query('SELECT id FROM contatos WHERE telefone = $1', [telefone]);
      if (existing.rows.length > 0) { skipped++; continue; }

      await pool.query(
        'INSERT INTO contatos (id, nome, telefone, tipo) VALUES ($1, $2, $3, $4)',
        [crypto.randomUUID(), nome || telefone, telefone, 'pessoal']
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
    const connected = instances.filter(i => (i.connectionStatus || i.status) === 'open');
    if (connected.length === 0) return;

    let totalImported = 0;
    for (const inst of connected) {
      const name = inst.name || inst.instanceName;
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

          const existing = await pool.query('SELECT id, nome FROM contatos WHERE telefone = $1', [telefone]);
          if (existing.rows.length > 0) {
            const currentName = (existing.rows[0].nome || '').trim();
            if (nome && nome !== telefone && (!currentName || currentName === telefone)) {
              await pool.query(
                `UPDATE contatos SET nome = $1, updated_at = NOW() WHERE telefone = $2`,
                [nome, telefone]
              );
            }
            continue;
          }

          await pool.query(
            'INSERT INTO contatos (id, nome, telefone, tipo) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), nome || telefone, telefone, 'pessoal']
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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT COUNT(*) as total FROM contatos');
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
    await verifyUser(req);
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
          console.log(`[sync][${name}] findContacts retornou ${rawList.length} items. Amostra:`, JSON.stringify(rawList.slice(0, 3)).substring(0, 500));
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
              console.log(`[sync][${name}] contact/find retornou ${rawAltList.length} items. Amostra:`, JSON.stringify(rawAltList.slice(0, 3)).substring(0, 500));
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

          const existing = await pool.query('SELECT id, nome FROM contatos WHERE telefone = $1', [telefone]);
          if (existing.rows.length > 0) {
            const currentName = (existing.rows[0].nome || '').trim();
            if (nome && nome !== telefone && (!currentName || currentName === telefone)) {
              await pool.query(
                `UPDATE contatos SET nome = $1, updated_at = NOW() WHERE telefone = $2`,
                [nome, telefone]
              );
            }
            instResult.skipped++;
            continue;
          }

          await pool.query(
            'INSERT INTO contatos (id, nome, telefone, tipo) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), nome || telefone, telefone, 'pessoal']
          );
          instResult.imported++;
          totalImported++;
        }
      } catch (err) {
        instResult.error = err.message;
      }
      instanceResults.push(instResult);
    }

    const after = await pool.query('SELECT COUNT(*) as total FROM contatos');
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

// ─── Import WhatsApp Messages by date range ─────────────────
app.post('/api/messages/import-whatsapp', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { startDate, endDate, instances: allowedInstances, stream } = req.body;
    
    console.log(`📥 Importing WhatsApp messages for tenant ${user.tenant_id} (User: ${user.email}, SuperAdmin: ${user.is_super_admin})`);
    
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate e endDate obrigatórios' });

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // SSE streaming mode
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
      if (isStream) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    // 1. Fetch connected instances
    sendProgress({ phase: 'init', message: 'Buscando instâncias conectadas...' });
    const instRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
    });
    if (!instRes.ok) {
      const err = { success: false, error: 'Falha ao buscar instâncias', instances: [] };
      if (isStream) { sendProgress({ phase: 'done', ...err }); res.end(); } else res.json(err);
      return;
    }
    const allInstances = await instRes.json();
    let connected = allInstances.filter(i => (i.connectionStatus || i.status) === 'open');

    if (Array.isArray(allowedInstances) && allowedInstances.length > 0) {
      connected = connected.filter(i => allowedInstances.includes(i.name || i.instanceName));
    }

    if (connected.length === 0) {
      const err = { success: true, imported: 0, skipped: 0, instances: [], message: 'Nenhuma instância conectada/selecionada' };
      if (isStream) { sendProgress({ phase: 'done', ...err }); res.end(); } else res.json(err);
      return;
    }

    const instanceResults = [];
    let totalImported = 0;
    let totalSkipped = 0;

    for (let ii = 0; ii < connected.length; ii++) {
      const inst = connected[ii];
      const name = inst.name || inst.instanceName;
      const instResult = { name, imported: 0, skipped: 0, contacts: 0, error: null };

      sendProgress({ phase: 'instance', instance: name, instanceIndex: ii, totalInstances: connected.length, message: `Buscando contatos de ${name}...` });

      try {
        const cRes = await fetch(`${EVOLUTION_API_URL}/chat/findContacts/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({}),
        });
        if (!cRes.ok) { instResult.error = `findContacts HTTP ${cRes.status}`; instanceResults.push(instResult); continue; }
        const contacts = await cRes.json();
        const waContacts = (contacts || []).filter(c => c.id?.endsWith('@s.whatsapp.net'));
        instResult.contacts = waContacts.length;

        sendProgress({ phase: 'contacts_found', instance: name, totalContacts: waContacts.length });

        for (let ci = 0; ci < waContacts.length; ci++) {
          const contact = waContacts[ci];
          const remoteJid = contact.id;
          const phone = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
          const contactName = (contact.pushName || contact.name || phone).trim();

          sendProgress({
            phase: 'contact',
            instance: name,
            contactIndex: ci,
            totalContacts: waContacts.length,
            contactName,
            phone,
            imported: totalImported,
            skipped: totalSkipped,
          });

          try {
            const mRes = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${name}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
              body: JSON.stringify({ where: { key: { remoteJid } } }),
            });
            if (!mRes.ok) continue;
            const allMessages = await mRes.json();
            const messages = Array.isArray(allMessages) ? allMessages : (allMessages?.messages || allMessages?.data || []);
            const leadId = phone;

            for (const msg of messages) {
              const msgTimestamp = msg.messageTimestamp
                ? new Date(typeof msg.messageTimestamp === 'number'
                    ? (msg.messageTimestamp > 1e12 ? msg.messageTimestamp : msg.messageTimestamp * 1000)
                    : msg.messageTimestamp)
                : null;

              if (!msgTimestamp || msgTimestamp < start || msgTimestamp > end) continue;

              const msgId = msg.key?.id || msg.id || `evo-${randomUUID()}`;
              const existing = await pool.query('SELECT id FROM chat_messages WHERE id = $1', [msgId]);
              if (existing.rows.length > 0) { instResult.skipped++; totalSkipped++; continue; }

              const fromMe = msg.key?.fromMe || false;
              const sender = fromMe ? 'attendant' : 'lead';

              let content = '';
              let type = 'text';
              let mediaUrl = null;
              let fileName = null;
              let mimeType = null;

              const m = msg.message || {};
              if (m.conversation) { content = m.conversation; }
              else if (m.extendedTextMessage?.text) { content = m.extendedTextMessage.text; }
              else if (m.imageMessage) { type = 'image'; content = m.imageMessage.caption || '📷 Imagem'; mimeType = m.imageMessage.mimetype; }
              else if (m.videoMessage) { type = 'video'; content = m.videoMessage.caption || '🎥 Vídeo'; mimeType = m.videoMessage.mimetype; }
              else if (m.audioMessage) { type = 'audio'; content = '🎵 Áudio'; mimeType = m.audioMessage.mimetype; }
              else if (m.documentMessage) { type = 'document'; content = m.documentMessage.fileName || '📄 Documento'; fileName = m.documentMessage.fileName; mimeType = m.documentMessage.mimetype; }
              else if (m.stickerMessage) { type = 'sticker'; content = '🏷️ Sticker'; }
              else if (m.contactMessage) { type = 'contact'; content = `👤 ${m.contactMessage.displayName || 'Contato'}`; }
              else if (m.locationMessage) { type = 'location'; content = '📍 Localização'; }
              else {
                if (m.protocolMessage || m.senderKeyDistributionMessage || msg.messageStubType) continue;
                content = '[Mensagem não suportada]';
              }

              if (!content) continue;

              await pool.query(
                `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, media_url, file_name, mime_type, instance, phone, metadata, tenant_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                 ON CONFLICT (id) DO NOTHING`,
                [msgId, leadId, content, sender, type, 'delivered', msgTimestamp, mediaUrl, fileName, mimeType, name, phone, JSON.stringify({ importedFrom: 'whatsapp', contactName }), user.tenant_id]
              );
              instResult.imported++;
              totalImported++;
            }
          } catch (msgErr) {
            // Skip individual contact errors
          }
        }
      } catch (err) {
        instResult.error = err.message;
      }
      instanceResults.push(instResult);
    }

    const finalResult = {
      phase: 'done',
      success: true,
      imported: totalImported,
      skipped: totalSkipped,
      instances: instanceResults,
    };

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
    await verifyUser(req);
    const { newInstance, message } = req.body;
    if (!newInstance || typeof newInstance !== 'string') {
      return res.status(400).json({ error: 'newInstance é obrigatório' });
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      return res.status(400).json({ error: 'Mensagem deve ter no mínimo 10 caracteres' });
    }

    // 1. Find open attendances for the CURRENT tenant
    const { rows: openChats } = await pool.query(
      `SELECT DISTINCT c.phone as lead_phone, c.instance
       FROM chat_messages c
       WHERE c.instance IS NOT NULL
         AND c.instance != $1
         AND c.created_at > NOW() - INTERVAL '7 days'
         AND c.phone IS NOT NULL
         AND (is_super_admin() OR c.tenant_id = get_current_tenant_id())
       ORDER BY c.phone`,
      [newInstance]
    );

    // Also check attendance queue for the CURRENT tenant
    const { rows: queueChats } = await pool.query(
      `SELECT DISTINCT lead_phone as phone FROM attendance_sessions
       WHERE status IN ('waiting', 'active')
         AND lead_phone IS NOT NULL
         AND (is_super_admin() OR tenant_id = get_current_tenant_id())`
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

    // 2. Send message to each patient via the NEW instance
    for (const phone of phones) {
      try {
        await evolutionFetch(`/message/sendText/${newInstance}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({ number: phone, text: message.trim() }),
        });
        sent++;
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
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
app.get('/api/messages/:leadId', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { leadId } = req.params;
    const { before, limit = '50' } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

    let query, params;
    if (before) {
      query = `
        WITH lead_lookup AS (
          SELECT COALESCE(
            (SELECT telefone FROM crm_leads WHERE id::text = $1 AND tenant_id = $4 LIMIT 1),
            (SELECT lead_phone FROM attendance_sessions WHERE lead_id = $1 AND tenant_id = $4 ORDER BY created_at DESC NULLS LAST LIMIT 1)
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
            (SELECT lead_phone FROM attendance_sessions WHERE lead_id = $1 AND tenant_id = $3 ORDER BY created_at DESC NULLS LAST LIMIT 1)
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

    const { rows: profile } = await pool.query('SELECT name FROM profiles WHERE id = $1', [user.id]);
    const attendantName = profile[0]?.name || 'Atendente';

    // If fileUrl is a base64 data URI, save to disk for persistent storage
    let persistedMediaUrl = fileUrl || null;
    if (fileUrl && fileUrl.startsWith('data:')) {
      const diskUrl = await saveMediaToDisk(fileUrl, mimeType, fileName);
      if (diskUrl) persistedMediaUrl = diskUrl;
    }

    await pool.query(
      `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, media_url, file_name, mime_type, reply_to_id, reply_to_content, reply_to_sender, attendant_id, attendant_name, instance, phone, tenant_id)
       VALUES ($1,$2,$3,'attendant',$4,$5,NOW(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO NOTHING`,
      [
        id, leadId, content || '', type || 'text', status || 'sent',
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
    }, user.tenant_id);

    res.json({ success: true, id, mediaUrl: persistedMediaUrl });
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
    await verifyUser(req);
    const { status } = req.body;
    if (!['sending', 'sent', 'delivered', 'read', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    await pool.query('UPDATE chat_messages SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
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

    // Get leads that have an open attendance session. Waiting sessions remain
    // visible until an attendant explicitly assumes them; they must not expire
    // just because the chat page was closed or refreshed.
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (s.lead_id)
        COALESCE(l.id::text, s.lead_id) as id,
        COALESCE(l.nome, s.lead_name, latest.phone, s.lead_phone) as name,
        COALESCE(l.telefone, s.lead_phone, latest.phone) as phone,
        l.avatar_url,
        COALESCE(l.queue_id, s.queue_id) as queue_id,
        COALESCE(l.queue_name, s.queue_name) as queue_name,
        l.origem,
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
          WHERE cm_unread.lead_id = s.lead_id
            AND cm_unread.tenant_id = $2
            AND cm_unread.sender = 'lead'
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
             OR (s.lead_phone IS NOT NULL AND cm.phone = s.lead_phone)
           )
         ORDER BY cm.timestamp DESC
         LIMIT 1
      ) latest ON true
      WHERE s.tenant_id = $2
        AND s.status IN ('waiting', 'active')
      ORDER BY s.lead_id, s.started_waiting_at DESC NULLS LAST, s.created_at DESC NULLS LAST
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
              console.log(`📸 Background avatar sync: ${r.name || r.phone} → OK`);
            }
          } catch (err) {
            console.error(`📸 Avatar sync error for ${r.phone}:`, err.message);
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
    await verifyUser(req);
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Array messages obrigatório' });
    }
    if (messages.length > 500) {
      return res.status(400).json({ error: 'Máximo 500 mensagens por batch' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const m of messages) {
        await client.query(`
          INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, media_url, file_name, mime_type,
            reply_to_id, reply_to_content, reply_to_sender, attendant_id, attendant_name, instance, phone, metadata)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (id) DO NOTHING
        `, [
          m.id, m.lead_id, m.content || null, m.sender, m.type || 'text', m.status || 'sent',
          m.timestamp || new Date().toISOString(), m.media_url || null, m.file_name || null, m.mime_type || null,
          m.reply_to_id || null, m.reply_to_content || null, m.reply_to_sender || null,
          m.attendant_id || null, m.attendant_name || null, m.instance || null, m.phone || null,
          JSON.stringify(m.metadata || {})
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
    await verifyUser(req);
    const { id } = req.params;
    const hard = req.query.hard === 'true';

    if (hard) {
      await pool.query('DELETE FROM chat_messages WHERE id = $1', [id]);
    } else {
      await pool.query("UPDATE chat_messages SET content = NULL, type = 'text', media_url = NULL, metadata = '{\"deleted\":true}' WHERE id = $1", [id]);
    }
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
    await verifyUser(req);
    const q = req.query.q;
    const leadId = req.query.lead_id;
    if (!q || q.length < 2) return res.status(400).json({ error: 'Query mínima 2 caracteres' });

    let query = "SELECT m.*, l.nome as lead_name FROM chat_messages m LEFT JOIN crm_leads l ON l.id = m.lead_id WHERE m.content ILIKE $1";
    const values = [`%${q}%`];

    if (leadId) {
      query += ' AND m.lead_id = $2';
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
      `INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, keys_p256dh = $3, keys_auth = $4, updated_at = NOW()`,
      [user.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unsubscribe from push notifications
app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    await verifyAdmin(req);
    const { rows } = await pool.query('SELECT provider, api_key, model, enabled FROM ai_settings ORDER BY provider');
    // Mask keys for display
    const masked = rows.map(r => ({
      ...r,
      api_key: r.api_key ? r.api_key.slice(0, 8) + '...' + r.api_key.slice(-4) : '',
    }));
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
    await verifyAdmin(req);
    const { provider, api_key, model, enabled } = req.body;
    if (!provider) return res.status(400).json({ error: 'Provider é obrigatório' });

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

// ─── Transcribe audio via OpenAI Whisper ────────────────────
app.post('/api/ai/transcribe', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '50mb' }), async (req, res) => {
  try {
    const { user } = await verifyUser(req);

    // Get OpenAI key from DB
    const { rows } = await pool.query("SELECT api_key, enabled FROM ai_settings WHERE provider = 'openai' LIMIT 1");
    if (rows.length === 0 || !rows[0].api_key || !rows[0].enabled) {
      return res.status(400).json({ error: 'OpenAI não está configurada. Vá em Configurações > IA para adicionar a API key.' });
    }

    const openaiKey = rows[0].api_key;

    // Save audio to temp file
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'whisper-'));
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

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error('Whisper error:', whisperRes.status, errText);
      return res.status(500).json({ error: `Erro na transcrição: ${whisperRes.status}` });
    }

    const transcription = await whisperRes.text();
    res.json({ transcription });
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: err.message });
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
      INSERT INTO clinical_reports (id, patient_id, patient_name, attendant_id, attendant_name, transcription, report, queixa_principal, procedimento, dente_regiao, prescricoes, duration_seconds)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [reportId, patientId || 'unknown', patientName || '', user.id, '', transcription, report, queixaPrincipal || '', procedimento || '', dente || '', JSON.stringify(prescricoes || []), durationSeconds || 0]);

    res.json({ id: reportId, report, transcription });
  } catch (err) {
    console.error('Clinical report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Get clinical reports for a patient ─────────────────────
app.get('/api/ai/reports/:patientId', async (req, res) => {
  try {
    await verifyUser(req);
    const { patientId } = req.params;
    const { rows } = await pool.query(
      'SELECT id, patient_name, transcription, report, queixa_principal, procedimento, dente_regiao, prescricoes, duration_seconds, created_at FROM clinical_reports WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 50',
      [patientId]
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
    const { from, to, status, patientId, attendantId, q, limit } = req.query;

    const where = [];
    const params = [];
    let idx = 1;

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
    const { from, to, status, patientId, attendantId, q } = req.query;

    const where = [];
    const params = [];
    let idx = 1;
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
         started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       RETURNING id, finished_at`,
      [
        patient_id, patient_name || null, appointment_id || null,
        user.id, user.name,
        queixa_principal || null, procedimento || null, dente_regiao || null, observacoes || null,
        JSON.stringify(prescricoes || []), duration_seconds || 0, gravacoes_count || 0,
        clinical_report_id || null, started_at || null,
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
    await verifyUser(req);
    const { patientId } = req.params;
    const { rows } = await pool.query(
      `SELECT id, patient_name, dentist_name, queixa_principal, procedimento,
              dente_regiao, observacoes, prescricoes, duration_seconds,
              gravacoes_count, clinical_report_id, status, started_at, finished_at
       FROM consultations
       WHERE patient_id = $1
       ORDER BY finished_at DESC
       LIMIT 50`,
      [patientId]
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
    const { reportId, patientName, patientPhone } = req.body;
    if (!reportId) return res.status(400).json({ error: 'reportId é obrigatório' });

    // Fetch the clinical report
    const { rows: reports } = await pool.query(
      'SELECT report, queixa_principal, procedimento, dente_regiao, prescricoes FROM clinical_reports WHERE id = $1 LIMIT 1',
      [reportId]
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
- Referenciar detalhes específicos da consulta (procedimento, orientações)
- Usar emojis de forma moderada
- Ser curtas (máx 200 caracteres cada)
- Incluir chamada para ação quando apropriado

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

    // Resolve instance — use first connected if not provided
    let instanceName = instance;
    if (!instanceName && EVOLUTION_API_KEY) {
      try {
        const instResult = await evolutionFetch('/instance/fetchInstances');
        const instances = Array.isArray(instResult.data) ? instResult.data : [];
        const connected = instances.find(i => (i.connectionStatus || i.status) === 'open');
        if (connected) instanceName = connected.name || connected.instanceName;
      } catch {}
    }

    const flowId = `followup-report-${reportId}`;
    const flowName = `Follow-up IA: ${patientName || patientPhone}`;
    const now = new Date();

    // Create a temporary automation flow for tracking
    await pool.query(`
      INSERT INTO automation_flows (id, name, description, type, active, trigger_event, steps, stats, created_by)
      VALUES ($1, $2, $3, 'pos_consulta', true, 'Relatório clínico IA', $4, '{"sent":0,"responded":0,"converted":0}', $5)
      ON CONFLICT (id) DO UPDATE SET steps = EXCLUDED.steps, updated_at = NOW()
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
    ]);

    // Schedule automation jobs
    const jobIds = [];
    const phone = patientPhone.replace(/\D/g, '');
    const formattedPhone = phone.startsWith('55') ? phone : `55${phone}`;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const scheduledAt = new Date(now.getTime() + (msg.delay_days * 86400000));
      const personalizedMsg = (msg.text || '').replace(/\{\{nome\}\}/g, patientName || 'Paciente');

      const jobId = randomUUID();
      await pool.query(`
        INSERT INTO automation_jobs (id, flow_id, flow_name, step_index, patient_name, patient_phone, instance, variables, message, channel, status, scheduled_at, trigger_event)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'whatsapp', 'pending', $10, 'clinical_report_followup')
      `, [
        jobId, flowId, flowName, i,
        patientName || '', formattedPhone,
        instanceName || '',
        JSON.stringify({ nome: patientName || 'Paciente', reportId }),
        personalizedMsg, scheduledAt,
      ]);
      jobIds.push({ id: jobId, scheduled_at: scheduledAt, delay_days: msg.delay_days, message: personalizedMsg });
    }

    // Link report to follow-up
    await pool.query(`
      UPDATE clinical_reports SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{followup_flow_id}', $1)
      WHERE id = $2
    `, [JSON.stringify(flowId), reportId]);

    console.log(`🤖 Follow-up IA agendado: ${jobIds.length} mensagens para ${patientName} (${formattedPhone})`);
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
async function getManusSettings() {
  const result = await pool.query(`SELECT * FROM ai_settings WHERE provider = 'manus' AND enabled = true`);
  return result.rows[0] || null;
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
    await verifyUser(req);

    const manus = await getManusSettings();
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
      LEFT JOIN meta_ads_insights i ON c.campaign_id = i.campaign_id
      GROUP BY c.campaign_id, c.name, c.status, c.objective
      ORDER BY spend DESC
    `);

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
    const syncResult = await pool.query(`SELECT last_sync FROM meta_ads_accounts ORDER BY last_sync DESC NULLS LAST LIMIT 1`);
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
    console.error('Meta Ads overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/meta-ads/sync — sync campaigns from Meta Graph API
app.post('/api/ai/meta-ads/sync', async (req, res) => {
  try {
    await verifyAdmin(req);

    const manus = await getManusSettings();
    if (!manus?.api_key) {
      return res.status(400).json({ error: 'Manus AI não configurado. Vá em Configurações → IA e adicione a API key.' });
    }

    // The Manus api_key field stores the Meta Ads access token
    const accessToken = manus.api_key;

    // Manus config may store ad_account_id in the config JSONB
    const config = typeof manus.config === 'string' ? JSON.parse(manus.config) : (manus.config || {});
    let adAccountId = config.ad_account_id;

    // If no ad_account_id configured, try to discover it
    if (!adAccountId) {
      const meData = await metaGraphFetch('/me/adaccounts', accessToken, { fields: 'id,name,account_status' });
      if (meData.data && meData.data.length > 0) {
        adAccountId = meData.data[0].id;
        // Save discovered account
        await pool.query(`
          INSERT INTO meta_ads_accounts (account_id, account_name, access_token, connected, last_sync)
          VALUES ($1, $2, $3, true, NOW())
          ON CONFLICT (account_id) DO UPDATE SET account_name = $2, access_token = $3, connected = true, last_sync = NOW()
        `, [adAccountId, meData.data[0].name || adAccountId, accessToken]);
        // Save ad_account_id to config
        await pool.query(`UPDATE ai_settings SET config = config || $1::jsonb WHERE provider = 'manus'`, [
          JSON.stringify({ ad_account_id: adAccountId }),
        ]);
      } else {
        return res.status(400).json({ error: 'Nenhuma conta de anúncio encontrada. Verifique o token de acesso.' });
      }
    }

    // Fetch campaigns
    const campaignsData = await metaGraphFetch(`/${adAccountId}/campaigns`, accessToken, {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
      limit: 50,
    });

    const campaigns = campaignsData.data || [];
    let synced = 0;

    for (const c of campaigns) {
      await pool.query(`
        INSERT INTO meta_ads_campaigns (campaign_id, account_id, name, status, objective, daily_budget, lifetime_budget, start_time, stop_time, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (campaign_id) DO UPDATE SET
          name = $3, status = $4, objective = $5, daily_budget = $6, lifetime_budget = $7,
          start_time = $8, stop_time = $9, updated_at = NOW()
      `, [
        c.id, adAccountId, c.name, c.status, c.objective,
        c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
        c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
        c.start_time || null, c.stop_time || null,
      ]);

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

          await pool.query(`
            INSERT INTO meta_ads_insights (campaign_id, date_start, date_stop, impressions, clicks, spend, reach, ctr, cpc, cpm, actions, leads, conversions, cost_per_lead, cost_per_conversion)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (campaign_id, date_start) DO UPDATE SET
              impressions = $4, clicks = $5, spend = $6, reach = $7, ctr = $8, cpc = $9, cpm = $10,
              actions = $11, leads = $12, conversions = $13, cost_per_lead = $14, cost_per_conversion = $15
          `, [
            c.id, ins.date_start, ins.date_stop,
            parseInt(ins.impressions) || 0, parseInt(ins.clicks) || 0,
            parseFloat(ins.spend) || 0, parseInt(ins.reach) || 0,
            parseFloat(ins.ctr) || 0, parseFloat(ins.cpc) || 0, parseFloat(ins.cpm) || 0,
            JSON.stringify(actions), parseInt(leads) || 0, parseInt(conversions) || 0,
            leads > 0 ? parseFloat(ins.spend) / parseInt(leads) : null,
            conversions > 0 ? parseFloat(ins.spend) / parseInt(conversions) : null,
          ]);
        }
      } catch (insErr) {
        console.warn(`⚠️ Insights fetch failed for campaign ${c.id}: ${insErr.message}`);
      }

      synced++;
    }

    // Update last_sync
    await pool.query(`UPDATE meta_ads_accounts SET last_sync = NOW() WHERE account_id = $1`, [adAccountId]);

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
          FROM meta_ads_campaigns c LEFT JOIN meta_ads_insights i ON c.campaign_id=i.campaign_id
          GROUP BY c.name ORDER BY spend DESC LIMIT 10
        `);
        aiInsight = await generateMetaAdsInsight(freshCampaigns.rows);
      } catch (aiErr) {
        console.warn('⚠️ AI insight generation failed:', aiErr.message);
      }
    }

    console.log(`📊 Meta Ads sync: ${synced} campanhas sincronizadas`);
    res.json({ success: true, synced, ai_insight: aiInsight });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Meta Ads sync error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/meta-ads/insight — generate AI insight on demand
app.get('/api/ai/meta-ads/insight', async (req, res) => {
  try {
    await verifyUser(req);

    const campaignsResult = await pool.query(`
      SELECT c.name, COALESCE(SUM(i.spend),0) AS spend, COALESCE(SUM(i.impressions),0) AS impressions,
        COALESCE(SUM(i.clicks),0) AS clicks,
        CASE WHEN SUM(i.impressions)>0 THEN ROUND(SUM(i.clicks)::numeric/SUM(i.impressions)*100,2) ELSE 0 END AS ctr,
        COALESCE(SUM(i.leads),0) AS leads,
        CASE WHEN SUM(i.leads)>0 THEN ROUND(SUM(i.spend)/SUM(i.leads),2) ELSE NULL END AS cost_per_lead
      FROM meta_ads_campaigns c LEFT JOIN meta_ads_insights i ON c.campaign_id=i.campaign_id
      GROUP BY c.name ORDER BY spend DESC LIMIT 10
    `);

    if (campaignsResult.rows.length === 0) {
      return res.json({ insight: 'Nenhuma campanha encontrada. Sincronize os dados primeiro.' });
    }

    const insight = await generateMetaAdsInsight(campaignsResult.rows);
    res.json({ insight: insight || 'Não foi possível gerar análise. Verifique a API key da OpenAI.' });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    console.error('Meta Ads insight error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CLINICORP INTEGRATION
import { registerClinicorp, reconciliationTick } from './clinicorp.mjs';
registerClinicorp(app, pool);

// ── Per-user Clinicorp credentials (SaaS multi-tenant) ─────────
// Each authenticated user has their own row in clinicorp_user_settings.
// Access is enforced by JWT — users can only read/write their own row.
app.get('/api/clinicorp/my-settings', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows } = await pool.query(
      `SELECT enabled, subscriber_id, base_url,
              api_token IS NOT NULL AND api_token <> '' AS has_api_token,
              webhook_secret IS NOT NULL AND webhook_secret <> '' AS has_webhook_secret,
              CASE WHEN webhook_secret IS NOT NULL AND length(webhook_secret) >= 8
                   THEN substring(webhook_secret from 1 for 4) || '…' || substring(webhook_secret from length(webhook_secret) - 3)
                   ELSE '' END AS webhook_secret_preview,
              last_sync_at, last_sync_status, last_sync_error, updated_at
         FROM clinicorp_user_settings WHERE user_id = $1`,
      [user.id]
    );
    const s = rows[0] || {};
    res.json({
      enabled: s.enabled ?? false,
      subscriber_id: s.subscriber_id || '',
      base_url: s.base_url || 'https://api.clinicorp.com/rest/v1',
      has_api_token: Boolean(s.has_api_token),
      has_webhook_secret: Boolean(s.has_webhook_secret),
      webhook_secret_preview: s.webhook_secret_preview || '',
      last_sync_at: s.last_sync_at || null,
      last_sync_status: s.last_sync_status || null,
      last_sync_error: s.last_sync_error || null,
      updated_at: s.updated_at || null,
    });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

app.put('/api/clinicorp/my-settings', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
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
       VALUES ($1, COALESCE($2, FALSE), NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), COALESCE(NULLIF($6, ''), 'https://api.clinicorp.com/rest/v1'), NOW())
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
        api_token ?? '',
        subscriber_id ?? '',
        webhook_secret ?? '',
        base_url ?? '',
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'Unauthorized' ? 401 : 500).json({ error: e.message });
  }
});

app.delete('/api/clinicorp/my-settings', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    await pool.query('DELETE FROM clinicorp_user_settings WHERE user_id = $1', [user.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: e.message });
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
  try {
    const { user } = await verifyUser(req);
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

    if (!api_token) return res.status(400).json({ ok: false, error: 'Informe o API Token' });
    if (!subscriber_id) return res.status(400).json({ ok: false, error: 'Informe o Subscriber ID' });
    if (base_url) { try { new URL(base_url); } catch { return res.status(400).json({ ok: false, error: 'URL base inválida' }); } }

    const settings = {
      api_token,
      subscriber_id,
      base_url: base_url || 'https://api.clinicorp.com/rest/v1',
    };

    const cooldownSeconds = getClinicorpTestCooldownSeconds(settings);
    if (cooldownSeconds > 0) {
      const retryAfterSeconds = cooldownSeconds;
      return res.json({
        ok: false,
        auth: 'rate_limited',
        rate_limited: true,
        retry_after_seconds: retryAfterSeconds,
        error: `A Clinicorp limitou temporariamente as chamadas desta integração. Aguarde ${Math.ceil(retryAfterSeconds / 60)} min antes de testar de novo.`,
        total_latency_ms: 0,
        base_url: settings.base_url,
        subscriber_id: settings.subscriber_id,
        results: [],
      });
    }

    const auditData = {
      entity: 'connection_test',
      local_id: user.id,
      clinicorp_id: subscriber_id,
      action: 'test',
      status: 'success',
      payload: { base_url: settings.base_url },
    };


    // Testamos um endpoint por módulo para validar que a integração cobre
    // Clínicas, Agenda, Profissionais, Pacientes e Orçamentos.
    // Chamadas sequenciais com pequeno delay para não acionar 429.
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const probes = [
      { key: 'clinics',       label: 'Clínicas',      path: '/business/list' },
      { key: 'appointments',  label: 'Agenda',        path: '/appointment/list',           query: { from: dateStr, to: dateStr } },
      { key: 'professionals', label: 'Profissionais', path: '/dentist/list' },
      { key: 'patients',      label: 'Pacientes',     path: '/patient/birthdays',          query: { from: dateStr, to: dateStr } },
      { key: 'estimates',     label: 'Orçamentos',    path: '/estimates/list',             query: { from: dateStr, to: dateStr } },
      { key: 'financial',     label: 'Financeiro',    path: '/financial/list_invoices',    query: { from: dateStr, to: dateStr } },
    ];

    console.log(`[ClinicorpTest] Testing connection for user ${user.id} (${user.email}) - Subscriber: ${subscriber_id}`);
    const startedAt = Date.now();
    const results = [];
    for (const p of probes) {
      const t0 = Date.now();
      let attempt = 0;
      let lastError = null;
      let success = false;
      let data = null;

      while (attempt < 2 && !success) {
        try {
          data = await clinicorpFetchProbe(settings, p.path, { timeoutMs: 12_000, query: p.query });
          success = true;
        } catch (e) {
          lastError = e;
          if (e.status === 401 || (e.status >= 500 && e.status < 600)) {
            attempt++;
            if (attempt < 2) await clinicorpProbeSleep(600);
          } else {
            console.error(`[ClinicorpTest] Probe ${p.key} failed (non-retryable): ${e.status} ${e.message}`);
            break;
          }
        }
      }

      if (success) {
        results.push({ ...p, ok: true, latency_ms: Date.now() - t0, count: Array.isArray(data) ? data.length : (data ? 1 : 0), retries: attempt });
      } else {
        results.push({
          ...p,
          ok: false,
          latency_ms: Date.now() - t0,
          status: lastError?.status || null,
          error: lastError?.message || 'timeout',
          retry_after_seconds: lastError?.retryAfter ?? null,
          retries: attempt,
        });
        // Se 429, pare imediatamente para não piorar o rate limit.
        if (lastError?.status === 429) break;
      }
      // Pequena pausa entre probes para respeitar limites.
      await clinicorpProbeSleep(350);
    }


    const ok = results.every((r) => r.ok);
    const rateLimit = results.find((r) => r.status === 429);
    const auth = results[0]?.status === 401 || results.some((r) => r.status === 401)
      ? 'invalid_token'
      : (rateLimit ? 'rate_limited' : (ok ? 'valid' : 'partial'));
    const retryAfterSeconds = rateLimit?.retry_after_seconds ?? null;
    if (rateLimit) {
      setClinicorpTestCooldown(settings, retryAfterSeconds);
    } else if (ok) {
      clinicorpTestCooldowns.delete(`${settings.base_url}|${settings.subscriber_id}`);
    }

    res.json({
      ok,
      auth,
      rate_limited: Boolean(rateLimit),
      retry_after_seconds: retryAfterSeconds,
      error: rateLimit
        ? `A Clinicorp limitou temporariamente as chamadas desta integração. Aguarde ${Math.ceil((retryAfterSeconds || 60) / 60)} min antes de testar de novo.`
        : undefined,
      total_latency_ms: Date.now() - startedAt,
      base_url: settings.base_url,
      subscriber_id: settings.subscriber_id,
      results,
    });
    
    // Log to audit (using the imported clinicorpPush if available, or manual insert)
    try {
      await pool.query(
        `INSERT INTO clinicorp_push_log (entity_type, local_id, clinicorp_id, action, status, payload, response)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['connection_test', user.id, subscriber_id, 'test', ok ? 'success' : 'error', 
         JSON.stringify({ base_url: settings.base_url }), JSON.stringify({ ok, auth, results })]
      );
    } catch (auditErr) { console.error('Audit log failed:', auditErr.message); }

  } catch (e) {
    res.status(e.message === 'Unauthorized' ? 401 : 500).json({ ok: false, error: e.message });
  }
});

// Trigger a manual full sync for the current user
app.post('/api/clinicorp/sync/now', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
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

    const normalizedSettings = {
      ...settings,
      base_url: settings.base_url || 'https://api.clinicorp.com/rest/v1',
    };
    const cooldownSeconds = getClinicorpTestCooldownSeconds(normalizedSettings);
    if (cooldownSeconds > 0) {
      return res.status(429).json({
        error: `Clinicorp em limite de chamadas. Aguarde ${Math.ceil(cooldownSeconds / 60)} min antes de sincronizar de novo.`,
        rate_limited: true,
        retry_after_seconds: cooldownSeconds,
      });
    }

    const { runFullSync } = await import('./clinicorp.mjs');
    const result = await runFullSync(pool, { 
      api_token: settings.api_token, 
      subscriber_id: settings.subscriber_id, 
      base_url: settings.base_url,
      tenant_id: user.tenant_id,
      from: req.body?.from,
      to: req.body?.to,
      force_metadata: req.body?.force_metadata === true
    });

    await pool.query(
      `UPDATE clinicorp_user_settings
          SET last_sync_at = NOW(), last_sync_status = $2, last_sync_error = $3, updated_at = NOW()
        WHERE user_id = $1`,
      [user.id, result.status, result.errors?.length ? result.errors.join(' | ') : null]
    );

    res.json(result);
  } catch (e) {
    console.error('[clinicorp manual sync error]', e);
    const retryAfterSeconds = Number(e.retry_after_seconds ?? e.retryAfter);
    if (e.status === 429 || /HTTP 429|rate limited/i.test(String(e.message || ''))) {
      return res.status(429).json({
        error: e.message,
        rate_limited: true,
        retry_after_seconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
      });
    }
    res.status(500).json({ error: e.message });
  }
});

// Lightweight probe — same logic as clinicorp.mjs#clinicorpFetch but local
async function clinicorpFetchProbe(settings, pathName, opts = {}) {
  const base = (settings.base_url || 'https://api.clinicorp.com/rest/v1').replace(/\/$/, '');
  const url = new URL(base + pathName);
  
  // Limpar e normalizar query parameters
  const allQuery = { ...(opts.query || {}) };
  
  // subscriber_id é OBRIGATÓRIO em TODAS as chamadas da Clinicorp
  if (settings.subscriber_id) {
    url.searchParams.set('subscriber_id', settings.subscriber_id);
    if (!allQuery.subscriber_id) allQuery.subscriber_id = settings.subscriber_id;
  }
  
  // Clinicorp autentica via query params user_api + api_key (mesmo formato do webhook).
  const _apiUserQ = String(settings.subscriber_id || '').trim();
  const _apiTokenQ = String(settings.api_token || '').trim().replace(/^Bearer\s+/i, '');
  if (_apiUserQ) url.searchParams.set('user_api', _apiUserQ);
  if (_apiTokenQ) url.searchParams.set('api_key', _apiTokenQ);

  if (allQuery) {
    for (const [k, v] of Object.entries(allQuery)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs || 45_000);
  
  try {
    const apiToken = String(settings.api_token || '').trim().replace(/^Bearer\s+/i, '');
    const apiUser = String(settings.subscriber_id || '').trim();
    
    const requestOnce = async (authMode) => {
      // Tenta ambos os formatos de autenticação simultaneamente para máxima compatibilidade
      const headers = { Accept: 'application/json' };
      if (authMode === 'basic' && apiUser) {
        headers.Authorization = `Basic ${Buffer.from(`${apiUser}:${apiToken}`).toString('base64')}`;
      } else {
        headers.Authorization = `Bearer ${apiToken}`;
      }
      
      const r = await fetch(url.toString(), {
        method: 'GET',
        headers,
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

      if ((r.status === 401 || r.status === 502 || r.status === 503 || r.status === 504) && !requestOnce._retried) {
        requestOnce._retried = true;
        await clinicorpProbeSleep(opts.retryDelayMs || 2000);
        return requestOnce(authMode === 'basic' ? 'bearer' : 'basic'); // Alterna modo no retry
      }

      if (!r.ok) {
        const err = new Error(`HTTP ${r.status}${typeof data === 'string' && data ? ': ' + data.slice(0, 200) : ''}`);
        err.status = r.status;
        err.authMode = authMode;
        throw err;
      }
      return data;
    };

    return await requestOnce('basic');
  } finally {
    clearTimeout(timeout);
  }
}


const clinicorpProbeSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════════
// MÓDULO EXAMES (Cfaz) — Pedidos de exames de imagem odontológica
// ═══════════════════════════════════════════════════════════════

// Listar tipos de exame do tenant
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
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/exame-tipos', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const { nome, categoria, codigo_tiss, preco, ativo } = req.body || {};
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const { rows } = await pool.query(
      `INSERT INTO exame_tipos (tenant_id, nome, categoria, codigo_tiss, preco, ativo)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,true))
       ON CONFLICT (tenant_id, nome) DO UPDATE
         SET categoria=EXCLUDED.categoria,
             codigo_tiss=EXCLUDED.codigo_tiss,
             preco=EXCLUDED.preco,
             ativo=EXCLUDED.ativo
       RETURNING *`,
      [user.tenant_id, nome.trim(), categoria || null, codigo_tiss || null, preco ?? 0, ativo]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[exame-tipos:post]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/exame-tipos/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    await pool.query(
      `DELETE FROM exame_tipos WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, user.tenant_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar exames com filtros
app.get('/api/exames', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.json([]);
    const { status, paciente_id, q, from, to, terceirizado } = req.query;
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
              d.nome AS dentista_nome
         FROM exames e
         LEFT JOIN pacientes p ON p.id = e.paciente_id
         LEFT JOIN dentistas d ON d.id = e.dentista_solicitante_id
        WHERE ${where.join(' AND ')}
        ORDER BY e.data_solicitacao DESC
        LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[exames:list]', err.message);
    res.status(401).json({ error: err.message });
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
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/exames', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const {
      paciente_id, dentista_solicitante_id, clinica_origem,
      tipo_exame_id, tipo_nome, prioridade, valor, modo_entrega,
      observacoes, terceirizado, fornecedor_terc, status
    } = req.body || {};
    if (!tipo_nome?.trim()) return res.status(400).json({ error: 'tipo_nome obrigatório' });

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
        status, prioridade, valor, modo_entrega || null,
        observacoes || null, terceirizado, fornecedor_terc || null, user.id
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[exames:create]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/exames/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const allowed = ['status','prioridade','valor','modo_entrega','laudo_texto','arquivo_url',
                     'observacoes','terceirizado','fornecedor_terc','data_realizacao','data_entrega',
                     'paciente_id','dentista_solicitante_id','clinica_origem','tipo_exame_id','tipo_nome'];
    const sets = []; const params = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${k}=$${params.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada a atualizar' });
    params.push(req.params.id, user.tenant_id);
    const { rows } = await pool.query(
      `UPDATE exames SET ${sets.join(', ')}
        WHERE id=$${params.length-1} AND tenant_id=$${params.length}
        RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Exame não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[exames:patch]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/exames/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    await pool.query(
      `DELETE FROM exames WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, user.tenant_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
         EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
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
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_clinicorp_monthly_summary_tenant_period ON clinicorp_monthly_summary(source, period_month, business_id, tenant_id)`
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
    const connected = instances.filter(i => (i.connectionStatus || i.status) === 'open');
    for (const inst of connected) {
      const name = inst.name || inst.instanceName;
      if (name) await registerWebhook(name);
    }
    if (connected.length > 0) {
      console.log(`   📡 Webhook registrado em ${connected.length} instância(s) conectada(s)`);
    }
  } catch (err) {
    console.error('⚠️ Could not auto-register webhooks on startup:', err.message);
  }

  // Start auto-sync every 30 minutes
  syncWhatsAppContacts(); // Run once on startup
  syncInterval = setInterval(syncWhatsAppContacts, 30 * 60 * 1000);
  console.log('   📇 Auto-sync de contatos WhatsApp ativo (a cada 30 min)');

  // Start automation job scheduler (every 30s)
  processAutomationJobs();
  automationSchedulerInterval = setInterval(processAutomationJobs, 30 * 1000);
  console.log('   🤖 Automation scheduler ativo (a cada 30s)');

  // Start inactive patients cron (every 6h)
  checkInactivePatientsTrigger();
  automationCronInterval = setInterval(checkInactivePatientsTrigger, 6 * 60 * 60 * 1000);
  console.log('   📅 Cron de pacientes inativos ativo (a cada 6h)');

  // Start solution triggers cron (every 2h)
  setTimeout(() => processSolutionTriggers(), 10000); // delay 10s to let DB settle
  solutionCronInterval = setInterval(processSolutionTriggers, 2 * 60 * 60 * 1000);
  console.log('   🩺 Cron de soluções automáticas ativo (a cada 2h)');

  // Start campaign scheduler (every 60s)
  processCampaignScheduler();
  campaignSchedulerInterval = setInterval(processCampaignScheduler, 60 * 1000);
  console.log('   📢 Campaign scheduler ativo (a cada 60s)');

  // Start appointment reminder cron (every 1h)
  processAppointmentReminders();
  appointmentReminderInterval = setInterval(processAppointmentReminders, 60 * 60 * 1000);
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

