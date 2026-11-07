#!/usr/bin/env node
// L7 — copia os arquivos antigos de exame (exames.arquivo_url → /uploads/media/...) para o
// armazenamento protegido (uploads/exames/<clínica>/ + exame_arquivos).
//
// NÃO APAGA NADA: o arquivo original continua em uploads/media (remoção da cópia pública é
// passo manual, ver docs/operacao/l7-transicao-midia.md). O link antigo sai de exames.arquivo_url
// só com --aplicar, e fica anotado na descrição do arquivo migrado.
//
// Uso (na VPS, com backup feito antes):
//   cd /root/odonto-connect/vps-api-server
//   node scripts/migrar-exames-legado.mjs            # simulação: só lista o que faria
//   node scripts/migrar-exames-legado.mjs --aplicar  # copia e registra
// Lê PG_* do .env. Nenhum dado de paciente é impresso (só ids e contagens).
//
// Regra de dono (revisão do Igor, 07/11): só copia se media_files diz que o arquivo é da MESMA
// clínica do exame. Sem dono registrado, em media_files_conflitos (não resolvido) ou com erro
// na leitura do dono → pula e conta. O PATCH antigo de exames aceitava qualquer arquivo_url, então
// "o exame cita o arquivo" não prova que o arquivo é da clínica do exame.
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { copyFile, mkdir, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const APLICAR = process.argv.includes('--aplicar');
const RAIZ = path.join(__dirname, '..', '..', 'uploads');
const MEDIA = path.join(RAIZ, 'media');
const EXAMES = path.join(RAIZ, 'exames');
const REL_RE = /\/uploads\/media\/(\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{1,10})(?:\?.*)?$/i;

function tipoPeloConteudo(buf) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg' };
  if (hex.startsWith('89504e470d0a1a0a')) return { mime: 'image/png', ext: 'png' };
  if (hex.startsWith('47494638')) return { mime: 'image/gif', ext: 'gif' };
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (hex.startsWith('424d')) return { mime: 'image/bmp', ext: 'bmp' };
  if (hex.startsWith('25504446')) return { mime: 'application/pdf', ext: 'pdf' };
  if (hex.startsWith('504b0304')) return { mime: 'application/zip', ext: 'zip' };
  if (buf.length >= 132 && buf.subarray(128, 132).toString('latin1') === 'DICM') return { mime: 'application/dicom', ext: 'dcm' };
  return null;
}

// 'ok' só quando media_files registra a clínica do exame como dona do arquivo.
export async function situacaoDoArquivo(db, rel, tenantId) {
  try {
    const conflito = await db.query(
      'SELECT 1 FROM media_files_conflitos WHERE path = $1 AND resolvido_em IS NULL', [rel]
    );
    if (conflito.rows.length) return 'conflito';
    const dono = await db.query('SELECT tenant_id FROM media_files WHERE path = $1', [rel]);
    if (!dono.rows[0]) return 'semDono';
    return String(dono.rows[0].tenant_id) === String(tenantId) ? 'ok' : 'donoDiferente';
  } catch {
    return 'erroDono';
  }
}

async function main() {
  const pool = new pg.Pool({
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    database: process.env.PG_DATABASE || 'odonto_db',
    user: process.env.PG_USER || 'odonto_user',
    password: process.env.PG_PASSWORD,
  });

  const resumo = { candidatos: 0, migrados: 0, semArquivo: 0, formatoRecusado: 0, donoDiferente: 0, semDono: 0, conflito: 0, erroDono: 0, erros: 0 };

  try {
    const { rows } = await pool.query(
      `SELECT id, tenant_id, paciente_id, arquivo_url FROM exames
        WHERE arquivo_url LIKE '%/uploads/media/%' AND tenant_id IS NOT NULL ORDER BY created_at`
    );
    for (const ex of rows) {
      const m = REL_RE.exec(ex.arquivo_url || '');
      if (!m) continue;
      resumo.candidatos++;
      const rel = m[1];
      const origem = path.join(MEDIA, rel);
      if (!existsSync(origem)) { resumo.semArquivo++; console.log(`sem arquivo no disco: exame ${ex.id}`); continue; }
      const situacao = await situacaoDoArquivo(pool, rel.toLowerCase(), ex.tenant_id);
      if (situacao !== 'ok') {
        resumo[situacao]++; console.log(`pulado (${situacao}): exame ${ex.id}`); continue;
      }
      const buf = await readFile(origem);
      const tipo = tipoPeloConteudo(buf);
      if (!tipo) { resumo.formatoRecusado++; console.log(`formato não aceito, pulado: exame ${ex.id}`); continue; }
      if (!APLICAR) { console.log(`migraria: exame ${ex.id} (${tipo.ext}, ${buf.length} bytes)`); continue; }

      const id = randomUUID();
      const caminho = `${ex.tenant_id}/${id}.${tipo.ext}`;
      const destino = path.join(EXAMES, caminho);
      await mkdir(path.dirname(destino), { recursive: true });
      await copyFile(origem, destino);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO exame_arquivos (id, tenant_id, exame_id, paciente_id, caminho, nome_original, mime_type, tamanho_bytes, descricao)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, ex.tenant_id, ex.id, ex.paciente_id, caminho, `arquivo-anterior.${tipo.ext}`, tipo.mime, buf.length,
           `Migrado do link antigo /uploads/media/${rel}`]
        );
        await client.query('UPDATE exames SET arquivo_url = NULL WHERE id = $1 AND tenant_id = $2 AND arquivo_url = $3',
          [ex.id, ex.tenant_id, ex.arquivo_url]);
        await client.query('COMMIT');
        resumo.migrados++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        await rm(destino, { force: true }).catch(() => {}); // só a cópia nova; o original fica
        resumo.erros++;
        console.error(`erro no exame ${ex.id}: ${err.message}`);
      } finally {
        client.release();
      }
    }
    // Anexos de prontuário em /uploads/media: não há armazenamento protegido próprio; ficam
    // cobertos pela rota autenticada do L7. Só a contagem, para conferência.
    const pront = await pool.query(
      `SELECT count(*)::int AS n FROM prontuarios WHERE anexos::text LIKE '%/uploads/media/%'`
    ).catch(() => ({ rows: [{ n: 'tabela ausente' }] }));
    console.log(JSON.stringify({ modo: APLICAR ? 'aplicado' : 'simulação', ...resumo, prontuariosComAnexoEmMedia: pront.rows[0].n }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
