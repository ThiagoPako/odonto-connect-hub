// Assinatura vencida — escada de docs/produto/decisoes-saas.md §3 (decisão do dono, 07/11/2026):
//
//   D+1 a D+7   carencia         tudo funciona; faixa amarela só para admins (CDC 42)
//   D+8 a D+29  somente_leitura  ver e exportar; responder pacientes no chat; remarcar/cancelar
//                                consulta; lembretes seguem. Não: criar/editar, campanha, IA
//   D+30        bloqueado        login, "Minha assinatura", exportação e prontuário em leitura
//   D+60        cancelado        igual ao bloqueio; 90 dias para exportar
//   cancelado + 91 dias          exclusão (NÃO automática aqui: nada é apagado por este módulo)
//
// Teste encerrado sem contratar: entra direto no somente leitura por 30 dias e segue a escada.
// Suspensa pelo super-admin → bloqueado na hora; cancelada → cancelado na hora.
// Vencimento: fim do teste (status trial) ou do período pago (active / past_due). Sem data → em dia.

const DIA_MS = 86_400_000;
export const ESCADA_PAGA_DIAS = { somente_leitura: 7, bloqueado: 29, cancelado: 59 }; // dias após vencer
export const ESCADA_TESTE_DIAS = { somente_leitura: 0, bloqueado: 30, cancelado: 60 };
export const DIAS_PARA_EXPORTAR_APOS_CANCELAR = 90;
export const ETAPAS = ['ok', 'carencia', 'somente_leitura', 'bloqueado', 'cancelado'];
const ORDEM = Object.fromEntries(ETAPAS.map((e, i) => [e, i]));
export const etapaAoMenos = (sit, etapa) => (ORDEM[sit?.situacao] ?? 0) >= ORDEM[etapa];

