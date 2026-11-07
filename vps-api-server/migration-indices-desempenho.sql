-- ═══════════════════════════════════════════════════════════════════════════
-- Odonto Connect — índices de desempenho (auditoria de varreduras, 2026-11-05).
-- Autora: Renata (banco) · Idempotente: pode rodar N vezes. Sem BEGIN: CREATE INDEX CONCURRENTLY
-- não roda em transação e não trava a escrita. Índice inválido de tentativa anterior é refeito.
-- lock_timeout de 5 s: sem o lock, falha (no máximo fica um índice inválido, refeito na próxima).
-- Só cria; não remove nenhum índice (duplicados e não usados ficam listados no PR).
-- Base: pg_stat_user_tables de produção (seq_tup_read) cruzado com as queries do server.mjs.
--
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS <nome>;  (só desempenho; nenhum dado muda)
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on
SET lock_timeout = '5s';

-- idx_orcamentos_tenant_clinicorp_estimate: clinicorp.mjs:1132 (projectEstimateToLocal): SELECT ... WHERE clinicorp_estimate_id = $1 AND tenant_id = $2, uma vez por orçamento em cada sincronização. Sem índice = varredura inteira de orcamentos por orçamento (38 M linhas lidas).
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orcamentos' AND column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orcamentos' AND column_name = 'clinicorp_estimate_id') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_orcamentos_tenant_clinicorp_estimate' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_orcamentos_tenant_clinicorp_estimate;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orcamentos_tenant_clinicorp_estimate ON orcamentos (tenant_id, clinicorp_estimate_id) WHERE clinicorp_estimate_id IS NOT NULL;
\else
  \echo '[indices] orcamentos: coluna ausente, idx_orcamentos_tenant_clinicorp_estimate pulado'
\endif

-- idx_crm_leads_tenant_fone11: server.mjs:9253 (lead pelo telefone em toda mensagem recebida no webhook), 9927, 9963, 10022: RIGHT(REGEXP_REPLACE(COALESCE(telefone,''),'\D','','g'),11) = ... com tenant_id. Mesma expressão do código, senão o planner não usa.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'crm_leads' AND column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'crm_leads' AND column_name = 'telefone') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_crm_leads_tenant_fone11' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_crm_leads_tenant_fone11;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_leads_tenant_fone11 ON crm_leads (tenant_id, (RIGHT(REGEXP_REPLACE(COALESCE(telefone, ''), '\D', '', 'g'), 11)));
\else
  \echo '[indices] crm_leads: coluna ausente, idx_crm_leads_tenant_fone11 pulado'
\endif

-- idx_chat_messages_tenant_fone11: server.mjs:13519 (GET /api/messages/:leadId, abrir conversa): lead_id = $1 OR RIGHT(REGEXP_REPLACE(cm.phone,...),11) = ...; com este índice e o de lead_id o planner faz BitmapOr em vez de varrer chat_messages.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'phone') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_chat_messages_tenant_fone11' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_chat_messages_tenant_fone11;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_tenant_fone11 ON chat_messages (tenant_id, (RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 11))) WHERE phone IS NOT NULL;
\else
  \echo '[indices] chat_messages: coluna ausente, idx_chat_messages_tenant_fone11 pulado'
\endif

-- idx_chat_messages_tenant_lead_ts: server.mjs:2671 (alvos de envio), 13367 e 13843 (última mensagem por lead), 14102 (não lidas): filtram tenant_id + lead_id e ordenam por timestamp.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'lead_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'timestamp') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_chat_messages_tenant_lead_ts' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_chat_messages_tenant_lead_ts;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_tenant_lead_ts ON chat_messages (tenant_id, lead_id, "timestamp" DESC);
\else
  \echo '[indices] chat_messages: coluna ausente, idx_chat_messages_tenant_lead_ts pulado'
\endif

-- idx_automation_jobs_flow_trigger: server.mjs:11773 e 9772 (lembrete 24h, NOT EXISTS por consulta: trigger_event = 'appointment_reminder' AND flow_id = 'reminder_'||id AND created_at > ...) e as buscas por flow_id + trigger_event dos fluxos.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'automation_jobs' AND column_name = 'flow_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'automation_jobs' AND column_name = 'trigger_event') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'automation_jobs' AND column_name = 'created_at') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_automation_jobs_flow_trigger' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_automation_jobs_flow_trigger;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_automation_jobs_flow_trigger ON automation_jobs (flow_id, trigger_event, created_at);
\else
  \echo '[indices] automation_jobs: coluna ausente, idx_automation_jobs_flow_trigger pulado'
