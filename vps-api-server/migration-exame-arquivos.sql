-- Imagens e arquivos de exame (raio-x, tomografia, PDF) com dono registrado.
-- Dado de saúde: o arquivo fica em uploads/exames/<tenant_id>/ (fora do /uploads/media público)
-- e só é entregue pela API a quem é da clínica. Idempotente: pode rodar N vezes.
-- Rollback: DROP TABLE exame_arquivos (perde só o vínculo; os arquivos continuam no disco).
-- Nenhuma linha é apagada pela aplicação: "remover" marca removido_em (prontuário, Lei 13.787 art. 6º).
CREATE TABLE IF NOT EXISTS exame_arquivos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exame_id       UUID NOT NULL REFERENCES exames(id) ON DELETE CASCADE,
  paciente_id    UUID,
  caminho        TEXT NOT NULL UNIQUE,
  nome_original  TEXT,
  mime_type      TEXT NOT NULL,
  tamanho_bytes  BIGINT NOT NULL DEFAULT 0,
  descricao      TEXT,
  enviado_por    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removido_em    TIMESTAMPTZ,
  removido_por   UUID
);
-- Anexo do pedido (requisição) não é resultado: não bloqueia excluir o pedido nem muda status
ALTER TABLE exame_arquivos ADD COLUMN IF NOT EXISTS anexo_do_pedido BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_exame_arquivos_tenant_exame ON exame_arquivos (tenant_id, exame_id);
CREATE INDEX IF NOT EXISTS idx_exame_arquivos_tenant_paciente ON exame_arquivos (tenant_id, paciente_id);

-- Quem cria a tabela é a própria API no boot (dona = usuário da API). Este arquivo NÃO está
-- no deploy.yml; se for rodado à mão como postgres, a tabela passa para o dono de pacientes,
-- para a API não receber "permissão negada".
-- RLS fica DESLIGADA por enquanto: a rota de link assinado roda sem contexto de clínica e a
-- RLS entra junto com a virada do FORCE (migration-force-rls.sql). O filtro por tenant_id
-- está em todas as queries da API.
DO $$
DECLARE dono TEXT := (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pacientes');
BEGIN
  IF dono IS NOT NULL AND (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'exame_arquivos') <> dono THEN
    EXECUTE format('ALTER TABLE public.exame_arquivos OWNER TO %I', dono);
  END IF;
END $$;
