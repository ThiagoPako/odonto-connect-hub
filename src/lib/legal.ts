/**
 * Dados e versões dos documentos legais (Termos de Uso e Política de Privacidade).
 *
 * ⚠️ PREENCHER antes de publicar: a LGPD exige identificar o controlador (art. 9º, III)
 * e divulgar publicamente o encarregado/DPO (art. 41, §1º). Enquanto houver "[PREENCHER",
 * a página exibe um aviso.
 *
 * Ao mudar o conteúdo dos documentos, suba a versão e a data: o aceite no cadastro
 * guarda a versão aceita.
 */
export const LEGAL_INFO = {
  marca: "Odonto Connect",
  razaoSocial: "[PREENCHER razão social]",
  cnpj: "[PREENCHER CNPJ]",
  endereco: "[PREENCHER endereço completo]",
  foro: "[PREENCHER cidade/UF do foro]",
  emailContato: "contato@odontoconnect.com",
  emailPrivacidade: "[PREENCHER e-mail do encarregado, ex.: privacidade@odontoconnect.com]",
  encarregadoNome: "[PREENCHER nome do encarregado (DPO)]",
};

export const TERMOS_VERSAO = "1.0";
export const POLITICA_VERSAO = "1.0";
export const DOCUMENTOS_ATUALIZADOS_EM = "04/11/2026";

export const legalIncompleto = Object.values(LEGAL_INFO).some((v) => v.includes("[PREENCHER"));
