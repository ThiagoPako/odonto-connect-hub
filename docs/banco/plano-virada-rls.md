# Plano de virada da RLS (auditoria C1) — para o Otávio

Autora: **Renata** (banco) · 2026-11-05 · Arquivos: `vps-api-server/migration-force-rls.sql`,
`docs/banco/diagnostico-rls.sql`, `docs/banco/inventario-tabelas.md`.

Nada disto foi rodado em produção. Ensaio completo num Postgres 16 local com dados fictícios
(base igual à de produção, dono `odonto_user`, 4.300 pacientes, 100 mil mensagens): sequência do
deploy + P0 + M0 + FORCE duas vezes sem erro, API subindo como `odonto_app` e isolando A de B,
rollback testado. Detalhes e números: relatório do ensaio (`ensaio-migracoes.md`, entregue
fora do git, com os scripts para repetir).

## Ordem obrigatória das migrações
1. `migration-seguranca-p0.sql` (PR #12): `tenant_id` + preenchimento nas 32 tabelas que as rotas novas filtram.
2. `migration-tenant-m0.sql` (este PR): complemento do P0 (outras tabelas, `tenant_settings`, índices e
   DEFAULT em todas, correção do Legado).
3. `migration-force-rls.sql` (este PR, **fora do deploy até a virada**): role, políticas, FORCE.
   **Aborta sozinha** se o P0 ou o M0 não tiverem rodado (lista as tabelas sem `tenant_id`).

## Resumo em 5 linhas
1. Hoje a API conecta como **dona** das tabelas, e as tabelas estão com `NO FORCE` → nenhuma política vale.
2. A migração de FORCE cria o role **`odonto_app`** (não é dono, sem `BYPASSRLS`), a política
   `rls_clinica_v1`, faz `FORCE` em toda tabela com `tenant_id` e dá os GRANTs.
3. Começa no **modo transição**: requisição com clínica só enxerga a própria clínica (+ registros antigos
   sem clínica). Login, webhook e boot (sem contexto) continuam como hoje. Jobs veem tudo.
4. A virada é: rodar a migração → definir a senha do `odonto_app` → trocar `PG_USER`/`PG_PASSWORD` no
   `.env` → rodar a migração de novo → `pm2 restart`. Fica fora do ar só o tempo do restart, igual a um deploy.
5. Voltar: `PG_USER` antigo + restart (1 minuto). Voltar 100%: `docs/banco/rollback-force-rls.sql` (testado).

## O que este PR faz sozinho ao entrar em main (deploy automático)
- Roda **`migration-tenant-m0.sql`** (já está no `deploy.yml`, depois de `migration-whatsapp-fase1.sql`):
  - cria `tenant_settings`, `password_reset_requests` e `consentimentos_pacientes`, com o mesmo dono das
    tabelas da API;
  - põe `tenant_id` nas tabelas da clínica que o P0 não cobre;
  - cria índice e DEFAULT em toda tabela que tem `tenant_id`;
  - preenche o NULL pela tabela-pai, só quando o pai é de uma única clínica;
  - **corrige o Legado**: a `migration-saas.sql` (já no deploy) põe em todo deploy os NULL de
    pacientes/dentistas/agendamentos/financeiro/tratamentos na clínica placeholder `…0001`, que o
    `server.mjs` trata como inválida. O M0 devolve a filha à clínica do pai quando o pai é de uma
    clínica real. No ensaio, voltaram 1.000 agendamentos, 3.000 tratamentos e 1.715 lançamentos;
  - lista o que ficou sem clínica ou no Legado (`NOTICE [M0 revisar]`).
  Não liga RLS e não muda o que a API lê.
- **Não** roda `migration-force-rls.sql`: ela não está no `deploy.yml` de propósito, porque muda o
  comportamento da produção. O Otávio inclui a linha dela na janela da virada (passo 2 abaixo).
- Entra a mudança no `forgot-password` (abaixo). A tabela que a rota usa passa a vir do M0.
- **Recomendado à parte:** tirar os `UPDATE ... SET tenant_id = '…0001' WHERE tenant_id IS NULL` da
  `migration-saas.sql`. Hoje eles mandam para o Legado, a cada deploy, todo registro novo sem clínica,
  inclusive o perfil do super-admin.

## Mudança no server.mjs (já feita nesta branch)
Só uma, e indispensável: a rota `POST /api/auth/forgot-password` rodava `CREATE TABLE IF NOT EXISTS
password_reset_requests` a cada pedido. No Postgres 15+ isso **falha para quem não é dono, mesmo com a
tabela já existindo** (`42501 permission denied for schema public`, testado). Removi o `CREATE` da rota;
a tabela agora vem da migração. Nada mais do `server.mjs` foi tocado (as rotas de pacientes são de outra frente).

## 0. Antes de tudo: diagnóstico (só leitura)
```bash
cd /root/odonto-connect && sudo -u postgres psql -p 5433 -d odonto_db -f docs/banco/diagnostico-rls.sql > /root/diag-antes-$(date +%F-%H%M).txt 2>&1
```
Confira no arquivo:
- **Seção 1:** versão. 15+ confirma o problema do `CREATE TABLE` acima.
- **Seção 2:** se o usuário atual da API (`odonto_user` ou o do `.env`) tem `rolsuper` ou `rolbypassrls`
  = true, é mais um motivo de a RLS não valer hoje. O `odonto_app` resolve os dois.
- **Seção 4:** dono de cada tabela; quais **não têm** `tenant_id` (confere com o inventário).
- **Seção 6:** registros sem clínica. Não bloqueiam a virada (modo transição), bloqueiam o modo estrito.
- **Seção 7:** se houver **view** ou função `SECURITY DEFINER`, me avise: elas rodam como o dono e podem
  furar a RLS.
- `/etc/postgresql/*/main/pg_hba.conf` (do cluster da porta 5433): se as linhas citam usuário por nome
  (ex.: `host odonto_db odonto_user 127.0.0.1/32 scram-sha-256`), é preciso uma linha igual para
  `odonto_app` e `systemctl reload postgresql`. Se for `all`, não precisa.

## 1. Ensaio numa cópia (obrigatório antes da produção)
Fazer **na própria VPS** (o dump tem dado de saúde: não copiar para notebook).
```bash
sudo -u postgres pg_dump -p 5433 -Fc odonto_db -f /root/backup-pre-rls-$(date +%F).dump
sudo -u postgres createdb -p 5433 odonto_db_ensaio
sudo -u postgres pg_restore -p 5433 -d odonto_db_ensaio --no-owner --role=<dono atual das tabelas> /root/backup-pre-rls-$(date +%F).dump
```
`--role=` com o dono que a seção 4 mostrou, para o ensaio ter os mesmos donos que a produção.
```bash
cd /root/odonto-connect && sudo -u postgres psql -p 5433 -d odonto_db_ensaio -f vps-api-server/migration-force-rls.sql
sudo -u postgres psql -p 5433 -d odonto_db_ensaio -f vps-api-server/migration-force-rls.sql
sudo -u postgres psql -p 5433 -d odonto_db_ensaio -c '\password odonto_app'
```
As duas execuções têm de terminar com `COMMIT` e sem `ERROR`. Leia os `NOTICE` `[sem clínica]` e
`[política antiga]`. O role é do cluster inteiro: a senha definida aqui já vale para a produção. Use a
senha definitiva e guarde no cofre.

**API de ensaio:** o `server.mjs` lê `vps-api-server/.env` com `override: true`, então variável na linha de
comando **não** vale. É preciso uma cópia da pasta com `.env` próprio. E o `EVOLUTION_API_URL` padrão é a
Evolution de **produção**: os jobs mandariam WhatsApp de verdade.
```bash
cp -r /root/odonto-connect /root/odonto-ensaio
cd /root/odonto-ensaio/vps-api-server
# no .env da cópia, mudar:
#   API_PORT=3099  PG_DATABASE=odonto_db_ensaio  PG_USER=odonto_app  PG_PASSWORD=<senha>
#   EVOLUTION_API_URL=http://127.0.0.1:9   EVOLUTION_API_KEY=   (endereço morto: nenhum WhatsApp sai)
#   apagar/zerar tokens do Clinicorp, Meta, OpenAI, VAPID
node server.mjs 2>&1 | tee /root/ensaio-rls.log
```
Testar com `curl` em `http://127.0.0.1:3099` ou por túnel SSH (`ssh -L 3099:127.0.0.1:3099`):
- [ ] `/api/health` ok; o log do boot mostra `Auto-migration warning ... must be owner` / `permission denied
      for schema public`. **Esperado**: o boot não tem mais permissão de DDL.
- [ ] Login de um usuário da clínica A e de um da clínica B; `/api/auth/me`.
- [ ] Com o token da clínica A: listar pacientes, agenda, financeiro, orçamentos, prontuário, chat.
      **Nada da clínica B pode aparecer.** Rotas que hoje vazam (C2: `/api/financeiro`, prontuários,
      `/api/generic/:table`, orçamentos, estoque, tratamentos) devem mostrar só A (e registros sem clínica).
- [ ] Criar paciente/agendamento com o token de A → no banco, `tenant_id` = A.
- [ ] Super-admin: painel de clínicas e planos funcionando.
- [ ] Esqueci a senha → `200`, linha nova em `password_reset_requests`.
- [ ] Webhook: `curl -X POST /api/webhook/evolution` com um payload de teste de uma instância de A → mensagem
      gravada com `tenant_id` de A.
- [ ] Jobs: deixar rodar 10 min; no log, **nenhum** `row-level security`, `invalid input syntax for type uuid`
      ou `permission denied for table`.
- [ ] Prova direta no banco, como `odonto_app`:
```sql
-- psql -h 127.0.0.1 -p 5433 -U odonto_app -d odonto_db_ensaio
BEGIN; SELECT set_config('app.tenant_id', '<uuid da clínica A>', true);
SELECT tenant_id, count(*) FROM pacientes GROUP BY 1;   -- só A (e NULL, se houver órfãos)
ROLLBACK;
SELECT current_user, current_setting('app.rls_modo', true);   -- odonto_app | transicao
```
Ao fim: parar o node, `rm -rf /root/odonto-ensaio`, `dropdb -p 5433 odonto_db_ensaio`.

## 2. Virada em produção
Janela de pouco movimento (ex.: 22h). Uma pessoa acompanhando o log.

1. **Backup:** `sudo -u postgres pg_dump -p 5433 -Fc odonto_db -f /root/backup-pre-rls-$(date +%F-%H%M).dump`.
2. **PR pequeno só com a linha nova no `deploy.yml`**, logo depois de `migration-tenant-m0.sql`. O PR do M0
   já tem que estar em main; o merge deste PR é o início da virada:
   ```
   cat /root/odonto-connect/vps-api-server/migration-force-rls.sql | sudo -u postgres psql -p 5433 -d odonto_db 2>&1 || true
   ```
   O deploy aplica a migração como `postgres` e reinicia a API **ainda com o usuário antigo**. Esse estado
   intermediário já protege a maioria das tabelas: o `FORCE` vale até para o dono. Ficam de fora as 13
   tabelas em que o boot do usuário antigo volta a pôr `NO FORCE` (pacientes, dentistas, agendamentos,
   financeiro, tratamentos, estoque, crm_leads, chat_messages, whatsapp_instances, profiles, user_roles,
   attendance_sessions, chat_read_status). Deixe rodar algumas horas e olhe o log (ver item 6).
   Se a migração falhar por `lock_timeout` (alguma consulta longa segurando a tabela), ela desfaz tudo e o
   deploy segue. Rode de novo à mão.
3. **Senha do `odonto_app`**, se não foi definida no ensaio: `sudo -u postgres psql -p 5433 -d odonto_db -c '\password odonto_app'`.
   Teste o login antes de mexer na API:
   `psql -h 127.0.0.1 -p 5433 -U odonto_app -d odonto_db -c "select current_user, current_setting('app.rls_modo', true)"`.
4. **Trocar o usuário:** em `/root/odonto-connect/vps-api-server/.env`, guardar as linhas antigas comentadas
   (para voltar rápido) e trocar:
   ```
   # PG_USER=odonto_user      (antigo)
   # PG_PASSWORD=...          (antigo)
   PG_USER=odonto_app
   PG_PASSWORD=<senha nova>
   ```
5. **Rodar a migração de novo e só então reiniciar** (é a mesma ordem do deploy):
   ```bash
   cd /root/odonto-connect && sudo -u postgres psql -p 5433 -d odonto_db -f vps-api-server/migration-force-rls.sql
   pm2 restart odonto-api --update-env
   ```
   Por que de novo: o último boot com o usuário antigo **recriou** a `tenant_isolation_policy` (a que faz
   `::uuid` em configuração vazia) e o `NO FORCE` nas 11 tabelas do `apply_tenant_rls`. Com o `odonto_app`,
   essa política daria erro em todo job e em toda consulta sem contexto. A migração remove de novo, e o
   `odonto_app` não consegue recriar.
6. **Conferir (primeiros 15 min):**
   ```bash
   curl -s http://127.0.0.1:3002/api/health
   pm2 logs odonto-api --lines 300 | grep -Ei "row-level security|invalid input syntax for type uuid|permission denied for table|permission denied for sequence"
   sudo -u postgres psql -p 5433 -d odonto_db -c "select usename, count(*) from pg_stat_activity where datname='odonto_db' group by 1"
   ```
   O `grep` tem de vir **vazio**. `must be owner` e `permission denied for schema public` no boot são esperados.
   Na `pg_stat_activity`, as conexões da API têm de ser do `odonto_app`.
   Teste manual: login nas duas clínicas de teste, chat (mandar e receber, número de teste), agenda, esqueci a senha.
7. Rodar o diagnóstico de novo (`diag-depois`) e guardar junto com o de antes.

## 3. Como voltar
- **Rápido (1 min), se algo quebrar:** no `.env`, voltar `PG_USER`/`PG_PASSWORD` antigos e
  `pm2 restart odonto-api --update-env`. A API volta a ser dona. **Atenção:** com o `FORCE`, o dono também
  passa pela política (modo transição). Então isso volta o "dono", mas não volta 100% ao comportamento de hoje.
  O boot desfaz o `FORCE` só nas 13 tabelas citadas.
- **Completo:** depois do rápido, `sudo -u postgres psql -p 5433 -d odonto_db -f docs/banco/rollback-force-rls.sql`.
  Ele tira o `FORCE` de todas as tabelas, apaga `rls_clinica_v1`/`rls_global_escrita_v1` e deixa o `odonto_app`
  sem login. No ensaio: 0,05 s, pode rodar duas vezes, e a API volta a funcionar como antes. Depois, **tirar a linha do `deploy.yml`**
  (senão o próximo deploy reaplica). Colunas `tenant_id` criadas e preenchidas podem ficar. Nenhum dado se perde.
- **Restaurar o backup** só em último caso (perde o que entrou depois).

## 4. Riscos e como estão tratados

### Jobs `asSystemJob`
- Rodam com `app.is_super_admin = 'true'` → **veem e gravam todas as clínicas**, com ou sem RLS. A RLS não
  protege contra bug de job. A regra continua: iterar por clínica e filtrar `tenant_id` na query.
- INSERT de job **sem** `tenant_id` explícito grava `NULL` (o DEFAULT lê a clínica do contexto, e no job não
  há). No modo transição esse registro aparece para todas as clínicas (como hoje). No estrito, para nenhuma.
  Antes do estrito: todo INSERT de job tem de gravar `tenant_id`.
- A política antiga com `::uuid` quebraria todos os jobs (ver passo 5). Testado: com a política antiga, a
  consulta do job dá `22P02 invalid input syntax for type uuid: ""`. Sem ela, funciona.
- Se um job chamar código que usa `setDbTenantContext` (hoje só `verifyUser` e o webhook usam), o contexto
  do job inteiro vira o de uma clínica. Não acontece hoje; vale para revisão de código.

### Contexto `app.tenant_id` que o `server.mjs` seta por requisição
- `pool.query` dentro de requisição autenticada abre `BEGIN`, aplica `set_config(..., true)` (local) e faz
  `COMMIT`. Está correto para RLS e não vaza entre requisições.
- Depois desse `COMMIT`, a configuração **não volta a NULL, volta a `''`** na conexão. Por isso as políticas
  usam `get_current_tenant_id()` (que trata `''` como NULL) e as antigas com `::uuid` foram removidas.
- `pool.connect` (transação manual) aplica na sessão e limpa no `release`. Se o código esquecer o `release`,
  a conexão fica presa (problema que já existe).
- **Usuário logado sem clínica e sem ser super-admin** não ativa contexto → cai no caminho "sem contexto" →
  no modo transição vê tudo (como hoje). A maioria das rotas já devolve 403 "Sem tenant". No estrito, não vê nada.
- **Super-admin** com `x-tenant-id` continua vendo todas as clínicas (`is_super_admin` vence).
- Trabalho disparado dentro da requisição (envio de WhatsApp, push para o Clinicorp depois da resposta)
  herda o contexto da clínica pelo AsyncLocalStorage. Está correto.

### DDL no boot
- Como `odonto_app`, todo `ALTER`/`CREATE` do bloco Auto-migration, do `ensureWhatsAppQueueSchema` e do
  `registerClinicorp` vira aviso. Os `UPDATE` de preenchimento continuam rodando.
- **Consequência:** a partir da virada, **coluna ou tabela nova só entra por `migration-*.sql` no
  `deploy.yml`** (roda como `postgres`). Alternativa futura: um pool de migração com `PG_MIGRATION_USER`
  (o dono) só para o boot. Recomendo, mas não é necessário para a virada.
- Scripts de manutenção (`run-full-backfill.mjs` etc.) com o usuário antigo agora passam pela RLS (`FORCE`).
  Para manutenção que atravessa clínicas, rode como `postgres`.

### Outros
- **Registros sem clínica** ficam visíveis a todas as clínicas no modo transição (como hoje). Lista: `NOTICE
  [sem clínica]` da migração e seção 6 do diagnóstico.
- **Locks:** `ALTER TABLE` precisa de lock exclusivo. A migração só altera quando precisa e usa
  `lock_timeout = 5s` (falha e desfaz em vez de travar a API). Em reexecução, quase só lê o catálogo.
- **Desempenho:** a política é avaliada em toda consulta. As funções vão em `(SELECT f())`, calculadas uma
  vez por consulta. Vale comparar o tempo de resposta do chat antes e depois.
- **Únicos globais:** `push_subscriptions.endpoint` e `agenda_marcadores.nome` são únicos para todas as
  clínicas. Se a mesma linha existir na outra clínica, o upsert passa a falhar com erro de RLS em vez de
  sobrescrever. É o comportamento certo, mas pode aparecer como erro 500.
- **Tabelas globais por engano** (`app_settings`, `ai_settings`, `clinica_config`, `system_settings`, overrides
  do Clinicorp) **não** são isoladas por esta migração. Uma clínica continua mudando a configuração de todas
  (achados A1/A2). Precisa de mudança de código.

## 5. Modo estrito (depois, não nesta virada)
Pré-requisitos, nesta ordem:
1. Zero registros sem clínica (seção 6 do diagnóstico): atribuir com regra clara, ou apagar com aprovação.
   Depois, `SET NOT NULL` em `tenant_id`, numa migração separada.
2. Rotas sem contexto rodando com contexto explícito no `server.mjs`: login/cadastro/esqueci a senha
   (`profiles`, `tenants`, `user_roles`, `plans`), resolução de clínica do webhook da Evolution
   (`whatsapp_instances`, `crm_leads` por telefone), webhook do Clinicorp (`clinicorp_user_settings`),
   `/api/events`, `/api/plans`, `/api/push/unsubscribe`, `/api/sessions/first-response`, `/api/assinaturas/:id`.
3. INSERT de `password_reset_requests` e dos jobs gravando `tenant_id`.
4. Globais por engano convertidas para por clínica (A1/A2).
5. Ensaio igual ao da seção 1 com `ALTER ROLE odonto_app IN DATABASE odonto_db_ensaio SET app.rls_modo = 'estrito'`.
Ligar: `ALTER ROLE odonto_app IN DATABASE odonto_db SET app.rls_modo = 'estrito';` + `pm2 restart odonto-api`.
Voltar: o mesmo comando com `'transicao'` + restart. A migração não sobrescreve o modo já definido.
