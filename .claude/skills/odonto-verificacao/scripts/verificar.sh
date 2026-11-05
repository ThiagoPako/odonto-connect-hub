#!/usr/bin/env bash
# Verificação padrão do Odonto Connect para a mudança atual (branch + arquivos não commitados).
# Uso (da raiz do repo):  bash .claude/skills/odonto-verificacao/scripts/verificar.sh [--base main] [--sem-build] [--testes]
# Não altera nada: sem git stash, sem install, sem fix.
set -o pipefail

BASE="main"; BUILD=1; TESTES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --sem-build) BUILD=0; shift ;;
    --testes) TESTES=1; shift ;;
    *) echo "opção desconhecida: $1"; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)" || exit 1
MB="$(git merge-base "$BASE" HEAD 2>/dev/null || echo "$BASE")"
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
FAIL=0

step() { echo; echo "### $1"; }
# Soma errorCount da saída JSON do eslint (lida do stdin).
count_errors() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).reduce((a,r)=>a+r.errorCount,0))}catch{console.log(0)}})'; }

if [[ ${#FRONT[@]} -gt 0 ]]; then
  step "Tipos (tsc) — só erros em arquivos alterados"
  TSC_OUT="$(npx tsc --noEmit -p tsconfig.json 2>&1)"
  HITS="$(printf '%s\n' "$TSC_OUT" | grep -F -f <(printf '%s\n' "${FRONT[@]}") || true)"
  TOTAL="$(printf '%s\n' "$TSC_OUT" | grep -c 'error TS' || true)"
  if [[ -n "$HITS" ]]; then echo "❌ erros de tipo nos arquivos alterados:"; echo "$HITS"; FAIL=1
  else echo "✅ nenhum erro de tipo nos arquivos alterados (total no projeto: $TOTAL)"; fi

  step "Lint (eslint) — arquivos alterados, erros novos × já existentes em $BASE"
  for f in "${FRONT[@]}"; do
    NOW="$(npx eslint -f json "$f" 2>/dev/null | count_errors)"
    OLD=0
    if git cat-file -e "$MB:$f" 2>/dev/null; then
      OLD="$(git show "$MB:$f" | npx eslint -f json --stdin --stdin-filename "$f" 2>/dev/null | count_errors)"
    fi
    if (( NOW > OLD )); then echo "❌ $f: $NOW erros (antes: $OLD)"; npx eslint --quiet "$f" 2>/dev/null | grep -E '^\s+[0-9]+:[0-9]+'; FAIL=1
    else echo "✅ $f: $NOW erros (antes: $OLD)"; fi
  done
fi

if [[ $BUILD == 1 && ${#FRONT[@]} -gt 0 ]]; then
  step "Build (vite build)"
  if npx vite build >/tmp/odonto-build.$$ 2>&1; then echo "✅ build ok"; else echo "❌ build falhou:"; tail -30 /tmp/odonto-build.$$; FAIL=1; fi
  rm -f /tmp/odonto-build.$$
fi

if [[ $BACK == 1 ]]; then
  step "Backend — sintaxe"
  for f in "${CHANGED[@]}"; do
    [[ "$f" =~ ^vps-api-server/.*\.(mjs|js)$ ]] || continue
    if node --check "$f" 2>/tmp/odonto-chk.$$; then echo "✅ $f"; else echo "❌ $f"; cat /tmp/odonto-chk.$$; FAIL=1; fi
  done
  rm -f /tmp/odonto-chk.$$
  if [[ $TESTES == 1 ]]; then
    step "Backend — testes (jest; precisam de Postgres)"
    (cd vps-api-server && npm test 2>&1 | tail -25) || FAIL=1
  else
    echo "⚠️ testes do backend não rodados (use --testes; precisam de Postgres local)"
  fi
fi

echo
[[ $FAIL == 0 ]] && echo "RESULTADO: ✅ sem falhas novas" || echo "RESULTADO: ❌ há falhas novas (acima)"
exit $FAIL
