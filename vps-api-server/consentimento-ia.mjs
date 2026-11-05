// Catálogo de versões do consentimento de gravação e transcrição por IA.
// Fonte: docs/juridico/consentimento-transcricao-ia.md (Helena, v2.0, com o item 3(e)).
//
// O servidor monta o texto a partir daqui e grava o SHA-256 do texto que ELE montou:
// nunca confia no texto que vem do navegador (LGPD art. 8º §2º — o ônus da prova é da clínica).
import { createHash } from 'crypto';

export const CONSENT_TIPO_GRAVACAO_IA = 'gravacao_transcricao_ia';
export const CONSENT_VERSAO_ATUAL = '2.0';
export const CONSENT_VERSAO_MINIMA = '2.0';

// Retenção no provedor (decisão e conta do dono do SaaS: retenção zero contratada ou não).
// Configurável por OPENAI_RETENCAO_TEXTO; padrão "por até 30 dias".
export function retencaoProvedor(env = process.env) {
  const t = String(env.OPENAI_RETENCAO_TEXTO || '').trim();
  return t || 'por até 30 dias';
}

const CURTA_2_0 = `Gravação da consulta e transcrição por inteligência artificial

Para ajudar o dentista a registrar sua consulta, a {clinica} pode gravar o áudio do atendimento. O áudio é transformado em texto e organizado em um rascunho de relatório e de orientações pós-consulta por um serviço de inteligência artificial da OpenAI, com servidores nos Estados Unidos.

- Para quê: só para o registro clínico. O dentista revisa o texto antes de salvar no seu prontuário.
- O que fica guardado: o áudio é apagado logo depois da transcrição. O texto revisado faz parte do prontuário. A OpenAI {retencao} mantém registros para segurança e não usa seus dados para treinar a IA.
- Você escolhe: se não quiser a gravação, o atendimento acontece normalmente, sem nenhum prejuízo.
- Você pode mudar de ideia a qualquer momento, na recepção ou por mensagem para a clínica.

Para menores de 12 anos, quem autoriza é o pai, a mãe ou o responsável legal.`;

const COMPLETA_2_0 = `Autorização para gravação e transcrição por inteligência artificial (versão 2.0)

1. Quem é responsável pelos seus dados. A {clinica} ({cnpj}, {endereco}) é a controladora: é ela quem decide como seus dados são usados. Contato do encarregado de dados: {contato_encarregado}.

2. Quem trata os dados em nome da clínica. A clínica usa o sistema Odonto Connect, que trata os dados como operador, seguindo as instruções da clínica. Para a transcrição, o Odonto Connect usa a OpenAI como suboperadora, contratada para essa função.

3. O que é feito e para quê. Com a sua autorização:
(a) o áudio da consulta é gravado no aparelho da clínica;
(b) o áudio é enviado à OpenAI, que o transforma em texto;
(c) o texto é enviado novamente à OpenAI para ser organizado em um rascunho de relatório clínico;
(d) o cirurgião-dentista lê, corrige e decide o que entra no seu prontuário.
(e) se a clínica usar, o relatório também pode ser enviado à OpenAI para sugerir mensagens de orientação depois da consulta, que a equipe revisa antes de enviar.
A finalidade é exclusivamente o registro clínico do seu atendimento. Nada disso é usado para propaganda, venda de dados ou qualquer outro fim. Nenhuma decisão sobre você é tomada pela IA, porque o dentista revisa tudo.

4. Transferência para fora do Brasil. Os servidores da OpenAI ficam nos Estados Unidos. A transferência é feita com base nesta autorização específica (Lei nº 13.709/2018, art. 33, VIII) e nas garantias contratuais firmadas com o provedor.

5. Por quanto tempo.
- Áudio: não fica guardado no sistema da clínica. É apagado logo depois da transcrição.
- Na OpenAI: o provedor {retencao} mantém registros técnicos para segurança e prevenção de abuso. Depois disso, eles são apagados. O provedor não usa o conteúdo para treinar modelos de IA.
- Texto revisado: passa a fazer parte do seu prontuário odontológico, que a lei manda guardar por no mínimo 20 anos desde o último registro (Lei nº 13.787/2018, art. 6º).

6. Você não é obrigado(a). Autorizar é opcional. Se não autorizar, você é atendido(a) normalmente, e o dentista registra a consulta da forma tradicional.

7. Como mudar de ideia (revogar). Você pode revogar a qualquer momento, sem custo e sem explicar o motivo: na recepção, com o dentista ou por mensagem para a clínica. A partir da revogação, nenhuma consulta é gravada. O que já foi registrado no prontuário continua lá, porque faz parte do seu histórico clínico. Os registros técnicos já enviados ao provedor são apagados no prazo do item 5.

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

const VARIAVEIS = ['clinica', 'cnpj', 'endereco', 'contato_encarregado', 'retencao', 'paciente'];

function preencher(template, vars) {
  let out = template;
  for (const k of VARIAVEIS) {
    out = out.split(`{${k}}`).join(String(vars[k] ?? '').trim());
  }
  return out;
}

/**
 * Monta o texto exibido (curta + completa + as duas opções) de uma versão do catálogo,
 * com as variáveis da clínica, e o SHA-256 desse texto exato. Retorna null se a versão não existe.
 */
export function montarTextoConsentimento(tipo, versao, vars) {
  const v = CONSENT_CATALOGO[tipo]?.[versao];
  if (!v) return null;
  const valores = {
    clinica: vars.clinica || 'clínica',
    cnpj: vars.cnpj || 'CNPJ não informado',
    endereco: vars.endereco || 'endereço não informado',
    contato_encarregado: vars.contato_encarregado || '',
    retencao: vars.retencao || retencaoProvedor(),
    paciente: vars.paciente || 'o paciente',
  };
  const curta = preencher(v.curta, valores);
  const completa = preencher(v.completa, valores);
  const opcoes = { autorizo: preencher(v.opcoes.autorizo, valores), nao_autorizo: preencher(v.opcoes.nao_autorizo, valores) };
  const texto = [curta, '', `( ) ${opcoes.autorizo}`, `( ) ${opcoes.nao_autorizo}`, '', '---', '', completa].join('\n');
  return { versao, curta, completa, opcoes, texto, hash: sha256(texto) };
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
