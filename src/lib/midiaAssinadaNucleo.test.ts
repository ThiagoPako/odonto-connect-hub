// Rodar: npm test (node --test). Renovação de links assinados de mídia do chat (L7).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  configurarRenovacaoDeMidia, ehMidiaNossa, expiracaoDoLink, linkPertoDeVencer,
  renovarLinkMidia, limparCacheMidiaParaTestes, MIDIA_LOTE_MAX,
} from "./midiaAssinadaNucleo.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const midia = (n: number, q = "") => `/uploads/media/2026-11/${uuid(n)}.jpg${q}`;
const agoraS = () => Math.floor(Date.now() / 1000);

let chamadas: string[][] = [];
beforeEach(() => {
  limparCacheMidiaParaTestes();
  chamadas = [];
  configurarRenovacaoDeMidia(async (paths) => {
    chamadas.push(paths);
    return Object.fromEntries(paths.filter((p) => !p.includes("000000000999")).map((p) => [p, `${p}?exp=${agoraS() + 3600}&sig=${"a".repeat(64)}`]));
  });
});

test("reconhece só mídia nossa e lê o exp", () => {
  assert.equal(ehMidiaNossa(midia(1)), true);
  assert.equal(ehMidiaNossa("https://pps.whatsapp.net/v/foto.jpg"), false);
  assert.equal(expiracaoDoLink(midia(1, "?exp=123&sig=x")), 123);
  assert.equal(expiracaoDoLink(midia(1)), null);
  assert.equal(linkPertoDeVencer(midia(1, `?exp=${agoraS() + 30}`)), true);
  assert.equal(linkPertoDeVencer(midia(1, `?exp=${agoraS() + 3600}`)), false);
});

test("junta pedidos em lotes de no máximo 20 caminhos", async () => {
  const urls = Array.from({ length: 45 }, (_, i) => midia(i + 1, "?exp=1&sig=velho"));
  const novos = await Promise.all(urls.map((u) => renovarLinkMidia(u)));
  assert.deepEqual(chamadas.map((c) => c.length), [MIDIA_LOTE_MAX, MIDIA_LOTE_MAX, 5]);
  assert.ok(novos.every((n) => n && /exp=\d+&sig=/.test(n)));
  // pede o caminho limpo, sem a assinatura vencida
  assert.ok(chamadas.flat().every((p) => !p.includes("?")));
});

test("mesma mídia pedida várias vezes vira um só caminho no pedido", async () => {
  await Promise.all([renovarLinkMidia(midia(7, "?exp=1")), renovarLinkMidia(`https://api.x${midia(7)}`), renovarLinkMidia(midia(7))]);
  assert.deepEqual(chamadas, [[midia(7)]]);
});

test("falha devolve null e não fica no cache (nova tentativa pede de novo)", async () => {
  assert.equal(await renovarLinkMidia(midia(999)), null);
  assert.equal(await renovarLinkMidia(midia(999)), null);
  assert.equal(chamadas.length, 2);
});

test("erro de rede vira null para todos do lote", async () => {
  configurarRenovacaoDeMidia(async () => { throw new Error("rede"); });
  const r = await Promise.all([renovarLinkMidia(midia(1)), renovarLinkMidia(midia(2))]);
  assert.deepEqual(r, [null, null]);
});

test("URL que não é nossa não vai ao servidor", async () => {
  assert.equal(await renovarLinkMidia("https://pps.whatsapp.net/v/foto.jpg"), null);
  assert.equal(chamadas.length, 0);
});