function data(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const iso = (d) => (d ? d.toISOString() : null);
const mais = (d, dias) => new Date(d.getTime() + dias * DIA_MS);

/**
 * situacao: ok | carencia | somente_leitura | bloqueado | cancelado
 * Datas de cada degrau (somente_leitura_em, bloqueio_em, cancelamento_em, exclusao_em) e a
 * próxima mudança (proxima_etapa, proxima_etapa_em, dias_para_proxima).
 */
export function situacaoAssinatura(tenant, agora = new Date()) {
  const status = tenant?.status || 'trial';
  const base = { status, vence_em: null, somente_leitura_em: null, bloqueio_em: null, cancelamento_em: null, exclusao_em: null, proxima_etapa: null, proxima_etapa_em: null, dias_para_proxima: null };
  if (status === 'suspended') return { ...base, situacao: 'bloqueado', motivo: 'suspensa' };
  if (status === 'canceled') return { ...base, situacao: 'cancelado', motivo: 'cancelada' };

  const teste = status === 'trial';
  const vence = teste ? data(tenant?.trial_ends_at) : data(tenant?.current_period_end);
  if (!vence) return { ...base, situacao: 'ok', motivo: null };
  const esc = teste ? ESCADA_TESTE_DIAS : ESCADA_PAGA_DIAS;
  const degraus = {
    somente_leitura: mais(vence, esc.somente_leitura),
    bloqueado: mais(vence, esc.bloqueado),
    cancelado: mais(vence, esc.cancelado),
  };
  const exclusao = mais(degraus.cancelado, DIAS_PARA_EXPORTAR_APOS_CANCELAR + 1);
  const t = agora.getTime();
  let situacao = 'ok';
  if (t > vence.getTime()) situacao = 'carencia';
  if (t > degraus.somente_leitura.getTime()) situacao = 'somente_leitura';
  if (t > degraus.bloqueado.getTime()) situacao = 'bloqueado';
  if (t > degraus.cancelado.getTime()) situacao = 'cancelado';
  // Teste: não há carência (vence → somente leitura direto)
  if (teste && situacao === 'carencia') situacao = 'somente_leitura';

  const proxima = { ok: teste ? 'somente_leitura' : 'carencia', carencia: 'somente_leitura', somente_leitura: 'bloqueado', bloqueado: 'cancelado', cancelado: null }[situacao];
  const proximaEm = proxima === 'carencia' ? vence : proxima ? degraus[proxima] : null;
  return {
    ...base,
    situacao,
    motivo: teste ? 'teste_vencido' : 'pagamento_vencido',
    vence_em: iso(vence),
    somente_leitura_em: iso(degraus.somente_leitura),
    bloqueio_em: iso(degraus.bloqueado),
    cancelamento_em: iso(degraus.cancelado),
    exclusao_em: iso(exclusao),
    proxima_etapa: proxima,
    proxima_etapa_em: iso(proximaEm),
    dias_para_proxima: proximaEm && situacao !== 'ok' ? Math.max(1, Math.ceil((proximaEm.getTime() - t) / DIA_MS)) : null,
  };
}

// Mesma regra em SQL, para filtrar jobs em lote: marketing para a partir do somente leitura.
// `t` = alias da tabela tenants.
export function sqlTenantSemMarketing(t = 't') {
  return `(${t}.status IN ('suspended', 'canceled')
    OR (${t}.status = 'trial' AND ${t}.trial_ends_at IS NOT NULL AND ${t}.trial_ends_at + INTERVAL '${ESCADA_TESTE_DIAS.somente_leitura} days' < NOW())
    OR (${t}.status IN ('active', 'past_due') AND ${t}.current_period_end IS NOT NULL AND ${t}.current_period_end + INTERVAL '${ESCADA_PAGA_DIAS.somente_leitura} days' < NOW()))`;
}

// ─── O que cada etapa permite ────────────────────────────────────────────────
// Sempre abertas (inclusive bloqueado/cancelado): entrar, perfil, pagar, exportar.
const SEMPRE = [
  [null, /^\/api\/auth\/(login|me|logout|change-password|forgot-password|profile|avatar)\/?$/],
  ['GET', /^\/api\/my-tenant\/?$/],
  ['GET', /^\/api\/plans\/?$/],
  [null, /^\/api\/(health|version)\/?$/],
  [null, /^\/api\/push\/(vapid-key|unsubscribe)\/?$/],
  [null, /^\/api\/user\/preferences\/?$/],
  [null, /^\/api\/super-admin(\/|$)/],
  // Exportação (LGPD art. 18; guarda do prontuário, Lei 13.787/2018): só os dois caminhos
  ['GET', /^\/api\/exportacao(\/[a-z_]+\.csv)?\/?$/],
  // Direitos do titular: revogar consentimento / opt-out
  ['POST', /^\/api\/consentimentos\/[^/]+\/revogar\/?$/],
  ['POST', /^\/api\/whatsapp\/opt-out\/revogar\/?$/],
];
// Bloqueado/cancelado: prontuário em leitura (buscar, ver, imprimir).
const PRONTUARIO_LEITURA = [
  /^\/api\/pacientes(\/|$)/,
  /^\/api\/prontuarios(\/|$)/,
  /^\/api\/tratamentos(\/|$)/,
  /^\/api\/exames(\/|$)/,
  /^\/api\/exame-tipos\/?$/,
  /^\/api\/consultations(\/|$)/,
  /^\/api\/ai\/reports(\/|$)/,
  /^\/api\/dentistas\/?$/,
  /^\/api\/procedimentos-catalogo\/?$/,
  /^\/api\/generic\/(prontuarios|anamneses|odontogramas|tratamentos|exames)\/?$/,
];
// Somente leitura: além de toda leitura (GET), responder pacientes e remarcar/cancelar consulta.
const ESCRITA_NO_SOMENTE_LEITURA = [
  [null, /^\/api\/whatsapp\/(send-text|send-media|send-media-upload|send-contact|send-location|send-reaction|send-sticker|send-presence|subscribe-presence|mark-read|archive-chat|delete-message|send-list|send-poll|sync-chat\/[^/]+|profile-picture|sync-profile-pictures)\/?$/],
  // Manter o número conectado para conseguir responder (QR, reiniciar, trocar principal)
  [null, /^\/api\/whatsapp\/(instances|instances\/[^/]+|logout\/[^/]+|restart\/[^/]+|switch-primary|register-webhook\/[^/]+|channels\/[^/]+(\/(disconnect|primary))?|openwa\/channels)\/?$/],
  [null, /^\/api\/messages(\/[^/]+)*\/?$/],
  [null, /^\/api\/sessions\/(assign|close|first-response|start)\/?$/],
  ['POST', /^\/api\/transfers\/?$/],
  ['POST', /^\/api\/media\/upload\/?$/],
  ['POST', /^\/api\/push\/subscribe\/?$/],
  // Remarcar ou cancelar consulta a pedido do paciente (não cria agendamento novo)
  ['PUT', /^\/api\/agenda\/[^/]+\/?$/],
  ['POST', /^\/api\/agenda\/[^/]+\/liberar-horario\/?$/],
];
const LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);
const casa = (lista, metodo, caminho) => lista.some(([m, re]) => (!m || m === metodo) && re.test(caminho));

