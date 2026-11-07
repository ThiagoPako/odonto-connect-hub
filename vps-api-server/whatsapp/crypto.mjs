// Cifra das credenciais de canal de WhatsApp (token da Meta, API key de sessão do OpenWA,
// segredo de webhook). AES-256-GCM com chave do .env da VPS; nunca grava o valor em claro
// nem o devolve ao navegador ou ao log.
//
// Formato guardado (texto): "v<versão>:<iv base64>:<tag base64>:<cifrado base64>".
// A versão permite trocar a chave: a atual cifra; as antigas só decifram.
//
// Chaves (32 bytes, em base64 ou hex de 64 caracteres):
//   WA_CREDENTIALS_KEY           chave atual
//   WA_CREDENTIALS_KEY_VERSION   versão da chave atual (padrão 1)
//   WA_CREDENTIALS_KEY_PREVIOUS  "versão:chave,versão:chave" das chaves antigas (opcional)
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export function parseCredentialKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  let key = null;
  if (/^[0-9a-f]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else {
    try { key = Buffer.from(value, 'base64'); } catch { key = null; }
  }
  return key && key.length === 32 ? key : null;
}

// keys: { [versão]: Buffer(32) }. Lança só na criação (configuração errada); cifrar e
// decifrar devolvem { ok, value | error } e nunca lançam.
export function createCredentialCipher({ keys, currentVersion }) {
  const version = Number(currentVersion);
  if (!Number.isInteger(version) || version < 1) throw new Error('Versão de chave inválida');
  const table = new Map();
  for (const [v, key] of Object.entries(keys || {})) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error(`Chave da versão ${v} precisa de 32 bytes`);
    table.set(Number(v), key);
  }
  if (!table.has(version)) throw new Error('Chave atual ausente');

  return {
    currentVersion: version,
    encrypt(plaintext) {
      if (plaintext === null || plaintext === undefined) return { ok: false, error: 'Valor vazio' };
      try {
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv(ALGO, table.get(version), iv);
        const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return { ok: true, value: `v${version}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}` };
      } catch {
        return { ok: false, error: 'Falha ao cifrar' };
      }
    },
    decrypt(stored) {
      const m = /^v(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]*)$/.exec(String(stored || ''));
      if (!m) return { ok: false, error: 'Formato inválido' };
      const key = table.get(Number(m[1]));
      if (!key) return { ok: false, error: `Chave da versão ${m[1]} indisponível` };
      try {
        const decipher = createDecipheriv(ALGO, key, Buffer.from(m[2], 'base64'));
        decipher.setAuthTag(Buffer.from(m[3], 'base64'));
        const pt = Buffer.concat([decipher.update(Buffer.from(m[4], 'base64')), decipher.final()]);
        return { ok: true, value: pt.toString('utf8'), version: Number(m[1]) };
      } catch {
        // Tag não confere: chave errada ou valor adulterado. Sem detalhe (não vaza nada).
        return { ok: false, error: 'Falha ao decifrar' };
      }
    },
    needsRotation(stored) {
      const m = /^v(\d+):/.exec(String(stored || ''));
      return !!m && Number(m[1]) !== version;
    },
  };
}

// Lê do ambiente. Sem chave: devolve null (canais que precisam de credencial ficam
// indisponíveis, com aviso no boot), em vez de derrubar o servidor.
export function credentialCipherFromEnv(env = process.env) {
  const current = parseCredentialKey(env.WA_CREDENTIALS_KEY);
  if (!current) return null;
  const currentVersion = Number(env.WA_CREDENTIALS_KEY_VERSION || 1);
  const keys = { [currentVersion]: current };
  for (const item of String(env.WA_CREDENTIALS_KEY_PREVIOUS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const idx = item.indexOf(':');
    if (idx < 1) continue;
    const v = Number(item.slice(0, idx));
    const k = parseCredentialKey(item.slice(idx + 1));
    if (Number.isInteger(v) && v >= 1 && k && v !== currentVersion) keys[v] = k;
  }
  try { return createCredentialCipher({ keys, currentVersion }); } catch { return null; }
}
