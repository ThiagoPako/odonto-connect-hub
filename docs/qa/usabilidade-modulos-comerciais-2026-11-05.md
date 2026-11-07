# Usabilidade — módulos comerciais e de configuração (2026-11-05, Davi · UX)

**Base:** `origin/main` 5492488b · ambiente local (PR #21: banco clonado `odonto_davicom`, API :3022,
Evolution em 127.0.0.1:9 — nenhum WhatsApp sai) · admin da Clínica Alfa · 375 px e 1280 px.
**Método:** leitura de código por módulo (3 varreduras paralelas + conferência), varredura das rotas
no navegador (rolagem lateral, respostas ≥ 400) e teste do fluxo corrigido.
**Legenda:** ✅ verificado no navegador · 📖 verificado só por leitura/tipos · ⏳ pendente.

## Resumo
| Módulo | PR | Principais correções |
|---|---|---|
| Disparos | [#38](https://github.com/ThiagoPako/odonto-connect-hub/pull/38) | Confirmar "Enviar agora"/ativar/excluir; contagem fixa 255/156/89/12 que **também limitava o envio**; assistente só fecha após salvar; validação por etapa; gráficos `Math.random` removidos; página caía com `stats` nulo |
| Automações + Reativação | [#40](https://github.com/ThiagoPako/odonto-connect-hub/pull/40) | Confirmar ao ligar fluxo (com nº de elegíveis); erro de carga não cria fluxo duplicado; salvar espera servidor; horário padrão não sobrescreve o real; reativação: erro ≠ "nenhum paciente" |
| Canais, filas, etiquetas, contatos | [#45](https://github.com/ThiagoPako/odonto-connect-hub/pull/45) | **/canais girava para sempre**; erro de API ≠ "nenhum número"; confirmar Desconectar/Excluir número; filas/etiquetas com confirmação e erro visível; máscara de telefone |
| Configurações, assinatura, painel comercial | [#49](https://github.com/ThiagoPako/odonto-connect-hub/pull/49) | IA: erro de carga bloqueia Salvar; cartão "Manus AI" sobrescrevia o **token do Meta Ads**; admin não se desativa nem troca o próprio perfil; Clinicorp "Enviar dados" confirmado; preços R$ coerentes |
| Chat | [#53](https://github.com/ThiagoPako/odonto-connect-hub/pull/53) | Busca: erro visível, **requisição em dobro**, Esc/aria, resultado antigo carrega o histórico; apagar e transferir só após o servidor |
| CRM | [#55](https://github.com/ThiagoPako/odonto-connect-hub/pull/55) | Novo lead sem "Responsável" fictício (nunca enviado); telefone com máscara; "1 lead" |

Todos: `verificar.sh --base origin/main --sem-build` sem erro novo; tipos 0. Sem mudança de backend.
`src/hooks/useConfirm.tsx` é igual em #38/#40/#45/#49 (mescla sem conflito).

## Por módulo

### Disparos (`/disparos`) — #38
1. `disparos.tsx:84` · "Executar agora" enfileirava a campanha inteira num toque e deixava o disparo ativo · ✅ AlertDialog com número e público (testado: cancela sem enfileirar).
2. `NovoDisparoWizard.tsx:84-85` · contatos alcançáveis inventados e gravados em `capacidade_diaria`, que o servidor usa como `LIMIT` (aniversariantes paravam em 12) · 📖 contagem honesta, capacidade 232.
3. `NovoDisparoWizard.tsx:112-130` · fechava antes do servidor; duplo clique criava dois · 📖 `Promise<boolean>`, "Salvando...".
4. Validação por etapa (sem número, mensagem vazia, término < início, data passada, intervalo 0) · ✅ "Escolha o número de WhatsApp que vai enviar." trava Próximo.
5. `disparos.tsx` · `stats` nulo derrubava a página ("Algo deu errado") · ✅ normalizado.
6. `DisparoStatsPanel.tsx:13-49` gráficos aleatórios; área de mídia sem upload · 📖 removidos / "Em breve".

### Automações (`/automacoes`) e Reativação (`/reativacao`) — #40
1. `automacoes.tsx:97` + Switch das soluções · ligar enviava WhatsApp sem confirmação · ✅ confirmação; cancelar mantém `active:false` no servidor.
2. `automacoes.tsx:71-73` · erro de carga = "nenhum fluxo" e ativar criava duplicado · 📖 aviso + bloqueio.
3. `automacoes.tsx:206-221` · salvar otimista sem rollback · 📖 espera o servidor; rascunho fica.
4. `automacoes.tsx:1259-1281` · horário 08–18 padrão salvo por cima do real; fim < início aceito · 📖.
5. `AutomationReportPanel.tsx:52-54` · números do período anterior ficavam com erro · 📖.
6. `reativacao.tsx:92-97` · erro de pacientes = "nenhum paciente corresponde" · 📖; criar regra: duplo clique e < 30 dias · 📖.
- Local: `GET /api/reativacao/rules` → 500 (schema, A5 do relatório do Caio); a tela já mostra o erro com "Tentar de novo" ✅.

### Canais WhatsApp, filas, etiquetas, contatos — #45
1. `useWhatsAppInstances.ts:185` · `loading` ficava `true` para sempre se a lista vazia tinha sido lida há < 30 s · ✅ reproduzido (/chat → /canais) e corrigido.
2. `canais.tsx:27` · `setError` nunca chamado: falha de API = "Conectar primeiro número" · 📖 hook expõe `error`.
3. `InstanceCard.tsx:121-163` · Desconectar só ícone e sem confirmação; erros só no console · 📖 confirmação + toasts + `aria-label`. (Nenhuma instância foi conectada/desconectada.)
4. `CreateInstanceDialog.tsx` · nome reescrito em silêncio, "Rótulo" descartado, erro "EVOLUTION_API_KEY no .env do VPS" · 📖.
5. `QueueManagementPanel.tsx`/`TagManagementPanel.tsx` · exclusão imediata, erro = lista vazia, ações só no hover · 📖.
6. `contatos.tsx:70`, `Create/EditContatoDialog.tsx` · `confirm()` genérico, telefone livre · ✅ máscara, erro "Telefone incompleto…", exclusão com nome.

### Configurações, usuários, Clinicorp, assinatura, painel comercial — #49
1. `AISettingsPanel.tsx:49` · erro de carga → Salvar gravava chave vazia/IA desligada · 📖 bloqueado.
2. `AISettingsPanel.tsx:28-33` × `MetaAdsConnectPanel.tsx:51-83` · "Manus AI" = mesmo registro do token Meta Ads · ✅ cartão removido.
3. `AdminUserListPanel.tsx:67-74` · desativar sem confirmação, inclusive a si mesmo; `usuarios.tsx` · admin trocava o próprio perfil · 📖.
4. `ClinicorpPanel.tsx:293-381` · "Enviar dados" sobrescreve Pacientes/Agenda sem confirmação · 📖.
5. `minha-assinatura.tsx:168` · "R$ 150" no card × "R$ 149.90" no diálogo; status desconhecido quebrava · ✅ "R$ 397,00/mês", "usuários ilimitados", 375 px sem rolagem.
6. `painel-comercial.tsx:107-125` · erro + zeros + "Sem follow-ups 🎉" · 📖 "—" e erro.

### Chat (`/chat`) — #53
1. `chat.tsx:1881` + `ConversationView.tsx:360-383` · busca ignorava erro e ia ao servidor em dobro · 📖 corrigido (achado do outro Davi).
2. Resultado só do servidor não levava a lugar nenhum · 📖 carrega o histórico (até 10 páginas) ou avisa a data.
3. `chat.tsx:1515-1534` apagar e `:1536-1569` transferir com sucesso antes do servidor · 📖.
- `/chat` abre sem erro a 1280 px ✅. Sem conversas/Evolution locais: busca e ações não exercitadas no navegador.

### CRM (`/crm`) — #55
1. `CreateLeadDialog.tsx:19` · "Responsável" com pessoas fictícias, nunca enviado · ✅ removido.
2. Telefone sem máscara/validação; "1 leads" · ✅.

### Relatórios e analytics
- `/analytics` e `/equipe` já estão como "Em breve" honesto (`EmBreve`), `/campanhas` rotula "Demonstração" ✅. `/metricas` abre sem erro ✅. Nada alterado.

## Pendente (não feito, com dono sugerido)
| # | Onde | Problema | Dono |
|---|---|---|---|
| P1 | `chat.tsx:1687` | Lista lateral `w-[360px] shrink-0` sem breakpoint: a 375 px a conversa fica com ~15 px. Precisa do layout lista/conversa do #24 | Lara/Davi após #24 |
| P2 | `chat.tsx:1421-1445`, `:1895-1902` | "Retornar à fila" e "Reabrir atendimento" só mudam a tela, nada vai ao servidor | Marcos (precisa endpoint) |
| P3 | `chat.tsx:1296-1377` | Finalizar remove o lead antes de `sessionsApi.close` responder | coberto em parte pelo #35 (Júlia) |
| P4 | `ChatHeader.tsx:157-180` | Botões Ligar/Vídeo mostram "Iniciando ligação..." sem ligar | Davi após #24 |
| P5 | #35 | Texto da pesquisa diz ao paciente "Sua avaliação: ⭐⭐⭐" antes de ele avaliar | Júlia |
| P6 | `canais.tsx:30-66` | Conexão principal só no `localStorage` (outro computador mostra outra) | Marcos (ler do servidor) |
| P7 | `signup.tsx:63` | Não há onboarding/primeiros passos depois do cadastro | Paula + dono do dashboard |
| P8 | `MetaAdsConnectPanel.tsx:251` | O próprio aviso diz que o token "vale para todas as clínicas" | Igor/Marcos |
| P9 | `ClinicorpUserCredentials.tsx:353` | URL do webhook mostra o segredo em claro | Igor |
| P10 | `NotificationSettingsPanel.tsx:49-60` | Salvar preferência é "fire-and-forget" e o toast diz "ativado" | Davi (próximo) |
| P11 | `src/lib/mascaraTelefone.ts` × `src/lib/formatos.ts` (#48) | Duas máscaras de telefone | unificar depois do merge |
| P12 | shell (`DashboardHeader`/sidebar) | A 375 px o trilho lateral ocupa ~60 px e a busca do topo é cortada | Lara (#19) |

## Não verificado
WhatsApp real (envio, QR, desconectar), IA, Clinicorp e Meta Ads com credenciais, erro de carga
forçado (estados de erro verificados por leitura), leitor de tela real, filas/etiquetas no navegador.
