// Direitos do titular (LGPD art. 18) e registro de acesso ao prontuário.
//
// Rotas (só admin da clínica, sempre no tenant do usuário):
//   POST /api/lgpd/solicitacoes                 { paciente_id, tipo, origem?, motivo? }
//        tipo = exportar | excluir | anonimizar. Cria o pedido "aguardando_confirmacao", devolve a
//        prévia (quantos registros por tabela, o que fica retido e até quando) e um código de uso
//        único que vale 15 min.
//   POST /api/lgpd/solicitacoes/:id/confirmar   { codigo, frase }   frase = EXPORTAR | EXCLUIR | ANONIMIZAR
//        Segunda confirmação: executa. "exportar" devolve o JSON com os dados do titular.
//   POST /api/lgpd/solicitacoes/:id/cancelar
//   GET  /api/lgpd/solicitacoes[?paciente_id=]  histórico (quem pediu, quem confirmou, quando, resumo)
//   GET  /api/lgpd/pacientes/:id/acessos        quem abriu o prontuário do paciente e quando
//
// Retenção (docs/banco/retencao-lgpd.md): prontuário e registros clínicos ficam 20 anos a partir
// do último registro (Lei 13.787/2018 art. 6º); financeiro 5 anos. Enquanto o prazo corre,
// "excluir" elimina só os dados de relacionamento (lead, conversas, fila de WhatsApp, contatos...)
// e informa o que ficou retido e por quê (LGPD art. 16 I e art. 18 § 4º II); "anonimizar" é
// recusado (o prontuário precisa identificar o paciente). Nada de dado de saúde em log ou resumo.
import crypto from 'crypto';

export const TIPOS = ['exportar', 'excluir', 'anonimizar'];
const CODIGO_VALIDADE_MIN = 15;
const LIMITE_LINHAS_EXPORT = 10000;
export const ANOS_RETENCAO_CLINICA = 20;
export const ANOS_RETENCAO_FISCAL = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prontuário e documentos clínicos: retidos (Lei 13.787 art. 6º; CFO). Agenda e orçamento entram
// como parte do registro de atendimento — confirmar com a Helena.
export const RETIDO_CLINICO = [
  'prontuarios', 'anamneses', 'odontogramas', 'exames', 'tratamentos', 'tratamento_etapas',
  'procedimento_execucoes', 'assinaturas_eletronicas', 'consentimentos_pacientes',
  'consultations', 'clinical_reports', 'agendamentos', 'orcamentos',
];
// Fiscal/contábil (5 anos).
export const RETIDO_FISCAL = ['financeiro', 'comissoes', 'financeiro_receitas'];
// Relacionamento/marketing: eliminável a pedido. Ordem = ordem de exclusão (filhas antes).
export const ELIMINAVEL = [
  'kanban_movements', 'chat_read_status', 'lead_tag_assignments', 'tag_assignments',
  'satisfaction_ratings', 'transfer_logs', 'attendance_sessions', 'chat_messages',
  'automation_jobs', 'reactivation_sends', 'clinicorp_conflicts', 'contatos', 'crm_leads',
];
// Coluna de telefone por tabela (casamento por DDD + 8 últimos dígitos).
const COLUNA_TELEFONE = {
  crm_leads: 'telefone', chat_messages: 'phone', automation_jobs: 'patient_phone', contatos: 'telefone',
  attendance_sessions: 'lead_phone', satisfaction_ratings: 'lead_phone', transfer_logs: 'lead_phone',
  reactivation_sends: 'phone',
};
// Únicas tabelas sem tenant_id aceitas, e só por lead_id de leads já filtrados pela clínica.
const SEM_TENANT_POR_LEAD = new Set(['tag_assignments']);
// Identificadores apagados na anonimização do cadastro.
const PACIENTE_IDENTIFICADORES = ['cpf', 'telefone', 'email', 'endereco', 'data_nascimento', 'observacoes',
  'clinicorp_patient_id', 'rg', 'celular', 'foto_url', 'avatar_url'];

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
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.table_name)) mapa.set(r.table_name, new Set());
    mapa.get(r.table_name).add(r.column_name);
  }
  inventarioCache = { mapa, ate: Date.now() + 10 * 60 * 1000 };
  return mapa;
}
export function limparCacheInventarioParaTestes() { inventarioCache = null; }

