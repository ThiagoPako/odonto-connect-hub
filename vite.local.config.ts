// Config SOMENTE para testes locais: usa a vite.config.ts normal, mas aponta o proxy /api
// para o backend local ((process.env.E2E_API_URL || "http://localhost:3002")) em vez de https://odontoconnect.tech (PRODUÇÃO).
// Uso: npx vite dev -c vite.local.config.ts --port 5173
import { mergeConfig, type ConfigEnv, type UserConfig } from "vite";
import base from "./vite.config";

const API = process.env.E2E_API_URL || "http://localhost:3002";

export default (env: ConfigEnv) => {
  const cfg = (typeof base === "function" ? base(env) : base) as UserConfig;
  const merged = mergeConfig(cfg, {});
  merged.server = {
    ...merged.server,
    host: "localhost",
    proxy: { "/api": { target: API, changeOrigin: false }, "/uploads": { target: API } },
  };
  return merged;
};
