// Arquivos ligados aos registros eliminados (parecer da Helena no #76: eliminar só a linha e deixar
// o exame no disco não é eliminação). Antes de apagar as linhas, a eliminação coleta as referências
// de arquivo das linhas que vão sair. Depois do COMMIT, apaga o que é arquivo local em uploads/media.
// O resto (mídia na Evolution/WhatsApp, links externos) vira "não alcançado", com a ação manual.
// Só contagens e hosts no registro, nunca nomes de arquivo.
import path from 'path';
import { unlink, stat } from 'fs/promises';
import { fileURLToPath } from 'url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = () => path.resolve(process.env.LGPD_UPLOADS_DIR || path.join(AQUI, '..', 'uploads', 'media'));

// Colunas com referência de arquivo, por tabela. JSONB (anexos) é percorrido atrás de strings.
export const COLUNAS_ARQUIVO = {
  exames: ['arquivo_url'],
  exame_arquivos: ['url', 'caminho', 'storage_path', 'arquivo_url'],
  chat_messages: ['media_url'],
  prontuarios: ['anexos'],
  clinical_reports: ['audio_url'],
};
// Onde mais um arquivo de uploads/media pode estar citado (de qualquer clínica). Antes do unlink,
// depois do COMMIT, o arquivo só sai se NENHUMA linha restante o citar: a mesma mídia pode estar em
// várias mensagens (campanha), em outro paciente, ou ter sido gravada por outra clínica com a URL de
// um arquivo alheio (POST /api/messages aceita fileUrl). Revisão do Igor no #76.
// ATENÇÃO (FORCE RLS): a verificação precisa enxergar TODAS as clínicas. Hoje a app é dona das
// tabelas e a RLS não se aplica; se um dia ligar FORCE, rodar esta checagem em contexto de sistema.
export const COLUNAS_REFERENCIA = [
  ...Object.entries(COLUNAS_ARQUIVO).flatMap(([t, cs]) => cs.map(c => [t, c])),
  ['profiles', 'avatar_url'],
  ['crm_leads', 'avatar_url'],
];

const likeEsc = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

// Devolve { citados: Set(abs), falhou: bool }. Tabela/coluna inexistente (42P01/42703) é ignorada;
// qualquer outro erro → falhou = true e nada é apagado (falha fechada).
export async function arquivosAindaCitados(db, absList) {
  const citados = new Set();
  if (!absList.length) return { citados, falhou: false };
  const base = uploadsDir();
  const rels = absList.map(a => path.relative(base, a).split(path.sep).join('/'));
  const padroes = rels.map(r => `%${likeEsc(r)}%`);
  for (const [t, c] of COLUNAS_REFERENCIA) {
    try {
      const { rows } = await db.query(
        `SELECT u.i::int AS i FROM unnest($1::text[]) WITH ORDINALITY AS u(pat, i)
          WHERE EXISTS (SELECT 1 FROM ${q(t)} x WHERE x.${q(c)}::text LIKE u.pat)`,
        [padroes]
      );
      for (const r of rows) citados.add(absList[Number(r.i) - 1]);
    } catch (e) {
      if (e?.code === '42P01' || e?.code === '42703') continue;
      return { citados, falhou: true };
    }
  }
  return { citados, falhou: false };
}

// Retenção dos backups (docs/operacao/backup.md: 7 diários + 4 semanais + 6 mensais).
export const BACKUP_RETENCAO_MESES = Number(process.env.BACKUP_RETENCAO_MESES || 6);

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

function strings(v, out = []) {
  if (v == null) return out;
  if (typeof v === 'string') { out.push(v); return out; }
  if (Array.isArray(v)) { for (const x of v) strings(x, out); return out; }
  if (typeof v === 'object') { for (const x of Object.values(v)) strings(x, out); }
  return out;
}

