// e2e do WhatsApp com Evolution SIMULADA (e2e/fake-evolution.mjs) e backend em modo de teste (e2e/api-teste.mjs).
// Pré-requisito: banco local semeado (docs/operacao/ambiente-local.md), sem vps-api-server/.env.
//   E2E_WA_DB=odonto_local npx playwright test -c playwright.whatsapp.config.ts
// Nada aqui fala com a Evolution real nem com produção: api-teste.mjs recusa banco/Evolution não locais.
import { defineConfig } from "@playwright/test";

const DB = process.env.E2E_WA_DB || "odonto_local";
const API_PORT = process.env.E2E_WA_API_PORT || "3071";
const CTRL_PORT = process.env.E2E_WA_CONTROL_PORT || "3072";
const FAKE_PORT = process.env.E2E_WA_FAKE_PORT || "4010";
const SEGREDO = "local-webhook-secret";
const CHAVE = "fake-evolution-key";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /whatsapp\.spec\.ts/,
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  webServer: [
    {
      command: `node e2e/fake-evolution.mjs --port ${FAKE_PORT} --api http://127.0.0.1:${API_PORT} --secret ${SEGREDO} --key ${CHAVE}`,
      url: `http://127.0.0.1:${FAKE_PORT}/__health`,
      reuseExistingServer: false,
    },
    {
      command: "node e2e/api-teste.mjs",
      url: `http://127.0.0.1:${CTRL_PORT}/__health`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        PG_HOST: "localhost", PG_DATABASE: DB, PG_USER: "odonto_user", PG_PASSWORD: "local_test_pw",
        JWT_SECRET: "local-e2e-wa", API_PORT, E2E_CONTROL_PORT: CTRL_PORT,
        EVOLUTION_API_URL: `http://127.0.0.1:${FAKE_PORT}`, EVOLUTION_API_KEY: CHAVE, EVOLUTION_WEBHOOK_SECRET: SEGREDO,
      },
    },
  ],
  use: { extraHTTPHeaders: {} },
});
