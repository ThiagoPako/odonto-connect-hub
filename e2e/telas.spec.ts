// Telas dos PRs de UX revisados no navegador: chat (#53), contatos/CRM (#45, #55), disparos (#38), pacientes (#47) e ficha (#74).
// Ambiente local semeado (docs/operacao/ambiente-local.md); nunca o vite dev padrão (aponta para produção).
// Para semear o chat usa o banco local direto: E2E_DB_NAME (padrão odonto_local), usuário/senha do setup-local.sh.
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { login, USUARIOS } from "./helpers";

const ALFA = "aaaaaaaa-0000-0000-0000-00000000000a";
const require_ = createRequire(import.meta.url);

async function sql(texto: string, params: unknown[] = []) {
  const { Client } = require_("../vps-api-server/node_modules/pg");
  const c = new Client({ host: "localhost", database: process.env.E2E_DB_NAME || "odonto_local", user: "odonto_user", password: "local_test_pw" });
  if (!/^(localhost|127\.0\.0\.1)$/.test(c.host)) throw new Error("só banco local");
  await c.connect();
  try { return (await c.query(texto, params)).rows as any[]; } finally { await c.end(); }
}
const token = (page: Page) => page.evaluate(() => localStorage.getItem("odonto_jwt") as string);
const auth = async (page: Page) => ({ Authorization: `Bearer ${await token(page)}` });
const unico = () => `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
const telefone = () => `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
function cpfValido(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (base: number[]) => { let s = 0; base.forEach((d, i) => (s += d * (base.length + 1 - i))); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  const d1 = dv(n); const d2 = dv([...n, d1]);
  const t = [...n, d1, d2].join("");
  return `${t.slice(0, 3)}.${t.slice(3, 6)}.${t.slice(6, 9)}-${t.slice(9)}`;
}

// ═══════════════════════════ #53 — CHAT ═══════════════════════════
test.describe("Chat (#53)", () => {
  /** Lead novo com 160 mensagens (a mais antiga contém a palavra rara) já assumido pelo admin, conversa aberta. */
  async function conversaComHistorico(page: Page) {
    const id = unico();
    const leadId = (await sql(`INSERT INTO crm_leads (id, nome, telefone, origem, status, kanban_stage, tenant_id) VALUES (gen_random_uuid(),$1,$2,'whatsapp','novo','lead',$3) RETURNING id`, [`Lead Chat ${id}`, telefone(), ALFA]))[0].id as string;
    await sql(`INSERT INTO chat_messages (id, lead_id, content, sender, type, status, timestamp, tenant_id)
               SELECT $1||'-'||g, $2, CASE WHEN g=3 THEN 'consulta antiga palavra-rara-${id}' ELSE 'mensagem número '||g END,
                      CASE WHEN g%2=0 THEN 'lead' ELSE 'attendant' END, 'text', 'delivered', NOW() - ((200-g) || ' minutes')::interval, $3
                 FROM generate_series(1,160) g`, [`m${id}`, leadId, ALFA]);
    await login(page);
    await page.goto("/chat");
    const card = page.locator("div", { hasText: `Lead Chat ${id}` }).filter({ has: page.getByRole("button", { name: /Assumir/ }) }).last();
    await card.getByRole("button", { name: /Assumir/ }).click();
    await expect(page.getByRole("button", { name: "Buscar na conversa" })).toBeVisible();
    await expect(page.locator(`[id^="msg-m${id}-"]`).first()).toBeVisible();
    return { id, leadId };
  }
  const abrirBusca = async (page: Page, termo: string) => {
    await page.getByRole("button", { name: "Buscar na conversa" }).click();
    await page.getByRole("textbox", { name: "Buscar na conversa" }).fill(termo);
  };

  test("C1. falha da busca no histórico aparece na tela (e não vira '0 resultados'); cada busca vai uma vez ao servidor", async ({ page }) => {
    const { id } = await conversaComHistorico(page);
    let pedidos = 0;
    await page.route("**/api/messages/search*", (r) => { pedidos++; return r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "falha simulada" }) }); });
    await abrirBusca(page, `palavra-rara-${id}`);
    await expect(page.getByText("Busca no histórico falhou")).toBeVisible();
    await expect.poll(() => pedidos).toBe(1);
    await page.waitForTimeout(800);
    expect(pedidos).toBe(1); // antes ia em dobro
  });

  test("C2. clicar num resultado antigo carrega o histórico até a mensagem; resultado inexistente avisa", async ({ page }) => {
    const { id } = await conversaComHistorico(page);
    const antigaId = `m${id}-3`;
    await page.route("**/api/messages/search*", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify([
        { id: antigaId, content: `consulta antiga palavra-rara-${id}`, sender: "lead", timestamp: new Date(Date.now() - 197 * 60_000).toISOString() },
        { id: "nao-existe-mais", content: `palavra-rara-${id} fantasma`, sender: "lead", timestamp: "2020-01-01T10:00:00Z" },
      ]),
    }));
    await abrirBusca(page, `palavra-rara-${id}`);
    await expect(page.getByText("2 resultados")).toBeVisible();
    await expect(page.locator(`#msg-${antigaId}`)).toHaveCount(0);           // ainda não carregada (só as 50 últimas)
    await page.getByRole("button", { name: /^consulta antiga palavra-rara/ }).click();   // o chip corta o texto (~35 caracteres)
    await expect(page.locator(`#msg-${antigaId}`)).toBeAttached({ timeout: 15_000 });
    await expect(page.locator(`#msg-${antigaId}`)).toBeInViewport();
    // Resultado que não existe mais no histórico carregável: aviso com a data em vez de silêncio
    await page.getByText(`palavra-rara-${id} fantasma`).first().click();
    await expect(page.getByText(/Não foi possível abrir esta mensagem aqui/)).toBeVisible({ timeout: 20_000 });
  });

  test("C3. 'Apagar para todos' pede confirmação; Cancelar não apaga; Confirmar apaga", async ({ page }) => {
    const { id } = await conversaComHistorico(page);
    const alvo = page.locator(`#msg-m${id}-159`);                         // enviada pelo atendente
    await alvo.scrollIntoViewIfNeeded();
    const apagados: string[] = [];
    page.on("request", (r) => { if (r.method() === "DELETE" && r.url().includes("/api/messages/")) apagados.push(r.url()); });
    await alvo.hover();
    await alvo.getByRole("button", { name: "Apagar" }).click();
    const caixa = page.getByRole("alertdialog");
    await expect(caixa).toContainText("Apagar esta mensagem para todos?");
    await caixa.getByRole("button", { name: "Cancelar" }).click();
    await page.waitForTimeout(500);
    expect(apagados).toHaveLength(0);
    await expect(page.locator(`#msg-m${id}-159`)).toContainText("mensagem número 159");
    // Pelo menu de contexto também pede confirmação
    await alvo.click({ button: "right" });
    await page.getByRole("button", { name: "Apagar" }).last().click();
    await expect(page.getByRole("alertdialog")).toContainText("Não dá para desfazer");
    const resp = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/api/messages/"));
    await page.getByRole("alertdialog").getByRole("button", { name: "Apagar para todos" }).click();
    expect((await resp).status()).toBeLessThan(300);
    await expect(page.locator(`#msg-m${id}-159`)).not.toContainText("mensagem número 159");
  });

  // Regressão: GET /api/messages/search dava 500 (uuid = text no JOIN com crm_leads); corrigido no #42.
  test("C4. busca real no histórico responde 200 e acha a mensagem", async ({ page }) => {
    const { id, leadId } = await conversaComHistorico(page);
    const r = await page.request.get(`/api/messages/search?q=${encodeURIComponent(`palavra-rara-${id}`)}&lead_id=${leadId}`, { headers: await auth(page) });
    expect(r.status()).toBe(200);
    expect((await r.json()).length).toBe(1);
  });
});