// Onde estão os dados do titular: [{ tabela, classe, where, params }]. Sempre com tenant_id.
async function localizar(db, tenantId, paciente) {
  const inv = await inventario(db);
  const chave = chaveTelefone(paciente.telefone);
  let leadIds = [];
  const lead = inv.get('crm_leads');
  if (lead?.has('tenant_id')) {
    const conds = [];
    const params = [tenantId];
    if (lead.has('paciente_id')) { params.push(paciente.id); conds.push(`paciente_id::text = $${params.length}`); }
    if (chave && lead.has('telefone')) { params.push(chave); conds.push(`${sqlChaveTelefone('telefone')} = $${params.length}`); }
    if (conds.length) {
      const { rows } = await db.query(
        `SELECT id::text AS id FROM crm_leads WHERE tenant_id = $1 AND (${conds.join(' OR ')})`, params);
      leadIds = rows.map(r => r.id);
    }
  }
  const alvos = [];
  for (const [tabela, cols] of inv) {
    if (tabela === 'pacientes' || tabela === 'lgpd_solicitacoes' || tabela === 'acessos_prontuario') continue;
    const comTenant = cols.has('tenant_id');
    if (!comTenant && !SEM_TENANT_POR_LEAD.has(tabela)) continue;
    const params = comTenant ? [tenantId] : [];
    const conds = [];
    if (cols.has('paciente_id')) { params.push(paciente.id); conds.push(`paciente_id::text = $${params.length}`); }
    if (leadIds.length && cols.has('lead_id')) { params.push(leadIds); conds.push(`lead_id::text = ANY($${params.length}::text[])`); }
    if (tabela === 'crm_leads' && leadIds.length) { params.push(leadIds); conds.push(`id::text = ANY($${params.length}::text[])`); }
    const colTel = COLUNA_TELEFONE[tabela];
    if (chave && colTel && cols.has(colTel)) { params.push(chave); conds.push(`${sqlChaveTelefone(q(colTel))} = $${params.length}`); }
    if (!conds.length) continue;
    if (!comTenant && !conds.some(c => c.startsWith('lead_id'))) continue;
    const classe = RETIDO_CLINICO.includes(tabela) ? 'clinico'
      : RETIDO_FISCAL.includes(tabela) || tabela.startsWith('fin_') ? 'fiscal'
      : ELIMINAVEL.includes(tabela) ? 'eliminavel' : 'sem_regra';
    const where = `${comTenant ? 'tenant_id = $1 AND ' : ''}(${conds.join(' OR ')})`;
    alvos.push({ tabela, classe, where, params, cols });
  }
  return { alvos, leadIds };
}

function addAnos(data, anos) {
  if (!data) return null;
  const d = new Date(data);
  d.setFullYear(d.getFullYear() + anos);
  return d;
}

// Prévia: contagem por tabela e prazo de retenção (último registro + 20 anos / + 5 anos).
async function previa(db, tenantId, paciente) {
  const { alvos } = await localizar(db, tenantId, paciente);
  const tabelas = [];
  let ultimoClinico = null;
  let ultimoFiscal = null;
  for (const a of alvos) {
    const datas = ['created_at', 'updated_at'].filter(c => a.cols.has(c));
    const ultimo = datas.length ? `max(GREATEST(${datas.map(q).join(', ')}))` : 'NULL::timestamptz';
    const { rows } = await db.query(`SELECT count(*)::int AS n, ${ultimo} AS ultimo FROM ${q(a.tabela)} WHERE ${a.where}`, a.params);
    const n = rows[0]?.n || 0;
    if (!n) continue;
    tabelas.push({ tabela: a.tabela, classe: a.classe, registros: n });
    const u = rows[0].ultimo ? new Date(rows[0].ultimo) : null;
    if (a.classe === 'clinico' && u && (!ultimoClinico || u > ultimoClinico)) ultimoClinico = u;
    if (a.classe === 'fiscal' && u && (!ultimoFiscal || u > ultimoFiscal)) ultimoFiscal = u;
  }
  const temClinico = tabelas.some(t => t.classe === 'clinico');
  const temFiscal = tabelas.some(t => t.classe === 'fiscal');
  // Registro clínico sem data conhecida conta como "agora" (o prazo não começou a correr).
  const clinicoAte = temClinico ? addAnos(ultimoClinico || new Date(), ANOS_RETENCAO_CLINICA) : null;
  const fiscalAte = temFiscal ? addAnos(ultimoFiscal || new Date(), ANOS_RETENCAO_FISCAL) : null;
  const agora = new Date();
  const retido = (clinicoAte && clinicoAte > agora) || (fiscalAte && fiscalAte > agora);
  return {
    tabelas,
    retencao: {
      prontuario_ate: clinicoAte ? clinicoAte.toISOString() : null,
      fiscal_ate: fiscalAte ? fiscalAte.toISOString() : null,
      em_vigor: !!retido,
      base_legal: retido
        ? 'LGPD art. 16, I (obrigação legal): prontuário por 20 anos do último registro (Lei 13.787/2018, art. 6º); financeiro por 5 anos.'
        : null,
    },
    sem_regra: tabelas.filter(t => t.classe === 'sem_regra').map(t => t.tabela),
    compartilhamento: paciente.clinicorp_patient_id ? ['Clinicorp'] : [],
  };
}

