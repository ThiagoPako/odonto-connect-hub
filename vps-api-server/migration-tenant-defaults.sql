-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — tenant_id automático
-- Várias rotas inserem sem tenant_id e contam com o RLS. Com o contexto da
-- requisição aplicado na transação (server.mjs), o DEFAULT preenche a clínica.
-- Idempotente: roda em todo deploy.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
  BEGIN
    RETURN NULLIF(current_setting('app.tenant_id', true), '')::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
$$ LANGUAGE plpgsql STABLE;

DO $$
DECLARE
  t TEXT;
  only_tenant UUID;
  n_tenants INT;
  fixed INT;
  orphans INT;
  tables_to_default TEXT[] := ARRAY[
    'pacientes', 'dentistas', 'agendamentos', 'financeiro', 'tratamentos',
    'orcamentos', 'crm_leads', 'estoque', 'comissoes', 'prontuarios',
    'anamneses', 'attendance_queues', 'attendance_sessions', 'satisfaction_ratings',
    'lead_tags', 'lead_tag_assignments', 'contatos', 'odontogramas',
    'transfer_logs', 'estoque_movimentos', 'tratamento_etapas', 'chat_messages',
    'chat_read_status', 'kanban_movements', 'consultations', 'clinical_reports',
    'push_subscriptions', 'reactivation_rules', 'reactivation_sends',
    'meta_ads_accounts', 'meta_ads_campaigns', 'meta_ads_insights',
    'user_preferences', 'fin_bank_accounts', 'fin_employees', 'fin_payrolls',
    'fin_bills', 'fin_movements', 'fin_overdue', 'agenda_marcadores',
    'procedimentos_catalogo', 'exames'
  ];
BEGIN
  SELECT count(*) INTO n_tenants FROM tenants;
  IF n_tenants = 1 THEN SELECT id INTO only_tenant FROM tenants LIMIT 1; END IF;

  FOREACH t IN ARRAY tables_to_default LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT get_current_tenant_id()', t);

      -- Registros antigos sem clínica: só dá para atribuir com segurança se houver uma clínica.
      IF only_tenant IS NOT NULL THEN
        EXECUTE format('UPDATE %I SET tenant_id = $1 WHERE tenant_id IS NULL', t) USING only_tenant;
        GET DIAGNOSTICS fixed = ROW_COUNT;
        IF fixed > 0 THEN RAISE NOTICE '% : % registros sem clínica atribuídos à clínica única', t, fixed; END IF;
      ELSE
        EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', t) INTO orphans;
        IF orphans > 0 THEN RAISE NOTICE '% : % registros sem clínica (várias clínicas — revisar manualmente)', t, orphans; END IF;
      END IF;
    END IF;
  END LOOP;
END $$;
