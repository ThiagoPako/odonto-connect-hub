import { useEffect, useRef } from "react";
import { VPS_API_BASE, getToken, getCachedTenantId } from "@/lib/vpsApi";

/**
 * Escuta um evento do SSE da VPS (/api/events), filtrado pela clínica no servidor.
 * Reconecta com backoff e não deixa conexões abertas após desmontar.
 */
export function useVpsEvent<T = unknown>(eventName: string, onEvent: (data: T) => void, enabled = true) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let cancelled = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      const token = getToken();
      const tenantId = getCachedTenantId();
      if (!token || !tenantId) {
        retryTimer = setTimeout(connect, 5000);
        return;
      }
      const base = VPS_API_BASE.startsWith("http") ? VPS_API_BASE : `${window.location.origin}${VPS_API_BASE}`;
      const url = new URL(`${base}/events`);
      url.searchParams.set("token", token);
      url.searchParams.set("tenantId", tenantId);
      es = new EventSource(url.toString());
      es.addEventListener("connected", () => { attempt = 0; });
      es.addEventListener(eventName, (event) => {
        try {
          handlerRef.current(JSON.parse((event as MessageEvent<string>).data) as T);
        } catch {
          handlerRef.current(undefined as T);
        }
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (cancelled) return;
        attempt++;
        retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempt));
      };
    };

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      es?.close();
    };
  }, [eventName, enabled]);
}
