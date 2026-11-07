-- Matriz de papéis (PR #86): o papel 'user' deixa de acessar paciente, anamnese, orçamento, exame
-- e catálogo. Não há clínica real em produção (07/11/2026, decisão do dono), então quem tem só
-- 'user' vira 'recepcionista' (papel padrão novo na tela e no backend). Super-admin fica como está.
-- Também grava a clínica nas linhas antigas de user_roles (tenant_id NULL → clínica do perfil),
-- para o papelAtual (papeis.mjs) poder ignorar papel de outra clínica.
-- Idempotente: rodar de novo não muda nada. Só de deploy (deploy.yml), como postgres.
-- Rollback: não há como saber quem era 'user' depois; se precisar, UPDATE manual por id.
\set ON_ERROR_STOP on

BEGIN;

-- user_roles: grava a clínica do perfil nas linhas sem clínica.
UPDATE user_roles ur
   SET tenant_id = p.tenant_id
  FROM profiles p
 WHERE ur.user_id = p.id AND ur.tenant_id IS NULL AND p.tenant_id IS NOT NULL;

-- user_roles: 'user' → 'recepcionista' (UNIQUE (user_id, role): se já existe a linha de
-- recepcionista, só apaga a de 'user').
DELETE FROM user_roles ur
 USING profiles p
 WHERE ur.user_id = p.id AND ur.role::text = 'user' AND COALESCE(p.is_super_admin, false) = false
   AND EXISTS (SELECT 1 FROM user_roles r2 WHERE r2.user_id = ur.user_id AND r2.role::text = 'recepcionista');
UPDATE user_roles ur
   SET role = 'recepcionista'
  FROM profiles p
 WHERE ur.user_id = p.id AND ur.role::text = 'user' AND COALESCE(p.is_super_admin, false) = false;

-- profiles.role (fallback do papelAtual e o que a tela mostra).
UPDATE profiles
   SET role = 'recepcionista', updated_at = NOW()
 WHERE role::text = 'user' AND COALESCE(is_super_admin, false) = false;

COMMIT;
