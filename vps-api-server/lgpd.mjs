// Direitos do titular (LGPD art. 18) e registro de acesso ao prontuário.
// Parecer jurídico: docs/juridico/parecer-pr59-retencao-lgpd.md (Helena). Plano: docs/banco/retencao-lgpd.md.
//
// Rotas (só admin da clínica, sempre no tenant do usuário; super-admin da plataforma não executa):
//   POST /api/lgpd/solicitacoes
//        { paciente_id, tipo, origem?, motivo?, identidade: { conferida_por, documento, representante?: { nome, vinculo } },
//          ao_fim_do_prazo?: 'eliminar'|'devolver', eliminar_conversas?: boolean }
//        tipo = exportar | excluir | anonimizar. Registra quem conferiu a identidade (LGPD 18 § 3º; menor:
//        vínculo do responsável, art. 14) e devolve a prévia: registros por grupo, prazos de guarda,
//        "possíveis vínculos" (achados só pelo telefone, para o admin marcar um a um) e o código de
//        uso único (15 min).
//   POST /api/lgpd/solicitacoes/:id/confirmar   { codigo, frase, possiveis_confirmados?: [item...] }
//        Segunda confirmação: executa. Devolve o resumo para o admin e o texto para o titular.
//   POST /api/lgpd/solicitacoes/:id/cancelar · GET /api/lgpd/solicitacoes · GET /api/lgpd/pacientes/:id/acessos
//
// Guarda (decisões do parecer):
//   prontuário: o maior entre 20 anos do último registro CLÍNICO e a data em que o paciente faz 21
//     anos (Lei 13.787 art. 6º, prazo mínimo; CC 3º e 198, I). Agenda só conta se realizada ou falta;
//     orçamento só se aprovado. O resto da agenda e os orçamentos não aprovados são "comercial" (5 anos, CDC 27);
//   financeiro: 5 anos a partir de 1º de janeiro do ano seguinte ao lançamento (CTN 173, I);
//   conversas de paciente com prontuário: retidas 5 anos por padrão (a clínica pode optar por
//     eliminar); de quem nunca teve prontuário: elimináveis;
//   relacionamento (lead, fila, contatos): eliminável.
// "anonimizar" só com todos os prazos vencidos e apaga também o texto clínico livre (art. 12; senão
// é pseudonimização). Nada de dado de saúde em log ou resumo.
import crypto from 'crypto';
import { novoColetor, avisoBackups } from './lgpd-arquivos.mjs';

export const TIPOS = ['exportar', 'excluir', 'anonimizar'];
const CODIGO_VALIDADE_MIN = 15;
const LIMITE_LINHAS_EXPORT = 10000;
export const ANOS_PRONTUARIO = 20;
export const IDADE_FIM_GUARDA_MENOR = 21;
export const ANOS_FISCAL = 5;
export const ANOS_COMERCIAL = 5;
export const ANOS_CONVERSA = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const AVISO_MOTIVO = 'Não descreva sintomas, diagnósticos ou tratamentos no motivo.';

// Grupos. Tabelas com parte clínica e parte comercial têm o filtro em PARCIAL.
export const CLINICO = [
  'prontuarios', 'anamneses', 'odontogramas', 'exames', 'tratamentos', 'tratamento_etapas',
  'procedimento_execucoes', 'assinaturas_eletronicas', 'consentimentos_pacientes', 'consultations', 'clinical_reports',
];
const PARCIAL = {
  agendamentos: `status IN ('realizado', 'finalizado', 'atendido', 'concluido', 'faltou') AND (data IS NULL OR data <= CURRENT_DATE)`,
  orcamentos: `status IN ('aprovado', 'em_tratamento', 'em_andamento', 'finalizado', 'concluido')`,
};
export const FISCAL = ['financeiro', 'comissoes', 'financeiro_receitas'];
export const CONVERSA = ['chat_read_status', 'satisfaction_ratings', 'transfer_logs', 'attendance_sessions', 'chat_messages'];
// Ordem = ordem de exclusão (filhas antes de crm_leads).
export const RELACIONAMENTO = [
  'kanban_movements', 'lead_tag_assignments', 'tag_assignments', 'automation_jobs', 'reactivation_sends',
  'clinicorp_conflicts', 'contatos', 'crm_leads',
];
// Coluna do paciente quando não se chama paciente_id.
const COLUNA_PACIENTE = { clinical_reports: 'patient_id' };
// Coluna de telefone por tabela (casamento por DDD + 8 últimos dígitos: só "possível vínculo").
const COLUNA_TELEFONE = {
  chat_messages: 'phone', automation_jobs: 'patient_phone', contatos: 'telefone',
  attendance_sessions: 'lead_phone', satisfaction_ratings: 'lead_phone', transfer_logs: 'lead_phone',
  reactivation_sends: 'phone',
};
// Data do registro por tabela (último registro clínico, última conversa, lançamento).
const COLUNA_DATA = { agendamentos: 'data', financeiro: 'data', chat_messages: 'timestamp', comissoes: 'data' };
// Únicas tabelas sem tenant_id aceitas, e só por lead_id de leads já filtrados pela clínica.
const SEM_TENANT_POR_LEAD = new Set(['tag_assignments']);
// Anonimização: identificadores do cadastro e texto clínico livre.
const PACIENTE_IDENTIFICADORES = ['cpf', 'telefone', 'email', 'endereco', 'data_nascimento', 'observacoes',
  'clinicorp_patient_id', 'rg', 'celular', 'foto_url', 'avatar_url', 'convenio'];
