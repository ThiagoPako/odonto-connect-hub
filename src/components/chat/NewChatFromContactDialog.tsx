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
  Loader2,
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
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Iniciar Chat com Contato
          </DialogTitle>
          <DialogDescription>
            Selecione um contato para iniciar uma conversa no WhatsApp
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
            autoFocus
          />
        </div>

        {/* Type filters */}
        <div className="flex gap-1.5 flex-wrap">
          <Button
            variant={tipoFilter === null ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setTipoFilter(null)}
          >
            Todos
          </Button>
          {tipos.map((t) => (
            <Button
              key={t}
              variant={tipoFilter === t ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => setTipoFilter(t === tipoFilter ? null : t)}
            >
              {t}
            </Button>
          ))}
        </div>

        {/* Contact list */}
        <ScrollArea className="flex-1 min-h-0 max-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : withPhone.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Users className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search ? "Nenhum contato encontrado" : "Nenhum contato com telefone"}
              </p>
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
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/60 transition-colors text-left group"
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs shrink-0">
                    {contato.nome.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {contato.nome}
                      </span>
                      {contato.favorito && (
                        <Star className="h-3 w-3 text-warning fill-warning shrink-0" />
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${tipoColors[contato.tipo] || ""}`}
                      >
                        {contato.tipo}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Phone className="h-3 w-3" />
                      {contato.telefone}
                    </span>
                  </div>
                  <MessageSquare className="h-4 w-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
