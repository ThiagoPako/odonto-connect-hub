# Plano de retenção LGPD, por tabela

Autora: **Renata** (banco) · 2026-11-05 · Item C1 de `docs/mercado/melhorias-2026-11-05.md`.
Implementação: `vps-api-server/lgpd.mjs` e `vps-api-server/migration-lgpd-titular.sql`.
**Parecer jurídico:** `docs/juridico/parecer-pr59-retencao-lgpd.md` (Helena, 05/11/2026). Ela aprovou a
estrutura, e os ajustes pedidos estão aplicados. O que ainda depende de advogado humano está no fim deste documento.

## Conceitos
- **Exclusão (eliminação):** a linha sai do banco (`DELETE`) e não volta.
- **Anonimização:** a linha fica, mas sem nada que permita reidentificar a pessoa com esforço razoável
  (LGPD art. 12). Ela tira os identificadores do cadastro, **apaga o texto clínico livre** (evolução,
  observações, laudo, transcrição, anexos) e **elimina a assinatura manuscrita**. Trocar só o nome seria
  pseudonimização (art. 13 § 4º). Só é feita com **todos** os prazos vencidos.
- **Bloqueio de contato:** opt-out em `whatsapp_opt_outs`, gravando **só a chave do telefone** (`phone_key`).
- **Retido:** guardado por obrigação legal ou para defesa. O titular recebe o motivo e o prazo (art. 18 § 4º II).
- **Possível vínculo:** dado achado só pelo telefone (lead com o mesmo número, mensagem ou fila sem lead
  ligado ao paciente). Telefone de família é compartilhado, então isso nunca entra sozinho: o admin marca
  item por item. A exportação, por padrão, leva só o que está ligado pelo `paciente_id`.

## Prazos por grupo

| Grupo | O que entra | Prazo | Base | A pedido do titular, antes do prazo |
|---|---|---|---|---|
| **Prontuário** | `prontuarios`, `anamneses`, `odontogramas`, `exames`, `tratamentos`, `procedimento_execucoes`, `assinaturas_eletronicas`, `consentimentos_pacientes`, `consultations`, `clinical_reports`; **agendamentos realizados ou faltas**; **orçamentos aprovados** (plano de tratamento) | **O maior entre 20 anos do último registro clínico e a data em que o paciente faz 21 anos.** É prazo **mínimo** | Lei 13.787 art. 6º (mínimo de 20 anos); CC arts. 3º e 198, I (prescrição não corre contra menor de 16) somado ao CDC 27 | Retido |
| Comercial | agendamentos cancelados, desmarcados ou futuros; orçamentos não aprovados | 5 anos da criação | CDC 27 | Retido |
| Cadastro | `pacientes` | Enquanto houver registro retido | Identifica o prontuário | Retido |
| **Financeiro** | `financeiro`, `comissoes`, `fin_*` | **5 anos a partir de 1º de janeiro do ano seguinte ao lançamento** (na prática, até 6 anos). Fiscalização ou processo estendem o prazo | CTN 173 I, 174 e 195 parágrafo único; CC 1.194 | Retido |
| **Conversas** | `chat_messages`, `chat_read_status`, `attendance_sessions`, `transfer_logs`, `satisfaction_ratings` | De quem **nunca teve prontuário**: elimináveis. De paciente com prontuário: **retidas por 5 anos da última mensagem**, por padrão | CDC 27; LGPD 7º VI / 11 II d | Eliminadas, ou retidas com o motivo informado. A clínica pode optar por eliminar (`eliminar_conversas`) e assume a perda da prova |
| Leads e funil | `crm_leads`, `kanban_movements`, `lead_tag_assignments`, `tag_assignments` | 2 anos sem interação | LGPD 6º III, 15 I | **Eliminados** |
| Fila e campanhas | `automation_jobs`, `reactivation_sends` | 1 ano | LGPD 6º III | **Eliminados** |
| Contatos | `contatos` | 2 anos sem uso | Legítimo interesse | **Eliminados** |
| Opt-out | `whatsapp_opt_outs` (só `phone_key`) | Enquanto a clínica existir | LGPD 6º III | Mantido: é o próprio pedido do titular |
| Log de acesso ao prontuário | `acessos_prontuario` | 5 anos | Lei 13.787 art. 2º; LGPD 46 e 6º X; Marco Civil 15 (mínimo de 6 meses) | Mantido. **Só aceita inclusão** (trigger) |
| Pedidos do titular | `lgpd_solicitacoes` (só contagens) | 5 anos | LGPD 6º X e 37 | Mantido |
| Logs do servidor (PM2) | arquivos | 6 meses | Marco Civil 15 | Não têm dado de paciente |
| Gravação de áudio | não fica no servidor: arquivo temporário, apagado depois da transcrição | 0 no servidor | — | Consentimento e operador (OpenAI) com a Helena, o Marcos e o Davi |
| Mídia do WhatsApp / Clinicorp | fora do nosso banco | — | LGPD 18 § 6º | A resposta ao titular informa que a exclusão nesses sistemas é pedida à parte |

