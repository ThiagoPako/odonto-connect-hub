#!/usr/bin/env node
// Compara as colunas que o backend usa com um schema real (só estrutura). Heurístico: lê os
// literais SQL dos .mjs (SELECT/INSERT/UPDATE/WHERE), resolve alias → tabela e aponta coluna
// ou tabela que não existe no schema. Resultado = SUSPEITAS: confirme lendo o código.
//
// Uso:
//   # schema (sem dado nenhum), uma linha "tabela|coluna|tipo":
//   sudo -u postgres psql -p 5433 -d odonto_db -tA -F'|' -c "select table_name, column_name, data_type
//     from information_schema.columns where table_schema='public' order by 1,2" > schema.txt
//   node docs/banco/auditar-colunas.mjs schema.txt [--json] [arquivos.mjs...]
//   (sem arquivos: vps-api-server/*.mjs, menos testes e scripts avulsos)
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const pos = args.filter(a => !a.startsWith('--'));
const schemaFile = pos[0];
if (!schemaFile) { console.error('uso: auditar-colunas.mjs schema.txt [--json] [arquivos...]'); process.exit(2); }
const here = path.dirname(new URL(import.meta.url).pathname);
const backend = path.resolve(here, '../../vps-api-server');
const files = pos.length > 1 ? pos.slice(1) : fs.readdirSync(backend)
  .filter(f => f.endsWith('.mjs') && !/^(test-|security-stress|verify-rls|fix-grants|run-full-backfill|create-super-admin)/.test(f))
  .map(f => path.join(backend, f));

// schema
const schema = new Map();
for (const line of fs.readFileSync(schemaFile, 'utf8').split('\n')) {
  const [t, c, ty] = line.trim().split('|');
  if (!t || !c) continue;
  if (!schema.has(t)) schema.set(t, new Map());
  schema.get(t).set(c, ty);
}

const KW = new Set(`select from where and or not null is in on as join left right inner outer full cross lateral
 using set values into update insert delete returning order by group having limit offset distinct case when then
 else end true false like ilike between exists any all union with conflict do nothing desc asc nulls first last
 interval now current_date current_timestamp coalesce count sum min max avg cast filter over partition
 extract epoch date time timestamp timestamptz text uuid int integer bigint numeric boolean jsonb json array
 to_char lower upper trim nullif greatest least string_agg array_agg jsonb_build_object json_agg jsonb_agg row_number
 default excluded current_setting set_config only primary key references table if alter add column index create
 for skip locked share no key year month day hour minute week dow at zone`.split(/\s+/).filter(Boolean));
const NOT_TABLES = new Set(['generate_series', 'unnest', 'jsonb_array_elements', 'jsonb_each', 'json_each',
  'lateral', 'select', 'information_schema', 'pg_tables', 'pg_class', 'pg_policies', 'pg_roles', 'pg_stat_activity',
  'pg_indexes', 'pg_namespace', 'pg_attribute', 'pg_index', 'pg_proc', 'pg_constraint', 'pg_settings', 'pg_database',
  'jsonb_array_elements_text', 'regexp_split_to_table', 'string_to_array', 'jsonb_to_recordset']);

function literals(src) {
  // backtick, ' e " — devolve {text, line}
  const out = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const seg = src.slice(i, e + 2); line += (seg.match(/\n/g) || []).length; i = e + 2; continue; }
    if (ch === '`' || ch === "'" || ch === '"') {
      const q = ch, start = line; let j = i + 1, buf = '', depth = 0;
      while (j < src.length) {
        const c = src[j];
        if (c === '\\') { buf += src[j + 1] === 'n' ? ' ' : src[j + 1]; j += 2; continue; }
        if (c === '\n') { if (q !== '`') break; line++; }
        if (q === '`' && c === '$' && src[j + 1] === '{') { depth = 1; j += 2; buf += ' $X '; while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; else if (src[j] === '\n') line++; j++; } continue; }
        if (c === q) break;
        buf += c; j++;
      }
      out.push({ text: buf, line: start, endLine: line });
      i = j + 1; continue;
    }
    i++;
  }
  return out;
}

const isSqlish = s => /\b(select\s[\s\S]+\sfrom|insert\s+into|update\s+[a-z_]+\s+(?:[a-z_]+\s+)?set|delete\s+from)\b/i.test(s);
const isFragment = s => /^\s*(and|or|where|order by|group by|,)\b/i.test(s) || /\b[a-z_]{1,3}\.[a-z_]+\s*(=|<|>|is|in|ilike|like)/i.test(s);

function context(lines, ln) {
  for (let k = ln - 1; k >= 0 && k > ln - 400; k--) {
    const m = lines[k].match(/app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)/);
    if (m) return `${m[1].toUpperCase()} ${m[2]}`;
    const f = lines[k].match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    if (f) return `função ${f[1]}()`;
  }
  return '';
}

function splitTop(s) { const r = []; let d = 0, cur = ''; for (const c of s) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && d === 0) { r.push(cur); cur = ''; } else cur += c; } r.push(cur); return r; }

