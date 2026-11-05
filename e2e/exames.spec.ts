// Exames / radiologia (pilha #33 → #37 → #43 → #48 → #51): tipos, pedido com anexo, imagens, visualizador,
// laudo (rascunho/finalizar/409/reabrir), impressão, exclusão protegida, links assinados, erro/vazio e 375 px.
// Ambiente local semeado (docs/operacao/ambiente-local.md). Dados novos a cada teste (código EX- sequencial).
import { test, expect, type Page } from "@playwright/test";
import { login, USUARIOS, SENHA_TESTE } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
const HTML = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");

const token = (page: Page) => page.evaluate(() => localStorage.getItem("odonto_jwt") as string);
const auth = async (page: Page) => ({ Authorization: `Bearer ${await token(page)}` });

/** Imagem real (renderiza no navegador) gerada num canvas. */
async function imagem(page: Page, tipo: "image/jpeg" | "image/png", cor: string): Promise<Buffer> {
  const b64 = await page.evaluate(async ([t, c]) => {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 64;
    const g = cv.getContext("2d")!; g.fillStyle = c; g.fillRect(0, 0, 64, 64); g.fillStyle = "#fff"; g.fillRect(16, 16, 32, 32);
    const blob: Blob = await new Promise((r) => cv.toBlob((b) => r(b!), t));
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; buf.forEach((x) => (s += String.fromCharCode(x)));
    return btoa(s);
  }, [tipo, cor]);
  return Buffer.from(b64, "base64");
}

async function criarExame(page: Page, tipo_nome = "Panorâmica") {
  const r = await page.request.post("/api/exames", { headers: await auth(page), data: { tipo_nome } });
  expect(r.status()).toBe(200);
  return (await r.json()) as { id: string; codigo: string };
}
async function enviar(page: Page, exameId: string, corpo: Buffer, nome: string) {
  return page.request.post(`/api/exames/${exameId}/arquivos`, {
    headers: { ...(await auth(page)), "Content-Type": "application/octet-stream", "X-Nome-Arquivo": encodeURIComponent(nome) },
    data: corpo,
  });
}
async function abrirLaudo(page: Page, codigo: string) {
  await page.goto("/exames");
  await page.getByPlaceholder("Buscar por código, tipo, paciente...").fill(codigo);
  await page.getByRole("button", { name: new RegExp(`Laudo e imagens do exame ${codigo}`) }).click();
  await expect(page.getByRole("dialog")).toContainText(codigo);
}
function vigiar(page: Page) {
  const falhas: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && !r.url().includes("/api/sessions/active") && r.status() >= 500) falhas.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  return falhas;
}