// ═══════════════════════════ #45 / #55 — CONTATOS E CRM ═══════════════════════════
test.describe("Contatos e CRM (#45, #55)", () => {
  test("K1. contato: '(55) 99876-5432' (DDD do RS) vai ao servidor como 55+DDD+número", async ({ page }) => {
    await login(page);
    await page.goto("/contatos");
    await page.getByRole("button", { name: /Novo Contato/ }).first().click();
    const nome = `Contato RS ${unico()}`;
    await page.locator("#novo-contato-nome").fill(nome);
    const campo = page.getByPlaceholder("(11) 99999-9999");
    await campo.fill("5599876543");                    // dígitos soltos: a máscara monta
    await campo.fill("(55) 99876-5432");
    await expect(campo).toHaveValue("(55) 99876-5432");
    const req = page.waitForRequest((r) => r.url().endsWith("/api/contatos") && r.method() === "POST");
    await page.getByRole("button", { name: "Criar Contato" }).click();
    expect(JSON.parse((await req).postData()!).telefone).toBe("5555998765432");
    // Telefone incompleto não vai ao servidor
    await page.getByRole("button", { name: /Novo Contato/ }).first().click();
    await page.locator("#novo-contato-nome").fill("Contato curto");
    await page.getByPlaceholder("(11) 99999-9999").fill("1234");
    let enviou = false; page.on("request", (r) => { if (r.url().endsWith("/api/contatos") && r.method() === "POST") enviou = true; });
    await page.getByRole("button", { name: "Criar Contato" }).click();
    await page.waitForTimeout(500);
    expect(enviou).toBe(false);
  });

  test("K2. editar contato estrangeiro (DDI 1) não é bloqueado e não mexe no telefone", async ({ page }) => {
    const nome = `Contato EUA ${unico()}`;
    const id = (await sql(`INSERT INTO contatos (id, nome, telefone, tipo, tenant_id) VALUES (gen_random_uuid(),$1,'14155550123','pessoal',$2) RETURNING id`, [nome, ALFA]))[0].id as string;
    await login(page);
    await page.goto("/contatos");
    await page.getByPlaceholder(/Buscar/).first().fill(nome).catch(() => {});
    await page.getByText(nome).first().hover();
    await page.getByRole("button", { name: "Editar contato" }).first().click();
    const dlg = page.getByRole("dialog");
    await dlg.locator("input").first().fill(`${nome} (editado)`);
    const req = page.waitForRequest((r) => r.url().includes(`/api/contatos/${id}`) && ["PUT", "PATCH"].includes(r.method()));
    await dlg.getByRole("button", { name: /Salvar/ }).click();
    const corpo = JSON.parse((await req).postData()!);
    expect(corpo.telefone).toBe("14155550123");
    await expect.poll(async () => (await sql(`SELECT nome FROM contatos WHERE id=$1`, [id]))[0].nome).toBe(`${nome} (editado)`);
  });

  test("K3. novo lead: máscara, erro de telefone incompleto e gravação como 55+DDD+número", async ({ page }) => {
    await login(page);
    await page.goto("/crm");
    await page.getByRole("button", { name: "Novo Lead" }).click();
    await page.locator("#lead-nome").fill(`Lead RS ${unico()}`);
    await page.locator("#lead-tel").fill("123");
    await page.getByRole("button", { name: /Cadastrar Lead/ }).click();
    await expect(page.getByText(/Telefone incompleto/)).toBeVisible();
    await page.locator("#lead-tel").fill("(55) 99876-5432");
    await expect(page.locator("#lead-tel")).toHaveValue("(55) 99876-5432");
    const req = page.waitForRequest((r) => r.url().endsWith("/api/crm/leads") && r.method() === "POST");
    await page.getByRole("button", { name: /Cadastrar Lead/ }).click();
    expect(JSON.parse((await req).postData()!).telefone).toBe("5555998765432");
  });
});


