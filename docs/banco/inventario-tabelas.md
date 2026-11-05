# Inventário de tabelas × isolamento por clínica — 2026-11-05

Feito por **Renata** (banco) lendo o código da branch `claude/force-rls-fc3fd7` (base `main` 910c63a).
**É o que o código diz, não o banco real.** O banco da VPS tem tabelas criadas por versões antigas do
boot que não estão mais no repositório (removidas no commit c36b69d, do Lovable) e migrações que não
estão no `deploy.yml` (rodadas à mão ou nunca). Antes da virada, rode `docs/banco/diagnostico-rls.sql`
na VPS e compare com esta tabela.

## Legenda
- **Onde é criada:** `boot` = lista de auto-migration do `server.mjs`; `boot antigo` = criada por um
  boot de antes de c36b69d (existe no banco, o esquema não está mais no repo); `m-X` = `migration-X.sql`;
  `fase1` = `ensureWhatsAppQueueSchema` + `migration-whatsapp-fase1.sql`; `clinicorp.mjs` = `registerClinicorp`.
- **RE** = `migration-rls-enforcement.sql`. **Não está no `deploy.yml`**: não se sabe se rodou. Ele
  adiciona `tenant_id`, índice e política em 39 tabelas. Onde a coluna diz "só se RE rodou", o código
  sozinho não garante a coluna.
- **Política hoje:** `boot-apply` = `tenant_isolation_policy` do `apply_tenant_rls` (com `NO FORCE`
  e `current_setting(...)::uuid`, **que dá erro com valor vazio**; a migração nova remove essa política).
  Hoje **nenhuma política tem efeito**: a API é dona e nenhuma tabela tem `FORCE`.