const TEXTO_LIVRE = {
  prontuarios: ['descricao', 'titulo', 'anexos'],
  anamneses: ['observacoes'],
  odontogramas: ['observacoes'],
  procedimento_execucoes: ['observacoes'],
  tratamentos: ['observacoes', 'plano'],
  exames: ['laudo_texto', 'observacoes', 'arquivo_url'],
  clinical_reports: ['transcription', 'report', 'queixa_principal', 'patient_name', 'audio_url'],
  consultations: ['notes', 'observacoes', 'transcription'],
  agendamentos: ['observacoes', 'paciente_nome'],
  orcamentos: ['observacoes', 'paciente_nome'],
};
// Assinatura manuscrita identifica a pessoa: sai na anonimização.
const APAGAR_NA_ANONIMIZACAO = ['assinaturas_eletronicas'];

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

// DDD + 8 últimos dígitos: casa 55 11 9xxxx-xxxx, 11 9xxxx-xxxx e 11 xxxx-xxxx.
export function chaveTelefone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  return d.slice(0, 2) + d.slice(-8);
}
function sqlChaveTelefone(col) {
  const d = `regexp_replace(COALESCE(${col}::text, ''), '\\D', '', 'g')`;
  const d2 = `(CASE WHEN length(${d}) IN (12, 13) AND left(${d}, 2) = '55' THEN substr(${d}, 3) ELSE ${d} END)`;
  return `(CASE WHEN length(${d2}) IN (10, 11) THEN left(${d2}, 2) || right(${d2}, 8) END)`;
}
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Colunas por tabela do schema real (o banco tem deriva: só usa o que existe).
let inventarioCache = null;
async function inventario(db) {
  if (inventarioCache && inventarioCache.ate > Date.now()) return inventarioCache.mapa;
  const { rows } = await db.query(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public'`);
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.table_name)) mapa.set(r.table_name, new Map());
    mapa.get(r.table_name).set(r.column_name, { nullable: r.is_nullable !== 'NO' });
  }
  inventarioCache = { mapa, ate: Date.now() + 10 * 60 * 1000 };
  return mapa;
}
export function limparCacheInventarioParaTestes() { inventarioCache = null; }

function classeDe(tabela) {
  if (CLINICO.includes(tabela)) return 'clinico';
  if (FISCAL.includes(tabela) || tabela.startsWith('fin_')) return 'fiscal';
  if (CONVERSA.includes(tabela)) return 'conversa';
  if (RELACIONAMENTO.includes(tabela)) return 'relacionamento';
  return 'sem_regra';
}

// Onde estão os dados do titular. Cada alvo: { tabela, classe, vinculo, item, where, params, cols }.
//   vinculo 'paciente': ligado pelo paciente_id (ou por lead com paciente_id = titular);
//   vinculo 'possivel': achado só pelo telefone (lead por telefone ou linha por telefone sem lead
//     conhecido). Só entra na exclusão/exportação se o admin marcar o item.
async function localizar(db, tenantId, paciente) {
  const inv = await inventario(db);
  const chave = chaveTelefone(paciente.telefone);
  const lead = inv.get('crm_leads');
  let leadsLigados = [];
  let leadsPossiveis = [];
  if (lead?.has('tenant_id')) {
    if (lead.has('paciente_id')) {
      const { rows } = await db.query(
        'SELECT id::text AS id FROM crm_leads WHERE tenant_id = $1 AND paciente_id::text = $2', [tenantId, paciente.id]);
      leadsLigados = rows.map(r => r.id);
    }
    if (chave && lead.has('telefone')) {
      const { rows } = await db.query(
        `SELECT id::text AS id, nome, created_at FROM crm_leads
          WHERE tenant_id = $1 AND ${sqlChaveTelefone('telefone')} = $2 AND NOT (id::text = ANY($3::text[]))`,
        [tenantId, chave, leadsLigados]);
      leadsPossiveis = rows;
    }
  }
  const todosLeads = [...leadsLigados, ...leadsPossiveis.map(l => l.id)];
  const alvos = [];
  const semTenant = [];
  const add = (a) => alvos.push(a);
  for (const [tabela, cols] of inv) {
    if (['pacientes', 'lgpd_solicitacoes', 'acessos_prontuario'].includes(tabela)) continue;
    const colPac = COLUNA_PACIENTE[tabela] || 'paciente_id';
    const comTenant = cols.has('tenant_id');
    if (!comTenant) {
      if (cols.has(colPac) && !SEM_TENANT_POR_LEAD.has(tabela)) semTenant.push(tabela);
      if (!SEM_TENANT_POR_LEAD.has(tabela)) continue;
    }
    const classe = classeDe(tabela);
    const base = comTenant ? ['tenant_id = $1'] : [];
    const p0 = comTenant ? [tenantId] : [];
    // 1. pelo paciente
    if (comTenant && cols.has(colPac)) {
      const params = [...p0, paciente.id];
      const w = [...base, `${q(colPac)}::text = $${params.length}`];
      if (PARCIAL[tabela]) {
        add({ tabela, classe: 'clinico', vinculo: 'paciente', where: [...w, `(${PARCIAL[tabela]})`].join(' AND '), params, cols });
        add({ tabela, classe: 'comercial', vinculo: 'paciente', where: [...w, `NOT COALESCE((${PARCIAL[tabela]}), false)`].join(' AND '), params, cols });
      } else {
        add({ tabela, classe, vinculo: 'paciente', where: w.join(' AND '), params, cols });
      }
    }
    // 2. pelos leads ligados ao paciente (crm_leads já veio pelo paciente_id no passo 1)
    if (leadsLigados.length && cols.has('lead_id') && tabela !== 'crm_leads') {
      const params = [...p0, leadsLigados];
      const w = [...base, `lead_id::text = ANY($${params.length}::text[])`];
      if (comTenant && cols.has(colPac)) { params.push(paciente.id); w.push(`(${q(colPac)} IS NULL OR ${q(colPac)}::text <> $${params.length})`); }
      add({ tabela, classe, vinculo: 'paciente', where: w.join(' AND '), params, cols });
    }
    // 3. possíveis: cada lead achado pelo telefone é um item
    for (const l of leadsPossiveis) {
      if (!(cols.has('lead_id') || tabela === 'crm_leads')) continue;
      const params = [...p0, l.id];
      const col = tabela === 'crm_leads' ? 'id' : 'lead_id';
      add({ tabela, classe, vinculo: 'possivel', item: `lead:${l.id}`, where: [...base, `${col}::text = $${params.length}`].join(' AND '), params, cols });
    }
    // 4. possível: linhas pelo telefone que não são de nenhum lead encontrado
    const colTel = COLUNA_TELEFONE[tabela];
    if (comTenant && chave && colTel && cols.has(colTel)) {
      const params = [...p0, chave];
      const w = [...base, `${sqlChaveTelefone(q(colTel))} = $${params.length}`];
      if (cols.has('lead_id') && todosLeads.length) { params.push(todosLeads); w.push(`(lead_id IS NULL OR NOT (lead_id::text = ANY($${params.length}::text[])))`); }
      if (cols.has(colPac)) { params.push(paciente.id); w.push(`(${q(colPac)} IS NULL OR ${q(colPac)}::text <> $${params.length})`); }
      add({ tabela, classe, vinculo: 'possivel', item: 'telefone', where: w.join(' AND '), params, cols });
    }
  }
  return { alvos, leadsPossiveis, semTenant };
}

