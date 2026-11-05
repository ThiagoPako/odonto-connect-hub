#!/usr/bin/env node
// Triagem heurística de isolamento entre clínicas nas rotas do backend.
// Uso: node .claude/skills/odonto-isolamento-tenant/scripts/auditar-rotas.mjs [--todas] [--contexto] [--rota /api/x] [arquivo]
// Não prova nada sozinho: cada alerta precisa ser confirmado lendo o handler.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const todas = args.includes('--todas');
const contexto = args.includes('--contexto');
const rotaIdx = args.indexOf('--rota');
const filtroRota = rotaIdx >= 0 ? args[rotaIdx + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--rota') || 'vps-api-server/server.mjs';
const lines = readFileSync(file, 'utf8').split('\n');

// Tabelas globais (sem tenant por natureza) — não exigem filtro.
const GLOBAL = new Set(['plans', 'system_settings', 'tenants', 'information_schema', 'pg_catalog', 'user_roles', 'password_reset_requests']);
const routeRe = /^app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/;

const routes = [];
lines.forEach((l, i) => { const m = l.match(routeRe); if (m) routes.push({ line: i + 1, method: m[1].toUpperCase(), path: m[2] }); });
routes.forEach((r, k) => {
  const end = k + 1 < routes.length ? routes[k + 1].line - 1 : Math.min(lines.length, r.line + 400);
  r.body = lines.slice(r.line - 1, end).join('\n');
});

// Guarda global: app.use('/api/whatsapp', ...) que chama userOwnsInstance cobre as rotas /api/whatsapp/*.
let guardaWhatsapp = false;
lines.forEach((l, i) => {
  if (/^app\.use\(\s*['"`]\/api\/whatsapp['"`]/.test(l) && /userOwnsInstance\(/.test(lines.slice(i, i + 60).join('\n'))) guardaWhatsapp = true;
});

const out = [];
for (const r of routes) {
  if (filtroRota && !r.path.includes(filtroRota)) continue;
  const b = r.body;
  const flags = [];
  const auth = /verifyUser\(|verifyAdmin\(|verifySuperAdmin\(|requireSuperAdmin|clinicorpUserOf\(/.test(b);
  const webhookToken = /webhook/i.test(r.path) && /(token|secret|signature|user_api)/i.test(b);
  const publico = /^\/api\/(health|auth\/(login|signup|refresh|forgot|reset)|public)/.test(r.path);
  if (!auth && !webhookToken && !publico) flags.push('SEM-AUTH');

  const tables = new Set();
  // SQL do projeto é escrito em MAIÚSCULAS: casar só palavras-chave em caixa alta evita falso positivo em comentários.
  for (const m of b.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/g)) {
    const t = m[1].toLowerCase();
    if (!GLOBAL.has(t) && !['select', 'set', 'values', 'lateral'].includes(t)) tables.add(t);
  }
  const usaTenant = /tenant_id/.test(b);
  if (tables.size && !usaTenant) flags.push('SQL-SEM-tenant_id');

  // Recurso por id na URL sem filtro de tenant na mesma query.
  if (/:([a-zA-Z]*[iI]d|instance[a-zA-Z]*)\b/.test(r.path) && tables.size && !usaTenant) flags.push('ID-NA-URL-SEM-DONO');
  const coberta = guardaWhatsapp && r.path.startsWith('/api/whatsapp/');
  if (/:instance/i.test(r.path) && !coberta && !/userOwnsInstance\(|getStrictInstanceOwner\(/.test(b)) flags.push('INSTANCIA-SEM-userOwnsInstance');
  if (/getDefaultInstance\(/.test(b)) flags.push('getDefaultInstance(global)');
  if (/req\.(query|body)\.tenantId|req\.(query|body)\.tenant_id/.test(b) && !/validateRequestedTenantForUser|is_super_admin/.test(b)) flags.push('TENANT-DO-CLIENTE');

  if (flags.length || todas) out.push({ ...r, flags, tables: [...tables] });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`# Auditoria heurística de rotas — ${file} (${routes.length} rotas, ${out.length} listadas)`);
console.log('Legenda: SEM-AUTH · SQL-SEM-tenant_id · ID-NA-URL-SEM-DONO · INSTANCIA-SEM-userOwnsInstance · getDefaultInstance(global) · TENANT-DO-CLIENTE');
if (guardaWhatsapp) console.log('Nota: rotas /api/whatsapp/* passam pelo guarda global app.use(\'/api/whatsapp\') com userOwnsInstance — não são acusadas de INSTANCIA-SEM-userOwnsInstance.');
console.log('Cada alerta é suspeita: confirme lendo o handler (a query pode usar helper que já filtra).\n');
for (const r of out) {
  console.log(`${pad(`${file}:${r.line}`, 34)} ${pad(r.method, 6)} ${pad(r.path, 48)} ${r.flags.join(', ') || 'ok'}${r.tables.length ? `  [${r.tables.slice(0, 6).join(',')}]` : ''}`);
  if (contexto) {
    r.body.split('\n').forEach((l, j) => {
      if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b|verify(User|Admin)|tenant_id|userOwnsInstance|getStrictInstanceOwner/.test(l))
        console.log(`    ${r.line + j}: ${l.trim().slice(0, 140)}`);
    });
  }
}
