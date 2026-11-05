# L7 — transição da mídia de paciente para acesso autenticado

Complementa o plano `docs/operacao/l7-midia-autenticada.md` (Otávio). Este arquivo descreve **o que o PR do L7 entrega** e **o que precisa ser feito na VPS** no deploy. Nada aqui foi aplicado em produção.

## O que muda no backend
- `/uploads/media/AAAA-MM/<uuid>.<ext>` deixa de ser servido por `express.static`. A rota nova só entrega com:
  - link assinado (`?exp=&sig=`, HMAC, 8 h para telas, `MEDIA_LINK_TTL_S`), ou
  - `Authorization: Bearer` de usuário da clínica dona do arquivo.
  Sem nenhum dos dois → 401; assinatura inválida/vencida → 403; arquivo de outra clínica ou sem dono → 404.
- Dono de cada arquivo em `media_files` (criada pelo boot). Arquivo novo é registrado ao ser salvo (chat, avatar, upload, áudio).
- Arquivos antigos: o boot roda **uma vez** `backfillMediaFiles()`: registra o dono a partir de `chat_messages.media_url`, `profiles.avatar_url`, `exames.arquivo_url` e `prontuarios.anexos`. Caminho citado por **duas clínicas** não é registrado (não é servido; lista para decisão humana — o log mostra a contagem). Se faltar algum, o primeiro acesso com sessão válida reivindica pelo mesmo critério (`reivindicarMidiaLegada`).
- Toda resposta JSON e todo evento SSE troca `/uploads/media/...` da clínica por link assinado. URL de outra clínica ou sem dono sai sem assinatura (não abre).
- `POST /api/media/sign { paths: [...] }`: links novos para quem tem sessão (link vencido ou URL antiga gravada). Front: `mediaApi.renovarLinks(paths)`.
- Evolution: áudio enviado por URL e `send-media` com `media.url` nosso recebem link assinado de **10 min** (`?e=evo`). Imagem/vídeo/documento já vão em base64/multipart.
- Cabeçalhos: `Cache-Control: private, max-age=300`, `nosniff`, `Referrer-Policy: no-referrer`; tipo fora da lista segura (imagem comum, áudio, vídeo, PDF) sai como `attachment` + `Content-Security-Policy: default-src 'none'; sandbox`.
- Rollback instantâneo: `MEDIA_AUTH_MODE=public` no `.env` + `pm2 restart odonto-api` volta a servir sem login (só emergência).

## nginx — bloco proposto (não aplicado)
Hoje o nginx faz proxy de `/uploads/media/` com `expires 30d` e `Cache-Control: public, immutable`. Isso precisa sair: link assinado com cache público fica guardado em proxy/CDN além do prazo, e a resposta passa a depender do usuário. Substituir o bloco atual por:

```nginx
# Mídia de paciente: a API decide o acesso (link assinado ou Bearer) e o cache (private).
location /uploads/media/ {
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
    access_log off;                        # a query tem a assinatura; não guardar em log
}

# Arquivos de exame nunca são servidos pelo nginx (só pela API, /api/exame-arquivos/...)
location /uploads/exames/ { return 404; }
```
Depois: `sudo nginx -t && sudo systemctl reload nginx`. Se houver Cloudflare na frente do backend, **purgar** `/uploads/*` e conferir que não há regra de cache para esse caminho. Navegadores que já baixaram com `immutable` mantêm a cópia local (não há como recolher).

## Ordem do deploy
1. **Backup** antes: `uploads/media` (hoje ~948 MB), `uploads/exames` e o banco (incluir `media_files`, `exame_arquivos` no dump).
2. Deploy do código (a pilha de exames antes ou junto). O boot cria `media_files` e roda o backfill; conferir no log a linha `[midia] backfill: N arquivo(s) com dono registrado; M citado(s) por mais de uma clínica`.
3. Aplicar o bloco do nginx acima e recarregar.
4. Teste manual: abrir conversa com imagem/áudio/PDF, foto de perfil, laudo com imagem; enviar áudio pelo chat (a Evolution baixa pelo link de 10 min); abrir a URL antiga direto no navegador sem login → 401.
5. Opcional, com backup: copiar os arquivos antigos de exame para o armazenamento protegido:
   ```bash
   cd /root/odonto-connect/vps-api-server
   node scripts/migrar-exames-legado.mjs            # simulação
   node scripts/migrar-exames-legado.mjs --aplicar  # copia para uploads/exames e registra em exame_arquivos
   ```
   O script **não apaga** o original; limpa só `exames.arquivo_url` (o caminho antigo fica na descrição do arquivo migrado). Anexos de prontuário em `uploads/media` continuam lá, cobertos pela rota autenticada.
6. Observar 24 h: 401/403/404 em `/uploads/media` no log da API.

## Remoção da cópia pública (manual, depois de conferir)
Só depois de o passo 5 rodar, os exames abrirem pelo laudo e houver backup. Não apagar: mover para fora do caminho servido e guardar por 30 dias.
```bash
# lista os originais já migrados (caminho está na descrição)
sudo -u postgres psql -p 5433 -d odonto_db -Atc \
  "SELECT substring(descricao from '/uploads/media/(.*)$') FROM exame_arquivos WHERE descricao LIKE 'Migrado do link antigo%'" > /root/migrados.txt
mkdir -p /root/odonto-connect/uploads/_migrados_publico
while read -r rel; do
  [ -f "/root/odonto-connect/uploads/media/$rel" ] && mkdir -p "/root/odonto-connect/uploads/_migrados_publico/$(dirname "$rel")" \
    && mv "/root/odonto-connect/uploads/media/$rel" "/root/odonto-connect/uploads/_migrados_publico/$rel"
done < /root/migrados.txt
```
Apagar `_migrados_publico` só com aprovação (prontuário: guarda de 20 anos — o arquivo protegido continua em `uploads/exames`).

## Pendências conhecidas
- Gravações clínicas: hoje **não são guardadas em disco** (`/api/ai/transcribe` só transcreve; `clinical_reports.audio_url` não é preenchido pelo backend). Nada a migrar.
- Tela de chat aberta por mais de 8 h: imagens antigas param de abrir até recarregar a conversa. A renovação automática (`mediaApi.renovarLinks` no `onError`) fica com o Davi, que está editando as telas de chat.
- Avatar guardado no `localStorage` com link assinado expira; o `/auth/me` do carregamento renova.
- Ordem de eventos SSE: evento com mídia é assinado antes de sair e pode chegar depois de um evento posterior sem mídia.
- Índice em `chat_messages.media_url` não foi criado (tabela grande; o backfill faz uma varredura só uma vez e a reivindicação é por arquivo). Avaliar com a Renata.
