import { vpsApiFetch } from "@/lib/vpsApi";

/** Documentos que a clínica aceita (vps-api-server/legal.mjs, PR #70). */
export type DocumentoLegal = "termos" | "politica" | "modelo_clinica";

export interface PendenciaLegal {
  documento: DocumentoLegal;
  versao: string;
  vigente_em: string;
}

export interface AvisoLegal {
  documento: DocumentoLegal;
  versao: string;
  avisado_em: string;
  vigente_em: string;
}

export interface PendenciasLegais {
  /** Versões já em vigor que a clínica ainda não aceitou. */
  pendentes: PendenciaLegal[];
  /** Versões publicadas que ainda não valem (período de aviso de 30 dias). */
  avisos: AvisoLegal[];
  /** true só para o admin da clínica com pendência: é ele quem aceita. */
  precisa_aceitar: boolean;
  pode_aceitar?: boolean;
}

export const NOME_DOCUMENTO: Record<DocumentoLegal, string> = {
  termos: "Termos de Uso",
  politica: "Política de Privacidade",
  modelo_clinica: "Modelo de política para a clínica",
};

export const ROTA_DOCUMENTO: Record<DocumentoLegal, "/termos" | "/privacidade" | "/modelo-politica-clinica"> = {
  termos: "/termos",
  politica: "/privacidade",
  modelo_clinica: "/modelo-politica-clinica",
};

/** vpsApiFetch não lança: o erro vem em `error`. */
export const legalApi = {
  pendencias: () => vpsApiFetch<PendenciasLegais>("/legal/pendencias", { background: true }),
  aceitar: (documento: DocumentoLegal, versao: string) =>
    vpsApiFetch<{ aceite: { id: string; documento: string; versao: string; aceito_em: string } }>("/legal/aceites", {
      method: "POST",
      body: { documento, versao },
    }),
};
