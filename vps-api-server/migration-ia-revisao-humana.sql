-- IA clínica com revisão humana (auditoria jurídica de IA, R1/R2/R7).
-- O relatório gerado por IA nasce como rascunho e só fica oficial quando o dentista aprova
-- (Lei 13.787 art. 2º; LGPD art. 20). Exportações em massa ficam registradas (LGPD arts. 37 e 46).
-- Idempotente: pode rodar N vezes. Não apaga nada.
-- Rollback: as colunas e a tabela são novas e opcionais, podem ficar. Se precisar desfazer:
--   ALTER TABLE clinical_reports DROP CONSTRAINT IF EXISTS clinical_reports_status_check;
--   (perde só a validação; as colunas guardam quem aprovou e não devem ser removidas)
--   DROP TABLE IF EXISTS exportacoes_relatorios_ia;  -- perde o histórico de exportações

ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS gerado_por_ia BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS report_ia_original TEXT;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS aprovado_por TEXT;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS aprovado_por_nome TEXT;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS aprovado_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS origem_ia_sem_revisao BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS transcricao_apagada_em TIMESTAMPTZ;

-- Relatórios gravados antes desta mudança entraram no prontuário sem revisão: ficam marcados,
-- com o aviso na tela, e podem ser aprovados depois. O texto da IA é preservado como original.
-- Só toca linhas sem status (as antigas); na segunda execução não muda nada.
UPDATE clinical_reports
   SET status = 'rascunho',
       origem_ia_sem_revisao = true,
       report_ia_original = COALESCE(report_ia_original, report)
 WHERE status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_reports_status_check') THEN
    ALTER TABLE clinical_reports ADD CONSTRAINT clinical_reports_status_check
      CHECK (status IN ('rascunho', 'aprovado'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clinical_reports_tenant_status ON clinical_reports (tenant_id, status, created_at DESC);

-- Registro de cada exportação de relatórios clínicos (quem, quando, quantos, com quais filtros).
-- Quando a tabela acessos_prontuario (PR #59) existir, a exportação também é gravada lá, por paciente.
CREATE TABLE IF NOT EXISTS exportacoes_relatorios_ia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT get_current_tenant_id() REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id TEXT,
  usuario_email TEXT,
  quantidade INTEGER NOT NULL DEFAULT 0,
  filtros JSONB,
  formato TEXT NOT NULL DEFAULT 'csv',
  em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_exportacoes_relatorios_ia_tenant ON exportacoes_relatorios_ia (tenant_id, em DESC);
ALTER TABLE exportacoes_relatorios_ia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON exportacoes_relatorios_ia;
CREATE POLICY tenant_isolation_policy ON exportacoes_relatorios_ia FOR ALL
  USING (is_super_admin() OR tenant_id = get_current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = get_current_tenant_id());
