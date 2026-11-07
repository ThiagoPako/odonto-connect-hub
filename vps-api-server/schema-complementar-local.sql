-- Tabelas que o código (server.mjs) usa mas que NENHUM arquivo do repositório cria
-- (existem só no banco de produção). Reconstruídas a partir das queries — APENAS para o
-- ambiente LOCAL de testes. Colunas inferidas; confira contra produção antes de virar migração.
-- Aplicar depois das migration*.sql. Idempotente.
CREATE TABLE IF NOT EXISTS automation_flows (
  id TEXT PRIMARY KEY, name TEXT, description TEXT, type TEXT, active BOOLEAN DEFAULT false,
  trigger_event TEXT, steps JSONB DEFAULT '[]', stats JSONB DEFAULT '{}', created_by UUID, tenant_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, tenant_id UUID, instance TEXT, patient_phone TEXT, message TEXT,
  category TEXT DEFAULT 'transactional', flow_id TEXT, flow_name TEXT, step_index INT DEFAULT 0, patient_name TEXT,
  variables JSONB, channel TEXT DEFAULT 'whatsapp', status TEXT DEFAULT 'pending', scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  trigger_event TEXT, expires_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, error TEXT, attempts INT DEFAULT 0, claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id TEXT PRIMARY KEY, nome TEXT, template JSONB, tipo TEXT, dias_semana JSONB, horario_inicio TEXT, horario_fim TEXT,
  data_inicio TEXT, data_fim TEXT, campanha_perpetua BOOLEAN, usar_horario_clinica BOOLEAN, publico TEXT, filtro_custom TEXT,
  numero_envio TEXT, contatos_alcancaveis INT DEFAULT 0, capacidade_diaria INT DEFAULT 232, intervalo_spam INT DEFAULT 7,
  ativo BOOLEAN DEFAULT false, created_by UUID, tenant_id UUID, enviados INT DEFAULT 0, last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS clinica_config (
  id INT PRIMARY KEY, horarios JSONB, intervalo_agenda INT DEFAULT 30, limitar_mesmo_horario BOOLEAN DEFAULT false,
  permitir_horario_indisponivel BOOLEAN DEFAULT false, habilitar_sessoes_procedimento BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS agenda_marcadores (id TEXT PRIMARY KEY, nome TEXT UNIQUE, cor TEXT, tenant_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS system_logs (id SERIAL PRIMARY KEY, event TEXT, details JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS password_reset_requests (id SERIAL PRIMARY KEY, user_id UUID, email TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS procedimentos_catalogo (
  id TEXT PRIMARY KEY, codigo TEXT, nome TEXT NOT NULL, categoria TEXT, valor_particular NUMERIC DEFAULT 0, valor_convenio NUMERIC DEFAULT 0,
  duracao_minutos INT DEFAULT 30, cor TEXT, requer_dente BOOLEAN DEFAULT false, requer_face BOOLEAN DEFAULT false, descricao TEXT,
  versao_atual INT DEFAULT 1, ativo BOOLEAN DEFAULT true, tenant_id UUID, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS procedimentos_catalogo_versoes (
  id TEXT PRIMARY KEY, procedimento_id TEXT, versao INT, codigo TEXT, nome TEXT, categoria TEXT, valor_particular NUMERIC, valor_convenio NUMERIC,
  duracao_minutos INT, cor TEXT, requer_dente BOOLEAN, requer_face BOOLEAN, descricao TEXT, motivo TEXT, alterado_por TEXT,
  tenant_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS valido_desde TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE procedimentos_catalogo_versoes ADD COLUMN IF NOT EXISTS valido_ate TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS assinaturas_eletronicas (
  id TEXT PRIMARY KEY, paciente_id UUID, dentista_id UUID, contexto TEXT, assinatura_base64 TEXT, latitude NUMERIC, longitude NUMERIC, accuracy_m NUMERIC,
  ip_address TEXT, user_agent TEXT, verificacao_canal TEXT, verificacao_codigo TEXT, verificacao_em TIMESTAMPTZ, consentimento_aceito BOOLEAN,
  consentimento_em TIMESTAMPTZ, consentimento_versao TEXT, consentimento_texto TEXT, tenant_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS procedimento_execucoes (
  id TEXT PRIMARY KEY, orcamento_id UUID, orcamento_item_id TEXT, paciente_id UUID, dentista_id UUID, procedimento_id TEXT, procedimento_nome TEXT,
  dente TEXT, faces TEXT, valor NUMERIC, observacoes TEXT, assinatura_id TEXT, tenant_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS financeiro_receitas (id TEXT PRIMARY KEY, descricao TEXT, valor NUMERIC, data DATE, status TEXT, tenant_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS financeiro_despesas (id TEXT PRIMARY KEY, descricao TEXT, valor NUMERIC, data DATE, status TEXT, tenant_id UUID, created_at TIMESTAMPTZ DEFAULT NOW());
-- Colunas usadas pelos lembretes (server.mjs:7066,7076,11199) e inexistentes em todo o repositório:
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS paciente_nome TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS dentista_nome TEXT;
-- Colunas de agendamentos usadas por POST/PUT /api/agenda (server.mjs ≈5146) e inexistentes em todo o repositório:
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'consulta';
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS primeira_consulta BOOLEAN DEFAULT false;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS dia_inteiro BOOLEAN DEFAULT false;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS escopo TEXT DEFAULT 'dentista';
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS categoria_cor TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS confirmacao_canal TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS confirmacao_quando TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS alerta_retorno_canal TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS alerta_retorno_quando TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS evento_titulo TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS sala TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS serie_id TEXT;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS marcadores JSONB DEFAULT '[]';
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS como_conheceu TEXT;
-- O frontend (routeAccess.ts) usa o papel 'comercial', mas o enum app_role dos arquivos do repo é {admin,dentista,recepcionista,user}.
-- Sem isto o login de um usuário 'comercial' volta como role='user' (acesso mínimo). Confirmar o que existe em produção.
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'comercial';
-- orcamentos: colunas usadas por POST /api/orcamentos (server.mjs:6464) sem nenhuma migration no repositório.
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS titulo TEXT;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS print_config JSONB;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS odontograma_snapshot JSONB;
-- reativacao: server.mjs:7679/7734 usa tenant_id em reactivation_rules/sends, ausente em migration-reativacao.sql.
ALTER TABLE reactivation_rules ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE reactivation_sends ADD COLUMN IF NOT EXISTS tenant_id UUID;
