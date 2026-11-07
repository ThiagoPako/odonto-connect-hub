// Imita o nginx da VPS para testar `vite preview` localmente: /api e /uploads -> backend local, o resto -> preview.
// Uso: node e2e/proxy-preview.mjs <porta> <preview http://127.0.0.1:5295> <api http://127.0.0.1:3095>
import http from "node:http";
const [porta, preview, api] = process.argv.slice(2);
for (const alvo of [preview, api]) if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(alvo)) { console.error("recusado: destino não local"); process.exit(1); }
http.createServer((req, res) => {
  const destino = new URL(/^\/(api|uploads)\b/.test(req.url) ? api : preview);
  const p = http.request({ host: destino.hostname, port: destino.port, path: req.url, method: req.method, headers: { ...req.headers, host: `${destino.hostname}:${destino.port}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
}).listen(Number(porta), "127.0.0.1", () => console.log(`proxy-preview em ${porta}`));
