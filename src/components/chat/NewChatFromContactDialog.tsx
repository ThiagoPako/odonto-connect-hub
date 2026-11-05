import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Phone,
  MessageSquare,
  Users,
  Star,
} from "lucide-react";
import { contatosApi, type Contato } from "@/lib/vpsApi";

interface NewChatFromContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectContact: (contato: Contato) => void;
}

const tipoColors: Record<string, string> = {
  pessoal: "bg-primary/10 text-primary",
  paciente: "bg-success/10 text-success",
  fornecedor: "bg-warning/10 text-warning",
  parceiro: "bg-accent/10 text-accent-foreground",
  outro: "bg-muted text-muted-foreground",
};

export function NewChatFromContactDialog({
  open,
  onOpenChange,
  onSelectContact,
}: NewChatFromContactDialogProps) {
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string | null>(null);

  const loadContatos = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search.trim()) params.search = search.trim();
    if (tipoFilter) params.tipo = tipoFilter;
    const { data } = await contatosApi.list(params);
    if (data) setContatos(data);
    setLoading(false);
  }, [search, tipoFilter]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void loadContatos(), 300);
    return () => clearTimeout(timer);
  }, [open, loadContatos]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setTipoFilter(null);
    }
  }, [open]);

  const tipos = ["pessoal", "paciente", "fornecedor", "parceiro", "outro"];
  const withPhone = contatos.filter((c) => !!c.telefone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Iniciar conversa com contato
          </DialogTitle>
          <DialogDescription>
            Selecione um contato para iniciar uma conversa no WhatsApp
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-11 text-base sm:text-sm"
            aria-label="Buscar contato"
            autoFocus
          />
        </div>

        {/* Type filters */}
        <div role="group" aria-label="Filtrar por tipo" className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
          <Button
            type="button"
            variant={tipoFilter === null ? "secondary" : "outline"}
            size="sm"
            aria-pressed={tipoFilter === null}
            className={`h-11 md:h-8 shrink-0 text-sm ${tipoFilter === null ? "border border-primary text-primary" : ""}`}
            onClick={() => setTipoFilter(null)}
          >
            Todos
          </Button>
          {tipos.map((t) => (
            <Button
              key={t}
              type="button"
              variant={tipoFilter === t ? "secondary" : "outline"}
              size="sm"
              aria-pressed={tipoFilter === t}
              className={`h-11 md:h-8 shrink-0 text-sm capitalize ${tipoFilter === t ? "border border-primary text-primary" : ""}`}
              onClick={() => setTipoFilter(t === tipoFilter ? null : t)}
            >
              {t}
            </Button>
          ))}
        </div>

        {/* Contact list */}
        <ScrollArea className="flex-1 min-h-0" aria-busy={loading}>
          {loading ? (
            <div className="space-y-1 pr-3">
              <span className="sr-only">Carregando contatos…</span>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" aria-hidden="true" />
              ))}
            </div>
          ) : withPhone.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 px-4 text-center">
              <Users className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              {search ? (
                <p className="text-sm text-muted-foreground max-w-full">
                  Nenhum contato encontrado para{" "}
                  <span className="inline-block max-w-[16rem] truncate align-bottom font-medium text-foreground">“{search}”</span>.
                  {" "}Confira o nome ou o número.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum contato com telefone cadastrado. Cadastre em Contatos.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1 pr-3">
              {withPhone.map((contato) => (
                <button
                  key={contato.id}
                  onClick={() => {
                    onSelectContact(contato);
                    onOpenChange(false);
                  }}
                  type="button"
                  className="w-full min-h-14 flex items-center gap-3 p-3 rounded-lg hover:bg-muted/60 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs shrink-0" aria-hidden="true">
                    {contato.nome.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {contato.nome}
                      </span>
                      {contato.favorito && (
                        <>
                          <Star className="h-3 w-3 text-warning fill-warning shrink-0" aria-hidden="true" />
                          <span className="sr-only">Favorito</span>
                        </>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-xs px-1.5 py-0 ${tipoColors[contato.tipo] || ""}`}
                      >
                        {contato.tipo}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="h-3 w-3" aria-hidden="true" />
                      {contato.telefone}
                    </span>
                  </div>
                  <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
