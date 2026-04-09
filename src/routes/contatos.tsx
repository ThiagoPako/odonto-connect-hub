import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Search, Star, Phone, Mail, Building2, Loader2, Trash2,
  Pencil, UserPlus, Users, StarOff, MessageSquare
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { contatosApi, type Contato } from "@/lib/vpsApi";
import { CreateContatoDialog } from "@/components/contatos/CreateContatoDialog";
import { EditContatoDialog } from "@/components/contatos/EditContatoDialog";
import { SendWhatsAppDialog } from "@/components/contatos/SendWhatsAppDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/contatos")({
  ssr: false,
  component: ContatosPage,
});

const tipoColors: Record<string, string> = {
  pessoal: "bg-primary/10 text-primary",
  paciente: "bg-success/10 text-success",
  fornecedor: "bg-warning/10 text-warning",
  parceiro: "bg-accent/10 text-accent-foreground",
  outro: "bg-muted text-muted-foreground",
};

function ContatosPage() {
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editContato, setEditContato] = useState<Contato | null>(null);
  const [whatsappContato, setWhatsappContato] = useState<Contato | null>(null);
  const loadContatos = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search.trim()) params.search = search.trim();
    if (tipoFilter) params.tipo = tipoFilter;
    const { data, error } = await contatosApi.list(params);
    if (data) setContatos(data);
    if (error) toast.error(error);
    setLoading(false);
  }, [search, tipoFilter]);

  useEffect(() => {
    const timer = setTimeout(() => void loadContatos(), 300);
    return () => clearTimeout(timer);
  }, [loadContatos]);

  const handleToggleFavorito = async (id: string) => {
    const { data, error } = await contatosApi.toggleFavorito(id);
    if (error) return toast.error(error);
    setContatos((prev) => prev.map((c) => (c.id === id && data ? data : c)));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este contato?")) return;
    const { error } = await contatosApi.delete(id);
    if (error) return toast.error(error);
    setContatos((prev) => prev.filter((c) => c.id !== id));
    toast.success("Contato excluído");
  };

  const tipos = ["pessoal", "paciente", "fornecedor", "parceiro", "outro"];

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Contatos" />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Lista de Contatos</h2>
            <p className="text-sm text-muted-foreground">
              {contatos.length} contato{contatos.length !== 1 ? "s" : ""} cadastrado{contatos.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Novo Contato
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone ou email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Button
              variant={tipoFilter === null ? "default" : "outline"}
              size="sm"
              onClick={() => setTipoFilter(null)}
            >
              Todos
            </Button>
            {tipos.map((t) => (
              <Button
                key={t}
                variant={tipoFilter === t ? "default" : "outline"}
                size="sm"
                onClick={() => setTipoFilter(t === tipoFilter ? null : t)}
                className="capitalize"
              >
                {t}
              </Button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : contatos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Users className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {search || tipoFilter ? "Nenhum contato encontrado" : "Nenhum contato cadastrado"}
            </p>
            {!search && !tipoFilter && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar primeiro contato
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {contatos.map((contato) => (
              <div
                key={contato.id}
                className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 hover:border-primary/30 transition-colors group"
              >
                {/* Avatar */}
                <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                  {contato.nome.slice(0, 2).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-card-foreground truncate">{contato.nome}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${tipoColors[contato.tipo] || ""}`}>
                      {contato.tipo}
                    </Badge>
                    {contato.favorito && <Star className="h-3.5 w-3.5 text-warning fill-warning" />}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    {contato.telefone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contato.telefone}
                      </span>
                    )}
                    {contato.email && (
                      <span className="flex items-center gap-1 truncate">
                        <Mail className="h-3 w-3" />
                        {contato.email}
                      </span>
                    )}
                    {contato.empresa && (
                      <span className="flex items-center gap-1 truncate">
                        <Building2 className="h-3 w-3" />
                        {contato.empresa}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={contato.favorito ? "Remover favorito" : "Favoritar"}
                    onClick={() => void handleToggleFavorito(contato.id)}
                  >
                    {contato.favorito ? (
                      <StarOff className="h-4 w-4 text-warning" />
                    ) : (
                      <Star className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                  {contato.telefone && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Enviar WhatsApp"
                      onClick={() => setWhatsappContato(contato)}
                    >
                      <MessageSquare className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setEditContato(contato)}
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => void handleDelete(contato.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <CreateContatoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(c) => {
          setContatos((prev) => [c, ...prev]);
          toast.success("Contato criado!");
        }}
      />

      {editContato && (
        <EditContatoDialog
          open={!!editContato}
          onOpenChange={(open) => !open && setEditContato(null)}
          contato={editContato}
          onUpdated={(c) => {
            setContatos((prev) => prev.map((p) => (p.id === c.id ? c : p)));
            setEditContato(null);
            toast.success("Contato atualizado!");
          }}
        />
      )}

      {whatsappContato && whatsappContato.telefone && (
        <SendWhatsAppDialog
          open={!!whatsappContato}
          onOpenChange={(open) => !open && setWhatsappContato(null)}
          contactName={whatsappContato.nome}
          contactPhone={whatsappContato.telefone}
        />
      )}
    </div>
  );
}
