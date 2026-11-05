import { expect, type Page } from "@playwright/test";

export const SENHA_TESTE = "Teste@123";
export const USUARIOS = {
  admin: "admin.alfa@teste.local",
  dentista: "dentista.alfa@teste.local",
  recepcionista: "recepcao.alfa@teste.local",
} as const;

export async function login(page: Page, email: string = USUARIOS.admin) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("input[type=password]").fill(SENHA_TESTE);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/dashboard/);
}
