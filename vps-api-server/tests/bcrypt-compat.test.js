// Hashes gerados com bcrypt 5.1.1 (formato $2b$, custo 10 e 12) precisam continuar
// válidos depois da troca para bcrypt 6: senhas já salvas no banco não podem quebrar o login.
// Senhas fictícias, só para este teste.
import bcrypt from 'bcrypt';

const HASH_5X_CUSTO_10 = '$2b$10$CMMthhZx4M3tOmc.5cj8CeVKBkmnuDTzqyOUA4tjyvXvh47oNd8LG';
const HASH_5X_CUSTO_12 = '$2b$12$uV8pKL3vKz8z9U2/ckNgBO2DIN8Fq2fGglzFHqKrmRFRHajgfmes2';

describe('bcrypt: compatibilidade com hashes da versão 5.x', () => {
  test('aceita a senha certa nos hashes antigos', async () => {
    expect(await bcrypt.compare('Senha#Teste123', HASH_5X_CUSTO_10)).toBe(true);
    expect(await bcrypt.compare('Outra@Senha99', HASH_5X_CUSTO_12)).toBe(true);
  });

  test('recusa senha errada no hash antigo', async () => {
    expect(await bcrypt.compare('senha#teste123', HASH_5X_CUSTO_10)).toBe(false);
  });

  test('hash novo continua no formato $2b$ e é verificável', async () => {
    const h = await bcrypt.hash('Senha#Teste123', 12);
    expect(h.startsWith('$2b$12$')).toBe(true);
    expect(await bcrypt.compare('Senha#Teste123', h)).toBe(true);
  });
});
