-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — FULL AUDIT MIGRATION
-- Adds ALL missing tables, columns, indexes for modules
-- that were using mock data.
-- Run: sudo -u postgres psql -p 5433 -d odonto_db -f migration-full-audit.sql
-- ═══════════════════════════════════════════════════════════

-- ─── 1. DENTISTAS — add missing columns ─────────────────────
ALTER TABLE dentistas ADD COLUMN IF NOT EXISTS cor_agenda TEXT DEFAULT '#3B82F6';
ALTER TABLE dentistas ADD COLUMN IF NOT EXISTS sala TEXT;

-- ─── 2. FINANCEIRO — add missing columns ────────────────────
ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pago';
ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS vencimento DATE;
ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS parcelas INTEGER DEFAULT 1;
ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS parcela_atual INTEGER DEFAULT 1;
ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS recorrente BOOLEAN DEFAULT false;
ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ─── 3. ESTOQUE — add missing columns + movements table ────
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS localizacao TEXT;
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS validade DATE;
ALTER TABLE estoque ADD COLUMN IF NOT EXISTS lote TEXT;

CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES estoque(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
  quantidade INTEGER NOT NULL,
  motivo TEXT,
  usuario_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_item ON estoque_movimentos(item_id);
CREATE INDEX IF NOT EXISTS idx_estoque_movimentos_created ON estoque_movimentos(created_at DESC);

-- ─── 4. TRATAMENTOS — add missing columns + steps table ─────
ALTER TABLE tratamentos ADD COLUMN IF NOT EXISTS plano TEXT;
ALTER TABLE tratamentos ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE tratamentos ADD COLUMN IF NOT EXISTS orcamento_id UUID REFERENCES orcamentos(id);

CREATE TABLE IF NOT EXISTS tratamento_etapas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tratamento_id UUID NOT NULL REFERENCES tratamentos(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  dente TEXT,
  valor NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'agendado', 'realizado', 'cancelado')),
  data_realizada DATE,
  dentista_id UUID REFERENCES dentistas(id),
  observacoes TEXT,
  ordem INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tratamento_etapas_tratamento ON tratamento_etapas(tratamento_id);

-- ─── 5. COMISSÕES — add missing columns ─────────────────────
ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS paciente_id UUID REFERENCES pacientes(id);
ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS procedimento TEXT;
ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'pago'));
ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ─── 6. PRONTUÁRIOS — add missing columns ───────────────────
ALTER TABLE prontuarios ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'evolucao';
ALTER TABLE prontuarios ADD COLUMN IF NOT EXISTS titulo TEXT;

-- ─── 7. ORÇAMENTOS — add missing columns ────────────────────
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS observacoes TEXT;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS forma_pagamento TEXT;
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS parcelas INTEGER DEFAULT 1;

-- ─── 8. ODONTOGRAMAS — ensure table exists ───────────────────
CREATE TABLE IF NOT EXISTS odontogramas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id UUID NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  dentes JSONB DEFAULT '[]',
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(paciente_id)
);
CREATE INDEX IF NOT EXISTS idx_odontogramas_paciente ON odontogramas(paciente_id);

-- ─── 9. ADDITIONAL INDEXES ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tratamentos_paciente ON tratamentos(paciente_id);
CREATE INDEX IF NOT EXISTS idx_tratamentos_dentista ON tratamentos(dentista_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_dentista ON comissoes(dentista_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_data ON comissoes(data);
CREATE INDEX IF NOT EXISTS idx_prontuarios_paciente ON prontuarios(paciente_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_paciente ON orcamentos(paciente_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_status ON orcamentos(status);
CREATE INDEX IF NOT EXISTS idx_financeiro_status ON financeiro(status);
CREATE INDEX IF NOT EXISTS idx_estoque_nome ON estoque(nome);

-- ═══════════════════════════════════════════════════════════
-- DONE. All tables and columns ready for full integration.
-- ═══════════════════════════════════════════════════════════
