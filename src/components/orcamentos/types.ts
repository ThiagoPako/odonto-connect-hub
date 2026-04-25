/**
 * Item estruturado de orçamento (Fase B)
 * Cada item liga 1 procedimento a 1 dente (opcionalmente com faces)
 */
export interface OrcamentoItemEstruturado {
  id: string;                 // uuid local (não persistido até salvar)
  procedimento_id: string;    // FK procedimentos_catalogo
  procedimento_nome: string;
  procedimento_codigo?: string | null;
  dente?: number | null;      // FDI
  faces?: string[];           // ["V","O",...]
  quantidade: number;
  valor_unitario: number;
  valor_total: number;        // quantidade * valor_unitario
  cor?: string;
  observacao?: string;
}

export interface PrintConfig {
  logo: boolean;
  cabecalho_clinica: boolean;
  valores: boolean;
  desconto: boolean;
  odontograma: boolean;
  observacoes: boolean;
  assinatura: boolean;
  pe_dentista: boolean;
  data_validade: boolean;
}

export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  logo: true,
  cabecalho_clinica: true,
  valores: true,
  desconto: true,
  odontograma: true,
  observacoes: true,
  assinatura: true,
  pe_dentista: true,
  data_validade: true,
};
