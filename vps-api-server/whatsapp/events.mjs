// Evento interno de WhatsApp: o formato único em que cada adaptador (Evolution, OpenWA,
// Cloud API) entrega o que o provedor mandou no webhook. O processamento (lead, chat,
// SAIR, confirmação, menu) passa a depender só deste formato.
//
// Campos comuns: { type, provider, channelRef, receivedAt, eventId }
//   channelRef: identificador do canal no provedor (instance_name | session id | phone_number_id).
//               O tenant NUNCA vem do provedor: é resolvido pelo canal no nosso banco.
//   eventId:    chave de dedupe (provedores reenviam); null quando o provedor não dá uma.
//
// Tipos:
//   message.inbound  { from, chatId, messageId, fromMe, kind, text, buttonId, media, quotedId, timestamp, isGroup }
//   message.status   { messageId, chatId, status: 'sent'|'delivered'|'read'|'failed', errorCode }
//   presence         { chatId, status }
//   channel.state    { state: 'open'|'connecting'|'close'|'restricted', qr }
//   unknown          { name }  (evento que o adaptador não traduz; o webhook ignora)

export const WA_EVENT_TYPES = Object.freeze(['message.inbound', 'message.status', 'presence', 'channel.state', 'unknown']);
export const WA_MESSAGE_KINDS = Object.freeze(['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'button_response', 'list_response', 'reaction', 'other']);
export const WA_DELIVERY_STATUSES = Object.freeze(['sent', 'delivered', 'read', 'failed']);
export const WA_CHANNEL_STATES = Object.freeze(['open', 'connecting', 'close', 'restricted']);

function base(type, provider, channelRef, extra) {
  // O tenant nunca vem do provedor: campos de clínica no payload são descartados aqui.
  const { tenantId: _t, tenant_id: _t2, ...rest } = extra || {};
  return {
    type,
    provider: String(provider || ''),
    channelRef: channelRef ? String(channelRef) : '',
    receivedAt: new Date().toISOString(),
    eventId: null,
    ...rest,
  };
}

export function inboundMessageEvent(provider, channelRef, fields) {
  return base('message.inbound', provider, channelRef, {
    from: '', chatId: '', messageId: '', fromMe: false, kind: 'text', text: '', buttonId: null,
    media: null, quotedId: null, timestamp: null, isGroup: false,
    ...fields,
  });
}

export function messageStatusEvent(provider, channelRef, fields) {
  return base('message.status', provider, channelRef, { messageId: '', chatId: '', status: null, errorCode: null, ...fields });
}

export function presenceEvent(provider, channelRef, fields) {
  return base('presence', provider, channelRef, { chatId: '', status: null, ...fields });
}

export function channelStateEvent(provider, channelRef, fields) {
  return base('channel.state', provider, channelRef, { state: 'close', qr: null, ...fields });
}

export function unknownEvent(provider, channelRef, name) {
  return base('unknown', provider, channelRef, { name: String(name || '') });
}

// Validação de contrato (usada nos testes de cada adaptador): devolve a lista de problemas.
export function validateInternalEvent(evt) {
  const errors = [];
  if (!evt || typeof evt !== 'object') return ['evento não é objeto'];
  if (!WA_EVENT_TYPES.includes(evt.type)) errors.push(`type inválido: ${evt.type}`);
  if (!evt.provider) errors.push('provider vazio');
  if (typeof evt.channelRef !== 'string') errors.push('channelRef não é texto');
  if ('tenantId' in evt || 'tenant_id' in evt) errors.push('evento não pode trazer tenant (vem do canal)');
  if (evt.type === 'message.inbound') {
    if (!evt.messageId) errors.push('messageId vazio');
    if (!evt.chatId) errors.push('chatId vazio');
    if (!WA_MESSAGE_KINDS.includes(evt.kind)) errors.push(`kind inválido: ${evt.kind}`);
    if (typeof evt.fromMe !== 'boolean') errors.push('fromMe não é booleano');
  }
  if (evt.type === 'message.status') {
    if (!evt.messageId) errors.push('messageId vazio');
    if (!WA_DELIVERY_STATUSES.includes(evt.status)) errors.push(`status inválido: ${evt.status}`);
  }
  if (evt.type === 'channel.state' && !WA_CHANNEL_STATES.includes(evt.state)) errors.push(`state inválido: ${evt.state}`);
  return errors;
}
