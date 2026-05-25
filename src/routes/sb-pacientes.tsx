import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { Loader2, Plus, Search, Trash2, LogOut } from "lucide-react";

type Paciente = Tables<"pacientes">;

export const Route = createFileRoute("/sb-pacientes")({
  component: SbPacientesPage,
});

function SbPacientesPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<{ userId: string; email: string } | null>(null);
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: "", cpf: "", celular: "", email: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) {
        navigate({ to: "/sb-login" });
      } else {
        setSession({ userId: s.user.id, email: s.user.email ?? "" });
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate({ to: "/sb-login" });
      } else {
        setSession({ userId: data.session.user.id, email: data.session.user.email ?? "" });
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (session) loadPacientes();
  }, [session]);

  async function loadPacientes() {
    setLoading(true);
    const { data, error } = await supabase
      .from("pacientes")
      .select("*")
      .order("nome", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar pacientes: " + error.message);
      return;
    }
    setPacientes(data ?? []);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSaving(true);

    // pega o tenant_id do profile do usuário
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", session.userId)
      .single();

    if (!profile?.tenant_id) {
      setSaving(false);
      toast.error("Seu usuário não está vinculado a uma clínica. Contate o admin.");
      return;
    }

    const { error } = await supabase.from("pacientes").insert({
      tenant_id: profile.tenant_id,
      nome: form.nome,
      cpf: form.cpf || null,
      celular: form.celular || null,
      email: form.email || null,
      created_by: session.userId,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success("Paciente criado!");
    setForm({ nome: "", cpf: "", celular: "", email: "" });
    setShowForm(false);
    loadPacientes();
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este paciente?")) return;
    const { error } = await supabase.from("pacientes").delete().eq("id", id);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success("Paciente excluído");
    loadPacientes();
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate({ to: "/sb-login" });
  }

  const filtered = pacientes.filter((p) =>
    p.nome.toLowerCase().includes(search.toLowerCase()) ||
    (p.cpf ?? "").includes(search) ||
    (p.celular ?? "").includes(search),
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pacientes (Supabase)</h1>
            <p className="text-sm text-muted-foreground">{session?.email}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Novo
            </button>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                placeholder="Nome *"
                required
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <input
                placeholder="CPF"
                value={form.cpf}
                onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <input
                placeholder="Celular"
                value={form.celular}
                onChange={(e) => setForm({ ...form, celular: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <input
                placeholder="E-mail"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </button>
          </form>
        )}

        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Buscar por nome, CPF ou celular..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <div className="rounded-xl border border-border bg-card">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Nenhum paciente encontrado.
            </div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Nome</th>
                  <th className="p-3">CPF</th>
                  <th className="p-3">Celular</th>
                  <th className="p-3">E-mail</th>
                  <th className="p-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0 text-sm">
                    <td className="p-3 font-medium text-foreground">{p.nome}</td>
                    <td className="p-3 text-muted-foreground">{p.cpf ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{p.celular ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{p.email ?? "—"}</td>
                    <td className="p-3">
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="text-destructive hover:opacity-70"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
