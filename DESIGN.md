# DESIGN.md — Odonto Connect

Sistema visual do Odonto Connect. Mantido pela Lara (design). Vale para todas as telas; cada
frente que criar tela nova segue o que está aqui. Fonte da verdade dos valores: `src/styles.css`.

Produto: SaaS multi-clínica para clínicas odontológicas no Brasil. Quem usa: recepcionista (muitas
vezes no celular, com pressa), dentista (entre um paciente e outro) e gestor/dono (números do dia e
do mês). O sistema precisa parecer **confiável, clínico e calmo**, sem cara de modelo pronto.

---

## 1. Auditoria do sistema anterior (5 nov 2026)

O que havia antes desta revisão e por que mudou. Arquivos: `src/styles.css`, `src/components/ui/*`
(shadcn), `AppSidebar.tsx`, `DashboardHeader.tsx`, `KpiCard.tsx`, landing, login e cadastro.

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| A1 | `--primary` ciano `hsl(187 85% 43%)` com texto branco: **contraste 2,47:1**. Reprova WCAG AA (mínimo 4,5:1) em todos os botões primários do sistema. | Alta (acessibilidade, todas as telas) | Corrigido: `hsl(189 88% 29%)` = 5,19:1. |
| A2 | `--muted-foreground` `hsl(200 10% 50%)` sobre o fundo: 3,65:1. Reprova AA para texto secundário. | Alta | Corrigido: `hsl(215 14% 40%)` ≈ 5,4:1. |
| A3 | Regras CSS quebradas: `hsl(var(--primary) / 0.2)`, mas as variáveis já guardam `hsl(...)` completo, então a regra é inválida e o navegador a ignora. Em `styles.css`: `.glass-card`, rabinho do balão do chat (`.msg-tail-right`, **o rabinho da mensagem enviada não aparecia**), hover do balão e `borderPulse`. | Média | Corrigido em `styles.css` com `var(--color-…)` e `color-mix()`. |
| A4 | O mesmo padrão `hsl(var(--x) / a)` aparece em **115 lugares** (118 em 5 nov 2026, §15) em `.tsx` (chat, agenda, disparos, campanhas, gravador de áudio…). Cada um é uma cor que some sem aviso. | Média | **Não corrigido** (arquivos de outras frentes). Ver "Pendências". |
| A5 | `html *` com `transition` de 300 ms em cor, borda e sombra para **todo elemento**: cada hover e troca de estado atrasava, e isso custa desempenho em listas longas (chat, agenda). | Média | Removido; a transição ficou só no `body`. |
| A6 | Linguagem visual de "template": degradê no botão primário (`.gradient-primary`), texto em degradê, brilho ciano (`shadow-glow-primary`), vidro com desfoque, cartões com bolha de degradê no canto, ícone em quadrado colorido, pílula acima do título, rótulos em CAIXA ALTA com espaçamento. | Média (marca) | Utilitários reescritos chapados (os nomes continuam, para não quebrar ~70 usos). |
| A7 | Fonte base 14 px para tudo, inclusive landing. | Baixa | App mantém 14 px; páginas públicas usam 16 px+. |
| A8 | Sidebar: o símbolo do logotipo (arte 2:1) era espremido num quadrado 32×32; abrir pelo hover **empurrava a página inteira** (reflow); seções recolhidas viravam tracinhos sem significado; rótulos de 8–10 px; texto "v2.1.1 — deploy test" visível ao cliente; sem versão para celular (trilho de 60 px fixo). | Alta (1ª impressão) | Corrigido. |
| A9 | Cabeçalho das telas internas no celular: busca de 288 px fixos **saía da tela** (rolagem lateral); a data quebrava em duas linhas; ponto vermelho de notificação **sempre aceso**, sem notificação nenhuma. | Alta | Corrigido; ponto removido (botão de notificações ainda não faz nada — ver Pendências). |
| A10 | `KpiCard` no celular: rótulo em caixa alta não cabia e passava **por cima do ícone**. | Média | Corrigido. |
| A11 | Landing no celular (390 px): barra do topo transbordava (botão cortado); sem `h1` visível na primeira tela para o inspetor; 12 cartões iguais com ícone; mosaico de "dashboard" falso de barras cinza. | Alta | Redesenhado. |
| A12 | Modo escuro: `--primary-foreground` branco sobre ciano claro (contraste ~2:1). | Média | Corrigido: texto azul-marinho sobre ciano no escuro (9,5:1). |

