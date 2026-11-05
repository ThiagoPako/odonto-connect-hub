import { LEGAL_INFO, pendente } from "@/lib/legal";

/**
 * Dados da oferta mostrados nas páginas públicas (landing e cadastro).
 * Toda informação de venda vem daqui, para não haver dois valores diferentes (CDC art. 31).
 *
 * ⚠️ PENDENTE (decisão do dono): prazo do teste grátis. A landing antiga dizia 7 dias; o cadastro e
 * o banco (`plans.trial_days`, padrão 14 em `server.mjs`) dão 14. O valor abaixo segue o que o
 * sistema concede hoje. Se o dono escolher outro prazo, mude aqui E no `trial_days` dos planos.
 */
export const TESTE_GRATIS_DIAS = 14;

export const TESTE_GRATIS_TEXTO = `${TESTE_GRATIS_DIAS} dias grátis`;

/**
 * ⚠️ PENDENTE: WhatsApp do consultor. O número que estava na landing (wa.me/5511999990001) é
 * provisório e pode ser de um terceiro (parecer da Helena, item 13). Enquanto for `null`, os botões
 * de WhatsApp ficam escondidos e a landing usa o e-mail de contato.
 */
export const WHATSAPP_CONSULTOR: string | null = null;

/** E-mail de contato da landing. `null` enquanto o dono não confirmar o domínio (P7 em legal.ts):
 * os links de e-mail ficam escondidos em vez de apontar para "[PREENCHER…]". */
export const EMAIL_CONTATO: string | null = pendente(LEGAL_INFO.emailContato) ? null : LEGAL_INFO.emailContato;
