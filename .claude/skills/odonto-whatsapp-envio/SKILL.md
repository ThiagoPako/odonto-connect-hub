---
name: odonto-whatsapp-envio
description: Use when creating, changing or reviewing anything that sends WhatsApp messages in Odonto Connect — lembretes, campanhas, disparos, reativação, automações, bot de atendimento, follow-up, texto de mensagem para paciente, opt-out — or when a número could be banned/bloqueado, or a paciente receive from the wrong clínica.
---

# Envio de WhatsApp seguro (anti-bloqueio + LGPD)

Fonte das regras e números: `docs/whatsapp/diagnostico.md` (leia a seção "Regras anti-bloqueio").
O risco de bloqueio vem do **comportamento de envio**, não do gateway (Evolution API/Baileys).

## Caminhos no código (`vps-api-server/server.mjs` — confira as linhas, o arquivo muda)
| Peça | Função |
|---|---|
| Entrada única de envio automático | `enqueueWhatsAppJob({ tenantId, phone, message, category, ... })` |
| Fila (claim, ritmo, janela, disjuntor) | `processAutomationJobs`, `scheduleNextWhatsAppSend`, constantes `WA_*` |
| Janela de horário (America/Sao_Paulo) | `isWithinWhatsAppSendWindow`, `spClock`, `nextWhatsAppSendWindowStart` |
| Opt-out | `isWhatsAppOptOutText`, `isWhatsAppOptedOut`, `recordWhatsAppOptOut`, `WA_OPT_OUT_PHRASES` |
| Número da clínica | `getTenantDefaultInstance(tenantId)`; dono: `userOwnsInstance`, `getStrictInstanceOwner` |
| Envio direto (só resposta humana no chat) | `sendEvolutionTextMessage`, `evolutionFetch('/message/send*')` — **não lança**: confira `ok` e `key.id` |

## Regras para qualquer envio novo ou alterado
1. **Automático = fila.** Lembrete, campanha, reativação, bot proativo, follow-up: sempre
   `enqueueWhatsAppJob` com `category` correta (`transactional` lembrete/confirmação; `marketing`
   campanha/reativação). Envio direto só para mensagem digitada por humano no chat.
2. **Número da própria clínica** (`tenantId` obrigatório). Nunca "primeira instância aberta".
3. **Elegibilidade antes de enfileirar:** não está em opt-out; marketing exige opt-in registrado
   ou conversa prévia; dedupe (mesmo texto 24 h; marketing 1×/7 dias).
4. **Marketing termina com** "Responda SAIR para não receber mais." Sem link no 1º contato,
   3+ variações de texto, sem preço/desconto/promoção como chamariz (CFO) e **sem dado de saúde**
   (procedimento, diagnóstico) em marketing.
5. Nada de `setTimeout` longo (se perde no restart) — use `scheduledAt` na fila.
6. Texto novo para paciente → revisão da Helena (`helena-juridico`, skill `conformidade-legal`).

## Achar envio fora da fila
```bash
grep -n "message/send\|sendEvolutionTextMessage(" vps-api-server/server.mjs   # cada uso: é resposta humana? se não, mover para a fila
grep -n "getDefaultInstance(" vps-api-server/server.mjs                     # deve ser zero em jobs
```

## Teste
Nunca envie para paciente real nem conecte/desconecte instância de produção. Valide montando o
job (`automation_jobs` em banco local) ou com número de teste indicado pelo usuário.
No relatório, ligue cada mudança à regra que ela atende.
