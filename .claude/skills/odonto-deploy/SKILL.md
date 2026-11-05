---
name: odonto-deploy
description: Use when preparing, reviewing or troubleshooting a deploy of Odonto Connect to production — merge/push to main, .github/workflows/deploy.yml, PM2 (ecosystem.config.cjs), variáveis de ambiente (.env da VPS), migrações no deploy, healthcheck /api/health, rollback, backups, or "o que acontece quando eu der merge?".
---

# Deploy e produção — Odonto Connect

## O que acontece num merge/push em `main`
`.github/workflows/deploy.yml` entra por SSH na VPS (`/root/odonto-connect`) e, **sozinho**:
1. guarda o commit atual (alvo de rollback) e faz `git reset --hard origin/main`;
2. instala dependências e `npm run build` (frontend);
3. garante no `.env` da VPS o segredo do webhook (`EVOLUTION_WEBHOOK_SECRET`) e `TZ=America/Sao_Paulo`;
4. roda a lista fixa de `migration-*.sql` (`psql -p 5433 -d odonto_db … || true` — erro **não** para);
5. `node --check server.mjs`, depois `pm2 delete` + `pm2 start ecosystem.config.cjs --update-env`;
6. espera `GET http://127.0.0.1:3002/api/health` = 200 (até 30 s); se falhar, **rollback automático**
   para o commit anterior.
O Lovable também pode publicar a partir de `main`. Consequência: **merge em `main` = produção**.

## Processos (PM2)
- `odonto-connect`: frontend, `npm run preview` em 127.0.0.1:3000.
- `odonto-api`: `vps-api-server/server.mjs` (porta 3002), `TZ=America/Sao_Paulo`.
- Jobs rodam em `setInterval` dentro do `odonto-api`: restart interrompe e retoma; `setTimeout`
  longo se perde.

## Checklist antes de aprovar um merge
- [ ] Verificação verde (`odonto-verificacao`) e revisão (Beatriz; Igor se tocar tenant/login/paciente).
- [ ] Migração nova idempotente **e** incluída na lista do `deploy.yml` (ou no auto-migration do boot).
- [ ] Código tolera a coluna/tabela nova ainda não existir nos primeiros segundos do boot.
- [ ] Variável de ambiente nova: documentada em `.env.example`; criada na VPS **antes** do merge
      (ou gerada pelo `deploy.yml`). Nunca segredo em arquivo versionado.
- [ ] Mudança em envio de WhatsApp: jobs pendentes na fila continuam válidos com o código novo?
- [ ] Plano de volta: o rollback automático só reverte código — migração aplicada **fica**.

## Depois do deploy (comandos para o usuário rodar; agentes não acessam a VPS)
```bash
curl -s https://backend.odontoconnect.tech/api/health
```
```bash
ssh <vps> 'pm2 status && pm2 logs odonto-api --lines 50 --nostream'
```

## Regras
Agentes não fazem merge, push, deploy, SSH nem migração em produção. Entregam o checklist e os
comandos explicados; o usuário executa.
