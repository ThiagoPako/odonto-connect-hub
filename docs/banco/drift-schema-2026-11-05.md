# Deriva de schema: código × banco (2026-11-05)

Autora: **Renata** (banco). Migração: `vps-api-server/migration-schema-alinhamento.sql`.
Ferramenta: `docs/banco/auditar-colunas.mjs`.

## Como foi feito, e o que falta confirmar
- **Código:** `origin/main` @ `5492488b`, `server.mjs` + `clinicorp.mjs`. Os scripts avulsos
  (`test-*`, `fix-grants`, `create-super-admin`...) ficaram de fora. A extração das colunas é
  heurística: literais SQL, alias → tabela, listas de INSERT, `SET` do UPDATE e colunas soltas
  em consultas de uma tabela só. Cada item abaixo foi **confirmado lendo o código**.
- **Schema de comparação:** não conectei na produção. Minha regra é nunca conectar no banco de
  produção, e o pedido veio de agente, não do usuário. Comparei com um Postgres 16 local montado
  igual ao deploy: base do ensaio do #14, depois todas as `migration-*.sql` do `deploy.yml` de
  `main`, depois o boot do `server.mjs` de `main` (auto-migration e `ensure*`). Esse banco local
  **reproduz o problema relatado**: no boot aparece
  `Appointment reminder cron error: column a.paciente_nome does not exist`.
- **Para confirmar na produção** (só estrutura; quem roda é o Otávio ou o usuário):
  ```bash
  ssh odonto-vps "sudo -u postgres psql -p 5433 -d odonto_db -tA -F'|' -c \"select table_name, column_name, data_type from information_schema.columns where table_schema='public' order by 1,2\"" > schema-prod.txt
  node docs/banco/auditar-colunas.mjs schema-prod.txt        # lista tabelas/colunas ausentes com arquivo:linha
  ssh odonto-vps "sudo -u postgres psql -p 5433 -d odonto_db -tA -F'|' -c \"select c.relname, pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity, coalesce(string_agg(p.policyname||':'||p.cmd||':'||coalesce(p.qual,''), ' ; '),'-') from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' left join pg_policies p on p.schemaname='public' and p.tablename=c.relname where c.relkind='r' group by 1,2,3,4 order by 2,1\"" > rls-prod.txt
  ```
  Tudo o que é "ausente" abaixo vale para o banco montado pelo repositório. O que a produção tiver
  a mais (colunas criadas à mão ou por boots antigos) só aparece com o `schema-prod.txt`.

## 1. Colunas usadas e inexistentes

Ordenadas pelo impacto. "safe()" é o wrapper que engole o erro e devolve vazio: nesses casos não há
500, mas a tela mostra zero ou lista vazia.

