-- ============================================================================
-- Módulo Exames (Cfaz) — centro de imagem odontológica
-- Tabelas: exame_tipos (catálogo), exames (ordens de exame)
-- ============================================================================

-- Catálogo de tipos de exame (por tenant)
CREATE TABLE IF NOT EXISTS exame_tipos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  categoria     text,                       -- ex: Radiografia, Tomografia, Laudo
  codigo_tiss   text,
  preco         numeric(10,2) DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_exame_tipos_tenant ON exame_tipos(tenant_id);

-- Ordens de exame (Pedidos)
CREATE TABLE IF NOT EXISTS exames (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid REFERENCES tenants(id) ON DELETE CASCADE,
  codigo            text,                   -- número do pedido (gerado)
  paciente_id       uuid REFERENCES pacientes(id) ON DELETE SET NULL,
  dentista_solicitante_id uuid REFERENCES dentistas(id) ON DELETE SET NULL,
  clinica_origem    text,                   -- nome da clínica solicitante (texto livre por enquanto)
  tipo_exame_id     uuid REFERENCES exame_tipos(id) ON DELETE SET NULL,
  tipo_nome         text NOT NULL,          -- snapshot do nome
  status            text NOT NULL DEFAULT 'novo'
                    CHECK (status IN ('novo','em_andamento','aguardando_laudo','concluido','entregue','cancelado')),
  prioridade        text NOT NULL DEFAULT 'normal'
                    CHECK (prioridade IN ('baixa','normal','alta','urgente')),
  data_solicitacao  timestamptz NOT NULL DEFAULT now(),
  data_realizacao   timestamptz,
  data_entrega      timestamptz,
  valor             numeric(10,2) DEFAULT 0,
  modo_entrega      text,                   -- digital, impresso, retirada
  laudo_texto       text,
  arquivo_url       text,                   -- imagem/laudo final
  observacoes       text,
  terceirizado      boolean NOT NULL DEFAULT false,
  fornecedor_terc   text,                   -- quando terceirizado
  created_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exames_tenant         ON exames(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exames_status         ON exames(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_exames_paciente       ON exames(paciente_id);
CREATE INDEX IF NOT EXISTS idx_exames_data_solic     ON exames(tenant_id, data_solicitacao DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION exames_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_exames_updated ON exames;
CREATE TRIGGER trg_exames_updated BEFORE UPDATE ON exames
  FOR EACH ROW EXECUTE FUNCTION exames_touch_updated_at();

DROP TRIGGER IF EXISTS trg_exame_tipos_updated ON exame_tipos;
CREATE TRIGGER trg_exame_tipos_updated BEFORE UPDATE ON exame_tipos
  FOR EACH ROW EXECUTE FUNCTION exames_touch_updated_at();

-- RLS
ALTER TABLE exames      ENABLE ROW LEVEL SECURITY;
ALTER TABLE exame_tipos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exames_tenant_isolation ON exames;
CREATE POLICY exames_tenant_isolation ON exames
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS exame_tipos_tenant_isolation ON exame_tipos;
CREATE POLICY exame_tipos_tenant_isolation ON exame_tipos
  USING (
    current_setting('app.is_super_admin', true) = 'true'
    OR tenant_id::text = current_setting('app.current_tenant_id', true)
  );

-- Seed: tipos de exame padrão para tenants sem catálogo
INSERT INTO exame_tipos (tenant_id, nome, categoria, preco)
SELECT t.id, x.nome, x.categoria, x.preco
FROM tenants t
CROSS JOIN (VALUES
  ('Laudo Descritivo',           'Laudo',       80.00),
  ('Cefalometria Lateral',       'Radiografia', 120.00),
  ('Cefalometria Frontal',       'Radiografia', 120.00),
  ('Radiografia Panorâmica',     'Radiografia', 90.00),
  ('Radiografia Periapical',     'Radiografia', 35.00),
  ('Tomografia Computadorizada', 'Tomografia',  350.00),
  ('Documentação Ortodôntica',   'Documentação',280.00),
  ('Modelo Digital',             'Modelo',      150.00)
) AS x(nome, categoria, preco)
WHERE NOT EXISTS (
  SELECT 1 FROM exame_tipos et WHERE et.tenant_id = t.id AND et.nome = x.nome
);