async function exportar(db, tenantId, paciente) {
  const { alvos } = await localizar(db, tenantId, paciente);
  const dados = {};
  for (const a of alvos) {
    const { rows } = await db.query(`SELECT * FROM ${q(a.tabela)} WHERE ${a.where} LIMIT ${LIMITE_LINHAS_EXPORT}`, a.params);
    if (rows.length) dados[a.tabela] = rows;
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
    formato: 'odonto-connect/titular-v1',
    gerado_em: new Date().toISOString(),
    controlador: t[0]?.nome || null,
    titular: paciente,
    dados,
    observacao: `Até ${LIMITE_LINHAS_EXPORT} registros por tabela.`,
  };
}

// Executa exclusão/anonimização dentro da transação do client. Devolve só contagens.
async function eliminar(client, tenantId, paciente, tipo, prev, { optOutKey }) {
  const { alvos } = await localizar(client, tenantId, paciente);
  const porTabela = new Map(alvos.map(a => [a.tabela, a]));
  const resumo = { eliminados: {}, anonimizados: {}, retidos: {} };
  for (const tabela of ELIMINAVEL) {
    const a = porTabela.get(tabela);
    if (!a) continue;
    const { rowCount } = await client.query(`DELETE FROM ${q(tabela)} WHERE ${a.where}`, a.params);
    if (rowCount) resumo.eliminados[tabela] = rowCount;
  }
  // Não contatar mais (marketing): registra opt-out do telefone na clínica.
  if (paciente.telefone && optOutKey) {
    const inv = await inventario(client);
    if (inv.has('whatsapp_opt_outs')) {
      await client.query(
        `INSERT INTO whatsapp_opt_outs (tenant_id, phone_key, phone, source, keyword)
         VALUES ($1, $2, $3, 'lgpd', NULL) ON CONFLICT (tenant_id, phone_key) DO NOTHING`,
        [tenantId, optOutKey(paciente.telefone), String(paciente.telefone).replace(/\D/g, '')]);
    }
  }
  const clinicoFiscal = alvos.filter(a => a.classe === 'clinico' || a.classe === 'fiscal');
  const semRegra = alvos.filter(a => a.classe === 'sem_regra');
  if (prev.retencao.em_vigor || prev.sem_regra.length) {
    for (const a of [...clinicoFiscal, ...semRegra]) {
      const t = prev.tabelas.find(x => x.tabela === a.tabela);
      if (t) resumo.retidos[a.tabela] = t.registros;
    }
    resumo.cadastro = 'retido';
    return resumo;
  }
  if (tipo === 'excluir') {
    // Prazo vencido: elimina também o registro clínico/fiscal e o cadastro (Lei 13.787 art. 6º).
    for (const a of clinicoFiscal.slice().reverse()) {
      const { rowCount } = await client.query(`DELETE FROM ${q(a.tabela)} WHERE ${a.where}`, a.params);
      if (rowCount) resumo.eliminados[a.tabela] = rowCount;
    }
    await client.query('DELETE FROM pacientes WHERE id = $1 AND tenant_id = $2', [paciente.id, tenantId]);
    resumo.cadastro = 'eliminado';
  } else {
    // anonimizar: tira os identificadores do cadastro; registros clínicos ficam ligados a ele.
    const inv = await inventario(client);
    const cols = inv.get('pacientes') || new Set();
    const sets = PACIENTE_IDENTIFICADORES.filter(c => cols.has(c)).map(c => `${q(c)} = NULL`);
    sets.unshift(`nome = 'Titular anonimizado'`);
    if (cols.has('updated_at')) sets.push('updated_at = NOW()');
    await client.query(`UPDATE pacientes SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2`, [paciente.id, tenantId]);
    resumo.cadastro = 'anonimizado';
    for (const a of clinicoFiscal) {
      const t = prev.tabelas.find(x => x.tabela === a.tabela);
      if (t) resumo.anonimizados[a.tabela] = t.registros;
    }
  }
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
      else if (e?.code !== '42P07') console.warn('[lgpd-schema]', e.message);
    }
  }
  if (semPermissao) console.warn(`[lgpd-schema] ${semPermissao} comando(s) pulados: sem permissão de DDL (vem do deploy)`);
}

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
    confirmado_por: s.confirmado_por, executado_em: s.executado_em,
    expira_em: s.expira_em, motivo_recusa: s.motivo_recusa, resumo: s.resumo,
  });

  app.post('/api/lgpd/solicitacoes', async (req, res) => {
    try {
      const user = await exigeAdminDaClinica(req);
      if (!user) return res.status(403).json({ error: 'Sem clínica vinculada' });
      const { paciente_id, tipo } = req.body || {};
      const origem = ['titular', 'representante', 'clinica'].includes(req.body?.origem) ? req.body.origem : 'titular';
      // Texto livre curto: não colocar diagnóstico nem dado de saúde.
      const motivo = req.body?.motivo ? String(req.body.motivo).slice(0, 300) : null;
      if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'tipo deve ser exportar, excluir ou anonimizar' });
      const paciente = await carregarPaciente(pool, paciente_id, user.tenant_id);
      if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });
      const prev = await previa(pool, user.tenant_id, paciente);

      if (tipo === 'anonimizar' && prev.retencao.em_vigor) {
        const motivoRecusa = `Prontuário em guarda obrigatória até ${prev.retencao.prontuario_ate || prev.retencao.fiscal_ate}. ${prev.retencao.base_legal} Use "excluir" para eliminar os dados de relacionamento.`;
        const { rows } = await pool.query(
          `INSERT INTO lgpd_solicitacoes (tenant_id, paciente_id, tipo, status, origem, motivo, solicitado_por, solicitado_por_email, motivo_recusa, resumo)
           VALUES ($1, $2, $3, 'recusada', $4, $5, $6, $7, $8, $9) RETURNING *`,
          [user.tenant_id, paciente.id, tipo, origem, motivo, user.id || null, user.email || null, motivoRecusa,
           JSON.stringify({ previa: prev.tabelas, retencao: prev.retencao })]);
        return res.status(409).json({ error: motivoRecusa, solicitacao: publico(rows[0]), previa: prev });
      }

      const codigo = crypto.randomBytes(4).toString('hex').toUpperCase();
      const { rows } = await pool.query(
        `INSERT INTO lgpd_solicitacoes (tenant_id, paciente_id, tipo, status, origem, motivo, solicitado_por, solicitado_por_email,
                                        codigo_hash, expira_em, resumo)
         VALUES ($1, $2, $3, 'aguardando_confirmacao', $4, $5, $6, $7, $8, NOW() + INTERVAL '${CODIGO_VALIDADE_MIN} minutes', $9)
         RETURNING *`,
        [user.tenant_id, paciente.id, tipo, origem, motivo, user.id || null, user.email || null, hash(codigo),
         JSON.stringify({ previa: prev.tabelas, retencao: prev.retencao })]);
      res.status(201).json({
        solicitacao: publico(rows[0]),
        previa: prev,
        confirmacao: { codigo, frase: tipo.toUpperCase(), expira_em: rows[0].expira_em },
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

      let resumo;
      let arquivo = null;
      if (s.tipo === 'exportar') {
        arquivo = await exportar(client, user.tenant_id, paciente);
        resumo = { exportados: Object.fromEntries(Object.entries(arquivo.dados).map(([t, r]) => [t, r.length])) };
      } else {
        const prev = await previa(client, user.tenant_id, paciente);
        if (s.tipo === 'anonimizar' && prev.retencao.em_vigor) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Prontuário em guarda obrigatória: anonimização não permitida', previa: prev });
        }
        resumo = await eliminar(client, user.tenant_id, paciente, s.tipo, prev, { optOutKey });
        resumo.retencao = prev.retencao;
        resumo.compartilhamento = prev.compartilhamento;
      }
      await client.query(
        `UPDATE lgpd_solicitacoes SET status = 'executada', confirmado_por = $3, confirmado_por_email = $4,
                executado_em = NOW(), codigo_hash = NULL, resumo = $5
          WHERE id = $1 AND tenant_id = $2`,
        [s.id, user.tenant_id, user.id || null, user.email || null, JSON.stringify(resumo)]);
      await client.query('COMMIT');
      if (arquivo) {
        res.setHeader('Content-Disposition', `attachment; filename="titular-${s.id}.json"`);
        return res.json(arquivo);
      }
      res.json({ success: true, resumo });
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (err?.code === '23503') {
        // Registro ligado sem regra de exclusão (ex.: etapa de tratamento): nada foi apagado.
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
