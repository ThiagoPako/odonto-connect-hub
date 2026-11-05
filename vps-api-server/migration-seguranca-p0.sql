-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — Segurança P0: isolamento por clínica (tenant_id)
-- A RLS não protege (tabelas NO FORCE, app é dona); o filtro por clínica é
-- explícito nas queries de server.mjs. Este arquivo garante a coluna tenant_id
-- (e o índice) em todas as tabelas que essas queries filtram, e preenche os
-- registros antigos sem clínica quando há uma regra clara (pai ou clínica única).
--
-- Idempotente: pode rodar N vezes (o deploy roda em todo push, como postgres,
-- sem ON_ERROR_STOP). Cada bloco é independente e trata a própria falha com
-- RAISE NOTICE, para que um problema numa tabela não pule as seguintes.
-- Parte de clinica_config / agenda_marcadores / procedimentos_catalogo também
-- roda no boot em ensureTenantConfigSchema() (server.mjs).
--
-- NÃO habilita RLS de propósito: com tabelas de dono diferente do odonto_user,
-- ENABLE RLS bloquearia a aplicação. Isso fica para migration-rls-enforcement.sql.
--
-- Rollback:
--   * Colunas tenant_id e índices idx_<t>_tenant: opcionais, podem ficar
--     (o código novo depende delas; removê-las quebra as rotas).
--   * Backfill: não há como desfazer de forma automática; antes de aplicar,
--     guarde o resultado da seção "Conferência" (linhas com tenant_id NULL).
--   * tenant_ai_settings: DROP TABLE IF EXISTS tenant_ai_settings;
--     (perde as chaves por clínica gravadas depois; ai_settings não é alterada).
--   * clinica_config_id_seq: ALTER TABLE clinica_config ALTER COLUMN id DROP DEFAULT;
--     DROP SEQUENCE IF EXISTS clinica_config_id_seq; (só se nenhuma clínica
--     tiver criado linha própria — senão o próximo INSERT sem id falha).
-- ═══════════════════════════════════════════════════════════


-- ─── 0. Funções auxiliares temporárias (somem ao fim da sessão do psql) ───

-- Coluna existe na tabela do schema public?
CREATE OR REPLACE FUNCTION pg_temp.p0_tem_coluna(p_tabela TEXT, p_coluna TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $f$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = p_tabela AND column_name = p_coluna
  );
$f$;

-- Clínica "única real". Regra (revisão Beatriz): o Legado 00000000-...-0001 é a
-- clínica ORIGINAL (recebeu os dados de antes do SaaS em migration-saas.sql) e conta
-- como clínica real sempre que tiver ao menos um registro em profiles ou pacientes.
-- Só existe "clínica única" quando o total de clínicas reais é exatamente 1.
-- Retorna NULL em qualquer dúvida (0 ou 2+ clínicas reais): nada é preenchido.
CREATE OR REPLACE FUNCTION pg_temp.p0_clinica_unica()
RETURNS UUID LANGUAGE plpgsql STABLE AS $f$
DECLARE
  legado CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
  legado_real BOOLEAN := false;
  n_outras INT;
  v UUID;
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM tenants WHERE id = legado) THEN
    IF pg_temp.p0_tem_coluna('profiles', 'tenant_id') THEN
      IF pg_temp.p0_tem_coluna('profiles', 'is_super_admin') THEN
        -- super-admins costumam ficar no Legado e não o tornam uma clínica real
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.profiles WHERE tenant_id = $1 AND COALESCE(is_super_admin, false) = false)' INTO legado_real USING legado;
      ELSE
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.profiles WHERE tenant_id = $1)' INTO legado_real USING legado;
      END IF;
    END IF;
    IF NOT legado_real AND pg_temp.p0_tem_coluna('pacientes', 'tenant_id') THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.pacientes WHERE tenant_id = $1)' INTO legado_real USING legado;
    END IF;
  END IF;

  SELECT count(*) INTO n_outras FROM tenants WHERE id <> legado;

  IF legado_real AND n_outras = 0 THEN
    RETURN legado;
  ELSIF NOT legado_real AND n_outras = 1 THEN
    SELECT id INTO v FROM tenants WHERE id <> legado;
    RETURN v;
  END IF;
  RETURN NULL;  -- 0 clínicas reais, ou 2+ (inclui Legado com dados + 1 clínica nova)