function addAnos(data, anos) {
  if (!data) return null;
  const d = new Date(data);
  d.setFullYear(d.getFullYear() + anos);
  return d;
}
const maior = (...ds) => ds.filter(Boolean).reduce((a, b) => (b > a ? b : a), null);
const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);

// Prévia: contagens, prazos de guarda e itens de possível vínculo (sem conteúdo).
async function previa(db, tenantId, paciente, { eliminarConversas = false } = {}) {
  const { alvos, leadsPossiveis, semTenant } = await localizar(db, tenantId, paciente);
  const grupos = {};
  const ultimo = {};
  const possiveis = new Map();
  for (const a of alvos) {
    const colData = COLUNA_DATA[a.tabela] && a.cols.has(COLUNA_DATA[a.tabela]) ? COLUNA_DATA[a.tabela]
      : a.cols.has('created_at') ? 'created_at' : a.cols.has('updated_at') ? 'updated_at' : null;
    const ult = colData ? `max(${q(colData)}::timestamptz)` : 'NULL::timestamptz';
    const { rows } = await db.query(`SELECT count(*)::int AS n, ${ult} AS ultimo FROM ${q(a.tabela)} WHERE ${a.where}`, a.params);
    const n = rows[0]?.n || 0;
    a.registros = n;
    if (!n) continue;
    if (a.vinculo === 'possivel') {
      const it = possiveis.get(a.item) || { item: a.item, tabelas: {} };
      it.tabelas[a.tabela] = (it.tabelas[a.tabela] || 0) + n;
      possiveis.set(a.item, it);
      continue;
    }
    grupos[a.classe] = grupos[a.classe] || {};
    grupos[a.classe][a.tabela] = (grupos[a.classe][a.tabela] || 0) + n;
    const u = rows[0].ultimo ? new Date(rows[0].ultimo) : new Date(); // sem data: conta como agora
    if (!ultimo[a.classe] || u > ultimo[a.classe]) ultimo[a.classe] = u;
  }
  for (const l of leadsPossiveis) {
    const it = possiveis.get(`lead:${l.id}`);
    if (it) { it.descricao = `Lead "${l.nome || 'sem nome'}" com o mesmo telefone`; it.criado_em = l.created_at; }
  }
  if (possiveis.has('telefone')) possiveis.get('telefone').descricao = 'Mensagens, fila de envio ou contatos com o mesmo telefone, sem lead ligado ao paciente';

  const agora = new Date();
  const nasc = paciente.data_nascimento ? new Date(paciente.data_nascimento) : null;
  const temClinico = !!grupos.clinico;
  const prontuarioAte = temClinico
    ? maior(addAnos(ultimo.clinico, ANOS_PRONTUARIO), nasc ? addAnos(nasc, IDADE_FIM_GUARDA_MENOR) : null) : null;
  const fiscalAte = grupos.fiscal ? new Date(Date.UTC(ultimo.fiscal.getUTCFullYear() + 1 + ANOS_FISCAL, 0, 1)) : null;
  const comercialAte = grupos.comercial ? addAnos(ultimo.comercial, ANOS_COMERCIAL) : null;
  // Conversa de paciente com prontuário fica retida (defesa, CDC 27), salvo opção da clínica.
  const conversaRetida = !!grupos.conversa && temClinico && !eliminarConversas;
  const conversaAte = conversaRetida ? addAnos(ultimo.conversa, ANOS_CONVERSA) : null;
  const vigente = (d) => !!(d && d > agora);
  return {
    grupos,
    possiveis: [...possiveis.values()],
    retencao: {
      prontuario_ate: iso(prontuarioAte),
      fiscal_ate: iso(fiscalAte),
      comercial_ate: iso(comercialAte),
      conversas_ate: iso(conversaAte),
      prontuario_em_vigor: vigente(prontuarioAte),
      fiscal_em_vigor: vigente(fiscalAte),
      comercial_em_vigor: vigente(comercialAte),
      conversas_em_vigor: vigente(conversaAte),
      menor_regra_21: !!(temClinico && nasc && addAnos(nasc, IDADE_FIM_GUARDA_MENOR) > addAnos(ultimo.clinico, ANOS_PRONTUARIO)),
    },
    // sem_regra: tabelas com dado do paciente sem regra de guarda (bloqueiam a eliminação completa)
    // e tabelas com paciente_id e sem tenant_id (nunca são tocadas; só informadas).
    sem_regra: [...new Set([...Object.keys(grupos.sem_regra || {}), ...semTenant])],
    sem_regra_com_dados: Object.keys(grupos.sem_regra || {}),
    compartilhamento: paciente.clinicorp_patient_id ? ['Clinicorp'] : [],
    aviso_motivo: AVISO_MOTIVO,
    _alvos: alvos,
  };
}
const semInternos = ({ _alvos, ...p }) => p;

