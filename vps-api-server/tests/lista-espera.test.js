// Lista de espera e encaixe: inclusão por clínica, sugestão para horário liberado,
// oferta só pelo clique da recepção (um paciente por vez, pela fila, com prazo) e
// resposta do paciente no webhook. pool.query e fetch mockados: nada sai para a Evolution.
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });
process.env.EVOLUTION_API_KEY = 'chave-de-teste';
process.env.EVOLUTION_API_URL = 'http://evolution.teste.invalid';
delete process.env.EVOLUTION_WEBHOOK_SECRET;

const { app, pool, clearTenantSettingsCacheForTests, resetWhatsAppQueueStateForTests, parseWaitlistOfferReply } = await import('../server.mjs');
const JWT_SECRET = process.env.JWT_SECRET;

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const instA = '11111111-clinica-a';
const instB = '22222222-clinica-b';
const slotA = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const pacA = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const pacB = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const dentA = 'cccccccc-0000-4000-8000-0000000000c1';
const leA = 'dddddddd-0000-4000-8000-0000000000d1';
const ofertaA = 'eeeeeeee-0000-4000-8000-0000000000e1';
const telEspera = '5511977776666';
const instanceOwner = { [instA]: tenantA, [instB]: tenantB };
const auth = (tenant = tenantA) => ({
  Authorization: `Bearer ${jwt.sign({ sub: '44444444-4444-4444-4444-444444444444', email: 'a@a.com', role: 'admin', tenant_id: tenant, is_super_admin: false }, JWT_SECRET)}`,
});
const dentroDaJanela = () => jest.useFakeTimers({
  now: new Date('2026-11-04T13:00:00Z'), // quarta, 10h em São Paulo
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(20); }
  return fn();
}

