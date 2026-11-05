/**
 * Montagem de HTML a partir de texto que vem de fora (mensagem de WhatsApp,
 * nome de arquivo, relatório de IA, cadastro do paciente).
 *
 * Regra: o texto é SEMPRE escapado antes; só depois entram as tags fixas da
 * formatação. Assim nenhum conteúdo recebido vira HTML ou script.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, ```código```) sobre texto escapado. */
export function whatsappTextToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*([^*]+)\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~([^~]+)~/g, "<del>$1</del>")
    .replace(/```([^`]+)```/g, '<code class="bg-background/20 px-1.5 py-0.5 rounded text-[13px] font-mono">$1</code>');
}

/** Markdown simples dos relatórios de IA (**negrito**, #, ##, ###, listas com "- ") sobre texto escapado. */
export function simpleMarkdownToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/^### (.*$)/gm, '<h4 class="text-sm font-semibold text-foreground mt-3 mb-1">$1</h4>')
    .replace(/^## (.*$)/gm, '<h3 class="text-sm font-bold text-foreground mt-4 mb-2">$1</h3>')
    .replace(/^# (.*$)/gm, '<h2 class="text-base font-bold text-foreground mt-4 mb-2">$1</h2>')
    .replace(/^- (.*$)/gm, '<li class="ml-4 list-disc text-muted-foreground">$1</li>')
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

/** Só aceita URL http(s), blob, data de mídia ou caminho relativo; o resto vira null. */
export function safeMediaUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (!u) return null;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  if (/^(https?:|blob:)/i.test(u)) return u;
  if (/^data:(image|video|audio)\//i.test(u)) return u;
  return null;
}

const DOWNLOAD_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

/** Link "Baixar …" montado pelo DOM (sem innerHTML com dado recebido). */
export function createDownloadLink(url: unknown, fileName: unknown, label: string): HTMLElement {
  const href = safeMediaUrl(url);
  const el = document.createElement(href ? "a" : "span");
  el.className = "flex items-center gap-2 text-primary hover:underline";
  if (href && el instanceof HTMLAnchorElement) {
    el.href = href;
    el.download = typeof fileName === "string" && fileName.trim() ? fileName : "arquivo";
    el.rel = "noopener noreferrer";
  }
  el.innerHTML = DOWNLOAD_ICON; // ícone fixo, sem dado externo
  el.appendChild(document.createTextNode(href ? label : "Mídia não disponível"));
  return el;
}
