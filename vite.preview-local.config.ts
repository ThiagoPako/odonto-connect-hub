// SOMENTE para testar `vite preview` (o que roda em produção) contra o backend LOCAL.
// Em produção o nginx encaminha /api; aqui o próprio preview faz isso. Nunca aponta para produção.
import { mergeConfig, type ConfigEnv, type UserConfig } from "vite";
import base from "./vite.config";
const API = process.env.E2E_API_URL || "http://localhost:3002";
export default (env: ConfigEnv) => {
  const cfg = (typeof base === "function" ? base(env) : base) as UserConfig;
  return mergeConfig(cfg, { preview: { host: "127.0.0.1", allowedHosts: true, proxy: { "/api": { target: API, changeOrigin: false }, "/uploads": { target: API } } } });
};
