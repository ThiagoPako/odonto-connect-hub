// Papel do usuário dentro da clínica, lido do banco (não do JWT), e middleware de checagem.
// Matriz e decisões: docs/seguranca/matriz-papeis.md.
//
// Por que do banco: o JWT vale 7 dias; um admin rebaixado ou um usuário desativado seguiria com
// o papel antigo até o token expirar. Aqui o papel atual vale em até 60 s (cache), ou na hora
// quando a rota de usuários chama limparCachePapel.
//
// Por clínica: o papel só vale na clínica do perfil (profiles.tenant_id). Se a requisição está
// em outra clínica (ex.: super-admin com x-tenant-id), não há papel ali → sem acesso. user_roles
// não tem tenant_id em produção, então o vínculo com a clínica vem do perfil.

// Papéis que existem no enum app_role em produção. 'comercial' não existe (decisão do dono).
export const PAPEIS = ['admin', 'dentista', 'recepcionista', 'user'];
const PRIORIDADE = ['admin', 'dentista', 'recepcionista', 'user'];

// Grupos usados nas rotas.
export const PERMISSOES = {
  ADMIN: ['admin'],
  CLINICO: ['admin', 'dentista'],                       // prontuário, consultas, IA clínica, execução
  EQUIPE: ['admin', 'dentista', 'recepcionista'],       // leitura clínica básica, orçamentos, catálogo
};

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // `${userId}:${tenantId}` -> { papel, at }
const chaveDe = (userId, tenantId) => `${userId}:${tenantId || ''}`;

// Sem tenantId: limpa o usuário em todas as clínicas. Sem argumentos: limpa tudo.
export function limparCachePapel(userId, tenantId) {
  if (userId === undefined) return cache.clear();
  if (tenantId !== undefined) return cache.delete(chaveDe(userId, tenantId));
  const prefixo = `${userId}:`;
  for (const k of cache.keys()) if (k.startsWith(prefixo)) cache.delete(k);
}

// Papel atual do usuário na clínica da requisição, ou null (sem acesso: sem perfil nessa clínica,
// perfil inativo ou papel desconhecido). user_roles é a fonte principal (como no login);
// profiles.role é o fallback.
export async function papelAtual(pool, user) {
  if (!user?.id || !user?.tenant_id) return null;
  const chave = chaveDe(user.id, user.tenant_id);
  // A chave curinga '*' só existe nos testes (pool mockado); fora deles nunca é lida.
  const hit = cache.get(chave) || (process.env.NODE_ENV === 'test' ? cache.get(chaveDe(user.id, '*')) : undefined);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.papel;
  const { rows } = await pool.query(
    `SELECT ur.role::text AS papel_ur, p.role::text AS papel_perfil, COALESCE(p.active, true) AS ativo
       FROM profiles p
       LEFT JOIN user_roles ur ON ur.user_id = p.id
      WHERE p.id = $1 AND p.tenant_id = $2`,
    [user.id, user.tenant_id]
  );
  let papel = null;
  if (rows.length && rows.every(r => r.ativo !== false)) {
    const candidatos = rows.map(r => r.papel_ur).filter(Boolean);
    if (!candidatos.length && rows[0].papel_perfil) candidatos.push(rows[0].papel_perfil);
    papel = PRIORIDADE.find(p => candidatos.includes(p)) || null;
  }
  cache.set(chave, { papel, at: Date.now() });
  return papel;
}

// Middleware: exigePapel({ pool, verifyUser }, 'admin', 'dentista').
// 401 sem login; 403 com mensagem fixa quando o papel não está na lista. O log não leva
// id de paciente nem parâmetros da URL (só método e caminho da rota).
// Super-admin: só passa na própria clínica (com o papel que tiver lá), a menos que a rota
// liste 'super_admin' (decisão 7, LGPD art. 37: nada de ler dado de clínica alheia sem registro).
export function exigePapel(deps, ...permitidos) {
  const lista = permitidos.flat();
  return async (req, res, next) => {
    try {
      const { user } = await deps.verifyUser(req);
      if (user.is_super_admin && lista.includes('super_admin')) {
        req.papel = 'super_admin';
        return next();
      }
      const papel = await papelAtual(deps.pool, user);
      if (!papel || !lista.includes(papel)) {
        console.warn(`[papel] 403 ${req.method} ${req.route?.path || ''} papel=${papel || 'nenhum'}${user.is_super_admin ? ' super_admin' : ''}`);
        return res.status(403).json({ error: 'Seu perfil não tem acesso a esta função' });
      }
      req.papel = papel;
      return next();
    } catch (err) {
      if (err?.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
      console.error('[papel] erro ao checar papel:', err?.message);
      return res.status(500).json({ error: 'Erro interno' });
    }
  };
}

// Só para testes (pool.query mockado): fixa o papel de um usuário no cache. Sem tenantId,
// vale para qualquer clínica (chave '*'), que só este helper grava.
export function _definirPapelParaTestes(userId, papel, tenantId = '*') {
  cache.set(chaveDe(userId, tenantId), { papel, at: Date.now() });
}
