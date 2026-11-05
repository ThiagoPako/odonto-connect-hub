/**
 * Dados e versões dos documentos legais (Termos de Uso e Política de Privacidade).
 * Redação v2: docs/juridico/politica-e-termos-v2.md (Helena, 05/11/2026).
 *
 * ⚠️ PREENCHER antes de publicar (decisão e dados do dono; nada aqui foi inventado):
 * a LGPD exige identificar o controlador (art. 9º, III) e divulgar o encarregado (art. 41, §1º).
 * Enquanto houver "[PREENCHER", as páginas mostram o aviso de documento em revisão e destacam o campo.
 *
 * Ao mudar o conteúdo dos documentos, suba a versão e a data: o aceite no cadastro guarda a versão.
 */
export const LEGAL_INFO = {
  marca: "Odonto Connect",
  /** P1 */ razaoSocial: "[PREENCHER razão social]",
  /** P2 */ cnpj: "[PREENCHER CNPJ]",
  /** P3 */ endereco: "[PREENCHER endereço completo]",
  /** P4 */ foro: "[PREENCHER cidade/UF do foro]",
  /** P5 */ encarregadoNome: "[PREENCHER nome do encarregado (DPO)]",
  /** P6 */ emailPrivacidade: "[PREENCHER e-mail do encarregado]",
  /** P7: legal.ts usava contato@odontoconnect.com; o servidor e o site usam odontoconnect.tech. Conferir. */
  emailContato: "[PREENCHER e-mail de contato: odontoconnect.com ou odontoconnect.tech?]",
  /** P8 */ hospedagem: "[PREENCHER provedor da VPS e do banco]",
  /** P8 */ hospedagemPais: "[PREENCHER país]",
  /** P9 */ backups: "[PREENCHER provedor dos backups]",
  /** P9 */ backupsPais: "[PREENCHER país]",
  /** P10: gateway que cobra a assinatura. Se não houver, troque por "" (a frase some da Política). */
  pagamentos: "[PREENCHER gateway de pagamento, ou deixar vazio se não houver]",
  /** P11: "zero" (retenção zero contratada) ou "30 dias". */
  iaRetencao: "[PREENCHER retenção da OpenAI: zero ou 30 dias]",
  /** P12 (sugestão da Helena: 48) */ prazoIncidenteHoras: "[PREENCHER horas]",
  /** P13 (sugestão: 30) */ prazoSuboperadorDias: "[PREENCHER dias]",
  /** P14 (sugestão: 60) */ prazoEliminacaoPosCancelamentoDias: "[PREENCHER dias]",
};

export const TERMOS_VERSAO = "2.0";
export const POLITICA_VERSAO = "2.0";
/** Modelo de política de privacidade que a clínica adapta e publica para os pacientes (/modelo-politica-clinica). */
export const MODELO_POLITICA_CLINICA_VERSAO = "1.0";
/** P16: data da publicação da v2. Atualizar no dia em que o dono preencher e publicar. */
export const DOCUMENTOS_ATUALIZADOS_EM = "[PREENCHER data da publicação]";

export const pendente = (v: string) => v.includes("[PREENCHER");

export const legalIncompleto =
  Object.values(LEGAL_INFO).some(pendente) || pendente(DOCUMENTOS_ATUALIZADOS_EM);
