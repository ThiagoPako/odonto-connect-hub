import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Users, FileText, UserCheck, Phone, Mail, DollarSign, Search } from "lucide-react";
import { mockPacientes } from "@/data/pacientesMockData";
import { mockPatients } from "@/data/crmMockData";
import { mockBudgets } from "@/data/orcamentoMockData";

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearchDialog({ open, onOpenChange }: GlobalSearchDialogProps) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Keyboard shortcut Ctrl/Cmd+K
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

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return { pacientes: [], orcamentos: [], leads: [] };

    const pacientes = mockPacientes
      .filter(p => p.nome.toLowerCase().includes(q) || p.cpf.includes(q) || p.telefone.includes(q))
      .slice(0, 5);

    const orcamentos = mockBudgets
      .filter(b => b.patientName.toLowerCase().includes(q) || b.id.includes(q) || b.professional.toLowerCase().includes(q))
      .slice(0, 5);

    const leads = mockPatients
      .filter(p => p.name.toLowerCase().includes(q) || p.phone.includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 5);

    return { pacientes, orcamentos, leads };
  }, [query]);

  const hasResults = results.pacientes.length > 0 || results.orcamentos.length > 0 || results.leads.length > 0;

  const goTo = (path: string) => {
    onOpenChange(false);
    navigate({ to: path });
  };

  const statusLabel: Record<string, string> = {
    pendente: "Pendente",
    aprovado: "Aprovado",
    reprovado: "Reprovado",
    em_tratamento: "Em Tratamento",
    finalizado: "Finalizado",
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Buscar paciente, orçamento, lead..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {query.trim() === "" ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p>Digite para buscar pacientes, orçamentos e leads</p>
            <p className="text-xs mt-1 opacity-60">Ctrl+K para abrir a qualquer momento</p>
          </div>
        ) : !hasResults ? (
          <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
        ) : (
          <>
            {results.pacientes.length > 0 && (
              <CommandGroup heading="Pacientes">
                {results.pacientes.map(p => (
                  <CommandItem key={p.id} onSelect={() => goTo("/pacientes")} className="cursor-pointer">
                    <Users className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{p.nome}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.cpf}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {p.telefone}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results.pacientes.length > 0 && results.orcamentos.length > 0 && <CommandSeparator />}

            {results.orcamentos.length > 0 && (
              <CommandGroup heading="Orçamentos">
                {results.orcamentos.map(b => (
                  <CommandItem key={b.id} onSelect={() => goTo("/orcamentos")} className="cursor-pointer">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{b.patientName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{statusLabel[b.status] || b.status}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-medium text-foreground">
                      <DollarSign className="h-3 w-3" />
                      R$ {b.finalValue.toLocaleString("pt-BR")}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {(results.pacientes.length > 0 || results.orcamentos.length > 0) && results.leads.length > 0 && <CommandSeparator />}

            {results.leads.length > 0 && (
              <CommandGroup heading="CRM / Leads">
                {results.leads.map(l => (
                  <CommandItem key={l.id} onSelect={() => goTo("/crm")} className="cursor-pointer">
                    <UserCheck className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{l.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground capitalize">{l.status}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      {l.email}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
