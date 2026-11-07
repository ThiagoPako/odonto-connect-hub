# L7 — transição da mídia de paciente para acesso autenticado

Complementa o plano L7 do Otávio (mídia e laudos só com autorização; o documento dele ainda não está no repositório). Este arquivo descreve **o que o PR do L7 entrega** e **o que precisa ser feito na VPS** no deploy. Nada aqui foi aplicado em produção.

## O que muda no backend
- `/uploads/media/AAAA-MM/<uuid>.<ext>` deixa de ser servido por `express.static`. A rota nova só entrega com:
  - link assinado (`?exp=&sig=`, HMAC; 1 h para telas por padrão, `MEDIA_LINK_TTL_S` com teto de 8 h), ou
  - `Authorization: Bearer` de usuário da clínica dona do arquivo.
  Sem nenhum dos dois → 401; assinatura inválida/vencida → 403; arquivo de outra clínica ou sem dono → 404.
- Dono de cada arquivo em `media_files` (criada pelo boot). Arquivo novo é registrado ao ser salvo (chat, avatar, upload, áudio).
- Arquivos antigos: o boot roda **uma vez** `backfillMediaFiles()` (em contexto de sistema): registra o dono a partir de `chat_messages.media_url`, `profiles.avatar_url`, `exames.arquivo_url` e `prontuarios.anexos`, e grava a data em `app_settings` (`l7_media_backfill`). Caminho citado por **duas clínicas** ou com citação **sem clínica** não é registrado: vai para `media_files_conflitos` (não é servido; tratamento manual abaixo).
- Reivindicação posterior (arquivo antigo que ficou sem dono) vem **desligada**. Para tratar sobras: `MEDIA_REIVINDICAR_LEGADO=1` + restart. Ligada, só dá posse se todas as citações forem da clínica do usuário, com clínica preenchida e **anteriores à data do backfill**; qualquer erro de leitura (fora tabela/coluna ausente) nega. Limite: 20 por requisição e 200 por usuário por hora; caminho que não existe em disco nem é consultado.
- Toda resposta JSON e todo evento SSE troca `/uploads/media/...` da clínica por link assinado. URL de outra clínica ou sem dono sai sem assinatura (não abre).
- `POST /api/media/sign { paths: [...] }`: links novos para quem tem sessão (link vencido ou URL antiga gravada). Front: `mediaApi.renovarLinks(paths)`.
- Evolution: áudio enviado por URL e `send-media` com `media.url` nosso recebem link assinado de **10 min** (`?e=evo`). Imagem/vídeo/documento já vão em base64/multipart.
- Tipo do arquivo gravado pelo **conteúdo** (não pelo que o cliente diz); desconhecido vira download.
- Cabeçalhos: `Cache-Control: private, max-age=300`, `Vary: Authorization`, `nosniff`, `Referrer-Policy: no-referrer`. Inline: `Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; sandbox` (PDF: só `default-src 'none'`, porque o Chrome bloqueia o visualizador com `sandbox` — **Caio confirmar no Chrome**). Tipo fora da lista segura sai como `attachment` + `default-src 'none'; sandbox`.
- Rollback instantâneo: `MEDIA_AUTH_MODE=public` no `.env` + `pm2 restart odonto-api` volta a servir sem login (só emergência).

## nginx — bloco proposto (não aplicado)
Fato de produção: só existe `location /uploads/media/` com proxy para a API, com `expires 30d` e `Cache-Control: public, immutable`; não há `location ~` de estáticos nem `alias` para `/uploads`. O cache público precisa sair (o link assinado ficaria guardado em proxy/CDN além do prazo, e a resposta passa a depender de quem pede). Proposta:

```nginx
# http { ... } — formato de log SEM a query string ($request_uri traria exp/sig)
log_format sem_query '$remote_addr - $remote_user [$time_local] "$request_method $uri $server_protocol" '
                     '$status $body_bytes_sent "$http_referer" "$http_user_agent"';

# server { ... } do backend
# Mídia de paciente: a API decide o acesso (link assinado ou Bearer) e o cache (private).
location ^~ /uploads/media/ {
    proxy_pass http://127.0.0.1:3002;      # mesma porta do bloco /api/ (API_PORT)
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Range $http_range;    # áudio/vídeo
    proxy_buffering off;
    proxy_cache off;
    expires off;                           # sem "expires 30d"
    # sem add_header Cache-Control: vale o "private, max-age=300" que a API manda
    access_log /var/log/nginx/uploads_media.log sem_query;
}

# Qualquer outro /uploads/... (exames, cópias antigas) nunca sai pelo nginx
location ^~ /uploads/ { return 404; }
```
`^~` faz estes prefixos ganharem de qualquer `location ~` que venha a ser criada. Depois: `sudo nginx -t && sudo systemctl reload nginx`. Se houver Cloudflare na frente do backend, **purgar** `/uploads/*` e conferir que não há regra de cache para esse caminho. Navegadores que já baixaram com `immutable` mantêm a cópia local (não há como recolher).

## Ordem do deploy
O nginx entra **na mesma janela e antes** do código (revisão do Igor, 07/11). Hoje o nginx força
`expires 30d` / `Cache-Control: public, immutable` em `/uploads/media/` e **sobrescreve** o
`private, max-age=300` da API: se o código entrar antes, as respostas autenticadas (Bearer) ficam
cacheáveis em proxy/CDN até o nginx ser trocado. Aplicar o bloco antes não quebra nada com o
código antigo (ele continua com proxy para a API; só some o cache público).

