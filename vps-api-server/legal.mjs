// Aceite de documentos legais (Termos de Uso, Política de Privacidade, modelos para a clínica).
// Pedido da Helena: a prova do aceite não pode ser sobrescrita. Antes ficava só em colunas de
// tenants (termos_versao, politica_versao, termos_aceitos_em, termos_aceite_ip), trocadas a cada
// aceite; elas continuam sendo gravadas por compatibilidade, mas a prova é aceites_documentos
// (uma linha por aceite, só inclusão) com o hash do texto aceito.
//
// Versões publicadas: documentos_legais_versoes (documento, versao, texto, hash_texto, avisado_em,
// vigente_em). Uma versão nova vale 30 dias depois do aviso; a partir daí o admin da clínica
// precisa aceitá-la (GET /api/legal/pendencias diz isso no primeiro login).
//
// Rotas:
//   GET  /api/legal/pendencias     qualquer usuário da clínica: o que falta aceitar e avisos de versão nova
//   POST /api/legal/aceites        admin da clínica: { documento, versao }
//   GET  /api/legal/aceites        admin da clínica: histórico de aceites da própria clínica
//   POST /api/legal/documentos     super-admin: publica versão { documento, versao, texto, dias_aviso? }
import crypto from 'crypto';

export const DOCUMENTOS = ['termos', 'politica', 'modelo_clinica'];
// Documentos que todo admin de clínica precisa ter aceitado na versão vigente.
export const DOCUMENTOS_OBRIGATORIOS = ['termos', 'politica'];
export const DIAS_AVISO_PADRAO = 30;
const VERSAO_RE = /^[0-9A-Za-z.\-]{1,20}$/;

export const hashTexto = (texto) => crypto.createHash('sha256').update(String(texto), 'utf8').digest('hex');
const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 64) || null;

// Grava um aceite. `db` pode ser um client em transação. Devolve a linha ou null se a versão não existe.
export async function registrarAceite(db, { tenantId, usuarioId, documento, versao, ip, userAgent }) {
  const { rows: v } = await db.query(
    'SELECT hash_texto FROM documentos_legais_versoes WHERE documento = $1 AND versao = $2', [documento, versao]);
  if (!v.length) return null;
  const { rows } = await db.query(
    `INSERT INTO aceites_documentos (tenant_id, usuario_id, documento, versao, hash_texto, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, documento, versao, hash_texto, aceito_em`,
    [tenantId, usuarioId || null, documento, versao, v[0].hash_texto || null, ip || null, userAgent ? String(userAgent).slice(0, 300) : null]);
  // Compatibilidade: as colunas antigas de tenants continuam com o último aceite.
  if (documento === 'termos' || documento === 'politica') {
    await db.query(
      `UPDATE tenants SET ${documento === 'termos' ? 'termos_versao' : 'politica_versao'} = $2,
              termos_aceitos_em = NOW(), termos_aceite_ip = $3
        WHERE id = $1`, [tenantId, versao, ip || null]);
  }
  return rows[0];
}

