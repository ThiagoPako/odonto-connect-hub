import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Send, CheckCircle2, AlertCircle, Wifi } from "lucide-react";
import {
  fetchInstances,
  sendTextMessage,
  type EvolutionInstance,
} from "@/lib/evolutionApi";
import { toast } from "sonner";

interface SendWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
  contactPhone: string;
}

export function SendWhatsAppDialog({
  open,
  onOpenChange,
  contactName,
  contactPhone,
}: SendWhatsAppDialogProps) {
  const [instances, setInstances] = useState<EvolutionInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState("");
  const [message, setMessage] = useState("");
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSent(false);
    setMessage("");
    setLoadingInstances(true);
    fetchInstances()
      .then((list) => {
        const connected = list.filter((i) => i.status === "open");
        setInstances(connected);
        if (connected.length === 1) setSelectedInstance(connected[0].instanceName);
        else setSelectedInstance("");
      })
      .catch(() => setInstances([]))
      .finally(() => setLoadingInstances(false));
  }, [open]);

  const handleSend = async () => {
    if (!selectedInstance || !message.trim()) return;
    setSending(true);
    try {
      await sendTextMessage(selectedInstance, contactPhone, message.trim());
      setSent(true);
      toast.success(`Mensagem enviada para ${contactName}`);
      setTimeout(() => onOpenChange(false), 1500);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao enviar mensagem");
    } finally {
      setSending(false);
    }
  };

  const cleanPhone = contactPhone.replace(/\D/g, "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Enviar WhatsApp
          </DialogTitle>
          <DialogDescription>
            Para <span className="font-medium text-foreground">{contactName}</span>{" "}
            ({cleanPhone})
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-sm font-medium text-foreground">Mensagem enviada!</p>
          </div>
        ) : loadingInstances ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : instances.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-muted-foreground text-center">
              Nenhuma instância WhatsApp conectada.
              <br />
              Conecte uma instância em <span className="font-medium">Canais</span>.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {instances.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Instância</label>
                <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a instância" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map((inst) => (
                      <SelectItem key={inst.instanceName} value={inst.instanceName}>
                        <span className="flex items-center gap-2">
                          <Wifi className="h-3 w-3 text-green-500" />
                          {inst.instanceName}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Mensagem</label>
              <Textarea
                placeholder="Digite sua mensagem..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSend}
                disabled={!selectedInstance || !message.trim() || sending}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Enviar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
