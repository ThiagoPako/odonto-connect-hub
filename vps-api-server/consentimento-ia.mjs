// Catálogo de versões do consentimento de gravação e transcrição por IA.
// Fonte: docs/juridico/consentimento-transcricao-ia.md (Helena, v2.0). Sem o item 3(e): o follow-up
// pós-consulta passou a usar modelos fixos, sem IA (#79). Redação final pendente da Helena.
//
// O servidor monta o texto a partir daqui e grava o SHA-256 do texto que ELE montou:
// nunca confia no texto que vem do navegador (LGPD art. 8º §2º — o ônus da prova é da clínica).
import { createHash } from 'crypto';

export const CONSENT_TIPO_GRAVACAO_IA = 'gravacao_transcricao_ia';
export const CONSENT_VERSAO_ATUAL = '2.0';
export const CONSENT_VERSAO_MINIMA = '2.0';

// Retenção no provedor: valor fechado OPENAI_RETENCAO = 30d | zero (decisão e conta do dono do SaaS,
// conforme a retenção zero esteja contratada). Cada valor tem a sua frase inteira, da Helena: nada de
// texto livre de variável de ambiente no meio de um documento jurídico. Valor desconhecido → 30d.
export const RETENCAO_VALORES = ['30d', 'zero'];
export function retencaoProvedor(env = process.env) {
  const v = String(env.OPENAI_RETENCAO || '').trim().toLowerCase();
  return RETENCAO_VALORES.includes(v) ? v : '30d';
}

const FRASE_RETENCAO_CURTA = {
  '30d': 'A OpenAI mantém registros técnicos de segurança por até 30 dias e não usa seus dados para treinar a IA.',
  zero: 'A OpenAI não guarda o conteúdo depois de processar e não usa seus dados para treinar a IA.',
};
const FRASE_RETENCAO_COMPLETA = {
  '30d': 'o provedor mantém registros técnicos por até 30 dias, para segurança e prevenção de abuso, e depois os apaga. Ele não usa o conteúdo para treinar modelos de IA.',
  zero: 'o provedor não guarda o conteúdo depois de processar e não o usa para treinar modelos de IA.',
};

const CURTA_2_0 = `Gravação da consulta e transcrição por inteligência artificial

Para ajudar o dentista a registrar sua consulta, a {clinica} pode gravar o áudio do atendimento. O áudio é transformado em texto e organizado em um rascunho de relatório por um serviço de inteligência artificial da OpenAI, com servidores nos Estados Unidos.

- Para quê: só para o registro clínico. O dentista revisa e aprova o texto antes de ele entrar no seu prontuário.
- O que fica guardado: o áudio é apagado logo depois da transcrição. O texto aprovado pelo dentista faz parte do prontuário. {frase_retencao}
- Você escolhe: se não quiser a gravação, o atendimento acontece normalmente, sem nenhum prejuízo.
- Você pode mudar de ideia a qualquer momento, na recepção ou por mensagem para a clínica.

Para menores de 12 anos, quem autoriza é o pai, a mãe ou o responsável legal.`;

