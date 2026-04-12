import { useState } from "react";
import { Bell, Volume2, VolumeX, MonitorSmartphone, Flame } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isSoundEnabled, setSoundEnabled, playNotificationSound, isRecoverySoundEnabled, setRecoverySoundEnabled, playRecoverySound } from "@/lib/notificationSound";
import { isPushEnabled, setPushEnabled, requestNotificationPermission } from "@/lib/browserNotification";
import { toast } from "sonner";

export function NotificationSettingsPanel() {
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [pushOn, setPushOn] = useState(isPushEnabled);
  const [recoverySoundOn, setRecoverySoundOn] = useState(isRecoverySoundEnabled);

  const handleSoundToggle = (checked: boolean) => {
    setSoundOn(checked);
    setSoundEnabled(checked);
    if (checked) {
      playNotificationSound();
      toast.success("Som de notificação ativado");
    } else {
      toast.info("Som de notificação desativado");
    }
  };

  const handleRecoverySoundToggle = (checked: boolean) => {
    setRecoverySoundOn(checked);
    setRecoverySoundEnabled(checked);
    if (checked) {
      playRecoverySound();
      toast.success("Som de recuperação ativado");
    } else {
      toast.info("Som de recuperação desativado");
    }
  };

  const handlePushToggle = async (checked: boolean) => {
    if (checked) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        toast.error("Permissão de notificação negada pelo navegador");
        return;
      }
      setPushOn(true);
      setPushEnabled(true);
      toast.success("Notificações push ativadas");
    } else {
      setPushOn(false);
      setPushEnabled(false);
      toast.info("Notificações push desativadas");
    }
  };

  const pushSupported = typeof window !== "undefined" && "Notification" in window;
  const pushDenied = pushSupported && Notification.permission === "denied";

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

      <div className="space-y-1 divide-y divide-border/50">
        <div className="flex items-center justify-between py-3">
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
          <Switch checked={soundOn} onCheckedChange={handleSoundToggle} />
        </div>

        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <Flame className="h-4 w-4 text-orange-500" />
            <div>
              <p className="text-sm font-medium text-foreground">Som de recuperação urgente</p>
              <p className="text-xs text-muted-foreground">
                Som especial quando um lead de follow-up responder e retornar à fila
              </p>
            </div>
          </div>
          <Switch checked={recoverySoundOn} onCheckedChange={handleRecoverySoundToggle} />
        </div>

        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Notificação push do navegador</p>
              <p className="text-xs text-muted-foreground">
                {pushDenied
                  ? "Permissão bloqueada — altere nas configurações do navegador"
                  : "Exibir notificação nativa quando estiver em outra aba"}
              </p>
            </div>
          </div>
          <Switch
            checked={pushOn}
            onCheckedChange={handlePushToggle}
            disabled={pushDenied}
          />
        </div>
      </div>
    </div>
  );
}