test.describe("Filas e etiquetas (#45)", () => {
  test("K4. excluir fila e excluir etiqueta pedem confirmação; Voltar não exclui", async ({ page }) => {
    await login(page);
    const H = await auth(page);
    const fila = `Fila E2E ${unico()}`;
    const etiqueta = `Etiqueta E2E ${unico()}`;
    expect((await page.request.post("/api/queues", { headers: H, data: { name: fila, icon: "📞" } })).status()).toBeLessThan(300);
    expect((await page.request.post("/api/tags", { headers: H, data: { name: etiqueta, color: "#EF4444", icon: "🔴" } })).status()).toBeLessThan(300);
    const apagou: string[] = [];
    page.on("request", (r) => { if (r.method() === "DELETE") apagou.push(r.url()); });
    await page.goto("/configuracoes");
    await page.getByRole("button", { name: "Atendimento" }).click();
    await page.getByRole("button", { name: `Excluir fila ${fila}` }).click();
    const caixa = page.getByRole("alertdialog");
    await expect(caixa).toContainText(`Excluir a fila "${fila}"?`);
    await caixa.getByRole("button", { name: /Cancelar|Voltar/ }).click();
    await page.waitForTimeout(400);
    expect(apagou).toHaveLength(0);
    await page.getByRole("button", { name: `Excluir fila ${fila}` }).click();
    const resp = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/api/queues/"));
    await page.getByRole("alertdialog").getByRole("button", { name: "Excluir fila" }).click();
    expect((await resp).status()).toBeLessThan(300);
    await expect(page.getByText(fila)).toHaveCount(0);
    // Etiqueta
    await page.getByRole("button", { name: "Tags" }).click();
    await page.getByRole("button", { name: new RegExp(`Excluir.*${etiqueta}`) }).first().click();
    await expect(page.getByRole("alertdialog")).toContainText(`Excluir a etiqueta "${etiqueta}"?`);
    await page.getByRole("alertdialog").getByRole("button", { name: /Cancelar|Voltar/ }).click();
    await page.waitForTimeout(400);
    expect(apagou.filter((u) => u.includes("/api/tags/"))).toHaveLength(0);
    await expect(page.getByText(etiqueta).first()).toBeVisible();
  });
});

