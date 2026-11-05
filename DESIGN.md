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
| A4 | O mesmo padrão `hsl(var(--x) / a)` aparece em **115 lugares** em `.tsx` (chat, agenda, disparos, campanhas, gravador de áudio…). Cada um é uma cor que some sem aviso. | Média | **Não corrigido** (arquivos de outras frentes). Ver "Pendências". |
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
| Estados | `--success`, `--warning`, `--destructive`, `--info` | inalterados | | só para estado, nunca decoração |

Regras:
- Sem degradê, sem brilho, sem vidro. Superfícies separadas por um passo de tom ou uma borda de 1 px
  dentro do app; na landing, por troca do fundo da seção.
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
- Alvos de toque ≥ 40 px (botões do cabeçalho e da sidebar: 36–40 px; campos de formulário 44 px).
- Movimento: só `transform` e `opacity`, saída rápida (`cubic-bezier(0.16, 1, 0.3, 1)`), nada de
  "quique". `prefers-reduced-motion` zera animações (regra global em `styles.css`).
- Foco visível global: contorno de 2 px na cor `--ring` com folga de 2 px.

---

## 6. Componentes compartilhados

| Componente | Arquivo | Regras |
|---|---|---|
| Botões, campos, diálogos | `src/components/ui/*` (shadcn) | Não editar o visual tela a tela; mudar por token. Campos de formulário em telas de entrada: `h-11`. |
| `KpiCard` | `src/components/KpiCard.tsx` | Superfície chapada com borda; rótulo em caixa normal 13 px que quebra linha; ícone 16 px sem fundo; valor 24 px tabular. |
| Sidebar | `src/components/AppSidebar.tsx` | Computador: trilho de 64 px; ao passar o mouse abre 248 px **por cima** do conteúdo; botão de fixar. Celular (< 768 px): barra de 56 px com botão "Abrir menu" e gaveta (Sheet) de 288 px que fecha ao trocar de página. Item ativo: fundo `--sidebar-accent`, `aria-current="page"`. Seções: rótulo 12 px em caixa normal. |
| Cabeçalho | `src/components/DashboardHeader.tsx` | 64 px (56 no celular). Título 18 px + data no computador. Busca larga só a partir de 1024 px; abaixo disso, ícone. Avatar leva a `/perfil`. |
| Moldura de entrada | `src/components/auth/AuthShell.tsx` | Login, cadastro, recuperar senha. Formulário à esquerda (máx. 400 px); palco azul-marinho com a agenda à direita a partir de 1024 px. |
| Agenda de exemplo | `src/components/marketing/AgendaFragment.tsx` | Fragmento de interface (`data-ui`), pacientes de exemplo, linha "agora" em America/Sao_Paulo, status avança ao clique. |
| Tema claro forçado | `src/hooks/useForceLightTheme.ts` | Landing e telas de entrada ficam sempre claras (o logotipo tem texto azul-marinho). O tema do usuário volta ao entrar no app. |

Utilitários antigos mantidos por compatibilidade (agora chapados): `.gradient-primary` = fundo
`--primary`; `.gradient-text` = cor `--primary`; `.shadow-glow(-primary)` = sombra neutra leve;
`.glass-card` = cartão com borda. **Não usar em telas novas.**

---

## 7. Landing (`src/routes/index.tsx`)

Ordem: navegação simples → primeira tela (título "Gestão odontológica de A a Z", texto original, dois
botões, agenda funcionando no palco azul-marinho) → funcionalidades (cinco em destaque, cada uma com
um pedaço de interface que responde: reativação "Convidar", semana da agenda, conversa da IA,
canais Fênix com "Simular queda", caixa do dia; mais sete em lista) → quem criou (foto do Dr. Luis
Gustavo, texto original) → planos (nomes à esquerda, um palco de preço; no celular os três completos)
→ dúvidas (8 perguntas originais, uma aberta por vez) → chamada final → rodapé.

**Prova social em espera:** depoimentos, faixa "Quem confia", "500+ clínicas", "98% satisfação" e
"centenas de clínicas" não têm fonte no repositório. Ficam no código atrás de
`PROVA_SOCIAL_CONFIRMADA = false` até a Helena e o dono confirmarem (CDC art. 37; Código de Ética
Odontológica sobre publicidade). Para religar: mudar para `true`.

---

## 8. Pendências (para depois)

1. **115 cores quebradas** `hsl(var(--x) / a)` em `.tsx` (A4). Trocar por `color-mix(in srgb, var(--color-x) N%, transparent)`
   ou pela classe Tailwind `bg-primary/20`. Arquivos de chat, agenda, disparos, campanhas — combinar com as frentes donas.
2. **Teste grátis de 7 × 14 dias** (landing × cadastro) — decisão da Helena/dono; marcado no código com ⚠️.
3. Número do WhatsApp do consultor `5511999990001` parece provisório (`WHATSAPP_CONSULTOR` em `index.tsx`).
4. Botão de notificações no cabeçalho não faz nada.
5. Gráficos do dashboard (`src/components/charts/*`) ainda com o visual antigo; "Faturamento mensal" mostra R$ 0 com a API de teste.
6. Telas mais usadas (agenda, chat, pacientes, atendimento) — próxima rodada, com as frentes donas.
7. Imagens reais do mundo da clínica (além da foto do fundador) na landing — hoje só fragmentos de interface.
