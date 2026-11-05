#!/usr/bin/env node
/**
 * Auditoria do sistema de design — conta o que foge dos tokens de DESIGN.md.
 * Só lê arquivos; não altera nada.
 *
 *   node scripts/design/auditar-design.mjs            # resumo + 8 arquivos por categoria
 *   node scripts/design/auditar-design.mjs --todos    # todos os arquivos
 *   node scripts/design/auditar-design.mjs --json     # saída para comparar entre versões
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = new URL("../../", import.meta.url).pathname;
const SRC = join(RAIZ, "src");
const args = new Set(process.argv.slice(2));

const PALETA = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PROPS = "bg|text|border|border-[trblxy]|ring|ring-offset|from|via|to|fill|stroke|outline|divide|shadow|decoration|accent|caret|placeholder";

/** Cada categoria: regex global aplicado a cada linha. */
const CATEGORIAS = [
  {
    id: "cor-quebrada",
    titulo: "`hsl(var(--x) / a)` — CSS inválido (a variável já guarda a cor inteira; o navegador ignora)",
    re: /hsla?\(\s*var\(--[\w-]+\)/g,
  },
  {
    id: "paleta-tailwind",
    titulo: "Cor da paleta do Tailwind (`bg-blue-500`, `text-red-600`…) em vez de token semântico",
    re: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${PROPS})-(?:${PALETA})-\\d{2,3}(?:\\/\\d+)?\\b`, "g"),
  },
  {
    id: "branco-preto",
    titulo: "`bg-white`/`text-black`… fixos (não mudam no modo escuro)",
    re: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${PROPS})-(?:white|black)(?:\\/\\d+)?\\b`, "g"),
  },
  {
    id: "cor-literal",
    titulo: "Cor literal no código (`#0ea5e9`, `rgb(…)`, `hsl(200 …)`, `-[#…]`)",
    re: /(?<![&\w])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b(?![-\w])|rgba?\(\s*\d|hsla?\(\s*\d/g,
  },
  {
    id: "texto-pequeno",
    titulo: "Texto abaixo de 12 px (`text-[10px]`, `text-[11px]`, `text-[0.65rem]`…)",
    re: /text-\[(?:(?:[0-9]|1[01])(?:\.\d+)?px|0?\.(?:[0-6]\d*|7[0-4]\d*)rem)\]/g,
  },
  {
    id: "texto-arbitrario",
    titulo: "Tamanho de texto arbitrário `text-[…px|rem]` (fora da escala de tokens)",
    re: /text-\[[\d.]+(?:px|rem)\]/g,
  },
];

function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) yield* arquivos(p);
    else if (/\.(tsx?|css)$/.test(nome) && !/\.test\./.test(nome)) yield p;
  }
}

const resultado = Object.fromEntries(CATEGORIAS.map((c) => [c.id, { total: 0, arquivos: {} }]));

for (const arq of arquivos(SRC)) {
  const rel = relative(RAIZ, arq);
  const ehCss = arq.endsWith(".css");
  const linhas = readFileSync(arq, "utf8").split("\n");
  for (const linha of linhas) {
    // Ignora data-URIs (SVG embutido) e comentários de linha
    const l = linha.replace(/url\("data:[^"]*"\)/g, "").replace(/^\s*(\/\/|\*|\/\*).*$/, "");
    for (const c of CATEGORIAS) {
      // styles.css é a fonte dos tokens: cor literal ali é esperada
      if (ehCss && c.id !== "cor-quebrada") continue;
      const n = (l.match(c.re) || []).length;
      if (!n) continue;
      resultado[c.id].total += n;
      resultado[c.id].arquivos[rel] = (resultado[c.id].arquivos[rel] || 0) + n;
    }
  }
}

if (args.has("--json")) {
  console.log(JSON.stringify(resultado, null, 2));
  process.exit(0);
}

const limite = args.has("--todos") ? Infinity : 8;
for (const c of CATEGORIAS) {
  const r = resultado[c.id];
  const lista = Object.entries(r.arquivos).sort((a, b) => b[1] - a[1]);
  console.log(`\n## ${c.titulo}\n**${r.total}** ocorrências em **${lista.length}** arquivos`);
  for (const [f, n] of lista.slice(0, limite)) console.log(`  ${String(n).padStart(4)}  ${f}`);
  if (lista.length > limite) console.log(`  … mais ${lista.length - limite} arquivos (use --todos)`);
}