Contrastes medidos (fórmula WCAG 2.x): ver tabela de cores abaixo.

---

## 2. Direção

**O produto trabalhando.** O que convence uma clínica é ver a própria rotina funcionando: a agenda do
dia com o paciente confirmado pelo WhatsApp, o caixa batendo, o paciente sumido voltando. Por isso as
páginas públicas mostram **pedaços reais da interface** (construídos em HTML, com conteúdo de exemplo
e que respondem ao clique), não ilustrações nem capturas encolhidas.

- Modo das telas internas: **Operar** (precisão e calma, padrões conhecidos).
- Modo da landing: **Persuadir** (uma ideia forte por dobra, o produto como imagem).
- Ideia da landing: *a agenda do dia da clínica vira a peça principal da primeira tela* — com a linha
  "agora" no horário de Brasília e status que avança ao toque.

---

## 3. Cor

Tinta azul-marinho do logotipo + ciano-petróleo para ação. Uma cor de ação por tela.

| Papel | Token | Claro | Escuro | Uso |
|---|---|---|---|---|
| Fundo | `--background` | `hsl(200 20% 98%)` | `hsl(220 20% 10%)` | página |
| Superfície | `--card` | branco | `hsl(220 20% 13%)` | cartões, painéis, cabeçalho |
| Tinta | `--foreground` | `hsl(222 47% 13%)` (azul-marinho) | `hsl(220 10% 95%)` | texto principal |
| Tinta secundária | `--muted-foreground` | `hsl(215 14% 40%)` · 5,4:1 | `hsl(215 14% 65%)` · 7,3:1 | legendas, datas |
| Ação | `--primary` | `hsl(189 88% 29%)` · 5,2:1 c/ branco | `hsl(187 80% 52%)` · 9,5:1 c/ azul-marinho | botão principal, link, ícone ativo |
| Realce suave | `--accent` / `--accent-foreground` | `hsl(187 60% 94%)` / `hsl(189 88% 24%)` · 6,3:1 | | item ativo, selo "Confirmado" |
| Ciano da marca | `--dental-cyan` | `hsl(187 85% 43%)` | | **só** decoração grande e gráficos; nunca texto pequeno sobre branco |
| Palco | `--stage` / `--stage-foreground` / `--stage-muted` | `hsl(238 49% 12%)` (= fundo do símbolo) | `hsl(222 40% 7%)` | faixa escura da landing, painel do login |
| Sucesso | `--success` | `hsl(152 70% 27%)` · 5,7:1 c/ branco | `hsl(152 60% 48%)` + texto azul-marinho | confirmado, pago, ganho |
| Aviso | `--warning` / `--warning-foreground` / `--warning-text` | fundo `hsl(38 92% 50%)`; texto sobre ele `hsl(30 30% 15%)`; texto/ícone sobre o cartão `hsl(30 95% 32%)` | `hsl(38 92% 55%)` | pendente, falta, sem resposta |
| Erro | `--destructive` | `hsl(0 72% 45%)` · 5,8:1 c/ branco | `hsl(0 85% 65%)` + texto azul-marinho · 5,4:1 | erro real, perda, excluir |
| Informação | `--info` | `hsl(217 91% 45%)` · 6,0:1 | `hsl(217 91% 65%)` + texto azul-marinho | aviso neutro |
| Borda de campo | `--input` | `hsl(215 14% 55%)` · 3,5:1 | `hsl(220 14% 45%)` · 3,2:1 | campos e botão contornado (WCAG 1.4.11) |
| Divisória | `--border` | `hsl(210 16% 90%)` | `hsl(220 14% 22%)` | cartões, separadores (decorativa) |

Regras:
- Sem degradê e sem brilho. Vidro (`.surface-glass`) **só** em cabeçalhos fixos sobre conteúdo que
  rola; o resto é opaco. Superfícies separadas por um passo de tom ou uma borda de 1 px dentro do
  app; na landing, por troca do fundo da seção.