// ═══════════════════════════ #38 — DISPAROS ═══════════════════════════
test.describe("Disparos (#38)", () => {
  test.use({ timezoneId: "America/Sao_Paulo" });
  const numeros = (page: Page) => page.route("**/api/whatsapp/instances*", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{ id: "i-e2e", name: "e2e-alfa", connectionStatus: "open", ownerJid: "5511900000008@s.whatsapp.net", integration: "WHATSAPP-BAILEYS" }]),
  }));

  test("D1. agendar para HOJE às 22h30 (Brasília) usa a data local; ontem é recusado; revisão mostra o limite por envio", async ({ page }) => {
    await numeros(page);
    await login(page);
    await page.clock.install({ time: new Date("2026-11-05T22:30:00-03:00") });   // 01:30 UTC do dia 06
    await page.goto("/disparos");
    await page.getByRole("button", { name: /Novo disparo/ }).first().click();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByPlaceholder(/Ex: Reativação/).fill("Disparo noite E2E");
    await page.locator("textarea").fill("Olá {{nome}}, tudo bem? Responda SAIR para não receber mais.");
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: /Campanha de único dia/ }).click();
    const data = page.locator("input[type=date]").first();
    await data.fill("2026-11-04");
    await expect(page.getByText("A data do envio já passou.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Próximo" })).toBeDisabled();
    await data.fill("2026-11-05");                                                // "hoje" no relógio de Brasília
    await expect(page.getByText("A data do envio já passou.")).toHaveCount(0);
    await page.getByRole("button", { name: "Próximo" }).click();
    await expect(page.getByText("até 232 por envio")).toBeVisible();              // a confirmação mostra o limite de contatos
    const req = page.waitForRequest((r) => r.url().endsWith("/api/campaigns") && r.method() === "POST");
    await page.getByRole("button", { name: "Criar disparo" }).click();
    const corpo = JSON.parse((await req).postData()!);
    expect(corpo.dataInicio).toBe("2026-11-05");
    expect(corpo.tipo).toBe("unico");
    expect(corpo.ativo).toBe(false);
    await expect(page.getByText("Disparo noite E2E").first()).toBeVisible();
  });

  test("D2. se o servidor recusar o disparo, o assistente não fecha nem diz que deu certo", async ({ page }) => {
    await numeros(page);
    await login(page);
    await page.route("**/api/campaigns", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "falha simulada" }) }) : r.continue()));
    await page.goto("/disparos");
    await page.getByRole("button", { name: /Novo disparo/ }).first().click();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByPlaceholder(/Ex: Reativação/).fill("Disparo que falha");
    await page.locator("textarea").fill("Mensagem de teste. Responda SAIR para não receber mais.");
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Próximo" }).click();
    await page.getByRole("button", { name: "Criar disparo" }).click();
    await expect(page.getByRole("button", { name: "Criar disparo" })).toBeVisible();   // continua aberto
    await expect(page.getByText(/falha simulada|Não foi possível/i).first()).toBeVisible();
  });
});

