// Comparação de telefone em SQL que aproveita os índices de expressão
// RIGHT(REGEXP_REPLACE(<coluna>, '\D', '', 'g'), 11) (migration-indices-desempenho.sql).
//
// Antes: REGEXP_REPLACE(col) LIKE '%' || RIGHT(REGEXP_REPLACE(outro), 11). O curinga
// no início impede o índice. Agora: a expressão indexada da coluna = ANY de dois
// candidatos tirados do outro telefone:
//   - os 11 últimos dígitos (celular com DDD; com ou sem 55);
//   - os 11 últimos de '55' || dígitos, que cobre o fixo de 10 dígitos salvo sem 55
//     quando a coluna tem 55 (ex.: 551133334444 → 51133334444).
// Resultado igual ao do LIKE para números com DDD (10 a 13 dígitos), com ou sem 55 e
// com máscara. Diferença: número sem DDD (menos de 10 dígitos) não casa mais por
// sufixo, e telefone sem nenhum dígito não casa com tudo (antes, LIKE '%' casava).

const ONLY_DIGITS = (expr) => `REGEXP_REPLACE(${expr}, '\\D', '', 'g')`;

// Expressão indexada da coluna. Mantenha exatamente igual à do índice:
// chat_messages: RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 11)
// crm_leads:     RIGHT(REGEXP_REPLACE(COALESCE(telefone, ''), '\D', '', 'g'), 11)
export function foneIndexado(colExpr) {
  return `RIGHT(${ONLY_DIGITS(colExpr)}, 11)`;
}

// Condição SQL: a coluna (lado indexado) é o mesmo telefone que `outroExpr`.
export function sqlFoneIgual(colExpr, outroExpr) {
  const d = ONLY_DIGITS(outroExpr);
  return `(${d} <> '' AND ${foneIndexado(colExpr)} = ANY(ARRAY[RIGHT(${d}, 11), RIGHT('55' || ${d}, 11)]))`;
}

// Mesmos candidatos calculados no Node, para usar como parâmetro ($n::text[]).
// semDdd (busca em pacientes, que antes casava pelo sufixo de 8 dígitos): inclui
// também o número sem o 55 (fixo salvo sem 55 no cadastro) e os 9 e 8 últimos
// dígitos (cadastro salvo sem DDD).
export function candidatosFone(telefone, { semDdd = false } = {}) {
  const d = String(telefone || '').replace(/\D/g, '');
  if (!d) return [];
  const c = [d.slice(-11), `55${d}`.slice(-11)];
  if (semDdd) {
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) c.push(d.slice(2).slice(-11));
    if (d.length >= 10) c.push(d.slice(-9), d.slice(-8));
  }
  return [...new Set(c)];
}
