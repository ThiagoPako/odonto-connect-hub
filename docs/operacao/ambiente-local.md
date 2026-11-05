# Ambiente local de testes (banco fictício + e2e)

Nunca aponte para produção. Todos os dados são fictícios (clínicas Alfa e Beta); senha de todos os usuários de teste: `Teste@123`.

## Pré-requisitos
- Postgres 16 local: `brew install postgresql@16 && brew services start postgresql@16`
- Dependências: `bun install` na raiz e em `vps-api-server/`
- **`cd vps-api-server && npm rebuild bcrypt`** — o `bun install` não roda o postinstall do bcrypt; sem isso o servidor não sobe e o seed falha (`crm_leads.tenant_id` inexistente).
- **Não pode existir `vps-api-server/.env`.** O `server.mjs` o carrega com `override: true` e sobrescreveria o banco/Evolution locais (podendo ligar em produção). O `setup-local.sh` aborta se ele existir.
- Navegador do Playwright: `npx playwright install chromium`

## Passo a passo
1. Banco: `bash vps-api-server/setup-local.sh --recriar` (outro banco: `ODONTO_LOCAL_DB=meu_banco`).
2. Backend (porta livre, ex. 3012), sem WhatsApp real:
   `cd vps-api-server && PG_DATABASE=odonto_local PG_USER=odonto_user PG_PASSWORD=local_test_pw PG_HOST=localhost JWT_SECRET=local-e2e API_PORT=3012 EVOLUTION_API_URL=http://127.0.0.1:9 node server.mjs`
3. Frontend: `E2E_API_URL=http://localhost:3012 npx vite dev -c vite.local.config.ts --port 5173 --strictPort` (sem `E2E_API_URL`, o proxy usa `http://localhost:3002`).
4. Testes: `npx playwright test -c playwright.local.config.ts`