// ═══════════════════════════ #47 — PACIENTES ═══════════════════════════
test.describe("Pacientes (#47)", () => {
  test("P1. telefone com máscara vai como 55+DDD+número; CPF repetido na clínica é bloqueado", async ({ page }) => {
    await login(page);
    await page.goto("/pacientes");
    const cpf = cpfValido();
    const nome = `Paciente Mascara ${unico()}`;
    const criar = async (n: string) => {
      await page.getByRole("button", { name: "Novo Paciente" }).click();
      await page.locator("#novo-nome").fill(n);
      await page.locator("#novo-cpf").fill(cpf.replace(/\D/g, ""));
      await expect(page.locator("#novo-cpf")).toHaveValue(cpf);
      await page.locator("#novo-telefone").fill("(55) 99876-5432");
    };
    await criar(nome);
    const req = page.waitForRequest((r) => r.url().endsWith("/api/pacientes") && r.method() === "POST");
    await page.getByRole("button", { name: "Cadastrar Paciente" }).click();
    const corpo = JSON.parse((await req).postData()!);
    expect(corpo.telefone).toBe("5555998765432");
    expect(corpo.cpf).toBe(cpf);
    await expect(page.getByText(nome).first()).toBeVisible();
    // mesmo CPF de novo: bloqueado, com o nome de quem já tem
    await criar(`${nome} 2`);
    let postou = false; page.on("request", (r) => { if (r.url().endsWith("/api/pacientes") && r.method() === "POST") postou = true; });
    await page.getByRole("button", { name: "Cadastrar Paciente" }).click();
    await expect(page.getByText(/Já existe um paciente com este CPF/)).toBeVisible();
    expect(postou).toBe(false);
    // CPF inválido
    await page.locator("#novo-cpf").fill("111.111.111-11");
    await page.getByRole("button", { name: "Cadastrar Paciente" }).click();
    await expect(page.locator("#novo-cpf")).toHaveAttribute("aria-invalid", "true");
  });

  test("P2. paciente criado a partir de um lead fica com o mesmo telefone e o lead anda no CRM ao aprovar o orçamento", async ({ page }) => {
    await login(page);
    const H = await auth(page);
    const nome = `Lead Vira Paciente ${unico()}`;
    const fone = `5555${String(Math.floor(Math.random() * 1e9)).padStart(9, "9").slice(0, 9)}`;   // 55 + DDD 55 + 9 dígitos
    const lead = await (await page.request.post("/api/crm/leads", { headers: H, data: { nome, telefone: fone, origem: "WhatsApp" } })).json();
    expect(lead.id).toBeTruthy();
    await page.goto("/pacientes");
    await page.getByRole("button", { name: "Novo Paciente" }).click();
    await page.getByRole("button", { name: /Buscar Lead/ }).click();
    await page.getByText(nome).first().click();
    await expect(page.locator("#novo-nome")).toHaveValue(nome);
    await expect(page.locator("#novo-telefone")).toHaveValue(/^\(55\) \d{5}-\d{4}$/);
    const req = page.waitForRequest((r) => r.url().endsWith("/api/pacientes") && r.method() === "POST");
    await page.getByRole("button", { name: "Cadastrar Paciente" }).click();
    expect(JSON.parse((await req).postData()!).telefone).toBe(fone);           // igual ao do lead (o backend junta os dois por telefone exato)
    await expect.poll(async () => (await sql(`SELECT id FROM pacientes WHERE nome=$1 AND tenant_id=$2`, [nome, ALFA])).length).toBe(1);
    const pacienteId = (await sql(`SELECT id FROM pacientes WHERE nome=$1 AND tenant_id=$2`, [nome, ALFA]))[0].id as string;
    // A conversão já leva o lead para "aprovado"; volta para "orçamento" para ver o efeito da aprovação do orçamento
    await sql(`UPDATE crm_leads SET kanban_stage='orcamento', status='orcamento' WHERE id=$1`, [lead.id]);
    const orc = await (await page.request.post("/api/orcamentos", { headers: H, data: { paciente_id: pacienteId, titulo: "Orçamento e2e", itens: [{ procedimento: "Limpeza", quantidade: 1, valor_unitario: 100, valor: 100 }], valor_total: 100, status: "pendente" } })).json();
    expect(orc.id).toBeTruthy();
    const aprov = await page.request.patch(`/api/orcamentos/${orc.id}/status`, { headers: H, data: { status: "aprovado" } });
    expect(aprov.status()).toBe(200);
    expect((await aprov.json()).leadMoved).toBe(true);
    expect((await sql(`SELECT kanban_stage FROM crm_leads WHERE id=$1`, [lead.id]))[0].kanban_stage).toBe("orcamento_aprovado");
  });
});

