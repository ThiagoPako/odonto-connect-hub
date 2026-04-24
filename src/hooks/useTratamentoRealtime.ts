import { useEffect, useRef } from "react";
import { VPS_API_BASE } from "@/lib/vpsApi";

export interface TratamentoChangedEvent {
  action: "created" | "updated" | "deleted";
  id: string;
  paciente_id?: string;
  dentista_id?: string;
  descricao?: string;
  dente?: string;
  valor?: number;
  status?: string;
  plano?: string;
  observacoes?: string;
  ts: number;
}

type Handler = (evt: TratamentoChangedEvent) => void;

/**
 * Escuta eventos SSE `tratamento_changed` emitidos pelo backend após
 * criar/editar/excluir tratamentos. Mantém uma única conexão por instância
 * do hook com reconexão automática.
 */
export function useTratamentoRealtime(onChange: Handler, dentistaId?: string) {
  const handlerRef = useRef<Handler>(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;
    let retries = 0;

    function connect() {
      es = new EventSource(`${VPS_API_BASE}/events`);

      es.addEventListener("connected", () => {
        retries = 0;
      });

      es.addEventListener("tratamento_changed", (e) => {
        try {
          const data: TratamentoChangedEvent = JSON.parse(
            (e as MessageEvent).data,
          );
          // Filtra por dentista quando informado
          if (dentistaId && data.dentista_id && data.dentista_id !== dentistaId) {
            return;
          }
          handlerRef.current(data);
        } catch (err) {
          console.error("SSE tratamento_changed parse error:", err);
        }
      });

      es.onerror = () => {
        es?.close();
        retries++;
        const delay = Math.min(1000 * retries, 10000);
        retryTimeout = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, [dentistaId]);
}
