# Plano de retenção LGPD, por tabela (proposta)

Autora: **Renata** (banco) · 2026-11-05 · Item C1 de `docs/mercado/melhorias-2026-11-05.md`.
Implementação: `vps-api-server/lgpd.mjs`, `vps-api-server/migration-lgpd-titular.sql`.

> **Depende do parecer da Helena.** Fato legal citado, lido do texto oficial pelo `lei.sh`: Lei 13.787/2018
> art. 6º, LGPD arts. 16, 18, 19 e 37, Marco Civil art. 15 e CDC art. 27. Os prazos marcados como
> **proposta** são sugestão técnica minha, não norma. A norma do CFO sobre prontuário (prazo e
> conteúdo) **não foi lida**: a Helena precisa confirmar.

## Conceitos usados no sistema
- **Exclusão (eliminação):** a linha sai do banco (`DELETE`). Não volta.
- **Anonimização:** a linha fica, mas sem nada que identifique a pessoa (nome trocado por
  "Titular anonimizado"; CPF, telefone, e-mail, endereço, nascimento e observações ficam NULL). Serve
  para estatística e para manter registros ligados. Texto livre clínico (evolução, anamnese) pode
  conter nome ou detalhe identificável. **Por isso, hoje anonimizar só é permitido com o prazo do
  prontuário vencido**, e o texto clínico segue a regra de eliminação do prontuário (Helena decide).
- **Bloqueio de contato:** registrar opt-out em `whatsapp_opt_outs` (marketing não sai mais).
- **Retido:** fica guardado por obrigação legal (LGPD art. 16, I). O titular é informado do motivo e do
  prazo (art. 18, § 4º, II).

## Prazos por grupo de dados

