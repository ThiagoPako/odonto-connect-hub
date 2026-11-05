// Fluxos adicionais (orçamento, tratamento, prontuário/anamnese, financeiro, CRM, configuração).
// Cada teste confere a resposta da API (2xx), o resultado visível e que o dado SOBREVIVE a um reload.
import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

function vigiarApi(page: Page) {
  const falhas: string[] = [];
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) falhas.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  return falhas;
}
const escrita = (page: Page, trecho: string) =>
  page.waitForResponse((r) => r.url().includes(trecho) && ["POST", "PUT", "PATCH"].includes(r.request().method()));

test.describe("Fluxos adicionais", () => {
  test("6. orçamento: cria para a Lúcia e continua na lista após recarregar", async ({ page }) => {
    const falhas = vigiarApi(page);
    await login(page);
    await page.goto("/orcamentos");
    await expect(page.getByText("Selecione um orçamento")).toBeVisible();
    const linhas = page.getByText("Lúcia Gomes (Alfa)");
    const antes = await linhas.count();
    await page.getByRole("button", { name: "Novo Orçamento" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Lúcia Gomes (Alfa)" }).click();
    const titulo = `Orçamento E2E ${Date.now()}`;
    await dialog.locator("label:has-text('Título do orçamento') + input").fill(titulo);
    await dialog.getByRole("button", { name: "Adicionar" }).click();
    const resp = escrita(page, "/api/orcamentos");
    await dialog.getByRole("button", { name: "Salvar orçamento" }).click();
    expect((await resp).status()).toBeLessThan(300);
    await page.reload();
    await expect(page.getByText("Selecione um orçamento")).toBeVisible();
    // A lista mostra paciente/itens/valor (não o título): uma linha a mais da Lúcia depois do reload.
    await expect.poll(() => linhas.count()).toBeGreaterThan(antes);
    expect(falhas).toEqual([]);
  });

  test("7. tratamento: cria com 1 etapa e aparece após recarregar", async ({ page }) => {
    const falhas = vigiarApi(page);
    await login(page);
    await page.goto("/tratamentos");
    const linhas = page.getByText("João Pereira (Alfa)");
    await expect(page.getByText("Selecione um tratamento")).toBeVisible();
    const antes = await linhas.count();
    await page.getByRole("button", { name: "Novo", exact: true }).click();
    await page.locator("select").first().selectOption({ label: "João Pereira (Alfa)" });
    const desc = `Tratamento E2E ${Date.now()}`;
    await page.getByPlaceholder("Ex: Implante dentário superior").fill(desc);
    await page.getByPlaceholder("Procedimento").first().fill("Limpeza (e2e)");
    await page.getByPlaceholder("Valor (R$)").first().fill("120");
    const resp = escrita(page, "/api/tratamentos");
    await page.getByRole("button", { name: "Criar Tratamento" }).click();
    expect((await resp).status()).toBeLessThan(300);
    await page.reload();
    await expect(page.getByText("Selecione um tratamento")).toBeVisible();
    // A lista mostra o paciente (não a descrição): deve haver uma linha a mais que antes.
    await expect.poll(() => linhas.count()).toBeGreaterThan(antes);
    expect(falhas).toEqual([]);
  });

  test("8. prontuário/anamnese: registra uma anamnese e ela persiste após recarregar", async ({ page }) => {
    const falhas = vigiarApi(page);
    await login(page);
    await page.goto("/prontuario");
    await page.getByText("Lúcia Gomes (Alfa)").first().click();
    await page.getByRole("button", { name: "Nova Evolução" }).click();
    await page.locator("select").selectOption({ label: "Anamnese" });
    const titulo = `Anamnese E2E ${Date.now()}`;
    await page.locator("form input[type=text], form input:not([type])").last().fill(titulo);
    await page.locator("form textarea").fill("Alergia a dipirona (teste e2e)");
    const resp = escrita(page, "/api/prontuarios");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    expect((await resp).status()).toBeLessThan(300);
    await page.reload();
    await page.getByText("Lúcia Gomes (Alfa)").first().click();
    await expect(page.getByText(titulo).first()).toBeVisible();
    expect(falhas).toEqual([]);
  });

  test("9. financeiro: movimentação criada persiste após recarregar", async ({ page }) => {
    const falhas = vigiarApi(page);
    await login(page);
    await page.goto("/financeiro");
    await page.getByRole("button", { name: "Movimentações" }).click();
    await page.getByText("Nova Movimentação").first().click();
    const desc = `Mov persistente E2E ${Date.now()}`;
    await page.getByPlaceholder("Ex: Consulta avaliação").fill(desc);
    await page.getByPlaceholder("0,00").fill("99");
    const resp = escrita(page, "/api/");
    await page.getByRole("button", { name: "Salvar" }).click();
    expect((await resp).status()).toBeLessThan(300);
    await page.reload();
    await page.getByRole("button", { name: "Movimentações" }).click();
    await expect(page.getByText(desc).first()).toBeVisible();
    expect(falhas).toEqual([]);
  });

  test("10. CRM: novo lead aparece no funil e persiste após recarregar", async ({ page }) => {
    const falhas = vigiarApi(page);
    await login(page);
    await page.goto("/crm");
    await page.getByRole("button", { name: "Novo Lead" }).click();
    const nome = `Lead E2E ${Date.now()}`;
    await page.getByPlaceholder("Nome completo").fill(nome);
    await page.getByPlaceholder("(11) 99999-9999").fill(`119${Date.now().toString().slice(-8)}`);
    const resp = escrita(page, "/api/crm");
    await page.getByRole("button", { name: "Cadastrar Lead" }).click();
    expect((await resp).status()).toBeLessThan(300);
    await page.reload();
    await expect(page.getByText(nome).first()).toBeVisible();
    expect(falhas).toEqual([]);
  });

  test("11. configuração: nome da clínica salvo persiste após recarregar", async ({ page }) => {
    await login(page);
    await page.goto("/configuracoes");
    const nome = `Clínica Alfa E2E ${Date.now()}`;
    const campo = page.getByPlaceholder(/^(Odonto Connect Clínica|Clínica Sorriso)$/);
    await campo.fill(nome);
    await page.getByPlaceholder("Rua Exemplo, 123 - Sala 45").fill("Rua E2E, 100");
    await page.getByRole("button", { name: /^Salvar (neste aparelho|localização)$/ }).click();
    await page.reload();
    await expect(page.getByPlaceholder(/^(Odonto Connect Clínica|Clínica Sorriso)$/)).toHaveValue(nome);
  });
});

// Regressão de B1 (docs/qa/varredura-2026-11-05-tarde.md): GET /api/sessions/active devolvia 500 em toda carga do
// dashboard (attendance_sessions.lead_id é TEXT; JOIN precisa de `l.id::text = s.lead_id`). Corrigido no #42.
test("12. regressão: /api/sessions/active responde 200", async ({ page }) => {
  await login(page);
  const status = await page.evaluate(async () => {
    const token = localStorage.getItem("odonto_jwt");
    const r = await fetch("/api/sessions/active?active=true", { headers: { Authorization: `Bearer ${token}` } });
    return r.status;
  });
  expect(status).toBe(200);
});
