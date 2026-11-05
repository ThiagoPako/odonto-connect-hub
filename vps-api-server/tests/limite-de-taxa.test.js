// Limites de taxa: login/reset (IP e e-mail), signup (IP), webhooks (instância/segredo),
// busca, upload e envio manual de WhatsApp (usuário). Também o IP do cliente atrás do
// nginx (trust proxy só no loopback).
//
// Limites baixos via variável de ambiente, definidos antes de importar o server.
// pool.query/pool.connect são mockados: nada chega ao Postgres.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { createHash } from 'crypto';

// Sem keep-alive: com vários arquivos de teste no mesmo processo, o supertest abre um
// servidor por requisição numa porta efêmera; um socket keep-alive antigo para a mesma
// porta levaria a requisição ao app de outro arquivo (respostas 403/200 trocadas).
http.globalAgent = new http.Agent({ keepAlive: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

Object.assign(process.env, {
  RATE_LIMIT_LOGIN_DELAY_MS: '20',
  RATE_LIMIT_SIGNUP_IP_MAX: '2',
  RATE_LIMIT_BUSCA_USUARIO_MAX: '3',
  RATE_LIMIT_UPLOAD_USUARIO_MAX: '2',
  RATE_LIMIT_ENVIO_USUARIO_MAX: '3',
  RATE_LIMIT_EVOLUTION_INSTANCIA_MAX: '5',
  RATE_LIMIT_CLINICORP_SEGREDO_MAX: '4',
  RATE_LIMIT_CLINICORP_FALHA_MAX: '3',
  RATE_LIMIT_LOGIN_EMAIL_MAX: '7',
});
delete process.env.EVOLUTION_WEBHOOK_SECRET;

const { app, pool } = await import('../server.mjs');
const { resetRateLimitsForTests, clientIp, createLimiter } = await import('../rate-limit.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const userA = '44444444-4444-4444-4444-444444444444';
const userB = '66666666-6666-6666-6666-666666666666';
const token = (sub) => jwt.sign({ sub, email: 'x@clinica.com', role: 'admin', tenant_id: tenantA, is_super_admin: false }, JWT_SECRET);

const SENHA = 'senha-certa-123';
const HASH = bcrypt.hashSync(SENHA, 4);
const MSG = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

let querySpy;
let connectSpy;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  resetRateLimitsForTests();
  querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (/FROM profiles WHERE email = \$1/.test(text)) {
      if (params[0] === 'ok@clinica.com') {
        return { rows: [{ id: userA, name: 'A', email: 'ok@clinica.com', role: 'admin', password_hash: HASH, active: true, tenant_id: tenantA, is_super_admin: false }] };
      }
      return { rows: [] };
    }
    return { rows: [], rowCount: 0 };
  });
  connectSpy = jest.spyOn(pool, 'connect').mockImplementation(async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: () => {},
  }));
});

afterEach(() => { querySpy.mockRestore(); connectSpy.mockRestore(); });
afterAll(async () => { await pool.end(); });

const login = (email, password, ip = '203.0.113.10', header = 'x-real-ip') =>
  request(app).post('/api/auth/login').set(header, ip).send({ email, password });

describe('login', () => {
  test('5 falhas do mesmo e-mail no mesmo IP: a 6ª recebe 429 neutro com Retry-After; de outro IP, passa', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login('alvo@clinica.com', 'errada', '198.51.100.1')).status).toBe(401);
    }
    const res = await login('alvo@clinica.com', 'errada', '198.51.100.1');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: MSG });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // O dono da conta, de outro IP, não fica bloqueado por quem errou a senha.
    expect((await login('alvo@clinica.com', 'errada', '198.51.100.2')).status).toBe(401);
  });

  test('429 por e-mail + IP vale mesmo com a senha certa, e o mesmo texto para e-mail inexistente', async () => {
    const falhas = [];
    for (let i = 0; i < 5; i++) falhas.push((await login('ok@clinica.com', 'errada', '198.51.100.3')).status);
    expect(falhas).toEqual([401, 401, 401, 401, 401]);
    const certa = await login('ok@clinica.com', SENHA, '198.51.100.3');
    expect({ status: certa.status, body: certa.body }).toEqual({ status: 429, body: { error: MSG } });
    expect((await login('ok@clinica.com', SENHA, '198.51.100.4')).status).toBe(200);
    for (let i = 0; i < 5; i++) await login('nao-existe@clinica.com', 'errada', '198.51.100.5');
    const inexistente = await login('nao-existe@clinica.com', 'errada', '198.51.100.5');
    expect(inexistente.status).toBe(429);
    expect(inexistente.body).toEqual(certa.body);
  });

  test('e-mail sozinho tem teto bem mais alto (aqui 7 por env; padrão 50), de IPs diferentes', async () => {
    for (let i = 0; i < 7; i++) expect((await login('muito@clinica.com', 'errada', `192.0.2.${i}`)).status).toBe(401);
    expect((await login('muito@clinica.com', 'errada', '192.0.2.200')).status).toBe(429);
  });

  test('tráfego normal passa: login certo funciona e zera as falhas do e-mail', async () => {
    for (let i = 0; i < 4; i++) await login('ok@clinica.com', 'errada');
    const ok = await login('ok@clinica.com', SENHA);
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    // Sem o reset, 4 + 2 falhas no mesmo e-mail + IP passariam do limite de 5.
    for (let i = 0; i < 2; i++) expect((await login('ok@clinica.com', 'errada')).status).toBe(401);
    expect((await login('ok@clinica.com', SENHA)).status).toBe(200);
  });

  test('20 falhas do mesmo IP (e-mails diferentes): bloqueia o IP, outro IP passa', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await login(`u${i}@clinica.com`, 'errada', '203.0.113.7')).status).toBe(401);
    }
    expect((await login('outro@clinica.com', 'errada', '203.0.113.7')).status).toBe(429);
    expect((await login('outro@clinica.com', 'errada', '203.0.113.8')).status).toBe(401);
  });

  test('IP vem do X-Forwarded-For quando a conexão é do loopback (nginx)', async () => {
    for (let i = 0; i < 20; i++) await login(`f${i}@clinica.com`, 'errada', '192.0.2.44', 'x-forwarded-for');
    expect((await login('f99@clinica.com', 'errada', '192.0.2.44', 'x-forwarded-for')).status).toBe(429);
  });

  test('sem IP real (loopback sem header): não limita por IP, para não juntar todos num contador', async () => {
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: `l${i}@clinica.com`, password: 'x' });
      expect(res.status).toBe(401);
    }
  });

  test('atraso progressivo depois da 3ª falha', async () => {
    for (let i = 0; i < 4; i++) await login('lento@clinica.com', 'errada');
    const t0 = Date.now();
    expect((await login('lento@clinica.com', 'errada')).status).toBe(401); // 5ª falha: 20 * 2^2 = 80 ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
  });
});