const COMPLETA_2_0 = `Autorização para gravação e transcrição por inteligência artificial (versão 2.0)

1. Quem é responsável pelos seus dados. A {clinica} ({cnpj}, {endereco}) é a controladora: é ela quem decide como seus dados são usados. Contato do encarregado de dados: {contato_encarregado}.

2. Quem trata os dados em nome da clínica. A clínica usa o sistema Odonto Connect, que trata os dados como operador, seguindo as instruções da clínica. Para transcrever o áudio e preparar o rascunho do relatório, o Odonto Connect usa a OpenAI como suboperadora, contratada para essa função.

3. O que é feito e para quê. Com a sua autorização:
(a) o áudio da consulta é gravado no aparelho da clínica;
(b) o áudio é enviado à OpenAI, que o transforma em texto;
(c) o texto, junto com as anotações do dentista sobre a consulta (queixa, procedimento, região e prescrições), é enviado à OpenAI, sem o seu nome, para ser organizado em um rascunho de relatório clínico;
(d) o cirurgião-dentista lê, corrige e aprova o que entra no seu prontuário. Enquanto não é aprovado, o rascunho não faz parte do prontuário.
A finalidade é exclusivamente o registro clínico do seu atendimento. Nada disso é usado para propaganda, venda de dados ou qualquer outro fim. Nenhuma decisão sobre você é tomada pela IA: o dentista revisa e aprova tudo.

4. Transferência para fora do Brasil. Os servidores da OpenAI ficam nos Estados Unidos. A transferência é feita com base nesta autorização específica (Lei nº 13.709/2018, art. 33, VIII) e nas garantias contratuais firmadas com o provedor.

5. Por quanto tempo.
- Áudio: não fica guardado no sistema da clínica. É apagado logo depois da transcrição.
- Transcrição completa (o texto de tudo o que foi dito): é apagada quando o dentista aprova o relatório, a não ser que a clínica tenha escolhido guardá-la no prontuário.
- Na OpenAI: {frase_retencao_completa}
- Relatório aprovado: passa a fazer parte do seu prontuário odontológico, que a lei manda guardar por no mínimo 20 anos desde o último registro (Lei nº 13.787/2018, art. 6º).

6. Você não é obrigado(a). Autorizar é opcional. Se não autorizar, você é atendido(a) normalmente, e o dentista registra a consulta da forma tradicional.

7. Como mudar de ideia (revogar). Você pode revogar a qualquer momento, sem custo e sem explicar o motivo: na recepção, com o dentista ou por mensagem para a clínica. A partir da revogação, nenhuma consulta é gravada. O que já foi aprovado no prontuário continua lá, porque faz parte do seu histórico clínico. Os registros técnicos já enviados ao provedor seguem o prazo do item 5.

8. Crianças e adolescentes. Para pacientes menores de 12 anos, a autorização é dada por um dos pais ou pelo responsável legal (Lei nº 13.709/2018, art. 14, §1º). Para pacientes de 12 a 17 anos, o responsável autoriza e o adolescente também é informado e pode recusar.

9. Seus direitos. Você pode pedir à clínica: confirmação e acesso aos seus dados, correção, informação sobre com quem eles são compartilhados, revogação desta autorização e eliminação do que não precisa ser guardado por lei (Lei nº 13.709/2018, art. 18). Também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD) e aos órgãos de defesa do consumidor.

10. Cópia. Você pode pedir uma cópia desta autorização a qualquer momento.`;

const OPCOES_2_0 = {
  autorizo: 'Autorizo a gravação e a transcrição por IA das consultas de {paciente} nesta clínica.',
  nao_autorizo: 'Não autorizo. Quero ser atendido(a) sem gravação.',
};

export const CONSENT_CATALOGO = {
  [CONSENT_TIPO_GRAVACAO_IA]: {
    '2.0': { curta: CURTA_2_0, completa: COMPLETA_2_0, opcoes: OPCOES_2_0 },
  },
};

const VARIAVEIS = ['clinica', 'cnpj', 'endereco', 'contato_encarregado', 'frase_retencao', 'frase_retencao_completa', 'paciente'];
// Identificação do controlador e do encarregado (LGPD art. 9º III e IV): sem elas o termo não vale.
export const VARIAVEIS_OBRIGATORIAS = ['clinica', 'cnpj', 'endereco', 'contato_encarregado'];

function preencher(template, vars) {
  let out = template;
  for (const k of VARIAVEIS) {
    out = out.split(`{${k}}`).join(String(vars[k] ?? '').trim());
  }
  return out;
}

const vazio = (v) => !String(v ?? '').trim();

/**
 * Monta o texto (curta + opções + completa) de uma versão do catálogo e o SHA-256 desse texto.
 * - Versão inexistente → null.
 * - Falta algum dado obrigatório (clínica, CNPJ, endereço, encarregado) → { faltando: [...] } sem
 *   texto completo: o servidor NÃO monta o termo e a autorização fica bloqueada. Nada de substituto.
 * - A versão curta (que só usa clínica, retenção e paciente) sai sempre, para a tela e para registrar
 *   uma recusa; o hash da recusa sem termo completo é o da curta + opções.
 */
