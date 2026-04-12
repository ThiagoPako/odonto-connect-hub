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

// ─── Evolution API Config ───────────────────────────────────
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'https://api.odontoconnect.tech';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const APP_URL = (process.env.APP_URL || 'https://odontoconnect.tech').replace(/\/$/, '').replace(':443', '');
const WEBHOOK_PUBLIC_URL = process.env.WEBHOOK_PUBLIC_URL?.replace(/\/$/, '');
const isLocalAppUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(APP_URL);
const WEBHOOK_URL = WEBHOOK_PUBLIC_URL || (isLocalAppUrl ? `${APP_URL.replace(/:\d+$/, `:${PORT}`)}/api/webhook/evolution` : `${APP_URL}/api/webhook/evolution`);

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
    const result = await evolutionFetch(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: WEBHOOK_URL,
          webhookByEvents: false,
          webhookBase64: false,
          events: [
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'CONNECTION_UPDATE',
            'QRCODE_UPDATED',
            'PRESENCE_UPDATE',
          ],
        },
      }),
    });
    if (result.ok) {
      console.log(`✅ Webhook registered for ${instanceName} → ${WEBHOOK_URL}`);
    } else {
      console.error(`⚠️ Webhook registration failed for ${instanceName}:`, result.data);
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
  const decoded = verifyToken(token);
  return { user: { id: decoded.sub, email: decoded.email, role: decoded.role } };
}

async function verifyAdmin(req) {
  const { user } = await verifyUser(req);
  if (user.role === 'admin') return { user };
  const { rows } = await pool.query(
    'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
    [user.id, 'admin']
  );
  if (rows.length === 0) throw new Error('Admin access required');
  return { user };
}

