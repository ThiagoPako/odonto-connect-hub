---
name: odonto-suporte
description: Use when a clínica cliente do Odonto Connect reports a problem, doubt or complaint — WhatsApp desconectou, mensagem não chegou, não vê a agenda, erro na tela, cobrança, pedido de dados/exclusão (LGPD) — and you need to triage it, find the cause in the code, and write the customer reply and help-center article.
---

# Suporte ao cliente — Odonto Connect

## 1. Triagem (2 minutos)
| Tipo | Exemplos | Próximo passo |
|---|---|---|
| Dúvida de uso | "como cadastro dentista?" | resposta + artigo em `docs/suporte/` |
| Configuração | WhatsApp desconectado, QR, Clinicorp | passo a passo para a clínica |
| Bug | botão não faz nada, erro na tela | relato para `marcos-dev` (ou `julia-whatsapp`) |
| Financeiro | cobrança, plano, fim do teste | resposta + aviso ao usuário (dono) |
| LGPD | "quero meus dados", "apague meu cadastro" | **acione `helena-juridico`**; a clínica é a controladora |
| Pedido de recurso | "seria bom ter…" | registrar no `docs/backlog.md` via Rafael |

Severidade: **P1** clínica parada (sem login, agenda ou WhatsApp) · **P2** função importante
falhando · **P3** dúvida/incômodo.

## 2. Causa no código
- Tela: `src/routes/<tela>.tsx`; status real de cada tela em `docs/produto/mapa-telas.md`
  (se a tela é "demonstração", diga isso internamente — não prometa).
- Erro "silencioso": `vpsApiFetch` não lança; procure `error` ignorado ou `.catch` inútil.
- WhatsApp: `docs/whatsapp/diagnostico.md` foi escrito **antes** da Fase 1 (fila, janela, opt-out
  já existem) — confirme cada hipótese no código atual. Causas mais comuns de "não chegou":
  | Causa | Onde ver |
  |---|---|
  | fora da janela (seg–sex 8–20 h, sáb 8–13 h, sem domingo): job retido até abrir | `WA_SEND_WINDOWS`, `isWithinWhatsAppSendWindow` |
  | job **expirou** antes de sair (lembrete vale até a hora da consulta) | `expires_at`, erro "Expirado…" |
  | paciente sem telefone / telefone inválido: pulado **sem aviso** | `processAppointmentReminders` |
  | lembrete só é criado na véspera (consulta = amanhã), job de hora em hora | `processAppointmentReminders` |
  | número pausado por falhas (2 h) ou desconectado | `whatsapp_instances.paused_until` |
  | paciente respondeu SAIR (opt-out) | `whatsapp_opt_outs` |
- Separe **confirmado** (li o código/reproduzi) de **hipótese**.
- Você não acessa o banco. Para o status real, entregue ao dev/Otávio a consulta pronta
  (eles rodam; o resultado não vai para o cliente):
  ```sql
  SELECT status, error, scheduled_at, expires_at, sent_at, instance
    FROM automation_jobs
   WHERE tenant_id = '<tenant da clínica>' AND trigger_event = '<ex.: appointment_reminder>'
     AND created_at > NOW() - INTERVAL '3 days'
   ORDER BY created_at DESC LIMIT 20;
  ```
  Peça ao cliente só o necessário para achar o caso: data/hora e primeiro nome — nunca CPF,
  telefone completo ou dado clínico.

## 3. Entregas
**Resposta ao cliente** (pronta para copiar; o usuário envia):
```
Olá, <nome>! Obrigado por avisar.
<O que aconteceu, em 1–2 frases simples, sem jargão.>
Para resolver agora:
1. <passo com o nome exato do botão/menu>
2. <passo>
<Bug confirmado: "Já encaminhamos para a equipe técnica e avisamos assim que estiver resolvido.">
<Ainda investigando: "Para conferir o seu caso, me confirme: <1–2 itens>. Retornamos assim que verificarmos.">
Qualquer dúvida, é só responder aqui.
```
**Nota interna:** tipo · severidade · causa (arquivo:linha) · confirmado/hipótese · quem age.
**Relato de bug** (para o dev): título · passos · esperado × obtido · evidência · arquivo:linha.
**Artigo** (se a dúvida pode se repetir): `docs/suporte/<tema-em-kebab-case>.md` (crie a pasta se
não existir e liste o artigo em `docs/suporte/README.md`). Estrutura: título em forma de pergunta ·
"Por que acontece" (2–3 frases) · passos numerados com o nome exato dos botões · "Se não funcionar".

## Regras
Nunca peça senha nem token ao cliente; nunca cole dado de paciente em resposta, artigo ou relato.
Não prometa prazo, recurso ou reembolso que o usuário não confirmou — sem prazo confirmado, use
"assim que verificarmos".
