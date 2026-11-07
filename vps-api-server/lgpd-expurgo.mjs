// Expurgo por prazo de guarda (docs/banco/retencao-lgpd.md). O job SÓ GERA UMA LISTA; nada é
// apagado sem aprovação de uma pessoa da clínica e sem dry-run.
//
//   Job mensal (asSystemJob, por clínica): uma lista por clínica e mês, com contagens por categoria:
//     leads      lead sem paciente e sem interação há mais de 2 anos (com funil, tags e conversas dele)
//     fila       envios (automation_jobs, reactivation_sends) com mais de 1 ano
//     conversas  mensagens e atendimentos com mais de 5 anos
//     acessos    registro de acesso ao prontuário com mais de 5 anos
//     solicitacoes pedidos do titular encerrados há mais de 5 anos
//     prontuario um item por paciente com TODOS os prazos vencidos (20 anos/21 anos, fiscal,
//                comercial, conversas). Só o DENTISTA da clínica aprova (Lei 13.787 art. 6º §§ 3º e 4º);
//                acao = 'devolver' quando o paciente pediu a devolução (§ 2º): não é eliminado, fica
//                aguardando a entrega.
//   Cada item guarda o "corte" (data-limite) do momento em que a lista foi gerada: a eliminação usa
//   esse corte, então nada que venceu depois entra sem nova lista.
//
// Rotas (admin ou dentista da clínica; sempre pelo tenant do usuário; super-admin não executa;
// prontuário: quem aprovou não executa):
//   GET  /api/lgpd/expurgo/listas · GET /api/lgpd/expurgo/listas/:id
//   POST /api/lgpd/expurgo/listas/gerar               (admin) gera a lista do mês agora
//   POST /api/lgpd/expurgo/itens/:id/aprovar          { aprovar: true|false }
//   POST /api/lgpd/expurgo/listas/:id/dry-run         conta o que sairia, sem apagar (obrigatório)
//   POST /api/lgpd/expurgo/listas/:id/executar        { frase: 'ELIMINAR' } só itens aprovados,
//        só se o dry-run tem menos de 1 hora e as aprovações não mudaram depois dele.
// Registro (Lei 13.787 art. 6º § 4º): quem aprovou cada item, quem executou, e o resultado por contagens.
import crypto from 'crypto';
import { __interno as lgpd } from './lgpd.mjs';
import { novoColetor, avisoBackups } from './lgpd-arquivos.mjs';

export const CATEGORIAS = ['leads', 'fila', 'conversas', 'acessos', 'solicitacoes', 'prontuario'];
const ANOS = { leads: 2, fila: 1, conversas: 5, acessos: 5, solicitacoes: 5, prontuario: 20 };
const DRY_RUN_VALIDADE_MIN = 60;
export const ALERTA_IDADE = 'Idade desconhecida: confira se o paciente era menor (guarda até os 21 anos) antes de aprovar.';
const MAX_PRONTUARIOS_POR_LISTA = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;
const CLINICO_COM_DATA = ['prontuarios', 'anamneses', 'odontogramas', 'procedimento_execucoes', 'tratamentos', 'exames', 'clinical_reports'];
const COLUNA_PACIENTE = { clinical_reports: 'patient_id' };

async function colunas(db) {
  const { rows } = await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
  const m = new Map();
  for (const r of rows) { if (!m.has(r.table_name)) m.set(r.table_name, new Set()); m.get(r.table_name).add(r.column_name); }
  return m;
}
const corteDe = (anos, agora = new Date()) => { const d = new Date(agora); d.setFullYear(d.getFullYear() - anos); return d; };