- **Na migração:** o que P0 (`migration-seguranca-p0.sql`, PR #12), M0 (`migration-tenant-m0.sql`) e FORCE (`migration-force-rls.sql`) fazem juntos. Colunas e preenchimento ficam no P0 e no M0; a FORCE só aplica a RLS e aborta se faltar `tenant_id`. Divisão completa no relatório do ensaio. "FORCE" = política `rls_clinica_v1` + ENABLE +
  FORCE. Toda tabela que tiver `tenant_id` no banco recebe isso, inclusive as que não estão aqui.

## 1. Dados da clínica com `tenant_id` no código

| Tabela | Onde é criada | tenant_id | NOT NULL | Índice por tenant | Política hoje | Na migração |
|---|---|---|---|---|---|---|
| pacientes | boot, migration.sql | sim (boot, m-saas) | não | sim (m-saas) | boot-apply, RE | FORCE; remove a política com `::uuid` |
| dentistas | boot, migration.sql | sim | não | sim (m-saas; único por nome em m-clinicorp-multitenant) | boot-apply, RE | FORCE |
| agendamentos | boot, migration.sql | sim | não | sim (m-saas) | boot-apply, RE | FORCE; preenche pelo paciente |
| financeiro | boot, migration.sql | sim | não | sim (m-saas) | boot-apply, RE | FORCE |
| tratamentos | boot, migration.sql | sim | não | sim (m-saas) | boot-apply, RE | FORCE; preenche pelo paciente |
| estoque | boot, migration.sql | sim (boot) | não | só se RE rodou | boot-apply, RE | FORCE + índice |
| crm_leads | migration.sql (+ boot ALTER) | sim (ALTER no boot) | não | só se RE rodou | boot-apply, RE | FORCE + índice |
| orcamentos | boot, migration.sql | sim (boot; ALTER m-orcamentos-clinicorp) | não | só se RE rodou | RE | FORCE + índice; preenche pelo paciente |
| chat_messages | boot, m-chat-messages | sim | não | sim | boot-apply, RE; boot força `NO FORCE` | FORCE |
| chat_read_status | m-chat-messages | sim | não | sim | RE; boot força `NO FORCE` | FORCE; preenche pelo usuário/lead |
| attendance_sessions | boot, m-attendance-sessions | sim | não | sim (tenant, status, lead) | RE; boot força `NO FORCE` | FORCE |
| attendance_queues | boot, migration.sql | sim | não | sim | RE | FORCE |
| whatsapp_instances | boot | sim | não | não | boot-apply; boot força `NO FORCE` | FORCE + índice |
| whatsapp_opt_outs | fase1 | sim | **sim** | sim (PK tenant_id, phone_key) | nenhuma | FORCE |
| automation_jobs | boot antigo (+ fase1 ALTER) | sim (ALTER) | não | sim | nenhuma | FORCE; preenche pela instância |
| automation_flows | boot antigo (+ fase1 ALTER) | sim (ALTER) | não | não | nenhuma | FORCE + índice; preenche por `created_by` |
| broadcast_campaigns | boot antigo (+ fase1 ALTER) | sim (ALTER) | não | não | nenhuma | FORCE + índice; preenche por `created_by` |
| consentimentos_pacientes | boot | sim, DEFAULT do contexto | **sim** | sim (tenant, paciente, tipo) | `tenant_isolation_policy` (segura) | FORCE; a migração também cria a tabela |
| exames, exame_tipos | m-exames (não está no deploy.yml) | sim | não | sim | própria (compara texto, segura) | FORCE |
| profiles | migration.sql (+ ALTER boot, m-saas) | sim | não (super-admin fica NULL) | sim (m-saas) | boot-apply, RE | FORCE. Login lê sem contexto: funciona no modo transição |
| user_roles | boot, migration.sql | sim (boot) / não (migration.sql) | não | não | boot-apply | FORCE + índice; preenche pelo usuário |
| subscriptions, invoices | m-saas | sim | **sim** | sim | nenhuma | FORCE |
| clinicorp_clinics, _professionals, _chairs, _appointment_categories, _specialties, _patients, _appointments, _estimates, _evolutions, _documents | m-clinicorp, m-clinicorp-bidirectional (+ ALTER m-clinicorp-multitenant, fora do deploy.yml) | sim | sim, se m-clinicorp-multitenant rodou | PK (id, tenant_id) não começa por tenant; appointments/patients/professionals têm | nenhuma | FORCE + índice onde falta |
| clinicorp_financial_entries, clinicorp_monthly_summary | m-clinicorp (+ ALTER boot, m-finance-multitenant) | sim | não | único (source, …, tenant) não começa por tenant | nenhuma | FORCE + índice. ⚠ preenchimento antigo usou "primeiro admin": conferir |
| clinicorp_push_log, clinicorp_webhook_events, clinicorp_conflicts | m-clinicorp* (+ ALTER clinicorp.mjs) | sim (**TEXT** ou UUID) | não | push_log sim; os outros não | nenhuma | FORCE + índice (a política compara como texto se a coluna for TEXT) |
| financeiro_despesas, financeiro_receitas | **não está no repo** (usada com tenant_id em clinicorp.mjs) | sim (pelo uso) | ? | ? | ? | FORCE se existir com tenant_id (laço dinâmico) |

## 2. Dados da clínica que dependem de RE ter rodado (ou não têm `tenant_id` no código)

Sem RE, estas tabelas **não têm** `tenant_id`. A migração cria a coluna (nula, DEFAULT do contexto,
FK para `tenants`), o índice, preenche pela tabela-pai quando há regra clara e aplica FORCE.

| Tabela | Onde é criada | Pai usado para preencher | Observação |
|---|---|---|---|
| **procedimento_execucoes** | boot antigo | orçamento → paciente | **nunca teve `tenant_id`**; rotas em server.mjs:6475-6620 sem filtro |
| **assinaturas_eletronicas** | boot antigo | paciente → execução (`assinatura_id`) | **nunca teve `tenant_id`**; GET `/api/assinaturas/:id` por id |
| **procedimentos_catalogo_versoes** | boot antigo | procedimentos_catalogo | nunca teve `tenant_id` |
| procedimentos_catalogo | boot antigo | — | catálogo era global; registros antigos ficam sem clínica |
| agenda_marcadores | boot antigo | — | `UNIQUE(nome)` global: duas clínicas não criam o mesmo nome (já é assim hoje) |
| anamneses, odontogramas, prontuarios | migration.sql / m-full-audit | paciente | dado de saúde |
| clinical_reports, consultations | m-ai-settings / m-consultations | paciente (`patient_id`); consulta → relatório | transcrições (C3) |
| tratamento_etapas | m-full-audit | tratamento | |
| comissoes | migration.sql | tratamento → dentista | |
| estoque_movimentos | m-full-audit | estoque (`item_id`) | |
| kanban_movements, lead_tag_assignments, transfer_logs | m-crm-kanban / migration.sql | lead | |
| satisfaction_ratings | migration.sql | attendance_sessions | |
| lead_tags, contatos | migration.sql | — | sem pai: registros antigos ficam sem clínica |
| reactivation_rules, reactivation_sends | m-reativacao | `created_by` → profiles; regra/paciente | |
| meta_ads_accounts, _campaigns, _insights | m-meta-ads | conta → campanha | contas sem pai ficam sem clínica |
| fin_bank_accounts, fin_employees, fin_payrolls, fin_bills, fin_movements, fin_overdue | m-financeiro-modulos | conta bancária / funcionário / conta a pagar | contas e funcionários sem pai ficam sem clínica |
| user_preferences, push_subscriptions | m-user-preferences / m-push-subscriptions | usuário | |
| clinicorp_user_settings | m-clinicorp-user | usuário | webhook do Clinicorp procura pelo segredo sem contexto: funciona no modo transição |
| password_reset_requests | rota `forgot-password` (agora a migração cria) | usuário | pedidos novos entram sem clínica até o INSERT gravar `tenant_id` (pendência) |

## 3. Globais (sem `tenant_id`; a migração não aplica RLS)

| Tabela | Onde é criada | Situação |
|---|---|---|
| tenants | m-saas | é a própria clínica: política por `id` + FORCE |
| plans | m-saas | global de propósito. Tinha RLS só de leitura (RE): a migração libera escrita para super-admin |
| system_settings | m-system-settings | global hoje, mas a rota de follow-up (server.mjs:9778) grava configuração de uma clínica para todas. Escrita liberada para não quebrar |
| app_settings | migration.sql | **global por engano**: `attendance_settings`, `solution_hours`, avaliação — uma clínica muda para todas |
| ai_settings | m-ai-settings | **A1**: chave de IA global |
| clinica_config | boot antigo | **A2**: linha única (`CHECK id = 1`) para todas as clínicas |
| clinicorp_settings | m-clinicorp | legado (substituída por clinicorp_user_settings) |
| clinicorp_local_overrides, clinicorp_override_history | boot antigo | deveriam ser por clínica; código não filtra |
| system_logs | ? (só INSERT em server.mjs:12804) | log global |
| tags, tag_assignments, clinicorp_user_credentials | boot antigo / só citadas | aparentemente sem uso |

As globais marcadas "por engano" precisam de mudança de código (tornar por clínica) antes de ganharem RLS.
Se a migração aplicasse RLS nelas agora, a linha única ficaria sem clínica e sumiria no modo estrito.

## Achados

| Tabela/consulta | Arquivo:linha | Problema | Impacto | Correção |
|---|---|---|---|---|
| todas | server.mjs:15187-15191, 15332-15350 | boot faz `NO FORCE` e a API é dona | RLS sem efeito (C1) | `migration-force-rls.sql` + `PG_USER=odonto_app` |
| política do boot | server.mjs:15336-15343 | `current_setting('app.current_tenant_id', true)::uuid`; o valor fica `''` na conexão depois de uma requisição | com a API não dona, **jobs e consultas sem contexto dariam erro** em 11 tabelas | a migração remove essa política (a nova já cobre) |
| forgot-password | server.mjs:2171 (antes) | `CREATE TABLE IF NOT EXISTS` dentro da rota | no Postgres 15+ falha para quem não é dono → "esqueci a senha" quebraria | removido; a tabela vem da migração |
| boot inteiro | server.mjs:15072-15420, 10468, clinicorp.mjs:2214 | DDL roda com o usuário da API | como odonto_app vira centenas de avisos e **mudança de esquema nova pelo boot deixa de aplicar** | esquema novo só por `migration-*.sql` no deploy.yml, ou pool de migração separado (pendência) |
| procedimento_execucoes, assinaturas_eletronicas | server.mjs:6475-6625 | sem `tenant_id` e rotas por id sem dono | assinatura/execução de outra clínica | migração cria a coluna; rotas precisam filtrar (Marcos) |
| m-rls-enforcement, m-exames, m-clinicorp-multitenant, m-financeiro-modulos... | .github/workflows/deploy.yml:111-124 | não estão na lista do deploy | banco pode não ter a coluna/política que o código supõe | diagnóstico na VPS; Otávio decide incluir |
| clinicorp_financial_entries, orcamentos, clinicorp_* | m-finance-multitenant, m-orcamentos-clinicorp, m-clinicorp-multitenant | preenchimento com "primeiro admin" / tenant fixo | dado de uma clínica pode ter ido para outra | conferir na VPS com a clínica dona da credencial Clinicorp |
