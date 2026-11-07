# Deriva de schema: código × banco (2026-11-05)

Autora: **Renata** (banco). Migração: `vps-api-server/migration-schema-alinhamento.sql`.
Ferramenta: `docs/banco/auditar-colunas.mjs`.

## Como foi feito
- **Código:** `origin/main` @ `5492488b`, `server.mjs` + `clinicorp.mjs`, mais o `server.mjs` do PR #33
  (exames). Os scripts avulsos (`test-*`, `fix-grants`...) ficaram de fora. A extração é heurística
  (literais SQL, alias → tabela, INSERT, `SET`, colunas soltas em consulta de uma tabela) e cada item
  abaixo foi confirmado lendo o código.
- **Schema de produção:** a conversa principal leu só a estrutura (`table_name, column_name,
  data_type`, 1.009 linhas) e o coordenador passou o arquivo. Eu não conectei na produção.
  Para repetir:
  ```bash
  ssh odonto-vps "sudo -u postgres psql -p 5433 -d odonto_db -tA -F'|' -c \"select table_name, column_name, data_type from information_schema.columns where table_schema='public' order by 1,2\"" > schema-prod.txt
  node docs/banco/auditar-colunas.mjs schema-prod.txt
  ```
- **Teste:** montei uma réplica só de estrutura a partir desse arquivo (mesmas tabelas, colunas e
  tipos; o postgres como dono de `tenants`). A migração rodou 2× sem erro. Depois dela, a ferramenta
  não acha **nenhuma tabela ausente**, e as colunas que sobram são só falsos positivos ou correções
  de código (seção 3).

## 1. O que falta em produção e a migração cria

Ordem por impacto. "safe()" é o wrapper que engole o erro: não há 500, mas a tela mostra zero ou
lista vazia.

| # | Falta em produção | Onde (`arquivo:linha`) | Efeito |
|---|---|---|---|
| 1 | `tenants.termos_versao`, `politica_versao`, `termos_aceitos_em`, `termos_aceite_ip` | `server.mjs:1192` (POST `/api/auth/signup-clinic`) | **O cadastro de clínica nova falha.** O boot tenta criar as colunas (`server.mjs:16248`), mas `tenants` tem o postgres como dono |
| 2 | Tabelas `exames` e `exame_tipos` | `server.mjs:15733`-`15960` (todas as rotas `/api/exame-tipos` e `/api/exames`) | **Módulo de exames/radiologia inteiro dá 500.** A `migration-exames.sql` nunca entrou no `deploy.yml` |
| 3 | `agendamentos.paciente_nome`, `dentista_nome` | `server.mjs:11762` (lembrete 24h), `:5329` (PUT `/api/agenda/:id`), `:7393`, `:7403` (painel do dentista) | O lembrete falha em todo ciclo, o PUT dá 500 e o painel do dentista fica vazio (safe) |
| 4 | `crm_leads.cpf` | `server.mjs:12170` (POST `/api/crm/leads/:id/convert-to-patient`) | Converter lead em paciente dá 500 |
| 5 | `clinicorp_monthly_summary.tenant_id` (e o índice único do upsert) | `clinicorp.mjs:1207` (`upsertMonthlySummary`), `:2099` (reconciliação) | O resumo financeiro mensal do Clinicorp não grava |
| 6 | `clinicorp_push_log.tenant_id` | `clinicorp.mjs:1860`, `server.mjs:15597` (POST `/api/clinicorp/my-settings/test`) | O log de envio ao Clinicorp falha, e com ele o teste de configuração |
| 7 | Tabelas `financeiro_receitas`, `financeiro_despesas` | `clinicorp.mjs:1257`, `:1271` (`projectFinanceToLocal`) | Os lançamentos do Clinicorp não chegam ao financeiro |
| 8 | `contatos.data_nascimento` | `server.mjs:11605` (público "aniversariantes" das campanhas) | A campanha de aniversariantes falha |
| 9 | `crm_leads.follow_up_at`, `last_message`; `agendamentos.created_by` | `server.mjs:7286`, `:7256` (GET `/api/comercial/painel`) | Painel comercial zerado (safe) |
| 10 | `user_roles.tenant_id` | `server.mjs:315` (`validateRequestedTenantForUser`) | O segundo caminho de validação do cabeçalho de clínica falha e vira warn |
| 11 | `whatsapp_instances.updated_at` | `server.mjs:394` (`getTenantIdByInstance`) | A troca de clínica da instância vinda da nuvem falha (erro engolido) |
| 12 | `orcamentos.paciente_nome`, `prontuarios.paciente_nome`, `agendamentos.valor` | `server.mjs:7393`, `:7413`, `:7424` | Painel do dentista vazio (safe). O código já tem fallback para `p.nome` |

