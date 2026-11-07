// Fonte "Google Maps (scraper)": conversa com o engine do google-maps-scraper-kit
// (github.com/Mahanaicoach/google-maps-scraper-kit, commit fixado na doc de operação) pela API HTTP dele.
// O engine roda num contêiner Docker separado, publicado só em 127.0.0.1 (LEADS_SCRAPER_URL).
//
// Decisão do dono (07/11/2026), avisado do risco: raspar o Google Maps contraria os Termos do Google
// e telefone/e-mail podem ser dado pessoal. Travas deste módulo:
//   - NUNCA envia proxies nem rotação de IP: se o Google bloquear, o job falha com aviso e a sugestão
//     de usar a Places API oficial;
//   - sem redes sociais e sem verify_emails; e-mail dos sites só se pedido, sempre marcado como pessoal;
//   - depth e tempo com teto baixo, um job por vez (o engine também só roda um) e limite diário.
//
// API do engine (engine/serve.py, versão 2.2.0):
//   POST   /api/v1/jobs                       {name, keywords[], lang, country, depth, max_time, email, socials, verify_emails} → 201 {id}
//   GET    /api/v1/jobs/{id}                  → {ID, Name, Date, Status: pending|working|ok|failed, Error, Progress{...}}
//   GET    /api/v1/jobs/{id}/download?format=json → [linhas, todos os valores texto]
//   DELETE /api/v1/jobs/{id}
//   Cabeçalho X-API-Key quando o engine tem SCRAPER_API_KEY; Host tem de ser localhost/127.0.0.1.
import { candidatoDoCsv, desfazerGuardaFormula, normalizarTexto } from './leads-fontes.mjs';

export const PALAVRAS_SCRAPER = Object.freeze({
  dentista: 'dentista',
  clinica: 'clínica odontológica',
  radiologia: 'radiologia odontológica',
});

export function palavrasChave(tipos, cidade, uf) {
  return tipos.filter(t => PALAVRAS_SCRAPER[t]).map(t => `${PALAVRAS_SCRAPER[t]} em ${cidade} ${uf}`);
}

// Página de "tráfego incomum" do Google = IP limitado. Mensagem do engine: jobs.py "unusual-traffic page".
export function erroEhBloqueio(texto) {
  return /unusual[- ]traffic|rate-limited|captcha|tr[aá]fego incomum/i.test(String(texto || ''));
}

export const AVISO_BLOQUEIO = 'O Google bloqueou temporariamente o servidor (página de "tráfego incomum"). '
  + 'Não usamos proxy nem troca de IP para contornar. Aguarde algumas horas antes de outra coleta, '
  + 'ou use a Places API oficial (busca "Buscar no Google", com chave própria).';

// Linha do engine (colunas do kit 1.x + categories) → candidato a lead.
export function candidatoDoScraper(row) {
  const limpa = Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [normalizarTexto(k).replace(/\s+/g, '_'), desfazerGuardaFormula(typeof v === 'string' ? v.trim() : v == null ? '' : String(v))]));
  // O engine não pede redes sociais; se a linha trouxer, não guardamos.
  for (const r of ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'x', 'twitter']) delete limpa[r];
  const c = candidatoDoCsv(limpa);
  c.tipos = String(limpa.categories || '').split(/\s*[,;|]\s*/).filter(Boolean);
  c.fechado = /permanent|definitiv/i.test(String(limpa.status || ''));
  // Todo e-mail raspado de site é tratado como dado pessoal (pode ser do dentista pessoa física).
  if (c.email_comercial) c.email_pessoal = true;
  c.redes = {};
  return c;
}

export function criarClienteScraper({ baseUrl, apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const configurado = !!base;

  async function chamar(caminho, { method = 'GET', body } = {}) {
    if (!configurado) { const e = new Error('Scraper não configurado: falta LEADS_SCRAPER_URL no .env do servidor'); e.status = 503; throw e; }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetchImpl(`${base}${caminho}`, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(apiKey ? { 'X-API-Key': apiKey } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      const e = new Error('Engine do scraper fora do ar ou sem resposta'); e.status = 502; e.cause = err; throw e;
    } finally { clearTimeout(t); }
    const texto = await resp.text().catch(() => '');
    let corpo = null;
    try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = null; }
    if (!resp.ok) {
      const e = new Error(`Engine do scraper recusou (${resp.status}): ${corpo?.message || texto.slice(0, 200) || 'sem detalhe'}`);
      e.status = resp.status === 404 ? 404 : 502;
      e.http = resp.status;
      throw e;
    }
    return corpo;
  }

  return {
    configurado,
    // Sem proxies, sem redes sociais, sem verify_emails: isso é fixo, não vem da tela.
    async criarJob({ nome, palavras, depth, maxTempo, coletarEmails }) {
      const r = await chamar('/api/v1/jobs', {
        method: 'POST',
        body: {
          name: nome, keywords: palavras, lang: 'pt', country: 'br',
          depth, max_time: maxTempo, email: !!coletarEmails, socials: false, verify_emails: false,
          fast_mode: false, reviews_max: 0, proxies: [],
        },
      });
      if (!r?.id) { const e = new Error('Engine não devolveu o id do job'); e.status = 502; throw e; }
      return r.id;
    },
    async statusJob(id) { return chamar(`/api/v1/jobs/${encodeURIComponent(id)}`); },
    async baixarJob(id) {
      const linhas = await chamar(`/api/v1/jobs/${encodeURIComponent(id)}/download?format=json`);
      return Array.isArray(linhas) ? linhas : [];
    },
    async apagarJob(id) {
      try { await chamar(`/api/v1/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
      catch (e) { if (e.http !== 404) throw e; }
    },
  };
}