async function exportar(db, tenantId, paciente, prev, confirmados) {
  const dados = {};
  const truncadas = [];
  for (const a of prev._alvos) {
    if (!a.registros) continue;
    if (a.vinculo === 'possivel' && !confirmados.has(a.item)) continue;
    const { rows } = await db.query(`SELECT * FROM ${q(a.tabela)} WHERE ${a.where} LIMIT ${LIMITE_LINHAS_EXPORT + 1}`, a.params);
    if (rows.length > LIMITE_LINHAS_EXPORT) { truncadas.push(a.tabela); rows.length = LIMITE_LINHAS_EXPORT; }
    dados[a.tabela] = [...(dados[a.tabela] || []), ...rows];
  }
  const inv = await inventario(db);
  if (inv.has('acessos_prontuario')) {
    const { rows } = await db.query(
      `SELECT em, recurso, acao, usuario_id FROM acessos_prontuario
        WHERE tenant_id = $1 AND paciente_id = $2 ORDER BY em DESC LIMIT ${LIMITE_LINHAS_EXPORT}`,
      [tenantId, String(paciente.id)]);
    if (rows.length) dados.acessos_prontuario = rows;
  }
  const { rows: t } = await db.query('SELECT nome FROM tenants WHERE id = $1', [tenantId]);
  return {
    formato: 'odonto-connect/titular-v2',
    gerado_em: new Date().toISOString(),
    controlador: t[0]?.nome || null,
    titular: paciente,
    dados,
    completo: truncadas.length === 0,
    observacao: truncadas.length
      ? `Esta cópia traz os primeiros ${LIMITE_LINHAS_EXPORT} registros de: ${truncadas.join(', ')}. O restante é entregue em complemento.`
      : 'Cópia completa dos dados ligados ao titular nesta clínica.',
    entrega: 'Entregar por meio seguro (LGPD art. 19 § 2º). Não enviar por WhatsApp.',
  };
}

// Texto para o titular (redação do parecer jurídico, 05/11/2026).
export function montarRespostaTitular({ tipo, nome, dataPedido, clinica, retencao, apagouConversas, sistemas = [], contato }) {
  const contatoTxt = contato || '[contato do encarregado da clínica]';
  if (tipo === 'anonimizar-recusa') {
    return `Não é possível anonimizar seus dados agora porque o prontuário precisa continuar identificando você até ${dataBR(retencao.prontuario_ate || retencao.fiscal_ate)} (Lei nº 13.787/2018, art. 6º). Você pode pedir a exclusão dos demais dados, que fazemos imediatamente.`;
  }
  const partes = [`Olá, ${nome || 'titular'}. Recebemos em ${dataBR(dataPedido)} o seu pedido de exclusão dos seus dados na ${clinica || 'clínica'}.`];
  const apagado = ['seus dados de contato para mensagens', 'os registros de campanhas'];
  if (apagouConversas) apagado.splice(1, 0, 'o histórico de atendimento pelo WhatsApp');
  partes.push(`O que foi apagado: ${apagado.join(', ').replace(/, ([^,]*)$/, ' e $1')}. A partir de hoje você não recebe mais mensagens automáticas nossas.`);
  const mantidos = [];
  if (retencao.prontuario_em_vigor) {
    mantidos.push(`seu prontuário odontológico (ficha, exames, plano de tratamento e registros das consultas), até ${dataBR(retencao.prontuario_ate)}. A lei exige que ele seja guardado por pelo menos 20 anos a partir do último registro (Lei nº 13.787/2018, art. 6º, e Lei nº 13.709/2018, art. 16, I)`);
  }
  if (retencao.fiscal_em_vigor) mantidos.push(`os registros financeiros e fiscais até ${dataBR(retencao.fiscal_ate)}, pela legislação tributária`);
  if (retencao.conversas_em_vigor) mantidos.push(`o histórico de conversas até ${dataBR(retencao.conversas_ate)}, para a defesa de direitos (Código de Defesa do Consumidor, art. 27)`);
  if (retencao.comercial_em_vigor) mantidos.push(`o histórico de agendamentos e orçamentos não realizados até ${dataBR(retencao.comercial_ate)} (Código de Defesa do Consumidor, art. 27)`);
  if (mantidos.length) {
    partes.push(`O que precisamos manter, e até quando: ${mantidos.join('. Também mantemos ')}. Esses dados ficam guardados com acesso restrito e não são usados para nenhuma outra finalidade. Depois desses prazos, serão eliminados ou devolvidos a você, se preferir.`);
  } else {
    partes.push('Não há dados que precisemos manter: todos os seus dados nesta clínica foram eliminados.');
  }
  const integrados = [...sistemas];
  if (apagouConversas) integrados.push('servidor de mensagens do WhatsApp (arquivos de mídia das conversas)');
  if (integrados.length) partes.push(`Sistemas integrados: pedimos também a exclusão em ${integrados.join(' e ')}.`);
  partes.push(`Dúvidas: ${contatoTxt}.`);
  return partes.join('\n\n');
}

