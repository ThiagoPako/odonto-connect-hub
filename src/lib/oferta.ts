import { useEffect, useState } from "react";
import { LEGAL_INFO } from "@/lib/legal";
import { saasApi, type PublicPlan as Plan } from "@/lib/saasApi";

/**
 * Dados da oferta mostrados nas páginas públicas (landing e cadastro).
 * Toda informação de venda vem daqui, para não haver dois valores diferentes (CDC art. 31).
 *
 * Prazo do teste grátis: vem de `plans.trial_days` pela API (`useTesteGratisDias`). O número
 * abaixo é só o fallback (o padrão do banco); para mudar o prazo, mude `trial_days` dos planos.
 */
export const TESTE_GRATIS_DIAS = 14;

export const TESTE_GRATIS_TEXTO = `${TESTE_GRATIS_DIAS} dias grátis`;

export const textoTesteGratis = (dias: number) => `${dias} ${dias === 1 ? "dia grátis" : "dias grátis"}`;

/**
 * Fonte única de plano e prazo de teste: `GET /api/plans` (público, só planos ativos, tabela
 * `plans`). As constantes acima ficam só como fallback enquanto a API não responde ou falha
 * (página pública não pode quebrar). Preço NÃO é exibido na landing (decisão jurídica).
 */
let planosCache: Promise<Plan[] | null> | null = null;

function carregarPlanos(): Promise<Plan[] | null> {
  if (!planosCache) {
    planosCache = saasApi.listPlans().then(({ data, error }) => {
      if (error || !data?.data) { planosCache = null; return null; }
      return data.data;
    });
  }
  return planosCache;
}

/** Dias de teste do plano `slug` (ou do primeiro plano ativo); fallback `TESTE_GRATIS_DIAS`. */
export function diasTesteDe(planos: Plan[] | null, slug?: string): number {
  if (!planos?.length) return TESTE_GRATIS_DIAS;
  const plano = (slug && planos.find((p) => p.slug === slug)) || planos[0];
  const dias = Number(plano?.trial_days);
  return Number.isFinite(dias) && dias > 0 ? dias : TESTE_GRATIS_DIAS;
}

export function usePlanosPublicos(): { planos: Plan[] | null; carregado: boolean } {
  const [planos, setPlanos] = useState<Plan[] | null>(null);
  const [carregado, setCarregado] = useState(false);
  useEffect(() => {
    let vivo = true;
    void carregarPlanos().then((lista) => { if (vivo) { setPlanos(lista); setCarregado(true); } });
    return () => { vivo = false; };
  }, []);
  return { planos, carregado };
}

/** Prazo do teste grátis vindo da API (fallback 14 enquanto carrega ou se falhar). */
export function useTesteGratisDias(slug?: string): number {
  const { planos } = usePlanosPublicos();
  return diasTesteDe(planos, slug);
}

/**
 * ⚠️ PENDENTE: WhatsApp do consultor. O número que estava na landing (wa.me/5511999990001) é
 * provisório e pode ser de um terceiro (parecer da Helena, item 13). Enquanto for `null`, os botões
 * de WhatsApp ficam escondidos e a landing usa o e-mail de contato.
 */
export const WHATSAPP_CONSULTOR: string | null = null;

export const EMAIL_CONTATO = LEGAL_INFO.emailContato;
