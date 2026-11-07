// Vencimento da assinatura da clínica (regra do dono, 07/11/2026):
// - venceu → 5 dias de carência com aviso em todas as telas;
// - passou a carência → acesso bloqueado (dados guardados; login e "Minha assinatura" continuam).
// Suspensa ou cancelada pelo super-admin → bloqueada na hora.
// Data de vencimento: fim do teste (status trial) ou fim do período pago (active / past_due).
// Sem data → sem vencimento (ex.: clínica ativa cadastrada à mão sem período).

export const CARENCIA_VENCIMENTO_DIAS = 5;
const DIA_MS = 86_400_000;

function data(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @returns {{ situacao: 'ok'|'carencia'|'bloqueado', status: string, vence_em: string|null,
 *            bloqueio_em: string|null, dias_para_bloqueio: number|null, motivo: string|null }}
 */
export function situacaoAssinatura(tenant, agora = new Date()) {
  const status = tenant?.status || 'trial';
  if (status === 'suspended' || status === 'canceled') {
    return { situacao: 'bloqueado', status, vence_em: null, bloqueio_em: null, dias_para_bloqueio: 0, motivo: status === 'canceled' ? 'cancelada' : 'suspensa' };
  }
  const vence = status === 'trial' ? data(tenant?.trial_ends_at) : data(tenant?.current_period_end);
  if (!vence || agora.getTime() <= vence.getTime()) {
    return { situacao: 'ok', status, vence_em: vence ? vence.toISOString() : null, bloqueio_em: null, dias_para_bloqueio: null, motivo: null };
  }
  const bloqueio = new Date(vence.getTime() + CARENCIA_VENCIMENTO_DIAS * DIA_MS);
  const motivo = status === 'trial' ? 'teste_vencido' : 'pagamento_vencido';
  if (agora.getTime() <= bloqueio.getTime()) {
    return {
      situacao: 'carencia', status, vence_em: vence.toISOString(), bloqueio_em: bloqueio.toISOString(),
      dias_para_bloqueio: Math.max(1, Math.ceil((bloqueio.getTime() - agora.getTime()) / DIA_MS)), motivo,
    };
  }
  return { situacao: 'bloqueado', status, vence_em: vence.toISOString(), bloqueio_em: bloqueio.toISOString(), dias_para_bloqueio: 0, motivo };
}

// Mesma regra em SQL (para filtrar jobs em lote). `t` = alias da tabela tenants.
export function sqlTenantBloqueado(t = 't') {
  const carencia = `INTERVAL '${CARENCIA_VENCIMENTO_DIAS} days'`;
  return `(${t}.status IN ('suspended', 'canceled')
    OR (${t}.status = 'trial' AND ${t}.trial_ends_at IS NOT NULL AND ${t}.trial_ends_at + ${carencia} < NOW())
    OR (${t}.status IN ('active', 'past_due') AND ${t}.current_period_end IS NOT NULL AND ${t}.current_period_end + ${carencia} < NOW()))`;
}

// Rotas que continuam abertas com a clínica bloqueada (o resto responde 402).
const LIBERADAS_NO_BLOQUEIO = [
  /^\/api\/auth\/(login|me|logout|change-password|forgot-password|profile|avatar)\/?$/,
  /^\/api\/my-tenant\/?$/,
  /^\/api\/plans\/?$/,
  /^\/api\/(health|version)\/?$/,
  /^\/api\/push\/(vapid-key|unsubscribe)\/?$/,
  /^\/api\/super-admin(\/|$)/,
];
export function rotaLiberadaNoBloqueio(caminho) {
  const p = String(caminho || '').split('?')[0];
  return LIBERADAS_NO_BLOQUEIO.some((re) => re.test(p));
}

export const ERRO_ASSINATURA_BLOQUEADA = 'ASSINATURA_BLOQUEADA';