export function montarTextoConsentimento(tipo, versao, vars) {
  const v = CONSENT_CATALOGO[tipo]?.[versao];
  if (!v) return null;
  const retencao = RETENCAO_VALORES.includes(vars.retencao) ? vars.retencao : retencaoProvedor();
  const valores = {
    clinica: vars.clinica,
    cnpj: vars.cnpj,
    endereco: vars.endereco,
    contato_encarregado: vars.contato_encarregado,
    frase_retencao: FRASE_RETENCAO_CURTA[retencao],
    frase_retencao_completa: FRASE_RETENCAO_COMPLETA[retencao],
    paciente: vazio(vars.paciente) ? 'o paciente' : vars.paciente,
  };
  const faltando = VARIAVEIS_OBRIGATORIAS.filter((k) => vazio(valores[k]));
  const curta = vazio(valores.clinica) ? null : preencher(v.curta, valores);
  const opcoes = { autorizo: preencher(v.opcoes.autorizo, valores), nao_autorizo: preencher(v.opcoes.nao_autorizo, valores) };
  const blocoCurto = curta ? [curta, '', `( ) ${opcoes.autorizo}`, `( ) ${opcoes.nao_autorizo}`].join('\n') : null;
  if (faltando.length) {
    return { versao, retencao, faltando, curta, completa: null, opcoes, texto: blocoCurto, hash: blocoCurto ? sha256(blocoCurto) : null };
  }
  const completa = preencher(v.completa, valores);
  const texto = [blocoCurto, '', '---', '', completa].join('\n');
  return { versao, retencao, faltando: [], curta, completa, opcoes, texto, hash: sha256(texto) };
}

export function sha256(texto) {
  return createHash('sha256').update(String(texto), 'utf8').digest('hex');
}

/** Compara versões "x.y" numericamente: versaoMaiorOuIgual('10.0', '2.0') === true. */
export function versaoMaiorOuIgual(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Idade completa em anos numa data (padrão: hoje). data_nascimento em 'YYYY-MM-DD' ou Date. */
export function idadeEmAnos(dataNascimento, hoje = new Date()) {
  if (!dataNascimento) return null;
  const d = dataNascimento instanceof Date ? dataNascimento : new Date(`${String(dataNascimento).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  let idade = hoje.getFullYear() - d.getFullYear();
  const m = hoje.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < d.getDate())) idade--;
  return idade >= 0 && idade < 130 ? idade : null;
}

/**
 * Regras de quem pode assinar (ECA art. 2º; LGPD art. 14 §1º e §5º), conforme o parecer:
 * - menor de 12: só o responsável, com documento;
 * - 12 a 17: o responsável assina e o adolescente fica ciente;
 * - 18+: o próprio paciente ou um responsável legal (ex.: curador).
 * Devolve uma mensagem de erro em português, ou null se estiver tudo certo.
 */
export function validarAssinante({ idade, decisao, assinanteTipo, assinanteNome, assinanteVinculo, responsavelDocumento, adolescenteCiente }) {
  if (idade == null) return 'Informe a idade do paciente antes de registrar a decisão.';
  if (!['paciente', 'responsavel'].includes(assinanteTipo)) return 'Diga quem está assinando: o paciente ou o responsável legal.';
  if (!String(assinanteNome || '').trim()) return 'Informe o nome de quem está assinando.';
  if (assinanteTipo === 'responsavel' && !String(assinanteVinculo || '').trim()) return 'Informe o vínculo do responsável (ex.: mãe, pai, tutor).';
  if (idade < 18 && assinanteTipo !== 'responsavel') return 'Paciente menor de 18 anos: quem assina é o responsável legal.';
  if (idade < 12 && !String(responsavelDocumento || '').trim()) return 'Paciente menor de 12 anos: informe o documento do responsável.';
  if (decisao === 'autorizo' && idade >= 12 && idade < 18 && !adolescenteCiente) return 'Paciente de 12 a 17 anos: confirme que o adolescente foi informado e está ciente.';
  return null;
}
