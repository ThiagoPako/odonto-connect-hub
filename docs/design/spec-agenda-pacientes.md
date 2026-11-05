# Spec de design — Agenda e Pacientes

**Autora:** Lara (design) · 5 nov 2026 · **Tipo:** spec, sem código. Para quem implementar (Davi/Marcos).
**Base:** `DESIGN.md` (tokens, componentes, seção 8 "Princípios inspirados no Apple HIG").
**Fora desta spec, porque já está nos PRs do Davi:** #7 (erros visíveis com "Tentar de novo", limpar a
agenda quando o carregamento falha, vazio × "nada encontrado" em pacientes, leads do CRM com carregando/erro)
e #17 (quebra de linha na barra da agenda; `aria-label` em dia anterior/próximo/recarregar).
Os números de linha são da versão anterior ao #7 e vão deslocar depois do merge.

Prioridade: **P1** = bloqueia uso no celular ou reprova acessibilidade · **P2** = qualidade percebida ·
**P3** = acabamento.

---

## Regras que valem para as duas telas

1. Nenhuma rolagem horizontal da página em 375 px. Texto ≥ 12 px (`text-xs`), em `rem`; funciona com zoom de 200%.
2. Alvos de toque `h-11`/`size-11` no celular; `md:h-9` no computador. Foco: o anel padrão (2 px + folga).
3. Usar os componentes do sistema em vez de HTML à mão: `Button`, `Input`, `Label`, `Select`, `Checkbox`,
   `Dialog`/`AlertDialog`, `Sheet`, `Tabs`, `Skeleton`, `KpiCard`. Modais à mão (`div fixed`) não prendem o foco,
   não fecham com Esc e o leitor de tela não os anuncia.
4. Cor de estado só por token (`success`, `warning`/`warning-text`, `destructive`, `info`, `accent`), sempre com
   texto ou ícone junto. Nada de `emerald-600`, `amber-500`, hex, `bg-${cor}/10` montado em tempo de execução
   (o Tailwind não gera essas classes, e a cor some).
5. Sem `uppercase tracking-wider`, sem degradê, sem sombra em repouso, sem `hover-lift`, sem `animate-pulse` em
   tela aberta o dia inteiro, sem animação de entrada a cada visita.
6. Carregando = `Skeleton` com a forma do conteúdo, nunca tela em branco nem spinner `text-primary`.
7. Título de aba: `head: () => ({ meta: [{ title: "Agenda · Odonto Connect" }] })` (e "Pacientes · …").
8. `hsl(var(--x))` e `hsl(var(--x) / a)` são CSS inválido aqui. Trocar por `var(--color-x)` ou
   `color-mix(in srgb, var(--color-x) N%, transparent)` (DESIGN.md › Pendências 1).

---

## Agenda (`src/routes/agenda.tsx` + `src/components/agenda/*`)

### Como deve ser em 375 px
- **Barra do dia** logo abaixo do cabeçalho do app, em até duas linhas:
  - Linha 1: a data como título-botão ("Qui, 5 nov", abre o calendário num Sheet de baixo), com ‹ Hoje › em `size-11` e "Mais ações" (⋯) para Sincronizar, Enviar dados, Recarregar, Intervalo e Configurar.
  - Linha 2: seletor do profissional (`Select h-11` em largura total) e o botão "Filtros" contornado, com contador. Ele abre um Sheet de baixo com status e profissionais, em linhas `h-11` com `Checkbox`.
- **Grade:** um profissional por vez, numa coluna de largura total. A coluna de horário fica fixa à esquerda (56 px, `sticky left-0`). A linha **"agora"** aparece quando a data é hoje, e a tela abre rolada até agora − 1 h (reaproveitar a lógica do `AgendaFragment`, fuso America/Sao_Paulo).
- **Cartão:** o alvo inteiro tem ≥ 44 px.
  - Linha 1: o nome do paciente em `text-sm font-medium`, caixa normal, até 2 linhas.
  - Linha 2: "09:00–09:30 · Limpeza" em `text-xs text-muted-foreground tabular-nums`.
  - Selo de status com ícone e texto, sempre visível.
