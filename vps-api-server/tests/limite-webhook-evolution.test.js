// Webhook da Evolution com EVOLUTION_WEBHOOK_SECRET configurado: força bruta trocando
// o token a cada tentativa bate no teto por IP; token válido sempre passa.
// (Arquivo separado: o segredo é lido quando o server.mjs é importado.)
import request from 'supertest';
import http from 'http';
import { createHmac } from 'crypto';
import { jest } from '@jest/globals';

http.globalAgent = new http.Agent({ keepAlive: false });

Object.assign(process.env, {
  EVOLUTION_WEBHOOK_SECRET: 'segredo-de-teste-do-webhook-evolution',
  RATE_LIMIT_EVOLUTION_FALHA_MAX: '3',
  RATE_LIMIT_EVOLUTION_FALHA_IP_TOTAL_MAX: '6',
});

const { app, pool } = await import('../server.mjs');
const { resetRateLimitsForTests } = await import('../rate-limit.mjs');
const tokenDe = (instance) => createHmac('sha256', process.env.EVOLUTION_WEBHOOK_SECRET).update(instance).digest('hex').slice(0, 48);

let spy;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
beforeEach(() => {
  resetRateLimitsForTests();
  spy = jest.spyOn(pool, 'query').mockImplementation(async () => ({ rows: [], rowCount: 0 }));
});
afterEach(() => spy.mockRestore());
afterAll(async () => { await pool.end(); });

const evento = (instance, token, ip = '203.0.113.60') => request(app)
  .post(`/api/webhook/evolution?token=${token}`).set('x-real-ip', ip)
  .send({ event: 'evento.desconhecido', instance, data: {} });

test('token diferente a cada tentativa: o teto por IP bloqueia; o token válido passa', async () => {
  for (let i = 0; i < 6; i++) {
    const falso = createHmac('sha256', `chute-${i}`).update('x').digest('hex').slice(0, 48);
    expect((await evento('clinica-a', falso)).status).toBe(401);
  }
  const outroChute = createHmac('sha256', 'chute-novo').update('x').digest('hex').slice(0, 48);
  expect((await evento('clinica-a', outroChute)).status).toBe(429);
  expect((await evento('clinica-a', tokenDe('clinica-a'))).status).not.toBe(429);
  expect((await evento('clinica-b', tokenDe('clinica-b'))).status).not.toBe(429);
});

test('mesmo token errado repetido: bloqueia só esse par IP + token', async () => {
  const errado = 'f'.repeat(48);
  for (let i = 0; i < 3; i++) expect((await evento('clinica-a', errado)).status).toBe(401);
  expect((await evento('clinica-a', errado)).status).toBe(429);
  expect((await evento('clinica-a', 'e'.repeat(48))).status).toBe(401);
  expect((await evento('clinica-a', tokenDe('clinica-a'))).status).not.toBe(429);
});