**Ao fim do prazo** (expurgo: `vps-api-server/lgpd-expurgo.mjs`, tela `/lgpd-expurgo`):
- um job mensal, por clínica, **só gera uma lista** com contagens. As categorias são leads (2 anos sem
  interação), fila (1 ano), conversas (5 anos), log de acesso (5 anos), pedidos do titular (5 anos) e
  prontuários com todos os prazos vencidos. Cada item guarda a data-limite do momento da geração;
- a eliminação só roda depois de três passos:
  - aprovação item a item: o admin aprova as categorias em massa, e **só um dentista da clínica**
    aprova cada prontuário — o dentista é o cadastro vinculado ao usuário (`dentistas.user_id`, do #79),
    nunca o "mesmo e-mail"; sem a coluna, ninguém aprova prontuário;
  - **duas pessoas no prontuário:** quem aprovou um prontuário não pode executar a eliminação;
  - **simulação (dry-run) obrigatória**, válida por 1 hora e invalidada se alguma aprovação mudar;
  - a palavra `ELIMINAR`;
- o registro fica em `lgpd_expurgo_listas`/`lgpd_expurgo_itens`: quem aprovou (e o papel), quem executou
  e o resultado só por contagens;
- **arquivos** (parecer do #76):
  - os ligados às linhas eliminadas saem do disco depois do COMMIT: exame (`arquivo_url`, `exame_arquivos`
    quando existir), anexos do prontuário, áudio de relatório e mídia do chat em `uploads/media`;
  - **arquivo compartilhado fica:** antes de apagar, confere se alguma linha restante (de qualquer clínica:
    outra mensagem da mesma campanha, outro paciente, avatar) ainda cita o arquivo; se citar, o arquivo fica
    e o registro conta `arquivos_mantidos_em_uso`. Erro nessa conferência → nada sai do disco
    (`arquivos_nao_verificados`, com aviso);
  - o que está fora do sistema (mídia no servidor da Evolution/WhatsApp, link externo) aparece como
    **não alcançado**, com o host e a ação manual, no dry-run e no registro;
  - vale também para o pedido de exclusão e de anonimização do titular;
- **backups:** o registro informa que os dados saem das cópias de segurança na rotação normal, com a data
  prevista (execução + 6 meses, conforme `docs/operacao/backup.md`);
- **idade desconhecida:** prontuário de paciente sem data de nascimento vem com alerta, porque a regra dos
  21 anos não pode ser conferida. O dentista só aprova confirmando que conferiu a idade (`confirmo_idade`);
- a eliminação fica registrada (Lei 13.787 art. 6º § 4º), e a linha de `lgpd_solicitacoes` serve de registro;
- o paciente pode pedir a **devolução** do prontuário em vez da eliminação (§ 2º): fica gravado em `ao_fim_do_prazo = 'devolver'`.

## Pedido do titular (`/api/lgpd/solicitacoes`)
- **Quem pode:**
  - só o admin da clínica, sempre filtrado pelo `tenant_id`; o super-admin da plataforma não executa;
  - o pedido registra **quem conferiu a identidade** e o **tipo de documento visto** (sem o número);
  - em pedido por representante ou de menor de 18 anos, registra também **nome e vínculo do responsável** (LGPD 14 e 18 § 3º).
- **Confirmação dupla:** a prévia vem com um código de 8 caracteres que vale 15 minutos. A confirmação
  exige o código e a palavra `EXPORTAR`/`EXCLUIR`/`ANONIMIZAR`. O código é de uso único, e o pedido é
  cancelado depois de 5 erros.
- **Prévia:** registros por grupo, prazos de guarda, possíveis vínculos (o admin marca em
  `possiveis_confirmados`) e o aviso para o campo motivo: "Não descreva sintomas, diagnósticos ou tratamentos no motivo."

| Pedido | Guarda em vigor | Todos os prazos vencidos |
|---|---|---|
| **exportar** (18 II e V) | JSON com o que está ligado ao paciente, os possíveis marcados e o log de acessos. Avisa quando o limite de 10 mil registros por tabela foi atingido. Entrega por meio seguro, nunca por WhatsApp | Igual |
| **excluir** (18 VI) | Elimina leads, fila e contatos (e as conversas, se elimináveis) e grava o opt-out. Devolve o **texto para o titular** com a redação da Helena: o que foi apagado, o que fica, até quando e com qual base | Elimina tudo, inclusive o prontuário e o cadastro |
| **anonimizar** (18 IV) | **Recusado**, com o motivo registrado e o texto de recusa para o titular | Anonimiza: texto clínico livre e identificadores viram NULL; a assinatura sai |

O texto para o titular sai em `resposta_titular`, para enviar por e-mail ou impresso em até 15 dias
(LGPD 19 II). O `motivo_recusa` é só para o admin.

## Registro de acesso ao prontuário (`acessos_prontuario`)
- **O que grava:** quem, qual paciente, quando, o recurso e a ação. Não guarda conteúdo nem IP.
- **Onde grava, neste PR:**
  - GET de anamnese e de odontograma;
  - lista de prontuários;
  - exames;
  - painel do dentista (prontuários e alergias);
  - relatórios clínicos (`/api/ai/reports`, `/api/ai/reports/:patientId`);
  - exportação CSV dos relatórios (ação `exportar`).
- **Onde ainda não grava:**
  - `GET /api/pacientes/:id`, que existe só no PR #27: acrescentar quando ele entrar;
  - download do arquivo de exame: não há rota em `main` (o `arquivo_url` é um link).
- **Só aceita inclusão:** um trigger bloqueia UPDATE e TRUNCATE. DELETE só é aceito em dois casos:
  - no expurgo de registros com mais de 5 anos, com `SET odonto.expurgo_acessos = 'on'`;
  - quando a clínica inteira é excluída (cascata).

## O que precisa de advogado humano (do parecer)
1. A regra dos 21 anos para menores e se o CFO fixa prazo próprio (Código de Ética e Res. 91/2009 não estão no acervo).
2. A retenção de conversas para defesa contra um pedido de exclusão: o art. 16 não lista essa finalidade.
3. O contrato de operador clínica × SaaS (OpenAI e Clinicorp como suboperadores), o DPA e as cláusulas-padrão da ANPD.
4. O procedimento de verificação de identidade do titular e do representante.

## Pendências técnicas
- Devolução do prontuário: o item com `devolver` não é eliminado. A clínica exporta (pedido `exportar`),
  entrega ao paciente, e a eliminação entra numa lista seguinte se o paciente concordar.
- Apagar a mídia na Evolution e o cadastro no Clinicorp.
- A tela: os endpoints estão prontos, e o aviso do campo motivo vem em `previa.aviso_motivo`.