// Consultas de cada categoria em massa: [{ tabela, where, params }] na ordem de exclusão.
// leads usa a lista de ids calculada antes (filhas → lead).
async function planoCategoria(db, cols, tenantId, categoria, corte) {
  const tem = (t, ...c) => cols.has(t) && c.every(x => cols.get(t).has(x));
  if (categoria === 'fila') {
    const p = [];
    if (tem('automation_jobs', 'tenant_id', 'created_at')) {
      p.push({ tabela: 'automation_jobs', where: `tenant_id = $1 AND created_at < $2 AND COALESCE(status, '') NOT IN ('pending', 'processing', 'sending')`, params: [tenantId, corte] });
    }
    if (tem('reactivation_sends', 'tenant_id', 'created_at')) {
      p.push({ tabela: 'reactivation_sends', where: 'tenant_id = $1 AND created_at < $2', params: [tenantId, corte] });
    }
    return p;
  }
  if (categoria === 'conversas') {
    const p = [];
    if (tem('chat_messages', 'tenant_id')) {
      const col = cols.get('chat_messages').has('timestamp') ? 'COALESCE("timestamp", created_at)' : 'created_at';
      p.push({ tabela: 'chat_messages', where: `tenant_id = $1 AND ${col} < $2`, params: [tenantId, corte] });
    }
    for (const t of ['attendance_sessions', 'transfer_logs', 'satisfaction_ratings']) {
      if (tem(t, 'tenant_id', 'created_at')) p.push({ tabela: t, where: 'tenant_id = $1 AND created_at < $2', params: [tenantId, corte] });
    }
    return p;
  }
  if (categoria === 'acessos') {
    return tem('acessos_prontuario', 'tenant_id', 'em')
      ? [{ tabela: 'acessos_prontuario', where: 'tenant_id = $1 AND em < $2', params: [tenantId, corte] }] : [];
  }
  if (categoria === 'solicitacoes') {
    return tem('lgpd_solicitacoes', 'tenant_id', 'solicitado_em')
      ? [{ tabela: 'lgpd_solicitacoes', where: `tenant_id = $1 AND solicitado_em < $2 AND status <> 'aguardando_confirmacao'`, params: [tenantId, corte] }] : [];
  }
  if (categoria === 'leads') {
    if (!tem('crm_leads', 'tenant_id')) return [];
    const c = cols.get('crm_leads');
    const data = c.has('updated_at') ? 'COALESCE(l.updated_at, l.created_at)' : 'l.created_at';
    const conds = ['l.tenant_id = $1', `${data} < $2`];
    if (c.has('paciente_id')) conds.push('l.paciente_id IS NULL');
    if (tem('chat_messages', 'tenant_id', 'lead_id')) {
      const col = cols.get('chat_messages').has('timestamp') ? 'COALESCE(m."timestamp", m.created_at)' : 'm.created_at';
      // anti-join com o conjunto de leads com conversa recente (uma varredura, não uma por lead)
      conds.push(`l.id::text NOT IN (SELECT m.lead_id FROM chat_messages m WHERE m.tenant_id = $1 AND m.lead_id IS NOT NULL AND ${col} >= $2)`);
    }
    const { rows } = await db.query(`SELECT l.id::text AS id FROM crm_leads l WHERE ${conds.join(' AND ')}`, [tenantId, corte]);
    const ids = rows.map(r => r.id);
    if (!ids.length) return [];
    const p = [];
    for (const t of ['kanban_movements', 'chat_read_status', 'lead_tag_assignments', 'satisfaction_ratings', 'transfer_logs', 'attendance_sessions', 'chat_messages']) {
      if (tem(t, 'tenant_id', 'lead_id')) p.push({ tabela: t, where: 'tenant_id = $1 AND lead_id::text = ANY($2::text[])', params: [tenantId, ids], filha: true });
    }
    // tag_assignments não tem tenant_id: só pelos ids de lead já filtrados pela clínica.
    if (tem('tag_assignments', 'lead_id')) p.push({ tabela: 'tag_assignments', where: 'lead_id::text = ANY($1::text[])', params: [ids], filha: true });
    p.push({ tabela: 'crm_leads', where: 'tenant_id = $1 AND id::text = ANY($2::text[])', params: [tenantId, ids] });
    return p;
  }
  return [];
}