| # | Coluna | Onde (`arquivo:linha`) | Efeito | Correção |
|---|---|---|---|---|
| 1 | `agendamentos.paciente_nome`, `dentista_nome` | `server.mjs:11762` (`processAppointmentReminders`), `server.mjs:5329` (PUT `/api/agenda/:id`), `server.mjs:7393`, `7403` (painel do dentista) | O lembrete de 24h falha em todo ciclo (reproduzido). O PUT dá 500 quando a tela manda `dentista_nome`. O painel do dentista fica vazio (safe) | Migração + PR #27 (grava os nomes do cadastro e corrige a saudação) |
| 2 | `agendamentos.sala` | `server.mjs:5176` (POST `/api/agenda`), `server.mjs:5248` (POST `/api/agenda/serie`), PUT `server.mjs:5327` | Se faltar na produção, **nenhum agendamento é criado** (INSERT com 500). Ausente no schema do repo; confirmar na produção | Migração |
| 3 | `crm_leads.cpf` | `server.mjs:12170` (POST `/api/crm/leads/:id/convert-to-patient`) | Converter lead em paciente dá 500 | Migração |
| 4 | `reactivation_rules.tenant_id`, `reactivation_sends.tenant_id` | `server.mjs:7676`, `7734`, `7776`, `7791`, `7804`, `7927`, `10724` | Módulo Reativação inteiro com 500 (listar, criar, editar, KPIs) e hook do job | Migração (também no M0 do #14) |
| 5 | `kanban_movements.tenant_id` | `server.mjs:12091` (PATCH `/stage`), `8057`, `10754`, `12290` (GET `/movements`) | O histórico do funil não é gravado (o erro é engolido pelo `.catch`) e o GET de movimentos dá 500 | Migração (também no M0) |
| 6 | `contatos.data_nascimento` | `server.mjs:11605` (`resolveCampaignAudience`, público "aniversariantes") | A campanha de aniversariantes falha | Migração (a coluna fica vazia até haver cadastro) |
| 7 | `crm_leads.follow_up_at`, `last_message`; `agendamentos.created_by` | `server.mjs:7286`, `7256` (GET `/api/comercial/painel`) | Follow-ups e "agendados hoje" do painel comercial em zero (safe) | Migração |
| 8 | `pacientes.alergias` | `server.mjs:7424` (painel do dentista, prontuários) | **Lista de prontuários vazia** (safe). O dado de alergia está em `anamneses` | **Código:** JOIN em `anamneses`. Coluna nova não, porque mostraria "sem alergia" |
| 9 | `orcamentos.valor_final`, `crm_leads.stage`, `pacientes.status`, `estoque.quantidade_atual` / `custo_unitario` | `server.mjs:6998`-`7003` (dashboard) | KPIs de orçamento, funil, pacientes ativos/inativos e estoque em zero (safe) | **Código:** `valor_total`, `kanban_stage`, `quantidade`, `valor_unitario`; `pacientes.status` não existe como conceito |
| 10 | `orcamentos.paciente_nome`, `prontuarios.paciente_nome`, `agendamentos.valor` | `server.mjs:7393`, `7413`, `7424` | Painel do dentista vazio (safe). O código já tem fallback para `p.nome` | Migração |
| 11 | `whatsapp_instances.updated_at` | `server.mjs:394` (`getTenantIdByInstance`) | A troca de clínica da instância vinda da nuvem falha (erro engolido) | Migração |
| 12 | `user_roles.tenant_id` | `server.mjs:315` (`validateRequestedTenantForUser`) | O segundo caminho de validação do cabeçalho de clínica falha e vira warn | Migração (também no M0) |

Falsos positivos da heurística (são aliases de agregação, não colunas): `total_sessions`, `avg_rating`,
`automation_jobs.total`, `automation_flows.sent`, `clinicorp_appointments.pid/name/n/mobile_phone`,
e palavras de texto (`criado`, `fechado`, `aprovado`, `encontrado`).

## 2. Tabelas usadas e inexistentes
| Tabela | Onde | Efeito | Correção |
|---|---|---|---|
| `financeiro_receitas`, `financeiro_despesas` | `clinicorp.mjs:1257`, `1271` (`projectFinanceToLocal`) | Os lançamentos do Clinicorp não chegam ao financeiro. A `migration-force-rls.sql` cita `financeiro_despesas` como "só no banco da VPS": confirmar | Migração (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN` das colunas usadas) |
| `password_reset_requests` | `server.mjs:2267`, `2290` | Se a rota forgot-password não conseguiu criá-la (Postgres 15+ sem permissão), as telas de pedidos de senha dão 500 | Migração (mesma definição do M0) |

## 3. Tipos incompatíveis
O `pg` não tem `setTypeParser` no backend: DATE e TIMESTAMPTZ chegam como `Date`, JSONB chega como
objeto, NUMERIC chega como string.

| `arquivo:linha` | Problema | Efeito |
|---|---|---|
| `server.mjs:5376` | `new Date(updated.data + 'T12:00:00')`, com `data` sendo `Date` | "Invalid Date" no aviso de reagendamento. Hoje não dispara porque `updated.telefone` não existe em `agendamentos` (o aviso é código morto; o PR #30 reescreve esse envio) |
| `server.mjs:14692` | `JSON.parse(r.prescricoes)` quando `prescricoes` é JSONB e não é array | Lança erro se houver objeto em vez de array |
| `server.mjs:11978` | `o.itens::jsonb` com `itens` já JSONB | Cast inútil, sem erro |
| demais `JSON.parse` (`10181`, `11143`, `11383`, `11619`, `11728`, `15217`) | Protegidos com `typeof === 'string'` | ok |
| `server.mjs:11788` | `appt.data` DATE → `toISOString()` | Correto com `TZ=America/Sao_Paulo` (o deploy fixa) |

## 4. RLS: dono, políticas e FORCE
- **No repositório:** a `migration-rls-enforcement.sql` (fora do `deploy.yml`, rodada à mão em algum
  momento) liga a RLS com a política `tenant_isolation_policy`
  (`is_super_admin() OR tenant_id = get_current_tenant_id()`) em 39 tabelas, `tenants`
  (`tenant_self_view`), `profiles`, `plans` e `system_settings` (leitura livre). A
  `migration-exames.sql` liga em `exames` e `exame_tipos`. Nenhuma delas faz FORCE.
- **Efeito do dono:** a RLS só vale para a API nas tabelas que **não** são dela. Nas 17 tabelas que
  têm o postgres como dono (relato do coordenador, não verifiquei), a política se aplica à API. Sem
  `app.jwt_payload`/`app.is_super_admin` na sessão (jobs, boot, login), `is_super_admin()` dá falso e
  `get_current_tenant_id()` dá NULL, então a consulta volta vazia. É isso que o PR #32 corrige.
  Nessas mesmas tabelas **o boot não consegue fazer `ALTER TABLE ... ADD COLUMN`** (só o dono pode),
  o que explica parte da deriva. Por isso a migração vai no deploy, como postgres, e não no boot.
  O PR #27 põe `paciente_nome` no boot: se `agendamentos` for do postgres, só esta migração resolve.
- **Lista por tabela na produção:** sai do comando `rls-prod.txt` acima. No banco local (que segue a
  premissa de API dona de tudo) só `exames`, `exame_tipos` e `consentimentos_pacientes` têm RLS
  ligada, nenhuma com FORCE.
- **Cuidado no #14 (M0):** o bloco que troca o dono para o da API vale para qualquer tabela da lista
  que tenha o postgres como dono, inclusive se ela já existia. Aqui a migração só troca o dono da
  tabela que ela mesma criou. Vou levar o mesmo ajuste ao M0.

## 5. A migração
`migration-schema-alinhamento.sql`: só `ADD COLUMN IF NOT EXISTS` (todas anuláveis, sem reescrever a
tabela) e `CREATE TABLE IF NOT EXISTS`, com `lock_timeout` de 5 s e uma transação. No `deploy.yml`
entra depois de `migration-contatos-recuperacao.sql`. Se falhar, o deploy mostra `::warning` e segue.
- Testada no banco local 2× sem erro, inclusive com `agendamentos` e `crm_leads` tendo o postgres como
  dono (esses donos não mudaram). Depois dela o boot não tem mais erro de coluna e o lembrete de 24h
  volta a enfileirar (com Evolution apontada para uma porta morta, sem envio real).
- **Ordem de merge:** **#27 antes ou junto.** Sem o #27, os lembretes voltam a sair com
  `paciente_nome` NULL, ou seja, "Olá, !" e "Equipe da clínica".
- Correções que são de código (itens 8 e 9 da seção 1 e a seção 3) ficam para o Marcos.