describe('reset de senha e signup', () => {
  test('forgot-password: 3 por e-mail, depois 429 (exista ou não o e-mail)', async () => {
    for (const email of ['ok@clinica.com', 'nao-existe@clinica.com']) {
      for (let i = 0; i < 3; i++) {
        const r = await request(app).post('/api/auth/forgot-password').set('x-real-ip', `198.51.100.${i}`).send({ email });
        expect(r.status).toBe(200);
      }
      const bloqueado = await request(app).post('/api/auth/forgot-password').set('x-real-ip', '198.51.100.9').send({ email });
      expect(bloqueado.status).toBe(429);
      expect(bloqueado.body).toEqual({ error: MSG });
    }
  });

  test('signup-clinic: limite por IP', async () => {
    const signup = (ip) => request(app).post('/api/auth/signup-clinic').set('x-real-ip', ip).send({});
    expect((await signup('203.0.113.20')).status).toBe(400);
    expect((await signup('203.0.113.20')).status).toBe(400);
    expect((await signup('203.0.113.20')).status).toBe(429);
    expect((await signup('203.0.113.21')).status).toBe(400);
  });
});

describe('por usuário', () => {
  const get = (url, sub) => request(app).get(url).set('Authorization', `Bearer ${token(sub)}`);

  test('sub forjado (assinatura inválida) não gasta o limite do usuário verdadeiro', async () => {
    const forjado = jwt.sign({ sub: userA, role: 'admin', tenant_id: tenantA }, 'outro-segredo-qualquer');
    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/messages/search?q=dor').set('x-real-ip', '203.0.113.66').set('Authorization', `Bearer ${forjado}`);
    }
    expect((await get('/api/messages/search?q=dor', userA)).status).toBe(200);
    // O forjado cai no limite por IP.
    const r = await request(app).get('/api/messages/search?q=dor').set('x-real-ip', '203.0.113.66').set('Authorization', `Bearer ${forjado}`);
    expect(r.status).toBe(429);
  });

  test('busca de mensagens: limite por usuário, outro usuário não é afetado', async () => {
    for (let i = 0; i < 3; i++) expect((await get('/api/messages/search?q=dor', userA)).status).toBe(200);
    const bloqueado = await get('/api/messages/search?q=dor', userA);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.error).toMatch(/Aguarde/);
    expect((await get('/api/messages/search?q=dor', userB)).status).toBe(200);
  });

  test('upload: limite por usuário antes de ler o corpo', async () => {
    const up = (sub) => request(app).post('/api/media/upload?fileName=a.txt')
      .set('Authorization', `Bearer ${token(sub)}`).set('Content-Type', 'application/octet-stream').send(Buffer.from(''));
    expect((await up(userA)).status).not.toBe(429);
    expect((await up(userA)).status).not.toBe(429);
    expect((await up(userA)).status).toBe(429);
    expect((await up(userB)).status).not.toBe(429);
  });

  test('envio manual de WhatsApp: limite por usuário; send-presence fica de fora', async () => {
    const send = (url, sub) => request(app).post(url).set('Authorization', `Bearer ${token(sub)}`).send({});
    for (let i = 0; i < 3; i++) expect((await send('/api/whatsapp/send-text', userA)).status).not.toBe(429);
    expect((await send('/api/whatsapp/send-text', userA)).status).toBe(429);
    expect((await send('/api/whatsapp/send-media', userA)).status).toBe(429);
    expect((await send('/api/whatsapp/send-text', userB)).status).not.toBe(429);
    for (let i = 0; i < 6; i++) expect((await send('/api/whatsapp/send-presence', userA)).status).not.toBe(429);
  });
});

