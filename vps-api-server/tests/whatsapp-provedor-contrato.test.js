// Contrato da camada de provedor de WhatsApp (F0 de docs/whatsapp/migracao-provedores.md):
// interface do adaptador, formato do resultado de envio, eventos internos e cifra das
// credenciais. Sem banco e sem rede (fetch mockado). Os próximos adaptadores (OpenWA, Cloud
// API) devem passar pelos mesmos testes de forma (validateProviderShape/validateInternalEvent).
import { jest } from '@jest/globals';
import { randomBytes } from 'crypto';
import {
  validateProviderShape, sendResult, registerProvider, getProvider, providerForChannel, clearProvidersForTests,
  WA_CAPABILITY_KEYS,
} from '../whatsapp/provider.mjs';
import { validateInternalEvent, inboundMessageEvent } from '../whatsapp/events.mjs';
import { createCredentialCipher, credentialCipherFromEnv, parseCredentialKey } from '../whatsapp/crypto.mjs';
import { createEvolutionAdapter, parseEvolutionWebhook } from '../whatsapp/adapters/evolution.mjs';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('Adaptador Evolution — contrato', () => {
  let fetchSpy, calls, nextResponse;
  const adapter = createEvolutionAdapter({ baseUrl: 'http://evo.teste.invalid/', apiKey: 'k-teste' });

  beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  beforeEach(() => {
    calls = [];
    nextResponse = () => jsonResponse(201, { key: { id: 'BAE5ABCDEF123456' } });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url, init });
      return nextResponse(url, init);
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  test('tem a forma exigida da interface (métodos e capabilities booleanas)', () => {
    expect(validateProviderShape(adapter)).toEqual([]);
    for (const k of WA_CAPABILITY_KEYS) expect(typeof adapter.capabilities[k]).toBe('boolean');
    expect(adapter.capabilities.requiresTemplateOutside24h).toBe(false);
  });

  test('sendText: mesmo pedido que a fila fazia (URL, apikey, número com @s.whatsapp.net, delay)', async () => {
    const r = await adapter.sendText('11111111-clinica a', '5511999990000', 'Olá', { delayMs: 1500, timeoutMs: 1000 });
    expect(r).toMatchObject({ ok: true, providerMessageId: 'BAE5ABCDEF123456', uncertain: false, error: null });
    expect(calls[0].url).toBe('http://evo.teste.invalid/message/sendText/11111111-clinica%20a');
    expect(calls[0].init.headers.apikey).toBe('k-teste');
    expect(JSON.parse(calls[0].init.body)).toEqual({ number: '5511999990000@s.whatsapp.net', text: 'Olá', delay: 1500 });
    expect(r.raw).toMatchObject({ ok: true, status: 201 });
  });

  test('sendText: HTTP ok sem key.id não conta como enviado', async () => {
    nextResponse = () => jsonResponse(201, { status: 'PENDING' });
    const r = await adapter.sendText('inst', '5511999990000', 'x');
    expect(r.ok).toBe(false);
    expect(r.providerMessageId).toBeNull();
    expect(r.error).toMatch(/id da mensagem/);
  });

  test('sendText: id em message.key.id também vale (regra da fila)', async () => {
    nextResponse = () => jsonResponse(200, { message: { key: { id: 'ABCDEF0123456789' } } });
    expect((await adapter.sendText('inst', '5511999990000', 'x')).providerMessageId).toBe('ABCDEF0123456789');
  });

  test('timeout vira "incerto" (504) e não lança', async () => {
    fetchSpy.mockImplementation(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    const r = await adapter.sendText('inst', '5511999990000', 'x');
    expect(r).toMatchObject({ ok: false, uncertain: true, retryable: true, status: 504 });
  });

  test('erro de rede vira resultado (não lança)', async () => {
    fetchSpy.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
    const r = await adapter.sendText('inst', '5511999990000', 'x');
    expect(r).toMatchObject({ ok: false, uncertain: false, status: 500 });
  });

  test('sem EVOLUTION_API_KEY não chama a rede', async () => {
    const semChave = createEvolutionAdapter({ baseUrl: 'http://evo.teste.invalid', apiKey: '' });
    const r = await semChave.sendText('inst', '5511999990000', 'x');
    expect(r.ok).toBe(false);
    expect(r.raw.data.error).toMatch(/EVOLUTION_API_KEY/);
    expect(calls).toHaveLength(0);
  });

  test('nome de instância com ".." é recusado antes da rede (outra clínica)', async () => {
    const r = await adapter.request('/instance/connectionState/abc/../outra');
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  test('sendInteractive: troca o number do payload pelo destinatário do job', async () => {
    const payload = { number: '5599000000000', title: 'Confirma?', buttons: [{ id: '1', text: 'Sim' }] };
    const r = await adapter.sendInteractive('inst', '5511999990000', { endpoint: 'sendButtons', payload, delayMs: 900 });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('http://evo.teste.invalid/message/sendButtons/inst');
    expect(JSON.parse(calls[0].init.body)).toEqual({ title: 'Confirma?', buttons: [{ id: '1', text: 'Sim' }], number: '5511999990000@s.whatsapp.net', delay: 900 });
  });

  test('sendInteractive: endpoint fora da lista é recusado sem rede', async () => {
    const r = await adapter.sendInteractive('inst', '5511999990000', { endpoint: 'sendText', payload: {} });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  test('listStates: "aberto" com a mesma regra da fila', async () => {
    nextResponse = () => jsonResponse(200, [
      { name: 'a', connectionStatus: 'open' },
      { instanceName: 'b', status: 'connecting' },
      { instance: { instanceName: 'c', state: 'open' } },
      { name: 'd', connectionStatus: 'close' },
      { connectionStatus: 'open' },
    ]);
    const r = await adapter.listStates();
    expect(r.ok).toBe(true);
    expect(r.states).toEqual([
      { ref: 'a', state: 'open' }, { ref: 'b', state: 'connecting' }, { ref: 'c', state: 'open' }, { ref: 'd', state: 'close' },
    ]);
  });

  test('listStates: falha da Evolution não lança e devolve lista vazia', async () => {
    nextResponse = () => jsonResponse(502, { error: 'bad gateway' });
    const r = await adapter.listStates();
    expect(r).toMatchObject({ ok: false, states: [] });
  });

  test('getState normaliza o estado', async () => {
    nextResponse = () => jsonResponse(200, { instance: { state: 'OPEN' } });
    expect(await adapter.getState('inst')).toMatchObject({ ok: true, state: 'open' });
  });

  test('rawFetch injeta a apikey; withKey=false não manda a chave', async () => {
    await adapter.rawFetch('/chat/findContacts/inst', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(calls[0].url).toBe('http://evo.teste.invalid/chat/findContacts/inst');
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json', apikey: 'k-teste' });
    await adapter.rawFetch('/', {}, { withKey: false });
    expect(calls[1].init.headers).toBeUndefined();
  });
});

describe('Webhook da Evolution → eventos internos', () => {
  const inst = '11111111-clinica-a';

  test('messages.upsert vira message.inbound válido, sem tenant', () => {
    const evts = parseEvolutionWebhook({
      event: 'messages.upsert', instance: inst,
      data: { key: { id: 'MSG1', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false }, message: { conversation: 'SAIR' }, messageTimestamp: 1789855200 },
    });
    expect(evts).toHaveLength(1);
    expect(validateInternalEvent(evts[0])).toEqual([]);
    expect(evts[0]).toMatchObject({
      type: 'message.inbound', provider: 'evolution', channelRef: inst, messageId: 'MSG1', from: '5511999990000',
      kind: 'text', text: 'SAIR', fromMe: false, isGroup: false, eventId: `evolution:${inst}:MSG1`,
    });
    expect(evts[0].timestamp).toBe(new Date(1789855200 * 1000).toISOString());
  });

  test('resposta de botão traz kind e buttonId', () => {
    const [e] = parseEvolutionWebhook({
      event: 'MESSAGES_UPSERT', instance: inst,
      data: { key: { id: 'MSG2', remoteJid: '5511999990000@s.whatsapp.net' }, message: { buttonsResponseMessage: { selectedButtonId: 'confirmar' } } },
    });
    expect(e).toMatchObject({ kind: 'button_response', buttonId: 'confirmar', text: 'confirmar' });
  });

  test('mídia aponta para a referência da mensagem (download fica no adaptador)', () => {
    const [e] = parseEvolutionWebhook({
      event: 'messages.upsert', instance: inst,
      data: { key: { id: 'MSG3', remoteJid: '5511999990000@s.whatsapp.net' }, message: { imageMessage: { caption: 'foto' } } },
    });
    expect(e).toMatchObject({ kind: 'image', text: 'foto', media: { ref: 'MSG3' } });
  });

  test('grupo é marcado (o webhook ignora)', () => {
    const [e] = parseEvolutionWebhook({
      event: 'messages.upsert', instance: inst,
      data: { key: { id: 'G1', remoteJid: '123-456@g.us' }, message: { conversation: 'oi' } },
    });
    expect(e.isGroup).toBe(true);
  });

  test('messages.update vira message.status com o status normalizado', () => {
    const evts = parseEvolutionWebhook({ event: 'messages.update', instance: inst, data: [{ keyId: 'MSG1', status: 'READ', remoteJid: '5511@s.whatsapp.net' }, { keyId: 'X', status: 'DESCONHECIDO' }] });
    expect(evts).toHaveLength(1);
    expect(validateInternalEvent(evts[0])).toEqual([]);
    expect(evts[0]).toMatchObject({ type: 'message.status', messageId: 'MSG1', status: 'read' });
  });

  test('send.message sem ack conta como enviado', () => {
    const [e] = parseEvolutionWebhook({ event: 'send.message', instance: inst, data: { key: { id: 'MSG9', remoteJid: '5511@s.whatsapp.net' } } });
    expect(e).toMatchObject({ type: 'message.status', messageId: 'MSG9', status: 'sent' });
  });

  test('connection.update e qrcode.updated viram channel.state', () => {
    const [c] = parseEvolutionWebhook({ event: 'connection.update', instance: inst, data: { state: 'open' } });
    expect(validateInternalEvent(c)).toEqual([]);
    expect(c).toMatchObject({ type: 'channel.state', state: 'open' });
    const [q] = parseEvolutionWebhook({ event: 'qrcode.updated', instance: inst, data: { qrcode: { base64: 'data:image/png;base64,AAA' } } });
    expect(q).toMatchObject({ type: 'channel.state', state: 'connecting', qr: 'data:image/png;base64,AAA' });
  });

  test('presence.update e evento desconhecido', () => {
    const [p] = parseEvolutionWebhook({ event: 'presence.update', instance: inst, data: { id: '5511@s.whatsapp.net', presences: { '5511@s.whatsapp.net': { lastKnownPresence: 'composing' } } } });
    expect(p).toMatchObject({ type: 'presence', chatId: '5511@s.whatsapp.net', status: 'composing' });
    const [u] = parseEvolutionWebhook({ event: 'chats.set', instance: inst, data: {} });
    expect(u).toMatchObject({ type: 'unknown', name: 'chats.set' });
    expect(parseEvolutionWebhook(null)).toEqual([]);
  });

  test('validador recusa evento com tenant (o tenant vem do canal, nunca do provedor)', () => {
    const e = inboundMessageEvent('evolution', inst, { messageId: 'M', chatId: 'c', tenantId: 'x' });
    expect(validateInternalEvent(e)).toContain('evento não pode trazer tenant (vem do canal)');
  });
});

describe('Registro de provedores', () => {
  afterEach(() => clearProvidersForTests());

  test('registra só adaptador com a forma certa; canal sem provider usa Evolution', () => {
    expect(() => registerProvider({ kind: 'openwa' })).toThrow(/método ausente/);
    const evo = registerProvider(createEvolutionAdapter({ baseUrl: 'http://x', apiKey: 'k' }));
    expect(getProvider('evolution')).toBe(evo);
    expect(providerForChannel(null)).toBe(evo);
    expect(providerForChannel({ provider: 'openwa' })).toBe(evo); // F0: OpenWA ainda não registrado
  });

  test('sendResult: ok exige id', () => {
    expect(sendResult({ ok: true }).ok).toBe(false);
    expect(sendResult({ ok: true, providerMessageId: 'A' })).toMatchObject({ ok: true, error: null });
  });
});

describe('Cifra das credenciais (AES-256-GCM)', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);

  test('cifra e decifra; o texto guardado não contém o segredo', () => {
    const c = createCredentialCipher({ keys: { 1: k1 }, currentVersion: 1 });
    const enc = c.encrypt('token-secreto-da-meta');
    expect(enc.ok).toBe(true);
    expect(enc.value).toMatch(/^v1:/);
    expect(enc.value).not.toContain('token-secreto');
    expect(c.decrypt(enc.value)).toEqual({ ok: true, value: 'token-secreto-da-meta', version: 1 });
    expect(c.encrypt('x').value).not.toBe(c.encrypt('x').value); // IV aleatório
  });

  test('valor adulterado ou chave errada não decifra (e não lança)', () => {
    const c = createCredentialCipher({ keys: { 1: k1 }, currentVersion: 1 });
    const enc = c.encrypt('segredo').value;
    const parts = enc.split(':');
    const ct = Buffer.from(parts[3], 'base64'); ct[0] ^= 1; parts[3] = ct.toString('base64');
    expect(c.decrypt(parts.join(':'))).toEqual({ ok: false, error: 'Falha ao decifrar' });
    const outra = createCredentialCipher({ keys: { 1: k2 }, currentVersion: 1 });
    expect(outra.decrypt(enc).ok).toBe(false);
    expect(c.decrypt('lixo').ok).toBe(false);
    expect(c.decrypt(null).ok).toBe(false);
  });

  test('troca de chave: versão antiga decifra, nova cifra, needsRotation avisa', () => {
    const antiga = createCredentialCipher({ keys: { 1: k1 }, currentVersion: 1 }).encrypt('s').value;
    const nova = createCredentialCipher({ keys: { 1: k1, 2: k2 }, currentVersion: 2 });
    expect(nova.decrypt(antiga)).toMatchObject({ ok: true, value: 's', version: 1 });
    expect(nova.needsRotation(antiga)).toBe(true);
    expect(nova.encrypt('s').value).toMatch(/^v2:/);
  });

  test('ambiente: base64 ou hex de 32 bytes; ausente/curta → null', () => {
    expect(credentialCipherFromEnv({})).toBeNull();
    expect(credentialCipherFromEnv({ WA_CREDENTIALS_KEY: 'curta' })).toBeNull();
    expect(parseCredentialKey(k1.toString('hex'))).toEqual(k1);
    const c = credentialCipherFromEnv({
      WA_CREDENTIALS_KEY: k2.toString('base64'), WA_CREDENTIALS_KEY_VERSION: '2',
      WA_CREDENTIALS_KEY_PREVIOUS: `1:${k1.toString('hex')}`,
    });
    expect(c.currentVersion).toBe(2);
    const antiga = createCredentialCipher({ keys: { 1: k1 }, currentVersion: 1 }).encrypt('ok').value;
    expect(c.decrypt(antiga).value).toBe('ok');
  });

  test('configuração errada lança só na criação', () => {
    expect(() => createCredentialCipher({ keys: { 1: Buffer.alloc(8) }, currentVersion: 1 })).toThrow();
    expect(() => createCredentialCipher({ keys: { 1: k1 }, currentVersion: 2 })).toThrow(/atual/);
  });
});