// No cadastro da clínica: dentro da transação do signup, com SAVEPOINT para que a falta da
// tabela (migração ainda não aplicada) não derrube o cadastro. As colunas de tenants já vêm no INSERT.
export async function registrarAceitesNoSignup(client, { tenantId, usuarioId, termosVersao, politicaVersao, ip, userAgent }) {
  const feitos = [];
  for (const [documento, versao] of [['termos', termosVersao], ['politica', politicaVersao]]) {
    if (!versao) continue;
    await client.query('SAVEPOINT aceite_documento');
    try {
      const { rows: v } = await client.query(
        'SELECT hash_texto FROM documentos_legais_versoes WHERE documento = $1 AND versao = $2', [documento, String(versao)]);
      await client.query(
        `INSERT INTO aceites_documentos (tenant_id, usuario_id, documento, versao, hash_texto, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, usuarioId, documento, String(versao), v[0]?.hash_texto || null, ip || null, userAgent ? String(userAgent).slice(0, 300) : null]);
      await client.query('RELEASE SAVEPOINT aceite_documento');
      feitos.push(documento);
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT aceite_documento');
      console.warn('[legal] aceite no cadastro não gravado em aceites_documentos:', e.code || e.message);
    }
  }
  return feitos;
}

// Pendências da clínica: para cada documento obrigatório, a versão vigente (vigente_em <= agora)
// mais recente; pendente se a clínica não tem aceite dela. Avisos: versão publicada que ainda não vale.
export async function pendenciasDaClinica(db, tenantId) {
  const { rows: versoes } = await db.query(
    `SELECT documento, versao, hash_texto, avisado_em, vigente_em
       FROM documentos_legais_versoes
      WHERE documento = ANY($1::text[])
      ORDER BY documento, vigente_em DESC`, [DOCUMENTOS_OBRIGATORIOS]);
  const { rows: aceites } = await db.query(
    `SELECT DISTINCT documento, versao FROM aceites_documentos WHERE tenant_id = $1 AND documento = ANY($2::text[])`,
    [tenantId, DOCUMENTOS_OBRIGATORIOS]);
  const aceito = new Set(aceites.map(a => `${a.documento}@${a.versao}`));
  const agora = new Date();
  const pendentes = [];
  const avisos = [];
  for (const doc of DOCUMENTOS_OBRIGATORIOS) {
    const doDoc = versoes.filter(v => v.documento === doc);
    const vigente = doDoc.find(v => new Date(v.vigente_em) <= agora);
    if (vigente && !aceito.has(`${doc}@${vigente.versao}`)) {
      pendentes.push({ documento: doc, versao: vigente.versao, vigente_em: vigente.vigente_em, hash_texto: vigente.hash_texto });
    }
    for (const futura of doDoc.filter(v => new Date(v.vigente_em) > agora)) {
      if (!aceito.has(`${doc}@${futura.versao}`)) {
        avisos.push({ documento: doc, versao: futura.versao, avisado_em: futura.avisado_em, vigente_em: futura.vigente_em });
      }
    }
  }
  return { pendentes, avisos };
}

function erroHttp(res, err, tag) {
  if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
  if (err.message === 'Admin access required') return res.status(403).json({ error: 'Só o administrador da clínica pode aceitar' });
  if (err.message === 'Super admin access required') return res.status(403).json({ error: 'Apenas super admin' });
  if (err?.code === '42P01') return res.status(503).json({ error: 'Aceites ainda não disponíveis: migração pendente' });
  console.error(`[legal:${tag}]`, err.code || '', err.message);
  return res.status(500).json({ error: 'Erro interno' });
}

export function registerLegal(app, { pool, verifyUser, verifyAdmin, verifySuperAdmin }) {
  app.get('/api/legal/pendencias', async (req, res) => {
    try {
      const { user } = await verifyUser(req);
      if (!user.tenant_id) return res.json({ pendentes: [], avisos: [], precisa_aceitar: false });
      const { pendentes, avisos } = await pendenciasDaClinica(pool, user.tenant_id);
      // Quem aceita pela clínica é o admin; os demais só veem o aviso.
      let ehAdmin = user.role === 'admin' && !user.is_super_admin;
      if (!ehAdmin && !user.is_super_admin) {
        const { rows } = await pool.query('SELECT 1 FROM user_roles WHERE user_id = $1 AND role = $2', [user.id, 'admin']);
        ehAdmin = rows.length > 0;
      }
      res.json({ pendentes, avisos, precisa_aceitar: ehAdmin && pendentes.length > 0, pode_aceitar: ehAdmin });
    } catch (err) { erroHttp(res, err, 'pendencias'); }
  });

  app.post('/api/legal/aceites', async (req, res) => {
    let client;
    try {
      const { user } = await verifyAdmin(req);
      // Aceite é ato da clínica: super-admin da plataforma não aceita por ela.
      if (user.is_super_admin) return res.status(403).json({ error: 'Só o administrador da clínica pode aceitar' });
      if (!user.tenant_id) return res.status(403).json({ error: 'Sem clínica vinculada' });
      const { documento, versao } = req.body || {};
      if (!DOCUMENTOS.includes(documento)) return res.status(400).json({ error: `documento deve ser ${DOCUMENTOS.join(', ')}` });
      if (!VERSAO_RE.test(String(versao || ''))) return res.status(400).json({ error: 'versao inválida' });
      client = await pool.connect();
      await client.query('BEGIN');
      const aceite = await registrarAceite(client, {
        tenantId: user.tenant_id, usuarioId: user.id, documento, versao: String(versao),
        ip: ipDe(req), userAgent: req.headers['user-agent'],
      });
      if (!aceite) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Versão do documento não publicada' }); }
      await client.query('COMMIT');
      res.status(201).json({ aceite });
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      erroHttp(res, err, 'aceitar');
    } finally {
      client?.release();
    }
  });

  app.get('/api/legal/aceites', async (req, res) => {
    try {
      const { user } = await verifyAdmin(req);
      if (!user.tenant_id) return res.status(403).json({ error: 'Sem clínica vinculada' });
      const { rows } = await pool.query(
        `SELECT a.id, a.documento, a.versao, a.hash_texto, a.aceito_em, a.usuario_id, p.name AS usuario_nome
           FROM aceites_documentos a
           LEFT JOIN profiles p ON p.id = a.usuario_id AND p.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 ORDER BY a.aceito_em DESC LIMIT 500`, [user.tenant_id]);
      res.json(rows);
    } catch (err) { erroHttp(res, err, 'historico'); }
  });

  app.post('/api/legal/documentos', async (req, res) => {
    try {
      await verifySuperAdmin(req);
      const { documento, versao, texto } = req.body || {};
      if (!DOCUMENTOS.includes(documento)) return res.status(400).json({ error: `documento deve ser ${DOCUMENTOS.join(', ')}` });
      if (!VERSAO_RE.test(String(versao || ''))) return res.status(400).json({ error: 'versao inválida' });
      if (!texto || String(texto).trim().length < 20) return res.status(400).json({ error: 'texto do documento obrigatório' });
      // Mínimo de 30 dias entre o aviso e a vigência (pode ser mais).
      const dias = Math.max(DIAS_AVISO_PADRAO, Number.parseInt(req.body?.dias_aviso, 10) || DIAS_AVISO_PADRAO);
      const { rows, rowCount } = await pool.query(
        `INSERT INTO documentos_legais_versoes (documento, versao, texto, hash_texto, avisado_em, vigente_em)
         VALUES ($1, $2, $3, $4, NOW(), NOW() + ($5 || ' days')::interval)
         ON CONFLICT (documento, versao) DO NOTHING
         RETURNING documento, versao, hash_texto, avisado_em, vigente_em`,
        [documento, String(versao), String(texto), hashTexto(texto), String(dias)]);
      if (!rowCount) return res.status(409).json({ error: 'Versão já publicada (não pode ser alterada)' });
      res.status(201).json({ versao: rows[0] });
    } catch (err) { erroHttp(res, err, 'publicar'); }
  });
}
