# Auditoria de índices: uso em produção (2026-11-05)

Autora: **Renata** (banco). Fonte: `pg_stat_user_indexes` de produção (só nomes, contagens e tamanhos), lido pelo coordenador, cruzado com as definições (`pg_indexes`). Documentação apenas: **nenhum índice é removido neste PR.**

De 279 índices, **152 têm `idx_scan = 0`** desde o último reset das estatísticas. Zero desde o reset não prova que o índice é inútil: rotina mensal, sincronização e recurso ainda não ativo podem não ter rodado nesse intervalo.

## 1. Candidatos seguros a remoção futura (12)

São duplicados exatos (mesmas colunas e predicado de outro índice que continua) ou prefixos de outro índice, que atende as mesmas buscas. Removendo, sempre sobra um índice começando por `tenant_id` na tabela, para a cascata de `tenants` e para a RLS.

| Tabela | Índice | Tamanho | Motivo |
|---|---|---|---|
| `agendamentos` | `agendamentos_tenant_idx` | 48 kB | duplicado exato de agendamentos_tenant_rls_idx |
| `agendamentos` | `idx_agendamentos_dentista` | 48 kB | prefixo de idx_agendamentos_dentista_data |
| `attendance_queues` | `attendance_queues_tenant_rls_idx` | 8192 bytes | duplicado exato de idx_attendance_queues_tenant |
| `attendance_sessions` | `attendance_sessions_tenant_rls_idx` | 16 kB | prefixo de idx_attendance_sessions_open |
| `attendance_sessions` | `idx_attendance_sessions_tenant` | 16 kB | prefixo de idx_attendance_sessions_open |
| `chat_messages` | `chat_messages_tenant_rls_idx` | 40 kB | duplicado exato de idx_chat_messages_tenant |
| `chat_read_status` | `idx_chat_read_status_tenant` | 16 kB | duplicado exato de chat_read_status_tenant_rls_idx |
| `dentistas` | `dentistas_tenant_rls_idx` | 16 kB | duplicado exato de dentistas_tenant_idx |
| `lead_tag_assignments` | `idx_lead_tag_assignments_lead` | 16 kB | prefixo de lead_tag_assignments_lead_id_tag_id_key |
| `pacientes` | `pacientes_tenant_idx` | 64 kB | duplicado exato de pacientes_tenant_rls_idx |
| `push_subscriptions` | `idx_push_subs_endpoint` | 16 kB | duplicado exato de push_subscriptions_endpoint_key |
| `push_subscriptions` | `push_subscriptions_tenant_rls_idx` | 16 kB | duplicado exato de idx_push_subs_tenant |

Remover só em PR próprio, com `DROP INDEX CONCURRENTLY IF EXISTS`, depois de mais um ciclo de estatísticas, nunca junto com mudança de código. Os índices novos do #84 tornam redundantes, depois de aplicados, os índices só de `tenant_id` de `chat_messages`, `agendamentos` e `pacientes`. Reavaliar quando as estatísticas tiverem rodado com eles.

## 2. Não remover, mesmo sem uso

### Chave primária (53)
Garantem a identidade da linha e a referência das FKs. Nunca saem.

- `agenda_marcadores`: `agenda_marcadores_pkey`
- `ai_settings`: `ai_settings_pkey`
- `anamneses`: `anamneses_pkey`
- `assinaturas_eletronicas`: `assinaturas_eletronicas_pkey`
- `attendance_queues`: `attendance_queues_pkey`
- `broadcast_campaigns`: `broadcast_campaigns_pkey`
- `chat_read_status`: `chat_read_status_pkey`
- `clinical_reports`: `clinical_reports_pkey`
- `clinicorp_appointment_categories`: `clinicorp_appointment_categories_pkey`
- `clinicorp_conflicts`: `clinicorp_conflicts_pkey`
- `clinicorp_documents`: `clinicorp_documents_pkey`
- `clinicorp_evolutions`: `clinicorp_evolutions_pkey`
- `clinicorp_financial_entries`: `clinicorp_financial_entries_pkey`
- `clinicorp_local_overrides`: `clinicorp_local_overrides_pkey`
- `clinicorp_monthly_summary`: `clinicorp_monthly_summary_pkey`
- `clinicorp_override_history`: `clinicorp_override_history_pkey`
- `clinicorp_push_log`: `clinicorp_push_log_pkey`
- `clinicorp_specialties`: `clinicorp_specialties_pkey`
- `clinicorp_webhook_events`: `clinicorp_webhook_events_pkey`
- `comissoes`: `comissoes_pkey`
- `consentimentos_pacientes`: `consentimentos_pacientes_pkey`
- `consultations`: `consultations_pkey`
- `estoque`: `estoque_pkey`
- `estoque_movimentos`: `estoque_movimentos_pkey`
- `fin_bank_accounts`: `fin_bank_accounts_pkey`
- `fin_bills`: `fin_bills_pkey`
- `fin_employees`: `fin_employees_pkey`
- `fin_movements`: `fin_movements_pkey`
- `fin_overdue`: `fin_overdue_pkey`
- `fin_payrolls`: `fin_payrolls_pkey`
- `financeiro`: `financeiro_pkey`
- `invoices`: `invoices_pkey`
- `kanban_movements`: `kanban_movements_pkey`
- `meta_ads_accounts`: `meta_ads_accounts_pkey`
- `meta_ads_campaigns`: `meta_ads_campaigns_pkey`
- `meta_ads_insights`: `meta_ads_insights_pkey`
- `odontogramas`: `odontogramas_pkey`
- `password_reset_requests`: `password_reset_requests_pkey`
- `procedimento_execucoes`: `procedimento_execucoes_pkey`
- `procedimentos_catalogo_versoes`: `procedimentos_catalogo_versoes_pkey`
- `prontuarios`: `prontuarios_pkey`
- `push_subscriptions`: `push_subscriptions_pkey`
- `reactivation_rules`: `reactivation_rules_pkey`
- `reactivation_sends`: `reactivation_sends_pkey`
- `satisfaction_ratings`: `satisfaction_ratings_pkey`
- `subscriptions`: `subscriptions_pkey`
- `tag_assignments`: `tag_assignments_pkey`
- `tags`: `tags_pkey`
- `tenant_ai_settings`: `tenant_ai_settings_pkey`
- `test_rls_security`: `test_rls_security_pkey`
- `transfer_logs`: `transfer_logs_pkey`
- `tratamento_etapas`: `tratamento_etapas_pkey`
- `tratamentos`: `tratamentos_pkey`


