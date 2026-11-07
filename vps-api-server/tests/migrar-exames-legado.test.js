// L7 — script de migração dos arquivos antigos de exame: só copia arquivo cujo dono em
// media_files é a clínica do exame (revisão do Igor, 07/11). Sem banco: db.query falso.
import { situacaoDoArquivo } from '../scripts/migrar-exames-legado.mjs';

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const rel = '2024-03/aaaaaaaa-0000-4000-8000-00000000000a.jpg';

function dbFalso({ dono = null, conflito = false, falha = null } = {}) {
  const consultas = [];
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql: String(sql), params });
      if (falha && falha.test(String(sql))) throw new Error('relation does not exist');
      if (/FROM media_files_conflitos/.test(sql)) return { rows: conflito ? [{ '?column?': 1 }] : [] };
      if (/FROM media_files WHERE path/.test(sql)) return { rows: dono ? [{ tenant_id: dono }] : [] };
      throw new Error(`consulta inesperada: ${sql}`);
    },
  };
}

describe('migrar-exames-legado — dono do arquivo', () => {
  test('dono = clínica do exame → ok', async () => {
    expect(await situacaoDoArquivo(dbFalso({ dono: tenantA }), rel, tenantA)).toBe('ok');
  });

  test('arquivo SEM dono registrado não é copiado (antes era)', async () => {
    expect(await situacaoDoArquivo(dbFalso(), rel, tenantA)).toBe('semDono');
  });

  test('dono é outra clínica → pula', async () => {
    expect(await situacaoDoArquivo(dbFalso({ dono: tenantB }), rel, tenantA)).toBe('donoDiferente');
  });

  test('caminho em media_files_conflitos não resolvido → pula, mesmo com dono igual', async () => {
    const db = dbFalso({ dono: tenantA, conflito: true });
    expect(await situacaoDoArquivo(db, rel, tenantA)).toBe('conflito');
    expect(db.consultas[0].sql).toMatch(/resolvido_em IS NULL/);
    expect(db.consultas[0].params).toEqual([rel]);
  });

  test('erro ao ler o dono ou os conflitos → pula (falha fechada)', async () => {
    expect(await situacaoDoArquivo(dbFalso({ dono: tenantA, falha: /media_files_conflitos/ }), rel, tenantA)).toBe('erroDono');
    expect(await situacaoDoArquivo(dbFalso({ dono: tenantA, falha: /FROM media_files WHERE/ }), rel, tenantA)).toBe('erroDono');
  });

  test('importar o módulo não roda a migração', async () => {
    // Se main() rodasse no import, abriria conexão com o banco e imprimiria o resumo.
    const mod = await import('../scripts/migrar-exames-legado.mjs');
    expect(Object.keys(mod)).toEqual(['situacaoDoArquivo']);
  });
});