describe('Lista de espera e encaixe', () => {
  let querySpy, fetchSpy, sqlLog, fetchLog, slot, candidatos, ofertaAtiva, ofertaPendente, claimOk, ocupado, existingLead;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  beforeEach(() => {
    clearTenantSettingsCacheForTests();
    resetWhatsAppQueueStateForTests();
    sqlLog = []; fetchLog = [];
    slot = { id: slotA, data: '2026-11-06', hora: '09:00', duracao: 30, dentista_id: dentA, paciente_id: pacA, status: 'remarcar', dentista_nome: 'Dra. Ana' };
    candidatos = [{ id: leA, paciente_id: pacB, paciente_nome: 'João Silva', telefone: telEspera }];
    ofertaAtiva = []; claimOk = true; ocupado = false;
    existingLead = { id: 'lead-1', name: 'João', phone: telEspera, awaiting_queue_selection: false };
    ofertaPendente = {
      id: ofertaA, lista_espera_id: leA, paciente_id: pacB, agendamento_origem_id: slotA,
      data: '2026-11-06', hora: '09:00', duracao: 30, dentista_id: dentA, expires_at: new Date(Date.now() + 3600_000),
    };
    querySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params = []) => {
      const text = String(sql);
      sqlLog.push({ text, params });
      const ok = (rows, rowCount = rows.length) => Promise.resolve({ rows, rowCount });
      if (/SELECT tenant_id FROM whatsapp_instances WHERE instance_name = \$1/.test(text)) {
        const t = instanceOwner[params[0]]; return ok(t ? [{ tenant_id: t }] : []);
      }
      if (/SELECT instance_name FROM whatsapp_instances WHERE tenant_id = \$1/.test(text)) {
        return ok(Object.entries(instanceOwner).filter(([, t]) => t === params[0]).map(([n]) => ({ instance_name: n })));
      }
      if (/SELECT 1 FROM (pacientes|dentistas) WHERE id = \$1 AND tenant_id = \$2/.test(text)) {
        const okRef = (params[0] === pacB || params[0] === dentA) && params[1] === tenantA;
        return ok(okRef ? [{ x: 1 }] : []);
      }
      if (/FROM whatsapp_opt_outs/.test(text) && !/FROM lista_espera le/.test(text)) return ok([]);
      if (/SELECT nome FROM tenants WHERE id = \$1/.test(text)) return ok([{ nome: params[0] === tenantA ? 'Clínica A' : 'Clínica B' }]);
      if (/FROM agendamentos a LEFT JOIN dentistas d ON d.id = a.dentista_id AND d.tenant_id = a.tenant_id\s+WHERE a.id = \$1 AND a.tenant_id = \$2/.test(text)) {
        return ok(params[0] === slotA && params[1] === tenantA ? [slot] : []);
      }
      if (/FROM lista_espera le\s+JOIN pacientes p ON p.id = le.paciente_id AND p.tenant_id = le.tenant_id\s+WHERE le.tenant_id = \$1 AND le.status = 'aguardando'/.test(text)) {
        return ok(params[0] === tenantA ? candidatos : []);
      }
      if (/FROM lista_espera_ofertas o JOIN pacientes p ON p.id = o.paciente_id AND p.tenant_id = o.tenant_id\s+WHERE o.tenant_id = \$1 AND o.agendamento_origem_id = \$2/.test(text)) return ok([]);
      if (/SELECT status FROM lista_espera_ofertas WHERE tenant_id = \$1 AND agendamento_origem_id = \$2/.test(text)) return ok(ofertaAtiva);
      if (/WHERE o.tenant_id = \$1 AND o.status = 'enviada'\s+AND RIGHT/.test(text)) {
        const okTel = String(telEspera).endsWith(String(params[1]).slice(-8));
        return ok(params[0] === tenantA && okTel && ofertaPendente && (!params[2] || params[2] === ofertaPendente.id) ? [ofertaPendente] : []);
      }
      if (/SET status = 'aceita'/.test(text)) return ok(claimOk ? [{ id: ofertaA }] : []);
      if (/FROM agendamentos\s+WHERE tenant_id = \$1 AND data = \$2 AND LEFT\(hora, 5\) = \$3/.test(text)) return ok(ocupado ? [{ x: 1 }] : []);
      if (/SELECT id, nome as name, avatar_url, telefone as phone/.test(text)) return ok(existingLead ? [existingLead] : []);
      if (/INSERT INTO automation_jobs/.test(text)) return ok([{ id: `job-${sqlLog.length}` }]);
      return ok([]);
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      fetchLog.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      if (/fetchInstances/.test(String(url))) return { ok: true, status: 200, json: async () => [{ name: instB, connectionStatus: 'open' }, { name: instA, connectionStatus: 'open' }] };
      return { ok: true, status: 200, json: async () => ({ key: { id: 'X' } }) };
    });
  });

  afterEach(() => { querySpy.mockRestore(); fetchSpy.mockRestore(); jest.useRealTimers(); });
  afterAll(async () => { await pool.end(); });

  const q = (re) => sqlLog.filter(s => re.test(s.text));
  const jobInserts = () => q(/INSERT INTO automation_jobs/);
  const jobCol = (ins, col) => {
    const cols = ins.text.match(/\(([^)]+)\) VALUES/)[1].split(',').map(c => c.trim());
    return ins.params[cols.indexOf(col)];
  };
  const jobVars = (ins) => JSON.parse(jobCol(ins, 'variables') || '{}');
  const sends = () => fetchLog.filter(f => /\/message\/send/.test(f.url));

  describe('cadastro na lista', () => {
    test('inclui paciente e profissional da própria clínica', async () => {
      const res = await request(app).post('/api/lista-espera').set(auth()).send({ paciente_id: pacB, dentista_id: dentA, periodo: 'manha' });
      expect(res.status).toBe(200);
      const [ins] = q(/INSERT INTO lista_espera \(/);
      expect(ins.params.slice(1, 5)).toEqual([tenantA, pacB, dentA, 'manha']);
    });
    test('paciente de outra clínica: 400 sem inserir', async () => {
      const res = await request(app).post('/api/lista-espera').set(auth(tenantB)).send({ paciente_id: pacB });
      expect(res.status).toBe(400);
      expect(q(/INSERT INTO lista_espera \(/)).toHaveLength(0);
    });
    test('período inválido: 400', async () => {
      const res = await request(app).post('/api/lista-espera').set(auth()).send({ paciente_id: pacB, periodo: 'madrugada' });
      expect(res.status).toBe(400);
    });
    test('remoção filtra pela clínica', async () => {
      await request(app).delete(`/api/lista-espera/${leA}`).set(auth());
      const [upd] = q(/UPDATE lista_espera SET status = 'removido'/);
      expect(upd.params).toEqual([leA, tenantA]);
    });
  });

  describe('sugestão de encaixe', () => {
    test('horário liberado da clínica: devolve quantos pacientes servem', async () => {
      dentroDaJanela();
      const res = await request(app).get(`/api/agenda/${slotA}/encaixe`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ disponivel: true, liberado: true, candidatos: 1, oferta: null });
      const [cq] = q(/FROM lista_espera le\s+JOIN pacientes p/);
      expect(cq.params).toEqual([tenantA, dentA, 'manha', pacA, slotA]);
      expect(cq.text).toMatch(/whatsapp_opt_outs/);
    });
    test('agendamento de outra clínica: 404', async () => {
      const res = await request(app).get(`/api/agenda/${slotA}/encaixe`).set(auth(tenantB));
      expect(res.status).toBe(404);
    });
    test('horário não liberado: sem sugestão', async () => {
      dentroDaJanela();
      slot.status = 'agendado';
      const res = await request(app).get(`/api/agenda/${slotA}/encaixe`).set(auth());
      expect(res.body).toMatchObject({ disponivel: false, candidatos: 0 });
    });
  });

  describe('oferecer horário (clique da recepção)', () => {
    test('uma oferta, para um paciente, pela fila da clínica, com botões e prazo', async () => {
      dentroDaJanela();
      const res = await request(app).post(`/api/agenda/${slotA}/oferecer-horario`).set(auth());
      expect(res.status).toBe(200);
      const [of] = q(/INSERT INTO lista_espera_ofertas/);
      expect(of.params.slice(1, 5)).toEqual([tenantA, leA, pacB, slotA]);
      const expires = new Date(of.params[9]).getTime();
      expect(expires - Date.now()).toBeLessThanOrEqual(2 * 3600_000);
      const ins = jobInserts();
      expect(ins).toHaveLength(1);
      expect(jobCol(ins[0], 'tenant_id')).toBe(tenantA);
      expect(jobCol(ins[0], 'instance')).toBe(instA);
      expect(jobCol(ins[0], 'trigger_event')).toBe('waitlist_offer');
      expect(jobCol(ins[0], 'category')).toBe('transactional');
      expect(String(jobCol(ins[0], 'patient_phone'))).toMatch(/77776666$/);
      expect(jobCol(ins[0], 'message')).toMatch(/Responda \*QUERO\*/);
      expect(jobCol(ins[0], 'message')).toMatch(/06\/11\/2026/);
      const v = jobVars(ins[0]);
      expect(v.interactive.payload.buttons.map(b => b.buttonId)).toEqual([`oferta_aceitar_${of.params[0]}`, `oferta_recusar_${of.params[0]}`]);
      expect(sends()).toHaveLength(0);
    });
    test('já há oferta aguardando resposta: 409, nenhuma nova', async () => {
      dentroDaJanela();
      ofertaAtiva = [{ status: 'enviada' }];
      const res = await request(app).post(`/api/agenda/${slotA}/oferecer-horario`).set(auth());
      expect(res.status).toBe(409);
      expect(q(/INSERT INTO lista_espera_ofertas/)).toHaveLength(0);
      expect(jobInserts()).toHaveLength(0);
    });
    test('fora da janela de envio: 409', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-08T13:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
      slot.data = '2026-11-10';
      const res = await request(app).post(`/api/agenda/${slotA}/oferecer-horario`).set(auth());
      expect(res.status).toBe(409);
      expect(jobInserts()).toHaveLength(0);
    });
    test('horário não liberado: 409', async () => {
      dentroDaJanela();
      slot.status = 'confirmado';
      const res = await request(app).post(`/api/agenda/${slotA}/oferecer-horario`).set(auth());
      expect(res.status).toBe(409);
    });
    test('ninguém na lista: 404', async () => {
      dentroDaJanela();
      candidatos = [];
      const res = await request(app).post(`/api/agenda/${slotA}/oferecer-horario`).set(auth());
      expect(res.status).toBe(404);
    });
    test('clínica B não oferece horário da clínica A', async () => {
      dentroDaJanela();
      const res = await request(app).post(`/api/agenda/${slotA}/oferecer-horario`).set(auth(tenantB));
      expect(res.status).toBe(404);
      expect(jobInserts()).toHaveLength(0);
    });
  });

  describe('resposta do paciente', () => {
    test.each([['QUERO', true], ['quero sim', true], ['Não', false], ['não posso', false], [`oferta_aceitar_${ofertaA}`, true]])(
      '%s', (txt, accept) => expect(parseWaitlistOfferReply(txt).accept).toBe(accept));

    const webhook = (content, { instance = instA, button = false } = {}) => request(app).post('/api/webhook/evolution').send({
      event: 'messages.upsert', instance,
      data: {
        key: { remoteJid: `${telEspera}@s.whatsapp.net`, fromMe: false, id: `MSG-${Math.random()}` },
        message: button ? { buttonsResponseMessage: { selectedButtonId: content } } : { conversation: content },
        pushName: 'João', messageTimestamp: 1,
      },
    });

    test('QUERO: cria o agendamento na clínica A e responde pela fila', async () => {
      await webhook('QUERO');
      const [ag] = await waitFor(() => { const r = q(/INSERT INTO agendamentos/); return r.length ? r : null; });
      expect(ag.params[1]).toBe(pacB);
      expect(ag.params[2]).toBe(dentA);
      expect(ag.params[6]).toBe(tenantA);
      const replies = await waitFor(() => { const r = jobInserts().filter(i => jobCol(i, 'trigger_event') === 'auto_reply'); return r.length ? r : null; });
      expect(jobCol(replies[0], 'message')).toMatch(/é seu/);
      expect(q(/UPDATE lista_espera SET status = 'encaixado'/)[0].params).toEqual([leA, tenantA]);
      expect(sends()).toHaveLength(0);
    });

    test('botão aceitar usa o id da oferta', async () => {
      await webhook(`oferta_aceitar_${ofertaA}`, { button: true });
      await waitFor(() => q(/INSERT INTO agendamentos/).length);
      const [sel] = q(/WHERE o.tenant_id = \$1 AND o.status = 'enviada'/);
      expect(sel.params[2]).toBe(ofertaA);
    });

    test('NÃO: oferta recusada, paciente volta para a lista, nada é agendado', async () => {
      await webhook('não');
      await waitFor(() => q(/SET status = 'recusada'/).length);
      await sleep(100);
      expect(q(/INSERT INTO agendamentos/)).toHaveLength(0);
      expect(q(/UPDATE lista_espera SET status = 'aguardando'/)[0].params).toEqual([leA, tenantA]);
    });

    test('oferta vencida: não agenda e avisa que o horário não está disponível', async () => {
      claimOk = false;
      await webhook('QUERO');
      const replies = await waitFor(() => { const r = jobInserts().filter(i => jobCol(i, 'trigger_event') === 'auto_reply'); return r.length ? r : null; });
      expect(jobCol(replies[0], 'message')).toMatch(/não está mais disponível/);
      expect(q(/INSERT INTO agendamentos/)).toHaveLength(0);
    });

    test('horário ocupado por fora: não agenda', async () => {
      ocupado = true;
      await webhook('QUERO');
      await waitFor(() => q(/SET status = 'indisponivel'/).length);
      expect(q(/INSERT INTO agendamentos/)).toHaveLength(0);
    });

    test('mensagem no número da clínica B não aceita oferta da clínica A', async () => {
      await webhook('QUERO', { instance: instB });
      await sleep(200);
      expect(q(/SET status = 'aceita'/)).toHaveLength(0);
      expect(q(/INSERT INTO agendamentos/)).toHaveLength(0);
    });

    test('pedido de remarcação não dispara oferta automática', async () => {
      // Resposta "2" ao lembrete: nenhuma oferta nem job de waitlist sem o clique da recepção.
      await webhook('2');
      await sleep(200);
      expect(q(/INSERT INTO lista_espera_ofertas/)).toHaveLength(0);
      expect(jobInserts().filter(i => jobCol(i, 'trigger_event') === 'waitlist_offer')).toHaveLength(0);
    });
  });
});