async function getProfileByEmail(email) {
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, avatar_url, password_hash, COALESCE(active, true) as active FROM profiles WHERE email = $1 LIMIT 1',
      [normalizedEmail]
    );
    return rows[0] || null;
  } catch (error) {
    if (error?.code !== '42703') throw error;

    const { rows } = await pool.query(
      'SELECT id, name, email, role, avatar_url, password_hash, true as active FROM profiles WHERE email = $1 LIMIT 1',
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

    const token = signToken({ sub: profile.id, email: profile.email, role });

    res.json({
      token,
      user: { id: profile.id, email: profile.email, name: profile.name, role, avatar_url: profile.avatar_url },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const { user } = await verifyUser(req);
    const { rows } = await pool.query(
      'SELECT p.id, p.name, p.email, p.avatar_url, p.role, ur.role as user_role FROM profiles p LEFT JOIN user_roles ur ON ur.user_id = p.id WHERE p.id = $1 LIMIT 1',
      [user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Perfil não encontrado' });
    const profile = rows[0];
    res.json({ id: profile.id, email: profile.email, name: profile.name, role: profile.user_role || profile.role, avatar_url: profile.avatar_url });
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
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: EVOLUTION_API_KEY,
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function normalizeWhatsappNumber(value) {
  return String(value || '')
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@lid', '')
    .replace(/:\d+$/, '')
    .replace(/\D/g, '');
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

// List instances
app.get('/api/whatsapp/instances', async (req, res) => {
  try {
    await verifyUser(req);
    const result = await evolutionFetch('/instance/fetchInstances');
    res.json(result.data);
  } catch (error) {
    res.status(error.message === 'Unauthorized' ? 401 : 500).json({ error: error.message });
  }
});

// Create instance (+ auto-register webhook)
app.post('/api/whatsapp/instances', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { instanceName } = req.body;
    const result = await evolutionFetch('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      }),
    });

    // Auto-register webhook so all messages go to queue
    await registerWebhook(instanceName);

    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const payload = { number, text };
    if (quoted) payload.quoted = quoted;
    const result = await evolutionFetch(`/message/sendText/${instance}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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

    const cleanNumber = number.replace(/\D/g, '');

    if (mediaType === 'audio') {
      const rawMime = media.mimeType || 'audio/webm';
      const cleanMime = rawMime.split(';')[0].trim();
      const sourceMime = cleanMime || 'audio/webm';
      const audioBase64 = cleanBase64Media(media.base64);

      let outgoingMime = sourceMime;
      let outgoingBase64 = audioBase64;

      if (audioBase64) {
        try {
          const transcoded = await transcodeAudioToWhatsAppOgg(audioBase64, sourceMime);
          outgoingBase64 = transcoded.base64;
          outgoingMime = transcoded.mimeType;
        } catch (transcodeError) {
          console.error('Audio transcode failed, falling back to original payload:', transcodeError.message);
        }
      }

      const audioValue = outgoingBase64 || media.url;

      const v2Payload = {
        number: cleanNumber,
        audio: audioValue,
        delay: 1200,
        mimetype: outgoingMime,
      };
      const v1Payload = {
        number: cleanNumber,
        audioMessage: {
          audio: audioValue,
          mimetype: outgoingMime,
        },
        options: {
          delay: 1200,
          presence: 'recording',
          encoding: true,
        },
      };

      let result = await evolutionFetch(`/message/sendWhatsAppAudio/${instance}`, {
        method: 'POST',
        body: JSON.stringify(v2Payload),
      });

      if (!result.ok) {
        result = await evolutionFetch(`/message/sendWhatsAppAudio/${instance}`, {
          method: 'POST',
          body: JSON.stringify(v1Payload),
        });
      }
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

    const cleanNumber = String(number).replace(/\D/g, '');
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
        error: result?.data?.response?.message?.[0] || result?.data?.error || 'Falha ao enviar mídia',
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
      return res.status(500).json({ error: errorMessage });
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
    res.status(500).json({ error: error.message });
  }
});

// Send location
app.post('/api/whatsapp/send-location', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, latitude, longitude, name, address } = req.body;
    const cleanNumber = number.replace(/\D/g, '');
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
    const cleanNumber = number.replace(/\D/g, '');
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
    const cleanNumber = number.replace(/\D/g, '');
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
    await verifyUser(req);
    const { instance, number, messageId, reaction } = req.body;
    if (!instance || !number || !messageId || typeof reaction !== 'string') {
      return res.status(400).json({ error: 'instance, number, messageId e reaction são obrigatórios' });
    }

    const cleanNumber = number.replace(/\D/g, '');
    const { rows: messageRows } = await pool.query(
      `SELECT sender FROM chat_messages WHERE id = $1 LIMIT 1`,
      [messageId]
    );
    const fromMe = messageRows[0]?.sender === 'attendant';

    const result = await evolutionFetch(`/message/sendReaction/${instance}`, {
      method: 'POST',
      body: JSON.stringify({
        key: {
          remoteJid: `${cleanNumber}@s.whatsapp.net`,
          fromMe,
          id: messageId,
        },
        reaction,
      }),
    });

    if (!result.ok) {
      const errorMessage = result.data?.response?.message || result.data?.error || result.data?.message || `Evolution API HTTP ${result.status}`;
      return res.status(result.status || 500).json({ error: errorMessage, details: result.data });
    }

    await pool.query(
      `UPDATE chat_messages
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reactions', $2::jsonb)
       WHERE id = $1`,
      [messageId, JSON.stringify(reaction ? [{ emoji: reaction, count: 1 }] : [])]
    );

    res.json({ success: true, reaction, result: result.data });
  } catch (error) {
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
    await verifyAdmin(req);
    const { instance } = req.body;
    if (!instance) return res.status(400).json({ error: 'instance é obrigatório' });

    // Get leads without avatar
    const { rows: leads } = await pool.query(
      "SELECT id, telefone FROM crm_leads WHERE telefone IS NOT NULL AND (avatar_url IS NULL OR avatar_url = '')"
    );

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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM pacientes ORDER BY nome ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/pacientes', async (req, res) => {
  try {
    await verifyUser(req);
    const { nome, cpf, telefone, email, data_nascimento, endereco, observacoes } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO pacientes (id, nome, cpf, telefone, email, data_nascimento, endereco, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, nome, cpf, telefone, email, data_nascimento, endereco, observacoes]
    );
    res.json({ id, nome, cpf, telefone, email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/pacientes/:id', async (req, res) => {
  try {
    await verifyUser(req);
    const { nome, cpf, telefone, email, data_nascimento, endereco, observacoes } = req.body;
    await pool.query(
      'UPDATE pacientes SET nome=$1, cpf=$2, telefone=$3, email=$4, data_nascimento=$5, endereco=$6, observacoes=$7, updated_at=NOW() WHERE id=$8',
      [nome, cpf, telefone, email, data_nascimento, endereco, observacoes, req.params.id]
    );
    res.json({ success: true });
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

app.post('/api/agenda', async (req, res) => {
  try {
    await verifyUser(req);
    const { paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes, lead_id } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO agendamentos (id, paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, paciente_id, dentista_id, data, hora, duracao || 30, procedimento, status || 'agendado', observacoes]
    );

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
    await verifyUser(req);
    const { rows } = await pool.query('SELECT * FROM dentistas ORDER BY nome ASC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dentistas', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { nome, cro, especialidade, telefone, email, comissao_percentual } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO dentistas (id, nome, cro, especialidade, telefone, email, comissao_percentual) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, nome, cro, especialidade, telefone, email, comissao_percentual || 0]
    );
    res.json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD KPIs
// ═══════════════════════════════════════════════════════════════

app.get('/api/dashboard/kpis', async (req, res) => {
  try {
    await verifyUser(req);
    const today = new Date().toISOString().split('T')[0];
    const firstDayOfMonth = `${today.substring(0, 7)}-01`;

    const [pacientes, agendaHoje, receitas, despesas] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM pacientes'),
      pool.query('SELECT COUNT(*) as total FROM agendamentos WHERE data = $1', [today]),
      pool.query('SELECT COALESCE(SUM(valor), 0) as total FROM financeiro WHERE tipo = $1 AND data >= $2', ['receita', firstDayOfMonth]),
      pool.query('SELECT COALESCE(SUM(valor), 0) as total FROM financeiro WHERE tipo = $1 AND data >= $2', ['despesa', firstDayOfMonth]),
    ]);

    res.json({
      totalPacientes: Number(pacientes.rows[0].total),
      agendaHoje: Number(agendaHoje.rows[0].total),
      receitaMensal: Number(receitas.rows[0].total),
      despesaMensal: Number(despesas.rows[0].total),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GENERIC TABLE (for CRM, estoque, etc.)
// ═══════════════════════════════════════════════════════════════

app.get('/api/table/:tableName', async (req, res) => {
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
    const { rows } = await pool.query('SELECT * FROM orcamentos ORDER BY created_at DESC');
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

const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

app.get('/api/events', (req, res) => {
  // Optional: verify JWT from query param
  // const token = req.query.token;
  // try { verifyToken(token); } catch { return res.status(401).end(); }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

  sseClients.add(res);
  console.log(`📡 SSE client connected (total: ${sseClients.size})`);

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

async function persistIncomingMessage({ msgId, leadId, content, msgType, phone, instance, pushName, remoteJid, rawType, mediaUrl, fileName, mimeType }) {
  try {
    await pool.query(
      `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, phone, instance, media_url, file_name, mime_type, metadata)
       VALUES ($1,$2,$3,'lead',$4,'delivered',NOW(),$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [msgId, leadId, content, msgType, phone, instance, mediaUrl || null, fileName || null, mimeType || null, JSON.stringify({
        pushName,
        remoteJid,
        rawType,
      })]
    );
  } catch (dbErr) {
    console.error('DB insert error (incoming msg):', dbErr.message);
  }
}

function broadcastIncomingMessage({ msgId, phone, pushName, leadId, leadName, content, msgType, instance, queueId = null, queueName, queueColor, mediaUrl, fileName, mimeType }) {
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
  });
}

app.post('/api/webhook/evolution', async (req, res) => {
  try {
    const body = req.body;
    const event = typeof body.event === 'string' ? body.event.toLowerCase().replace(/_/g, '.') : '';
    const instance = body.instance || body.instanceName;
    
    console.log(`📩 Webhook event: ${event} from ${instance}`);

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
          });
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
        });
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
                `SELECT phone FROM chat_messages WHERE id = $1 LIMIT 1`,
                [primaryMessageId]
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
              `UPDATE chat_messages SET status = $1 WHERE id = $2 OR (metadata::text LIKE '%' || $2 || '%')`,
              [newStatus, lookupId]
            );
          } catch (ackErr) {
            console.error('ACK DB update error:', ackErr.message);
          }

          broadcastSSE('message_status_update', {
            messageId: lookupId,
            phone,
            status: newStatus,
            instance,
          });
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

    if (!remoteJid || remoteJid.endsWith('@g.us')) {
      return res.json({ ignored: true, reason: 'group_or_missing_jid' });
    }

    // Skip outgoing messages
    if (message?.key?.fromMe) {
      return res.json({ ignored: true, reason: 'outgoing' });
    }

    const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    const phoneSuffix = phone.slice(-11);

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

    // Find lead by phone
    const { rows: leads } = await pool.query(
      `SELECT id, nome as name, avatar_url, telefone as phone, queue_id, awaiting_queue_selection FROM crm_leads 
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(telefone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
       LIMIT 1`,
      [phoneSuffix]
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
        `INSERT INTO crm_leads (id, nome, telefone, origem, status, kanban_stage, awaiting_queue_selection)
         VALUES ($1, $2, $3, 'whatsapp', 'novo', 'lead', true)`,
        [newId, pushName, phone]
      );
      lead = { id: newId, name: pushName, phone, queue_id: null, awaiting_queue_selection: true, avatar_url: null };
      console.log(`🆕 New lead created: ${pushName} (${phone})`);

      // 🤖 Trigger "Lead entrou no CRM" automation
      triggerAutomationFlows('Lead entrou no CRM', { name: pushName, phone }).catch(() => {});

      // Auto-save to contatos table (skip if phone already exists)
      try {
        const existingContato = await pool.query('SELECT id FROM contatos WHERE telefone = $1', [phone]);
        if (existingContato.rows.length === 0) {
          await pool.query(
            'INSERT INTO contatos (id, nome, telefone, tipo) VALUES ($1, $2, $3, $4)',
            [crypto.randomUUID(), pushName, phone, 'pessoal']
          );
          console.log(`📇 Auto-saved contact: ${pushName} (${phone})`);
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
          body: JSON.stringify({ number: phone, text: offMsg }),
        });
        console.log(`🕐 Off-hours message sent to ${phone}`);
        await persistIncomingMessage({
          msgId,
          leadId: lead.id,
          content: resolvedContent,
          msgType,
          phone,
          instance,
          pushName,
          remoteJid,
          rawType,
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
        });
        broadcastIncomingMessage({
          msgId,
          phone,
          pushName,
          leadId: lead.id,
          leadName: lead.name,
          content: resolvedContent,
          msgType,
          instance,
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
        });
        return res.json({ processed: true, offHours: true, leadId: lead.id });
      }

      // Send welcome message if enabled
      if (attendanceSettingsCache?.autoGreetingEnabled && attendanceSettingsCache?.welcomeMessage) {
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: phone, text: attendanceSettingsCache.welcomeMessage }),
        });
      }

      // Send queue menu
      await sendQueueMenu(instance, phone);
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

        // Send confirmation
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({
            number: phone,
            text: `✅ Você foi direcionado para o setor *${selectedQueue.icon} ${selectedQueue.name}*.\n\nUm de nossos atendentes irá te ajudar em breve! 😊`,
          }),
        });

        console.log(`📌 Lead ${lead.name} routed to queue: ${selectedQueue.name}`);

        // Broadcast queue assignment to SSE
        broadcastSSE('queue_assigned', {
          leadId: lead.id,
          leadName: lead.name,
          phone,
          queueId: selectedQueue.id,
          queueName: selectedQueue.name,
          queueColor: selectedQueue.color,
          timestamp: new Date().toISOString(),
        });

        // Also broadcast the message itself
        broadcastSSE('new_message', {
          id: message?.key?.id || `wh-${Date.now()}`,
          phone,
          pushName,
          leadId: lead.id,
          leadName: lead.name,
          content: `[Selecionou: ${selectedQueue.name}]`,
          type: 'text',
          timestamp: new Date().toISOString(),
          instance,
          queueId: selectedQueue.id,
          queueName: selectedQueue.name,
          queueColor: selectedQueue.color,
        });

        return res.json({ processed: true, leadId: lead.id, queueId: selectedQueue.id });
      } else {
        await persistIncomingMessage({
          msgId,
          leadId: lead.id,
          content: resolvedContent,
          msgType,
          phone,
          instance,
          pushName,
          remoteJid,
          rawType,
          mediaUrl,
          fileName: mediaFileName,
          mimeType: mediaMimeType,
        });
        broadcastIncomingMessage({
          msgId,
          phone,
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
            `INSERT INTO attendance_sessions (id, lead_id, lead_phone, status, started_waiting_at)
             VALUES ($1, $2, $3, 'waiting', NOW())
             ON CONFLICT DO NOTHING`,
            [sessionId, lead.id.toString(), phone]
          ).catch(() => {});

          console.log(`🔄 Lead ${lead.name} (${phone}) replied from recovery stage ${currentStage} → returned to queue with priority`);
          broadcastSSE('lead_returned_from_recovery', {
            leadId: lead.id,
            leadName: lead.name || pushName,
            phone,
            fromStage: currentStage,
            timestamp: new Date().toISOString(),
          });
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
      phone,
      instance,
      pushName,
      remoteJid,
      rawType,
      mediaUrl,
      fileName: mediaFileName,
      mimeType: mediaMimeType,
    });

    broadcastIncomingMessage({
      msgId,
      phone,
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
    const { leadId, leadName, leadPhone, queueId, queueName } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });
    
    // Check if there's already an open session for this lead
    const { rows: existing } = await pool.query(
      "SELECT id FROM attendance_sessions WHERE lead_id = $1 AND status != 'closed' LIMIT 1",
      [leadId]
    );
    if (existing.length > 0) {
      return res.json({ success: true, id: existing[0].id, existing: true });
    }

    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO attendance_sessions (id, lead_id, lead_name, lead_phone, queue_id, queue_name, started_waiting_at, status)
       VALUES ($1,$2,$3,$4,$5,$6, NOW(), 'waiting')`,
      [id, leadId, leadName || null, leadPhone || null, queueId || null, queueName || null]
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
       WHERE lead_id = $3 AND status = 'waiting'
       RETURNING id, wait_time_seconds`,
      [user.id, attendantName, leadId]
    );

    // Auto-move lead to "em_atendimento" in CRM kanban
    await pool.query(
      `UPDATE crm_leads SET kanban_stage = 'em_atendimento', status = 'em_atendimento', updated_at = NOW() WHERE id = $1`,
      [leadId]
    ).catch(err => console.error('Failed to update kanban_stage:', err.message));

    if (result.rows.length === 0) {
      // No waiting session, create one as active directly
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO attendance_sessions (id, lead_id, attendant_id, attendant_name, assigned_at, started_waiting_at, status, wait_time_seconds)
         VALUES ($1,$2,$3,$4, NOW(), NOW(), 'active', 0)`,
        [id, leadId, user.id, attendantName]
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
    const user = await verifyUser(req);
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

// Get kanban movement history for a lead
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
    await verifyUser(req);
    const { search, status, grouped, origin, sort_by, sort_dir } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    // Whitelist sortable columns to prevent SQL injection
    const SORTABLE_COLS = { nome: 'l.nome', origem: 'l.origem', status: 'l.status', valor: 'l.valor', updated_at: 'l.updated_at', created_at: 'l.created_at' };
    const sortColumn = SORTABLE_COLS[sort_by] || 'l.updated_at';
    const sortDirection = sort_dir === 'asc' ? 'ASC' : 'DESC';
    const orderClause = `ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, l.created_at DESC`;

    let whereClause = ' WHERE 1=1';
    const params = [];
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
    await verifyUser(req);
    const { startDate, endDate, instances: allowedInstances, stream } = req.body;
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
                `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, media_url, file_name, mime_type, instance, phone, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                 ON CONFLICT (id) DO NOTHING`,
                [msgId, leadId, content, sender, type, 'delivered', msgTimestamp, mediaUrl, fileName, mimeType, name, phone, JSON.stringify({ importedFrom: 'whatsapp', contactName })]
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
    if (res.headersSent) {
      try { res.write(`data: ${JSON.stringify({ phase: 'done', success: false, error: error.message, instances: [] })}\n\n`); res.end(); } catch (_) {}
    } else {
      res.status(500).json({ error: error.message });
    }
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
       WHERE s.lead_id = $1 AND s.status = 'active'
       ORDER BY s.assigned_at DESC LIMIT 1`,
      [leadId]
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


// ═══════════════════════════════════════════════════════════════
// CHAT MESSAGES (persistência de histórico)
// ═══════════════════════════════════════════════════════════════

// GET /api/messages/:leadId — histórico paginado (mais recentes primeiro, retorna em ordem cronológica)
app.get('/api/messages/:leadId', async (req, res) => {
  try {
    await verifyUser(req);
    const { leadId } = req.params;
    const { before, limit = '50' } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

    let query, params;
    if (before) {
      query = `SELECT * FROM chat_messages WHERE lead_id = $1 AND timestamp < $2 ORDER BY timestamp DESC LIMIT $3`;
      params = [leadId, before, safeLimit];
    } else {
      query = `SELECT * FROM chat_messages WHERE lead_id = $1 ORDER BY timestamp DESC LIMIT $2`;
      params = [leadId, safeLimit];
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
      `INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, media_url, file_name, mime_type, reply_to_id, reply_to_content, reply_to_sender, attendant_id, attendant_name, instance, phone)
       VALUES ($1,$2,$3,'attendant',$4,$5,NOW(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO NOTHING`,
      [
        id, leadId, content || '', type || 'text', status || 'sent',
        persistedMediaUrl, fileName || null, mimeType || null,
        replyTo?.messageId || null, replyTo?.content || null, replyTo?.sender || null,
        user.id, attendantName, instance || null, phone || null,
      ]
    );

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
      `INSERT INTO chat_read_status (lead_id, user_id, last_read_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (lead_id, user_id) DO UPDATE SET last_read_at = NOW()`,
      [leadId, user.id]
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

    // Get leads that have:
    // 1. An open waiting session (not assigned)
    // 2. OR recent messages but no active/closed session (orphaned)
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (l.id)
        l.id,
        l.nome as name,
        l.telefone as phone,
        l.avatar_url,
        l.queue_id,
        l.queue_name,
        l.origem,
        l.priority,
        s.id as session_id,
        s.status as session_status,
        s.attendant_id,
        s.attendant_name,
        s.started_waiting_at,
        (SELECT content FROM chat_messages WHERE lead_id = l.id::text ORDER BY timestamp DESC LIMIT 1) as last_message,
        (SELECT timestamp FROM chat_messages WHERE lead_id = l.id::text ORDER BY timestamp DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM chat_messages WHERE lead_id = l.id::text AND sender = 'lead' AND timestamp > COALESCE(
          (SELECT last_read_at FROM chat_read_status WHERE lead_id = l.id::text AND user_id = $1 LIMIT 1),
          '1970-01-01'
        ))::INTEGER as unread_count
      FROM crm_leads l
      LEFT JOIN attendance_sessions s ON s.lead_id = l.id::text AND s.status IN ('waiting', 'active')
      WHERE EXISTS (SELECT 1 FROM chat_messages WHERE lead_id = l.id::text AND timestamp > NOW() - INTERVAL '7 days')
      ORDER BY l.id, s.started_waiting_at DESC NULLS LAST
    `, [user.id]);

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
      LEFT JOIN chat_read_status r ON r.lead_id = m.lead_id AND r.user_id = $1
      WHERE m.sender = 'lead'
        AND (r.last_read_at IS NULL OR m.timestamp > r.last_read_at)
      GROUP BY m.lead_id
    `, [user.id]);

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

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', error: error.message });
  }
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
// START SERVER

app.listen(PORT, async () => {
  console.log(`🦷 Odonto Connect API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Webhook URL: ${WEBHOOK_URL}`);

  // ─── Auto-migration: ensure required columns/tables exist ───
  try {
    const migrations = [
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true`,
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT`,
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS queue_id UUID`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS queue_name TEXT`,
      `ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS awaiting_queue_selection BOOLEAN DEFAULT false`,
      `CREATE TABLE IF NOT EXISTS user_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        UNIQUE (user_id, role)
      )`,
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW()
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
        metadata JSONB DEFAULT '{}'
      )`,
      `CREATE TABLE IF NOT EXISTS chat_read_status (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id TEXT NOT NULL,
        user_id UUID NOT NULL,
        last_read_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (lead_id, user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS attendance_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id TEXT NOT NULL,
        lead_name TEXT,
        lead_phone TEXT,
        attendant_id UUID,
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
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
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        endpoint TEXT UNIQUE NOT NULL,
        keys_p256dh TEXT NOT NULL,
        keys_auth TEXT NOT NULL,
        user_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS satisfaction_ratings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID,
        lead_id TEXT,
        lead_phone TEXT,
        rating INTEGER,
        attendant_id UUID,
        attendant_name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        color TEXT DEFAULT '#3B82F6',
        icon TEXT DEFAULT '🏷️',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS tag_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
        lead_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (tag_id, lead_id)
      )`,
      `CREATE TABLE IF NOT EXISTS contatos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome TEXT NOT NULL,
        telefone TEXT,
        email TEXT,
        tipo TEXT DEFAULT 'pessoal',
        empresa TEXT,
        cargo TEXT,
        observacoes TEXT,
        favorito BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `ALTER TABLE contatos ADD COLUMN IF NOT EXISTS favorito BOOLEAN DEFAULT false`,
      `CREATE TABLE IF NOT EXISTS automation_flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL DEFAULT 'custom',
        active BOOLEAN DEFAULT false,
        trigger_event TEXT NOT NULL DEFAULT 'Personalizado',
        steps JSONB NOT NULL DEFAULT '[]',
        stats JSONB NOT NULL DEFAULT '{"sent":0,"responded":0,"converted":0}',
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS automation_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        flow_id TEXT NOT NULL,
        flow_name TEXT,
        step_index INTEGER NOT NULL DEFAULT 0,
        patient_name TEXT,
        patient_phone TEXT NOT NULL,
        instance TEXT,
        variables JSONB DEFAULT '{}',
        message TEXT NOT NULL,
        channel TEXT DEFAULT 'whatsapp',
        status TEXT DEFAULT 'pending',
        scheduled_at TIMESTAMPTZ NOT NULL,
        sent_at TIMESTAMPTZ,
        error TEXT,
        trigger_event TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_automation_jobs_pending ON automation_jobs (status, scheduled_at) WHERE status = 'pending'`,
      `CREATE TABLE IF NOT EXISTS broadcast_campaigns (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        template JSONB NOT NULL DEFAULT '{}',
        tipo TEXT NOT NULL DEFAULT 'unico',
        dias_semana JSONB DEFAULT '[]',
        horario_inicio TEXT,
        horario_fim TEXT,
        data_inicio TEXT,
        data_fim TEXT,
        campanha_perpetua BOOLEAN DEFAULT false,
        usar_horario_clinica BOOLEAN DEFAULT false,
        publico TEXT DEFAULT 'todos',
        filtro_custom TEXT,
        numero_envio TEXT,
        contatos_alcancaveis INTEGER DEFAULT 0,
        capacidade_diaria INTEGER DEFAULT 232,
        intervalo_spam INTEGER DEFAULT 7,
        ativo BOOLEAN DEFAULT false,
        stats JSONB NOT NULL DEFAULT '{"enviadas":0,"entregues":0,"lidas":0,"respondidas":0,"erros":0}',
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS ai_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider TEXT NOT NULL UNIQUE,
        api_key TEXT NOT NULL DEFAULT '',
        model TEXT DEFAULT 'gpt-4o-mini',
        enabled BOOLEAN DEFAULT true,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS clinical_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id TEXT NOT NULL,
        patient_name TEXT,
        attendant_id TEXT,
        attendant_name TEXT,
        transcription TEXT,
        report TEXT,
        queixa_principal TEXT,
        procedimento TEXT,
        dente_regiao TEXT,
        prescricoes JSONB DEFAULT '[]',
        duration_seconds INTEGER,
        audio_url TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_clinical_reports_patient ON clinical_reports(patient_id)`,
      // Meta Ads tables
      `CREATE TABLE IF NOT EXISTS meta_ads_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id TEXT NOT NULL UNIQUE,
        account_name TEXT NOT NULL,
        access_token TEXT,
        connected BOOLEAN DEFAULT false,
        last_sync TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS meta_ads_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        objective TEXT,
        daily_budget NUMERIC(12,2),
        lifetime_budget NUMERIC(12,2),
        start_time TIMESTAMPTZ,
        stop_time TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS meta_ads_insights (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id TEXT NOT NULL,
        date_start DATE NOT NULL,
        date_stop DATE NOT NULL,
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        spend NUMERIC(12,2) DEFAULT 0,
        reach INTEGER DEFAULT 0,
        ctr NUMERIC(8,4) DEFAULT 0,
        cpc NUMERIC(8,2) DEFAULT 0,
        cpm NUMERIC(8,2) DEFAULT 0,
        actions JSONB DEFAULT '[]',
        leads INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        cost_per_lead NUMERIC(8,2),
        cost_per_conversion NUMERIC(8,2),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(campaign_id, date_start)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_meta_insights_campaign ON meta_ads_insights(campaign_id)`,
      `CREATE INDEX IF NOT EXISTS idx_meta_insights_date ON meta_ads_insights(date_start DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_meta_campaigns_account ON meta_ads_campaigns(account_id)`,
    ];

    for (const sql of migrations) {
      try {
        await pool.query(sql);
        applied++;
      } catch (migErr) {
        // 42701 = column already exists, 42P07 = relation already exists — both are fine
        if (!['42701', '42P07'].includes(migErr?.code)) {
          console.warn(`⚠️ Auto-migration warning: ${migErr.message.slice(0, 120)}`);
        }
      }
    }
    console.log(`   ✅ Auto-migration: ${applied} statements checked`);
  } catch (migErr) {
    console.error('❌ Auto-migration failed:', migErr.message);
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
});
