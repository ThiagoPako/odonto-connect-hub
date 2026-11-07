// Limite de taxa em memória (janela fixa por chave).
//
// A API roda num único processo PM2, então a memória do processo basta. Se um dia
// houver mais de um processo, os contadores precisam ir para o Redis (o app já tem
// getRedisClient() em server.mjs, hoje usado só no /api/health).
//
// Números ajustáveis por variável de ambiente: RATE_LIMIT_<NOME>_MAX e
// RATE_LIMIT_<NOME>_WINDOW_MS (ex.: RATE_LIMIT_LOGIN_EMAIL_MAX=5).
// RATE_LIMIT_DISABLED=1 desliga todos os limites (emergência).
import net from 'net';

const DISABLED = process.env.RATE_LIMIT_DISABLED === '1';
const MAX_KEYS = 100_000;

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const limiters = new Set();

export function createLimiter(name, { windowMs, max, maxKeys = MAX_KEYS }) {
  const envName = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const cfg = {
    name,
    windowMs: envInt(`RATE_LIMIT_${envName}_WINDOW_MS`, windowMs),
    max: envInt(`RATE_LIMIT_${envName}_MAX`, max),
  };
  const buckets = new Map(); // key -> { count, resetAt }

  const bucketOf = (key, now) => {
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      if (b) buckets.delete(key); // reinsere no fim: o Map fica em ordem de início da janela
      else if (buckets.size >= maxKeys) sweep(now);
      b = { count: 0, resetAt: now + cfg.windowMs };
      buckets.set(key, b);
    }
    return b;
  };

  // Tira as janelas vencidas; se ainda estiver no máximo de chaves, descarta as mais
  // antigas (o Map guarda a ordem de inserção) até 90% do máximo, sem zerar as outras.
  function sweep(now = Date.now()) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size >= maxKeys) {
      const alvo = Math.floor(maxKeys * 0.9);
      for (const k of buckets.keys()) {
        if (buckets.size <= alvo) break;
        buckets.delete(k);
      }
    }
  }

  const retryAfter = (b, now) => Math.max(1, Math.ceil((b.resetAt - now) / 1000));

  const limiter = {
    ...cfg,
    // Conta uma ocorrência e diz se ainda está dentro do limite.
    hit(key) {
      if (DISABLED || key == null || key === '') return { allowed: true, count: 0, retryAfterSec: 0 };
      const now = Date.now();
      const b = bucketOf(String(key), now);
      b.count += 1;
      return { allowed: b.count <= cfg.max, count: b.count, retryAfterSec: retryAfter(b, now) };
    },
    // Só consulta: já passou do limite? (não conta nada)
    blocked(key) {
      if (DISABLED || key == null || key === '') return { blocked: false, count: 0, retryAfterSec: 0 };
      const now = Date.now();
      const b = buckets.get(String(key));
      if (!b || b.resetAt <= now) return { blocked: false, count: 0, retryAfterSec: 0 };
      return { blocked: b.count >= cfg.max, count: b.count, retryAfterSec: retryAfter(b, now) };
    },
    reset(key) { buckets.delete(String(key)); },
    clear() { buckets.clear(); },
    sweep,
    size() { return buckets.size; },
  };
  limiters.add(limiter);
  return limiter;
}

// Limpeza periódica das janelas vencidas (não segura o processo aberto).
const sweepTimer = setInterval(() => { for (const l of limiters) l.sweep(); }, 60_000);
sweepTimer.unref?.();

export function resetRateLimitsForTests() { for (const l of limiters) l.clear(); }

// ─── IP do cliente ───────────────────────────────────────────
// Com app.set('trust proxy', 'loopback'), req.ip só usa X-Forwarded-For quando a
// conexão vem do loopback (o nginx na mesma máquina). O nginx de produção envia
// X-Real-IP no bloco /api/; ele é preferido quando a conexão vem do loopback.
// Conexão direta de fora (sem nginx) nunca tem os headers considerados.
export function isLoopbackAddress(addr) {
  const a = String(addr || '');
  return a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.');
}

export function clientIp(req) {
  const sock = req.socket?.remoteAddress || '';
  if (isLoopbackAddress(sock)) {
    const real = String(req.headers?.['x-real-ip'] || '').trim();
    if (real && net.isIP(real)) return real;
  }
  return req.ip || sock || null;
}

// Chave por IP para limites. Se o IP resolvido ainda for o loopback (proxy sem
// X-Real-IP/X-Forwarded-For, ou chamada local), não limita por IP: senão todos os
// usuários dividiriam o mesmo contador e um bloquearia os outros.
let avisouSemIp = false;
export function ipKey(req) {
  const ip = clientIp(req);
  if (!ip || isLoopbackAddress(ip)) {
    if (!avisouSemIp && process.env.NODE_ENV !== 'test') {
      avisouSemIp = true;
      console.warn('[rate-limit] requisição sem IP real do cliente (proxy sem X-Real-IP?): limite por IP ignorado');
    }
    return null;
  }
  return ip;
}

// Resposta 429 neutra (não diz se o e-mail existe nem qual limite estourou).
export const MENSAGEM_LIMITE = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

export function sendTooMany(res, retryAfterSec, message = MENSAGEM_LIMITE) {
  if (retryAfterSec) res.set('Retry-After', String(retryAfterSec));
  return res.status(429).json({ error: message });
}

// Middleware: limita pela chave devolvida por keyFn(req). Chave nula = sem limite.
export function rateLimitMiddleware(limiter, keyFn, { message, onLimit } = {}) {
  return (req, res, next) => {
    let key = null;
    try { key = keyFn(req); } catch { key = null; }
    const r = limiter.hit(key);
    if (r.allowed) return next();
    if (onLimit) { try { onLimit(req, limiter); } catch { /* só log */ } }
    return sendTooMany(res, r.retryAfterSec, message);
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
