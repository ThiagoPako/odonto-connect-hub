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
-- Dentista do atendimento (quem aprova) e dados de quem aprovou ou não aprovou (nome e CRO).
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS dentista_id UUID;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS aprovado_por_cro TEXT;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS aprovado_por_dentista_id UUID;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS aprovado_por_outro_dentista BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS nao_aprovado_por TEXT;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS nao_aprovado_por_nome TEXT;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS nao_aprovado_por_cro TEXT;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS nao_aprovado_em TIMESTAMPTZ;
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS nao_aprovado_motivo TEXT;
-- Início do prazo de revisão do rascunho (o prazo em dias é configurável por clínica).
ALTER TABLE IF EXISTS clinical_reports ADD COLUMN IF NOT EXISTS revisao_pendente_desde TIMESTAMPTZ;

-- Relatórios gravados antes desta mudança foram gerados sem revisão (e com o prompt antigo):
-- ficam guardados como rascunho antigo, FORA do prontuário oficial, da impressão e das
-- exportações, até um dentista aprovar ou não aprovar. O prazo de revisão conta a partir daqui.
-- Só toca linhas sem status (as antigas); na segunda execução não muda nada. Nada é apagado.
UPDATE clinical_reports
   SET status = 'rascunho',
       origem_ia_sem_revisao = true,
       report_ia_original = COALESCE(report_ia_original, report),
       revisao_pendente_desde = NOW()
 WHERE status IS NULL;
UPDATE clinical_reports
   SET revisao_pendente_desde = COALESCE(CASE WHEN origem_ia_sem_revisao THEN NOW() END, created_at)
 WHERE status = 'rascunho' AND revisao_pendente_desde IS NULL;

-- Dentista do atendimento dos relatórios já gravados: o dentista com o e-mail de quem gerou.
UPDATE clinical_reports r SET dentista_id = d.id
  FROM profiles p, dentistas d
 WHERE r.dentista_id IS NULL AND p.id::text = r.attendant_id
   AND d.tenant_id = r.tenant_id AND LOWER(d.email) = LOWER(p.email);

-- Status: rascunho, aprovado (pelo dentista) ou nao_aprovado (guardado só para auditoria).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_reports_status_check'
              AND pg_get_constraintdef(oid) NOT LIKE '%nao_aprovado%') THEN
    ALTER TABLE clinical_reports DROP CONSTRAINT clinical_reports_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinical_reports_status_check') THEN
    ALTER TABLE clinical_reports ADD CONSTRAINT clinical_reports_status_check
      CHECK (status IN ('rascunho', 'aprovado', 'nao_aprovado'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clinical_reports_tenant_status ON clinical_reports (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_reports_tenant_dentista ON clinical_reports (tenant_id, dentista_id, status);

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
