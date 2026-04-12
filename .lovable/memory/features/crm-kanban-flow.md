---
name: Fluxo CRM Kanban duplo
description: CRM tem dois kanbans separados — Funil de Vendas e Recuperação de Vendas — com níveis de consciência como tags
type: feature
---
## Funil de Vendas (Sales Kanban)
Lead → Em Atendimento → Orçamento → Orçamento Enviado → Orçamento Aprovado

- Lead: primeiro contato do cliente
- Em Atendimento: sendo atendido no chat
- Orçamento: orçamento em elaboração (sincronizado com módulo Orçamentos)
- Orçamento Enviado: só move após orçamento criado e marcado como enviado
- Orçamento Aprovado: convertido em paciente

## Recuperação de Vendas (Recovery Kanban)
Follow-up 1 → Follow-up 2 → Follow-up 3 → Sem Resposta → Orçamento Reprovado → Desqualificado

- Leads sem resposta no chat são movidos para cá
- Orçamentos reprovados entram aqui para estratégia de recuperação

## Desfecho de Atendimento (FinishAttendanceDialog)
- Atendido: remove do kanban (só tinha dúvidas)
- Follow-up: move para kanban de recuperação
- Orçamento: move para stage de orçamento no funil de vendas
- Retornar à Fila: devolve para fila de espera

## Tags = Níveis de Consciência
Inconsciente → Consciente do Problema → Consciente da Solução → Consciente do Produto → Pronto para Comprar