describe('webhooks', () => {
  test('Evolution: teto por instância; outra instância continua passando', async () => {
    const evento = (instance) => request(app).post('/api/webhook/evolution')
      .set('x-real-ip', '203.0.113.30').send({ event: 'evento.desconhecido', instance, data: {} });
    for (let i = 0; i < 5; i++) expect((await evento('clinica-a')).status).not.toBe(429);
    expect((await evento('clinica-a')).status).toBe(429);
    expect((await evento('clinica-b')).status).not.toBe(429);
  });

  test('Clinicorp: segredo vencido de uma clínica não derruba o webhook das outras no mesmo IP', async () => {
    const valido = 'segredo-valido-da-clinica-b-0123456789abcdefghij';
    querySpy.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (/FROM clinicorp_user_settings s\s+JOIN profiles p/.test(text)) {
        const ok = params.includes(valido) || params.includes(createHash('sha256').update(valido).digest('hex'));
        return { rows: ok ? [{ user_id: userB, tenant_id: tenantA }] : [] };
      }
      if (/INSERT INTO clinicorp_webhook_events/.test(text)) return { rows: [{ id: 1 }] };
      return { rows: [], rowCount: 0 };
    });
    const ipClinicorp = '203.0.113.40';
    const hook = (secret) => request(app).post('/api/webhook/clinicorp').set('x-real-ip', ipClinicorp).set('x-user-api', secret).send({});
    for (let i = 0; i < 3; i++) expect((await hook('segredo-vencido-clinica-a-xxxx')).status).toBe(401);
    expect((await hook('segredo-vencido-clinica-a-xxxx')).status).toBe(429);
    expect((await hook(valido)).status).toBe(200);
    expect((await hook('segredo-vencido-de-outra-clinica-c')).status).toBe(401);
  });

  test('Clinicorp: segredo válido passa mesmo com o IP bloqueado por credenciais curtas', async () => {
    const valido = 'segredo-valido-da-clinica-b-0123456789abcdefghij';
    querySpy.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (/FROM clinicorp_user_settings s\s+JOIN profiles p/.test(text)) {
        const ok = params.includes(valido) || params.includes(createHash('sha256').update(valido).digest('hex'));
        return { rows: ok ? [{ user_id: userB, tenant_id: tenantA }] : [] };
      }
      if (/INSERT INTO clinicorp_webhook_events/.test(text)) return { rows: [{ id: 1 }] };
      return { rows: [], rowCount: 0 };
    });
    const hook = (secret) => request(app).post('/api/webhook/clinicorp').set('x-real-ip', '203.0.113.42').set('x-user-api', secret).send({});
    for (let i = 0; i < 3; i++) expect((await hook('x')).status).toBe(401); // sem credencial plausível: conta por IP
    expect((await hook('y')).status).toBe(429);
    expect((await hook(valido)).status).toBe(200);
  });

  test('Clinicorp: teto por segredo', async () => {
    const hook = (i) => request(app).post('/api/webhook/clinicorp').set('x-real-ip', `198.51.100.${i}`).set('x-user-api', 'mesmo-segredo-12345678').send({});
    for (let i = 0; i < 4; i++) expect((await hook(i)).status).not.toBe(429);
    expect((await hook(10)).status).toBe(429);
  });
});

describe('varredura de chaves', () => {
  test('no máximo de chaves descarta as mais antigas, sem zerar as recentes', () => {
    const l = createLimiter('teste_varredura', { windowMs: 60_000, max: 2, maxKeys: 10 });
    for (let i = 0; i < 10; i++) l.hit(`k${i}`);
    l.hit('recente'); l.hit('recente');
    expect(l.size()).toBeLessThanOrEqual(10);
    expect(l.blocked('recente')).toMatchObject({ blocked: true });
    expect(l.blocked('k9').count).toBe(1);
    expect(l.blocked('k0').count).toBe(0);
  });
});

describe('IP do cliente', () => {
  test('conexão de fora do loopback ignora X-Real-IP e X-Forwarded-For', () => {
    const req = { socket: { remoteAddress: '198.51.100.77' }, headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }, ip: '198.51.100.77' };
    expect(clientIp(req)).toBe('198.51.100.77');
  });

  test('conexão do loopback usa o X-Real-IP do nginx', () => {
    const req = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-real-ip': '203.0.113.5' }, ip: '127.0.0.1' };
    expect(clientIp(req)).toBe('203.0.113.5');
  });

  test('trust proxy configurado só para o loopback', () => {
    expect(app.get('trust proxy')).toBe('loopback');
  });
});
