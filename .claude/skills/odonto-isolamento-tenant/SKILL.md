---
name: odonto-isolamento-tenant
description: Use when writing, reviewing or auditing any backend endpoint, SQL query, job or WhatsApp instance handling in vps-api-server/server.mjs — anything where one clínica could read, change or send with another clínica's data (tenant_id, paciente/lead/instância por id na URL, super-admin, jobs em background, RLS).
---

# Isolamento entre clínicas (multi-tenant)

**Fato do projeto:** a RLS do Postgres **não protege** (tabelas `NO FORCE`, a app é dona delas).
O único isolamento real é o filtro explícito por `tenant_id` em cada query e a checagem de dono
de cada recurso. Vazamento entre clínicas = dado de saúde exposto (LGPD art. 11) — prioridade P0.

## Triagem automática (suspeitas, não provas)
```bash
node .claude/skills/odonto-isolamento-tenant/scripts/auditar-rotas.mjs            # rotas com alerta
node .claude/skills/odonto-isolamento-tenant/scripts/auditar-rotas.mjs --rota pacientes
```
Alertas: `SEM-AUTH`, `SQL-SEM-tenant_id`, `ID-NA-URL-SEM-DONO`, `INSTANCIA-SEM-userOwnsInstance`,
`getDefaultInstance(global)`, `TENANT-DO-CLIENTE`. Use `--contexto` para ver as linhas de SQL de
cada rota. Confirme cada um lendo o handler antes de reportar. O script **não** pega rota que tem
`tenant_id` mas grava id da URL sem validar o dono (ex.: INSERT com `req.params.id` de paciente) —
procure isso à mão.

Limites do script (leia "ok" como "nada suspeito pelas regras abaixo", não "verificado"):
- Rotas `/api/whatsapp/*` **não** recebem `INSTANCIA-SEM-userOwnsInstance`: o guarda global
  `app.use('/api/whatsapp', …)` (`server.mjs` ≈3539) já chama `userOwnsInstance`. Confira à mão só rotas
  fora desse prefixo e o próprio guarda (`WA_PATH_INSTANCE_ACTIONS`; o resto vem de `body.instance`/`query.instance`).
- `clinicorpUserOf(req)` conta como autenticação (rotas `/api/clinicorp/my-settings*`, `sync/now`).
- Heurísticas conhecidas: `tenant_id` em qualquer ponto do handler silencia os alertas de SQL; SQL em
  minúsculas não é detectado; rotas com array de paths, `router.*` e `app.use` (exceto o guarda acima) ficam fora.

## Padrão correto de endpoint
```js
app.put('/api/pacientes/:id', async (req, res) => {
  try {
    const { user } = await verifyUser(req);                 // ou verifyAdmin(req)
    if (!user.tenant_id) return res.status(403).json({ error: 'Sem tenant' });
    const { rowCount } = await pool.query(
      'UPDATE pacientes SET nome=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [req.body.nome, req.params.id, user.tenant_id]);       // dono na MESMA query
    if (!rowCount) return res.status(404).json({ error: 'Não encontrado' }); // 404, não 403: não revela existência
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    if (err.message === 'Admin access required') return res.status(403).json({ error: err.message });
    console.error('[pacientes:update]', err.message);       // sem dado do paciente no log
    res.status(500).json({ error: 'Erro interno' });
  }
});
```

## Recurso filho (anamnese, odontograma, histórico, execuções, consentimentos)
Tabela filha pode não ter `tenant_id` — valide o **pai** antes de ler/gravar:
```js
const { rows } = await pool.query('SELECT 1 FROM pacientes WHERE id=$1 AND tenant_id=$2', [req.params.id, user.tenant_id]);
if (!rows.length) return res.status(404).json({ error: 'Paciente não encontrado' });
// ...agora SELECT/INSERT/upsert na tabela filha; em JOIN, filtre também o lado juntado (d.tenant_id = $2)
```
Efeitos colaterais (Clinicorp `pushPatient`, envio de WhatsApp, webhook) só **depois** da checagem
de dono e de `rowCount > 0`.

## Checklist
- [ ] `verifyUser`/`verifyAdmin` no início; super-admin (`user.is_super_admin`) é separado de admin de clínica.
- [ ] Toda query de tabela da clínica tem `tenant_id = $n` vindo de `user.tenant_id` — **nunca** de `req.body/query` (só via `validateRequestedTenantForUser`).
- [ ] INSERT grava `tenant_id`; UPDATE/DELETE por id filtram `AND tenant_id`; JOIN também filtra o lado juntado.
- [ ] Instância WhatsApp do parâmetro: `userOwnsInstance(user, instance)` ou `getStrictInstanceOwner` antes de agir (logout, delete, restart, send-*, sync, connect).
- [ ] Jobs (`asSystemJob`, contexto super-admin): iterar **por tenant**, usar `getTenantDefaultInstance(tenantId)` — nunca `getDefaultInstance()` / "primeira instância aberta".
- [ ] Nada de dado de paciente em log, URL ou query string (JWT em query só onde já existe, SSE).
- [ ] Arquivos/mídia de paciente não servidos publicamente (`/uploads`).
- [ ] `catch` devolve 401 para `Unauthorized`, 403 para "Admin access required", 500 genérico para o resto (sem vazar SQL).
- [ ] Teste multi-tenant em `vps-api-server/tests/` quando o endpoint é novo (usuário da clínica A recebe 404 no recurso da B).

## Relatório (Igor/Beatriz)
Tabela por severidade (crítica = dado de saúde lido/alterado entre clínicas; alta = outro dado
entre clínicas; média = sem dono mas sem dado sensível; baixa = higiene): `arquivo:linha` · falha · cenário (clínica A faz X e obtém Y da clínica B) · impacto · correção ·
**confirmado** (li o código/testei) × **suspeito** (só o script apontou).
