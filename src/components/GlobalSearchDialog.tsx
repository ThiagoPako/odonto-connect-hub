import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Users, UserCheck, Phone, CalendarDays, Search, MessageSquare, Loader2, AlertCircle } from "lucide-react";
import { messagesApi, vpsApiFetch, type ChatMessageApi } from "@/lib/vpsApi";
import { salesStages, recoveryStages } from "@/data/crmMockData";

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Resposta de GET /api/search: só identificação, nada de dado de saúde.
interface SearchResults {
  pacientes: { id: string; nome: string; telefone: string | null }[];
  leads: { id: string; nome: string; telefone: string | null; kanban_stage: string | null }[];
  agendamentos: {
    id: string;
    data: string;
    hora: string;
    status: string | null;
    paciente_id: string | null;
    paciente_nome: string;
    dentista_nome: string | null;
  }[];
}

const EMPTY: SearchResults = { pacientes: [], leads: [], agendamentos: [] };
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

const searchApi = (q: string) => vpsApiFetch<SearchResults>("/search", { params: { q }, background: true });

// Rótulos das etapas do funil (configuração fixa do CRM, não dado de demonstração).
const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  [...salesStages, ...recoveryStages].map((s) => [s.id, s.label]),
);

const STATUS_LABEL: Record<string, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  em_atendimento: "Em atendimento",
  concluido: "Concluído",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
  faltou: "Faltou",
};