- **Tocar num horário vazio** abre "Novo agendamento" já com a hora e o profissional.
- **Tocar num cartão** abre um Sheet de baixo (até 85 dvh), com:
  - nome, data, hora e profissional;
  - status em grade 2×3 de botões `h-11` com `aria-pressed`;
  - WhatsApp, "Abrir prontuário", Editar e Excluir em `h-11`, largura total. Excluir é contornado, com texto `destructive`.
- **Novo agendamento** abre em tela cheia (`h-dvh`), com os campos em uma coluna (data e hora lado a lado) e um rodapé fixo com Cancelar e Agendar.
- **Ação principal sempre à mão:** "Novo agendamento" como único botão cheio da tela, fixo no rodapé, respeitando `env(safe-area-inset-bottom)`.

### P1
| Onde | Problema | O que fazer |
|---|---|---|
| `agenda.tsx:281` (+ `:197`) | Altura fixa `h-[calc(100vh-220px)]` e `overflow-hidden`. No celular, o painel lateral (mini-calendário, status, profissionais, alertas: ~900 px) empurra a grade para fora. | Abaixo de `lg`, o painel lateral vai para o Sheet "Filtros". A tela vira `flex flex-col min-h-0` e a grade fica com `flex-1`. |
| `AgendaGrid.tsx:175, :204, :209` | Colunas `minmax(200px,1fr)` mais 72 px: cabe 1,5 profissional, e na rolagem lateral a coluna de horário some. | Um profissional por vez abaixo de `md` (ou a vista "Lista do dia"). Horário em `sticky left-0 z-10 bg-card`, 56 px. |
| `AgendaGrid.tsx:327-328` | O cartão mostra `evento_titulo \|\| procedimento \|\| paciente` em 12 px, negrito, caixa alta e cortado. **Quando há procedimento, o nome do paciente não aparece.** | Linha 1: paciente (ou o título, se for evento), `text-sm font-medium`, `line-clamp-2`. Linha 2: horário e procedimento. |
| `AgendaGrid.tsx:258, :261` | Um slot de 48 px dá cartões de 46 px, que caem no modo compacto e escondem o status. | O modo compacto mantém, numa linha só, o ícone de status (com rótulo `sr-only`), o nome e a hora. A categoria é a primeira coisa a sair. Avaliar slot de 56 px no celular. |
| `AgendaGrid.tsx:38-44`, `AgendaStatusFilter.tsx:4-9`, `AgendamentoPopover.tsx:19-26` | Três mapas de status com cores cruas (`amber-600` sobre `amber/15` ≈ 2,9:1, `emerald-600` ≈ 3,3:1: reprovam AA) e diferentes entre si. | Um mapa único `src/components/agenda/status.ts`: agendado = `bg-muted` + Clock; confirmado = `bg-success/10 text-success` + CheckCircle2; em atendimento = `bg-info/10 text-info` + PlayCircle; finalizado = `bg-muted text-muted-foreground` + Check; faltou = `bg-warning/15 text-warning-text` + AlertTriangle; cancelado = `bg-muted` com texto riscado + XCircle. |
| `AgendaGrid.tsx:238-247` | A célula vazia é um `<div onClick>`: não recebe foco nem responde ao teclado, e a dica "+ 09:30" (10 px) só aparece no hover. | `<button type="button" aria-label="Novo agendamento às 09:30 com Dra. Ana">`, com hover `bg-accent/60`, mais o botão fixo de "Novo agendamento" no celular. |
| `AgendamentoPopover.tsx:52-56` | O popover se prende a um `<span className="hidden">`, então aparece longe do cartão, e em 375 px sai da tela. | No computador, ancorar no cartão (a prop `anchorRect` já existe e não é usada). Abaixo de `md`, Sheet de baixo. |
| `AgendamentoPopover.tsx:96-143` | Botões de 28–32 px; a lixeira não tem rótulo; o status ativo aparece só pela cor. | `h-11 md:h-9`; `aria-label="Excluir agendamento"`; status com `aria-pressed` e ícone de check no ativo. |
| `agenda.tsx:231-277` | Nove controles com o mesmo peso, rótulos de 11 px em caixa alta. As ações do Clinicorp competem com a rotina. | Visíveis: ‹ Hoje ›, a data, o intervalo e **um** "Novo agendamento" cheio. O resto vai para um `DropdownMenu` "Mais ações". |

