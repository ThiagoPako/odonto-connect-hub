-- Remove polluted "Mensagem não suportada" messages and bogus leads with non-E.164 phones (LIDs/community IDs).
DELETE FROM chat_messages WHERE content = '[Mensagem não suportada]';
DELETE FROM crm_leads WHERE LENGTH(REGEXP_REPLACE(COALESCE(telefone, ''), '\D', '', 'g')) > 15;