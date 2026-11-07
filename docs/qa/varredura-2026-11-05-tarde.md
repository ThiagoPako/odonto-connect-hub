# Varredura de QA — origin/main (13 PRs de 05/11) + #21 — Caio

Ambiente: `origin/main` @ `5492488b` + branch do #21 (merge local), banco isolado `odonto_caio_v`, backend :3031, Vite :5191,
sem `.env`, Evolution falsa (`127.0.0.1:9`) — nenhum WhatsApp real. Exames/radiologia fora do escopo (Marcos).

## Resultado

| Item | Resultado |
|---|---|
| e2e dos 5 fluxos críticos (`fluxos-criticos.spec.ts`) | ✅ 5/5 (financeiro ignora o 500 de B1, que tem teste próprio) |
| e2e novos (`fluxos-adicionais.spec.ts`): orçamento, tratamento, prontuário/anamnese, financeiro (persistência), CRM, configuração | ✅ 6/6 — mas orçamento só passa com o schema local complementado (B2) |
| teste 12 (regressão de B1) | ❌ falha esperada (`test.fail`): vira vermelho quando B1 for corrigido |
| `varredura-completa.mjs` (5 perfis × 32 rotas × 1366 px; admin e recepção também a 375 px) | ✅ sem erro de página, sem aviso do React, sem "undefined/null/NaN", sem tela de erro; ❌ 2 rotas com 500 (B1, B3) |
| 375 px (admin e recepção, 30 rotas) | ✅ sem overflow horizontal nem elemento fora da viewport; ⚠️ alvos de toque < 24 px (B6) |
| botões "Novo/Nova/Adicionar/Criar" (admin) | ✅ todos abrem algo (cobre só até 3 botões por rota) |
| `varredura-modulos.mjs` (script antigo) | ✅ rodou (5 perfis × 35 rotas): só B1 (500 em `/api/sessions/active`, 5 perfis/rotas); B3 já estava mascarado porque rodou depois da correção do schema local |

## Bugs

**B1 — GET /api/sessions/active devolve 500 em toda carga do dashboard (alta)**
- Passos: logar (qualquer perfil) → abrir `/dashboard` (ou qualquer rota que monte o widget de atendimentos). Via curl: `GET /api/sessions/active?active=true` com token → `{"error":"operator does not exist: uuid = text"}`.
- Esperado: 200 com a lista (ou `[]`). Obtido: 500 a cada chamada (aparece 2x por carga do financeiro).
- Causa: `vps-api-server/server.mjs:13372` `LEFT JOIN crm_leads l ON l.id = s.lead_id`; `attendance_sessions.lead_id` é TEXT (`migration-attendance-sessions.sql:9`). Os outros joins já usam `l.id::text = s.lead_id` (`server.mjs:13840`, `:16047`). Correção: `l.id::text = s.lead_id`. O `catch` interno só trata 42P01/42703, por isso o erro 42883 vira 500.
- Cobertura: `e2e/fluxos-adicionais.spec.ts` teste 12.

**B2 — POST /api/orcamentos falha (500) em banco criado só pelas migrations do repo (alta)**
- Passos: `/orcamentos` → Novo Orçamento → paciente + procedimento → Adicionar → Salvar. Resposta: `column v.valido_ate does not exist`; depois de corrigir essa, `column "titulo" of relation "orcamentos" does not exist`.
- Causa: não há migration no repositório para `orcamentos.titulo`, `print_config`, `odontograma_snapshot` (usados em `server.mjs:6464-6479`) nem para `procedimentos_catalogo_versoes` com `valido_desde/valido_ate` (usadas em `server.mjs:6444,6558,6748`; a tabela só existe em `schema-complementar-local.sql`). Ou produção tem alterações manuais fora do repo (deriva de schema) ou o orçamento está quebrado lá — **não verificado em produção**.
- Ação sugerida: Renata criar migration idempotente. Neste PR só o `schema-complementar-local.sql` foi complementado para o e2e rodar.

**B3 — GET /api/reativacao/rules devolve 500 (alta, mesma classe de B2)**
- Passos: `/reativacao` (admin, recepção, comercial). Resposta: `column r.tenant_id does not exist`.
- Causa: `server.mjs:7679` e `:7734` usam `reactivation_rules.tenant_id`, mas `migration-reativacao.sql:6-17` não cria a coluna (nem em `reactivation_sends`). Tela fica sem regras. Mesma dúvida de produção que B2.

**B4 — POST /api/orcamentos recebe `valor_total` como string com zero à esquerda (baixa)**
- Passos: adicionar 1 item de R$ 350 → request mostra `"valor_total":"0350"` (e `"valor_unitario":"350"` como string). Causa provável: `src/components/orcamentos/NovoOrcamentoModal.tsx:228` e `:254` gravam `valor_total: valor` com o `valor_particular` do catálogo (string `numeric` da API, sem `Number()`); `:281` faz `acc + it.valor_total` e concatena (`0 + "350"` = `"0350"`). O banco converte para 350.00, mas qualquer validação estrita ou outro cliente quebraria.

**B5 — `<main>` aninhado (baixa, acessibilidade)**
- Em `/tratamentos` (e demais telas com `DashboardHeader`) há dois `main`: `flex-1 overflow-y-auto` contendo `main flex-1 p-6 overflow-auto`. Leitores de tela anunciam duas regiões principais; locators `locator("main")` do Playwright dão strict mode violation.

**B6 — alvos de toque pequenos a 375 px (baixa)**
- Contagem de botões/links/inputs < 24 px: dashboard 5, crm 8, chat 6, automações 8, painel-comercial 3 (probe a 375 px, admin). Não é overflow; é ergonomia (WCAG 2.5.8).

**Observação (não é bug)** — `/configuracoes` aba Clínica: nome/endereço ficam só no `localStorage` ("Salvar neste aparelho", `src/components/ClinicLocationPanel.tsx:74`); a tela avisa, mas outro computador/celular da mesma clínica não vê o dado. Exige nome **e** endereço para salvar.
**Observação** — `POST /api/crm/...` de lead com telefone já existente devolve 409 (esperado); a mensagem exibida ao usuário nesse caso **não foi verificada**.

## Flaky observado
O teste de financeiro falhava de forma intermitente por causa de B1 (500 em `sessions/active` durante o fluxo); era o `expect(falhas).toEqual([])`, não a lista de movimentações.

## O que mudou no PR
- `e2e/fluxos-adicionais.spec.ts` (testes 6–12), `e2e/varredura-completa.mjs`.
- `vps-api-server/schema-complementar-local.sql`: `valido_desde/valido_ate`, colunas de `orcamentos`, `tenant_id` de reativação.
- `e2e/fluxos-criticos.spec.ts`: teste 5 ignora `/api/sessions/active` (coberto por B1).

## Não verificado
- Produção (nada chamado), WhatsApp real, exames/radiologia, Clinicorp, chat com Evolution real.
- Botões destrutivos (excluir/cancelar) e botões além dos "Novo/Nova/Adicionar/Criar".
- Jest do backend, build/lint/tsc completos.
- B3 foi observado na 1ª varredura (antes de complementar o schema local); depois da correção local a rota responde 200.