const refs = []; // {file, line, table, col, kind, ctx}
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const rel = path.relative(path.resolve(backend, '..'), file);
  let lastAliases = null, lastLine = 0;
  for (const lit of literals(src)) {
    let s = lit.text.replace(/\s+/g, ' ');
    const sql = isSqlish(s);
    if (!sql && !(lastAliases && lit.line - lastLine < 40 && isFragment(s))) continue;
    // DDL do boot/migração não conta como uso
    if (/^\s*(create|alter|drop|comment|grant|revoke)\b/i.test(s)) continue;
    const ctes = new Set([...s.matchAll(/(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map(m => m[1].toLowerCase()));
    let aliases = new Map();
    let tableCount = 0;
    if (sql) {
      for (const m of s.matchAll(/\b(from|join|update|into)\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)(\s*\()?(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
        const t = m[2].toLowerCase();
        if (/(extract|substring|trim|overlay)\s*\([^()]*$/i.test(s.slice(Math.max(0, m.index - 40), m.index))) continue;
        if (m[3] || NOT_TABLES.has(t) || KW.has(t) || ctes.has(t)) continue;
        tableCount++;
        aliases.set(t, t);
        const al = (m[4] || '').toLowerCase();
        if (al && !KW.has(al)) aliases.set(al, t);
        refs.push({ file: rel, line: lit.line, table: t, col: null, kind: 'tabela', ctx: context(lines, lit.line) });
      }
      lastAliases = aliases; lastLine = lit.endLine;
    } else {
      aliases = lastAliases;
    }
    const single = sql && tableCount === 1 ? [...new Set(aliases.values())][0] : (!sql && lastAliases && new Set(lastAliases.values()).size === 1 ? [...lastAliases.values()][0] : null);
    const add = (t, c, kind) => { if (c && !KW.has(c) && !/^\$/.test(c)) refs.push({ file: rel, line: lit.line, table: t, col: c, kind, ctx: context(lines, lit.line) }); };
    // alias.coluna
    for (const m of s.matchAll(/(?<![\w.$'])([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b(?!\s*\()/gi)) {
      const al = m[1].toLowerCase(), c = m[2].toLowerCase();
      if (aliases && aliases.has(al)) add(aliases.get(al), c, 'alias');
    }
    if (!sql && !single) continue;
    // INSERT INTO t (cols)
    for (const m of s.matchAll(/insert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi)) {
      for (const c of m[2].split(',')) add(m[1].toLowerCase(), c.trim().split(/\s+/)[0].toLowerCase(), 'insert');
    }
    // UPDATE t SET a = .., b = ..
    for (const m of s.matchAll(/update\s+(?:public\.)?([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?[a-z_]+)?\s+set\s+([\s\S]*?)(?=\bwhere\b|\breturning\b|\bfrom\b|$)/gi)) {
      for (const part of splitTop(m[2])) { const mm = part.trim().match(/^(?:[a-z_]+\.)?([a-z_][a-z0-9_]*)\s*=/i); if (mm) add(m[1].toLowerCase(), mm[1].toLowerCase(), 'update'); }
    }
    if (!single) continue;
    // coluna sem alias em consulta de uma tabela só: WHERE/AND/ORDER BY e lista do SELECT
    const body = s.replace(/'[^']*'/g, "''");
    for (const m of body.matchAll(/(?:\b(?:where|and|or|on|by)\s+|,\s*|\(\s*)(?:lower\(|upper\(|trim\()?([a-z_][a-z0-9_]*)\)?\s*(?:=|<>|!=|>=|<=|<|>|\bis\b|\bin\b|\bilike\b|\blike\b|\bbetween\b|\bdesc\b|\basc\b|::)/gi)) {
      const c = m[1].toLowerCase(); if (!aliases.has(c)) add(single, c, 'where');
    }
    // demais identificadores soltos (ex.: SUM(valor_final)), menos aliases de saída e tipos
    const outAliases = new Set([...body.matchAll(/\bas\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase()));
    for (const m of body.matchAll(/(?<![\w.$:'"\u00C0-\u017F])([a-z_][a-z0-9_]*)\b(?![\u00C0-\u017F]|\s*[.(])/gi)) {
      const c = m[1].toLowerCase();
      if (KW.has(c) || aliases.has(c) || outAliases.has(c) || ctes.has(c) || c.length < 2) continue;
      add(single, c, 'solto');
    }
    const sel = body.match(/^\s*select\s+(?:distinct\s+)?([\s\S]*?)\s+from\s/i);
    if (sel && sel[1].trim() !== '*') {
      for (const part of splitTop(sel[1])) { const mm = part.trim().match(/^([a-z_][a-z0-9_]*)(?:\s+as\s+[a-z_]+)?$/i); if (mm && !aliases.has(mm[1].toLowerCase())) add(single, mm[1].toLowerCase(), 'select'); }
    }
  }
}

// confronto
const missingTables = new Map(), missingCols = new Map();
for (const r of refs) {
  if (!schema.has(r.table)) {
    if (r.col) continue;
    const k = r.table; if (!missingTables.has(k)) missingTables.set(k, []); missingTables.get(k).push(r);
    continue;
  }
  if (r.col && !schema.get(r.table).has(r.col)) {
    const k = `${r.table}.${r.col}`; if (!missingCols.has(k)) missingCols.set(k, []); missingCols.get(k).push(r);
  }
}
const fmt = list => [...new Set(list.map(r => `${r.file}:${r.line}${r.ctx ? ` (${r.ctx})` : ''}`))];
if (asJson) {
  console.log(JSON.stringify({
    tabelas: Object.fromEntries([...missingTables].map(([k, v]) => [k, fmt(v)])),
    colunas: Object.fromEntries([...missingCols].map(([k, v]) => [k, fmt(v)])),
  }, null, 2));
} else {
  console.log(`# Tabelas usadas e ausentes no schema (${missingTables.size})`);
  for (const [k, v] of [...missingTables].sort()) console.log(`- ${k}: ${fmt(v).slice(0, 6).join('; ')}${v.length > 6 ? ' …' : ''}`);
  console.log(`\n# Colunas usadas e ausentes (${missingCols.size})`);
  for (const [k, v] of [...missingCols].sort()) console.log(`- ${k} [${[...new Set(v.map(r => r.kind))].join(',')}]: ${fmt(v).slice(0, 6).join('; ')}${v.length > 6 ? ' …' : ''}`);
}
