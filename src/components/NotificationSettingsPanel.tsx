import { useState } from "react";
import { Bell, BellOff, Volume2, VolumeX } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isSoundEnabled, setSoundEnabled, playNotificationSound } from "@/lib/notificationSound";
import { toast } from "sonner";

export function NotificationSettingsPanel() {
  const [soundOn, setSoundOn] = useState(isSoundEnabled);

  const handleToggle = (checked: boolean) => {
    setSoundOn(checked);
    setSoundEnabled(checked);
    if (checked) {
      playNotificationSound();
      toast.success("Som de notificação ativado");
    } else {
      toast.info("Som de notificação desativado");
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Bell className="h-4.5 w-4.5 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Notificações</h3>
          <p className="text-xs text-muted-foreground">Configurações de alertas e sons</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            {soundOn ? (
              <Volume2 className="h-4 w-4 text-muted-foreground" />
            ) : (
              <VolumeX className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">Som de notificação</p>
              <p className="text-xs text-muted-foreground">
                Tocar som ao receber novas mensagens no chat
              </p>
            </div>
          </div>
          <Switch checked={soundOn} onCheckedChange={handleToggle} />
        </div>
      </div>
    </div>
  );
}