- `@media (prefers-contrast: more)` escurece texto de apoio, bordas e a cor de ação (claro e escuro).
- Sombra só no que flutua: menu, diálogo, gaveta, trilho da sidebar aberto por hover.
- Texto corrido na tinta cheia; cinza só para o que é secundário.

---

## 4. Tipografia

Duas famílias, já carregadas em `__root.tsx`:

- **Space Grotesk** (`font-heading`): títulos e números grandes. Peso 600, tracking −0,02 a −0,03 em.
- **Inter** (`font-sans`): todo o resto. Números com `tabular-nums` onde alinham (KPIs, horários, valores).

Escala do app (telas internas, base 14 px):
`12` legenda · `13` rótulo/menu · `14` texto · `15` título de seção · `18` título da página (cabeçalho) ·
`24` valor de KPI · `28` saudação do dashboard.

Escala da landing (base 16 px): `15` navegação/nota · `16` texto · `18` texto de apoio ·
`26/34/40` título de seção (celular/tablet/computador) · `30` título de funcionalidade ·
`30/48/60` título principal · `56` nomes dos planos · `96` preço.

Regras: títulos em no máximo duas linhas em qualquer largura; caixa normal (nada de CAIXA ALTA
espaçada); sem rótulo pequeno acima do título.

---

## 5. Espaço, raio, movimento

- `--radius: 0.625rem` (10 px) no app; componentes usam `rounded-md` (8 px) e `rounded-lg` (10 px).
  Selos e status: `rounded` (4–6 px). Avatar: círculo.
- Landing: uma largura (`max-w-[1280px]`), uma margem (`px-5 / sm:px-8 / lg:px-12`), seções com
  96–144 px de respiro.
- App: conteúdo do dashboard até 1600 px, `px-4` no celular e `p-8` no computador.
- Alvos de toque ≥ 44 px em tela de toque (token `touch`; o `<Button>` ganha a área sozinho, ver §13). No computador, denso a partir de 36 px.
- Movimento: só `transform` e `opacity`, saída rápida (`cubic-bezier(0.16, 1, 0.3, 1)`), nada de
  "quique". `prefers-reduced-motion` zera animações (regra global em `styles.css`).
- Foco visível global: contorno de 2 px na cor `--ring` com folga de 2 px.

---

## 6. Componentes compartilhados

| Componente | Arquivo | Regras |
|---|---|---|
| Botões, campos, diálogos | `src/components/ui/*` (shadcn) | Não editar o visual tela a tela; mudar por token. Foco: anel de 2 px com folga de 2 px. Sem sombra em repouso. Pressão: desce 1 px. Campo com `aria-invalid` ganha borda de erro. Campos de formulário em telas de entrada: `h-11`. |
| `KpiCard` | `src/components/KpiCard.tsx` | Superfície chapada com borda; rótulo em caixa normal 13 px que quebra linha; ícone 16 px **neutro** (cor só para estado); valor 24 px tabular. `changeType`: `positive` · `negative` (erro/perda real) · `warning` (pede atenção) · `neutral`. `loading` mostra esqueleto na primeira carga. |
| Sidebar | `src/components/AppSidebar.tsx` | Computador: trilho de 64 px; ao passar o mouse abre 248 px **por cima** do conteúdo; botão de fixar. Celular (< 768 px): barra de 56 px com botão "Abrir menu" e gaveta (Sheet) de 288 px que fecha ao trocar de página. Item ativo: fundo `--sidebar-accent`, `aria-current="page"`. Seções: rótulo 12 px em caixa normal. |
| Cabeçalho | `src/components/DashboardHeader.tsx` | 64 px (56 no celular), material translúcido. Título 18 px + data no computador. Busca larga só a partir de 1024 px; abaixo, ícone de 44 px. Avatar (44 px no celular) leva a `/perfil`. Sem sino até existir a central de notificações. |
| Moldura de entrada | `src/components/auth/AuthShell.tsx` | Login, cadastro, recuperar senha. Formulário à esquerda (máx. 400 px); palco azul-marinho com a agenda à direita a partir de 1024 px. |
| Agenda de exemplo | `src/components/marketing/AgendaFragment.tsx` | Fragmento de interface (`data-ui`), pacientes de exemplo, linha "agora" em America/Sao_Paulo, status avança ao clique. |
| Tema | `src/hooks/useTheme.ts` | Preferência **Sistema → Claro → Escuro** (padrão: sistema, acompanha a troca do aparelho ao vivo). Botão na sidebar com ícone e rótulo do estado. |
| Tema claro forçado | `src/hooks/useForceLightTheme.ts` | Landing e telas de entrada ficam sempre claras (o logotipo tem texto azul-marinho). O tema do usuário volta ao entrar no app. |

