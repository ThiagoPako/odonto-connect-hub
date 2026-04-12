import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/DashboardHeader";
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
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { dentistasApi } from "@/lib/vpsApi";

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
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const loadDentistas = useCallback(async () => {
    try {
      const res = await dentistasApi.list();
      const data = (res as any).data || res || [];
      setDentistas(Array.isArray(data) ? data.map(mapDentista) : []);
    } catch (err) {
      console.error('Erro ao carregar dentistas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDentistas(); }, [loadDentistas]);

  const filtered = dentistas.filter(
    (d) =>
      d.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.cro.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.especialidade.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSave = async (data: Omit<Dentista, "id" | "criadoEm">) => {
    try {
      if (editingDentista) {
        await dentistasApi.update(editingDentista.id, data);
      } else {
        await dentistasApi.create(data);
      }
      await loadDentistas();
    } catch (err) {
      console.error('Erro ao salvar dentista:', err);
    }
    setShowForm(false);
    setEditingDentista(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await dentistasApi.delete(id);
      await loadDentistas();
    } catch (err) {
      console.error('Erro ao excluir dentista:', err);
    }
    setMenuOpen(null);
  };

  const handleEdit = (dentista: Dentista) => {
    setEditingDentista(dentista);
    setShowForm(true);
    setMenuOpen(null);
  };

  if (loading) {
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
      <main className="flex-1 p-8 space-y-6 overflow-auto">
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
        <div className="flex items-center justify-between gap-4">
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
                      <div className="relative inline-block">
                        <button onClick={() => setMenuOpen(menuOpen === dentista.id ? null : dentista.id)} className="p-2 rounded-lg hover:bg-muted/60 transition-colors">
                          <MoreVertical className="h-4 w-4 text-muted-foreground" />
                        </button>
                        {menuOpen === dentista.id && (
                          <div className="absolute right-0 top-full mt-1 w-44 bg-card rounded-xl border border-border/60 shadow-lg z-20 py-1">
                            <Link to="/painel-dentista" search={{ id: dentista.id }} className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-muted/40 transition-colors w-full">
                              <Eye className="h-4 w-4" />Ver Painel
                            </Link>
                            <button onClick={() => handleEdit(dentista)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-foreground hover:bg-muted/40 transition-colors w-full">
                              <Edit className="h-4 w-4" />Editar
                            </button>
                            <button onClick={() => handleDelete(dentista.id)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors w-full">
                              <Trash2 className="h-4 w-4" />Excluir
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">Nenhum dentista encontrado.</p>
            </div>
          )}
        </div>

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
  onSave: (data: Omit<Dentista, "id" | "criadoEm">) => void;
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
