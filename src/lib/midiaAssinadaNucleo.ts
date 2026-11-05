/**
 * Núcleo sem dependências (testável com node --test): detecção de link assinado de mídia,
 * expiração e renovação em lotes de até 20 caminhos. Usado por midiaAssinada.ts.
 */
export const MIDIA_LOTE_MAX = 20;
/** Renova antes de vencer: 2 min de folga. */
export const MIDIA_MARGEM_S = 120;
const ESPERA_LOTE_MS = 30;

type RenovarLinks = (paths: string[]) => Promise<Record<string, string>>;
let renovarLinks: RenovarLinks = async () => ({});
let resolverUrl: (url: string) => string = (u) => u;

/** Liga o núcleo ao cliente da API (feito em midiaAssinada.ts; nos testes, um falso). */
export function configurarRenovacaoDeMidia(fn: RenovarLinks, resolver?: (url: string) => string) {
  renovarLinks = fn;
  if (resolver) resolverUrl = resolver;
}

const MEDIA_PATH_RE = /\/uploads\/media\/\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,10}/i;

/** É uma mídia nossa (/uploads/media/AAAA-MM/uuid.ext), com ou sem assinatura? */
export function ehMidiaNossa(url?: string | null): url is string {
  return !!url && MEDIA_PATH_RE.test(url);
}

/** "/uploads/media/AAAA-MM/uuid.ext" sem origem nem query (chave do pedido e do cache). */
export function caminhoDaMidia(url: string): string {
  const m = MEDIA_PATH_RE.exec(url);
  return m ? m[0] : url;
}

/** Segundos (epoch) do `exp` do link assinado, ou null se não houver. */
export function expiracaoDoLink(url?: string | null): number | null {
  if (!url) return null;
  try {
    const exp = Number(new URL(url, "http://local").searchParams.get("exp"));
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch {
    return null;
  }
}

export function linkPertoDeVencer(url?: string | null, margemS = MIDIA_MARGEM_S): boolean {
  const exp = expiracaoDoLink(url);
  return exp !== null && exp - Date.now() / 1000 < margemS;
}

type Pendente = { caminho: string; resolver: (url: string | null) => void };
let fila: Pendente[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** Renovação em curso ou concluída por caminho (evita pedir o mesmo link várias vezes). */
const emCurso = new Map<string, Promise<string | null>>();

function enviarFila() {
  timer = null;
  const lote = fila;
  fila = [];
  const porCaminho = new Map<string, Pendente["resolver"][]>();
  for (const p of lote) porCaminho.set(p.caminho, [...(porCaminho.get(p.caminho) ?? []), p.resolver]);
  const caminhos = [...porCaminho.keys()];
  for (let i = 0; i < caminhos.length; i += MIDIA_LOTE_MAX) {
    const parte = caminhos.slice(i, i + MIDIA_LOTE_MAX);
    renovarLinks(parte)
      .then((links) => {
        for (const c of parte) {
          const novo = links[c] ? resolverUrl(links[c]) : null;
          porCaminho.get(c)?.forEach((r) => r(novo));
        }
      })
      .catch(() => parte.forEach((c) => porCaminho.get(c)?.forEach((r) => r(null))));
  }
}

/**
 * Link novo para a mídia (null se não for nossa, não for da clínica ou o servidor falhar).
 * Pedidos feitos no mesmo instante saem juntos, em lotes de até 20.
 */
export function renovarLinkMidia(url: string): Promise<string | null> {
  if (!ehMidiaNossa(url)) return Promise.resolve(null);
  const caminho = caminhoDaMidia(url);
  const existente = emCurso.get(caminho);
  if (existente) return existente;
  const promessa = new Promise<string | null>((resolver) => {
    fila.push({ caminho, resolver });
    if (!timer) timer = setTimeout(enviarFila, ESPERA_LOTE_MS);
  }).then((novo) => {
    // Falha não fica guardada; sucesso fica até chegar perto de vencer.
    if (!novo) emCurso.delete(caminho);
    else {
      const exp = expiracaoDoLink(novo);
      const vence = exp ? exp * 1000 - MIDIA_MARGEM_S * 1000 - Date.now() : 0;
      const t = setTimeout(() => { if (emCurso.get(caminho) === promessa) emCurso.delete(caminho); }, Math.max(0, vence));
      (t as unknown as { unref?: () => void }).unref?.();
    }
    return novo;
  });
  emCurso.set(caminho, promessa);
  return promessa;
}

/** Só para testes. */
export function limparCacheMidiaParaTestes() {
  emCurso.clear();
  fila = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

