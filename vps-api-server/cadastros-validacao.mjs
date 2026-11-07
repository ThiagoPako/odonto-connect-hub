// Validação de cadastros no servidor (pacientes e estoque).
// A tela já valida (src/lib/formatos.ts, src/routes/pacientes.tsx), mas a API aceitava qualquer
// coisa: CPF "123", e-mail "x", nome vazio, data "31/12/2020" (500) e quantidade negativa no estoque.
// Funções puras: sem banco, testadas em tests/cadastros-validacao.test.js.

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');

/** Mesma regra de src/lib/formatos.ts#cpfValido: 11 dígitos, não repetidos, DV correto. */
export function cpfValido(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

const vazio = (v) => v === undefined || v === null || String(v).trim() === '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dataIsoValida(v) {
  const m = DATA_RE.exec(String(v).slice(0, 10));
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Campos que o PUT /api/pacientes/:id aceita. Só os presentes no corpo são gravados
// (antes, campo omitido virava NULL e o PUT apagava telefone, CPF e observações).
export const CAMPOS_PACIENTE = ['nome', 'cpf', 'telefone', 'email', 'data_nascimento', 'sexo', 'convenio', 'endereco', 'observacoes'];

/**
 * Valida e normaliza o corpo de criação/edição de paciente.
 * - `original` (edição): CPF, telefone, e-mail e data só são validados se mudaram, para que um
 *   cadastro antigo/importado com CPF ruim continue editável nos outros campos (mesma regra da tela).
 * - `parcial` (edição): só os campos presentes no corpo entram em `campos`.
 * Devolve { erro } (mensagem para 400) ou { campos } prontos para gravar.
 */
export function validarPaciente(body, { original = null, parcial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const presente = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const mudou = (k, norm = (x) => String(x ?? '').trim()) => !original || norm(b[k]) !== norm(original[k]);
  const campos = {};

  for (const k of CAMPOS_PACIENTE) {
    if (parcial && !presente(k)) continue;
    const v = b[k];
    campos[k] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : (v ?? null);
  }

  if (!parcial || presente('nome')) {
    if (vazio(b.nome) || typeof b.nome !== 'string') return { erro: 'Informe o nome do paciente' };
    if (b.nome.trim().length > 200) return { erro: 'Nome muito longo' };
  }
  if (presente('cpf') || !parcial) {
    campos.cpf = soDigitos(b.cpf) || null;
    if (campos.cpf && mudou('cpf', soDigitos) && !cpfValido(campos.cpf)) return { erro: 'CPF inválido. Confira os 11 dígitos.' };
  }
  if (campos.telefone && mudou('telefone')) {
    const n = soDigitos(campos.telefone).length;
    if (n < 10 || n > 13) return { erro: 'Telefone incompleto. Use DDD + número.' };
  }
  if (campos.email) {
    campos.email = String(campos.email).toLowerCase();
    if (mudou('email', (x) => String(x ?? '').trim().toLowerCase()) && !EMAIL_RE.test(campos.email)) return { erro: 'E-mail inválido' };
  }
  if (campos.data_nascimento) {
    campos.data_nascimento = String(campos.data_nascimento).slice(0, 10);
    if (!dataIsoValida(campos.data_nascimento)) return { erro: 'Data de nascimento inválida (use AAAA-MM-DD)' };
    if (mudou('data_nascimento', (x) => String(x ?? '').slice(0, 10))) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (campos.data_nascimento > hoje || campos.data_nascimento < '1900-01-01') return { erro: 'Data de nascimento inválida' };
    }
  }
  return { campos };
}

/** Quantidade de estoque: inteiro ≥ 0 (ou > 0 quando `positivo`). Devolve o número ou null se inválido. */
export function quantidadeEstoque(v, { positivo = false } = {}) {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) return null;
  if (positivo && n === 0) return null;
  return n;
}

export const TIPOS_MOVIMENTO_ESTOQUE = ['entrada', 'saida'];
