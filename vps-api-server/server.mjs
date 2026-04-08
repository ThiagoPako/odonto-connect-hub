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
      'SELECT id, name, email, role, avatar_url, password_hash FROM profiles WHERE email = $1 LIMIT 1',
      [email.toLowerCase().trim()]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Email ou senha inválidos' });

    const profile = rows[0];
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

// ─── Forgot Password ────────────────────────────────────────
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
    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token in DB (create table if not exists)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Invalidate previous tokens
    await pool.query('UPDATE password_reset_tokens SET used = true WHERE user_id = $1', [profile.id]);
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [profile.id, resetToken, expiresAt]
    );

    const resetLink = `${APP_URL}/reset-password?token=${resetToken}`;

    if (smtpTransporter) {
      await smtpTransporter.sendMail({
        from: process.env.SMTP_FROM || '"Odonto Connect" <noreply@odontoconnect.tech>',
        to: email,
        subject: 'Recuperação de Senha — Odonto Connect',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
            <h2 style="color:#0e9aa7;margin-bottom:8px">🦷 Odonto Connect</h2>
            <p>Olá <strong>${profile.name}</strong>,</p>
            <p>Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo:</p>
            <div style="text-align:center;margin:28px 0">
              <a href="${resetLink}" style="background:#0e9aa7;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
                Redefinir Senha
              </a>
            </div>
            <p style="font-size:13px;color:#666">Este link expira em <strong>1 hora</strong>. Se você não solicitou, ignore este email.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
            <p style="font-size:11px;color:#999">Odonto Connect — Gestão Inteligente de Atendimento</p>
          </div>
        `,
      });
    } else {
      console.log(`[RESET] Token para ${email}: ${resetLink}`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token e nova senha obrigatórios' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Senha mínima de 6 caracteres' });

    const { rows } = await pool.query(
      'SELECT user_id, expires_at, used FROM password_reset_tokens WHERE token = $1 LIMIT 1',
      [token]
    );

    if (rows.length === 0) return res.status(400).json({ error: 'Token inválido' });
    const resetRow = rows[0];
    if (resetRow.used) return res.status(400).json({ error: 'Token já utilizado' });
    if (new Date(resetRow.expires_at) < new Date()) return res.status(400).json({ error: 'Token expirado' });

    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, resetRow.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = true WHERE token = $1', [token]);

    res.json({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
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

// Create instance
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
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Connect (get QR Code)
app.get('/api/whatsapp/connect/:instance', async (req, res) => {
  try {
    await verifyUser(req);
    const result = await evolutionFetch(`/instance/connect/${req.params.instance}`);
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
// PACIENTES (CRUD)
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
// HEALTH CHECK
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
});