async function contarPlano(db, plano) {
  const porTabela = {};
  let principal = 0;
  for (const p of plano) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${q(p.tabela)} WHERE ${p.where}`, p.params);
    const n = rows[0]?.n || 0;
    if (n) porTabela[p.tabela] = (porTabela[p.tabela] || 0) + n;
    if (!p.filha) principal += n;
  }
  return { principal, porTabela };
}

// Pacientes com todos os prazos vencidos (checagem final pela mesma regra do pedido do titular).
async function candidatosProntuario(db, cols, tenantId, agora = new Date()) {
  if (!cols.has('pacientes')) return [];
  const existentes = CLINICO_COM_DATA.filter(t => cols.has(t) && cols.get(t).has('tenant_id') && cols.get(t).has('created_at')
    && cols.get(t).has(COLUNA_PACIENTE[t] || 'paciente_id'));
  if (!existentes.length) return [];
  const corte = corteDe(ANOS.prontuario, agora);
  // Último registro clínico por paciente: uma agregação por tabela (GROUP BY), não uma subconsulta por paciente.
  const uniao = existentes.map(t =>
    `SELECT ${q(COLUNA_PACIENTE[t] || 'paciente_id')}::text AS pid, max(created_at) AS ultimo FROM ${q(t)} WHERE tenant_id = $1 GROUP BY 1`);
  const nasc = cols.get('pacientes').has('data_nascimento') ? `AND (p.data_nascimento IS NULL OR p.data_nascimento + INTERVAL '21 years' < $3)` : '';
  const { rows } = await db.query(
    `SELECT p.id, u.ultimo
       FROM (SELECT pid, max(ultimo) AS ultimo FROM (${uniao.join(' UNION ALL ')}) x GROUP BY pid) u
       JOIN pacientes p ON p.id::text = u.pid AND p.tenant_id = $1
      WHERE u.ultimo < $2 ${nasc}
      ORDER BY u.ultimo LIMIT ${MAX_PRONTUARIOS_POR_LISTA}`,
    nasc ? [tenantId, corte, agora] : [tenantId, corte]);
  const saida = [];
  for (const r of rows) {
    const { rows: pac } = await db.query('SELECT * FROM pacientes WHERE id = $1 AND tenant_id = $2', [r.id, tenantId]);
    if (!pac[0]) continue;
    const prev = await lgpd.previa(db, tenantId, pac[0]);
    const rt = prev.retencao;
    if (rt.prontuario_em_vigor || rt.fiscal_em_vigor || rt.comercial_em_vigor || rt.conversas_em_vigor || prev.sem_regra_com_dados.length) continue;
    let acao = 'eliminar';
    if (cols.get('lgpd_solicitacoes')?.has('ao_fim_do_prazo')) {
      const { rows: s } = await db.query(
        `SELECT ao_fim_do_prazo FROM lgpd_solicitacoes WHERE tenant_id = $1 AND paciente_id = $2 AND ao_fim_do_prazo IS NOT NULL
          ORDER BY solicitado_em DESC LIMIT 1`, [tenantId, String(r.id)]);
      if (s[0]?.ao_fim_do_prazo === 'devolver') acao = 'devolver';
    }
    const registros = Object.values(prev.grupos).reduce((a, g) => a + Object.values(g).reduce((x, y) => x + y, 0), 0);
    // Sem data de nascimento a regra dos 21 anos não pode ser conferida (parecer do #76).
    const alertas = pac[0].data_nascimento ? [] : ['idade_desconhecida'];
    saida.push({ paciente_id: String(r.id), prazo_ate: rt.prontuario_ate, acao, registros, alertas });
  }
  return saida;
}

// Gera (ou devolve) a lista do mês da clínica. Não apaga nada.
export async function gerarListaExpurgo(pool, tenantId, { agora = new Date() } = {}) {
  const competencia = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`;
  const { rows: ja } = await pool.query(
    'SELECT id FROM lgpd_expurgo_listas WHERE tenant_id = $1 AND competencia = $2', [tenantId, competencia]);
  if (ja[0]) return { id: ja[0].id, nova: false };
  const cols = await colunas(pool);
  const itens = [];
  for (const categoria of CATEGORIAS.filter(c => c !== 'prontuario')) {
    const corte = corteDe(ANOS[categoria], agora);
    const plano = await planoCategoria(pool, cols, tenantId, categoria, corte);
    const { principal, porTabela } = await contarPlano(pool, plano);
    if (principal > 0) itens.push({ categoria, referencia: null, quantidade: principal, detalhe: porTabela, corte, acao: 'eliminar' });
  }
  for (const c of await candidatosProntuario(pool, cols, tenantId, agora)) {
    itens.push({ categoria: 'prontuario', referencia: c.paciente_id, quantidade: c.registros,
      detalhe: c.alertas.length ? { alertas: c.alertas, alerta: ALERTA_IDADE } : null,
      corte: corteDe(ANOS.prontuario, agora), acao: c.acao, prazo_ate: c.prazo_ate });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO lgpd_expurgo_listas (tenant_id, competencia, resumo)
       VALUES ($1, $2, $3) ON CONFLICT (tenant_id, competencia) DO NOTHING RETURNING id`,
      [tenantId, competencia, JSON.stringify(Object.fromEntries(CATEGORIAS.map(c => [c, itens.filter(i => i.categoria === c).reduce((a, i) => a + i.quantidade, 0)])))]);
    if (!rows[0]) { await client.query('ROLLBACK'); return { id: null, nova: false }; }
    for (const i of itens) {
      await client.query(
        `INSERT INTO lgpd_expurgo_itens (lista_id, tenant_id, categoria, referencia, quantidade, detalhe, corte, acao, prazo_ate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [rows[0].id, tenantId, i.categoria, i.referencia, i.quantidade, i.detalhe ? JSON.stringify(i.detalhe) : null, i.corte, i.acao, i.prazo_ate || null]);
    }
    await client.query('COMMIT');
    return { id: rows[0].id, nova: true, itens: itens.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Job: roda todo dia; gera a lista do mês para cada clínica que ainda não tem. Só gera lista.
export async function processarExpurgoLgpd(pool) {
  try {
    const { rows: t } = await pool.query(`SELECT id FROM tenants WHERE COALESCE(status, 'active') IN ('active', 'trial')`);
    let novas = 0;
    for (const { id } of t) {
      try {
        const r = await gerarListaExpurgo(pool, id);
        if (r.nova) novas++;
      } catch (e) {
        if (e?.code === '42P01') { console.warn('[lgpd-expurgo] tabelas ausentes: rode migration-lgpd-expurgo.sql'); return; }
        console.error(`[lgpd-expurgo] clínica ${String(id).slice(0, 8)}:`, e.code || '', e.message);
      }
    }
    if (novas) console.log(`[lgpd-expurgo] ${novas} lista(s) de expurgo gerada(s) para revisão`);
  } catch (e) {
    console.error('[lgpd-expurgo] job:', e.message);
  }
}

const assinatura = (itens) => crypto.createHash('sha256')
  .update(itens.filter(i => i.aprovado).map(i => `${i.id}:${i.aprovado_em}`).sort().join('|')).digest('hex');

function erroHttp(res, err, tag) {
  if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
  if (err?.code === '42P01') return res.status(503).json({ error: 'Expurgo ainda não disponível: migração pendente' });
  console.error(`[lgpd-expurgo:${tag}]`, err.code || '', err.message);
  return res.status(500).json({ error: 'Erro interno' });
}

export function registerLgpdExpurgo(app, { pool, verifyUser, optOutKey, papelAtual }) {
  // Papel na clínica: admin (papel do banco nesta clínica — papelAtual, matriz #86; nunca o do JWT
  // nem user_roles de outra clínica) e/ou dentista (cadastro em dentistas VINCULADO ao
  // usuário por dentistas.user_id, na mesma clínica). Não por e-mail: o e-mail do perfil pode ser
  // trocado para o de um dentista (revisão do Igor, transversal). Sem a coluna user_id (criada pela
  // migration-ia-revisao-humana.sql / boot do #79) ninguém é dentista aqui: falha fechada.
  const papel = async (req) => {
    const { user } = await verifyUser(req);
    if (!user.tenant_id || user.is_super_admin) return { user, admin: false, dentistaId: null };
    const admin = (await papelAtual(user)) === 'admin';
    let dentistaId = null;
    if (user.id) {
      try {
        const { rows } = await pool.query(
          `SELECT id FROM dentistas WHERE tenant_id = $1 AND user_id = $2::uuid AND COALESCE(ativo, true) LIMIT 1`,
          [user.tenant_id, user.id]);
        dentistaId = rows[0]?.id || null;
      } catch (e) {
        if (e?.code !== '42703' && e?.code !== '22P02') throw e; // coluna ainda não criada / id inválido
      }
    }
    return { user, admin, dentistaId };
  };
  const exigePapel = async (req, res) => {
    const p = await papel(req);
    if (!p.admin && !p.dentistaId) { res.status(403).json({ error: 'Só o administrador ou um dentista da clínica' }); return null; }
    return p;
  };

  app.get('/api/lgpd/expurgo/listas', async (req, res) => {
    try {
      const p = await exigePapel(req, res); if (!p) return;
      const { rows } = await pool.query(
        `SELECT id, competencia, status, resumo, gerada_em, dry_run_em, executada_em, executada_por
           FROM lgpd_expurgo_listas WHERE tenant_id = $1 ORDER BY gerada_em DESC LIMIT 24`, [p.user.tenant_id]);
      res.json({ listas: rows, pode_aprovar_prontuario: !!p.dentistaId, admin: p.admin });
    } catch (e) { erroHttp(res, e, 'listas'); }
  });

  app.get('/api/lgpd/expurgo/listas/:id', async (req, res) => {
    try {
      const p = await exigePapel(req, res); if (!p) return;
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Lista não encontrada' });
      const { rows: l } = await pool.query('SELECT * FROM lgpd_expurgo_listas WHERE id = $1 AND tenant_id = $2', [req.params.id, p.user.tenant_id]);
      if (!l[0]) return res.status(404).json({ error: 'Lista não encontrada' });
      const { rows: itens } = await pool.query(
        `SELECT id, categoria, referencia, quantidade, detalhe, corte, acao, prazo_ate, aprovado, aprovado_por, aprovado_papel, aprovado_em,
                idade_confirmada_por, idade_confirmada_em, resultado
           FROM lgpd_expurgo_itens WHERE lista_id = $1 AND tenant_id = $2 ORDER BY categoria, id`, [req.params.id, p.user.tenant_id]);
      res.json({ lista: l[0], itens });
    } catch (e) { erroHttp(res, e, 'lista'); }
  });

  app.post('/api/lgpd/expurgo/listas/gerar', async (req, res) => {
    try {
      const p = await exigePapel(req, res); if (!p) return;
      if (!p.admin) return res.status(403).json({ error: 'Só o administrador gera a lista' });
      const r = await gerarListaExpurgo(pool, p.user.tenant_id);
      res.status(r.nova ? 201 : 200).json(r);
    } catch (e) { erroHttp(res, e, 'gerar'); }
  });

  app.post('/api/lgpd/expurgo/itens/:id/aprovar', async (req, res) => {
    try {
      const p = await exigePapel(req, res); if (!p) return;
      if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Item não encontrado' });
      const { rows } = await pool.query(
        `SELECT i.*, l.status AS lista_status FROM lgpd_expurgo_itens i JOIN lgpd_expurgo_listas l ON l.id = i.lista_id AND l.tenant_id = i.tenant_id
          WHERE i.id = $1 AND i.tenant_id = $2`, [req.params.id, p.user.tenant_id]);
      const item = rows[0];
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      if (item.lista_status !== 'pendente') return res.status(409).json({ error: `Lista ${item.lista_status}` });
      // Prontuário: só o dentista da clínica (Lei 13.787 art. 6º); o resto: admin.
      if (item.categoria === 'prontuario' && !p.dentistaId) return res.status(403).json({ error: 'Eliminação de prontuário só com aprovação de um dentista da clínica' });
      if (item.categoria !== 'prontuario' && !p.admin) return res.status(403).json({ error: 'Só o administrador aprova esta categoria' });
      const aprovar = req.body?.aprovar !== false;
      const alertas = item.detalhe?.alertas || [];
      if (aprovar && alertas.includes('idade_desconhecida') && req.body?.confirmo_idade !== true) {
        return res.status(422).json({ error: ALERTA_IDADE, alertas, exige: 'confirmo_idade' });
      }
      // Confirmação da idade (paciente sem data de nascimento) fica gravada: quem e quando.
      const confirmouIdade = aprovar && alertas.includes('idade_desconhecida');
      await pool.query(
        `UPDATE lgpd_expurgo_itens SET aprovado = $3, aprovado_por = $4, aprovado_papel = $5, dentista_id = $6, aprovado_em = NOW()
                ${confirmouIdade ? ', idade_confirmada_por = $4, idade_confirmada_em = NOW()' : ''}
          WHERE id = $1 AND tenant_id = $2`,
        [item.id, p.user.tenant_id, aprovar, p.user.id || null, item.categoria === 'prontuario' ? 'dentista' : 'admin',
         item.categoria === 'prontuario' ? p.dentistaId : null]);
      res.json({ success: true, aprovado: aprovar });
    } catch (e) { erroHttp(res, e, 'aprovar'); }
  });

  // Conta o que sairia com os itens aprovados (cortes gravados na lista). Não apaga nada.
  const simular = async (db, tenantId, itens) => {
    const cols = await colunas(db);
    const out = {};
    for (const i of itens.filter(x => x.aprovado)) {
      if (i.categoria === 'prontuario') {
        if (i.acao === 'devolver') { out[i.id] = { devolver: true }; continue; }
        const { rows: pac } = await db.query('SELECT * FROM pacientes WHERE id = $1 AND tenant_id = $2', [i.referencia, tenantId]);
        if (!pac[0]) { out[i.id] = { ausente: true }; continue; }
        const prev = await lgpd.previa(db, tenantId, pac[0]);
        const rt = prev.retencao;
        const vigente = rt.prontuario_em_vigor || rt.fiscal_em_vigor || rt.comercial_em_vigor || rt.conversas_em_vigor || prev.sem_regra_com_dados.length > 0;
        if (vigente) { out[i.id] = { retido: true }; continue; }
        const col = novoColetor();
        for (const a of prev._alvos.filter(x => x.registros && x.vinculo === 'paciente')) await col.coletar(db, a);
        out[i.id] = { porGrupo: prev.grupos, ...col.previa() };
        continue;
      }
      const plano = await planoCategoria(db, cols, tenantId, i.categoria, new Date(i.corte));
      const col = novoColetor();
      for (const pl of plano) await col.coletar(db, { ...pl, cols: cols.get(pl.tabela) });
      out[i.id] = { ...(await contarPlano(db, plano)).porTabela, ...col.previa() };
    }
    return out;
  };

  app.post('/api/lgpd/expurgo/listas/:id/dry-run', async (req, res) => {
    try {
      const p = await exigePapel(req, res); if (!p) return;
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Lista não encontrada' });
      const { rows: l } = await pool.query('SELECT * FROM lgpd_expurgo_listas WHERE id = $1 AND tenant_id = $2', [req.params.id, p.user.tenant_id]);
      if (!l[0]) return res.status(404).json({ error: 'Lista não encontrada' });
      if (l[0].status !== 'pendente') return res.status(409).json({ error: `Lista ${l[0].status}` });
      const { rows: itens } = await pool.query('SELECT * FROM lgpd_expurgo_itens WHERE lista_id = $1 AND tenant_id = $2', [l[0].id, p.user.tenant_id]);
      if (!itens.some(i => i.aprovado)) return res.status(409).json({ error: 'Nenhum item aprovado' });
      const resultado = await simular(pool, p.user.tenant_id, itens);
      await pool.query(
        `UPDATE lgpd_expurgo_listas SET dry_run = $3, dry_run_em = NOW(), dry_run_por = $4, dry_run_assinatura = $5
          WHERE id = $1 AND tenant_id = $2`,
        [l[0].id, p.user.tenant_id, JSON.stringify(resultado), p.user.id || null, assinatura(itens)]);
      res.json({ dry_run: resultado, valido_por_min: DRY_RUN_VALIDADE_MIN, frase: 'ELIMINAR' });
    } catch (e) { erroHttp(res, e, 'dry-run'); }
  });

  app.post('/api/lgpd/expurgo/listas/:id/executar', async (req, res) => {
    let client;
    try {
      const p = await exigePapel(req, res); if (!p) return;
      if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Lista não encontrada' });
      if (String(req.body?.frase || '').trim().toUpperCase() !== 'ELIMINAR') return res.status(422).json({ error: 'Digite ELIMINAR para confirmar' });
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '300s'");
      const { rows: l } = await client.query('SELECT * FROM lgpd_expurgo_listas WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.id, p.user.tenant_id]);
      const lista = l[0];
      if (!lista) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Lista não encontrada' }); }
      if (lista.status !== 'pendente') { await client.query('ROLLBACK'); return res.status(409).json({ error: `Lista ${lista.status}` }); }
      const { rows: itens } = await client.query('SELECT * FROM lgpd_expurgo_itens WHERE lista_id = $1 AND tenant_id = $2', [lista.id, p.user.tenant_id]);
      const aprovados = itens.filter(i => i.aprovado);
      if (!aprovados.length) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Nenhum item aprovado: nada foi apagado' }); }
      const recente = lista.dry_run_em && (Date.now() - new Date(lista.dry_run_em).getTime()) < DRY_RUN_VALIDADE_MIN * 60000;
      if (!recente || lista.dry_run_assinatura !== assinatura(itens)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Faça o dry-run de novo antes de eliminar (ausente, com mais de 1 hora ou as aprovações mudaram)' });
      }
      // Itens de prontuário aprovados por dentista; o resto, por admin (confere de novo).
      if (aprovados.some(i => (i.categoria === 'prontuario') !== (i.aprovado_papel === 'dentista'))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Aprovação inválida: prontuário exige dentista' });
      }
      // Duas pessoas para eliminar prontuário: quem executa não pode ser quem aprovou (revisão do Igor).
      if (aprovados.some(i => i.categoria === 'prontuario' && i.acao !== 'devolver'
          && i.aprovado_por && String(i.aprovado_por) === String(p.user.id))) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Eliminação de prontuário exige duas pessoas: quem aprovou não pode executar. Peça a outro administrador ou dentista da clínica.' });
      }
      const cols = await colunas(client);
      const resultado = {};
      const coletores = {};
      for (const i of aprovados) {
        const coletor = coletores[i.id] = novoColetor();
        if (i.categoria === 'prontuario') {
          if (i.acao === 'devolver') { resultado[i.id] = { aguardando_devolucao: true }; continue; }
          const { rows: pac } = await client.query('SELECT * FROM pacientes WHERE id = $1 AND tenant_id = $2', [i.referencia, p.user.tenant_id]);
          if (!pac[0]) { resultado[i.id] = { ausente: true }; continue; }
          const prev = await lgpd.previa(client, p.user.tenant_id, pac[0]);
          const r = await lgpd.eliminar(client, p.user.tenant_id, pac[0], 'excluir', prev, new Set(), { optOutKey, coletor });
          resultado[i.id] = { cadastro: r.cadastro, eliminados: r.eliminados };
          continue;
        }
        if (i.categoria === 'acessos') await client.query("SET LOCAL odonto.expurgo_acessos = 'on'");
        const plano = await planoCategoria(client, cols, p.user.tenant_id, i.categoria, new Date(i.corte));
        const porTabela = {};
        for (const pl of plano) {
          await coletor.coletar(client, { ...pl, cols: cols.get(pl.tabela) });
          const { rowCount } = await client.query(`DELETE FROM ${q(pl.tabela)} WHERE ${pl.where}`, pl.params);
          if (rowCount) porTabela[pl.tabela] = (porTabela[pl.tabela] || 0) + rowCount;
        }
        resultado[i.id] = porTabela;
      }
      for (const i of aprovados) {
        await client.query('UPDATE lgpd_expurgo_itens SET resultado = $3 WHERE id = $1 AND tenant_id = $2',
          [i.id, p.user.tenant_id, JSON.stringify(resultado[i.id] || {})]);
      }
      const backups = avisoBackups();
      await client.query(
        `UPDATE lgpd_expurgo_listas SET status = 'executada', executada_em = NOW(), executada_por = $3, resultado = $4
          WHERE id = $1 AND tenant_id = $2`,
        [lista.id, p.user.tenant_id, p.user.id || null, JSON.stringify({ itens: resultado, backups })]);
      await client.query('COMMIT');
      // Arquivos só depois do COMMIT; o resultado (apagados e não alcançados) vai para o registro.
      for (const i of aprovados) {
        const arquivos = await coletores[i.id].apagar(client);
        resultado[i.id] = { ...(resultado[i.id] || {}), arquivos };
        await pool.query('UPDATE lgpd_expurgo_itens SET resultado = $3 WHERE id = $1 AND tenant_id = $2',
          [i.id, p.user.tenant_id, JSON.stringify(resultado[i.id])]).catch(e => console.error('[lgpd-expurgo] registro de arquivos:', e.code || e.message));
      }
      await pool.query('UPDATE lgpd_expurgo_listas SET resultado = $3 WHERE id = $1 AND tenant_id = $2',
        [lista.id, p.user.tenant_id, JSON.stringify({ itens: resultado, backups })]).catch(e => console.error('[lgpd-expurgo] registro de arquivos:', e.code || e.message));
      res.json({ success: true, resultado, backups });
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (e?.code === '23503') return res.status(409).json({ error: `Há registros ligados em ${e.table || 'outra tabela'}: nada foi apagado.` });
      if (e?.code === '55P03') return res.status(503).json({ error: 'Banco ocupado: tente de novo. Nada foi apagado.' });
      erroHttp(res, e, 'executar');
    } finally {
      client?.release();
    }
  });
}