### P2
- `agenda.tsx:234-245`: o seletor de intervalo tem `h-7` e `focus:ring-0` (some o foco), e as opções estão em caixa alta. Trocar pelo `SelectTrigger` padrão com `aria-label="Intervalo da grade"`; no celular, ele vai para o Sheet.
- `agenda.tsx:204-229`: a data não é título semântico, e no celular o botão vira ícone sem rótulo. Usar a data como `<h2>` que abre o calendário. Remover o botão "Selecionar data" duplicado.
- `AgendaGrid.tsx:170-174`: `glass-card` + `shadow-xl` + `rounded-2xl` no contêiner. Trocar por `bg-card border rounded-lg`. O cabeçalho sticky usa `.surface-glass`, que é o único uso permitido de vidro.
- `AgendaGrid.tsx:185-194`: cabeçalho do profissional com iniciais de 10 px, nome em caixa alta e especialidade de 9 px. Usar avatar redondo `size-8`, nome em `text-sm font-semibold` e especialidade em `text-xs text-muted-foreground`.
- `AgendaGrid.tsx:295, :310, :361`: o hover sobe o cartão com `shadow-xl`, e o indicador de compartilhado pulsa sem parar. Deixar no hover só a troca de tom, em 150 ms. O indicador fica estático.
- `AgendaGrid.tsx:71, :78, :318`, `CategoriaBadge.tsx:27, :124, :175`, `AnalogTimePicker.tsx:258-285`: `hsl(var(--x))` quebrado (a listra neutra some). Corrigir conforme a regra 8. No relógio, sem degradê.
- `AgendaGrid.tsx:287-292, :372-386`: o cartão não tem nome acessível completo, e a equipe do evento só aparece em tooltip. Usar `aria-label="09:00 às 09:30, Maria Souza, Limpeza, Confirmado"` e levar a equipe para o Sheet ou popover.
- `AgendaGrid.tsx:160-166`, `agenda.tsx:301-309`: falta esqueleto e falta estado vazio. Mostrar Skeleton com 3–4 cartões por coluna e `aria-busy`. Dia vazio: "Nenhum agendamento em 5 de novembro" com o botão "Novo agendamento".
- `AgendaMiniCalendar.tsx`: dias de 28 px sem rótulo nem `aria-current`, mês em 11 px caixa alta. Usar o `Calendar` do shadcn (já importado na rota) ou `size-9`/`size-11` com `aria-label` da data completa.
- `AgendaStatusFilter.tsx`, `AgendaProfessionalsList.tsx`: títulos em 10 px caixa alta, e o ligado/desligado aparece só por opacidade. Usar `Checkbox` + `Label` em linhas `h-9`/`h-11`, sem `glass-card` e sem `shadow-lg`.
- `AgendaProfessionalsList.tsx:45-94`, `AgendaGrid.tsx:231`: a cor do profissional muda conforme o filtro, porque o índice é calculado sobre os visíveis. Criar uma função única `corDoProfissional(prof)`, com hash do id → `chart-N`.
- `AgendaProfessionalsList.tsx:70-89`: "Alertas de retorno" mostra sempre "Nenhum retorno pendente", porque a rota não passa os dados. **Esconder** até existir a fonte (mesmo critério do sino removido do cabeçalho).
- `NovoAgendamentoModal.tsx:299-484`: `grid-cols-4` fixo, campos de ~60 px em 375 px. Abaixo de `sm`, tela cheia; `grid-cols-1 sm:grid-cols-2` e `grid-cols-2 sm:grid-cols-4`.

### P3
- `NovoAgendamentoModal.tsx`: degradês, rótulos em caixa alta, emoji nas opções de origem, "⚠️" no aviso. Usar `Label` padrão, opções só em texto e o aviso em `text-warning-text` com AlertTriangle.
- `AnalogTimePicker.tsx`: cabeçalho com `gradient-primary`, `shadow-2xl`, atalhos de 20 px. Deixar chapado (`bg-muted`), com atalhos `h-9`/`h-11`. No celular, oferecer `<Input type="time">`.
- `agenda.tsx:23-26, :195`: falta `head`; o contêiner tem `animate-fade-in` e `bg-background/50`. Usar fundo opaco e tirar a animação.

---

