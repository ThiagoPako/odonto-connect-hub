---
name: AI Integration Module
description: OpenAI Whisper transcription + GPT clinical reports, Manus for Meta Ads, managed via VPS backend
type: feature
---
- AI API keys stored in `ai_settings` table, managed via /configuracoes panel
- Transcription: POST /api/ai/transcribe (raw audio → OpenAI Whisper → text)
- Report generation: POST /api/ai/clinical-report (transcription + context → GPT → structured report)
- Reports saved in `clinical_reports` table, linked to patient_id
- Frontend flow: Record audio → click "Transcrever com IA" → auto-transcribe → auto-generate report → show in Relatório IA tab
- Providers: OpenAI (transcription+reports), Manus (Meta Ads data) — both configurable
- VPS dependency: `form-data` package for Whisper multipart upload
