import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
import { EstadoVazio } from "@/components/EstadoVazio";
import { useState, useEffect, useCallback } from "react";
import {
  especialidades,
  type Dentista,
} from "@/data/dentistasMockData";
import {
  UserPlus,
  Search,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  Phone,
  Mail,
  Award,
  Percent,
  X,
  Loader2,
  Stethoscope,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { dentistasApi } from "@/lib/vpsApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/dentistas")({
  ssr: false,
  component: DentistasPage,
});

function mapDentista(r: any): Dentista {
  return {
    id: r.id,
    nome: r.nome || '',
    email: r.email || '',
    telefone: r.telefone || '',
    cro: r.cro || '',
    especialidade: r.especialidade || '',
    comissao: Number(r.comissao_percentual ?? r.comissao ?? 35),
    status: r.ativo === false ? 'inativo' : 'ativo',
    criadoEm: r.created_at ? new Date(r.created_at) : new Date(),
  };
}

function DentistasPage() {
  const [dentistas, setDentistas] = useState<Dentista[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingDentista, setEditingDentista] = useState<Dentista | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Dentista | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadDentistas = useCallback(async () => {
    setLoading(true);
    const { data, error } = await dentistasApi.list();
    if (error) {
      setLoadError(error);
      toast.error("Não foi possível carregar os dentistas: " + error);
    } else {
      setLoadError(null);
      setDentistas(Array.isArray(data) ? data.map(mapDentista) : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadDentistas(); }, [loadDentistas]);

  const filtered = dentistas.filter(
    (d) =>
      d.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.cro.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.especialidade.toLowerCase().includes(searchTerm.toLowerCase())
  );

  /** Devolve true se salvou; em erro mantém o formulário aberto. */
  const handleSave = async (data: Omit<Dentista, "id" | "criadoEm">): Promise<boolean> => {
    const payload = {
      nome: data.nome, email: data.email, telefone: data.telefone,
      cro: data.cro, especialidade: data.especialidade,
      comissao_percentual: data.comissao,
      ativo: data.status === 'ativo',
    };
    const { error } = editingDentista
      ? await dentistasApi.update(editingDentista.id, payload)
      : await dentistasApi.create(payload);
    if (error) {
      toast.error("Erro ao salvar dentista: " + error);
      return false;
    }
    toast.success(editingDentista ? "Dentista atualizado" : "Dentista cadastrado");
    setShowForm(false);
    setEditingDentista(null);
    await loadDentistas();
    return true;
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const { error } = await dentistasApi.delete(toDelete.id);
    setDeleting(false);
    if (error) {
      toast.error("Erro ao excluir dentista: " + error);
      return;
    }
    toast.success(`${toDelete.nome} excluído`);
    setToDelete(null);
    await loadDentistas();
  };

  const handleEdit = (dentista: Dentista) => {
    setEditingDentista(dentista);
    setShowForm(true);
  };

  if (loading && dentistas.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-screen">
        <DashboardHeader title="Gestão de Dentistas" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <DashboardHeader title="Gestão de Dentistas" />
      <main className="flex-1 p-4 sm:p-8 space-y-6 overflow-auto">
        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>Não foi possível carregar os dentistas. {loadError}</span>
            <Button size="sm" variant="outline" onClick={loadDentistas}>Tentar de novo</Button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-slide-up" style={{ animationFillMode: 'both' }}>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Total Cadastrados</p>
            <p className="text-2xl font-bold text-card-foreground mt-1 font-heading">{dentistas.length}</p>
          </div>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-success/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Ativos</p>
            <p className="text-2xl font-bold text-success mt-1 font-heading">{dentistas.filter((d) => d.status === "ativo").length}</p>
          </div>
          <div className="group bg-card rounded-2xl border border-border/60 p-5 shadow-card hover:shadow-glow-primary hover-lift transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-destructive/5 to-transparent rounded-bl-full pointer-events-none" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Inativos</p>
            <p className="text-2xl font-bold text-destructive mt-1 font-heading">{dentistas.filter((d) => d.status === "inativo").length}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nome, CRO ou especialidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-card border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            onClick={() => { setEditingDentista(null); setShowForm(true); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
          >
            <UserPlus className="h-4 w-4" />
            Novo Dentista
          </button>
        </div>

        {/* Table */}
        <div className="bg-card rounded-2xl border border-border/60 shadow-card overflow-hidden animate-slide-up">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-6 py-4">Dentista</th>
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-6 py-4">CRO</th>
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-6 py-4">Especialidade</th>
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-6 py-4">Comissão</th>
                  <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-6 py-4">Status</th>
                  <th className="text-right text-[11px] uppercase tracking-wider font-semibold text-muted-foreground px-6 py-4">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((dentista) => (
                  <tr key={dentista.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                          {dentista.nome.split(" ").filter((_, i, arr) => i === 0 || i === arr.length - 1).map((n) => n[0]).join("")}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{dentista.nome}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" />{dentista.email}</span>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{dentista.telefone}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-foreground flex items-center gap-1.5"><Award className="h-3.5 w-3.5 text-primary" />{dentista.cro}</span>
                    </td>
                    <td className="px-6 py-4"><span className="text-sm text-foreground">{dentista.especialidade}</span></td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-semibold text-foreground flex items-center gap-1"><Percent className="h-3.5 w-3.5 text-muted-foreground" />{dentista.comissao}%</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${dentista.status === "ativo" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                        {dentista.status === "ativo" ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <button aria-label={`Ações de ${dentista.nome}`} className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
                            <MoreVertical className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem asChild className="gap-2 py-2.5 cursor-pointer">
                            <Link to="/painel-dentista" search={{ id: dentista.id }}>
                              <Eye className="h-4 w-4" />Ver Painel
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleEdit(dentista)} className="gap-2 py-2.5 cursor-pointer">
                            <Edit className="h-4 w-4" />Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setToDelete(dentista)}
                            className="gap-2 py-2.5 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                          >
                            <Trash2 className="h-4 w-4" />Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && !loadError && (
            dentistas.length === 0 ? (
              <EstadoVazio
                icon={Stethoscope}
                titulo="Cadastre o primeiro dentista"
                descricao="Cada dentista vira uma coluna na agenda e tem o próprio painel. Use o mesmo e-mail do login dele para o painel aparecer."
                acao={{ label: "Novo dentista", icon: UserPlus, onClick: () => { setEditingDentista(null); setShowForm(true); } }}
              />
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-sm">Nenhum dentista encontrado para essa busca.</p>
              </div>
            )
          )}
        </div>

        <AlertDialog open={!!toDelete} onOpenChange={(v) => { if (!v && !deleting) setToDelete(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {toDelete?.nome}?</AlertDialogTitle>
              <AlertDialogDescription>
                O cadastro é apagado e não pode ser recuperado. Se ele só deixou de atender, prefira editar e marcar como "Inativo".
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleDelete(); }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Form Modal */}
        {showForm && (
          <DentistaFormModal
            dentista={editingDentista}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditingDentista(null); }}
          />
        )}
      </main>
    </div>
  );
}

function DentistaFormModal({
  dentista,
  onSave,
  onClose,
}: {
  dentista: Dentista | null;
  onSave: (data: Omit<Dentista, "id" | "criadoEm">) => Promise<boolean>;
  onClose: () => void;
}) {
  const [nome, setNome] = useState(dentista?.nome ?? "");
  const [email, setEmail] = useState(dentista?.email ?? "");
  const [telefone, setTelefone] = useState(dentista?.telefone ?? "");
  const [cro, setCro] = useState(dentista?.cro ?? "");
  const [especialidade, setEspecialidade] = useState(dentista?.especialidade ?? especialidades[0]);
  const [comissao, setComissao] = useState(dentista?.comissao ?? 35);
  const [status, setStatus] = useState<"ativo" | "inativo">(dentista?.status ?? "ativo");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({ nome, email, telefone, cro, especialidade, comissao, status });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/60 shadow-xl w-full max-w-lg mx-4 animate-slide-up">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h2 className="text-lg font-bold text-foreground font-heading">
            {dentista ? "Editar Dentista" : "Novo Dentista"}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome completo</label>
              <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Dr. João Silva"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="email@clinica.com"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Telefone</label>
              <input type="text" value={telefone} onChange={(e) => setTelefone(e.target.value)} required placeholder="(11) 99999-0000"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">CRO</label>
              <input type="text" value={cro} onChange={(e) => setCro(e.target.value)} required placeholder="CRO-SP 12345"
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Especialidade</label>
              <select value={especialidade} onChange={(e) => setEspecialidade(e.target.value)}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                {especialidades.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Comissão (%)</label>
              <input type="number" value={comissao} onChange={(e) => setComissao(Number(e.target.value))} min={0} max={100}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as "ativo" | "inativo")}
                className="w-full h-10 px-4 rounded-xl bg-background border border-border/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted/60 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {dentista ? "Salvar Alterações" : "Cadastrar Dentista"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