Utilitários antigos mantidos por compatibilidade (agora chapados): `.gradient-primary` = fundo
`--primary`; `.gradient-text` = cor `--primary`; `.shadow-glow(-primary)` = sombra neutra leve;
`.glass-card` = cartão com borda. **Não usar em telas novas.**

---

## 7. Landing (`src/routes/index.tsx`)

Ordem: navegação simples → primeira tela (título "Gestão odontológica de A a Z", texto original, dois
botões, agenda funcionando no palco azul-marinho) → funcionalidades (cinco em destaque, cada uma com
um pedaço de interface que responde: reativação "Convidar", semana da agenda, conversa atendida pela
recepção, caixa do dia; mais oito em lista) → quem criou (foto do Dr. Luis Gustavo) → planos (nomes à
esquerda e limites do banco à direita, **sem preço** até haver uma fonte só; no celular os três
completos) → dúvidas (uma aberta por vez) → chamada final → rodapé. Textos de venda revisados pela
Helena (`docs/juridico/revisao-prs-lote-1.md`); prazo do teste em `src/lib/oferta.ts`.

**Prova social em espera:** depoimentos, faixa "Quem confia", "500+ clínicas", "98% satisfação" e
"centenas de clínicas" não têm fonte no repositório. Ficam no código atrás de
`PROVA_SOCIAL_CONFIRMADA = false` até a Helena e o dono confirmarem (CDC art. 37; Código de Ética
Odontológica sobre publicidade). Para religar: mudar para `true`.

---

## 8. Princípios (inspirados no Apple HIG)

