/**
 * Odonto Connect — VPS API Server
 * Runs alongside the frontend on the VPS
 * 
 * SETUP:
 * 1. cd vps-api-server && npm install
 * 2. cp .env.example .env  (preencha as variáveis)
 * 3. pm2 start server.mjs --name odonto-api
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const { Pool } = pg;
const app = express();
const PORT = process.env.API_PORT || 3002;

// ─── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── PostgreSQL ─────────────────────────────────────────────
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'odonto_db',
  user: process.env.PG_USER || 'odonto_user',
  password: process.env.PG_PASSWORD,
});

// ─── JWT Config ─────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const JWT_EXPIRES_IN = '7d';

// ─── Evolution API Config ───────────────────────────────────
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'https://api.odontoconnect.tech';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const VPS_BASE_URL = process.env.APP_URL || 'https://odontoconnect.tech';
const WEBHOOK_URL = `${VPS_BASE_URL.replace(/\/$/, '').replace(':443', '')}:${PORT}/api/webhook/evolution`;

// ─── Auto-register webhook on Evolution API instance ─────────
async function registerWebhook(instanceName) {
  try {
    const result = await evolutionFetch(`/webhook/set/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({
        url: WEBHOOK_URL,
        webhookByEvents: false,
        webhookBase64: false,
        events: [
          'MESSAGES_UPSERT',
          'CONNECTION_UPDATE',
          'QRCODE_UPDATED',
        ],
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

// ═══════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

    const { rows } = await pool.query(
      'SELECT id, name, email, role, avatar_url, password_hash, COALESCE(active, true) as active FROM profiles WHERE email = $1 LIMIT 1',
      [email.toLowerCase().trim()]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Email ou senha inválidos' });

    const profile = rows[0];
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

// ─── Admin: list all users ──────────────────────────────────
app.get('/api/auth/users', async (req, res) => {
  try {
    await verifyAdmin(req);
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.email, p.avatar_url, p.created_at, p.updated_at,
             COALESCE(p.active, true) as active,
             COALESCE(ur.role::text, p.role::text, 'user') as role
      FROM profiles p
      LEFT JOIN user_roles ur ON ur.user_id = p.id
      ORDER BY p.created_at DESC
    `);
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

// Send text message
app.post('/api/whatsapp/send-text', async (req, res) => {
  try {
    await verifyUser(req);
    const { instance, number, text } = req.body;
    const result = await evolutionFetch(`/message/sendText/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ number, text }),
    });
    res.json(result.data);
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
    const result = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instance}`, {
      method: 'POST',
      body: JSON.stringify({ number: cleanNumber }),
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: 'Não foi possível buscar a foto de perfil', details: result.data });
    }

    const pictureUrl = result.data?.profilePictureUrl || result.data?.picture || result.data?.url || null;

    // If leadId provided, save to crm_leads
    if (leadId && pictureUrl) {
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
    const { paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes } = req.body;
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO agendamentos (id, paciente_id, dentista_id, data, hora, duracao, procedimento, status, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, paciente_id, dentista_id, data, hora, duracao || 30, procedimento, status || 'agendado', observacoes]
    );
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

  req.on('close', () => {
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

app.post('/api/webhook/evolution', async (req, res) => {
  try {
    const body = req.body;
    const event = body.event;
    const instance = body.instance;

    // Only process incoming messages
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

    // Find lead by phone
    const { rows: leads } = await pool.query(
      `SELECT id, nome as name, avatar_url, telefone as phone, queue_id, awaiting_queue_selection FROM crm_leads 
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(telefone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
       LIMIT 1`,
      [phoneSuffix]
    );

    let lead = leads[0] || null;
    const pushName = message?.pushName || phone;

    // ─── New contact: create lead + check hours + send menu ───
    if (!lead) {
      const newId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO crm_leads (id, nome, telefone, origem, status, awaiting_queue_selection)
         VALUES ($1, $2, $3, 'whatsapp', 'novo', true)`,
        [newId, pushName, phone]
      );
      lead = { id: newId, name: pushName, phone, queue_id: null, awaiting_queue_selection: true, avatar_url: null };
      console.log(`🆕 New lead created: ${pushName} (${phone})`);

      // Check business hours
      if (!isWithinBusinessHours(attendanceSettingsCache)) {
        const offMsg = attendanceSettingsCache?.offHoursMessage ||
          'Olá! Nosso horário de atendimento encerrou. Deixe sua mensagem que retornaremos assim que possível! 😊';
        await evolutionFetch(`/message/sendText/${instance}`, {
          method: 'POST',
          body: JSON.stringify({ number: phone, text: offMsg }),
        });
        console.log(`🕐 Off-hours message sent to ${phone}`);
        // Still broadcast to SSE so attendants see the message
        broadcastSSE('new_message', {
          id: message?.key?.id || `wh-${Date.now()}`,
          phone, pushName, leadId: lead.id, leadName: lead.name,
          content: msgContent || `[${msgType}]`, type: msgType,
          timestamp: new Date().toISOString(), instance,
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
        // Invalid selection — resend menu
        await sendQueueMenu(instance, phone);
        return res.json({ processed: true, resent_menu: true });
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

    // ─── Normal message (queue already assigned) ───
    broadcastSSE('new_message', {
      id: message?.key?.id || `wh-${Date.now()}`,
      phone,
      pushName,
      leadId: lead.id,
      leadName: lead.name,
      content: msgContent || `[${msgType}]`,
      type: msgType,
      timestamp: new Date().toISOString(),
      instance,
      queueId: lead.queue_id || null,
    });

    console.log(`💬 New message from ${pushName} (${phone}) → broadcast to ${sseClients.size} clients`);

    // Auto-sync avatar if missing
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
        // 2. Fetch contacts from each connected instance
        const cRes = await fetch(`${EVOLUTION_API_URL}/chat/findContacts/${name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({}),
        });
        if (!cRes.ok) continue;
        const contacts = await cRes.json();

        const waContacts = (contacts || []).filter(c => c.id?.endsWith('@s.whatsapp.net'));

        for (const c of waContacts) {
          const telefone = c.id.replace('@s.whatsapp.net', '').replace(/\D/g, '');
          const nome = (c.pushName || c.name || telefone).trim();
          if (!telefone) continue;

          const existing = await pool.query('SELECT id FROM contatos WHERE telefone = $1', [telefone]);
          if (existing.rows.length > 0) {
            // Update name if it was just the phone number before
            if (nome && nome !== telefone) {
              await pool.query(
                `UPDATE contatos SET nome = $1, updated_at = NOW() WHERE telefone = $2 AND nome = telefone`,
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
    const before = await pool.query('SELECT COUNT(*) as total FROM contatos');
    await syncWhatsAppContacts();
    const after = await pool.query('SELECT COUNT(*) as total FROM contatos');
    const imported = parseInt(after.rows[0].total) - parseInt(before.rows[0].total);
    res.json({ success: true, imported, totalContatos: parseInt(after.rows[0].total) });
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
// START SERVER
// ═══════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`🦷 Odonto Connect API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);

  // Start auto-sync every 30 minutes
  syncWhatsAppContacts(); // Run once on startup
  syncInterval = setInterval(syncWhatsAppContacts, 30 * 60 * 1000);
  console.log('   📇 Auto-sync de contatos WhatsApp ativo (a cada 30 min)');
});