/** true se a requisição é permitida na etapa da clínica. */
export function permitidoNaEtapa(situacao, metodo, caminho) {
  const m = String(metodo || 'GET').toUpperCase();
  const p = String(caminho || '').split('?')[0];
  if (situacao === 'ok' || situacao === 'carencia' || !situacao) return true;
  if (casa(SEMPRE, m, p)) return true;
  if (situacao === 'somente_leitura') {
    // IA (mesmo por GET) fica de fora no somente leitura
    if (LEITURA.has(m)) return !/^\/api\/ai\/(meta-ads\/insight)\/?$/.test(p);
    return casa(ESCRITA_NO_SOMENTE_LEITURA, m, p);
  }
  // bloqueado / cancelado
  return LEITURA.has(m) && PRONTUARIO_LEITURA.some((re) => re.test(p));
}

// Rotas abertas em qualquer etapa (sem método = qualquer).
export function rotaLiberadaNoBloqueio(caminho, metodo = 'GET') {
  return casa(SEMPRE, String(metodo).toUpperCase(), String(caminho || '').split('?')[0]);
}

export const ERRO_ASSINATURA_BLOQUEADA = 'ASSINATURA_BLOQUEADA';
export const ERRO_ASSINATURA_SOMENTE_LEITURA = 'ASSINATURA_SOMENTE_LEITURA';

// Tabelas da exportação da clínica, por grupo. Só tabelas com tenant_id (conferido em runtime).
export const EXPORTACAO_GRUPOS = [
  { grupo: 'Pacientes', tabelas: [['pacientes', 'Pacientes'], ['anamneses', 'Anamneses'], ['odontogramas', 'Odontogramas']] },
  { grupo: 'Prontuário', tabelas: [['prontuarios', 'Prontuários'], ['tratamentos', 'Tratamentos'], ['clinical_reports', 'Relatórios clínicos'], ['consultations', 'Consultas gravadas'], ['exames', 'Exames']] },
  { grupo: 'Agenda', tabelas: [['agendamentos', 'Agendamentos']] },
  { grupo: 'Financeiro', tabelas: [['orcamentos', 'Orçamentos'], ['comissoes', 'Comissões'], ['fin_movements', 'Movimentações'], ['fin_bills', 'Contas a pagar'], ['fin_bank_accounts', 'Contas bancárias'], ['fin_employees', 'Funcionários'], ['fin_payrolls', 'Folha de pagamento']] },
  { grupo: 'Cadastros', tabelas: [['dentistas', 'Dentistas'], ['contatos', 'Contatos'], ['crm_leads', 'Leads do CRM']] },
];
export const EXPORTACAO_TABELAS = new Map(EXPORTACAO_GRUPOS.flatMap((g) => g.tabelas.map(([t, nome]) => [t, { nome, grupo: g.grupo }])));

// CSV (vírgula, UTF-8 com BOM para o Excel abrir acentos). Texto que começa com = + - @ ganha '
// na frente (injeção de fórmula); número (inclusive negativo) sai como número. Objetos viram JSON.
export function celulaCsv(v) {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  s = s.replace(/"/g, '""').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s}"`;
}
export const linhaCsv = (colunas, r) => colunas.map((c) => celulaCsv(r[c])).join(',');
export function linhasParaCsv(colunas, linhas) {
  return '﻿' + [colunas.map(celulaCsv).join(','), ...linhas.map((r) => linhaCsv(colunas, r))].join('\n') + '\n';
}
