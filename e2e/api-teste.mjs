// Sobe o backend (vps-api-server/server.mjs) em MODO DE TESTE para o e2e de WhatsApp, sem alterar o produto:
//  - NODE_ENV=test: o server.mjs só exporta `app`, `pool` e as funções da fila; quem escuta é este arquivo.
//    Nenhum cron (setInterval) do produto roda — a fila e o lembrete só andam quando o teste manda.
//  - Porta de CONTROLE (127.0.0.1): POST /__tick chama processAutomationJobs() direto (a fila andaria a cada 8–25 s),
//    /__reminders chama processAppointmentReminders(), /__clock muda o relógio do Node (janela de envio, expediente),
//    /__sql executa SQL no banco de teste.
//  - Recusa subir se o banco ou a Evolution não forem locais (nunca produção).
// Uso: PG_* e EVOLUTION_* no ambiente; node e2e/api-teste.mjs  (API_PORT, E2E_CONTROL_PORT)
import { pathToFileURL } from "node:url";
import path from "node:path";
import http from "node:http";

const local = (v) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(v || ""));
const evo = (() => { try { return new URL(process.env.EVOLUTION_API_URL || "https://api.odontoconnect.tech").hostname; } catch { return ""; } })();
if (!local(process.env.PG_HOST) || !local(evo)) {
  console.error(`api-teste: recusado — PG_HOST (${process.env.PG_HOST}) e EVOLUTION_API_URL (${process.env.EVOLUTION_API_URL}) precisam ser locais.`);
  process.exit(1);
}
process.env.NODE_ENV = "test";

// Relógio ajustável (só neste processo): Date sem argumento passa a andar com um deslocamento.
const RealDate = Date;
let offsetMs = 0;
class RelogioDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + offsetMs); else super(...a); }
  static now() { return RealDate.now() + offsetMs; }
}
globalThis.Date = RelogioDate;

const servidor = path.resolve(import.meta.dirname, "../vps-api-server/server.mjs");
const mod = await import(pathToFileURL(servidor).href);
const { app, pool, processAutomationJobs, processAppointmentReminders, resetWhatsAppQueueStateForTests, clearTenantSettingsCacheForTests } = mod;

const API_PORT = Number(process.env.API_PORT || 3071);
const CONTROLE_PORT = Number(process.env.E2E_CONTROL_PORT || 3072);
app.listen(API_PORT, "127.0.0.1", () => console.log(`api-teste: API em http://127.0.0.1:${API_PORT} (NODE_ENV=test, sem crons)`));

const json = (res, status, corpo) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(corpo)); };
const lerCorpo = (req) => new Promise((ok) => { const p = []; req.on("data", (c) => p.push(c)); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(p).toString() || "{}")); } catch { ok({}); } }); });

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://c");
    const b = req.method === "POST" ? await lerCorpo(req) : {};
    if (url.pathname === "/__health") return json(res, 200, { ok: true, agora: new Date().toISOString() });
    if (url.pathname === "/__tick") {
      // Zera ritmo/cache de instâncias abertas (b.reset !== false) e roda UM ciclo da fila, como o setInterval do produto.
      if (b.reset !== false) resetWhatsAppQueueStateForTests();
      await processAutomationJobs();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/__reminders") { await processAppointmentReminders(); return json(res, 200, { ok: true }); }
    if (url.pathname === "/__clock") {
      // { iso: "2026-11-01T13:00:00Z" } fixa o "agora"; { iso: null } volta ao relógio real.
      offsetMs = b.iso ? RealDate.parse(b.iso) - RealDate.now() : 0;
      return json(res, 200, { agora: new Date().toISOString() });
    }
    if (url.pathname === "/__sql") {
      clearTenantSettingsCacheForTests?.();
      const r = await pool.query(String(b.sql), b.params || []);
      return json(res, 200, { rows: r.rows, rowCount: r.rowCount });
    }
    return json(res, 404, { error: "rota de controle desconhecida" });
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) });
  }
}).listen(CONTROLE_PORT, "127.0.0.1", () => console.log(`api-teste: controle em http://127.0.0.1:${CONTROLE_PORT}`));
