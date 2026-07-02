/**
 * Shared hook to fetch and cache connected WhatsApp instances.
 * Used across Chat, Disparos, Contatos, CRM, and Campanhas modules.
 * Includes real-time polling with toast notifications on connection changes.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchInstances, type EvolutionInstance } from "@/lib/evolutionApi";
import { whatsappApi } from "@/lib/vpsApi";
import { toast } from "sonner";
import { playDisconnectAlert } from "@/lib/notificationSound";
import { supabase } from "@/integrations/supabase/client";

export interface ConnectedInstance extends EvolutionInstance {
  connectionState: "open" | "close" | "connecting";
}

type ConnectionState = ConnectedInstance["connectionState"];

function normalizeConnectionState(value: unknown): ConnectionState {
  return value === "open" || value === "connecting" ? value : "close";
}

let cachedInstances: ConnectedInstance[] = [];
let lastFetchTime = 0;
const CACHE_TTL = 30_000; // 30 seconds
const POLL_INTERVAL_IDLE = 15_000; // background polling
const POLL_INTERVAL_ACTIVE = 5_000; // when a dialog/section is actively observing
const listeners = new Set<() => void>();
const activeObservers = new Set<symbol>(); // consumers that need fast polling

// Track previous states for change detection
let previousStateMap = new Map<string, "open" | "close" | "connecting">();
let initialLoadDone = false;

function notifyListeners() {
  listeners.forEach((l) => l());
}

function detectChanges(newInstances: ConnectedInstance[]) {
  if (!initialLoadDone) {
    // First load — just record states, no toasts
    initialLoadDone = true;
    previousStateMap = new Map(newInstances.map((i) => [i.instanceName, i.connectionState]));
    return;
  }

  const newMap = new Map(newInstances.map((i) => [i.instanceName, i.connectionState]));

  for (const [name, newState] of newMap) {
    const oldState = previousStateMap.get(name);
    if (!oldState) continue; // new instance, skip

    if (oldState === "open" && newState !== "open") {
      // Connection dropped — alert sound + toast
      playDisconnectAlert();
      toast.error(`WhatsApp "${name}" desconectou`, {
        description: "Verifique a conexão na página de Canais",
        duration: 8000,
      });
    } else if (oldState !== "open" && newState === "open") {
      // Connection restored
      toast.success(`WhatsApp "${name}" reconectou`, {
        description: "Conexão restabelecida com sucesso",
        duration: 5000,
      });
    }
  }

  // Check for removed instances
  for (const [name] of previousStateMap) {
    if (!newMap.has(name)) {
      toast.error(`WhatsApp "${name}" foi removido`, { duration: 5000 });
    }
  }

  previousStateMap = newMap;
}

async function refreshInstances(): Promise<ConnectedInstance[]> {
  try {
    const { data: vpsInstances, error: vpsError } = await whatsappApi.instances();
    if (vpsError && /unauthorized|sessão expirada/i.test(vpsError)) {
      return cachedInstances;
    }

    const usingVpsList = Array.isArray(vpsInstances);
    const rawList = usingVpsList ? vpsInstances : await fetchInstances();
    const list: EvolutionInstance[] = rawList.map((inst: any) => ({
      instanceName: inst.name || inst.instanceName || inst.instance?.instanceName,
      instanceId: inst.id || inst.instanceId || inst.instance?.instanceId || inst.instance?.id || "",
      integration: inst.integration || inst.instance?.integration || "",
      status: normalizeConnectionState(inst.connectionStatus || inst.status || inst.instance?.state),
      owner: inst.ownerJid || inst.owner || inst.instance?.ownerJid,
    })).filter((inst) => !!inst.instanceName);
    
    // The VPS endpoint already filters by authenticated tenant and also includes
    // legacy instance names mapped in whatsapp_instances (for example "testedg"
    // without the tenant UUID prefix). Only apply prefix filtering when falling
    // back to the direct Evolution list.
    let filteredList = list;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('tenant_id, is_super_admin').eq('id', user.id).maybeSingle();
        
        if (usingVpsList || profile?.is_super_admin) {
          filteredList = list;
        } else if (profile?.tenant_id) {
          const prefix = profile.tenant_id.substring(0, 8);
          filteredList = list.filter(inst => inst.instanceName.startsWith(prefix));
        }
      }
    } catch (e) {
      console.error("Failed to filter WhatsApp instances", e);
    }

    const mapped = filteredList.map((inst) => ({
      ...inst,
      connectionState: inst.status,
    }));
    detectChanges(mapped);
    cachedInstances = mapped;
    lastFetchTime = Date.now();
    notifyListeners();
    return cachedInstances;
  } catch {
    return cachedInstances;
  }
}

// Global polling — starts when first listener mounts, stops when all unmount
let pollTimer: ReturnType<typeof setInterval> | null = null;
let currentPollInterval: number | null = null;

function desiredInterval(): number {
  return activeObservers.size > 0 ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE;
}

function startPolling() {
  const target = desiredInterval();
  if (pollTimer && currentPollInterval === target) return;
  if (pollTimer) clearInterval(pollTimer);
  currentPollInterval = target;
  pollTimer = setInterval(() => {
    void refreshInstances();
  }, target);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    currentPollInterval = null;
  }
}

/** Restart polling timer if the desired interval changed (e.g. observer added/removed). */
function syncPollingRate() {
  if (listeners.size === 0) return;
  if (currentPollInterval !== desiredInterval()) startPolling();
}

export function useWhatsAppInstances(options?: { active?: boolean }) {
  const active = options?.active ?? false;
  const [instances, setInstances] = useState<ConnectedInstance[]>(cachedInstances);
  const [loading, setLoading] = useState(cachedInstances.length === 0);

  useEffect(() => {
    const handler = () => setInstances([...cachedInstances]);
    listeners.add(handler);

    if (listeners.size === 1) startPolling();

    return () => {
      listeners.delete(handler);
      if (listeners.size === 0) stopPolling();
    };
  }, []);

  // Register/unregister this consumer as an "active observer" needing fast polling
  useEffect(() => {
    if (!active) return;
    const token = Symbol("wa-observer");
    activeObservers.add(token);
    syncPollingRate();
    // Trigger an immediate refresh so the dialog/section sees fresh state right away
    void refreshInstances();
    return () => {
      activeObservers.delete(token);
      syncPollingRate();
    };
  }, [active]);

  useEffect(() => {
    if (Date.now() - lastFetchTime > CACHE_TTL) {
      setLoading(true);
      refreshInstances().finally(() => setLoading(false));
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await refreshInstances();
    setLoading(false);
  }, []);

  const connected = instances.filter((i) => i.connectionState === "open");

  return { instances, connected, loading, refresh };
}

/** Get the connected instances synchronously (from cache) */
export function getConnectedInstances(): ConnectedInstance[] {
  return cachedInstances.filter((i) => i.connectionState === "open");
}
