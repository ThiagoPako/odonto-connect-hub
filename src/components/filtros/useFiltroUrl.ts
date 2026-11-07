import { useCallback } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

/**
 * Guarda um filtro NÃO sensível (status, período, tipo, aba) na URL, para sobreviver a recarregar
 * a página e poder ser compartilhado entre a equipe.
 *
 * Nunca use para termo de busca, nome, telefone, CPF ou qualquer dado de paciente (LGPD art. 11):
 * URL fica no histórico do navegador, em logs de proxy e em prints.
 *
 * `permitidos` restringe os valores aceitos (valor desconhecido na URL vira "").
 */
export function useFiltroUrl(chave: string, permitidos?: readonly string[]) {
  const navigate = useNavigate();
  const bruto = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown>)[chave],
  });
  let valor = bruto === undefined || bruto === null ? "" : String(bruto);
  if (permitidos && valor && !permitidos.includes(valor)) valor = "";

  const setValor = useCallback(
    (novo: string) => {
      void navigate({
        to: ".",
        replace: true,
        resetScroll: false,
        search: ((prev: Record<string, unknown>) => {
          const prox = { ...prev };
          if (novo) prox[chave] = novo;
          else delete prox[chave];
          return prox;
        }) as never,
      });
    },
    [navigate, chave],
  );

  return [valor, setValor] as const;
}
