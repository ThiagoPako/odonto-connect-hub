import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Star, Phone, Mail, Building2, Loader2, Trash2,
  Pencil, UserPlus, Users, StarOff, MessageSquare, Download, MessageCircle

} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { BarraFiltros } from "@/components/filtros/BarraFiltros";
import { useFiltroUrl } from "@/components/filtros/useFiltroUrl";
import { contatosApi, type Contato } from "@/lib/vpsApi";
import { CreateContatoDialog } from "@/components/contatos/CreateContatoDialog";
import { EditContatoDialog } from "@/components/contatos/EditContatoDialog";
import { ImportWhatsAppDialog } from "@/components/contatos/ImportWhatsAppDialog";
import { ImportMessagesDialog } from "@/components/contatos/ImportMessagesDialog";

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

const TIPOS = ["pessoal", "paciente", "fornecedor", "parceiro", "outro"];
const TIPO_ROTULO: Record<string, string> = { pessoal: "Pessoal", paciente: "Paciente", fornecedor: "Fornecedor", parceiro: "Parceiro", outro: "Outro" };

function ContatosPage() {
  const navigate = useNavigate();
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tipoUrl, setTipoUrl] = useFiltroUrl("tipo", TIPOS);
  const tipoFilter = tipoUrl || null;
  const [createOpen, setCreateOpen] = useState(false);
  const [editContato, setEditContato] = useState<Contato | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importMsgOpen, setImportMsgOpen] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadContatos = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search.trim()) params.search = search.trim();
    if (tipoFilter) params.tipo = tipoFilter;
    const { data, error } = await contatosApi.list(params);
    setLoadError(error);
    if (error) toast.error("Não foi possível carregar os contatos: " + error);
    else setContatos(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [search, tipoFilter]);

  useEffect(() => {
    const timer = setTimeout(() => void loadContatos(), 300);
    return () => clearTimeout(timer);
  }, [loadContatos]);

  const handleToggleFavorito = async (id: string) => {
    const { data, error } = await contatosApi.toggleFavorito(id);
    if (error) return toast.error("Erro ao favoritar: " + error);
    setContatos((prev) => prev.map((c) => (c.id === id && data ? data : c)));
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este contato?")) return;
    const { error } = await contatosApi.delete(id);
    if (error) return toast.error("Erro ao excluir contato: " + error);
    setContatos((prev) => prev.filter((c) => c.id !== id));
    toast.success("Contato excluído");
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Contatos" />
      <div className="flex-1 p-4 sm:p-6 space-y-6 overflow-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Lista de Contatos</h2>
            <p className="text-sm text-muted-foreground">
              {contatos.length} contato{contatos.length !== 1 ? "s" : ""} {search || tipoFilter ? "encontrado" : "cadastrado"}{contatos.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setImportMsgOpen(true)}>
              <MessageCircle className="h-4 w-4 mr-2" />
              Importar Mensagens
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Download className="h-4 w-4 mr-2" />
              Importar Contatos
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Novo Contato
            </Button>
          </div>
        </div>

        {/* Busca + filtro */}
        <BarraFiltros
          busca={{ valor: search, onChange: setSearch, placeholder: "Nome, telefone ou e-mail", rotulo: "Buscar contato por nome, telefone ou e-mail", debounce: 0 }}
          filtros={[{
            id: "tipo",
            rotulo: "Tipo",
            valor: tipoUrl,
            onChange: setTipoUrl,
            opcoes: TIPOS.map((t) => ({ valor: t, rotulo: TIPO_ROTULO[t] })),
          }]}
          onLimpar={() => { setSearch(""); setTipoUrl(""); }}
          resultado={loading ? undefined : `${contatos.length} contato${contatos.length !== 1 ? "s" : ""}`}
        />

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : loadError && contatos.length === 0 ? (
          <div role="alert" className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <p className="text-sm text-destructive">Não foi possível carregar os contatos. {loadError}</p>
            <Button size="sm" variant="outline" onClick={() => void loadContatos()}>Tentar de novo</Button>
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
                className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center gap-x-4 gap-y-2 hover:border-primary/30 transition-colors group cursor-pointer"
                onClick={() => navigate({ to: "/chat", search: { contato: contato.id } })}
              >
                {/* Avatar */}
                <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                  {contato.nome.slice(0, 2).toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-[min(100%,12rem)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-card-foreground break-words min-w-0">{contato.nome}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${tipoColors[contato.tipo] || ""}`}>
                      {TIPO_ROTULO[contato.tipo] ?? contato.tipo}
                    </Badge>
                    {contato.favorito && <Star className="h-3.5 w-3.5 text-warning fill-warning" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                    {contato.telefone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {contato.telefone}
                      </span>
                    )}
                    {contato.email && (
                      <span className="flex items-center gap-1 break-all">
                        <Mail className="h-3 w-3 shrink-0" />
                        {contato.email}
                      </span>
                    )}
                    {contato.empresa && (
                      <span className="flex items-center gap-1 break-words">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {contato.empresa}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0 ml-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={contato.favorito ? "Remover favorito" : "Favoritar"}
                    aria-label={contato.favorito ? "Remover favorito" : "Favoritar"}
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
                      title="Abrir Chat"
                      aria-label="Abrir chat"
                      onClick={() => navigate({ to: "/chat", search: { contato: contato.id } })}
                    >
                      <MessageSquare className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Editar contato"
                    aria-label="Editar contato"
                    onClick={() => setEditContato(contato)}
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Excluir contato"
                    aria-label="Excluir contato"
                    onClick={() => void handleDelete(contato.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

      <ImportWhatsAppDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void loadContatos()}
      />

      <ImportMessagesDialog
        open={importMsgOpen}
        onOpenChange={setImportMsgOpen}
      />
    </div>
  );
}
