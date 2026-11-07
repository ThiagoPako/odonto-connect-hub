# Odonto Connect — sistema de design

Referência curta para quem mexe na interface. Tokens em `src/styles.css` (Tailwind v4, `@theme inline`);
componentes base em `src/components/ui/*` (shadcn/Radix). Fontes: **Inter** (texto) e **Space Grotesk**
(`font-heading`, títulos e números de destaque).

## Tokens
- Cor primária: ciano clínico (`--primary`, `--sidebar-primary` ≈ hsl(187 85% 43%)); fundo neutro frio.
- Menu lateral tem tokens próprios: `--sidebar`, `--sidebar-foreground`, `--sidebar-accent` (fundo do item
  ativo), `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring`. Modo escuro em `.dark`.
- Raio base `--radius: 0.75rem`; cards de painel usam `rounded-2xl`.
- `scrollbar-thin` (utilitário em `styles.css`) para listas e menu.

## Shell (`src/routes/__root.tsx`, `src/components/AppSidebar.tsx`)
- Celular (< 768 px): barra superior `MobileTopBar` (menu ☰ + marca) e o menu abre num `Sheet` à esquerda;
  fecha ao trocar de tela.
- Tablet/desktop: `AppSidebar` expandido (256 px) ou recolhido em trilho (68 px) com tooltip à direita em
  cada ícone. Padrão: expandido a partir de 1280 px; a escolha do usuário fica salva
  (`localStorage oc.sidebar.expanded`). Sem expandir por hover (causava pulo de layout).
- Grupos: Principal · Clínico · Comercial · Gestão · Configuração (+ Plataforma para super admin). Abertos por
  padrão; o usuário pode recolher (salvo em `oc.sidebar.closedSections`); o grupo da tela atual sempre aparece.
- Item ativo: fundo `sidebar-accent`, barra de 3 px à esquerda, `aria-current="page"`; vale para sub-rotas.
- Cada item tem ícone próprio (sem repetir), para ser reconhecível com o menu recolhido.
- Menu da conta (avatar no rodapé): Meu perfil, Modo claro/escuro, Sair.
- Coluna de conteúdo com `min-w-0`; `<main id="conteudo">` é o único elemento que rola; `h-dvh` no shell.

## Cabeçalho de página (`DashboardHeader`)
- Altura mínima, não fixa (`min-h-16 md:min-h-[72px]`); título quebra linha.
- Busca: só ícone no celular, "Buscar" no tablet, texto completo + ⌘K a partir de 1024 px.

## Regra de texto cortado (pedido do dono)
Palavra nunca é cortada pelo container.
- Prefira quebrar linha: `min-w-0` no item flex + `break-words`/`text-pretty`, `flex-wrap` em barras,
  altura mínima (`min-h-*`) em vez de `h-*` fixa quando há texto.
- Reticências (`truncate`, `line-clamp`) só quando o texto completo continua acessível (tooltip/`title`
  ou tela de detalhe) — **nunca** em rótulo de botão, item de menu, aba, cabeçalho de coluna ou badge.
- Base já ajustada: `TabsList` quebra em linhas, `TabsTrigger`/`SelectTrigger`/`SelectItem`/
  `DropdownMenuItem`/`Badge`/`CardTitle`/`DialogTitle`/`TooltipContent` quebram texto.
- Popovers, dropdowns e tooltips usam `collisionPadding=8` e `max-w-[calc(100vw-1rem)]`.
- Dialogs: `w-[calc(100%-2rem)]`, `max-h-[calc(100dvh-2rem)]` com rolagem própria.

## Acessibilidade
- Foco visível em todo controle interativo (`focus-visible:ring-2`), contraste AA, alvo de toque ≥ 40 px no
  celular, textos em português do Brasil ("Fechar", não "Close").
