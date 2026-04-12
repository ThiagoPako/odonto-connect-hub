-- Add priority column to crm_leads for recovery queue priority
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS priority BOOLEAN DEFAULT false;

-- Update system_settings default for followup_automation with new fields
UPDATE system_settings SET value = jsonb_set(
  jsonb_set(
    value::jsonb,
    '{delayDays}',
    '{"followup": 0, "followup_2": 3, "followup_3": 7}'::jsonb
  ),
  '{returnToQueueOnReply}',
  'true'::jsonb
), updated_at = NOW()
WHERE key = 'followup_automation'
AND NOT (value::jsonb ? 'delayDays');
