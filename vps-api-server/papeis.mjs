// Papel do usuário dentro da clínica, lido do banco (não do JWT), e middleware de checagem.
// Matriz e decisões: docs/seguranca/matriz-papeis.md.
//
// Por que do banco: o JWT vale 7 dias; um admin rebaixado ou um usuário desativado seguiria com
// o papel antigo até o token expirar. Aqui o papel atual vale em até 60 s (cache), ou na hora
// quando a rota de usuários chama limparCachePapel.

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
const cache = new Map(); // userId -> { papel, at }

export function limparCachePapel(userId) {
  if (userId === undefined) cache.clear();
  else cache.delete(String(userId));
}

// Papel atual do usuário na clínica, ou null (sem acesso: sem perfil, perfil inativo ou papel desconhecido).
// user_roles é a fonte principal (como no login); profiles.role é o fallback.
export async function papelAtual(pool, user) {
  if (!user?.id) return null;
  const chave = String(user.id);
  const hit = cache.get(chave);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.papel;
  const { rows } = await pool.query(
    `SELECT ur.role::text AS papel_ur, p.role::text AS papel_perfil, COALESCE(p.active, true) AS ativo
       FROM profiles p
       LEFT JOIN user_roles ur ON ur.user_id = p.id
      WHERE p.id = $1`,
    [user.id]
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
export function exigePapel(deps, ...permitidos) {
  const lista = permitidos.flat();
  return async (req, res, next) => {
    try {
      const { user } = await deps.verifyUser(req);
      const papel = await papelAtual(deps.pool, user);
      if (!papel || !lista.includes(papel)) {
        console.warn(`[papel] 403 ${req.method} ${req.route?.path || ''} papel=${papel || 'nenhum'}`);
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

// Só para testes (pool.query mockado): fixa o papel de um usuário no cache.
export function _definirPapelParaTestes(userId, papel) {
  cache.set(String(userId), { papel, at: Date.now() });
}
