#!/usr/bin/env bash
# Verificação padrão do Odonto Connect para a mudança atual (branch + arquivos não commitados).
# Uso (da raiz do repo):  bash .claude/skills/odonto-verificacao/scripts/verificar.sh [--base main] [--sem-build] [--testes]
# Não altera arquivos versionados: sem git stash, sem install, sem fix. O build usa --outDir temporário
# (nada em dist/) e o código de saída 2 significa que a verificação não pôde rodar.
set -o pipefail

BASE="main"; BUILD=1; TESTES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) [[ $# -ge 2 ]] || { echo "--base precisa de um valor"; exit 2; }; BASE="$2"; shift 2 ;;
    --sem-build) BUILD=0; shift ;;
    --testes) TESTES=1; shift ;;
    *) echo "opção desconhecida: $1"; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)" || exit 1
MB=""
for ref in "$BASE" "origin/$BASE"; do
  MB="$(git merge-base "$ref" HEAD 2>/dev/null)" && [[ -n "$MB" ]] && break
  MB=""
done
if [[ -z "$MB" ]]; then echo "❌ não achei a base '$BASE' nem 'origin/$BASE' (rode 'git fetch origin'). Verificação NÃO executada."; exit 2; fi
# (bash 3.2 do macOS não tem mapfile)
CHANGED=()
while IFS= read -r f; do [[ -f "$f" ]] && CHANGED+=("$f"); done < <( { git diff --name-only "$MB"; git ls-files --others --exclude-standard; } | sort -u )
FRONT=(); BACK=0
for f in "${CHANGED[@]}"; do
  [[ "$f" =~ ^src/.*\.(ts|tsx)$ && "$f" != "src/routeTree.gen.ts" ]] && FRONT+=("$f")
  [[ "$f" == vps-api-server/* ]] && BACK=1
done

echo "## Verificação — base $BASE ($(git rev-parse --short "$MB")) · HEAD $(git rev-parse --short HEAD)"
echo "Arquivos alterados: ${#CHANGED[@]} (frontend TS: ${#FRONT[@]}, backend: $([[ $BACK == 1 ]] && echo sim || echo não))"
FAIL=0; CHECKS=0
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT

step() { CHECKS=$((CHECKS+1)); echo; echo "### $1"; }
# Soma errorCount da saída JSON do eslint (lida do stdin).
count_errors() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).reduce((a,r)=>a+r.errorCount,0))}catch{console.log('NaN')}})'; }

# Total de erros TS na base, num worktree temporário (node_modules por link simbólico).
base_tsc_total() {
  local wt; wt="$(mktemp -d)" || return 1
  git worktree add --detach -q "$wt/b" "$MB" 2>/dev/null || { rm -rf "$wt"; return 1; }
  ln -s "$PWD/node_modules" "$wt/b/node_modules"
  (cd "$wt/b" && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS')
  git worktree remove --force "$wt/b" 2>/dev/null; rm -rf "$wt"
}

if [[ ${#FRONT[@]} -gt 0 ]]; then
  step "Tipos (tsc) — só erros em arquivos alterados"
  TSC_OUT="$(npx tsc --noEmit -p tsconfig.json 2>&1)"; TSC_RC=$?
  TOTAL="$(printf '%s\n' "$TSC_OUT" | grep -c 'error TS' || true)"
  if (( TSC_RC != 0 && TOTAL == 0 )); then
    echo "⚠️ tsc não rodou (saída $TSC_RC) — tipos NÃO verificados:"; printf '%s\n' "$TSC_OUT" | tail -5; FAIL=1
  else
    HITS="$(printf '%s\n' "$TSC_OUT" | grep -E "^($(printf '%s\n' "${FRONT[@]}" | sed 's/[.[\*^$()+?{|]/\\&/g' | paste -sd'|' -))\(" || true)"
    if [[ -n "$HITS" ]]; then echo "❌ erros de tipo nos arquivos alterados:"; echo "$HITS"; FAIL=1
    else echo "✅ nenhum erro de tipo nos arquivos alterados (total no projeto: $TOTAL)"; fi
    # M4: um tipo alterado pode quebrar chamador NÃO alterado — compara o total com o da base.
    BASE_TOTAL="$(git show "$MB:package.json" >/dev/null 2>&1 && base_tsc_total)"
    if [[ -n "$BASE_TOTAL" ]]; then
      if (( TOTAL > BASE_TOTAL )); then echo "❌ total de erros de tipo subiu: $BASE_TOTAL (base) → $TOTAL (pode ser chamador não alterado)"; FAIL=1
      else echo "✅ total de erros de tipo: $BASE_TOTAL (base) → $TOTAL"; fi
    else echo "⚠️ total de tipos da base não calculado (comparação com a base pulada)"; fi
  fi

  step "Lint (eslint) — arquivos alterados, erros novos × já existentes em $BASE"
  for f in "${FRONT[@]}"; do
    NOW="$(npx eslint -f json "$f" 2>/dev/null | count_errors)"
    OLD=0
    if git cat-file -e "$MB:$f" 2>/dev/null; then
      OLD="$(git show "$MB:$f" | npx eslint -f json --stdin --stdin-filename "$f" 2>/dev/null | count_errors)"
    fi
    if [[ "$NOW" == "NaN" || "$OLD" == "NaN" ]]; then echo "⚠️ $f: eslint não rodou — lint NÃO verificado"; FAIL=1
    elif (( NOW > OLD )); then echo "❌ $f: $NOW erros (antes: $OLD)"; npx eslint --quiet "$f" 2>/dev/null | grep -E '^\s+[0-9]+:[0-9]+'; FAIL=1
    else echo "✅ $f: $NOW erros (antes: $OLD)"; fi
  done
fi

if [[ $BUILD == 1 && ${#FRONT[@]} -gt 0 ]]; then
  step "Build (vite build)"
  if npx vite build --outDir "$TMPD/dist" >"$TMPD/build.log" 2>&1; then echo "✅ build ok"; else echo "❌ build falhou:"; tail -30 "$TMPD/build.log"; FAIL=1; fi
  git diff --quiet -- src/routeTree.gen.ts || echo "⚠️ o build regravou src/routeTree.gen.ts (arquivo versionado) — revise o diff"
fi

if [[ $BACK == 1 ]]; then
  step "Backend — sintaxe"
  for f in "${CHANGED[@]}"; do
    [[ "$f" =~ ^vps-api-server/.*\.(mjs|js)$ ]] || continue
    if node --check "$f" 2>"$TMPD/chk.log"; then echo "✅ $f"; else echo "❌ $f"; cat "$TMPD/chk.log"; FAIL=1; fi
  done
  if [[ $TESTES == 1 ]]; then
    step "Backend — testes (jest; precisam de Postgres)"
    (cd vps-api-server && npm test 2>&1 | tail -25) || FAIL=1
  else
    echo "⚠️ testes do backend não rodados (use --testes; precisam de Postgres local)"
  fi
fi

echo
if [[ " ${CHANGED[*]} " == *.sql* ]]; then echo "⚠️ há .sql alterado: migração NÃO é verificada por este script (veja a skill odonto-migracao)"; fi
if (( CHECKS == 0 )); then echo "RESULTADO: ⚠️ nenhuma checagem aplicável aos arquivos alterados (css/json/config/sql não são cobertos) — nada foi verificado"; exit 0; fi
[[ $FAIL == 0 ]] && echo "RESULTADO: ✅ sem falhas novas" || echo "RESULTADO: ❌ há falhas novas (acima)"
exit $FAIL