// Exclusão/anonimização dentro da transação do client. Devolve só contagens.
async function eliminar(client, tenantId, paciente, tipo, prev, confirmados, { optOutKey, coletor = null }) {
  const resumo = { eliminados: {}, anonimizados: {}, retidos: {}, possiveis_confirmados: [...confirmados] };
  const r = prev.retencao;
  const soma = (obj, t, n) => { if (n) obj[t] = (obj[t] || 0) + n; };
  // Conversas e filhas antes; crm_leads por último (as outras apontam para o lead).
  const ordem = (t) => { const i = [...CONVERSA, ...RELACIONAMENTO].indexOf(t); return i < 0 ? 999 : i; };
  const alvos = prev._alvos.filter(a => a.registros && (a.vinculo === 'paciente' || confirmados.has(a.item)));
  const apagarConversas = !r.conversas_em_vigor;
  // 1. relacionamento (e conversas, se não retidas); conversa antes do lead
  const primeiro = alvos.filter(a => a.classe === 'relacionamento' || (a.classe === 'conversa' && apagarConversas))
    .sort((a, b) => ordem(a.tabela) - ordem(b.tabela));
  for (const a of primeiro) {
    if (coletor) await coletor.coletar(client, a);
    const { rowCount } = await client.query(`DELETE FROM ${q(a.tabela)} WHERE ${a.where}`, a.params);
    soma(resumo.eliminados, a.tabela, rowCount);
  }
  resumo.conversas = prev.grupos.conversa ? (apagarConversas ? 'eliminadas' : 'retidas') : 'nenhuma';
  // 2. não contatar mais: só a chave do telefone (minimização, parecer 4f)
  if (paciente.telefone && optOutKey) {
    const inv = await inventario(client);
    if (inv.has('whatsapp_opt_outs')) {
      await client.query(
        `INSERT INTO whatsapp_opt_outs (tenant_id, phone_key, source) VALUES ($1, $2, 'lgpd')
         ON CONFLICT (tenant_id, phone_key) DO NOTHING`,
        [tenantId, optOutKey(paciente.telefone)]);
    }
  }
  const resto = alvos.filter(a => ['clinico', 'fiscal', 'comercial', 'sem_regra'].includes(a.classe)
    || (a.classe === 'conversa' && !apagarConversas));
  const algumVigente = r.prontuario_em_vigor || r.fiscal_em_vigor || r.comercial_em_vigor || r.conversas_em_vigor;
  if (algumVigente || prev.sem_regra_com_dados.length) {
    for (const a of resto) soma(resumo.retidos, a.tabela, a.registros);
    resumo.cadastro = 'retido';
    return resumo;
  }
  const inv = await inventario(client);
  if (tipo === 'excluir') {
    // Todos os prazos vencidos: elimina o resto e o cadastro (Lei 13.787 art. 6º § 4º: fica registrado aqui).
    for (const a of resto.slice().reverse()) {
      if (coletor) await coletor.coletar(client, a);
      const { rowCount } = await client.query(`DELETE FROM ${q(a.tabela)} WHERE ${a.where}`, a.params);
      soma(resumo.eliminados, a.tabela, rowCount);
    }
    await client.query('DELETE FROM pacientes WHERE id = $1 AND tenant_id = $2', [paciente.id, tenantId]);
    resumo.cadastro = 'eliminado';
    return resumo;
  }
  // anonimizar: assinatura sai, texto clínico livre e identificadores do cadastro viram NULL.
  for (const a of resto) {
    if (APAGAR_NA_ANONIMIZACAO.includes(a.tabela)) {
      if (coletor) await coletor.coletar(client, a);
      const { rowCount } = await client.query(`DELETE FROM ${q(a.tabela)} WHERE ${a.where}`, a.params);
      soma(resumo.eliminados, a.tabela, rowCount);
      continue;
    }
    const cols = (TEXTO_LIVRE[a.tabela] || []).filter(c => a.cols.get(c)?.nullable);
    if (cols.length) {
      if (coletor) await coletor.coletar(client, a); // arquivo_url, anexos e audio_url viram NULL: o arquivo sai também
      const { rowCount } = await client.query(
        `UPDATE ${q(a.tabela)} SET ${cols.map(c => `${q(c)} = NULL`).join(', ')} WHERE ${a.where}`, a.params);
      soma(resumo.anonimizados, a.tabela, rowCount);
    } else {
      soma(resumo.anonimizados, a.tabela, a.registros);
    }
  }
  const pc = inv.get('pacientes') || new Map();
  const sets = PACIENTE_IDENTIFICADORES.filter(c => pc.get(c)?.nullable).map(c => `${q(c)} = NULL`);
  sets.unshift(`nome = 'Titular anonimizado'`);
  if (pc.has('updated_at')) sets.push('updated_at = NOW()');
  await client.query(`UPDATE pacientes SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2`, [paciente.id, tenantId]);
  resumo.cadastro = 'anonimizado';
  return resumo;
}

// Registro de acesso a prontuário: quem, qual paciente, quando, recurso e ação. Nunca o conteúdo.
// Falha de gravação não bloqueia a tela (só registra no log, sem id de paciente).
let avisouTabelaAusente = false;
export async function registrarAcessoProntuario(pool, user, pacienteIds, recurso, acao = 'visualizar') {
  try {
    const ids = [...new Set((Array.isArray(pacienteIds) ? pacienteIds : [pacienteIds])
      .filter(Boolean).map(String))].slice(0, 500);
    if (!ids.length || !user?.tenant_id) return;
    await pool.query(
      `INSERT INTO acessos_prontuario (tenant_id, usuario_id, paciente_id, recurso, acao)
       SELECT $1, $2, unnest($3::text[]), $4, $5`,
      [user.tenant_id, user.id || null, ids, recurso, acao]);
  } catch (e) {
    if (e?.code === '42P01') {
      if (!avisouTabelaAusente) { avisouTabelaAusente = true; console.warn('[acessos_prontuario] tabela ausente: rode migration-lgpd-titular.sql'); }
      return;
    }
    console.error('[acessos_prontuario]', e.message);
  }
}

function erroHttp(res, err, tag) {
  if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
  if (err.message === 'Admin access required') return res.status(403).json({ error: 'Só o administrador da clínica pode fazer isto' });
  console.error(`[lgpd:${tag}]`, err.message);
  return res.status(500).json({ error: 'Erro interno' });
}