test.describe("Exames e radiologia", () => {
  test("E1. tipos básicos: clínica sem tipos cria a lista básica e escolhe um tipo", async ({ page }) => {
    const falhas = vigiar(page);
    await login(page);
    const h = await auth(page);
    const tipos = (await (await page.request.get("/api/exame-tipos", { headers: h })).json()) as Array<{ id: string }>;
    for (const t of tipos) await page.request.delete(`/api/exame-tipos/${t.id}`, { headers: h });
    await page.goto("/exames");
    await page.getByRole("button", { name: /Novo exame/ }).first().click();
    await expect(page.getByRole("dialog")).toContainText("ainda não tem tipos de exame");
    await page.getByRole("button", { name: "Criar tipos básicos" }).click();
    await expect(page.locator("#novo-exame-tipo")).toBeVisible();
    await page.locator("#novo-exame-tipo").click();
    await expect(page.getByRole("option").first()).toBeVisible();
    expect(await page.getByRole("option").count()).toBeGreaterThanOrEqual(5);
    await page.getByRole("option").first().click();
    await page.locator("#novo-exame-paciente").click();
    await page.getByRole("option", { name: /Lúcia/ }).first().click();
    const resp = page.waitForResponse((r) => r.url().endsWith("/api/exames") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Criar exame" }).click();
    expect((await resp).status()).toBe(200);
    await expect(page.getByText("Exame criado").first()).toBeVisible();
    expect(falhas).toEqual([]);
  });

  test("E2. pedido de exame com anexo grava no exame; segundo clique em Cadastrar é recusado", async ({ page }) => {
    const falhas = vigiar(page);
    await login(page);
    await page.goto("/pedido-exame");
    await page.getByRole("button", { name: "Cadastrar" }).click();
    await expect(page.getByText("Informe o nome do paciente")).toBeVisible();
    await page.getByText("Paciente:").locator("xpath=following::input[1]").fill("Lúcia Gomes (Alfa)");
    await page.getByRole("button", { name: "Cadastrar" }).click();
    await expect(page.getByText("Selecione ao menos um exame")).toBeVisible();
    await page.getByText("Panorâmica Convencional").click();
    await page.locator("input[type=file]").setInputFiles({ name: "requisicao.jpg", mimeType: "image/jpeg", buffer: await imagem(page, "image/jpeg", "#2a6") });
    await expect(page.getByText("requisicao.jpg").first()).toBeVisible();
    const resp = page.waitForResponse((r) => r.url().endsWith("/api/exames") && r.request().method() === "POST");
    page.once("dialog", (d) => d.accept()); // "Já existe um paciente com esse nome": OK vincula ao cadastro existente
    await page.getByRole("button", { name: "Cadastrar" }).click();
    expect((await resp).status()).toBe(200);
    await expect(page.getByText(/Pedido cadastrado/)).toBeVisible();
    const codigo = ((await page.getByText(/Pedido cadastrado/).innerText()).match(/EX-\d+/) || [])[0];
    expect(codigo).toBeTruthy();
    await expect(page.getByText("Anexos gravados no exame")).toBeVisible();
    // Duplicidade: o botão vira "Cadastrado" e fica desabilitado (nenhum segundo POST /api/exames)
    const botao = page.getByRole("button", { name: "Cadastrado" });
    await expect(botao).toBeDisabled();
    let posts = 0;
    page.on("request", (r) => { if (r.url().endsWith("/api/exames") && r.method() === "POST") posts++; });
    await botao.click({ force: true }).catch(() => {});
    expect(posts).toBe(0);
    // O anexo ficou ligado ao exame, marcado como anexo do pedido
    const lista = (await (await page.request.get(`/api/exames?q=${encodeURIComponent("Lúcia")}`, { headers: await auth(page) })).json()) as Array<{ id: string; tipo_nome: string; codigo?: string }>;
    const ex = lista.find((e) => (e as { codigo?: string }).codigo === codigo)!;
    const arqs = (await (await page.request.get(`/api/exames/${ex.id}/arquivos`, { headers: await auth(page) })).json()) as Array<{ descricao: string; nome_original: string }>;
    expect(arqs.some((a) => a.nome_original === "requisicao.jpg" && a.descricao === "Anexo do pedido")).toBe(true);
    expect(falhas).toEqual([]);
  });

  test("E3. envio: JPEG e PDF entram; SVG e HTML são recusados (415) e nada fica gravado", async ({ page }) => {
    await login(page);
    const ex = await criarExame(page);
    expect((await enviar(page, ex.id, await imagem(page, "image/jpeg", "#06c"), "rx.jpg")).status()).toBe(200);
    expect((await enviar(page, ex.id, PDF, "guia.pdf")).status()).toBe(200);
    // Disfarçados com extensão/tipo de imagem: o servidor olha o conteúdo
    expect((await enviar(page, ex.id, SVG, "rx.png")).status()).toBe(415);
    expect((await enviar(page, ex.id, HTML, "rx.jpg")).status()).toBe(415);
    expect((await enviar(page, ex.id, Buffer.alloc(0), "vazio.jpg")).status()).toBe(400);
    const arqs = (await (await page.request.get(`/api/exames/${ex.id}/arquivos`, { headers: await auth(page) })).json()) as Array<{ mime_type: string }>;
    expect(arqs.map((a) => a.mime_type).sort()).toEqual(["application/pdf", "image/jpeg"]);
    // Pela tela: SVG no botão Anexar mostra o erro e não entra na lista
    await abrirLaudo(page, ex.codigo);
    await page.getByRole("dialog").locator("input[type=file]").setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: SVG });
    await expect(page.getByText(/Não foi possível enviar x\.svg/)).toBeVisible();
    await expect(page.getByRole("dialog").getByText("x.svg")).toHaveCount(0);
  });

  test("E4. visualizador: zoom, contraste e comparação entre duas imagens", async ({ page }) => {
    const falhas = vigiar(page);
    await login(page);
    const ex = await criarExame(page, "Tomografia");
    await enviar(page, ex.id, await imagem(page, "image/jpeg", "#c33"), "antes.jpg");
    await enviar(page, ex.id, await imagem(page, "image/png", "#33c"), "depois.png");
    await abrirLaudo(page, ex.codigo);
    await page.getByRole("button", { name: "Abrir antes.jpg no visualizador" }).click();
    const viewer = page.getByRole("dialog").filter({ hasText: "Imagem do exame" });
    await expect(viewer).toBeVisible();
    const img = viewer.locator("img").first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const mais = viewer.getByRole("button", { name: "Aumentar zoom" });
    const antes = await img.evaluate((i) => getComputedStyle(i.parentElement!).transform + "|" + getComputedStyle(i).transform);
    await mais.click(); await mais.click();
    const depois = await img.evaluate((i) => getComputedStyle(i.parentElement!).transform + "|" + getComputedStyle(i).transform);
    expect(depois).not.toBe(antes);
    await viewer.getByRole("button", { name: "Ajustar à tela" }).click();
    const contraste = viewer.getByRole("slider", { name: "Contraste" });
    await contraste.focus();
    for (let i = 0; i < 5; i++) await contraste.press("ArrowRight");
    await expect.poll(() => img.evaluate((i) => getComputedStyle(i).filter + getComputedStyle(i.parentElement!).filter)).toMatch(/contrast\((?!1\)|100%)/);
    const antesComparar = await viewer.locator("img").count();
    await viewer.getByRole("combobox", { name: "Comparar com outra imagem" }).click();
    await page.getByRole("option", { name: /depois\.png/ }).click();
    await expect.poll(() => viewer.locator("img").count()).toBeGreaterThan(antesComparar); // entra a segunda imagem lado a lado
    expect(falhas).toEqual([]);
  });

  test("E5. laudo: rascunho persiste, finalizar trava a edição (409), reabrir libera", async ({ page }) => {
    const falhas = vigiar(page);
    await login(page);
    const ex = await criarExame(page);
    const h = await auth(page);
    await enviar(page, ex.id, await imagem(page, "image/jpeg", "#393"), "rx.jpg");
    await abrirLaudo(page, ex.codigo);
    const dialog = page.getByRole("dialog");
    // Sem texto não dá para finalizar: o botão fica desabilitado
    await expect(page.getByRole("button", { name: "Finalizar laudo" })).toBeDisabled();
    await dialog.locator("textarea").fill("Rascunho: sem lesões periapicais (e2e).");
    await page.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(page.getByText("Rascunho do laudo salvo")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Laudo em rascunho").first()).toBeVisible();
    await abrirLaudo(page, ex.codigo);
    await expect(dialog.locator("textarea")).toHaveValue("Rascunho: sem lesões periapicais (e2e).");
    page.once("dialog", (d) => d.accept()); // confirm("Finalizar o laudo?")
    const fin = page.waitForResponse((r) => r.url().includes(`/api/exames/${ex.id}/laudo/finalizar`));
    await page.getByRole("button", { name: "Finalizar laudo" }).click();
    expect((await fin).status()).toBe(200);
    await expect(page.getByText("Laudo finalizado").first()).toBeVisible();
    await expect(dialog.locator("textarea")).toHaveAttribute("readonly", "");
    // Editar finalizado direto na API: 409; finalizar de novo: 409
    const edit = await page.request.patch(`/api/exames/${ex.id}`, { headers: h, data: { laudo_texto: "Alterado em silêncio" } });
    expect(edit.status()).toBe(409);
    expect((await page.request.post(`/api/exames/${ex.id}/laudo/finalizar`, { headers: h, data: { laudo_texto: "x" } })).status()).toBe(409);
    // Reabrir pela tela (confirm nativo)
    page.once("dialog", (d) => d.accept());
    const reab = page.waitForResponse((r) => r.url().includes(`/api/exames/${ex.id}/laudo/reabrir`));
    await page.getByRole("button", { name: "Reabrir laudo" }).click();
    expect((await reab).status()).toBe(200);
    await expect(page.getByText("Laudo reaberto para correção")).toBeVisible();
    await expect(dialog.locator("textarea")).not.toHaveAttribute("readonly", "");
    const apos = await (await page.request.get(`/api/exames/${ex.id}`, { headers: h })).json();
    expect(apos.status).toBe("aguardando_laudo");
    expect(apos.laudado_em).toBeNull();
    // Reabrir de novo (já aberto): 409
    expect((await page.request.post(`/api/exames/${ex.id}/laudo/reabrir`, { headers: h })).status()).toBe(409);
    expect(falhas).toEqual([]);
  });

  test("E6. impressão: monta o laudo com paciente, texto, imagens e marca de rascunho", async ({ page }) => {
    await login(page);
    const h = await auth(page);
    const pac = ((await (await page.request.get("/api/pacientes", { headers: h })).json()) as Array<{ id: string; nome: string }>).find((p) => p.nome.startsWith("Lúcia"))!;
    const r = await page.request.post("/api/exames", { headers: h, data: { tipo_nome: "Panorâmica", paciente_id: pac.id } });
    const ex = (await r.json()) as { id: string; codigo: string };
    await enviar(page, ex.id, await imagem(page, "image/jpeg", "#939"), "rx.jpg");
    await abrirLaudo(page, ex.codigo);
    await page.getByRole("dialog").locator("textarea").fill("Achados de impressão (e2e).");
    await page.getByRole("button", { name: /Imprimir/ }).click();
    const frame = page.frameLocator("#laudo-impressao-frame");
    await expect(frame.locator("body")).toContainText("Laudo de exame");
    await expect(frame.locator("body")).toContainText("Lúcia Gomes (Alfa)");
    await expect(frame.locator("body")).toContainText("Achados de impressão (e2e).");
    await expect(frame.locator("body")).toContainText("RASCUNHO");
    await expect(frame.locator("img")).toHaveCount(1);
  });

  test("E7. exame com laudo ou imagem não é excluído (409); sem resultado pode ser excluído", async ({ page }) => {
    await login(page);
    const h = await auth(page);
    const comImagem = await criarExame(page);
    await enviar(page, comImagem.id, await imagem(page, "image/jpeg", "#555"), "rx.jpg");
    const r1 = await page.request.delete(`/api/exames/${comImagem.id}`, { headers: h });
    expect(r1.status()).toBe(409);
    expect((await r1.json()).error).toContain("Cancelado");
    // Pela tela
    await page.goto("/exames");
    await page.getByPlaceholder("Buscar por código, tipo, paciente...").fill(comImagem.codigo);
    await page.getByRole("button", { name: `Excluir exame ${comImagem.codigo}` }).click();
    await page.getByRole("button", { name: "Excluir pedido" }).click();
    await expect(page.getByText(comImagem.codigo).first()).toBeVisible(); // continua na lista
    expect((await page.request.get(`/api/exames/${comImagem.id}`, { headers: h })).status()).toBe(200);
    const vazio = await criarExame(page);
    expect((await page.request.delete(`/api/exames/${vazio.id}`, { headers: h })).status()).toBe(200);
    expect((await page.request.get(`/api/exames/${vazio.id}`, { headers: h })).status()).toBe(404);
  });

  test("E8. links assinados: vencido ou adulterado 403; outra clínica 404/403; sem credencial 401", async ({ page, browser, baseURL }) => {
    await login(page);
    const h = await auth(page);
    const ex = await criarExame(page);
    const up = await (await enviar(page, ex.id, await imagem(page, "image/jpeg", "#a50"), "rx.jpg")).json();
    const url = new URL(up.url, baseURL);
    expect((await page.request.get(url.href)).status()).toBe(200);                       // link válido, sem Bearer
    expect((await page.request.get(url.href + "&download=1")).headers()["content-disposition"]).toContain("attachment");
    const vencido = new URL(url.href); vencido.searchParams.set("exp", String(Math.floor(Date.now() / 1000) - 60));
    expect((await page.request.get(vencido.href)).status()).toBe(403);
    const adulterado = new URL(url.href); adulterado.searchParams.set("sig", "0".repeat(64));
    expect((await page.request.get(adulterado.href)).status()).toBe(403);
    expect((await page.request.get(`/api/exame-arquivos/${up.id}/conteudo`)).status()).toBe(401);
    // Outra clínica (Beta): Bearer da Beta não enxerga o arquivo da Alfa
    const ctx = await browser.newContext({ baseURL });
    const beta = await ctx.request.post("/api/auth/login", { data: { email: "admin.beta@teste.local", password: SENHA_TESTE } });
    const tokBeta = (await beta.json()).token as string;
    const hb = { Authorization: `Bearer ${tokBeta}` };
    expect((await ctx.request.get(`/api/exame-arquivos/${up.id}/conteudo`, { headers: hb })).status()).toBe(404);
    expect((await ctx.request.get(`/api/exames/${ex.id}/arquivos`, { headers: hb })).status()).toBe(404);
    expect((await ctx.request.post(`/api/exames/${ex.id}/arquivos`, { headers: { ...hb, "Content-Type": "application/octet-stream" }, data: PDF })).status()).toBe(404);
    expect((await ctx.request.delete(`/api/exames/${ex.id}`, { headers: hb })).status()).toBe(404);
    expect((await ctx.request.post(`/api/exames/${ex.id}/laudo/finalizar`, { headers: hb, data: { laudo_texto: "x" } })).status()).toBe(404);
    // Link da Alfa reaproveitado trocando o tenant pelo da Beta: assinatura não confere
    const tBeta = "bbbbbbbb-0000-0000-0000-00000000000b";
    const trocado = new URL(url.href); trocado.searchParams.set("t", tBeta);
    expect((await ctx.request.get(trocado.href)).status()).toBe(403);
    await ctx.close();
    expect(h.Authorization).toBeTruthy();
  });

  test("E9. estados de erro e vazio: lista vazia explica; falha da API mostra erro com nova tentativa", async ({ page, browser, baseURL }) => {
    // Vazio: clínica Beta não tem exames
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 800 } });
    const pb = await ctx.newPage();
    await login(pb, "admin.beta@teste.local");
    await pb.goto("/exames");
    await expect(pb.getByText("Nenhum exame ainda")).toBeVisible();
    await ctx.close();
    // Erro: API de exames fora do ar
    await login(page);
    await page.route("**/api/exames?*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "falha simulada" }) }));
    await page.route("**/api/exames", (r) => (r.request().method() === "GET" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "falha simulada" }) }) : r.continue()));
    await page.goto("/exames");
    await expect(page.getByText(/falha simulada|Não foi possível/i).first()).toBeVisible();
    await expect(page.getByText("Nenhum exame ainda")).toHaveCount(0); // erro não se disfarça de lista vazia
    await expect(page.getByRole("button", { name: /Tentar de novo/i }).first()).toBeVisible();
    await page.unroute("**/api/exames?*"); await page.unroute("**/api/exames");
    await page.getByRole("button", { name: /Tentar de novo/i }).first().click();
    await expect(page.getByText("falha simulada")).toHaveCount(0);
  });

  test("E10. 375 px: lista, novo exame, laudo e pedido sem rolagem horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);
    const ex = await criarExame(page);
    await enviar(page, ex.id, await imagem(page, "image/jpeg", "#4a4"), "rx.jpg");
    const estouro = () => page.evaluate(() => { const d = document.documentElement; return d.scrollWidth - d.clientWidth; });
    await page.goto("/exames");
    await expect(page.getByText(ex.codigo).first()).toBeVisible();
    expect(await estouro()).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: new RegExp(`Laudo e imagens do exame ${ex.codigo}`) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(ex.codigo);
    await expect.poll(async () => { const c = await dialog.boundingBox(); return c ? [c.x >= -1, c.x + c.width <= 376] : null; }).toEqual([true, true]); // após a animação de entrada
    await expect(page.getByRole("button", { name: "Finalizar laudo" })).toBeVisible();
    await page.getByRole("button", { name: "Abrir rx.jpg no visualizador" }).click();
    await expect(page.getByRole("button", { name: "Aumentar zoom" })).toBeVisible();
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.goto("/pedido-exame");
    await expect(page.getByRole("button", { name: "Cadastrar" })).toBeVisible();
    expect(await estouro()).toBeLessThanOrEqual(1);
  });

  // ── Bugs conhecidos (docs/qa: pilha de exames). test.fail: verde enquanto existir; vermelho quando corrigirem → remover o test.fail.
  test("B-EX1. valor negativo no exame deve ser recusado (400)", async ({ page }) => {
    test.fail(true, "POST /api/exames aceita valor < 0 (validarCamposExame não checa) — #33");
    await login(page);
    const r = await page.request.post("/api/exames", { headers: await auth(page), data: { tipo_nome: "Valor negativo", valor: -5 } });
    expect(r.status()).toBe(400);
  });

  test("B-EX2. exame com laudo finalizado não deve aceitar retirar/anexar imagem sem reabrir (409)", async ({ page }) => {
    test.fail(true, "DELETE/POST /api/exames/:id/arquivos ignoram laudado_em; PATCH status também — #37/#43");
    await login(page);
    const h = await auth(page);
    const ex = await criarExame(page);
    const up = await (await enviar(page, ex.id, await imagem(page, "image/jpeg", "#777"), "rx.jpg")).json();
    expect((await page.request.post(`/api/exames/${ex.id}/laudo/finalizar`, { headers: h, data: { laudo_texto: "Laudo final (e2e)" } })).status()).toBe(200);
    expect((await page.request.delete(`/api/exames/${ex.id}/arquivos/${up.id}`, { headers: h })).status()).toBe(409);
    expect((await enviar(page, ex.id, await imagem(page, "image/png", "#888"), "outra.png")).status()).toBe(409);
  });
});
