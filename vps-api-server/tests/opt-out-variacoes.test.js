// Reconhecimento do pedido de descadastro (SAIR): variações comuns aceitas e frases com
// outro assunto recusadas. Função pura; o pool não é usado.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: path.join(path.dirname(__filename), '../.env') });
const { pool, isWhatsAppOptOutText } = await import('../server.mjs');

afterAll(async () => { await pool.end(); });

describe('isWhatsAppOptOutText', () => {
  test.each([
    'SAIR', 'sair', 'Sair.', 'sair!!!', '  Sair  ', 'SAIR, por favor', 'sair por favor', 'pare', 'PARE!', 'Parar',
    'não quero mais', 'Não quero mais!', 'nao quero mais', 'NÃO QUERO MAIS RECEBER', 'não quero receber mensagens',
    'cancelar mensagens', 'Cancelar as mensagens.', 'descadastrar', 'Descadastrar, obrigado', 'me descadastre',
    'quero sair da lista', 'me tira da lista pfv', 'pare de enviar', 'não me mande mais', 'stop', 'Unsubscribe',
  ])('"%s" é pedido de saída', (txt) => expect(isWhatsAppOptOutText(txt)).toBe(true));

  test.each([
    'vou sair do trabalho às 18h', 'quero cancelar a consulta', 'cancelar', 'Cancelar consulta', 'pode parar o carro ali?',
    'não quero mais esse horário', 'não quero remarcar', 'sair às 10h', 'preciso sair mais cedo amanhã', 'ok', 'obrigado',
    'não', 'quero', 'por favor', '', 'sim', '2', 'SAIR '.repeat(20),
  ])('"%s" não é pedido de saída', (txt) => expect(isWhatsAppOptOutText(txt)).toBe(false));
});