// Mesmo esquema de migration-lgpd-titular.sql, no boot, para a API não depender só do deploy.
// Sem permissão de DDL (usuário não dono) só registra uma linha; o deploy cria como postgres.
export async function ensureLgpdSchema(pool) {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS lgpd_solicitacoes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
      paciente_id TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('exportar', 'excluir', 'anonimizar')),
      status TEXT NOT NULL DEFAULT 'aguardando_confirmacao'
        CHECK (status IN ('aguardando_confirmacao', 'executada', 'cancelada', 'expirada', 'recusada')),
      origem TEXT NOT NULL DEFAULT 'titular' CHECK (origem IN ('titular', 'representante', 'clinica')),
      motivo TEXT, solicitado_por UUID, solicitado_por_email TEXT,
      solicitado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      codigo_hash TEXT, expira_em TIMESTAMPTZ, tentativas INT NOT NULL DEFAULT 0,
      confirmado_por UUID, confirmado_por_email TEXT, executado_em TIMESTAMPTZ,
      motivo_recusa TEXT, resumo JSONB)`,
    `ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS identidade_conferida_por TEXT`,
    `ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS identidade_documento TEXT`,
    `ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS representante_nome TEXT`,
    `ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS representante_vinculo TEXT`,
    `ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS ao_fim_do_prazo TEXT`,
    `ALTER TABLE lgpd_solicitacoes ADD COLUMN IF NOT EXISTS eliminar_conversas BOOLEAN NOT NULL DEFAULT false`,
    `CREATE INDEX IF NOT EXISTS idx_lgpd_solicitacoes_tenant ON lgpd_solicitacoes (tenant_id, paciente_id, solicitado_em DESC)`,
    `CREATE TABLE IF NOT EXISTS acessos_prontuario (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
      usuario_id UUID, paciente_id TEXT NOT NULL, recurso TEXT NOT NULL,
      acao TEXT NOT NULL DEFAULT 'visualizar', em TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_acessos_prontuario_paciente ON acessos_prontuario (tenant_id, paciente_id, em DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_acessos_prontuario_em ON acessos_prontuario (tenant_id, em)`,
  ];
  let semPermissao = 0;
  for (const sql of ddl) {
    try { await pool.query(sql); } catch (e) {
      if (e?.code === '42501') semPermissao++;
      else if (e?.code !== '42P07' && e?.code !== '42701') console.warn('[lgpd-schema]', e.message);
    }
  }
  if (semPermissao) console.warn(`[lgpd-schema] ${semPermissao} comando(s) pulados: sem permissão de DDL (vem do deploy)`);
}

const DOCUMENTOS = ['rg', 'cnh', 'cpf', 'passaporte', 'certidao_nascimento', 'outro'];

export function registerLgpd(app, { pool, verifyAdmin, optOutKey }) {
  if (process.env.NODE_ENV !== 'test') ensureLgpdSchema(pool).catch(() => {});
  // Pedido do titular é decisão da clínica (controladora): super-admin da plataforma não executa.
  const exigeAdminDaClinica = async (req) => {
    const { user } = await verifyAdmin(req);
    if (user.is_super_admin) throw new Error('Admin access required');
    return user.tenant_id ? user : null;
  };
  const carregarPaciente = async (db, id, tenantId) => {
    if (!UUID_RE.test(String(id || ''))) return null;
    const { rows } = await db.query('SELECT * FROM pacientes WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return rows[0] || null;
  };
  const publico = (s) => ({
    id: s.id, paciente_id: s.paciente_id, tipo: s.tipo, status: s.status, origem: s.origem,
    solicitado_por: s.solicitado_por, solicitado_em: s.solicitado_em,
    identidade_conferida_por: s.identidade_conferida_por, identidade_documento: s.identidade_documento,
    representante_vinculo: s.representante_vinculo, ao_fim_do_prazo: s.ao_fim_do_prazo,
    confirmado_por: s.confirmado_por, executado_em: s.executado_em,
    expira_em: s.expira_em, motivo_recusa: s.motivo_recusa, resumo: s.resumo,
  });
  const idade = (nasc) => {
    if (!nasc) return null;
    const n = new Date(nasc); const h = new Date();
    let a = h.getFullYear() - n.getFullYear();
    if (h < new Date(h.getFullYear(), n.getMonth(), n.getDate())) a--;
    return a;
  };
  const resumoGravavel = (prev) => ({ grupos: prev.grupos, retencao: prev.retencao, possiveis: prev.possiveis.map(p => ({ item: p.item, tabelas: p.tabelas })), sem_regra: prev.sem_regra });

  app.post('/api/lgpd/solicitacoes', async (req, res) => {
    try {
      const user = await exigeAdminDaClinica(req);
      if (!user) return res.status(403).json({ error: 'Sem clínica vinculada' });
      const b = req.body || {};
      const { paciente_id, tipo } = b;
      const origem = ['titular', 'representante', 'clinica'].includes(b.origem) ? b.origem : 'titular';
      // Texto livre curto: a tela mostra AVISO_MOTIVO (sem dado de saúde).
      const motivo = b.motivo ? String(b.motivo).slice(0, 300) : null;
      if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'tipo deve ser exportar, excluir ou anonimizar' });
      const ident = b.identidade || {};
      const conferidaPor = String(ident.conferida_por || '').trim().slice(0, 120);
      const documento = DOCUMENTOS.includes(ident.documento) ? ident.documento : null;
      if (!conferidaPor || !documento) {
        return res.status(400).json({ error: `Informe quem conferiu a identidade do titular e o documento visto (${DOCUMENTOS.join(', ')})` });
      }
      const paciente = await carregarPaciente(pool, paciente_id, user.tenant_id);
      if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });
      const rep = ident.representante || null;
      const repNome = rep?.nome ? String(rep.nome).trim().slice(0, 120) : null;
      const repVinculo = rep?.vinculo ? String(rep.vinculo).trim().slice(0, 60) : null;
      const anos = idade(paciente.data_nascimento);
      if ((origem === 'representante' || (anos != null && anos < 18)) && !(repNome && repVinculo)) {
        return res.status(400).json({ error: 'Pedido por representante ou de menor de 18 anos: informe o nome e o vínculo do responsável (LGPD art. 14 e 18 § 3º)' });
      }
      const aoFim = b.ao_fim_do_prazo === 'devolver' ? 'devolver' : 'eliminar';
      const eliminarConversas = b.eliminar_conversas === true;
      const prev = await previa(pool, user.tenant_id, paciente, { eliminarConversas });
      const r = prev.retencao;
      const valores = [user.tenant_id, paciente.id, tipo, origem, motivo, user.id || null, user.email || null,
        conferidaPor, documento, repNome, repVinculo, aoFim, eliminarConversas];
      const colunas = `tenant_id, paciente_id, tipo, origem, motivo, solicitado_por, solicitado_por_email,
        identidade_conferida_por, identidade_documento, representante_nome, representante_vinculo, ao_fim_do_prazo, eliminar_conversas`;

      if (tipo === 'anonimizar' && (r.prontuario_em_vigor || r.fiscal_em_vigor || r.comercial_em_vigor || r.conversas_em_vigor)) {
        const ate = r.prontuario_ate || r.fiscal_ate || r.comercial_ate || r.conversas_ate;
        const motivoRecusa = `Guarda obrigatória em vigor até ${dataBR(ate)}. Anonimização só depois dos prazos; use "excluir" para eliminar o que não precisa ser guardado.`;
        const { rows } = await pool.query(
          `INSERT INTO lgpd_solicitacoes (${colunas}, status, motivo_recusa, resumo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, 'recusada', $14, $15) RETURNING *`,
          [...valores, motivoRecusa, JSON.stringify(resumoGravavel(prev))]);
        return res.status(409).json({
          error: motivoRecusa,
          solicitacao: publico(rows[0]),
          previa: semInternos(prev),
          resposta_titular: montarRespostaTitular({ tipo: 'anonimizar-recusa', retencao: r }),
        });
      }

      const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
      const { rows } = await pool.query(
        `INSERT INTO lgpd_solicitacoes (${colunas}, status, codigo_hash, expira_em, resumo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, 'aguardando_confirmacao', $14,
                 NOW() + INTERVAL '${CODIGO_VALIDADE_MIN} minutes', $15)
         RETURNING *`,
        [...valores, hash(codigo), JSON.stringify(resumoGravavel(prev))]);
      res.status(201).json({
        solicitacao: publico(rows[0]),
        previa: semInternos(prev),
        confirmacao: {
          codigo, frase: tipo.toUpperCase(), expira_em: rows[0].expira_em,
          possiveis: 'Marque em possiveis_confirmados só os itens que são do titular (o resto fica de fora).',
        },
      });
    } catch (err) { erroHttp(res, err, 'criar'); }
  });

  app.post('/api/lgpd/solicitacoes/:id/confirmar', async (req, res) => {
    let client;
    try {
      const user = await exigeAdminDaClinica(req);
      if (!user) return res.status(403).json({ error: 'Sem clínica vinculada' });
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Solicitação não encontrada' });
      const { codigo, frase } = req.body || {};
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '120s'");
      const { rows } = await client.query(
        'SELECT * FROM lgpd_solicitacoes WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.id, user.tenant_id]);
      const s = rows[0];
      if (!s) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Solicitação não encontrada' }); }
      if (s.status !== 'aguardando_confirmacao') { await client.query('ROLLBACK'); return res.status(409).json({ error: `Solicitação ${s.status}` }); }
      if (new Date(s.expira_em) < new Date()) {
        await client.query(`UPDATE lgpd_solicitacoes SET status = 'expirada' WHERE id = $1 AND tenant_id = $2`, [s.id, user.tenant_id]);
        await client.query('COMMIT');
        return res.status(410).json({ error: 'Código expirado: faça a solicitação de novo' });
      }
      const codigoOk = typeof codigo === 'string' && codigo.length > 0
        && crypto.timingSafeEqual(Buffer.from(hash(codigo.trim().toUpperCase())), Buffer.from(String(s.codigo_hash)));
      if (!codigoOk || String(frase || '').trim().toUpperCase() !== s.tipo.toUpperCase()) {
        await client.query(
          `UPDATE lgpd_solicitacoes SET tentativas = COALESCE(tentativas, 0) + 1,
                  status = CASE WHEN COALESCE(tentativas, 0) + 1 >= 5 THEN 'cancelada' ELSE status END
            WHERE id = $1 AND tenant_id = $2`, [s.id, user.tenant_id]);
        await client.query('COMMIT');
        return res.status(422).json({ error: `Confirmação inválida: digite o código e a palavra ${s.tipo.toUpperCase()}` });
      }
      const paciente = await carregarPaciente(client, s.paciente_id, user.tenant_id);
      if (!paciente) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Paciente não encontrado' }); }

      const prev = await previa(client, user.tenant_id, paciente, { eliminarConversas: !!s.eliminar_conversas });
      const pedidos = Array.isArray(req.body?.possiveis_confirmados) ? req.body.possiveis_confirmados.map(String) : [];
      const existentes = new Set(prev.possiveis.map(p => p.item));
      const invalidos = pedidos.filter(p => !existentes.has(p));
      if (invalidos.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Item de possível vínculo inválido', invalidos }); }
      const confirmados = new Set(pedidos);
      const { rows: t } = await client.query('SELECT nome FROM tenants WHERE id = $1', [user.tenant_id]);

      let resumo;
      let arquivo = null;
      let respostaTitular = null;
      let coletor = null;
      if (s.tipo === 'exportar') {
        arquivo = await exportar(client, user.tenant_id, paciente, prev, confirmados);
        resumo = {
          exportados: Object.fromEntries(Object.entries(arquivo.dados).map(([tb, r]) => [tb, r.length])),
          completo: arquivo.completo, possiveis_confirmados: [...confirmados],
        };
      } else {
        const r = prev.retencao;
        if (s.tipo === 'anonimizar' && (r.prontuario_em_vigor || r.fiscal_em_vigor || r.comercial_em_vigor || r.conversas_em_vigor)) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Guarda obrigatória em vigor: anonimização não permitida', previa: semInternos(prev),
            resposta_titular: montarRespostaTitular({ tipo: 'anonimizar-recusa', retencao: r }) });
        }
        coletor = novoColetor();
        resumo = await eliminar(client, user.tenant_id, paciente, s.tipo, prev, confirmados, { optOutKey, coletor });
        resumo.arquivos = coletor.previa();
        resumo.backups = avisoBackups();
        resumo.retencao = r;
        resumo.compartilhamento = prev.compartilhamento;
        respostaTitular = montarRespostaTitular({
          tipo: s.tipo, nome: paciente.nome, dataPedido: s.solicitado_em, clinica: t[0]?.nome,
          retencao: r, apagouConversas: resumo.conversas === 'eliminadas', sistemas: prev.compartilhamento,
          contato: req.body?.contato_encarregado ? String(req.body.contato_encarregado).slice(0, 200) : null,
        });
      }
      await client.query(
        `UPDATE lgpd_solicitacoes SET status = 'executada', confirmado_por = $3, confirmado_por_email = $4,
                executado_em = NOW(), codigo_hash = NULL, resumo = $5
          WHERE id = $1 AND tenant_id = $2`,
        [s.id, user.tenant_id, user.id || null, user.email || null, JSON.stringify(resumo)]);
      await client.query('COMMIT');
      // Arquivos só depois do COMMIT (se a transação falhar, nada sai do disco). Resultado no registro.
      if (coletor) {
        resumo.arquivos = await coletor.apagar(client);
        await pool.query(`UPDATE lgpd_solicitacoes SET resumo = $3 WHERE id = $1 AND tenant_id = $2`,
          [s.id, user.tenant_id, JSON.stringify(resumo)]).catch(e => console.error('[lgpd] registro de arquivos:', e.code || e.message));
      }
      if (arquivo) {
        res.setHeader('Content-Disposition', `attachment; filename="titular-${s.id}.json"`);
        return res.json(arquivo);
      }
      // resposta_titular: enviar por e-mail ou impressa em até 15 dias (LGPD 19 II), nunca por WhatsApp aberto.
      res.json({ success: true, resumo, resposta_titular: respostaTitular });
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (err?.code === '23503') {
        return res.status(409).json({ error: `Há registros ligados em ${err.table || 'outra tabela'}: nada foi alterado. Revise antes de excluir.` });
      }
      if (err?.code === '55P03') return res.status(503).json({ error: 'Banco ocupado: tente de novo em instantes. Nada foi alterado.' });
      erroHttp(res, err, 'confirmar');
    } finally {
      client?.release();
    }
  });

  app.post('/api/lgpd/solicitacoes/:id/cancelar', async (req, res) => {
    try {
      const user = await exigeAdminDaClinica(req);
      if (!user) return res.status(403).json({ error: 'Sem clínica vinculada' });
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Solicitação não encontrada' });
      const { rowCount } = await pool.query(
        `UPDATE lgpd_solicitacoes SET status = 'cancelada', codigo_hash = NULL, confirmado_por = $3, confirmado_por_email = $4
          WHERE id = $1 AND tenant_id = $2 AND status = 'aguardando_confirmacao'`,
        [req.params.id, user.tenant_id, user.id || null, user.email || null]);
      if (!rowCount) return res.status(404).json({ error: 'Solicitação não encontrada ou já encerrada' });
      res.json({ success: true });
    } catch (err) { erroHttp(res, err, 'cancelar'); }
  });

  app.get('/api/lgpd/solicitacoes', async (req, res) => {
    try {
      const user = await exigeAdminDaClinica(req);
      if (!user) return res.status(403).json({ error: 'Sem clínica vinculada' });
      const params = [user.tenant_id];
      let filtro = '';
      if (req.query.paciente_id) {
        if (!UUID_RE.test(String(req.query.paciente_id))) return res.json([]);
        params.push(String(req.query.paciente_id)); filtro = ` AND paciente_id = $2`;
      }
      const { rows } = await pool.query(
        `SELECT * FROM lgpd_solicitacoes WHERE tenant_id = $1${filtro} ORDER BY solicitado_em DESC LIMIT 500`, params);
      res.json(rows.map(publico));
    } catch (err) { erroHttp(res, err, 'listar'); }
  });

  app.get('/api/lgpd/pacientes/:id/acessos', async (req, res) => {
    try {
      const user = await exigeAdminDaClinica(req);
      if (!user) return res.status(403).json({ error: 'Sem clínica vinculada' });
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Paciente não encontrado' });
      const { rows: pac } = await pool.query('SELECT 1 FROM pacientes WHERE id = $1 AND tenant_id = $2', [req.params.id, user.tenant_id]);
      if (!pac.length) return res.status(404).json({ error: 'Paciente não encontrado' });
      const { rows } = await pool.query(
        `SELECT a.em, a.recurso, a.acao, a.usuario_id, p.name AS usuario_nome
           FROM acessos_prontuario a
           LEFT JOIN profiles p ON p.id::text = a.usuario_id::text AND p.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND a.paciente_id = $2
          ORDER BY a.em DESC LIMIT 1000`,
        [user.tenant_id, req.params.id]);
      res.json(rows);
    } catch (err) { erroHttp(res, err, 'acessos'); }
  });
}

// Usado por lgpd-expurgo.mjs (mesma regra de prazo e de eliminação do pedido do titular).
export const __interno = { previa, eliminar };