### Unicidade (13)
O índice **é** a regra (sem ele, entra duplicado). Isso inclui as chaves por clínica do #50/#62 e as globais que eles substituem.

| Tabela | Índice | Regra |
|---|---|---|
| `agenda_marcadores` | `agenda_marcadores_nome_key` | nome (global: o #50 troca por índice por clínica e remove esta) |
| `anamneses` | `anamneses_paciente_id_key` | paciente_id |
| `clinica_config` | `idx_clinica_config_tenant` | tenant_id |
| `clinicorp_documents` | `uq_clinicorp_documents_tenant` | id,tenant_id |
| `clinicorp_evolutions` | `uq_clinicorp_evolutions_tenant` | id,tenant_id |
| `clinicorp_financial_entries` | `clinicorp_financial_entries_source_external_id_key` | source,external_id (global: o #62 troca por índice por clínica e remove esta) |
| `dentistas` | `dentistas_cro_key` | cro (global: o #50 troca por índice por clínica e remove esta) |
| `dentistas` | `uniq_dentistas_clinicorp` | clinicorp_professional_id (global: o #62 troca por índice por clínica e remove esta) |
| `dentistas` | `uq_dentistas_tenant_nome` | tenant_id,lower(TRIM(BOTH FROM nome)) |
| `odontogramas` | `odontogramas_paciente_id_key` | paciente_id |
| `pacientes` | `pacientes_cpf_key` | cpf (global: o #50 troca por índice por clínica e remove esta) |
| `procedimentos_catalogo_versoes` | `procedimentos_catalogo_versoes_procedimento_id_versao_key` | procedimento_id,versao |
| `tag_assignments` | `tag_assignments_tag_id_lead_id_key` | tag_id,lead_id |

### Apoio a FK, cascata e filtro por clínica (22)
Começam por `tenant_id` ou por uma coluna `*_id`. Sem eles, `DELETE` em `tenants`/`pacientes` (cascata, pedido do titular, expurgo) varre a tabela filha inteira, e a RLS forçada do #14 filtra por `tenant_id`. O uso é raro por natureza.

- `agenda_marcadores`: `idx_agenda_marcadores_tenant`
- `agendamentos`: `idx_agendamentos_serie`
- `assinaturas_eletronicas`: `idx_assinaturas_paciente`
- `attendance_sessions`: `idx_attendance_sessions_attendant`, `idx_attendance_sessions_open`
- `automation_jobs`: `idx_automation_jobs_tenant_sent`
- `chat_read_status`: `chat_read_status_tenant_rls_idx`, `idx_chat_read_status_user`
- `dentistas`: `dentistas_tenant_idx`
- `kanban_movements`: `idx_kanban_movements_lead`, `kanban_movements_tenant_rls_idx`
- `lead_tag_assignments`: `idx_lead_tag_assignments_tag`, `lead_tag_assignments_tenant_rls_idx`
- `lead_tags`: `lead_tags_tenant_rls_idx`
- `procedimento_execucoes`: `idx_execucoes_dentista`, `idx_execucoes_orcamento`, `idx_execucoes_paciente`
- `procedimentos_catalogo`: `idx_procedimentos_catalogo_tenant`
- `profiles`: `profiles_tenant_idx`
- `prontuarios`: `idx_prontuarios_paciente`
- `tratamentos`: `idx_tratamentos_paciente`
- `user_preferences`: `user_preferences_tenant_rls_idx`


### Rotina mensal, sincronização ou recurso pouco usado (38)
Usados pela sincronização do Clinicorp, pelo expurgo LGPD (mensal), pelo financeiro, pelo Meta Ads (ainda pouco ativo) e por telas raras. O zero reflete a frequência, não a falta de uso.

- `clinical_reports`: `idx_clinical_reports_created`
- `clinicorp_appointments`: `idx_clinicorp_appts_patient`
- `clinicorp_conflicts`: `idx_cc_conflicts_entity`, `idx_cc_conflicts_lead`
- `clinicorp_documents`: `idx_clinicorp_documents_patient`
- `clinicorp_estimates`: `idx_clinicorp_est_patient`
- `clinicorp_evolutions`: `idx_clinicorp_evolutions_patient`, `idx_clinicorp_evolutions_treatment`
- `clinicorp_override_history`: `idx_cc_override_hist_scope`
- `clinicorp_patients`: `idx_clinicorp_patients_doc`, `idx_clinicorp_patients_phone`
- `clinicorp_professionals`: `idx_clinicorp_profs_tenant`
- `clinicorp_user_settings`: `idx_clinicorp_user_settings_enabled`
- `comissoes`: `idx_comissoes_data`
- `consentimentos_pacientes`: `idx_consentimentos_pacientes_lookup`
- `consultations`: `idx_consultations_dentist`, `idx_consultations_finished`
- `estoque_movimentos`: `idx_estoque_movimentos_item`
- `fin_bills`: `idx_fin_bills_status`
- `fin_movements`: `idx_fin_movements_bank`, `idx_fin_movements_date`, `idx_fin_movements_type`
- `fin_payrolls`: `idx_fin_payrolls_month`, `idx_fin_payrolls_status`
- `meta_ads_campaigns`: `idx_meta_campaigns_account`
- `meta_ads_insights`: `idx_meta_insights_campaign`, `idx_meta_insights_date`
- `push_subscriptions`: `idx_push_subs_tenant`, `idx_push_subs_user`
- `reactivation_sends`: `idx_reactivation_sends_paciente`, `idx_reactivation_sends_phone`, `idx_reactivation_sends_rule`, `idx_reactivation_sends_sent_at`
- `satisfaction_ratings`: `idx_satisfaction_ratings_attendant`, `idx_satisfaction_ratings_created`
- `transfer_logs`: `idx_transfer_logs_created`, `idx_transfer_logs_lead`
- `tratamento_etapas`: `idx_tratamento_etapas_tratamento`


## 3. Revisar depois (14)
Sem uso e sem categoria clara. Não remover sem `EXPLAIN` das queries que podem usá-los.

| Tabela | Índice | Colunas | Observação |
|---|---|---|---|
| `assinaturas_eletronicas` | `idx_assinaturas_contexto` | (contexto, contexto_id) | filtro por coluna de baixa seletividade (status, ativo...); provável remoção futura |
| `attendance_queues` | `idx_attendance_queues_active` | (active) | filtro por coluna de baixa seletividade (status, ativo...); provável remoção futura |
| `automation_jobs` | `idx_automation_jobs_due` | (status, scheduled_at) | sobreposto ao parcial `idx_automation_jobs_pending`, que a fila usa; candidato depois de confirmar com `EXPLAIN` da fila |
| `automation_jobs` | `idx_automation_jobs_instance_sent` | (instance, sent_at) | limite de envio por número (`instance` + `sent_at`); pode estar zerado porque o limite usa outro índice. Manter até conferir |
| `chat_messages` | `idx_chat_messages_created` | (created_at DESC) | troca de número principal (`created_at > NOW() - 7 days`) e rotinas raras; manter |
| `contatos` | `idx_contatos_nome` | (nome) | idem (`ORDER BY nome`) |
| `crm_leads` | `idx_crm_leads_consciousness` | (consciousness_level) | filtro por coluna de baixa seletividade (status, ativo...); provável remoção futura |
| `crm_leads` | `idx_crm_leads_status` | (status) | filtro por coluna de baixa seletividade (status, ativo...); provável remoção futura |
| `estoque` | `idx_estoque_nome` | (nome) | idem |
| `financeiro` | `idx_financeiro_data` | (data) | filtro por coluna de baixa seletividade (status, ativo...); provável remoção futura |
| `financeiro` | `idx_financeiro_status` | (status) | filtro por coluna de baixa seletividade (status, ativo...); provável remoção futura |
| `kanban_movements` | `idx_kanban_movements_created` | (created_at DESC) | histórico do funil por data; uso raro |
| `pacientes` | `idx_pacientes_nome` | (nome) | lista ordenada por nome; com 2 mil linhas o planner prefere varrer e ordenar. Revisar quando crescer |
| `procedimentos_catalogo` | `idx_procedimentos_catalogo_ativo` | (ativo) | filtro por coluna de baixa seletividade (status, ativo...); provável remoção futura |

## Como refazer
```sql
SELECT relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) FROM pg_stat_user_indexes ORDER BY idx_scan;
SELECT stats_reset FROM pg_stat_database WHERE datname = current_database();  -- desde quando contam
```
