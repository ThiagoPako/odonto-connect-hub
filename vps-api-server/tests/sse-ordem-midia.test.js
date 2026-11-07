// SSE com mídia assinada (L7): o evento com mídia espera a assinatura do link; os eventos
// seguintes da mesma clínica não podem passar na frente (status/ACK antes da mensagem).
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-ci-multi-tenant';
delete process.env.MEDIA_AUTH_MODE;

const { pool, broadcastSSEForTests: broadcastSSE, sseClientsForTests: sseClients } = await import('../server.mjs');

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const midia = '/uploads/media/2026-11/0b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d.jpg';

const cliente = (tenantId) => {
  const recebidos = [];
  const c = { write: (p) => recebidos.push(p.split('\n')[0].replace('event: ', '')) };
  sseClients.set(c, { tenantId });
  return { c, recebidos };
};
const esperar = () => new Promise((r) => setTimeout(r, 30));

describe('SSE: ordem dos eventos com mídia', () => {
  let liberar, querySpy;
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  beforeEach(() => {
    // A consulta do dono da mídia (assinatura) só responde quando o teste libera.
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql) => {
      if (/FROM media_files/.test(String(sql))) {
        return new Promise((r) => { liberar = () => r({ rows: [{ path: midia, tenant_id: tenantA }] }); });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });
  afterEach(() => { querySpy.mockRestore(); sseClients.clear(); });
  afterAll(async () => { await pool.end(); });

  test('status da mesma clínica sai depois da mensagem com mídia', async () => {
    const a = cliente(tenantA);
    broadcastSSE('new-message', { id: 'm1', media_url: midia }, tenantA);
    broadcastSSE('message-status', { id: 'm1', status: 'read' }, tenantA);
    await esperar();
    expect(a.recebidos).toEqual([]); // nada passa na frente enquanto assina
    liberar();
    await esperar();
    expect(a.recebidos).toEqual(['new-message', 'message-status']);
  });

  test('outra clínica não espera a fila da primeira', async () => {
    const a = cliente(tenantA);
    const b = cliente(tenantB);
    broadcastSSE('new-message', { id: 'm1', media_url: midia }, tenantA);
    broadcastSSE('message-status', { id: 'x', status: 'read' }, tenantB);
    expect(b.recebidos).toEqual(['message-status']); // síncrono
    liberar();
    await esperar();
    expect(a.recebidos).toEqual(['new-message']);
  });

  test('sem mídia e sem nada pendente: envio síncrono', () => {
    const a = cliente(tenantA);
    broadcastSSE('message-status', { id: 'm1', status: 'read' }, tenantA);
    expect(a.recebidos).toEqual(['message-status']);
  });
});
