#!/usr/bin/env bash
# Busca o texto de uma norma no acervo github.com/ctresb/leis (sem clonar: o repo tem ~8,5 GB).
#
# Uso:
#   bash lei.sh <atalho|caminho>              -> cabeçalho + texto inteiro
#   bash lei.sh <atalho|caminho> <artigo>     -> só o artigo (ex.: 11, 7, 46)
#   bash lei.sh <atalho|caminho> -g <termo>   -> linhas que contêm o termo (grep -i)
#   bash lei.sh ls <pasta>                    -> lista arquivos de uma pasta do acervo (API do GitHub, 60 req/h)
#
# Atalhos: lgpd cdc marco-civil prontuario assinatura telessaude codigo-civil odontologia cfo-lei sac
set -euo pipefail

RAW="https://raw.githubusercontent.com/ctresb/leis/main"
API="https://api.github.com/repos/ctresb/leis/contents"

resolve() {
  case "$1" in
    lgpd)         echo "federal/leis-ordinarias/2018/lei-13709-2018-08-14.md" ;;
    cdc)          echo "federal/leis-ordinarias/1990/lei-8078-1990-09-11.md" ;;
    marco-civil)  echo "federal/leis-ordinarias/2014/lei-12965-2014-04-23.md" ;;
    prontuario)   echo "federal/leis-ordinarias/2018/lei-13787-2018-12-27.md" ;;
    assinatura)   echo "federal/leis-ordinarias/2020/lei-14063-2020-09-23.md" ;;
    telessaude)   echo "federal/leis-ordinarias/2022/lei-14510-2022-12-27.md" ;;
    codigo-civil) echo "federal/leis-ordinarias/2002/lei-10406-2002-01-10.md" ;;
    odontologia)  echo "federal/leis-ordinarias/1966/lei-5081-1966-08-24.md" ;;
    cfo-lei)      echo "federal/leis-ordinarias/1964/lei-4324-1964-04-14.md" ;;
    sac)          echo "federal/leis-ordinarias/2017/lei-13460-2017-06-26.md" ;;
    *)            echo "$1" ;;
  esac
}

if [[ "${1:-}" == "ls" ]]; then
  curl -fsS "$API/${2:-}" | python3 -I -c 'import json,sys
d=json.load(sys.stdin)
print("\n".join(x["name"] for x in d) if isinstance(d,list) else d)'
  exit 0
fi

[[ $# -ge 1 ]] || { sed -n '2,12p' "$0"; exit 1; }

path="$(resolve "$1")"
text="$(curl -fsS "$RAW/$path")" || { echo "Não encontrado: $RAW/$path" >&2; exit 2; }

if [[ $# -eq 1 ]]; then
  printf '%s\n' "$text"
elif [[ "$2" == "-g" ]]; then
  printf '%s\n' "$text" | grep -in -- "${3:?termo}"
else
  # Imprime do "**Art. N" (N, Nº, N-A...) até o próximo artigo.
  printf '%s\n' "$text" | awk -v n="$2" '
    /^\*\*Art\. / {
      hit = ($0 ~ "^\\*\\*Art\\. " n "([º°o]|\\.|\\*| |-)")
    }
    hit { print }'
fi