// ═══════════════════════════ #74 — FICHA DO PACIENTE ═══════════════════════════
test.describe("Ficha do paciente (#74)", () => {
  async function abrirFicha(page: Page, email: string = USUARIOS.admin) {
    await login(page, email);
    await page.goto("/pacientes");
    await page.getByText("Lúcia Gomes (Alfa)").first().click();
    await expect(page.getByRole("tab", { name: "Anamnese" })).toBeVisible();
  }

  test("F1. o que foi digitado na anamnese sobrevive à troca de aba; fechar pergunta antes de descartar; salvar grava", async ({ page }) => {
    await abrirFicha(page);
    await page.getByRole("tab", { name: "Anamnese" }).click();
    await page.getByRole("button", { name: /Preencher Anamnese|Editar/ }).first().click();
    const alergias = page.getByPlaceholder("Ex: Dipirona, Amoxicilina");
    const texto = `Dipirona e2e ${unico()}`;
    await alergias.fill(texto);
    await page.getByRole("tab", { name: "Odontograma" }).click();
    await page.getByRole("tab", { name: "Dados" }).click();
    await page.getByRole("tab", { name: "Anamnese" }).click();
    await expect(alergias).toHaveValue(texto);                                   // antes a aba era desmontada e o texto sumia
    await expect(page.getByRole("tab", { name: /Anamnese/ })).toContainText("não salvo");
    // Fechar com alteração não salva: pergunta; recusar mantém a ficha aberta
    let pergunta = "";
    page.once("dialog", (d) => { pergunta = d.message(); void d.dismiss(); });
    await page.getByRole("button", { name: "Fechar ficha" }).click();
    expect(pergunta).toContain("Há alterações não salvas (anamnese)");
    await expect(page.getByRole("tab", { name: "Anamnese" })).toBeVisible();
    const resp = page.waitForResponse((r) => /\/api\/pacientes\/[^/]+\/anamnese/.test(r.url()) && ["POST", "PUT", "PATCH"].includes(r.request().method()));
    await page.getByRole("button", { name: /Salvar Anamnese/ }).click();
    expect((await resp).status()).toBeLessThan(300);
    await expect(page.getByText(texto).first()).toBeVisible();
  });

  test("F2. odontograma em 375 px: cabe na tela, dentes são botões de toque (≥ 24 px) e Cancelar volta ao salvo", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await abrirFicha(page, USUARIOS.dentista);
    await page.getByRole("tab", { name: "Odontograma" }).click();
    await page.getByRole("button", { name: /Preencher Odontograma|Editar/ }).first().click();
    const estouro = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(estouro).toBeLessThanOrEqual(1);
    const dentes = page.getByRole("button", { name: /^Dente \d+/ });
    expect(await dentes.count()).toBe(32);
    const caixas = await dentes.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.right)]; }));
    for (const [w, h, direita] of caixas) { expect(w).toBeGreaterThanOrEqual(24); expect(h).toBeGreaterThanOrEqual(24); expect(direita).toBeLessThanOrEqual(376); }
    const dente16 = page.getByRole("button", { name: /^Dente 16,/ });
    await page.getByRole("button", { name: "Cárie", exact: true }).click();
    await dente16.click();
    await expect(dente16).toHaveAttribute("aria-label", /Cárie/);
    page.once("dialog", (d) => void d.accept());                                   // "Descartar as marcações do odontograma?"
    await page.getByRole("button", { name: "Cancelar" }).click();
    // Voltou ao último estado confirmado pelo servidor: ao editar de novo o dente 16 não está com cárie
    await page.getByRole("button", { name: /Preencher Odontograma|Editar Odontograma/ }).first().click();
    await expect(page.getByRole("button", { name: /^Dente 16,/ })).not.toHaveAttribute("aria-label", /Cárie/);
  });

  test("F3. perfis: admin exclui; dentista edita odontograma; recepção só vê (nota 'o dentista edita')", async ({ page, browser, baseURL }) => {
    const matriz: Array<[string, { excluir: boolean; editaOdonto: boolean }]> = [
      [USUARIOS.admin, { excluir: true, editaOdonto: true }],
      [USUARIOS.dentista, { excluir: false, editaOdonto: true }],
      [USUARIOS.recepcionista, { excluir: false, editaOdonto: false }],
    ];
    for (const [email, esperado] of matriz) {
      const ctx = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } });
      const p = await ctx.newPage();
      await abrirFicha(p, email);
      expect(await p.getByRole("button", { name: "Excluir" }).count() > 0, `${email}: Excluir`).toBe(esperado.excluir);
      await p.getByRole("tab", { name: "Odontograma" }).click();
      const editar = p.getByRole("button", { name: /Preencher Odontograma|Editar Odontograma/ });
      if (esperado.editaOdonto) await expect(editar.first(), `${email}: editar odontograma`).toBeVisible();
      else { await expect(p.getByText(/o dentista edita o odontograma|Odontograma não preenchido/)).toBeVisible(); expect(await editar.count(), `${email}: editar odontograma`).toBe(0); }
      await ctx.close();
    }
  });
});

test("V1. telas dos PRs de UX a 375 px: sem rolagem horizontal e sem erro de console", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const erros: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text().slice(0, 120)); });
  page.on("pageerror", (e) => erros.push(`pageerror ${String(e).slice(0, 120)}`));
  await page.route("**/api/whatsapp/instances*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "i", name: "e2e-alfa", connectionStatus: "open", integration: "WHATSAPP-BAILEYS" }]) }));
  await login(page);
  const estouro = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const rota of ["chat", "contatos", "crm", "disparos", "pacientes", "canais", "configuracoes"]) {
    await page.goto(`/${rota}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(await estouro(), rota).toBeLessThanOrEqual(1);
  }
  await page.goto("/disparos");
  await page.getByRole("button", { name: /Novo disparo/ }).first().click();
  expect(await estouro(), "assistente de disparo").toBeLessThanOrEqual(1);
  await page.goto("/pacientes");
  await page.getByRole("button", { name: "Novo Paciente" }).click();
  expect(await estouro(), "novo paciente").toBeLessThanOrEqual(1);
  expect(erros.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});
