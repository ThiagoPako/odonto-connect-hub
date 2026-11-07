-- Comercial (CRM de vendas da própria Odonto Connect) — buscador e base de leads.
-- Desenho: docs/produto/console-comercial.md §7 (tabelas com_*, SEM tenant_id: são da empresa,
-- não de uma clínica). Nenhuma rota de clínica lê estas tabelas; só /api/super-admin/comercial/* (super-admin
-- e equipe comercial interna). Idempotente: pode rodar N vezes.
--
-- Roda só no BOOT (ensureComercialLeadsSchema em server.mjs), de propósito fora do deploy.yml:
-- criada pelo psql do deploy a tabela ficaria com dono postgres e o usuário da API não a leria
-- (mesmo problema de migration-dono-tabelas-deploy.sql). Criada no boot, o dono é o usuário da API.
--
-- Google Places: os Termos do Google Maps Platform só permitem guardar o place_id sem prazo
-- (developers.google.com/maps/documentation/places/web-service/policies, lido em 07/11/2026).
-- Por isso lead vindo da Places API guarda place_id + data da consulta, e NÃO nome/endereço/telefone;
-- esses campos só são gravados quando o vendedor confirma os dados com a própria clínica
-- (dados_confirmados_em) ou quando vêm de CSV/cadastro manual.
--
-- Rollback: DROP TABLE com_auditoria, com_places_uso, com_config, com_supressao, com_leads, com_equipe;
-- (perde a base de leads comerciais; nada do app das clínicas depende delas).

CREATE TABLE IF NOT EXISTS com_equipe (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  papel TEXT NOT NULL CHECK (papel IN ('gestor', 'vendedor', 'sdr')),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS com_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_nome TEXT,
  cnpj TEXT,
  cidade TEXT,
  uf TEXT,
  endereco TEXT,
  site TEXT,
  site_dominio TEXT,
  telefone_comercial TEXT,
  telefone_norm TEXT,
  email_comercial TEXT,
  email_pessoal BOOLEAN NOT NULL DEFAULT false,      -- e-mail de provedor gratuito = dado pessoal do dentista (LGPD)
  categoria TEXT,
  redes JSONB NOT NULL DEFAULT '{}'::jsonb,
  nota_avaliacao NUMERIC(2,1),
  total_avaliacoes INTEGER,
  origem TEXT NOT NULL CHECK (origem IN ('google_places', 'csv', 'manual', 'site', 'teste_gratis')),
  origem_detalhe TEXT,                               -- ex.: "CSV google-maps-scraper-kit · base própria · arquivo x.csv"
  campanha TEXT,
  base_legal TEXT NOT NULL DEFAULT 'legitimo_interesse',
  place_id TEXT,
  tipo_busca TEXT,
  google_consultado_em TIMESTAMPTZ,
  dados_confirmados_em TIMESTAMPTZ,
  dados_confirmados_por UUID,
  dono_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  etapa TEXT NOT NULL DEFAULT 'novo' CHECK (etapa IN ('novo', 'qualificado', 'reuniao_marcada', 'demonstracao_feita', 'proposta', 'teste_gratis', 'ganho', 'perdido')),
  notas TEXT,
  nao_contatar BOOLEAN NOT NULL DEFAULT false,
  nao_contatar_em TIMESTAMPTZ,
  nao_contatar_motivo TEXT,
  canal_whatsapp_permitido BOOLEAN NOT NULL DEFAULT false, -- frio/importado: sem WhatsApp (política da Meta exige opt-in)
  tenant_id_cliente UUID,                            -- só referência, quando o lead é (ou vira) clínica cliente
  criado_por UUID,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_com_leads_place_id ON com_leads (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_com_leads_telefone ON com_leads (telefone_norm) WHERE telefone_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_com_leads_dominio ON com_leads (site_dominio) WHERE site_dominio IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_com_leads_dono_etapa ON com_leads (dono_id, etapa);
CREATE INDEX IF NOT EXISTS idx_com_leads_criado ON com_leads (criado_em DESC);

-- Lista de supressão ("não contatar"): só HMAC (chave em COM_SUPRESSAO_HMAC_KEY, fora do banco), sem dado em claro.
CREATE TABLE IF NOT EXISTS com_supressao (
  hmac TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('telefone', 'email', 'cnpj', 'place_id', 'dominio')),
  motivo TEXT,
  criado_por UUID,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS com_config (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  atualizado_por UUID,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gasto estimado com a Google Maps Platform por dia (limite diário configurável).
CREATE TABLE IF NOT EXISTS com_places_uso (
  dia DATE PRIMARY KEY,
  chamadas INTEGER NOT NULL DEFAULT 0,
  custo_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auditoria do comercial: o código só faz INSERT. Sem dado de paciente.
CREATE TABLE IF NOT EXISTS com_auditoria (
  id BIGSERIAL PRIMARY KEY,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ator_id UUID,
  ator_papel TEXT,
  acao TEXT NOT NULL,
  alvo_tipo TEXT,
  alvo_id TEXT,
  detalhe JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_com_auditoria_criado ON com_auditoria (criado_em DESC);
