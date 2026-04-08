import { useState, useEffect, type ReactNode } from "react";

/**
 * Wrapper that only renders children on the client side.
 * Used for Recharts and other libraries that don't support SSR.
 */
export function ClientOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return fallback ?? null;
  return <>{children}</>;
}
