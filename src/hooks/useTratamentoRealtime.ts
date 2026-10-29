import { useVpsEvent } from "@/hooks/useVpsEvent";

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
 * Escuta tratamento_changed do SSE da VPS (já filtrado pela clínica).
 * Filtra por `dentista_id` quando informado.
 */
export function useTratamentoRealtime(onChange: Handler, dentistaId?: string) {
  useVpsEvent<TratamentoChangedEvent>("tratamento_changed", (evt) => {
    if (!evt) return;
    if (dentistaId && evt.dentista_id && evt.dentista_id !== dentistaId) return;
    onChange(evt);
  });
}
