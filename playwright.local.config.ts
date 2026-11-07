// Config dos testes e2e contra o AMBIENTE LOCAL (docs/operacao/ambiente-local.md).
// Pré-requisito: backend em :3002 e `npx vite dev -c vite.local.config.ts --port 5173` (launch.json: web-local),
// com banco odonto_local semeado (vps-api-server/seed-local.sql). Nunca aponte para produção.
// (O playwright.config.ts original importa o pacote "lovable-agent-playwright-config", que não está no package.json.)
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 45_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL || "http://localhost:5173", trace: "retain-on-failure", viewport: { width: 1366, height: 800 } },
});
