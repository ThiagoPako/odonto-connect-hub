-- Remove leads created from non-phone identifiers (LIDs / community IDs).
-- Real phones have between 10 and 13 digits; anything outside that came from
-- the WhatsApp import grabbing community/channel IDs by mistake.

WITH bad_leads AS (
  SELECT id::text AS id, telefone
  FROM public.crm_leads
  WHERE telefone IS NOT NULL
    AND (
      length(regexp_replace(telefone, '\D', '', 'g')) < 10
      OR length(regexp_replace(telefone, '\D', '', 'g')) > 13
    )
)
DELETE FROM public.chat_messages
WHERE lead_id IN (SELECT id FROM bad_leads)
   OR length(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')) > 13
   OR length(regexp_replace(COALESCE(phone, ''), '\D', '', 'g')) < 10;

DELETE FROM public.attendance_sessions
WHERE lead_id IN (
  SELECT id::text FROM public.crm_leads
  WHERE length(regexp_replace(COALESCE(telefone, ''), '\D', '', 'g')) NOT BETWEEN 10 AND 13
);

DELETE FROM public.crm_leads
WHERE telefone IS NULL
   OR length(regexp_replace(telefone, '\D', '', 'g')) NOT BETWEEN 10 AND 13;

DELETE FROM public.contatos
WHERE telefone IS NOT NULL
  AND length(regexp_replace(telefone, '\D', '', 'g')) NOT BETWEEN 10 AND 13;