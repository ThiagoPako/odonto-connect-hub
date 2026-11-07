// Evolution API FALSA (v2.3.7) só para os testes e2e de WhatsApp. NUNCA fala com a Evolution real.
//
//  - Responde ao que o backend usa: /instance/fetchInstances, /instance/connectionState, /message/sendText|sendButtons|
//    sendList|sendMedia|..., /chat/*, /webhook/*, com `key.id` como a Evolution 2.3.7.
//  - Registra tudo o que recebe (GET /__log) para o teste conferir o que "saiu".
//  - Envia webhooks para o backend (POST /__webhook): mensagem recebida, botão, lista, presença, ack.
//
// Uso:  node e2e/fake-evolution.mjs --port 4010 --api http://localhost:3071 --secret <EVOLUTION_WEBHOOK_SECRET> --key <apikey>
// (ou E2E_FAKE_PORT / E2E_API_URL / EVOLUTION_WEBHOOK_SECRET / EVOLUTION_API_KEY no ambiente)
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";

const arg = (nome, env, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : process.env[env] || padrao;
};
const PORT = Number(arg("port", "E2E_FAKE_PORT", "4010"));
const API = String(arg("api", "E2E_API_URL", "http://localhost:3071")).replace(/\/$/, "");
const SECRET = String(arg("secret", "EVOLUTION_WEBHOOK_SECRET", ""));
const KEY = String(arg("key", "EVOLUTION_API_KEY", "fake-evolution-key"));

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) {
  console.error(`fake-evolution: recusado — a API destino precisa ser local (recebi ${API})`);
  process.exit(1);
}

/** @type {Array<{n:number, at:string, method:string, path:string, endpoint:string, instance:string, body:any, apikey:string|null}>} */
let log = [];
let seq = 0;
let instances = [];
/** instância -> 'ok' | 'fail' | 'noid' | 'buttons_noid' (botões sem key.id, texto normal) */
let modos = {};
const abertas = (nomes) => nomes.map((name) => ({
  id: randomUUID(), name, connectionStatus: "open", ownerJid: `55119${String(name.length).padStart(8, "0")}@s.whatsapp.net`,
  profileName: name, integration: "WHATSAPP-BAILEYS", number: null, token: "fake", disconnectionAt: null, createdAt: new Date().toISOString(),
}));
const reset = () => { log = []; seq = 0; modos = {}; instances = abertas(["e2e-alfa", "e2e-beta"]); };
reset();

const json = (res, status, corpo) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(corpo)); };
const lerCorpo = (req) => new Promise((ok) => {
  const partes = [];
  req.on("data", (c) => partes.push(c));
  req.on("end", () => { const t = Buffer.concat(partes).toString("utf8"); try { ok(t ? JSON.parse(t) : {}); } catch { ok({ _raw: t.slice(0, 200) }); } });
});

/** Resposta de envio no formato da Evolution 2.3.7 (201 com key.id). */
function respostaEnvio(instancia, endpoint, corpo) {
  const numero = String(corpo.number || "").replace(/@.*/, "");
  const id = `3EB0${randomUUID().replace(/-/g, "").slice(0, 28).toUpperCase()}`;
  const mensagem = endpoint === "sendText" ? { conversation: corpo.text }
    : endpoint === "sendButtons" ? { buttonsMessage: { contentText: corpo.description, footerText: corpo.footer, buttons: corpo.buttons } }
    : endpoint === "sendList" ? { listMessage: { title: corpo.title, description: corpo.description, sections: corpo.sections } }
    : { conversation: "" };
  return {
    key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: true, id },
    pushName: instancia, status: "PENDING", message: mensagem, messageType: Object.keys(mensagem)[0],
    messageTimestamp: Math.floor(Date.now() / 1000), instanceId: randomUUID(), source: "unknown",
  };
}

// ─── Payloads de webhook (formato da Evolution 2.x / Baileys) ─────────────────
const agora = () => Math.floor(Date.now() / 1000);
export function payloadMensagem({ instance, phone, text, pushName = "Paciente Teste", id = `FAKE${randomUUID().slice(0, 12)}` }) {
  return { event: "messages.upsert", instance, data: { key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id }, pushName, message: { conversation: text }, messageType: "conversation", messageTimestamp: agora(), instanceId: randomUUID(), source: "android" }, destination: "http://api/webhook", date_time: new Date().toISOString(), sender: `${phone}@s.whatsapp.net`, server_url: "http://fake" };
}
export function payloadBotao({ instance, phone, buttonId, displayText = "Botão", pushName = "Paciente Teste", id = `FAKE${randomUUID().slice(0, 12)}` }) {
  return { event: "messages.upsert", instance, data: { key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id }, pushName, message: { buttonsResponseMessage: { selectedButtonId: buttonId, selectedDisplayText: displayText, type: 1 } }, messageType: "buttonsResponseMessage", messageTimestamp: agora(), source: "android" }, date_time: new Date().toISOString() };
}
export function payloadLista({ instance, phone, rowId, title = "Opção", pushName = "Paciente Teste", id = `FAKE${randomUUID().slice(0, 12)}` }) {
  return { event: "messages.upsert", instance, data: { key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id }, pushName, message: { listResponseMessage: { title, listType: 1, singleSelectReply: { selectedRowId: rowId } } }, messageType: "listResponseMessage", messageTimestamp: agora(), source: "android" }, date_time: new Date().toISOString() };
}
export function payloadPresenca({ instance, phone, status = "composing" }) {
  return { event: "presence.update", instance, data: { id: `${phone}@s.whatsapp.net`, presences: { [`${phone}@s.whatsapp.net`]: { lastKnownPresence: status } } } };
}

