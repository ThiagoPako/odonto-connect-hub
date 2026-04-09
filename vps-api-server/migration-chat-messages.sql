-- ═══════════════════════════════════════════════════════════
-- Odonto Connect — Chat Messages Migration
-- Persistência de histórico de conversas
-- Run: psql -U odonto_user -d odonto_db -f migration-chat-messages.sql
-- ═══════════════════════════════════════════════════════════

-- Tabela de mensagens do chat (histórico completo)
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  content TEXT,
  sender TEXT NOT NULL CHECK (sender IN ('lead', 'attendant', 'system')),
  type TEXT NOT NULL DEFAULT 'text',
  status TEXT DEFAULT 'sent',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  media_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  reply_to_id TEXT,
  reply_to_content TEXT,
  reply_to_sender TEXT,
  attendant_id UUID REFERENCES profiles(id),
  attendant_name TEXT,
  instance TEXT,
  phone TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_chat_messages_lead_id ON chat_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(lead_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_phone ON chat_messages(phone);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC);

-- Tabela para tracking de mensagens não lidas por atendente
CREATE TABLE IF NOT EXISTS chat_read_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_read_status_user ON chat_read_status(user_id);
