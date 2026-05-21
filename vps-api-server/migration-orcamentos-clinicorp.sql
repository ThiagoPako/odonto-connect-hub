-- Adicionando colunas de compatibilidade Clinicorp e multi-tenant na tabela orcamentos
-- Esta migração deve ser rodada manualmente no VPS se necessário

DO $$ 
BEGIN
  -- 1. Coluna de mapeamento Clinicorp
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orcamentos' AND column_name = 'clinicorp_estimate_id') THEN
    ALTER TABLE orcamentos ADD COLUMN clinicorp_estimate_id TEXT;
  END IF;

  -- 2. Coluna tenant_id para isolamento SaaS
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orcamentos' AND column_name = 'tenant_id') THEN
    ALTER TABLE orcamentos ADD COLUMN tenant_id UUID;
  END IF;

  -- 3. Renomear 'valor' para 'valor_total' se existir a coluna antiga (padronização com frontend)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orcamentos' AND column_name = 'valor') 
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orcamentos' AND column_name = 'valor_total') THEN
    ALTER TABLE orcamentos RENAME COLUMN valor TO valor_total;
  END IF;

  -- 4. Criar coluna 'validade' (que mapeia para a data do Clinicorp na projeção)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orcamentos' AND column_name = 'validade') THEN
    -- No Clinicorp chamamos de 'data', localmente 'validade' ou 'data'
    -- Se já existir 'data' e não existir 'validade', criamos validade
    ALTER TABLE orcamentos ADD COLUMN validade TIMESTAMPTZ;
  END IF;

  -- 5. Backfill tenant_id se estiver NULL
  DECLARE
    v_tenant_id UUID;
  BEGIN
    SELECT tenant_id INTO v_tenant_id FROM profiles WHERE role = 'admin' AND tenant_id IS NOT NULL ORDER BY created_at ASC LIMIT 1;
    IF v_tenant_id IS NOT NULL THEN
      UPDATE orcamentos SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
    END IF;
  END;

END $$;