function formatDate(value: string) {
  const [y, m, d] = String(value).slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

function formatMsgTime(ts: string) {
  const d = new Date(ts);
  return (
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [chatResults, setChatResults] = useState<ChatMessageApi[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState(false);
  const [searchedFor, setSearchedFor] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(EMPTY);
      setChatResults([]);
      setError(null);
      setChatError(false);
      setSearchedFor("");
    }
  }, [open]);

  // Atalho Ctrl/Cmd+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  // Busca no servidor (só a clínica do usuário), com espera curta entre as teclas.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      requestRef.current++;
      setResults(EMPTY);
      setChatResults([]);
      setSearching(false);
      setError(null);
      setChatError(false);
      setSearchedFor("");
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const id = ++requestRef.current;
      const [main, chat] = await Promise.all([searchApi(q), messagesApi.search(q)]);
      if (id !== requestRef.current) return; // resposta de uma busca antiga
      setResults(main.data ?? EMPTY);
      setError(main.error);
      setChatResults(Array.isArray(chat.data) ? chat.data.slice(0, 8) : []);
      setChatError(!!chat.error);
      setSearchedFor(q);
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const goTo = (path: string, search?: Record<string, string>) => {
    onOpenChange(false);
    navigate({ to: path, search });
  };

  const q = query.trim();
  const counts = {
    pacientes: results.pacientes.length,
    leads: results.leads.length,
    agendamentos: results.agendamentos.length,
    chat: chatResults.length,
  };
  const total = counts.pacientes + counts.leads + counts.agendamentos + counts.chat;
  const done = !searching && searchedFor === q;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 max-w-[calc(100vw-1.5rem)] sm:max-w-lg">
        <DialogTitle className="sr-only">Busca global</DialogTitle>
        <DialogDescription className="sr-only">
          Busque pacientes, leads, agendamentos e mensagens da clínica. Use as setas para escolher e Enter para abrir.
        </DialogDescription>
        {/* shouldFilter={false}: quem filtra é o servidor (nome, telefone ou CPF). */}
        <CommandPrimitive
          shouldFilter={false}
          loop
          className="flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3"
        >
          <CommandInput
            placeholder="Buscar paciente, lead, agendamento ou mensagem..."
            value={query}
            onValueChange={setQuery}
            aria-label="Buscar na clínica"
          />
          <CommandList className="max-h-[min(420px,70vh)]">
            {q.length < MIN_CHARS ? (
              <div className="py-10 px-4 text-center text-sm text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p>Digite nome, telefone ou CPF para buscar pacientes, leads, agendamentos e mensagens</p>
                <p className="text-xs mt-1 opacity-70">
                  Ctrl+K abre · ↑↓ escolhe · Enter abre · Esc fecha
                </p>
              </div>
            ) : (
              <>
                {error && (
                  <div role="alert" className="mx-2 my-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                    <div>
                      <p className="font-medium text-foreground">Não foi possível buscar pacientes, leads e agendamentos.</p>
                      <p className="text-xs text-muted-foreground">{error} Tente de novo em instantes.</p>
                    </div>
                  </div>
                )}

                {searching && total === 0 && !error && (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" aria-live="polite">
                    <Loader2 className="h-4 w-4 animate-spin" /> Buscando...
                  </div>
                )}

                {done && total === 0 && !error && (
                  <div className="py-8 px-4 text-center text-sm text-muted-foreground" aria-live="polite">
                    Nada encontrado para “{q}”.
                    <p className="text-xs mt-1 opacity-70">Confira a grafia ou busque pelo telefone.</p>
                  </div>
                )}

                {counts.pacientes > 0 && (
                  <CommandGroup heading="Pacientes">
                    {results.pacientes.map((p) => (
                      <CommandItem
                        key={`p-${p.id}`}
                        value={`p-${p.id}`}
                        onSelect={() => goTo("/pacientes", { pacienteId: p.id })}
                        className="cursor-pointer"
                      >
                        <Users className="h-4 w-4 text-primary shrink-0" />
                        <span className="flex-1 min-w-0 truncate font-medium">{p.nome}</span>
                        {p.telefone && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                            <Phone className="h-3 w-3" /> {p.telefone}
                          </span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {counts.agendamentos > 0 && (
                  <>
                    {counts.pacientes > 0 && <CommandSeparator />}
                    <CommandGroup heading="Agendamentos">
                      {results.agendamentos.map((a) => (
                        <CommandItem
                          key={`a-${a.id}`}
                          value={`a-${a.id}`}
                          onSelect={() => goTo("/agenda")}
                          className="cursor-pointer"
                        >
                          <CalendarDays className="h-4 w-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="truncate font-medium">{a.paciente_nome}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {formatDate(a.data)} às {String(a.hora).slice(0, 5)}
                              {a.dentista_nome ? ` · ${a.dentista_nome}` : ""}
                            </p>
                          </div>
                          {a.status && (
                            <span className="text-xs text-muted-foreground shrink-0">{STATUS_LABEL[a.status] || a.status}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {counts.leads > 0 && (
                  <>
                    {(counts.pacientes > 0 || counts.agendamentos > 0) && <CommandSeparator />}
                    <CommandGroup heading="CRM / Leads">
                      {results.leads.map((l) => (
                        <CommandItem
                          key={`l-${l.id}`}
                          value={`l-${l.id}`}
                          onSelect={() => goTo("/chat", { lead: l.id })}
                          className="cursor-pointer"
                        >
                          <UserCheck className="h-4 w-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="truncate font-medium">{l.nome}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {STAGE_LABEL[l.kanban_stage || "lead"] || l.kanban_stage}
                            </p>
                          </div>
                          {l.telefone && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                              <Phone className="h-3 w-3" /> {l.telefone}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {counts.chat > 0 && (
                  <>
                    {(counts.pacientes > 0 || counts.agendamentos > 0 || counts.leads > 0) && <CommandSeparator />}
                    <CommandGroup heading="Mensagens do chat">
                      {chatResults.map((m) => (
                        <CommandItem
                          key={`m-${m.id}`}
                          value={`m-${m.id}`}
                          onSelect={() => goTo("/chat", { lead: m.lead_id })}
                          className="cursor-pointer"
                        >
                          <MessageSquare className="h-4 w-4 text-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{m.content}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {m.sender === "lead" ? "Recebida" : "Enviada"} · {m.lead_name || "Contato"}
                            </p>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">{formatMsgTime(m.timestamp)}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}

                {done && chatError && !error && (
                  <p className="px-4 py-2 text-xs text-muted-foreground">
                    {total > 0
                      ? "A busca nas mensagens do chat falhou; os demais resultados estão acima."
                      : "A busca nas mensagens do chat falhou agora."}
                  </p>
                )}

                {searching && total > 0 && (
                  <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Atualizando...
                  </div>
                )}
              </>
            )}
          </CommandList>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