END
$f$;

-- Preenche filho.tenant_id a partir do pai: filho.<col_filho> = pai.<col_pai>.
-- Só usa chaves do pai que pertencem a UMA clínica (relevante quando a chave não
-- é única no pai, ex.: lead_id em attendance_sessions). Compara como texto porque
-- várias colunas de ligação são TEXT apontando para UUID (lead_id, patient_id).
CREATE OR REPLACE FUNCTION pg_temp.p0_preencher_do_pai(
  p_filho TEXT, p_col_filho TEXT, p_pai TEXT, p_col_pai TEXT
) RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE
  n INT;
BEGIN
  IF NOT (pg_temp.p0_tem_coluna(p_filho, 'tenant_id') AND pg_temp.p0_tem_coluna(p_filho, p_col_filho)
      AND pg_temp.p0_tem_coluna(p_pai, 'tenant_id') AND pg_temp.p0_tem_coluna(p_pai, p_col_pai)) THEN
    RAISE NOTICE '[p0] % <- %.%: tabela/coluna ausente, pulado', p_filho, p_pai, p_col_pai;
    RETURN;
  END IF;
  EXECUTE format(
    'UPDATE public.%1$I f SET tenant_id = p.tenant_id
       FROM (SELECT %4$I::text AS chave, (array_agg(DISTINCT tenant_id))[1] AS tenant_id
               FROM public.%3$I
              WHERE tenant_id IS NOT NULL AND %4$I IS NOT NULL
              GROUP BY 1
             HAVING count(DISTINCT tenant_id) = 1) p
      WHERE f.tenant_id IS NULL AND f.%2$I::text = p.chave',
    p_filho, p_col_filho, p_pai, p_col_pai);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE '[p0] % <- %.%: % linhas preenchidas', p_filho, p_pai, p_col_pai, n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[p0] % <- %.%: falhou (%)', p_filho, p_pai, p_col_pai, SQLERRM;
END
$f$;

-- Tabela sem pai: preenche com a clínica única; senão só informa quantas ficaram NULL.
CREATE OR REPLACE FUNCTION pg_temp.p0_preencher_clinica_unica(p_tabela TEXT)
RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE
  v UUID := pg_temp.p0_clinica_unica();
  n INT;
BEGIN
  IF NOT pg_temp.p0_tem_coluna(p_tabela, 'tenant_id') THEN RETURN; END IF;
  IF v IS NOT NULL THEN
    EXECUTE format('UPDATE public.%I SET tenant_id = $1 WHERE tenant_id IS NULL', p_tabela) USING v;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '[p0] %: % linhas atribuídas à clínica única', p_tabela, n; END IF;
  ELSE
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', p_tabela) INTO n;
    IF n > 0 THEN RAISE NOTICE '[p0] %: % linhas sem clínica (várias clínicas — revisar manualmente)', p_tabela, n; END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[p0] % (clínica única): falhou (%)', p_tabela, SQLERRM;
END
$f$;


