---
name: odonto-verificacao
description: Use when finishing, testing or reviewing any change in the Odonto Connect repo (frontend src/ or vps-api-server/) and you need to prove it works — build, tipos, lint, sintaxe do backend, testes jest, fluxo no navegador — or to separate erros novos de erros que já existiam em main.
---

# Verificação de mudança — Odonto Connect

**Regra:** nada é "pronto" sem a saída real do comando. Diga sempre o que **não** foi verificado.

## 1. Estático (sempre)
```bash
bash .claude/skills/odonto-verificacao/scripts/verificar.sh            # base main, com build
bash .claude/skills/odonto-verificacao/scripts/verificar.sh --sem-build  # rápido
bash .claude/skills/odonto-verificacao/scripts/verificar.sh --testes     # + jest (precisa Postgres)
```
O script pega só os arquivos alterados desde `main` (commits + não commitados), roda `tsc` e
mostra erros apenas desses arquivos, compara o lint de cada arquivo com a versão de `main`
(o repo já tem muitos erros antigos — ex.: `chat.tsx` tem ~30), faz `vite build` e `node --check`
nos `.mjs` do backend. Sai com código 1 se houver falha **nova**. Não usa `git stash` nem instala nada.

## 2. Backend
- `node --check` já roda no script. Testes: `cd vps-api-server && npm test` precisam de Postgres;
  sem banco, reporte "⚠️ não rodado" — não invente resultado. CI roda em PR que toca `vps-api-server/**`.
- Endpoint novo/alterado: rode também `node .claude/skills/odonto-isolamento-tenant/scripts/auditar-rotas.mjs --rota <trecho>`.

## 3. Navegador (fluxo afetado)
1. `preview_start` com a configuração `web` de `.claude/launch.json` (porta 5173).
2. Telas públicas (`/`, `/login`, `/signup`, `/termos`, `/privacidade`) abrem sem login. As demais
   exigem login e a API: use só credenciais de teste dadas pelo usuário; nunca de produção.
3. Verifique: resultado visível (`read_page`/`find`), console sem erro novo
   (`read_console_messages onlyErrors`), requisições com status esperado (`read_network_requests`).
4. Lembre: `vpsApiFetch` **não lança** — erro aparece como `{error}`; confira se a tela mostra o erro.
5. Pare o servidor ao terminar (`preview_stop`).

## 4. Nunca
Enviar WhatsApp real, rodar migração/deploy, chamar `backend.odontoconnect.tech` com escrita,
`git push` (push em `main` faz **deploy automático** pela `.github/workflows/deploy.yml`).

## Relatório
```
✅ Tipos  ✅ Lint (sem erro novo)  ✅ Build  ✅ node --check  ⚠️ jest não rodado (sem Postgres)
✅ Navegador: /termos renderiza; console limpo
❌ <bug>: passos · esperado × obtido · evidência · arquivo:linha provável
Não verificado: <lista>
```