## Pacientes (`src/routes/pacientes.tsx` + `src/components/OdontogramaChart.tsx`)

### Como deve ser em 375 px
- **Página** em `px-4 py-6`, com:
  - Indicadores: `KpiCard` em 2×2 (Total, Com convênio, Particular, Cadastrados hoje), com esqueleto na primeira carga.
  - Busca `h-11` em largura total, com `type="search"` e um X para limpar.
  - Ao lado da busca, o botão Filtros (`size-11`, com contador), que abre um Sheet de baixo com "Limpar" e "Ver N pacientes".
  - Contagem "128 pacientes" em `text-xs`, com `aria-live`.
- **Lista:** cartões em uma coluna, cada um um link focável de ≥ 72 px:
  - avatar redondo de 40 px;
  - nome em até 2 linhas, sem cortar;
  - "34 anos · Feminino" e o telefone em 12 px;
  - selo de convênio `bg-accent` e chevron neutro;
  - sem sombra e sem "levantar" no hover.
- **Novo paciente:**
  - Botão cheio `h-11` fixo no rodapé, respeitando a área segura; a lista ganha `pb-20`.
  - O formulário abre em tela cheia, com os campos `h-11` em uma coluna, o teclado certo (tel, numérico, e-mail) e o erro abaixo do campo.
  - Rodapé fixo com Cancelar e "Cadastrar paciente", que vira "Cadastrando…" com `aria-busy`.
- **Detalhe:** tela cheia aberta por `?pacienteId=`, para o botão voltar do celular fechar.
  - Topo fixo: voltar (44 px), avatar, nome e "34 anos · Convênio".
  - Abas `h-11` só com texto, com rolagem horizontal se não couberem.
  - Na aba Dados:
    - em leitura, uma lista `dl`, com telefone e e-mail como links (`tel:`/`mailto:`);
    - "Editar" contornado;
    - "Excluir paciente" ghost em vermelho, separado, que abre um `AlertDialog`.

### P1
| Onde | Problema | O que fazer |
|---|---|---|
| `OdontogramaChart.tsx:323` | A cor do dente é montada como `${hsl(...)}20`, que é CSS inválido, e **o fundo de todo dente some**. | `color-mix(in srgb, <token> 15%, transparent)`, com cada status ligado a um token (saudável = success, cárie = destructive, restaurado = info, canal = warning, implante = primary, ausente = muted-foreground). |
| `pacientes.tsx:1554` | O `ListCard` usa `bg-${color}/10`: o Tailwind não gera a classe, e os selos de Alergias, Medicamentos, Doenças e Cirurgias **ficam sem cor**. | Mapa estático (destructive → `bg-destructive/10 text-destructive`, …), com `Badge`. Alergia leva o ícone AlertTriangle. |
| `pacientes.tsx:500, :799, :954` | Novo paciente, detalhe e confirmação de exclusão são `div fixed` à mão: sem `role="dialog"`, sem prender o foco, sem Esc. | `Dialog` a partir de `md`; `Sheet`/`Drawer` em tela cheia abaixo de 768 px; `AlertDialog` para excluir. |
| `pacientes.tsx:326, :352` | O cartão do paciente é `div onClick` (sem foco nem Enter), e o botão do olho fica `opacity-0` até o hover, ou seja, invisível no toque. | O cartão inteiro vira `<Link to="/pacientes" search={{ pacienteId }}>` (o `validateSearch` já existe), e o olho sai. |
| `OdontogramaChart.tsx:338` | 16 dentes de 22 px ≈ 367 px num modal com ~295 px úteis: o arco é cortado. | Abaixo de 768 px, um quadrante por vez (`ToggleGroup`), com cada dente como `<button>` de ≥ 40×44 px e `aria-label` "Dente 16, cárie". |
| `OdontogramaChart.tsx:474` | No editor, o status usa a própria cor como texto (canal ≈ 2:1, implante ≈ 2,5:1). | Texto em `text-foreground`, a cor só na bolinha, `ToggleGroup` `h-11 md:h-9` e o selecionado em `bg-accent`. |
| `pacientes.tsx:166` | `p-8` fixo: no celular sobram 311 px úteis. | `px-4 py-6 md:p-8 … max-w-[1600px] mx-auto`, como no dashboard. |
| `pacientes.tsx:802` | No cabeçalho do detalhe, Excluir, Editar e X ficam na linha do nome, sem quebra, e espremem o nome. | Duas linhas no celular. Abas com `Tabs` do shadcn. |
| `pacientes.tsx:584` | Campos à mão `h-9` com `border-border/60` (< 3:1, reprova WCAG 1.4.11) e foco fraco. | `Input`/`Select`/`Label` do sistema, com `h-11`, `id` e `htmlFor`. Na busca, `aria-label`. |
| `pacientes.tsx:930, :1168` | "Observações" em `text-warning` ≈ 2,1:1; alerta clínico em `text-destructive/80`. | `text-warning-text` sobre `bg-warning/10`; alerta clínico em `Alert variant="destructive"` com `role="alert"`. |
| `pacientes.tsx:171-308` | KPIs, filtros e rótulos em 10–11 px caixa alta espaçada. | Seguir a escala do app (12/13/14/15 px), sem `uppercase`. |
| `pacientes.tsx:209, :519` | "Filtros" ~36 px sem `aria-expanded`; "Limpar filtros" com 16 px de altura; "Buscar lead" ~28 px. | `Button` `h-11 md:h-9` e `aria-expanded`/`aria-controls`. |

