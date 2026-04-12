-- Meta Ads / Manus AI integration
-- Run: psql -U odonto_user -d odonto_db -f migration-meta-ads.sql

CREATE TABLE IF NOT EXISTS meta_ads_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  access_token TEXT,
  connected BOOLEAN DEFAULT false,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_ads_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  objective TEXT,
  daily_budget NUMERIC(12,2),
  lifetime_budget NUMERIC(12,2),
  start_time TIMESTAMPTZ,
  stop_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_ads_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL,
  date_start DATE NOT NULL,
  date_stop DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC(12,2) DEFAULT 0,
  reach INTEGER DEFAULT 0,
  ctr NUMERIC(8,4) DEFAULT 0,
  cpc NUMERIC(8,2) DEFAULT 0,
  cpm NUMERIC(8,2) DEFAULT 0,
  actions JSONB DEFAULT '[]',
  leads INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost_per_lead NUMERIC(8,2),
  cost_per_conversion NUMERIC(8,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, date_start)
);

CREATE INDEX IF NOT EXISTS idx_meta_insights_campaign ON meta_ads_insights(campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_insights_date ON meta_ads_insights(date_start DESC);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_account ON meta_ads_campaigns(account_id);
