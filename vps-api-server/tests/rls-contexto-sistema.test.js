// Políticas com is_super_admin() leem app.jwt_payload; o contexto de sistema/super-admin
// precisa gravá-lo junto com app.is_super_admin, senão tenants/plans/fin_* ficam invisíveis.
import fs from 'fs';

const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

describe('contexto de RLS do pool', () => {
  const m = src.match(/const TENANT_SET_SQL = `([\s\S]*?)`;/);

  test('TENANT_SET_SQL grava app.jwt_payload só para super-admin/sistema', () => {
    expect(m).not.toBeNull();
    const sql = m[1];
    expect(sql).toContain("set_config('app.is_super_admin', $2, $3)");
    expect(sql).toMatch(/set_config\('app\.jwt_payload', CASE WHEN \$2 = 'true' THEN '\{"is_super_admin":true\}' ELSE '' END, \$3\)/);
  });

  test('a limpeza do contexto zera o payload (is_super_admin = false)', () => {
    expect(src).toContain("client.query(TENANT_SET_SQL, ['', 'false', false])");
  });

  test('cópia das configurações globais usa marcador v2', () => {
    expect(src).toContain('tenant_settings_copia_v2_${key}');
  });
});
