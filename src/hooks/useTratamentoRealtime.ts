import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

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
 * Escuta mudanças na tabela `tratamentos` via Supabase Realtime.
 * Filtra por `dentista_id` quando informado.
 */
export function useTratamentoRealtime(onChange: Handler, dentistaId?: string) {
  const handlerRef = useRef<Handler>(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    const channel = supabase
      .channel(`tratamentos-${dentistaId ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tratamentos" },
        (payload) => {
          const row = (payload.new ?? payload.old) as Record<string, unknown>;
          if (!row) return;
          if (dentistaId && row.dentista_id && row.dentista_id !== dentistaId) return;
          const action: TratamentoChangedEvent["action"] =
            payload.eventType === "INSERT" ? "created"
            : payload.eventType === "DELETE" ? "deleted"
            : "updated";
          handlerRef.current({
            action,
            id: row.id as string,
            paciente_id: row.paciente_id as string | undefined,
            dentista_id: row.dentista_id as string | undefined,
            descricao: row.descricao as string | undefined,
            dente: row.dente as string | undefined,
            valor: row.valor as number | undefined,
            status: row.status as string | undefined,
            plano: row.plano as string | undefined,
            observacoes: row.observacoes as string | undefined,
            ts: Date.now(),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dentistaId]);
}