// Classifica uma referência: arquivo local em uploads/media (com caminho seguro), externo (host) ou ignorado.
export function classificar(ref) {
  const s = String(ref || '').trim();
  if (!s || s.startsWith('data:')) return null; // conteúdo inline: sai com a linha
  const marca = '/uploads/media/';
  let rel = null;
  if (s.includes(marca)) rel = s.slice(s.indexOf(marca) + marca.length);
  else if (!/^[a-z]+:\/\//i.test(s) && /^[\w./-]+\.[A-Za-z0-9]{2,5}$/.test(s)) rel = s; // caminho relativo gravado
  if (rel !== null) {
    rel = decodeURIComponent(rel.split(/[?#]/)[0]);
    const base = uploadsDir();
    const abs = path.resolve(base, rel);
    if (abs.startsWith(base + path.sep)) return { tipo: 'local', abs };
    return { tipo: 'externo', host: 'caminho fora de uploads' };
  }
  try { return { tipo: 'externo', host: new URL(s).host || 'desconhecido' }; } catch { return { tipo: 'externo', host: 'desconhecido' }; }
}

export function novoColetor() {
  const locais = new Set();
  const externos = {};
  return {
    locais, externos,
    // Lê as colunas de arquivo das linhas que vão sair (mesmo WHERE do DELETE/UPDATE).
    async coletar(db, alvo) {
      const cols = (COLUNAS_ARQUIVO[alvo.tabela] || []).filter(c => !alvo.cols || alvo.cols.has(c));
      if (!cols.length) return;
      const { rows } = await db.query(`SELECT ${cols.map(q).join(', ')} FROM ${q(alvo.tabela)} WHERE ${alvo.where}`, alvo.params);
      for (const r of rows) {
        for (const c of cols) {
          for (const ref of strings(r[c])) {
            const k = classificar(ref);
            if (!k) continue;
            if (k.tipo === 'local') locais.add(k.abs);
            else externos[k.host] = (externos[k.host] || 0) + 1;
          }
        }
      }
    },
    previa() {
      return { arquivos_locais: locais.size, nao_alcancados: { ...externos } };
    },
    // Depois do COMMIT. Arquivo que já não existe conta como apagado. Arquivo ainda citado por
    // outra linha (qualquer clínica) fica no disco. Sem db ou com erro na verificação, nada sai.
    async apagar(db) {
      let apagados = 0, falhas = 0, mantidos = 0;
      const lista = [...locais];
      const ver = db ? await arquivosAindaCitados(db, lista) : { citados: new Set(), falhou: true };
      if (ver.falhou) {
        return { arquivos_apagados: 0, falhas_ao_apagar: 0, arquivos_mantidos_em_uso: 0,
          arquivos_nao_verificados: lista.length,
          aviso_arquivos: 'Não foi possível conferir se os arquivos são usados por outro registro: nenhum foi apagado do disco. O registro no banco já foi eliminado; apagar os arquivos manualmente depois de conferir.',
          ...registroNaoAlcancados(externos) };
      }
      for (const abs of lista) {
        if (ver.citados.has(abs)) { mantidos++; continue; }
        try { await stat(abs); await unlink(abs); apagados++; } catch (e) { if (e?.code === 'ENOENT') apagados++; else falhas++; }
      }
      return { arquivos_apagados: apagados, falhas_ao_apagar: falhas, arquivos_mantidos_em_uso: mantidos, ...registroNaoAlcancados(externos) };
    },
  };
}

export function registroNaoAlcancados(externos) {
  const total = Object.values(externos).reduce((a, b) => a + b, 0);
  return total ? {
    nao_alcancados: { total, por_host: externos },
    acao_manual: 'Apagar estes arquivos no sistema onde estão (ex.: mídia no servidor da Evolution/WhatsApp ou link externo). O registro no banco já foi eliminado.',
  } : { nao_alcancados: { total: 0 } };
}

// Texto do registro sobre os backups (parecer da Helena no #76, item 2).
export function avisoBackups(executadoEm = new Date()) {
  const ate = new Date(executadoEm);
  ate.setMonth(ate.getMonth() + BACKUP_RETENCAO_MESES);
  return {
    previsto_ate: ate.toISOString(),
    texto: `Os dados eliminados saem das cópias de segurança na rotação normal dos backups (retenção de ${BACKUP_RETENCAO_MESES} meses), até ${ate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Até lá, as cópias ficam cifradas, com acesso restrito, e não são usadas para nada além de recuperação de desastre.`,
  };
}
