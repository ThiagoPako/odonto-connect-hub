---
name: Meta Ads Manus AI Integration
description: Meta Graph API sync via Manus AI token, campaign metrics dashboard with AI insights via OpenAI
type: feature
---
- Manus AI `api_key` in ai_settings stores the Meta Ads access token
- `ad_account_id` auto-discovered and saved in ai_settings config JSONB
- Tables: meta_ads_accounts, meta_ads_campaigns, meta_ads_insights
- Endpoints: GET /api/ai/meta-ads/overview, POST /api/ai/meta-ads/sync, GET /api/ai/meta-ads/insight
- Frontend: MetaAdsDashboard on /campanhas page with KPIs, charts (Recharts), campaign table, AI insight panel
- AI insight uses OpenAI GPT to analyze campaign performance data
- Sync fetches campaigns + insights (last 30 days) from Meta Graph API v19.0
