/**
 * Shared hook to fetch and cache connected WhatsApp instances.
 * Used across Chat, Disparos, Contatos, CRM, and Campanhas modules.
 * Includes real-time polling with toast notifications on connection changes.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchInstances, type EvolutionInstance } from "@/lib/evolutionApi";
import { toast } from "sonner";
import { playDisconnectAlert } from "@/lib/notificationSound";

export interface ConnectedInstance extends EvolutionInstance {
  connectionState: "open" | "close" | "connecting";
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
    const list = await fetchInstances();
    const mapped = list.map((inst) => ({
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

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void refreshInstances();
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function useWhatsAppInstances() {
  const [instances, setInstances] = useState<ConnectedInstance[]>(cachedInstances);
  const [loading, setLoading] = useState(cachedInstances.length === 0);

  useEffect(() => {
    const handler = () => setInstances([...cachedInstances]);
    listeners.add(handler);

    // Start polling when at least one consumer is mounted
    if (listeners.size === 1) startPolling();

    return () => {
      listeners.delete(handler);
      if (listeners.size === 0) stopPolling();
    };
  }, []);

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