**Exames: o schema bate com o código.** As colunas são as da `migration-exames.sql`, conferidas contra
`main` e contra o `server.mjs` do PR #33 (Marcos): nenhuma coluna de exames falta. Diferenças em
relação ao arquivo antigo:
- `tenant_id NOT NULL DEFAULT get_current_tenant_id()`, porque as rotas sempre gravam o tenant;
- índice de paciente começando por `tenant_id`;
- trigger criado só se não existir (sem `DROP TRIGGER`);
- **sem as políticas e sem o seed de preços**: o catálogo começa vazio e cada clínica cadastra os
  próprios tipos. A RLS fica com a `migration-force-rls.sql` (#14), que pega toda tabela com `tenant_id`.

Se o Marcos precisar de coluna nova no módulo, ela entra neste arquivo como `ADD COLUMN IF NOT EXISTS`.

## 2. Conferido em produção: já existe (no #39 vira no-op)
`agendamentos.sala` (fora do top 10), `kanban_movements.tenant_id`, `reactivation_rules.tenant_id`,
`reactivation_sends.tenant_id`, `password_reset_requests`, `clinicorp_webhook_events.tenant_id`,
`clinicorp_conflicts.tenant_id`, `clinicorp_user_settings.sync_progress`.
**`assinaturas_eletronicas.consentimento_texto` existe** em produção. Era falso positivo da ferramenta:
`consentimento_texto${withTenant ? ...}` em `server.mjs:6847` virou "consentimento_texto $x". Já corrigi
a ferramenta.

## 3. O que sobra e não é coluna faltando
**Correção de código, não de banco** (para o Marcos):

| `arquivo:linha` | Problema | Correção |
|---|---|---|
| `server.mjs:7424` | `p.alergias`: o dado está em `anamneses`. A lista de prontuários do painel do dentista fica vazia | JOIN em `anamneses`. Não criei coluna: uma coluna vazia mostraria "sem alergia" |
| `server.mjs:6998`-`7003` | `orcamentos.valor_final`, `crm_leads.stage`, `pacientes.status`, `estoque.quantidade_atual` / `custo_unitario`: KPIs do dashboard zerados | Trocar por `valor_total`, `kanban_stage`, `quantidade`, `valor_unitario`. "Status do paciente" não existe |
| `server.mjs:5376` | `new Date(updated.data + 'T12:00:00')` com `data` sendo `Date` dá "Invalid Date". Hoje não dispara: `updated.telefone` não existe em agendamentos | O PR #30 mexe nesse trecho |
| `server.mjs:14692` | `JSON.parse(r.prescricoes)` com JSONB que não é array | Usar o valor como já vem (objeto) |
| `server.mjs:7393`-`7424` | O painel do dentista filtra só por `dentista_id`, sem `tenant_id` (para o Igor) | Somar `AND a.tenant_id = $n` |

**Falsos positivos da heurística:** aliases de agregação (`total_sessions`, `avg_rating`,
`automation_jobs.total`, `automation_flows.sent`, `clinicorp_appointments.pid/name/n/mobile_phone`),
palavras de texto (`criado`, `fechado`, `aprovado`, `encontrado`), `crm_leads.lead_tags` (é tabela) e
`tenants.tenant_id` (é `tenant_settings`, dentro do CTE em `server.mjs:11050`).

**Tipos:** DATE e TIMESTAMPTZ chegam como `Date` (não há `setTypeParser`), e JSONB chega como objeto.
Os demais `JSON.parse` estão protegidos com `typeof === 'string'`. `server.mjs:11788` (lembrete) trata
a data corretamente com `TZ=America/Sao_Paulo`.

## 4. RLS: dono, políticas e FORCE
- A `migration-rls-enforcement.sql` (fora do deploy, rodada à mão) põe a política
  `tenant_isolation_policy` (`is_super_admin() OR tenant_id = get_current_tenant_id()`) em 39 tabelas,
  além de `tenants`, `profiles`, `plans` e `system_settings`. Não faz FORCE.
- Nas 17 tabelas que têm o postgres como dono (relato do coordenador; a lista por tabela sai da consulta
  abaixo), a RLS vale para a API. Sem contexto na sessão, a consulta volta vazia; o PR #32 corrige isso.
- **Nessas tabelas o boot não consegue rodar `ALTER TABLE`**: essa é a causa dos itens 1, 5 e 6. Por isso
  a migração vai no deploy, como postgres. Ela só troca o dono da tabela que ela mesma criou; o que já
  existia fica como está.
- Dono, RLS, FORCE e políticas por tabela na produção (só leitura de catálogo):
  ```bash
  ssh odonto-vps "sudo -u postgres psql -p 5433 -d odonto_db -tA -F'|' -c \"select c.relname, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity, coalesce(string_agg(p.policyname||':'||p.cmd, ' ; '),'-') from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' left join pg_policies p on p.schemaname='public' and p.tablename=c.relname where c.relkind='r' group by 1,2,3,4 order by 2,1\""
  ```
- As tabelas novas (`exames` e as demais) são criadas sem política. Se o dono da API for o postgres,
  elas ficam com o postgres como dono e sem RLS ligada, ou seja, só o filtro da query isola as clínicas
  (o que as rotas já fazem).

## 5. A migração
- `migration-schema-alinhamento.sql`: só `ADD COLUMN IF NOT EXISTS` (colunas anuláveis),
  `CREATE TABLE IF NOT EXISTS`, índices das tabelas novas e o índice único do upsert do Clinicorp. Se
  houver linha duplicada, esse índice só gera um aviso e não derruba o resto.
- Uma transação, `lock_timeout` de 5 s. No `deploy.yml` entra depois de
  `migration-contatos-recuperacao.sql`; se falhar, o deploy mostra `::warning` e segue.
- **Ordem de merge: #27 antes ou junto.** Sem o #27, o lembrete de 24h volta a sair com
  `paciente_nome` NULL ("Olá, !").
