#!/usr/bin/env node
/**
 * Contraste WCAG 2.x dos pares de tokens de src/styles.css, no claro e no escuro.
 * Lê os valores `hsl(h, s%, l%)` de `:root` e `.dark`. Sai com código 1 se algum par reprovar.
 *
 *   node scripts/design/contraste.mjs
 *
 * Mínimos: texto 4,5:1 (AA 1.4.3); borda de campo, ícone informativo e gráfico 3:1 (AA 1.4.11).
 */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");

function bloco(seletor) {
  // primeiro bloco de nível superior com este seletor (fora de @media)
  const semMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const m = semMedia.match(new RegExp(`(^|\\n)${seletor.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`bloco ${seletor} não encontrado`);
  const vars = {};
  for (const [, nome, valor] of m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[nome] = valor.trim();
  return vars;
}

function hslParaRgb(v) {
  const m = v.match(/hsl\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/);
  if (!m) return null;
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

const lum = ([r, g, b]) => {
  const c = (x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const razao = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// [texto/primeiro plano, fundo, mínimo, descrição]
const PARES = [
  ["foreground", "background", 4.5, "texto principal / página"],
  ["foreground", "card", 4.5, "texto principal / cartão"],
  ["muted-foreground", "background", 4.5, "texto secundário / página"],
  ["muted-foreground", "card", 4.5, "texto secundário / cartão"],
  ["muted-foreground", "muted", 4.5, "texto secundário / fundo neutro"],
  ["popover-foreground", "popover", 4.5, "menu / popover"],
  ["primary-foreground", "primary", 4.5, "botão primário"],
  ["primary", "card", 4.5, "link / texto de ação no cartão"],
  ["primary", "background", 4.5, "link / texto de ação na página"],
  ["secondary-foreground", "secondary", 4.5, "botão secundário"],
  ["accent-foreground", "accent", 4.5, "item ativo / selo de destaque"],
  ["destructive-foreground", "destructive", 4.5, "botão de erro/excluir"],
  ["destructive", "card", 4.5, "texto de erro no cartão"],
  ["success-foreground", "success", 4.5, "selo de sucesso cheio"],
  ["success", "card", 4.5, "texto de sucesso no cartão"],
  ["warning-foreground", "warning", 4.5, "selo de aviso cheio"],
  ["warning-text", "card", 4.5, "texto de aviso no cartão"],
  ["info-foreground", "info", 4.5, "selo de informação cheio"],
  ["info", "card", 4.5, "texto de informação no cartão"],
  ["sidebar-foreground", "sidebar", 4.5, "texto da sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent", 4.5, "item ativo da sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary", 4.5, "botão primário da sidebar"],
  ["stage-foreground", "stage", 4.5, "texto no palco escuro"],
  ["stage-muted", "stage", 4.5, "texto secundário no palco"],
  ["input", "card", 3, "borda de campo / cartão"],
  ["input", "background", 3, "borda de campo / página"],
  ["ring", "background", 3, "anel de foco / página"],
  ["ring", "card", 3, "anel de foco / cartão"],
  ["chart-1", "card", 3, "gráfico série 1"],
  ["chart-2", "card", 3, "gráfico série 2"],
  ["chart-3", "card", 3, "gráfico série 3"],
  ["chart-4", "card", 3, "gráfico série 4"],
  ["chart-5", "card", 3, "gráfico série 5"],
];

let falhas = 0;
const raiz = bloco(":root");
for (const [tema, vars] of [["claro", raiz], ["escuro", { ...raiz, ...bloco(".dark") }]]) {
  console.log(`\n### ${tema}`);
  for (const [fg, bg, min, desc] of PARES) {
    const a = vars[fg] && hslParaRgb(vars[fg]);
    const b = vars[bg] && hslParaRgb(vars[bg]);
    if (!a || !b) { console.log(`  ?  ${desc}: --${fg} ou --${bg} não é hsl()`); continue; }
    const r = razao(a, b);
    const ok = r >= min;
    if (!ok) falhas++;
    console.log(`  ${ok ? "✅" : "❌"} ${r.toFixed(2).padStart(5)}:1 (mín. ${min})  ${desc}  [--${fg} / --${bg}]`);
  }
}
console.log(falhas ? `\n❌ ${falhas} par(es) abaixo do mínimo` : "\n✅ todos os pares passam AA");
process.exit(falhas ? 1 : 0);