-- ─── 1. clinica_config: uma linha por clínica ─────────────────
-- A linha legada id=1 (compartilhada por todas) NÃO é alterada; o GET usa os
-- valores dela como padrão até a clínica salvar a própria configuração (PUT faz upsert).
-- Linhas novas precisam de id automático (a legada usa id=1 fixo).
DO $$
BEGIN
  IF to_regclass('public.clinica_config') IS NULL THEN
    RAISE NOTICE '[p0] clinica_config não existe, pulado';
    RETURN;
  END IF;
  ALTER TABLE clinica_config ADD COLUMN IF NOT EXISTS tenant_id UUID;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_clinica_config_tenant ON clinica_config (tenant_id);
  CREATE SEQUENCE IF NOT EXISTS clinica_config_id_seq;
  PERFORM setval('clinica_config_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM clinica_config), 1));
  ALTER TABLE clinica_config ALTER COLUMN id SET DEFAULT nextval('clinica_config_id_seq');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[p0] clinica_config: falhou (%)', SQLERRM;
END $$;


-- ─── 2. Coluna tenant_id + índice + DEFAULT em cada tabela ────
-- Cada tabela num sub-bloco com EXCEPTION própria: uma falha não pula as demais.
-- O DEFAULT get_current_tenant_id() só é aplicado se a função existir
-- (criada por migration-tenant-defaults.sql, que roda antes no deploy).
-- O índice só é criado se ainda não houver índice começando por tenant_id
-- (migration-saas.sql cria <t>_tenant_idx em algumas tabelas).
-- Obs.: fin_banks não existe no código; a tabela real é fin_bank_accounts.
--       As duas ficam na lista; a inexistente é pulada.
DO $$
DECLARE
  t TEXT;
  tem_funcao BOOLEAN := EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_current_tenant_id');
  tabelas TEXT[] := ARRAY[
    'anamneses', 'odontogramas', 'estoque_movimentos', 'tratamento_etapas', 'comissoes',
    'prontuarios', 'lead_tags', 'lead_tag_assignments', 'transfer_logs', 'satisfaction_ratings',
    'consultations', 'clinical_reports', 'fin_employees', 'fin_bills', 'fin_overdue',
    'fin_banks', 'fin_bank_accounts', 'fin_movements', 'fin_payrolls', 'agenda_marcadores',
    'procedimentos_catalogo', 'contatos', 'dentistas', 'estoque', 'tratamentos',
    'orcamentos', 'financeiro', 'procedimento_execucoes', 'assinaturas_eletronicas',
    'meta_ads_accounts', 'meta_ads_campaigns', 'meta_ads_insights'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    BEGIN
      IF to_regclass(format('public.%I', t)) IS NULL THEN
        RAISE NOTICE '[p0] %: tabela não existe, pulada', t;
        CONTINUE;
      END IF;

      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id UUID', t);

      IF NOT EXISTS (
        SELECT 1 FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
         WHERE i.indrelid = format('public.%I', t)::regclass AND a.attname = 'tenant_id'
      ) THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)', 'idx_' || t || '_tenant', t);
      END IF;

      IF tem_funcao THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id()', t);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[p0] %: falhou ao garantir tenant_id (%)', t, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─── 3. Preenchimento pelo pai (ligação clara) ────────────────
-- Ordem importa: primeiro os pais intermediários (orçamentos, tratamentos,
-- execuções), depois os filhos deles.

-- 3.1 Orçamentos e tratamentos ← paciente.
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('orcamentos',  'paciente_id', 'pacientes', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('tratamentos', 'paciente_id', 'pacientes', 'id');
END $$;

-- 3.2 Execuções de procedimento ← orçamento; senão ← paciente.
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('procedimento_execucoes', 'orcamento_id', 'orcamentos', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('procedimento_execucoes', 'paciente_id',  'pacientes',  'id');
END $$;

-- 3.3 Assinaturas eletrônicas ← execução que aponta para ela (assinatura_id); senão ← paciente.
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('assinaturas_eletronicas', 'id',          'procedimento_execucoes', 'assinatura_id');
  PERFORM pg_temp.p0_preencher_do_pai('assinaturas_eletronicas', 'paciente_id', 'pacientes',              'id');
END $$;

-- 3.4 Dados clínicos ← paciente (paciente_id nas tabelas antigas, patient_id TEXT nas novas).
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('anamneses',        'paciente_id', 'pacientes', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('odontogramas',     'paciente_id', 'pacientes', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('prontuarios',      'paciente_id', 'pacientes', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('consultations',    'patient_id',  'pacientes', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('clinical_reports', 'patient_id',  'pacientes', 'id');
END $$;

-- 3.5 Etapas ← tratamento; movimentos de estoque ← item (item_id).
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('tratamento_etapas',  'tratamento_id', 'tratamentos', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('estoque_movimentos', 'item_id',       'estoque',     'id');
END $$;

-- 3.6 Dentistas ← agendamentos: só quando TODOS os agendamentos do dentista (com
--     clínica) são de UMA única clínica (sem desempate por maioria). Vem antes das
--     comissões, que usam o dentista como último recurso.
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('dentistas', 'id', 'agendamentos', 'dentista_id');
END $$;

-- 3.7 Comissões ← tratamento; senão ← paciente; senão ← dentista.
--     (o dentista vem por último: dentistas antigos foram jogados no Legado por migration-saas.sql)
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('comissoes', 'tratamento_id', 'tratamentos', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('comissoes', 'paciente_id',   'pacientes',   'id');
  PERFORM pg_temp.p0_preencher_do_pai('comissoes', 'dentista_id',   'dentistas',   'id');
END $$;

-- 3.8 CRM: etiquetas atribuídas, transferências e avaliações ← lead (lead_id TEXT = crm_leads.id);
--     senão ← sessão de atendimento (session_id, ou lead_id quando todas as sessões do lead são de uma clínica).
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('lead_tag_assignments', 'lead_id',    'crm_leads',           'id');
  PERFORM pg_temp.p0_preencher_do_pai('transfer_logs',        'lead_id',    'crm_leads',           'id');
  PERFORM pg_temp.p0_preencher_do_pai('transfer_logs',        'lead_id',    'attendance_sessions', 'lead_id');
  PERFORM pg_temp.p0_preencher_do_pai('satisfaction_ratings', 'session_id', 'attendance_sessions', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('satisfaction_ratings', 'lead_id',    'crm_leads',           'id');
  PERFORM pg_temp.p0_preencher_do_pai('satisfaction_ratings', 'lead_id',    'attendance_sessions', 'lead_id');
END $$;

-- 3.9 Etiquetas (lead_tags) ← clínica dos leads que usam a etiqueta, só se todos forem de UMA clínica.
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('lead_tags', 'id', 'lead_tag_assignments', 'tag_id');
END $$;

-- 3.10 Contatos: a tabela era global, então o telefone NÃO serve para inferir a clínica
--      (um contato salvo pela clínica B com o número de um lead da A iria para a A).
--      Só atribui por origem segura: coluna de instância do WhatsApp, se existir,
--      mapeada em whatsapp_instances.instance_name -> tenant_id. Hoje contatos não tem
--      essa coluna (server.mjs grava só nome/telefone/tipo/tenant_id), então na prática
--      nada é preenchido aqui e o NOTICE informa quantos ficaram sem clínica.
DO $$
DECLARE
  col TEXT;
  achou BOOLEAN := false;
  n INT;
BEGIN
  IF NOT pg_temp.p0_tem_coluna('contatos', 'tenant_id') THEN RETURN; END IF;
  FOREACH col IN ARRAY ARRAY['instance_name', 'instance', 'instancia', 'whatsapp_instance'] LOOP
    IF pg_temp.p0_tem_coluna('contatos', col) THEN
      achou := true;
      PERFORM pg_temp.p0_preencher_do_pai('contatos', col, 'whatsapp_instances', 'instance_name');
    END IF;
  END LOOP;
  IF NOT achou THEN
    RAISE NOTICE '[p0] contatos: sem coluna de instância/origem; nada atribuído pelo pai';
  END IF;
  SELECT count(*) INTO n FROM contatos WHERE tenant_id IS NULL;
  IF n > 0 THEN RAISE NOTICE '[p0] contatos: % linhas sem clínica (sem origem segura — revisar manualmente)', n; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[p0] contatos: falhou (%)', SQLERRM;
END $$;


-- ─── 4. Tabelas sem pai: só com clínica única real ────────────
-- Com 2+ clínicas reais nada é atribuído; o NOTICE mostra quantas linhas ficaram NULL.
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_clinica_unica('lead_tags');
  PERFORM pg_temp.p0_preencher_clinica_unica('agenda_marcadores');
  PERFORM pg_temp.p0_preencher_clinica_unica('procedimentos_catalogo');
  PERFORM pg_temp.p0_preencher_clinica_unica('fin_employees');
  PERFORM pg_temp.p0_preencher_clinica_unica('fin_bills');
  PERFORM pg_temp.p0_preencher_clinica_unica('fin_overdue');
  PERFORM pg_temp.p0_preencher_clinica_unica('fin_bank_accounts');
  PERFORM pg_temp.p0_preencher_clinica_unica('fin_banks');
  -- contatos: depois da regra da instância (§3.10); só com clínica única real.
  PERFORM pg_temp.p0_preencher_clinica_unica('contatos');
  PERFORM pg_temp.p0_preencher_clinica_unica('meta_ads_accounts');
  PERFORM pg_temp.p0_preencher_clinica_unica('meta_ads_campaigns');
  PERFORM pg_temp.p0_preencher_clinica_unica('meta_ads_insights');
END $$;

-- 4.1 Meta Ads: chaves únicas por clínica. As chaves globais antigas
--     (meta_ads_accounts.account_id, meta_ads_campaigns.campaign_id,
--     meta_ads_insights (campaign_id, date_start)) são removidas logo abaixo:
--     o server.mjs agora grava por (tenant_id, chave) e elas impediriam duas
--     clínicas (ou linhas antigas sem clínica) de terem a mesma conta/campanha.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('meta_ads_accounts',  'idx_meta_ads_accounts_tenant_account',   ARRAY['account_id']),
      ('meta_ads_campaigns', 'idx_meta_ads_campaigns_tenant_campaign', ARRAY['campaign_id']),
      ('meta_ads_insights',  'idx_meta_ads_insights_tenant_campaign_date', ARRAY['campaign_id', 'date_start'])
    ) AS x(tabela, indice, colunas)
  LOOP
    BEGIN
      IF NOT pg_temp.p0_tem_coluna(r.tabela, 'tenant_id')
         OR EXISTS (SELECT 1 FROM unnest(r.colunas) c WHERE NOT pg_temp.p0_tem_coluna(r.tabela, c)) THEN
        RAISE NOTICE '[p0] %: tabela/coluna ausente, índice único por clínica pulado', r.tabela;
        CONTINUE;
      END IF;
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (tenant_id, %s)',
                     r.indice, r.tabela,
                     (SELECT string_agg(quote_ident(c), ', ') FROM unnest(r.colunas) c));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[p0] %: falhou ao criar índice único por clínica (%)', r.tabela, SQLERRM;
    END;
  END LOOP;
END $$;

-- 4.1b Remove as chaves únicas GLOBAIS antigas do Meta Ads (só as que têm
--      exatamente as colunas antigas, sem tenant_id). Rollback: recriar com
--      ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (...), se voltar ao código antigo.
DO $$
DECLARE
  r RECORD;
  c RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('meta_ads_accounts',  ARRAY['account_id']),
      ('meta_ads_campaigns', ARRAY['campaign_id']),
      ('meta_ads_insights',  ARRAY['campaign_id', 'date_start'])
    ) AS x(tabela, colunas)
  LOOP
    BEGIN
      IF to_regclass('public.' || r.tabela) IS NULL THEN CONTINUE; END IF;
      FOR c IN
        SELECT con.conname
          FROM pg_constraint con
         WHERE con.conrelid = ('public.' || r.tabela)::regclass
           AND con.contype = 'u'
           AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
                  FROM unnest(con.conkey) k
                  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
               = (SELECT array_agg(x ORDER BY x) FROM unnest(r.colunas) x)
      LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tabela, c.conname);
        RAISE NOTICE '[p0] %: chave única global % removida', r.tabela, c.conname;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[p0] %: falhou ao remover chave única global (%)', r.tabela, SQLERRM;
    END;
  END LOOP;
END $$;

-- 4.2 Financeiro dependente (depois da seção 4, que preenche os pais):
--     folha ← funcionário; movimento ← conta bancária, conta a pagar ou folha.
DO $$ BEGIN
  PERFORM pg_temp.p0_preencher_do_pai('fin_payrolls',  'employee_id',     'fin_employees',     'id');
  PERFORM pg_temp.p0_preencher_do_pai('fin_movements', 'bank_account_id', 'fin_bank_accounts', 'id');
  PERFORM pg_temp.p0_preencher_do_pai('fin_movements', 'bank_account_id', 'fin_banks',         'id');
  PERFORM pg_temp.p0_preencher_do_pai('fin_movements', 'bill_id',         'fin_bills',         'id');
  PERFORM pg_temp.p0_preencher_do_pai('fin_movements', 'payroll_id',      'fin_payrolls',      'id');
END $$;


-- ─── 5. Aviso final: o que ainda ficou sem clínica ────────────
-- Linhas com tenant_id NULL deixam de aparecer nas listagens (o filtro é tenant_id = $n).
DO $$
DECLARE
  t TEXT;
  n INT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'anamneses', 'odontogramas', 'estoque_movimentos', 'tratamento_etapas', 'comissoes',
    'prontuarios', 'lead_tags', 'lead_tag_assignments', 'transfer_logs', 'satisfaction_ratings',
    'consultations', 'clinical_reports', 'fin_employees', 'fin_bills', 'fin_overdue',
    'fin_banks', 'fin_bank_accounts', 'fin_movements', 'fin_payrolls', 'agenda_marcadores',
    'procedimentos_catalogo', 'contatos', 'dentistas', 'estoque', 'tratamentos',
    'orcamentos', 'financeiro', 'procedimento_execucoes', 'assinaturas_eletronicas',
    'meta_ads_accounts', 'meta_ads_campaigns', 'meta_ads_insights'
  ] LOOP
    BEGIN
      IF pg_temp.p0_tem_coluna(t, 'tenant_id') THEN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', t) INTO n;
        IF n > 0 THEN RAISE NOTICE '[p0] PENDENTE %: % linhas sem clínica', t, n; END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[p0] %: falhou ao contar (%)', t, SQLERRM;
    END;
  END LOOP;
END $$;


-- ─── 6. tenant_ai_settings: integrações (IA / Meta Ads) por clínica ───
-- Substitui, por clínica, a tabela global ai_settings (uma linha por provider para todo o SaaS).
CREATE TABLE IF NOT EXISTS tenant_ai_settings (
  tenant_id UUID NOT NULL,
  provider TEXT NOT NULL,
  api_key TEXT,
  model TEXT,
  enabled BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, provider)
);
-- config: dados extras por integração (o Meta Ads guarda o ad_account_id aqui).
ALTER TABLE IF EXISTS tenant_ai_settings ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;

-- Copia a configuração global provider='manus' só se houver UMA clínica real.
-- Com várias clínicas (inclui Legado com dados + clínica nova), a chave global não é atribuída.
DO $$
DECLARE
  v UUID := pg_temp.p0_clinica_unica();
  n INT;
BEGIN
  IF to_regclass('public.ai_settings') IS NULL OR to_regclass('public.tenant_ai_settings') IS NULL THEN
    RAISE NOTICE '[p0] ai_settings/tenant_ai_settings ausente, cópia pulada';
    RETURN;
  END IF;
  IF v IS NULL THEN
    SELECT count(*) INTO n FROM ai_settings WHERE provider = 'manus';
    IF n > 0 THEN
      RAISE NOTICE '[p0] ai_settings(manus): várias clínicas — não copiado; cada clínica deve cadastrar a própria chave';
    END IF;
    RETURN;
  END IF;
  INSERT INTO tenant_ai_settings (tenant_id, provider, api_key, model, enabled, updated_at)
  SELECT v, provider, api_key, model, COALESCE(enabled, true), NOW()
    FROM ai_settings
   WHERE provider = 'manus'
  ON CONFLICT (tenant_id, provider) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE '[p0] ai_settings(manus) copiado para a clínica única'; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[p0] cópia ai_settings -> tenant_ai_settings: falhou (%)', SQLERRM;
END $$;


-- ─── 7. Permissões para a aplicação (odonto_user) ─────────────
-- O deploy roda este arquivo como postgres; o que ele cria nasce com dono postgres.
-- A aplicação conecta como odonto_user (PG_USER) e, no boot, roda setval/nextval em
-- clinica_config_id_seq e lê/grava tenant_ai_settings.
-- Se as tabelas da app forem do odonto_user (o boot do server.mjs cria tabelas
-- conectado como ele), transfere a posse; em qualquer caso, concede os privilégios.
DO $$
DECLARE
  dono_app TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'odonto_user') THEN
    RAISE NOTICE '[p0] role odonto_user não existe, permissões puladas';
    RETURN;
  END IF;

  -- Dono de referência: o de pacientes (criada no boot do server.mjs).
  SELECT tableowner INTO dono_app FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes';

  IF to_regclass('public.tenant_ai_settings') IS NOT NULL THEN
    BEGIN
      IF dono_app = 'odonto_user' THEN
        ALTER TABLE public.tenant_ai_settings OWNER TO odonto_user;
      END IF;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_ai_settings TO odonto_user;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[p0] permissões tenant_ai_settings: falhou (%)', SQLERRM;
    END;
  END IF;

  IF to_regclass('public.clinica_config_id_seq') IS NOT NULL THEN
    BEGIN
      IF dono_app = 'odonto_user' THEN
        ALTER SEQUENCE public.clinica_config_id_seq OWNER TO odonto_user;
      END IF;
      -- UPDATE é necessário para o setval() que o boot executa.
      GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.clinica_config_id_seq TO odonto_user;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[p0] permissões clinica_config_id_seq: falhou (%)', SQLERRM;
    END;
  END IF;
END $$;


-- ─── Tokens antigos do Meta Ads ───────────────────────────────────────────
-- O token de cada clínica agora fica só em tenant_ai_settings. A coluna
-- meta_ads_accounts.access_token era compartilhada entre clínicas: apagar o
-- que restou dela (o app novo não lê nem grava mais esse campo).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'meta_ads_accounts' AND column_name = 'access_token') THEN
    UPDATE meta_ads_accounts SET access_token = '' WHERE COALESCE(access_token, '') <> '';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'meta_ads_accounts.access_token: limpeza ignorada (%)', SQLERRM;
END $$;

-- ─── Conferência (somente leitura; rodar manualmente antes e depois) ───
-- Linhas sem clínica por tabela (tabela inexistente dá erro só nessa linha — remova-a):
-- SELECT 'anamneses' t, COUNT(*) FROM anamneses WHERE tenant_id IS NULL
-- UNION ALL SELECT 'odontogramas', COUNT(*) FROM odontogramas WHERE tenant_id IS NULL
-- UNION ALL SELECT 'prontuarios', COUNT(*) FROM prontuarios WHERE tenant_id IS NULL
-- UNION ALL SELECT 'consultations', COUNT(*) FROM consultations WHERE tenant_id IS NULL
-- UNION ALL SELECT 'clinical_reports', COUNT(*) FROM clinical_reports WHERE tenant_id IS NULL
-- UNION ALL SELECT 'procedimento_execucoes', COUNT(*) FROM procedimento_execucoes WHERE tenant_id IS NULL
-- UNION ALL SELECT 'assinaturas_eletronicas', COUNT(*) FROM assinaturas_eletronicas WHERE tenant_id IS NULL
-- UNION ALL SELECT 'tratamentos', COUNT(*) FROM tratamentos WHERE tenant_id IS NULL
-- UNION ALL SELECT 'tratamento_etapas', COUNT(*) FROM tratamento_etapas WHERE tenant_id IS NULL
-- UNION ALL SELECT 'orcamentos', COUNT(*) FROM orcamentos WHERE tenant_id IS NULL
-- UNION ALL SELECT 'comissoes', COUNT(*) FROM comissoes WHERE tenant_id IS NULL
-- UNION ALL SELECT 'dentistas', COUNT(*) FROM dentistas WHERE tenant_id IS NULL
-- UNION ALL SELECT 'estoque', COUNT(*) FROM estoque WHERE tenant_id IS NULL
-- UNION ALL SELECT 'estoque_movimentos', COUNT(*) FROM estoque_movimentos WHERE tenant_id IS NULL
-- UNION ALL SELECT 'financeiro', COUNT(*) FROM financeiro WHERE tenant_id IS NULL
-- UNION ALL SELECT 'fin_bank_accounts', COUNT(*) FROM fin_bank_accounts WHERE tenant_id IS NULL
-- UNION ALL SELECT 'fin_employees', COUNT(*) FROM fin_employees WHERE tenant_id IS NULL
-- UNION ALL SELECT 'fin_payrolls', COUNT(*) FROM fin_payrolls WHERE tenant_id IS NULL
-- UNION ALL SELECT 'fin_bills', COUNT(*) FROM fin_bills WHERE tenant_id IS NULL
-- UNION ALL SELECT 'fin_movements', COUNT(*) FROM fin_movements WHERE tenant_id IS NULL
-- UNION ALL SELECT 'fin_overdue', COUNT(*) FROM fin_overdue WHERE tenant_id IS NULL
-- UNION ALL SELECT 'lead_tags', COUNT(*) FROM lead_tags WHERE tenant_id IS NULL
-- UNION ALL SELECT 'lead_tag_assignments', COUNT(*) FROM lead_tag_assignments WHERE tenant_id IS NULL
-- UNION ALL SELECT 'transfer_logs', COUNT(*) FROM transfer_logs WHERE tenant_id IS NULL
-- UNION ALL SELECT 'satisfaction_ratings', COUNT(*) FROM satisfaction_ratings WHERE tenant_id IS NULL
-- UNION ALL SELECT 'contatos', COUNT(*) FROM contatos WHERE tenant_id IS NULL
-- UNION ALL SELECT 'agenda_marcadores', COUNT(*) FROM agenda_marcadores WHERE tenant_id IS NULL
-- UNION ALL SELECT 'procedimentos_catalogo', COUNT(*) FROM procedimentos_catalogo WHERE tenant_id IS NULL
-- UNION ALL SELECT 'clinica_config', COUNT(*) FROM clinica_config WHERE tenant_id IS NULL
-- UNION ALL SELECT 'meta_ads_accounts', COUNT(*) FROM meta_ads_accounts WHERE tenant_id IS NULL
-- UNION ALL SELECT 'meta_ads_campaigns', COUNT(*) FROM meta_ads_campaigns WHERE tenant_id IS NULL
-- UNION ALL SELECT 'meta_ads_insights', COUNT(*) FROM meta_ads_insights WHERE tenant_id IS NULL
-- ORDER BY 2 DESC;
--
-- Registros atribuídos ao placeholder Legado (podem ser de uma clínica real; revisar):
-- SELECT 'dentistas' t, COUNT(*) FROM dentistas WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
-- UNION ALL SELECT 'pacientes', COUNT(*) FROM pacientes WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
--
-- Dono e privilégios do que este arquivo cria:
-- SELECT tablename, tableowner FROM pg_tables WHERE tablename IN ('tenant_ai_settings','clinica_config','pacientes');
-- SELECT has_sequence_privilege('odonto_user', 'clinica_config_id_seq', 'USAGE,UPDATE');