export function tokenDoWebhook(instance) {
  return createHmac("sha256", SECRET).update(String(instance || "")).digest("hex").slice(0, 48);
}
async function enviarWebhook(payload, { comToken = true, token = null } = {}) {
  const url = new URL(`${API}/api/webhook/evolution`);
  if (SECRET && comToken) url.searchParams.set("token", token || tokenDoWebhook(payload.instance));
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const texto = await r.text();
  let corpo; try { corpo = JSON.parse(texto); } catch { corpo = texto.slice(0, 200); }
  return { status: r.status, body: corpo };
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://fake");
  const caminho = url.pathname;
  try {
    // ── Controle (sem apikey): só para o teste ──
    if (caminho === "/__log") {
      const desde = Number(url.searchParams.get("since") || 0);
      return json(res, 200, log.filter((l) => l.n > desde));
    }
    if (caminho === "/__reset" && req.method === "POST") { reset(); return json(res, 200, { ok: true }); }
    if (caminho === "/__instances" && req.method === "POST") {
      const b = await lerCorpo(req);
      instances = abertas(b.abertas || []).concat((b.fechadas || []).map((name) => ({ ...abertas([name])[0], connectionStatus: "close" })));
      return json(res, 200, { ok: true });
    }
    if (caminho === "/__mode" && req.method === "POST") { const b = await lerCorpo(req); modos[b.instance] = b.mode; return json(res, 200, { ok: true }); }
    if (caminho === "/__webhook" && req.method === "POST") {
      const b = await lerCorpo(req);
      const mapa = { text: payloadMensagem, button: payloadBotao, list: payloadLista, presence: payloadPresenca };
      const montar = mapa[b.kind];
      if (!montar) return json(res, 400, { error: "kind inválido" });
      return json(res, 200, await enviarWebhook(montar(b), { comToken: b.semToken !== true, token: b.tokenDe ? tokenDoWebhook(b.tokenDe) : null }));
    }
    if (caminho === "/__health") return json(res, 200, { ok: true });

    // ── API da Evolution: exige apikey, como a real ──
    const corpo = ["POST", "PUT", "DELETE", "PATCH"].includes(req.method) ? await lerCorpo(req) : {};
    const apikey = req.headers.apikey || null;
    const partes = caminho.split("/").filter(Boolean);
    const endpoint = partes[1] || partes[0] || "";
    const instancia = decodeURIComponent(partes[2] || "");
    log.push({ n: ++seq, at: new Date().toISOString(), method: req.method, path: caminho, endpoint, instance: instancia, body: corpo, apikey });
    if (apikey !== KEY && caminho !== "/") return json(res, 401, { status: 401, error: "Unauthorized", response: { message: "Unauthorized" } });

    if (caminho === "/") return json(res, 200, { status: 200, message: "Welcome to the Evolution API, it is working!", version: "2.3.7" });
    if (caminho === "/instance/fetchInstances") return json(res, 200, instances);
    if (partes[0] === "instance" && partes[1] === "connectionState") {
      const i = instances.find((x) => x.name === instancia);
      return json(res, 200, { instance: { instanceName: instancia, state: i ? (i.connectionStatus === "open" ? "open" : "close") : "close" } });
    }
    if (partes[0] === "message" && partes[1]?.startsWith("send")) {
      const modo = modos[instancia] || "ok";
      if (modo === "fail") return json(res, 400, { status: 400, error: "Bad Request", response: { message: ["Connection Closed"] } });
      if (modo === "noid") return json(res, 201, { status: "PENDING" });
      if (modo === "buttons_noid" && (endpoint === "sendButtons" || endpoint === "sendList")) return json(res, 201, { status: "PENDING" });
      return json(res, 201, respostaEnvio(instancia, endpoint, corpo));
    }
    if (partes[0] === "chat") return json(res, 200, partes[1] === "sendPresence" ? { ok: true } : []);
    if (partes[0] === "instance" || partes[0] === "webhook" || partes[0] === "settings") {
      return json(res, 200, { status: "SUCCESS", error: false, response: { message: "ok" }, instance: { instanceName: instancia, status: "open" } });
    }
    return json(res, 404, { status: 404, error: "Not Found", response: { message: [`Cannot ${req.method} ${caminho}`] } });
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) });
  }
});

servidor.listen(PORT, "127.0.0.1", () => console.log(`fake-evolution 2.3.7 em http://127.0.0.1:${PORT} → webhooks para ${API}`));