Estudamos as [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
(páginas Layout, Typography, Color, Dark Mode, Materials, Motion, Accessibility, Feedback, Loading,
Buttons) e **adaptamos os princípios**, não a aparência. Não usamos SF Pro nem SF Symbols (licença só
para plataformas Apple), nem logos ou imagens da Apple: as fontes continuam Inter e Space Grotesk e
os ícones, lucide. Os valores em pt do HIG são de cada aparelho Apple; os números abaixo são a nossa
tradução para web.

| Princípio | Como vira regra/token aqui | Onde já está aplicado |
|---|---|---|
| **Clareza e hierarquia: conteúdo primeiro, cromo discreto** | Ordem de leitura: título → resumo/ação principal → conteúdo. Cromo (sidebar, cabeçalho) neutro; `--primary` só na ação principal, no link, no foco e no item ativo. Ícones decorativos em `--muted-foreground`. | Ícones do KpiCard, títulos de seção e cabeçalho viraram neutros; o "Convidar" da landing virou contornado (um botão cheio por área). |
| **Tipografia com escala e pesos consistentes** | Tamanhos em **rem** (o `body` passou de `14px` para `0.875rem`). Mínimo de 12 px (`text-xs`); nada de 10–11 px. Pesos 400/500/600/700, nunca fino. Duas famílias. Hierarquia por tamanho, peso e cor (`foreground` → `muted-foreground`). | `styles.css`, sidebar (selos 10–11 px → 12 px), fragmento da agenda, todos os `text-[Npx]` das telas viraram rem. |
| **Texto ampliável (Dynamic Type → rem)** | Respeitar a fonte e o zoom do navegador: rem em texto, `min-h-*` em vez de altura fixa em selos, quebra de linha em vez de cortar nome/valor. Testar com 200%. | Selos `min-h-6`, KpiCard com `break-words`. |
| **Grade de 4/8 px** | Escala do Tailwind (4 px). Dentro de componente, passos de 4; entre blocos e seções, múltiplos de 8. Espaço entre grupos ≥ 2× o espaço dentro do grupo. | Dashboard: `gap-3/4` nos cartões, `space-y-8/10` entre seções. |
| **Áreas de toque ≥ 44 px** | Em tela de toque: `size-11`/`h-11` (44 px) em botões, campos e itens de menu; no computador, denso a partir de 36 px (`md:h-9`). Ações vizinhas com `gap-2`+. | Itens da gaveta do celular `h-11`, botões do rodapé da sidebar, busca/avatar do cabeçalho, "Esqueci minha senha", mostrar senha, campos `h-11`, botões da barra da landing. |
| **Cantos e profundidade sutis** | Raios concêntricos: selo 4–6 px, botão/campo 8 px, cartão 10 px. Profundidade por camadas de tom; sombra só no que flutua. No escuro, elevação pela claridade: fundo 10% → cartão 13% → popover 16%. | Botões do shadcn sem sombra em repouso; `--popover` do escuro mais claro. |
| **Vidro com moderação** | Um utilitário, `.surface-glass` (85% do fundo + blur 12 px), **só** em cabeçalhos fixos. Nunca em cartões, nunca vidro sobre vidro. Fica opaco com `prefers-reduced-transparency` ou `prefers-contrast: more`. | Barra da landing e cabeçalho das telas internas. |
| **Cor com propósito** | Uma cor de destaque (`--primary`). Cores semânticas só para estado, sempre com texto ou ícone junto (nunca só cor). Todas passam AA: texto ≥ 4,5:1, borda de campo e ícone informativo ≥ 3:1. | `--success`, `--destructive`, `--info` e `--input` corrigidos (antes 2,9:1, 3,9:1, 3,6:1 e 1,5:1). Dashboard: "Reprovados" e "Pacientes ativos" não pintam mais sem dado; faltas/sem resposta/inativos usam **aviso**, não erro. |
| **Modo escuro de verdade** | Tokens próprios no escuro (nada de inverter), `color-scheme` declarado, texto de apoio ≥ 7:1 no cartão, texto escuro sobre cores claras de estado. Padrão: **seguir o sistema**. | `useTheme` com Sistema/Claro/Escuro; variante `dark:` corrigida (`:where(.dark, .dark *)`). |
| **Movimento curto e funcional** | Só `transform` e `opacity`; 120–200 ms em interação, ≤ 300 ms em painel. Nada de cascata em telas abertas várias vezes por dia. `prefers-reduced-motion` zera duração **e atraso** (senão o conteúdo ficava invisível). Spinner para com movimento reduzido. | Dashboard sem cascata de entrada; regra global corrigida; landing mantém a entrada só na primeira dobra. |
| **Acessibilidade** | Foco visível em tudo (anel de 2 px + folga). Erro ligado ao campo (`aria-invalid` + `aria-describedby`) e anunciado (`role="alert"`). `aria-busy` em botão carregando. Título de aba por tela. Rótulo em todo botão de ícone. `prefers-contrast: more`. | `button`, `input`, login, cadastro, dashboard (`head` com título), sidebar (rótulo do tema diz o estado e o próximo). |
| **Feedback imediato** | Pressão: botão desce 1 px. Carregando: esqueleto com a forma do conteúdo (nunca "0" falso). Rótulo do botão diz o que está acontecendo ("Entrando…", "Criando conta…"). Erro perto do campo, em pt-BR, com saída ("Tentar de novo"). Sem controle morto. | KpiCard com esqueleto; erro do dashboard com "Tentar de novo"; cadastro com erro por campo (antes: toast no canto); sino sem função removido. |
| **Consistência de componentes** | Um só jeito para cada coisa: botão do shadcn, `KpiCard`, `SectionHeader`, `AuthShell`, `.surface-glass`. Telas novas usam estes, não estilos soltos. | — |

Regras que **não** trazemos da Apple para a web: Liquid Glass e efeitos de borda de rolagem, extensão
de fundo por espelhamento, classes de tamanho por aparelho (usamos breakpoints), áreas seguras de
hardware (só `env(safe-area-inset-*)` se virar PWA), SF Pro/SF Symbols.

## 9. Pendências (para depois)

1. **115 cores quebradas** `hsl(var(--x) / a)` em `.tsx` (A4). Trocar por `color-mix(in srgb, var(--color-x) N%, transparent)`
   ou pela classe Tailwind `bg-primary/20`. Arquivos de chat, agenda, disparos, campanhas — combinar com as frentes donas.
2. **Prazo do teste grátis**: hoje 14 dias numa constante (`TESTE_GRATIS_DIAS`); decisão do dono pendente.
3. Número do WhatsApp do consultor: `WHATSAPP_CONSULTOR = null` em `src/lib/oferta.ts` até haver o número real.
4. Central de notificações (o sino saiu do cabeçalho porque não fazia nada).
5. Gráficos do dashboard (`src/components/charts/*`) ainda com o visual antigo; "Faturamento mensal" mostra R$ 0 com a API de teste.
6. Telas mais usadas (agenda, chat, pacientes, atendimento) — próxima rodada, com as frentes donas.
7. Imagens reais do mundo da clínica (além da foto do fundador) na landing — hoje só fragmentos de interface.
8. Levar os princípios do HIG às telas das outras frentes: botões de ação a 44 px no celular, erros por campo, esqueleto no lugar de "0" e cores de estado com texto/ícone (agenda, pacientes, chat, financeiro).
9. ~~Escala tipográfica como tokens no `@theme`~~ feito em 5 nov 2026 (§10). Falta trocar os `text-[…]` soltos tela a tela (§15).

---

## 10. Tokens (referência rápida)

Valores em `src/styles.css`. O projeto usa Tailwind 4, sem `tailwind.config`: os tokens fixos ficam no
bloco `@theme`, e os que mudam com o tema ficam em `:root` / `.dark`, ligados por `@theme inline`.
O `cn()` (`src/lib/utils.ts`) conhece os tokens novos, então `cn("text-caption", "text-primary")`
mantém os dois.

**Cor:** ver §3. Pares medidos por `node scripts/design/contraste.mjs`, que sai com erro se algum
par cair abaixo de AA (texto 4,5:1; borda de campo, foco e gráfico 3:1). Hoje: 33 pares × 2 temas,
todos passam. Na primeira medição, `--chart-4` estava em 2,1:1 no claro; foi para `hsl(32 95% 40%)`,
que dá 3,8:1.

| Grupo | Token → utilitário | Valor | Uso |
|---|---|---|---|
| Texto | `text-caption` | 12/16 | legenda, selo, horário (mínimo do sistema) |
| | `text-footnote` | 13/18 | rótulo, menu, tabela densa |
| | `text-body` | 14/20 | texto do app (= `body`) |
| | `text-callout` | 15/22 | título de cartão e de seção |
| | `text-title-3` | 18/24 | título da página (cabeçalho) |
| | `text-title-2` | 24/32 | valor de KPI |
| | `text-title-1` | 28/36 | saudação, título de estado vazio |
| Texto (páginas públicas) | `text-display-26` · `-32` · `-34` · `-40` · `-48` · `-56` · `text-hero` | 26–56 px; hero `clamp(48, 4vw, 60)` | títulos da landing e das telas de entrada (§4); texto corrido usa `text-base`/`text-lg` |
| Toque | `size-touch`, `min-h-touch`, `h-touch` | 44 px | alvo mínimo em tela de toque |
| Espaço | escala do Tailwind (`1` = 4 px) | 4/8 | §8 › Grade |
| Raio | `rounded` · `rounded-md` · `rounded-lg` · `rounded-full` | 4–6 · 8 · 10 · círculo | selo · botão/campo · cartão · avatar |
| Sombra | `shadow-raised` | 2 camadas leves | cartão que se destaca (`.shadow-card` usa o mesmo valor) |
| | `shadow-stage` | 24/60 forte | peça de interface sobre o palco escuro (landing, login) |
| | `shadow-overlay` | 8/24 + 2/6 | menu, popover, diálogo, gaveta |
| Véu | `bg-scrim` | claro `hsl(222 47% 8% / .55)` · escuro `#000 / .7` | atrás de diálogo e gaveta (antes `bg-black/80`) |
| Movimento | `ease-out-soft` | `cubic-bezier(0.16, 1, 0.3, 1)` | toda transição de entrada |
| | `--duration-fast` / `-base` / `-panel` | 120 / 200 / 300 ms | `duration-(--duration-base)` |

## 11. Ícones

- Uma biblioteca: **lucide-react**. Nada de emoji como ícone de interface, nada de SVG copiado de
  outra marca (exceção: logos de canal em `campanhas/ChannelLogo.tsx`).
- Tamanhos: 16 px (`size-4`) dentro de botão, campo e lista; 20 px (`size-5`) em barra e cabeçalho;
  24 px só em estado vazio. Traço padrão do lucide (2).
- Cor: herda o texto (`currentColor`). Ícone decorativo em `text-muted-foreground` com
  `aria-hidden="true"`. Cor de estado só junto de texto ("Faltou", "Pago").
- Botão só com ícone: `aria-label` em pt-BR e `size="icon"`; em tela de toque o alvo cresce para 44 px.

## 12. Estados

| Estado | Regra | Onde está |
|---|---|---|
| Repouso | Sem sombra; borda `--input` (3:1) em campo e botão contornado | `button`, `input` |
| Hover (só mouse) | Um passo de tom: `bg-primary/90`, `bg-secondary/80`, `hover:bg-accent`. Nada de levantar, crescer ou brilhar | `button` |
| Pressionado | Desce 1 px (`active:translate-y-px`) | `button` |
| Foco (teclado) | Anel de 2 px `--ring` com folga de 2 px, sempre visível (`:focus-visible` global) | `styles.css`, `button`, `input` |
| Desativado | `opacity-50` + `pointer-events-none`. Diga o motivo perto do botão quando não for óbvio | `button`, `input` |
| Carregando | Botão: `disabled` + `aria-busy` + `Loader2` + rótulo no gerúndio ("Salvando…"). Lista e cartão: `Skeleton` com a forma do conteúdo, nunca "0" | `login`, `KpiCard` |
| Erro de campo | `aria-invalid` (borda `--destructive`) + texto abaixo ligado por `aria-describedby` | `input`, `signup` |
| Erro de tela | Mensagem em pt-BR + "Tentar de novo". `vpsApiFetch` não lança: confira `error` | dashboard |
| Vazio | Frase do que falta + uma ação ("Cadastrar primeiro paciente") | — |
| Sucesso | `toast` curto do `sonner` (sem emoji) ou o próprio item atualizado | — |

## 13. Componentes base (shadcn, `src/components/ui`)

Use os componentes, não refaça. Mude o visual pelo token, não tela a tela.

| Componente | Regra do sistema |
|---|---|
| `Button` | Variantes: `default` (uma por área), `secondary`, `outline`, `ghost`, `link`, `destructive` (só para excluir/perder). Tamanhos `sm` 32, `default` 36, `lg` 40, `icon` 36. Em tela de toque, um `::after` invisível leva o alvo a 44×44 sem mudar o desenho (`TOUCH_TARGET` em `button.tsx`). `buttonVariants` puro (dias do calendário) não ganha. |
| `Input`, `Textarea`, `Select` | 36 px no app e `h-11` nas telas de entrada. Texto 16 px no celular, para o iOS não dar zoom. `aria-invalid` pinta a borda. |
| `Dialog`, `AlertDialog`, `Sheet`, `Drawer` | Véu `bg-scrim`. Botão fechar com 36 px (44 no toque) e rótulo "Fechar". `AlertDialog` para toda ação que apaga ou envia ao paciente. |
| `Badge` | Selo de estado: texto + cor do estado, nunca só cor. |
| `Skeleton` | Primeira carga de lista, cartão e KPI. |
| `Tooltip` | Só complemento: nada essencial escondido atrás de hover (no celular não existe). |
| `Table` | Cabeçalho `text-footnote`, números com `tabular-nums` alinhados à direita. |
| `sonner` | Confirmação e erro curtos, em pt-BR. Erro que pede ação fica na tela, não em toast. |

Textos dos componentes base traduzidos: "Fechar" (diálogo e gaveta), "Mais" e "Caminho" (breadcrumb),
"Anterior" e "Próximo" (carrossel).

## 14. Proibido

- Cor fora dos tokens: hex, `rgb()`, `hsl(200 …)` ou paleta do Tailwind (`bg-blue-500`) em tela.
  Exceção: PDF e impressão (`src/lib/*PdfExport.ts`, `OrcamentoPrintPreview`), que não leem CSS.
- `hsl(var(--x) / a)`: é CSS inválido aqui e a cor some. Use `bg-primary/20` ou `color-mix()`.
- `bg-white`, `text-black`, `bg-black/…` em tela do app: não mudam no escuro. Use `bg-card`,
  `text-foreground` e `bg-scrim`.
- Texto abaixo de 12 px (`text-[10px]`, `text-[11px]`) e `text-[…px]` solto: use a escala da §10.
- Degradê, brilho, vidro em cartão, texto em degradê, rótulo em CAIXA ALTA espaçada, pílula acima
  do título, ícone em quadrado colorido.
- Animação em cascata em tela usada várias vezes por dia; quique; animar `width`/`height`/`top`.
- Alvo de toque abaixo de 44 px sem a área extra do `Button`; ação só no hover.
- Emoji em botão, menu, toast ou mensagem de erro.
- Cor de estado sem texto (bolinha vermelha sozinha); erro só em toast longe do campo.
- SF Pro, SF Symbols, Liquid Glass ou qualquer imagem da Apple (§8).

## 15. Auditoria de inconsistências (5 nov 2026)

Para refazer: `node scripts/design/auditar-design.mjs` (resumo), `--todos` (todos os arquivos) ou `--json`
(para comparar versões). O script ignora SVG embutido e comentários. Em `styles.css` só conta cor quebrada.

| Categoria | Ocorrências | Arquivos | Mais afetados |
|---|---|---|---|
| `hsl(var(--x) / a)`: cor quebrada, some | **118** | 22 | `disparos/DisparoStatsPanel` 23, `campanhas/CampanhaTimelineChart` 19, `AutomationReportPanel` 18, `painel-comercial` 10 |
| Paleta do Tailwind em vez de token | **252** | 18 | `pedido-exame` 75, `lib/examesApi.ts` 32, `OrcamentoPrintPreview` 29, `AttendanceMetricsPanel` 17, `agenda/AgendaGrid` 16, `pacientes` 16 |
| `bg-white`/`text-black` fixos | **123** (eram 127) | 37 | `chat/ConversationView` 26, `pedido-exame` 24, `OrcamentoPrintPreview` 6 |
| Cor literal (hex, `rgb()`, `hsl(n …)`) | **310** | 38 | PDFs: `relatoriosClinicosPdfExport` 36, `tratamentosPdfExport` 30, `prescricaoPdfExport` 26, `chatPdfExport` 12 (exceção aceita); `campanhas/ChannelLogo` 30 (logos); `charts/DespesasCategoriaChart` 14; `data/leadTags` 12; `chat/LeadListItem` 11 |
| Texto abaixo de 12 px | **647** | 92 | `text-[10px]` 357×, `text-[11px]` 250×, `text-[9px]` 30×, `text-[8px]` 6×. `financeiro` 65, `pacientes` 35, `ClinicorpPanel` 32, `automacoes` 29, `crm` 27, `atendimento` 25 |
| `text-[…px/rem]` fora da escala (inclui a linha acima) | **741** | 104 | Os mesmos; a landing tem 57, de propósito (escala própria, §4) |

**Corrigido aqui (global, baixo risco, só tokens e `src/components/ui`):**
- `--chart-4` no claro passou para 3,8:1.
- Tokens de tipografia, toque, sombra, véu e movimento (§10), com o `cn()` ensinado a reconhecê-los.
- Área de toque de 44 px no `Button` em tela de toque, sem mudar o desenho.
- Véu `bg-scrim` em `Dialog`, `AlertDialog`, `Sheet` e `Drawer`.
- Botão fechar de `Dialog` e `Sheet`: de 16 px de ícone e opacidade 70% para 36 px (44 no toque), com "Fechar".
- Rótulos em inglês dos componentes base traduzidos.
- `.shadow-card` passou a usar `--shadow-raised`.

**Não corrigido (precisa de cada tela; combinar com quem é dono da frente):**
1. As 118 cores quebradas: trocar por `bg-x/NN` ou `color-mix()`. São gráficos e painéis de disparo,
   campanha e automação.
2. Texto abaixo de 12 px: trocar `text-[10px]`/`text-[11px]` por `text-caption`. Mexe na densidade de
   financeiro, pacientes e CRM, então fazer tela a tela, com captura.
3. Paleta do Tailwind em `pedido-exame`, `examesApi` (cores de status) e agenda: mapear para
   `success`/`warning`/`destructive`/`info`.
4. `bg-white` no chat (`ConversationView`): balões e mídia no escuro. Fica para o #24 / frente do chat.