| Grupo | Tabelas | Prazo | Base | Ao fim do prazo | A pedido do titular, antes do prazo |
|---|---|---|---|---|---|
| **Prontuário e documentos clínicos** | `prontuarios`, `anamneses`, `odontogramas`, `exames`, `tratamentos`, `tratamento_etapas`, `procedimento_execucoes`, `assinaturas_eletronicas`, `consentimentos_pacientes`, `consultations`, `clinical_reports` | **20 anos do último registro** | Lei 13.787/2018 art. 6º (fato); CFO (Helena confirma) | Eliminação registrada (art. 6º § 4º), ou devolução ao paciente (§ 2º) | **Retido.** A exclusão só elimina o resto; anonimização é recusada |
| Agenda e orçamento | `agendamentos`, `orcamentos` | 20 anos (**proposta**: tratados como parte do registro do atendimento) | Helena confirma se entram no prontuário | Idem | Retido |
| Cadastro do paciente | `pacientes` | Enquanto houver registro clínico ou fiscal retido | Necessário para identificar o prontuário | Eliminado ou anonimizado | Retido enquanto o prontuário estiver retido |
| Financeiro | `financeiro`, `comissoes`, `fin_*` | **5 anos** (**proposta**) | Obrigação fiscal/contábil (Helena cita a norma) | Eliminação | Retido |
| Leads e funil | `crm_leads`, `kanban_movements`, `lead_tag_assignments`, `tag_assignments` | **2 anos sem interação** (**proposta**) | Consentimento / legítimo interesse | Eliminação | **Eliminado** |
| Conversas de WhatsApp | `chat_messages`, `chat_read_status`, `attendance_sessions`, `transfer_logs`, `satisfaction_ratings` | **5 anos** (**proposta**, prescrição do CDC art. 27). Se a conversa for registro clínico, o dentista passa o conteúdo para o prontuário | Execução do serviço / defesa | Eliminação | **Eliminado** |
| Fila de envios e campanhas | `automation_jobs`, `reactivation_sends` | **1 ano** (**proposta**) | Operação | Eliminação | **Eliminado** (opt-out registrado) |
| Contatos avulsos | `contatos` | 2 anos sem uso (**proposta**) | Legítimo interesse | Eliminação | **Eliminado** |
| Opt-out de marketing | `whatsapp_opt_outs` | Enquanto a clínica existir (**proposta**) | Prova de que o pedido de não contato é respeitado | — | **Mantido** (é o próprio pedido do titular) |
| Consentimento de marketing (histórico) | `whatsapp_marketing_consents` (#14) | 5 anos após a revogação (**proposta**) | Ônus da prova do aceite (LGPD art. 8º § 2º) | Eliminação | Mantido, com a revogação registrada |
| Registro de acesso ao prontuário | `acessos_prontuario` | **5 anos** (**proposta**; o mínimo é 6 meses pelo Marco Civil art. 15, que vale para registro de acesso à aplicação) | Segurança, LGPD art. 37 e defesa | Eliminação | Mantido (é auditoria da clínica; sem dado de saúde) |
| Pedidos do titular | `lgpd_solicitacoes` | **5 anos** (**proposta**) | Prova do atendimento ao art. 18 | Eliminação | Mantido (só contagens, nunca conteúdo) |
| Logs de servidor (PM2) | arquivos na VPS | **6 meses** | Marco Civil art. 15 | Rotação/eliminação | Não têm dado de paciente (regra do time) |
| Gravações de áudio de consulta | não são guardadas: `server.mjs` grava o áudio em arquivo temporário, manda para transcrição (OpenAI Whisper) e apaga em seguida (`/api/ai/transcribe`) | **0** no servidor. O texto transcrito vira prontuário (20 anos) se o dentista salvar | Consentimento `gravacao_transcricao_ia` | — | Helena: confirmar a retenção no operador (OpenAI) e o texto do consentimento |
| Mídia do WhatsApp | fica no servidor da Evolution, fora do nosso banco | Mesmo prazo das conversas (**proposta**) | — | — | **Pendência:** a exclusão via API não apaga a mídia na Evolution (Júlia/Otávio) |
| Espelho do Clinicorp | `clinicorp_patients` e demais `clinicorp_*` | Segue o Clinicorp (operador/outro controlador) | — | — | O resumo da exclusão marca `compartilhamento: ['Clinicorp']`, e a clínica informa o Clinicorp (LGPD art. 18 § 6º). A próxima sincronização pode recriar o cadastro: **pendente** |

## O que cada pedido faz (`/api/lgpd/solicitacoes`)
Só o **admin da clínica**. O super-admin da plataforma não executa: o pedido é decisão da clínica, que é
a controladora. Tudo é filtrado pelo `tenant_id` do usuário. A confirmação é dupla: o primeiro POST
mostra a prévia e um código de 8 caracteres que vale 15 minutos; o segundo POST pede o código e a
palavra `EXPORTAR`/`EXCLUIR`/`ANONIMIZAR`. O código é de uso único e a solicitação é cancelada depois
de 5 erros.

| Pedido | Prontuário em guarda | Prazo vencido |
|---|---|---|
| **exportar** (art. 18 II e V) | JSON com o cadastro, todas as tabelas com `paciente_id`, o lead, as conversas e o log de acessos | Igual |
| **excluir** (art. 18 VI) | Elimina o grupo "eliminado" acima, registra opt-out e devolve o que ficou retido, com prazo e base legal | Elimina tudo, inclusive o prontuário e o cadastro |
| **anonimizar** (art. 18 IV) | **Recusado** com o motivo registrado (`status = recusada`) | Anonimiza o cadastro; o registro clínico fica ligado a ele, sem identificação |

Como os dados são encontrados:
- pelo `paciente_id`;
- pelos leads do paciente (o `paciente_id` do lead, ou o telefone com o mesmo DDD e os mesmos 8 últimos dígitos);
- pelo telefone nas tabelas de conversa e de fila.

Tabela com `paciente_id` fora das listas acima é tratada como "sem regra": fica retida e aparece na
prévia, para alguém decidir.

## Registro de acesso ao prontuário (`acessos_prontuario`)
Gravado ao abrir anamnese, odontograma, prontuários e exames: quem, qual paciente, quando, recurso e
ação. Não guarda conteúdo nem IP. Em lista (prontuários/exames sem filtro), é uma linha por paciente
retornado, até 500. O admin consulta em `GET /api/lgpd/pacientes/:id/acessos`, e o log também vai na
exportação. Se a gravação falhar, a tela abre mesmo assim, e o log do servidor não leva o id do paciente.

## Pendências
1. **Helena:**
   - prazo e base do CFO para o prontuário odontológico;
   - se agenda e orçamento entram nos 20 anos;
   - norma fiscal dos 5 anos;
   - prazos propostos para leads, conversas, fila e logs de acesso;
   - texto de resposta ao titular quando houver retenção;
   - transcrição na OpenAI.
2. **Job de expurgo automático** pelos prazos acima: ainda não existe; os prazos só valem a pedido. Depende do parecer.
3. Mídia na Evolution e cadastro no Clinicorp: a exclusão local não alcança esses sistemas.
4. **Tela:** os endpoints estão prontos; falta a interface (Marcos/Davi).
