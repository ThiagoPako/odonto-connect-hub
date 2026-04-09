import { useState, useEffect } from "react";
import type { AttendanceQueue } from "@/data/queueData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Users, Phone, ListChecks, X } from "lucide-react";
import { toast } from "sonner";
import { adminListUsers, queuesApi } from "@/lib/vpsApi";
import { adminListUsers, queuesApi } from "@/lib/vpsApi";

export function QueueManagementPanel() {
  const [queues, setQueues] = useState<AttendanceQueue[]>([]);
  const [editingQueue, setEditingQueue] = useState<AttendanceQueue | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const loadQueues = () => {
    queuesApi.list().then(({ data, error }) => {
      if (data && Array.isArray(data)) {
        const mapped: AttendanceQueue[] = data.map((q) => ({
          id: q.id,
          name: q.name,
          color: q.color,
          icon: q.icon,
          description: q.description || "",
          contactNumbers: q.contact_numbers || [],
          teamMembers: (q.team_member_ids || []).map((id: string) => {
            const user = availableUsers.find((u) => u.id === id);
            return { id, name: user?.name || id };
          }),
          whatsappButtonLabel: q.whatsapp_button_label || "",
          active: q.active,
        }));
        setQueues(mapped);
        saveQueues(mapped); // sync localStorage fallback
      } else {
        // Fallback to localStorage
        setQueues(getQueues());
      }
    });
  };

  useEffect(() => {
    adminListUsers().then(({ data }) => {
      if (data) {
        setAvailableUsers(data.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name })));
      }
    });
  }, []);

  useEffect(() => {
    loadQueues();
  }, [availableUsers]);

  const handleNew = () => {
    setEditingQueue({
      id: `q-${Date.now()}`,
      name: "",
      color: "#3B82F6",
      icon: "📋",
      description: "",
      contactNumbers: [],
      teamMembers: [],
      whatsappButtonLabel: "",
      active: true,
    });
    setDialogOpen(true);
  };

  const handleEdit = (queue: AttendanceQueue) => {
    setEditingQueue({ ...queue });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editingQueue) return;
    if (!editingQueue.name.trim()) {
      toast.error("Nome da fila é obrigatório");
      return;
    }
    setSaving(true);
    const exists = queues.find((q) => q.id === editingQueue.id);
    const payload = {
      name: editingQueue.name,
      color: editingQueue.color,
      icon: editingQueue.icon,
      description: editingQueue.description,
      whatsapp_button_label: editingQueue.whatsappButtonLabel,
      contact_numbers: editingQueue.contactNumbers,
      team_member_ids: editingQueue.teamMembers.map((m) => m.id),
    };

    const { error } = exists
      ? await queuesApi.update(editingQueue.id, payload)
      : await queuesApi.create(payload);

    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar fila: " + error);
      return;
    }
    setDialogOpen(false);
    setEditingQueue(null);
    toast.success(exists ? "Fila atualizada" : "Fila criada com sucesso");
    loadQueues();
  };

  const handleDelete = async (id: string) => {
    const { error } = await queuesApi.delete(id);
    if (error) {
      toast.error("Erro ao remover: " + error);
      return;
    }
    toast.success("Fila removida");
    loadQueues();
  };

  const toggleActive = async (id: string) => {
    const queue = queues.find((q) => q.id === id);
    if (!queue) return;
    await queuesApi.update(id, { active: !queue.active });
    loadQueues();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ListChecks className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Filas de Atendimento</CardTitle>
            <p className="text-sm text-muted-foreground">
              Setores da clínica exibidos como menu no WhatsApp
            </p>
          </div>
        </div>
        <Button size="sm" onClick={handleNew}>
          <Plus className="h-4 w-4 mr-1" /> Nova Fila
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {queues.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhuma fila criada. Clique em "Nova Fila" para começar.
          </p>
        )}
        {queues.map((queue) => (
          <div
            key={queue.id}
            className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors"
          >
            <div
              className="h-10 w-10 rounded-lg flex items-center justify-center text-lg shrink-0"
              style={{ backgroundColor: queue.color + "20" }}
            >
              {queue.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{queue.name}</span>
                <Badge
                  variant={queue.active ? "default" : "secondary"}
                  className="text-[10px]"
                  style={queue.active ? { backgroundColor: queue.color } : {}}
                >
                  {queue.active ? "Ativa" : "Inativa"}
                </Badge>
              </div>
              {queue.description && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{queue.description}</p>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Users className="h-3 w-3" /> {queue.teamMembers.length} membro(s)
                </span>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {queue.contactNumbers.length} número(s)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Switch checked={queue.active} onCheckedChange={() => toggleActive(queue.id)} />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(queue)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(queue.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        {/* WhatsApp Preview */}
        {queues.filter((q) => q.active).length > 0 && (
          <>
            <Separator className="my-4" />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Preview do Menu WhatsApp
              </p>
              <div className="bg-[#ECE5DD] rounded-xl p-4 max-w-xs">
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <p className="text-sm text-gray-800 mb-3">
                    Olá! 👋 Selecione o setor desejado:
                  </p>
                  <div className="space-y-2">
                    {queues
                      .filter((q) => q.active)
                      .map((q) => (
                        <div
                          key={q.id}
                          className="text-center py-2 px-3 rounded-md text-sm font-medium text-blue-600 border border-blue-200 bg-blue-50"
                        >
                          {q.whatsappButtonLabel || q.name}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* Edit/Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingQueue && queues.find((q) => q.id === editingQueue.id) ? "Editar Fila" : "Nova Fila de Atendimento"}</DialogTitle>
          </DialogHeader>
          {editingQueue && (
            <QueueForm
              queue={editingQueue}
              onChange={setEditingQueue}
              onSave={handleSave}
              availableUsers={availableUsers}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function QueueForm({
  queue,
  onChange,
  onSave,
  availableUsers,
}: {
  queue: AttendanceQueue;
  onChange: (q: AttendanceQueue) => void;
  onSave: () => void;
  availableUsers: { id: string; name: string }[];
}) {
  const [newPhone, setNewPhone] = useState("");

  const addPhone = () => {
    if (!newPhone.trim()) return;
    onChange({ ...queue, contactNumbers: [...queue.contactNumbers, newPhone.trim()] });
    setNewPhone("");
  };

  const removePhone = (idx: number) => {
    onChange({ ...queue, contactNumbers: queue.contactNumbers.filter((_, i) => i !== idx) });
  };

  const toggleMember = (user: { id: string; name: string }) => {
    const exists = queue.teamMembers.find((m) => m.id === user.id);
    if (exists) {
      onChange({ ...queue, teamMembers: queue.teamMembers.filter((m) => m.id !== user.id) });
    } else {
      onChange({ ...queue, teamMembers: [...queue.teamMembers, user] });
    }
  };

  const icons = ["📅", "💰", "🚨", "🦷", "📋", "💬", "⭐", "🏥", "📞", "🔧"];

  return (
    <div className="space-y-5">
      {/* Name + Icon */}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <Label>Nome da Fila</Label>
          <Input
            value={queue.name}
            onChange={(e) => onChange({ ...queue, name: e.target.value })}
            placeholder="Ex: Agendamento"
          />
        </div>
        <div>
          <Label>Ícone</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {icons.map((icon) => (
              <button
                key={icon}
                type="button"
                onClick={() => onChange({ ...queue, icon })}
                className={`h-8 w-8 rounded text-lg flex items-center justify-center transition-colors ${
                  queue.icon === icon ? "bg-primary/20 ring-2 ring-primary" : "hover:bg-muted"
                }`}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Description */}
      <div>
        <Label>Descrição</Label>
        <Input
          value={queue.description}
          onChange={(e) => onChange({ ...queue, description: e.target.value })}
          placeholder="Descrição do setor"
        />
      </div>

      {/* Color */}
      <div>
        <Label>Cor da Tag</Label>
        <div className="flex items-center gap-2 mt-1">
          <input
            type="color"
            value={queue.color}
            onChange={(e) => onChange({ ...queue, color: e.target.value })}
            className="h-8 w-8 rounded border-0 cursor-pointer"
          />
          <span className="text-xs text-muted-foreground">{queue.color}</span>
          <Badge style={{ backgroundColor: queue.color }} className="text-white text-[10px]">
            {queue.name || "Tag"}
          </Badge>
        </div>
      </div>

      {/* WhatsApp Button Label */}
      <div>
        <Label>Texto do Botão no WhatsApp</Label>
        <Input
          value={queue.whatsappButtonLabel}
          onChange={(e) => onChange({ ...queue, whatsappButtonLabel: e.target.value })}
          placeholder="Ex: 📅 Agendar Consulta"
        />
      </div>

      {/* Contact Numbers */}
      <div>
        <Label>Números de Contato Vinculados</Label>
        <div className="flex gap-2 mt-1">
          <Input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="+55 11 99999-0000"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPhone())}
          />
          <Button type="button" size="sm" onClick={addPhone}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {queue.contactNumbers.map((phone, idx) => (
            <Badge key={idx} variant="secondary" className="gap-1 pr-1">
              <Phone className="h-3 w-3" /> {phone}
              <button onClick={() => removePhone(idx)} className="ml-1 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      </div>

      {/* Team Members */}
      <div>
        <Label>Membros da Equipe</Label>
        <div className="space-y-1.5 mt-2 max-h-40 overflow-y-auto">
          {availableUsers.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum usuário disponível</p>
          )}
          {availableUsers.map((user) => {
            const selected = queue.teamMembers.some((m) => m.id === user.id);
            return (
              <div
                key={user.id}
                onClick={() => toggleMember(user)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
                  selected ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded border-2 flex items-center justify-center ${
                    selected ? "border-primary bg-primary" : "border-muted-foreground/30"
                  }`}
                >
                  {selected && <span className="text-[10px] text-primary-foreground">✓</span>}
                </div>
                <Users className="h-3.5 w-3.5" />
                {user.name}
              </div>
            );
          })}
        </div>
      </div>

      <Separator />

      <Button onClick={onSave} className="w-full">
        Salvar Fila
      </Button>
    </div>
  );
}
