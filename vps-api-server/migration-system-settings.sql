-- System Settings table for persisting configuration
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default follow-up automation config
INSERT INTO system_settings (key, value) VALUES (
  'followup_automation',
  '{"enabled":true,"stages":["followup","followup_2","followup_3"],"messages":{"followup":"Olá {{nome}}! 😊 Obrigado pelo seu contato com a Odonto Connect. Gostaríamos de saber: podemos ajudar com mais alguma informação sobre o tratamento que conversamos? Estamos à disposição!","followup_2":"{{nome}}, passando para dar um oi! 👋 Ainda temos condições especiais para o procedimento que conversamos. Quer saber mais? Responda esta mensagem!","followup_3":"Oi {{nome}}, última chamada! 🦷 Seu orçamento ainda está disponível e temos horários esta semana. Posso agendar uma avaliação para você?"},"delaySeconds":30}'
) ON CONFLICT (key) DO NOTHING;
