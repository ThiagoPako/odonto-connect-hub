// Rodar: npm test (node --test, sem dependência extra; Node 22.6+ remove os tipos sozinho)
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, whatsappTextToHtml, simpleMarkdownToHtml, safeMediaUrl } from "./safeHtml.ts";

const ataques = [
  '<img src=x onerror="alert(1)">',
  "<script>fetch('//x/'+localStorage.odonto_jwt)</script>",
  '*<svg onload=alert(1)>*',
  '_<iframe src="javascript:alert(1)">_',
  "```<b onmouseover=alert(1)>x</b>```",
  '"><img src=x onerror=alert(1)>',
];

test("escapeHtml escapa os 5 caracteres e aceita vazio", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(42), "42");
});

for (const fn of [whatsappTextToHtml, simpleMarkdownToHtml]) {
  test(`${fn.name} não deixa passar tag nem atributo do texto recebido`, () => {
    for (const a of ataques) {
      const html = fn(a);
      assert.doesNotMatch(html, /<(img|script|svg|iframe|b)\b/i, html);
      assert.doesNotMatch(html, /<[^>]*\son\w+=/i, html);
    }
  });
}

test("whatsappTextToHtml mantém a formatação do WhatsApp", () => {
  assert.equal(whatsappTextToHtml("*oi* _tudo_ ~bem~"), "<strong>oi</strong> <em>tudo</em> <del>bem</del>");
  assert.match(whatsappTextToHtml("```cod```"), /^<code [^>]*>cod<\/code>$/);
  assert.equal(whatsappTextToHtml("Dor & sangramento < 2 dias"), "Dor &amp; sangramento &lt; 2 dias");
});

test("simpleMarkdownToHtml mantém títulos, negrito, listas e quebras", () => {
  const html = simpleMarkdownToHtml("# Título\n## Sub\n- item **forte**\n\nfim");
  assert.match(html, /<h2 [^>]*>Título<\/h2>/);
  assert.match(html, /<h3 [^>]*>Sub<\/h3>/);
  assert.match(html, /<li [^>]*>item <strong>forte<\/strong><\/li>/);
  assert.match(html, /<br\/><br\/>fim$/);
});

test("safeMediaUrl só aceita esquemas de mídia", () => {
  for (const ok of ["https://x.com/a.jpg", "http://x/a", "blob:https://app/1", "/uploads/media/a.png", "data:image/png;base64,AA"]) {
    assert.equal(safeMediaUrl(ok), ok);
  }
  for (const ruim of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<script>", "//evil.com/x", "vbscript:x", "", null, 1]) {
    assert.equal(safeMediaUrl(ruim), null, String(ruim));
  }
});
