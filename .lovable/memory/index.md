# Project Memory

## Core
SaaS odontológico "Odonto Connect". Azul dental primário, sidebar escura, Inter font.
Stack: TanStack Start, VPS Hostinger, Evolution API (WhatsApp), PostgreSQL local.
Backend: Express API server (vps-api-server/) port 3002, JWT auth, pg Pool.
Frontend API: src/lib/vpsApi.ts → https://odontoconnect.tech/api.
Sem Supabase/Lovable Cloud — tudo na VPS.
REGRA: Todo botão/função frontend DEVE funcionar no backend. Nada de UI vazia.

## Memories
- [Design tokens](mem://design/tokens) — Dental blue palette, semantic colors, pulse-danger animation
- [VPS Backend](mem://features/data-sync) — Express API, PostgreSQL, JWT, Evolution proxy
- [No Lovable Cloud](mem://constraints/no-lovable-cloud) — Backend disabled, use VPS instead
- [Backend funcional](mem://constraints/functional-backend) — Todo frontend deve ter backend real