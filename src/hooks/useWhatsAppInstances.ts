/**
 * Shared hook to fetch and cache connected WhatsApp instances.
 * Used across Chat, Disparos, Contatos, CRM, and Campanhas modules.
 */
import { useState, useEffect, useCallback } from "react";
import { fetchInstances, type EvolutionInstance } from "@/lib/evolutionApi";

export interface ConnectedInstance extends EvolutionInstance {
  connectionState: "open" | "close" | "connecting";
}

let cachedInstances: ConnectedInstance[] = [];
let lastFetchTime = 0;
const CACHE_TTL = 30_000; // 30 seconds
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((l) => l());
}

async function refreshInstances(): Promise<ConnectedInstance[]> {
  try {
    const list = await fetchInstances();
    cachedInstances = list.map((inst) => ({
      ...inst,
      connectionState: inst.status,
    }));
    lastFetchTime = Date.now();
    notifyListeners();
    return cachedInstances;
  } catch {
    return cachedInstances;
  }
}

export function useWhatsAppInstances() {
  const [instances, setInstances] = useState<ConnectedInstance[]>(cachedInstances);
  const [loading, setLoading] = useState(cachedInstances.length === 0);

  useEffect(() => {
    const handler = () => setInstances([...cachedInstances]);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
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
