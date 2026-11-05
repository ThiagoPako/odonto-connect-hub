// 5 fluxos críticos do Odonto Connect contra o ambiente local semeado (clínica Alfa).
import { test, expect } from "@playwright/test";
import { login, USUARIOS } from "./helpers";

test.describe("Fluxos críticos", () => {
  test("1. login: credencial inválida é recusada e a válida entra no dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(USUARIOS.admin);
    await page.locator("input[type=password]").fill("senha-errada");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/login/);
    await login(page);
    await expect(page.getByText("AGENDA DO DIA")).toBeVisible();
  });

  test("2. criar paciente: aparece na lista da clínica", async ({ page }) => {
    await login(page);
    await page.goto("/pacientes");
    await page.getByRole("button", { name: "Novo Paciente" }).click();
    const nome = `Paciente E2E ${Date.now()}`;
    await page.getByPlaceholder("Nome do paciente").fill(nome);
    await page.getByPlaceholder("(11) 99999-0000").fill("11900009999");
    await page.getByRole("button", { name: "Cadastrar Paciente" }).click();
    await page.getByPlaceholder("Buscar por nome, CPF ou telefone...").fill(nome);
    await expect(page.getByText(nome).first()).toBeVisible();
  });

  test("3. agendar: novo agendamento é gravado (API 200) e confirmado na tela", async ({ page }) => {
    await login(page);
    await page.goto("/agenda");
    await page.getByRole("button", { name: "NOVO" }).click();
    await page.getByPlaceholder("Buscar paciente por nome...").fill("Lúcia");
    await page.getByRole("dialog").getByText("Lúcia Gomes (Alfa)").first().click(); // escopo no dialog: o grid da agenda atrás também mostra o nome
    const dialog = page.getByRole("dialog");
    // Profissional é obrigatório (sem ele o botão "Agendar" não dispara a requisição).
    await dialog.locator("button", { hasText: "Selecione" }).click();
    await page.getByRole("option", { name: "Dr. Davi Dentista" }).click();
    // "Confirmação" vem como "Enviar agora" por padrão: desligamos para o teste não enfileirar WhatsApp.
    // (Versões novas da tela já abrem em "Não enviar" e sem esse seletor: só mexe se ele existir.)
    const confirmacao = dialog.locator("button:not([disabled])", { hasText: "Enviar agora" }).first();
    if (await confirmacao.count()) {
      await confirmacao.click();
      await page.getByRole("option", { name: "Não enviar" }).first().click();
    }
    // Reexecuções criam conflito de horário (09:00 do mesmo profissional): a tela pede window.confirm — aceitamos.
    page.once("dialog", (d) => d.accept());
    const resp = page.waitForResponse((r) => r.url().endsWith("/api/agenda") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Agendar", exact: true }).click();
    expect((await resp).status()).toBe(200);
    await expect(page.getByText("Agendamento criado")).toBeVisible();
  });

  test("4. consulta: inicia o atendimento, registra a queixa e finaliza", async ({ page }) => {
    await login(page, USUARIOS.dentista);
    await page.goto("/atendimento");
    await page.getByText("João Pereira (Alfa)").first().click();
    await page.getByRole("button", { name: "Iniciar Consulta" }).last().click();
    await page.getByPlaceholder("Descreva a queixa principal do paciente...").fill("Dor ao mastigar (teste e2e)");
    await page.getByPlaceholder("Descreva o procedimento...").fill("Avaliação (teste e2e)");
    const resp = page.waitForResponse((r) => r.url().includes("/api/") && r.request().method() !== "GET" && r.url().includes("consult"));
    await page.getByRole("button", { name: "Finalizar Atendimento" }).click();
    expect((await resp).status()).toBeLessThan(300);
  });

  test("5. financeiro: cria uma movimentação e ela aparece na lista", async ({ page }) => {
    const falhas: string[] = [];
    page.on("response", (r) => { if (r.url().includes("/api/") && !r.url().includes("/api/sessions/active") && r.status() >= 500) falhas.push(`${r.status()} ${r.url()}`); });
    await login(page);
    await page.goto("/financeiro");
    await page.getByRole("button", { name: "Movimentações" }).click();
    await page.getByText("Nova Movimentação").first().click();
    const desc = `Movimentação E2E ${Date.now()}`;
    await page.getByPlaceholder("Ex: Consulta avaliação").fill(desc);
    await page.getByPlaceholder("0,00").fill("150");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText(desc).first()).toBeVisible();
    expect(falhas).toEqual([]);
  });
});
