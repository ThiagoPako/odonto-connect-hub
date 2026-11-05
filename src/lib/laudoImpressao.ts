import { urlArquivoExame, type Exame, type ExameArquivo } from "./examesApi";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const dataBR = (v?: string | null, comHora = false) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return comHora
    ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : d.toLocaleDateString("pt-BR", { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(v) ? "UTC" : undefined });
};

/**
 * Imprime o laudo (ou "Salvar como PDF" na janela de impressão do navegador) a partir de um
 * iframe invisível na própria página: não depende de pop-up e nada vai na URL.
 * Imagens entram pelos links assinados do exame.
 */
export function imprimirLaudo(exame: Exame, imagens: ExameArquivo[]): boolean {
  document.getElementById("laudo-impressao-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "laudo-impressao-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const janela = frame.contentWindow;
  if (!janela) { frame.remove(); return false; }
  const finalizado = !!exame.laudado_em;
  const absoluto = (u: string) => new URL(urlArquivoExame(u), window.location.origin).href;
  const figuras = imagens
    .slice(0, 6)
    .map((i) => `<figure><img src="${esc(absoluto(i.url))}" alt=""><figcaption>${esc(i.nome_original || "")}</figcaption></figure>`)
    .join("");
  const nasc = dataBR(exame.paciente_data_nascimento);

  janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Laudo ${esc(exame.codigo || "")}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; font-size: 12pt; line-height: 1.45; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; display: flex; justify-content: space-between; gap: 12px; }
  h1 { font-size: 16pt; margin: 0; }
  .clinica { font-size: 11pt; color: #444; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 14px; font-size: 11pt; }
  dt { color: #555; } dd { margin: 0; }
  .laudo { white-space: pre-wrap; border-top: 1px solid #ccc; padding-top: 12px; min-height: 40mm; }
  .rascunho { border: 2px dashed #b45309; color: #b45309; padding: 6px 10px; font-weight: 600; margin-bottom: 12px; }
  .imagens { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
  figure { margin: 0; break-inside: avoid; } figure img { width: 100%; height: 45mm; object-fit: contain; background: #000; }
  figcaption { font-size: 8pt; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .assinatura { margin-top: 28mm; text-align: center; break-inside: avoid; }
  .assinatura .linha { border-top: 1px solid #111; width: 70mm; margin: 0 auto 4px; }
</style></head><body>
<header>
  <div><h1>Laudo de exame</h1><div class="clinica">${esc(exame.clinica_nome || "")}</div></div>
  <div style="text-align:right;font-size:10pt;color:#444">${esc(exame.codigo || "")}</div>
</header>
${finalizado ? "" : '<div class="rascunho">RASCUNHO — este laudo ainda não foi finalizado.</div>'}
<dl>
  <dt>Paciente</dt><dd>${esc(exame.paciente_nome || "—")}</dd>
  ${nasc ? `<dt>Nascimento</dt><dd>${esc(nasc)}</dd>` : ""}
  <dt>Exame</dt><dd>${esc(exame.tipo_nome)}</dd>
  ${exame.dentista_nome ? `<dt>Solicitante</dt><dd>${esc(exame.dentista_nome)}</dd>` : ""}
  <dt>Pedido em</dt><dd>${esc(dataBR(exame.data_solicitacao))}</dd>
  ${exame.data_realizacao ? `<dt>Realizado em</dt><dd>${esc(dataBR(exame.data_realizacao))}</dd>` : ""}
</dl>
<div class="laudo">${esc(exame.laudo_texto || "")}</div>
${figuras ? `<div class="imagens">${figuras}</div>` : ""}
${finalizado ? `<div class="assinatura"><div class="linha"></div>${esc(exame.laudado_por_nome || "")}<br><small>Laudo finalizado em ${esc(dataBR(exame.laudado_em, true))}</small></div>` : ""}
</body></html>`);
  janela.document.close();
  // Espera as imagens (com limite) para não imprimir com quadros vazios
  const imgs = Array.from(janela.document.images);
  const prontas = Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  const limite = new Promise((r) => setTimeout(r, 4000));
  Promise.race([prontas, limite]).then(() => {
    janela.focus();
    janela.print();
  });
  return true;
}
