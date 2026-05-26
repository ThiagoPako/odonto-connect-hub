# Plano: migrar app da VPS para Supabase (Lovable Cloud)

## Situação atual
- **62 arquivos** importam `@/lib/vpsApi` (rotas, componentes, hooks).
- Dados já estão no Supabase (tabelas com `tenant_id` e RLS por `current_tenant_id()`).
- Auth atual é custom (token JWT da VPS guardado em localStorage) — incompatível com RLS do Supabase, que exige `auth.uid()`.
- Trigger `handle_new_user` já cria `profile` + `tenant` + `user_roles` automaticamente no signup.

## Bloqueio crítico
Sem trocar a autenticação para **Supabase Auth**, nenhuma query do frontend respeita RLS — todas voltarão vazias. Auth é o passo zero, obrigatório.

## Estratégia (fases incrementais, cada uma testável)

### Fase 0 — Autenticação Supabase (base de tudo)
- Reescrever `useAuth.tsx` para usar `supabase.auth` (email/senha + Google).
- Atualizar `login.tsx` e `signup.tsx`.
- Criar/ajustar rota `/reset-password`.
- Habilitar Google em `configure_social_auth`.
- Mapear `user.tenant_id` lendo da tabela `profiles`.
- Sem isso nada mais funciona — então paramos aqui e validamos o login antes de seguir.

### Fase 1 — Leitura por módulo (telas que só listam dados)
Para cada módulo, troco `xxxApi.list()` por `supabase.from("tabela").select(...)`. Ordem por importância clínica:
1. **Pacientes** + **Dentistas** (núcleo)
2. **Agenda** (+ realtime via Supabase channels)
3. **Orçamentos / Tratamentos / Procedimentos**
4. **CRM / Leads**
5. **Financeiro** (fin_bank_accounts, fin_bills, fin_movements, fin_payrolls, fin_employees, fin_overdue)
6. **Exames / Prontuário / Relatórios Clínicos**
7. **Estoque / Comissões**
8. **Chat / Contatos / Disparos / Campanhas**
9. **Configurações / Equipe / Usuários / Painéis**

### Fase 2 — Mutações (criar/editar/deletar) em cada módulo
Mesma ordem. Cada CRUD precisa preencher `tenant_id = current_tenant_id()`.

### Fase 3 — Realtime
Substituir SSE da VPS (`/events`) por `supabase.channel().on("postgres_changes")` nas tabelas `agendamentos`, `chat_messages`, `crm_leads`.

### Fase 4 — Limpeza
- Apagar `src/lib/vpsApi.ts` e arquivos `*.mjs` em `vps-api-server/` que não forem mais usados.
- Remover variáveis VPS do `.env`.

## O que **NÃO** está neste plano
- Migração de dados do VPS pro Supabase (você disse que já subiu).
- Webhooks externos (Evolution/WhatsApp/Meta Ads/Clinicorp) — esses continuam onde estão; vou só apontar o frontend pras tabelas Supabase que já recebem os dados.
- Refatorar UI/design (mantém tudo igual visualmente).

## Detalhes técnicos
- Cliente: `@/integrations/supabase/client` (browser, respeita RLS).
- Não vou usar `createServerFn` por enquanto — overhead desnecessário; queries diretas do browser com RLS bastam.
- Hooks atuais que dependem de `getToken()` (ex.: `useRealtimeChat`) serão reescritos.
- Tipos: usar `@/integrations/supabase/types` (auto-gerado).
- Tabela `meta_ads_accounts` agora restrita a admin — UI continua funcionando, mas leitura/escrita exige role admin no tenant.

## Como vou executar
**Não vou fazer tudo em uma resposta** (seriam 60+ arquivos editados de uma vez, alto risco de quebrar). Proposta:

1. **Agora (1ª entrega)**: Fase 0 completa — você loga com Supabase Auth.
2. **Depois você me diz "ok, segue"** e eu entrego Fase 1 + 2 do módulo Pacientes+Dentistas+Agenda.
3. Repetimos até cobrir tudo.

Cada fatia: 1 mensagem, testável, sem deixar o app quebrado entre passos.

## Decisão que preciso de você antes de começar
- **Usuários existentes na VPS** — vão precisar se cadastrar de novo no Supabase Auth (senhas da VPS não migram, são hashes diferentes). Confirma que tudo bem? Ou prefere que eu prepare um fluxo "redefinir senha no primeiro acesso" via e-mail?