### P2
- `pacientes.tsx:168`: os 4 indicadores são cartões à mão com degradê, `shadow-card` e `hover-lift`. Trocar por `KpiCard` com `loading`.
- `pacientes.tsx:328`: cartão com `rounded-2xl` e sombra; avatar quadrado `bg-primary/10`. Usar `bg-card border rounded-lg` e avatar redondo `bg-muted`.
- `pacientes.tsx:313` (+ abas `:1109`, `:1370`, `:1485`): spinner no lugar do esqueleto. Usar `Skeleton` com a forma do cartão e `aria-busy`. Nas recargas, manter a lista atual na tela.
- `pacientes.tsx:1454`: status do histórico com a paleta crua do Tailwind, e "Faltou"/"Cancelado" em vermelho de erro. Usar o mapa de tokens (faltou = aviso, cancelado = neutro), igual ao da agenda.
- `pacientes.tsx:576`: formulário em `grid-cols-2` fixo, colunas de ~130 px em 375 px. Usar `grid-cols-1 sm:grid-cols-2`. ⚠️ Sexo e convênio aparecem no formulário, mas **não vão no payload de criação**: combinar com o Marcos (é regra de negócio).
- `pacientes.tsx:457, :740`: "Nome é obrigatório" só aparece em toast. Mostrar o erro no campo, com `aria-invalid`/`aria-describedby` e foco nele (padrão do cadastro de clínica).
- `pacientes.tsx:880`: ícone `text-primary` em cada bloco da aba Dados (8×). Usar ícones neutros, `<dl>` com `divide-y`, e telefone e e-mail como links.
- `pacientes.tsx:1162`: o alerta clínico só considera alergias e cardiopatia; hemofilia, gestação, diabetes e epilepsia ficam de fora. Mostrar um `Alert` no topo da anamnese com todas as condições marcadas (destructive para alergia e hemofilia, aviso para as demais). ⚠️ Critério clínico: confirmar com o dono antes.
- `pacientes.tsx:237`: o painel de filtros empurra a lista e não está ligado ao botão. No celular, abrir num Sheet de baixo; no computador, deixar inline com `id` + `aria-controls`.

### P3
- `pacientes.tsx:39`: falta `head`; o título está em caixa de título ("Cadastro de Pacientes", "Novo Paciente"). Usar caixa de frase: "Pacientes", "Novo paciente", "Excluir paciente".
- `pacientes.tsx:227`: no celular, "Novo paciente" cai para baixo da busca, longe do polegar. Usar o botão fixo no rodapé, como descrito acima.

---

## Como validar
Use o ambiente local do Caio (`docs/operacao/ambiente-local.md`, PR #21): `recepcao.alfa@teste.local`,
em 375 e 1440 px, claro e escuro. Antes e depois, rode o inspetor de app:
`node ~/.claude/skills/design-taste-frontend/scripts/inspect.mjs <url> --app`. Contraste medido pela
fórmula WCAG; nenhum alvo abaixo de 44 px no celular; nenhuma rolagem lateral.
