# Project Memory

## Core
SaaS odontológico "Odonto Connect". Azul dental primário, sidebar escura, Inter font.
Stack: TanStack Start, VPS Hostinger, Evolution API (WhatsApp), PostgreSQL.
Módulos: Chat/Fila, Phoenix (contingência WA), Dashboard Admin, VoIP, IA Financeira, CRM.
REGRA: Dados DEVEM ser sincronizados entre módulos via registroCentral.ts (single source of truth).

## Memories
- [Design tokens](mem://design/tokens) — Dental blue palette, semantic colors, pulse-danger animation
- [Sincronização de dados](mem://features/data-sync) — registroCentral.ts como fonte única, pacienteId obrigatório, alertas médicos cross-module