\endif

-- idx_automation_jobs_tenant_trigger_created: cooldown dos gatilhos por paciente (processSolutionTriggers) e server.mjs:11854 (inativos): tenant_id + trigger_event + created_at > NOW() - intervalo.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'automation_jobs' AND column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'automation_jobs' AND column_name = 'trigger_event') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'automation_jobs' AND column_name = 'created_at') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_automation_jobs_tenant_trigger_created' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_automation_jobs_tenant_trigger_created;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_automation_jobs_tenant_trigger_created ON automation_jobs (tenant_id, trigger_event, created_at);
\else
  \echo '[indices] automation_jobs: coluna ausente, idx_automation_jobs_tenant_trigger_created pulado'
\endif

-- idx_agendamentos_tenant_paciente_data: Não há índice em agendamentos.paciente_id. Usado no histórico do paciente (GET /api/pacientes/:id/historico), nos gatilhos (NOT EXISTS por paciente: server.mjs:11953, 11998, 10337, 10361) e no pedido do titular.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agendamentos' AND column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agendamentos' AND column_name = 'paciente_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agendamentos' AND column_name = 'data') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_agendamentos_tenant_paciente_data' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_agendamentos_tenant_paciente_data;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agendamentos_tenant_paciente_data ON agendamentos (tenant_id, paciente_id, data);
\else
  \echo '[indices] agendamentos: coluna ausente, idx_agendamentos_tenant_paciente_data pulado'
\endif

-- idx_pacientes_tenant_telefone: clinicorp.mjs:670 (ensureLocalPatient): WHERE telefone = $1 AND tenant_id = $2, por paciente em cada sincronização.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'telefone') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_pacientes_tenant_telefone' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_pacientes_tenant_telefone;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pacientes_tenant_telefone ON pacientes (tenant_id, telefone) WHERE telefone IS NOT NULL;
\else
  \echo '[indices] pacientes: coluna ausente, idx_pacientes_tenant_telefone pulado'
\endif

-- idx_pacientes_tenant_fone11: PR #85 (helper foneIndexado/sqlFoneIgual): convert-to-patient e link buscam paciente por RIGHT(REGEXP_REPLACE(COALESCE(telefone,''),'\D','','g'),11) = ANY($1) com tenant_id. Mesma expressão do helper; o índice 8 (igualdade) continua para o Clinicorp.
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'tenant_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pacientes' AND column_name = 'telefone') AS tem \gset
\if :tem
  SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'idx_pacientes_tenant_fone11' AND NOT i.indisvalid) AS invalido \gset
  \if :invalido
    DROP INDEX CONCURRENTLY IF EXISTS idx_pacientes_tenant_fone11;
  \endif
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pacientes_tenant_fone11 ON pacientes (tenant_id, (RIGHT(REGEXP_REPLACE(COALESCE(telefone, ''), '\D', '', 'g'), 11)));
\else
  \echo '[indices] pacientes: coluna ausente, idx_pacientes_tenant_fone11 pulado'
\endif

-- Confere: algum índice desta migração ficou inválido? (falha controlada para o ::warning do deploy)
SELECT count(*) > 0 AS sobrou_invalido FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE NOT i.indisvalid AND c.relname IN ('idx_orcamentos_tenant_clinicorp_estimate', 'idx_crm_leads_tenant_fone11', 'idx_chat_messages_tenant_fone11', 'idx_chat_messages_tenant_lead_ts', 'idx_automation_jobs_flow_trigger', 'idx_automation_jobs_tenant_trigger_created', 'idx_agendamentos_tenant_paciente_data', 'idx_pacientes_tenant_telefone', 'idx_pacientes_tenant_fone11') \gset
\if :sobrou_invalido
  \echo '!!! [indices] índice inválido depois da criação: rodar de novo'
  SELECT 1/0 AS indice_invalido;
\endif
