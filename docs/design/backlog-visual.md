# Backlog visual por tela: aplicar os tokens do sistema

**Lara (design)** · 5 nov 2026 · base: `DESIGN.md` §10–15 (PR #46). Para Davi, Davi e Marcos aplicarem
nos PRs que já estão abertos. Não é preciso esperar por mim: cada linha é uma troca de classe que não
muda a regra de negócio.

Contagens medidas com `node scripts/design/auditar-design.mjs --json`, agrupadas por tela (rota e
componentes da tela). Para conferir o seu PR, rode o script antes e depois: a linha da tela tem que
cair.

**Impacto:** **alto** = legibilidade e contraste (texto < 12 px, cor que some, cor fixa que quebra no
escuro) · **médio** = consistência (paleta solta no lugar do token, tamanho fora da escala) ·
**baixo** = estética.

## Tabela de troca (vale para todas as telas)

| Encontrou | Troque por | Impacto |
|---|---|---|
| `text-[9px]`, `text-[10px]`, `text-[11px]` | `text-caption` (12 px). Se não couber, reveja o layout (quebra de linha, `truncate` com `title`); não diminua a letra | alto |
| `text-[12px]` · `[13px]` / `0.8125rem` · `[14px]` / `0.875rem` · `[15px]` / `0.9375rem` | `text-caption` · `text-footnote` · `text-body` · `text-callout` | médio |
| `text-[18px]` · `[24px]` · `[28px]` | `text-title-3` · `text-title-2` · `text-title-1` | médio |
| `hsl(var(--x) / 0.N)` em `className`, `style` ou SVG | classe `bg-x/N0` (ex.: `bg-primary/20`); em SVG/estilo: `color-mix(in srgb, var(--color-x) N0%, transparent)` | **alto** (hoje a cor não aparece) |
| `hsl(var(--x))` sem alfa | `var(--color-x)` | **alto** |
| `bg-white`, `text-white` em superfície | `bg-card`, `text-foreground`; sobre cor cheia: `text-primary-foreground` etc. | alto (quebra no escuro) |
| `bg-white/15` sobre vídeo ou foto | mantenha, desde que esteja sempre sobre mídia escura (é véu, não superfície) | baixo |
| `bg-black/NN` atrás de diálogo | `bg-scrim` | médio |
| Status em `bg-green-*`, `text-red-*`, `amber`, `orange`, `blue` | `bg-success/12 text-success`, `bg-destructive/10 text-destructive`, `bg-warning/15 text-warning-text`, `bg-info/10 text-info`, sempre com o texto do status junto | médio (alto se o texto estiver < 4,5:1) |
| Cinzas `text-slate-*`, `text-gray-*` | `text-foreground` (principal) ou `text-muted-foreground` (secundário) | médio |
| Hex ou `hsl(n, …)` em mapa de cores (gráfico, etiqueta, etapa) | `var(--color-chart-1…5)` ou o token de estado. Etiqueta escolhida pelo usuário pode ter hex, mas o texto em cima precisa de contraste calculado | médio |
| Emoji como ícone (etapas, filtros) | ícone do lucide com `aria-hidden` + texto | baixo |
| Botão de ícone `h-7`/`h-8` sem `Button` | `<Button size="icon">`, que já ganha o alvo de 44 px no toque | alto no celular |

**Exceções aceitas:** PDF e impressão (`src/lib/*PdfExport.ts`, `OrcamentoPrintPreview`) não leem
CSS, então hex e paleta ficam. Os logos de canal em `campanhas/ChannelLogo.tsx` também ficam.

## As 10 telas mais usadas (em ordem de prioridade)

Contagem por categoria: **quebr.** = `hsl(var())` · **paleta** = Tailwind solto · **b/p** =
`bg-white`/`text-black` · **literal** = hex/`hsl(n)` · **< 12 px** · **fora** = `text-[…]` fora da escala.

| # | Tela | quebr. | paleta | b/p | literal | < 12 px | fora | Dono provável |
|---|---|---|---|---|---|---|---|---|
| 1 | Chat | 2 | 0 | 35 | 29 | 61 | 63 | Lara (PR #24) |
| 2 | Agenda | 12 | 19 | 7 | 10 | 40 | 43 | Marcos (#27) / Davi |
| 3 | Pacientes (+ prontuário) | 0 | 16 | 5 | 1 | 47 | 47 | Davi |
| 4 | Consulta (atendimento, painel do dentista, gravação) | 7 | 0 | 2 | 0 | 58 | 58 | Davi |
| 5 | Financeiro (+ comissões) | 1 | 0 | 3 | 6 | 73 | 73 | Davi (#34) |
| 6 | Dashboard (+ gráficos) | 0 | 6 | 0 | 47 | 17 | 23 | Lara |
| 7 | CRM (+ reativação) | 1 | 0 | 3 | 0 | 51 | 51 | Davi |
| 8 | Orçamentos (+ tratamentos) | 6 | 29 | 14 | 1 | 47 | 47 | Davi |
| 9 | Exames (+ pedido de exame) | 0 | 107 | 24 | 3 | 3 | 6 | Marcos (radiologia, #33/#37) |
| 10 | Configurações (painéis) | 0 | 7 | 7 | 10 | 11 | 11 | Davi |

### 1. Chat (`routes/chat.tsx`, `components/chat/*`)
- **Alto:**
  - `ConversationView.tsx`: 24 textos < 12 px (horário, citação, rótulos de mídia) → `text-caption`.
  - 26 `bg-white`/`text-white`: o balão e a moldura de mídia ficam brancos no escuro → `bg-card`. O véu
    sobre vídeo (`bg-white/15`, linha ~1060) pode ficar.
  - `ChatHeader`, `MessageInput`: 8 + 8 textos < 12 px.
- **Médio:**
  - `LeadListItem.tsx`: 11 hex de etapa (`#3b82f6`…, vindos do mapa de etapas) → tokens de estado/gráfico.
  - Os emojis de etapa saem (o #24 já tirou dos filtros).
- O #24 já resolveu parte disto. Rode o script na branch dele antes de mexer.

### 2. Agenda (`routes/agenda.tsx`, `components/agenda/*`)
- **Alto:**
  - `AnalogTimePicker.tsx`: 6 cores quebradas. `fill="hsl(var(--muted) / 0.4)"` e
    `stroke="hsl(var(--border))"` (linhas 258–259) não pintam, e o relógio fica sem fundo nem borda →
    `color-mix(in srgb, var(--color-muted) 40%, transparent)` e `var(--color-border)`.
  - `AgendaGrid.tsx`: 3 cores quebradas e 10 textos < 12 px (horário e nome na célula).
- **Médio:** `AgendaGrid.tsx` com 16 classes de paleta, por exemplo `bg-blue-500` e `bg-amber-500` por
  status → `bg-info`/`bg-warning` + rótulo do status. `MarcadoresSelector`: 8 hex de marcador.

### 3. Pacientes (`routes/pacientes.tsx`, `prontuario.tsx`, `OdontogramaChart`)
- **Alto:** `pacientes.tsx` tem 35 textos < 12 px (ficha, chips de convênio, datas) → `text-caption`/`text-footnote`.
  O odontograma tem 7: os números dos dentes precisam ser legíveis (mínimo `text-caption`).
- **Médio:** 16 classes de paleta em `pacientes.tsx` (selos de status) → tokens de estado. 3 `bg-white`.

### 4. Consulta (`routes/atendimento.tsx`, `painel-dentista.tsx`, `ClinicalAudioRecorder`, `ActiveAttendanceCard`)
- **Alto:**
  - `ClinicalAudioRecorder.tsx`: 5 cores quebradas, e as barras de onda e o estado de gravação não
    aparecem → `bg-destructive/20` etc. É sinal de "está gravando": impacto clínico e LGPD.
  - Textos < 12 px: 25 no atendimento, 23 no painel do dentista e 5 no gravador.

### 5. Financeiro (`routes/financeiro.tsx`, `comissoes.tsx`)
- **Alto:** é a tela com mais texto < 12 px: 65. Exemplos: banco e data do extrato (`text-[10px]`,
  linhas 433 e 457) e o selo em CAIXA ALTA de 10 px (linha 473) → `text-caption`, caixa normal. Valores
  monetários com `tabular-nums`.
- **Médio:** 6 cores literais (categorias) → `chart-1…5`.

### 6. Dashboard (`routes/dashboard.tsx`, `components/charts/*`)
- **Médio:** 47 cores literais nos gráficos (`DespesasCategoriaChart` 14, `ReceitaDespesaChart` 9,
  `FaturamentoMensalChart` 7, `AgendaStatusChart` 6). Exemplo: `salario: "hsl(217, 91%, 60%)"` →
  `var(--color-chart-2)`. Assim os gráficos mudam com o tema e passam 3:1, como já medido.
- **Alto:** 17 textos < 12 px nos eixos e legendas → `text-caption` (o `chartTheme.ts` já usa 12 px no tooltip).

### 7. CRM (`routes/crm.tsx`, `reativacao.tsx`)
- **Alto:** 27 + 24 textos < 12 px (cartões do kanban, contadores, datas) → `text-caption`.
- **Baixo:** 3 `bg-white`, 1 cor quebrada.

### 8. Orçamentos (`routes/orcamentos.tsx`, `tratamentos.tsx`, `components/orcamentos/*`)
- **Alto:** 6 cores quebradas (`orcamentos.tsx` 2, `tratamentos.tsx` 1…) e 47 textos < 12 px.
- **Médio:** fora a impressão, 14 `bg-white` (`ExecucaoModal`, `tratamentos`, `orcamentos`) → `bg-card`.
- **Exceção:** `OrcamentoPrintPreview` (29 de paleta) fica como está, porque é impressão.

### 9. Exames (`routes/exames.tsx`, `pedido-exame.tsx`, `lib/examesApi.ts`)
- **Médio, mas volumoso:**
  - `pedido-exame.tsx` tem 75 classes de paleta (`border-orange-200` 15×, `bg-orange-500` 9×,
    `text-slate-700` 8×). É um tema laranja próprio, fora da marca. Trocar por
    `primary`/`accent`/`border-input`.
  - `examesApi.ts` tem 32 de paleta no mapa de status → tokens de estado.
- **Alto:** 24 `bg-white` em `pedido-exame`, que fica branco no escuro.
- Combinar com o Marcos (radiologia), porque ele está nesses arquivos.

### 10. Configurações (`routes/configuracoes.tsx` e painéis `*SettingsPanel`, `QueueManagementPanel`, `TagManagementPanel`)
- **Médio:** `TagManagementPanel` com 8 hex de etiqueta. É cor escolhida pelo usuário: manter, mas
  calcular a cor do texto por contraste. `QueueManagementPanel`: 4 de paleta e 2 `bg-white`.
- **Alto:** 11 textos < 12 px (`AISettingsPanel` 3, `AttendanceSettingsPanel` 2…).

## Fora das 10, mas com contagem alta (próxima rodada)
- **Cor quebrada:** `disparos/DisparoStatsPanel` 23, `campanhas/CampanhaTimelineChart` 19,
  `AutomationReportPanel` 18, `painel-comercial` 10. Os gráficos dessas telas estão sem cor hoje: **alto**.
- **Texto < 12 px:** `ClinicorpPanel` 32, `automacoes` 29.

## Capturas "antes"

⚠️ **Pendente.** As 10 telas exigem login, e eu não tenho credenciais de teste. Assim que o usuário
passar uma conta de teste do ambiente local (backend do Caio, porta 3002), as capturas vão para
`docs/design/capturas/antes-<tela>-375.png` e `-1280.png`, em claro e escuro.

Já feitas, das telas públicas: landing, login, cadastro, termos e privacidade, a 375 e 1280 px. Estão
na descrição do PR desta mudança.

## Já aplicado (PR "telas da Lara", empilhado no #46)
Landing, login, cadastro, termos, privacidade, `AuthShell`, `AgendaFragment`, `LegalPageLayout`,
`AppSidebar`, `DashboardHeader` e `__root`: **0** textos < 12 px, **0** `text-[…]` fora da escala e
**0** cores fixas.

A comparação automática dos estilos calculados, antes × depois, deu:
- tamanho de letra: 0 mudanças;
- cor: 0 mudanças;
- altura de linha: só se ajustou ao token (±0,5 px na maioria; o título "E ainda" ficou mais justo).
