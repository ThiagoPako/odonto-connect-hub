// Camada de provedor de WhatsApp (docs/whatsapp/migracao-provedores.md §2).
//
// Cada adaptador (evolution, openwa, cloud) implementa a mesma interface. Regras:
// - Nenhum método lança: devolve { ok, ... }. Quem chama confere `ok` (padrão do evolutionFetch).
// - Envio devolve SendResult (abaixo). Sucesso = ok && providerMessageId.
// - O tenant nunca vem do provedor; quem chama resolve o canal da clínica antes.
// - Envio automático continua passando pela fila (enqueueWhatsAppJob → processOneWhatsAppJob);
//   o adaptador só executa o envio que a fila já liberou.

export const WA_PROVIDER_KINDS = Object.freeze(['evolution', 'openwa', 'cloud']);

export const WA_CAPABILITY_KEYS = Object.freeze([
  'qr', 'buttons', 'lists', 'polls', 'deleteForEveryone', 'archive', 'presence', 'typing',
  'contactsSync', 'history', 'profilePicture', 'calls', 'numberCheck', 'requiresTemplateOutside24h',
]);

// Métodos que todo adaptador expõe (os testes de contrato conferem esta lista).
export const WA_PROVIDER_METHODS = Object.freeze([
  'sendText', 'sendInteractive', 'getState', 'listStates', 'parseWebhook',
]);

// SendResult: { ok, providerMessageId, uncertain, retryable, status, error, raw }
//   uncertain: o provedor pode ter enviado sem confirmar (timeout). Quem chama NÃO reenvia por
//              outro caminho, para não duplicar (regra atual dos botões na fila).
//   retryable: falha transitória (5xx, rede); a fila pode reagendar.
//   raw:       resposta original { ok, status, data } (para mensagens de erro já existentes).
export function sendResult({ ok = false, providerMessageId = null, uncertain = false, retryable = false, status = 0, error = null, raw = null } = {}) {
  const id = providerMessageId ? String(providerMessageId) : null;
  return {
    ok: !!(ok && id),
    providerMessageId: id,
    uncertain: !!uncertain,
    retryable: !!retryable,
    status: Number(status) || 0,
    error: ok && id ? null : (error || (ok ? 'Provedor não devolveu o id da mensagem' : 'Falha no envio')),
    raw,
  };
}

const registry = new Map();

export function registerProvider(adapter) {
  const problems = validateProviderShape(adapter);
  if (problems.length) throw new Error(`Adaptador de WhatsApp inválido: ${problems.join('; ')}`);
  registry.set(adapter.kind, adapter);
  return adapter;
}

export function getProvider(kind) {
  return registry.get(kind) || null;
}

export function clearProvidersForTests() {
  registry.clear();
}

export function validateProviderShape(adapter) {
  const problems = [];
  if (!adapter || typeof adapter !== 'object') return ['adaptador ausente'];
  if (!WA_PROVIDER_KINDS.includes(adapter.kind)) problems.push(`kind inválido: ${adapter.kind}`);
  for (const m of WA_PROVIDER_METHODS) {
    if (typeof adapter[m] !== 'function') problems.push(`método ausente: ${m}`);
  }
  const caps = adapter.capabilities || {};
  for (const k of WA_CAPABILITY_KEYS) {
    if (typeof caps[k] !== 'boolean') problems.push(`capability sem booleano: ${k}`);
  }
  return problems;
}

// Qual adaptador atende um canal. F0: todo canal é Evolution (comportamento igual ao de
// antes). F1 passa a ler whatsapp_channels.provider aqui.
export function providerForChannel(channel) {
  const kind = channel && WA_PROVIDER_KINDS.includes(channel.provider) ? channel.provider : 'evolution';
  return getProvider(kind) || getProvider('evolution');
}