1. **Backup** antes: `uploads/media` (hoje ~948 MB), `uploads/exames` e o banco (incluir `media_files`, `exame_arquivos` no dump).
2. **nginx primeiro**, minutos antes do deploy: aplicar o bloco acima, `sudo nginx -t && sudo systemctl reload nginx`.
   Conferir: `curl -sI https://backend.odontoconnect.tech/uploads/media/<algum-arquivo>` **não** traz mais
   `immutable` nem `expires` de 30 dias.
3. Deploy do código **logo em seguida** (a pilha de exames #33 → #37 antes ou junto; o #88 no mesmo deploy). O boot cria
   `media_files`/`media_files_conflitos` e roda o backfill; conferir no log a linha
   `[midia] backfill: N arquivo(s) com dono registrado; M em conflito`.
4. **Purgar a CDN** (se houver Cloudflare na frente do backend): purge de `/uploads/*` logo após o deploy, e conferir
   que não há regra de cache para esse caminho. A API manda `Vary: Authorization` + `private`, mas cópia antiga
   `public, immutable` já guardada só sai com purge.
5. Teste manual: abrir conversa com imagem/áudio/PDF, foto de perfil, laudo com imagem; enviar áudio pelo chat (a Evolution baixa pelo link de 10 min); abrir a URL antiga direto no navegador sem login → 401; `curl -sI` com Bearer → `Cache-Control: private, max-age=300` e `Vary: Authorization`.
6. Opcional, com backup: copiar os arquivos antigos de exame para o armazenamento protegido:
   ```bash
   cd /root/odonto-connect/vps-api-server
   node scripts/migrar-exames-legado.mjs            # simulação
   node scripts/migrar-exames-legado.mjs --aplicar  # copia para uploads/exames e registra em exame_arquivos
   ```
   Só copia arquivo cujo dono em `media_files` é **a clínica do exame**. Pula e conta (no JSON final):
   `semDono` (sem dono registrado), `conflito` (em `media_files_conflitos` sem `resolvido_em`), `donoDiferente`
   e `erroDono` (falha ao ler o dono). O `PATCH` antigo de exames aceitava qualquer `arquivo_url`, então o exame
   citar o arquivo não prova que o arquivo é da clínica. Os pulados ficam como estão (o original continua coberto
   pela rota autenticada); resolver os conflitos (abaixo) e rodar de novo, se for o caso.
   O script **não apaga** o original; limpa só `exames.arquivo_url` (o caminho antigo fica na descrição do arquivo migrado). Anexos de prontuário em `uploads/media` continuam lá, cobertos pela rota autenticada.
7. Observar 24 h: 401/403/404 em `/uploads/media` no log da API.

Link assinado **não é revogável** antes de vencer (1 h padrão): não aumentar `MEDIA_LINK_TTL_S` sem necessidade.

## Conflitos (manual)
```sql
SELECT path, tenants, tem_sem_clinica, fontes FROM media_files_conflitos WHERE resolvido_em IS NULL;
-- decidido o dono (Igor/Helena), registrar e marcar:
INSERT INTO media_files (tenant_id, path, kind) VALUES ('<tenant>', '<path>', 'chat') ON CONFLICT (path) DO NOTHING;
UPDATE media_files_conflitos SET resolvido_em = NOW(), observacao = '<quem decidiu e por quê>' WHERE path = '<path>';
```

## Remoção da cópia pública (manual, depois de conferir)
Só depois de o passo 6 rodar, os exames abrirem pelo laudo e houver backup. Não apagar: mover para **fora de `uploads/`** e guardar por 30 dias.
```bash
# lista os originais já migrados (caminho está na descrição)
sudo -u postgres psql -p 5433 -d odonto_db -Atc \
  "SELECT substring(descricao from '/uploads/media/(.*)$') FROM exame_arquivos WHERE descricao LIKE 'Migrado do link antigo%'" > /root/migrados.txt
mkdir -p /root/odonto-connect-migrados-publico
while read -r rel; do
  [ -f "/root/odonto-connect/uploads/media/$rel" ] && mkdir -p "/root/odonto-connect-migrados-publico/$(dirname "$rel")" \
    && mv "/root/odonto-connect/uploads/media/$rel" "/root/odonto-connect-migrados-publico/$rel"
done < /root/migrados.txt
```
Apagar `/root/odonto-connect-migrados-publico` só com aprovação (prontuário: guarda de 20 anos — o arquivo protegido continua em `uploads/exames`).

## Pendências conhecidas
- Gravações clínicas: hoje **não são guardadas em disco** (`/api/ai/transcribe` só transcreve; `clinical_reports.audio_url` não é preenchido pelo backend). Nada a migrar.
- Link de tela vale 1 h: imagens antigas param de abrir até a tela renovar. Ligar `mediaApi.renovarLinks` (já em `src/lib/vpsApi.ts`) no `onError` de `<img>/<audio>` fica com o Davi, que está editando as telas de chat. Até lá, dá para subir `MEDIA_LINK_TTL_S` (teto 8 h).
- **Checklist do FORCE RLS:** `media_files`, `media_files_conflitos` e as rotas `/uploads/media/*` e `/api/exame-arquivos/*/conteudo` rodam **sem contexto de clínica** (link assinado). Antes de ligar FORCE/RLS nelas: a leitura do dono nessas rotas e a reivindicação/backfill precisam de contexto de sistema (o backfill e a reivindicação já usam; `servirMidia` ainda lê sem contexto) ou de política que permita SELECT por `path`.
- Avatar guardado no `localStorage` com link assinado expira; o `/auth/me` do carregamento renova.
- Ordem de eventos SSE: resolvida — `broadcastSSE` serializa os eventos por clínica (`tests/sse-ordem-midia.test.js`).
- Índice em `chat_messages.media_url` não foi criado (tabela grande; o backfill faz uma varredura só uma vez e a reivindicação é por arquivo). Avaliar com a Renata.
