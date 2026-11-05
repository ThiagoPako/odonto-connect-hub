// Rodar: npm test (node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBRL, parseValorBRL, maskCPF, cpfValido, maskTelefone, telefoneValido, brParaIso, isoParaBr } from "./formatos.ts";

test("formatBRL usa duas casas e separador brasileiro", () => {
  assert.equal(formatBRL(1234.5).replace(/\s/g, " "), "R$ 1.234,50");
  assert.equal(formatBRL(Number.NaN).replace(/\s/g, " "), "R$ 0,00");
});

test("parseValorBRL aceita vírgula, ponto e milhar", () => {
  assert.equal(parseValorBRL("1.234,56"), 1234.56);
  assert.equal(parseValorBRL("1234.56"), 1234.56);
  assert.equal(parseValorBRL("1.234"), 1234);
  assert.equal(parseValorBRL("R$ 12,5"), 12.5);
  assert.equal(parseValorBRL("abc"), null);
  assert.equal(parseValorBRL(""), null);
});

test("CPF: máscara e dígitos verificadores", () => {
  assert.equal(maskCPF("52998224725"), "529.982.247-25");
  assert.equal(maskCPF("5299"), "529.9");
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("529.982.247-26"), false);
  assert.equal(cpfValido("111.111.111-11"), false);
});

test("telefone: celular, fixo e +55", () => {
  assert.equal(maskTelefone("11987654321"), "(11) 98765-4321");
  assert.equal(maskTelefone("1133334444"), "(11) 3333-4444");
  assert.equal(maskTelefone("+55 11 98765-4321"), "(11) 98765-4321");
  assert.equal(telefoneValido("(11) 9876-543"), false);
  assert.equal(telefoneValido("(11) 98765-4321"), true);
});

test("datas dd/mm/aaaa <-> aaaa-mm-dd", () => {
  assert.equal(brParaIso("05/11/2026"), "2026-11-05");
  assert.equal(brParaIso("31/02/2026"), "");
  assert.equal(isoParaBr("2026-11-05"), "05/11/2026");
  assert.equal(isoParaBr("2026-11-05T03:00:00.000Z"), "05/11/2026");
});
