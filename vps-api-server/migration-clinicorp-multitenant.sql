-- ============================================================
-- Multi-tenant isolation for Clinicorp mirror tables
-- - Adiciona tenant_id em todas as tabelas espelho
-- - Converte PKs para (id, tenant_id) para evitar colisão entre clínicas
-- - Mescla dentistas duplicados por (tenant_id, LOWER(TRIM(nome)))
-- ============================================================

-- 1) Adiciona tenant_id nas tabelas espelho
ALTER TABLE clinicorp_clinics                ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE clinicorp_professionals          ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE clinicorp_chairs                 ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE clinicorp_appointment_categories ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE clinicorp_specialties            ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE clinicorp_patients               ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE clinicorp_appointments           ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE clinicorp_estimates              ADD COLUMN IF NOT EXISTS tenant_id UUID;

-- 2) Backfill: associa registros existentes ao tenant atual (se houver apenas 1 tenant ativo
--    com credenciais Clinicorp, atribui tudo a ele). Caso multi-tenant já exista, ignora.
DO $$
DECLARE
  v_tenant_id UUID;
  v_count INT;
BEGIN
  SELECT COUNT(DISTINCT tenant_id) INTO v_count FROM clinicorp_user_credentials WHERE tenant_id IS NOT NULL;
  IF v_count = 1 THEN
    SELECT tenant_id INTO v_tenant_id FROM clinicorp_user_credentials WHERE tenant_id IS NOT NULL LIMIT 1;
    UPDATE clinicorp_clinics                SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
    UPDATE clinicorp_professionals          SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
    UPDATE clinicorp_chairs                 SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
    UPDATE clinicorp_appointment_categories SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
    UPDATE clinicorp_specialties            SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
    UPDATE clinicorp_patients               SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
    UPDATE clinicorp_appointments           SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
    UPDATE clinicorp_estimates              SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- clinicorp_user_credentials ainda não existe; ignora backfill
  NULL;
END $$;

-- 3) Recria PKs como compostas (id, tenant_id) para permitir múltiplos tenants
DO $$
BEGIN
  -- clinicorp_clinics
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinicorp_clinics_pkey') THEN
    ALTER TABLE clinicorp_clinics DROP CONSTRAINT clinicorp_clinics_pkey;
  END IF;
  ALTER TABLE clinicorp_clinics ADD CONSTRAINT clinicorp_clinics_pkey PRIMARY KEY (id, tenant_id);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinicorp_professionals_pkey') THEN
    ALTER TABLE clinicorp_professionals DROP CONSTRAINT clinicorp_professionals_pkey;
  END IF;
  ALTER TABLE clinicorp_professionals ADD CONSTRAINT clinicorp_professionals_pkey PRIMARY KEY (id, tenant_id);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinicorp_chairs_pkey') THEN
    ALTER TABLE clinicorp_chairs DROP CONSTRAINT clinicorp_chairs_pkey;
  END IF;
  ALTER TABLE clinicorp_chairs ADD CONSTRAINT clinicorp_chairs_pkey PRIMARY KEY (id, tenant_id);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinicorp_appointment_categories_pkey') THEN
    ALTER TABLE clinicorp_appointment_categories DROP CONSTRAINT clinicorp_appointment_categories_pkey;
  END IF;
  ALTER TABLE clinicorp_appointment_categories ADD CONSTRAINT clinicorp_appointment_categories_pkey PRIMARY KEY (id, tenant_id);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinicorp_specialties_pkey') THEN
    ALTER TABLE clinicorp_specialties DROP CONSTRAINT clinicorp_specialties_pkey;
  END IF;
  ALTER TABLE clinicorp_specialties ADD CONSTRAINT clinicorp_specialties_pkey PRIMARY KEY (id, tenant_id);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinicorp_patients_pkey') THEN
    ALTER TABLE clinicorp_patients DROP CONSTRAINT clinicorp_patients_pkey;
  END IF;
  ALTER TABLE clinicorp_patients ADD CONSTRAINT clinicorp_patients_pkey PRIMARY KEY (id, tenant_id);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinicorp_appointments_pkey') THEN
    ALTER TABLE clinicorp_appointments DROP CONSTRAINT clinicorp_appointments_pkey;
  END IF;
  ALTER TABLE clinicorp_appointments ADD CONSTRAINT clinicorp_appointments_pkey PRIMARY KEY (id, tenant_id);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clinicorp_estimates_pkey') THEN
    ALTER TABLE clinicorp_estimates DROP CONSTRAINT clinicorp_estimates_pkey;
  END IF;
  ALTER TABLE clinicorp_estimates ADD CONSTRAINT clinicorp_estimates_pkey PRIMARY KEY (id, tenant_id);
EXCEPTION WHEN OTHERS THEN
  -- Alguma tabela pode ter tenant_id NULL ainda; nesse caso pula a recriação de PK
  RAISE NOTICE 'Skipping PK conversion: %', SQLERRM;
END $$;

-- 4) Índices auxiliares por tenant
CREATE INDEX IF NOT EXISTS idx_clinicorp_appts_tenant ON clinicorp_appointments(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_clinicorp_pats_tenant ON clinicorp_patients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clinicorp_profs_tenant ON clinicorp_professionals(tenant_id);

-- 5) Mescla dentistas duplicados dentro do mesmo tenant por LOWER(TRIM(nome))
--    Mantém o mais antigo, repõe FKs nos dependentes e remove o duplicado.
DO $$
DECLARE
  r RECORD;
  keep_id UUID;
BEGIN
  FOR r IN
    SELECT tenant_id, LOWER(TRIM(nome)) AS nome_key, ARRAY_AGG(id ORDER BY created_at NULLS FIRST, id) AS ids
    FROM dentistas
    WHERE nome IS NOT NULL AND TRIM(nome) <> ''
    GROUP BY tenant_id, LOWER(TRIM(nome))
    HAVING COUNT(*) > 1
  LOOP
    keep_id := r.ids[1];
    -- Reaponta agendamentos, orçamentos e outras dependências para o mantido
    UPDATE agendamentos      SET dentista_id = keep_id WHERE dentista_id = ANY(r.ids) AND dentista_id <> keep_id;
    BEGIN UPDATE orcamentos  SET dentista_id = keep_id WHERE dentista_id = ANY(r.ids) AND dentista_id <> keep_id; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN UPDATE tratamentos SET dentista_id = keep_id WHERE dentista_id = ANY(r.ids) AND dentista_id <> keep_id; EXCEPTION WHEN undefined_column OR undefined_table THEN NULL; END;
    -- Remove duplicados
    DELETE FROM dentistas WHERE id = ANY(r.ids) AND id <> keep_id;
  END LOOP;
END $$;

-- 6) Limpa "Profissional NNNNN" quando já existir o nome real em clinicorp_professionals
UPDATE dentistas d
SET nome = cp.full_name, updated_at = NOW()
FROM clinicorp_professionals cp
WHERE d.clinicorp_professional_id = cp.id::text
  AND d.nome ~ '^Profissional\s+\d+'
  AND cp.full_name IS NOT NULL
  AND cp.full_name <> ''
  AND NOT (cp.full_name ~ '^Profissional\s+\d+');

-- 7) Índice único por (tenant_id, LOWER(TRIM(nome))) p/ evitar futuros duplicados
CREATE UNIQUE INDEX IF NOT EXISTS uq_dentistas_tenant_nome
  ON dentistas (tenant_id, LOWER(TRIM(nome)))
  WHERE nome IS NOT NULL AND TRIM(nome) <> '';
