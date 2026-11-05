-- Consentimento de gravação e transcrição por IA, versão 2.0 — pacote de evidências do parecer
-- da Helena (docs/juridico/consentimento-transcricao-ia.md, seção 3). Idempotente: pode rodar N vezes.
-- Rollback: colunas opcionais, podem ficar (o código antigo não as lê).
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS texto_hash TEXT;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS decisao TEXT;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS assinante_nome TEXT;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS assinante_tipo TEXT;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS assinante_vinculo TEXT;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS responsavel_documento TEXT;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS adolescente_ciente BOOLEAN;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS idade_informada INTEGER;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS assinatura_id TEXT;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS profissional_presente_nome TEXT;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS copia_oferecida BOOLEAN DEFAULT false;
ALTER TABLE IF EXISTS consentimentos_pacientes ADD COLUMN IF NOT EXISTS revogacao_canal TEXT;
-- Valores aceitos (NULL = registro v1.0, anterior a esta migração).
DO $$ BEGIN
  ALTER TABLE consentimentos_pacientes ADD CONSTRAINT consentimentos_decisao_chk
    CHECK (decisao IS NULL OR decisao IN ('autorizo', 'nao_autorizo'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE consentimentos_pacientes ADD CONSTRAINT consentimentos_assinante_tipo_chk
    CHECK (assinante_tipo IS NULL OR assinante_tipo IN ('paciente', 'responsavel'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;
