/**
 * Pré-visualização de impressão do orçamento (Fase B)
 * Renderiza um layout A4 white-paper respeitando os toggles de PrintConfig.
 * Usa window.print() para impressão real (CSS de print-only escondido em outros componentes).
 */
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import { OdontogramaInterativo, type FaceSelection } from "./OdontogramaInterativo";
import type { OrcamentoItemEstruturado, PrintConfig } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paciente: { nome: string; telefone?: string; cpf?: string };
  dentista?: { nome?: string; cro?: string; especialidade?: string } | null;
  titulo: string;
  itens: OrcamentoItemEstruturado[];
  subtotal: number;
  desconto: number;
  total: number;
  observacoes: string;
  formaPagamento: string;
  parcelas: number;
  selections: FaceSelection[];
  config: PrintConfig;
}

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function OrcamentoPrintPreview({
  open, onOpenChange, paciente, dentista, titulo,
  itens, subtotal, desconto, total, observacoes, formaPagamento, parcelas,
  selections, config,
}: Props) {
  const hoje = new Date().toLocaleDateString("pt-BR");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/40 print:hidden">
          <span className="text-sm font-medium">Pré-visualização de impressão</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => window.print()} className="h-8 text-xs">
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Imprimir
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-xs">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Folha A4 simulada */}
        <div id="print-area" className="bg-white text-black p-8 mx-auto" style={{ width: "210mm", minHeight: "297mm" }}>
          {/* Cabeçalho */}
          {(config.logo || config.cabecalho_clinica) && (
            <header className="flex items-center justify-between border-b-2 border-teal-700 pb-4 mb-6">
              {config.logo && (
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-xl">
                    OC
                  </div>
                  <div>
                    <h1 className="text-lg font-bold text-teal-700">Odonto Connect</h1>
                    <p className="text-[10px] text-gray-500">Sistema de Gestão Odontológica</p>
                  </div>
                </div>
              )}
              {config.cabecalho_clinica && (
                <div className="text-right text-[11px] text-gray-700">
                  <p className="font-semibold">Clínica Odonto Connect</p>
                  <p>contato@odontoconnect.com.br</p>
                  <p>Data: {hoje}</p>
                </div>
              )}
            </header>
          )}

          {/* Título + dados do paciente */}
          <h2 className="text-base font-bold text-center mb-4 uppercase tracking-wide">{titulo}</h2>

          <div className="grid grid-cols-2 gap-4 text-xs mb-6 border border-gray-300 rounded p-3">
            <div>
              <p className="text-[10px] uppercase text-gray-500 font-semibold">Paciente</p>
              <p className="font-semibold">{paciente.nome}</p>
              {paciente.cpf && <p className="text-gray-600">CPF: {paciente.cpf}</p>}
              {paciente.telefone && <p className="text-gray-600">Tel: {paciente.telefone}</p>}
            </div>
            {dentista?.nome && (
              <div className="text-right">
                <p className="text-[10px] uppercase text-gray-500 font-semibold">Profissional</p>
                <p className="font-semibold">{dentista.nome}</p>
                {dentista.cro && <p className="text-gray-600">CRO: {dentista.cro}</p>}
                {dentista.especialidade && <p className="text-gray-600">{dentista.especialidade}</p>}
              </div>
            )}
          </div>

          {/* Odontograma */}
          {config.odontograma && selections.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-semibold mb-2 uppercase tracking-wide text-gray-700">Odontograma</p>
              <div className="border border-gray-300 rounded p-2">
                <OdontogramaInterativo
                  selections={selections}
                  onChange={() => {}}
                  readOnly
                  showHeader={false}
                />
              </div>
            </div>
          )}

          {/* Tabela de itens */}
          <table className="w-full text-xs mb-4 border-collapse">
            <thead>
              <tr className="bg-teal-50 border-b-2 border-teal-700">
                <th className="text-left py-2 px-2 font-semibold">Procedimento</th>
                <th className="text-center py-2 px-2 font-semibold">Dente / Face</th>
                <th className="text-center py-2 px-2 font-semibold">Qtd</th>
                {config.valores && <th className="text-right py-2 px-2 font-semibold">Vlr Unit.</th>}
                {config.valores && <th className="text-right py-2 px-2 font-semibold">Total</th>}
              </tr>
            </thead>
            <tbody>
              {itens.map((it, i) => (
                <tr key={it.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="py-1.5 px-2">{it.procedimento_nome}</td>
                  <td className="text-center py-1.5 px-2">
                    {it.dente ? `${it.dente}${it.faces && it.faces.length ? ` (${it.faces.join(",")})` : ""}` : "—"}
                  </td>
                  <td className="text-center py-1.5 px-2">{it.quantidade}</td>
                  {config.valores && <td className="text-right py-1.5 px-2">{fmt(it.valor_unitario)}</td>}
                  {config.valores && <td className="text-right py-1.5 px-2 font-semibold">{fmt(it.valor_total)}</td>}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totais */}
          {config.valores && (
            <div className="ml-auto w-64 text-xs space-y-1 mb-6">
              <div className="flex justify-between border-b border-gray-300 py-1">
                <span>Subtotal:</span><span>{fmt(subtotal)}</span>
              </div>
              {config.desconto && desconto > 0 && (
                <div className="flex justify-between border-b border-gray-300 py-1 text-red-700">
                  <span>Desconto:</span><span>- {fmt(desconto)}</span>
                </div>
              )}
              <div className="flex justify-between py-1.5 font-bold text-base text-teal-700 border-b-2 border-teal-700">
                <span>TOTAL:</span><span>{fmt(total)}</span>
              </div>
              {formaPagamento && (
                <p className="text-[11px] text-gray-600 pt-1">
                  Pagamento: <span className="font-semibold">{formaPagamento}</span>
                  {parcelas > 1 && ` em ${parcelas}x de ${fmt(total / parcelas)}`}
                </p>
              )}
            </div>
          )}

          {/* Observações */}
          {config.observacoes && observacoes && (
            <div className="border border-gray-300 rounded p-3 mb-6 text-xs">
              <p className="font-semibold mb-1 text-[10px] uppercase tracking-wide text-gray-500">Observações</p>
              <p className="whitespace-pre-wrap text-gray-700">{observacoes}</p>
            </div>
          )}

          {/* Validade */}
          {config.data_validade && (
            <p className="text-[10px] text-gray-500 italic mb-8 text-center">
              Orçamento válido por 30 dias a partir da data de emissão.
            </p>
          )}

          {/* Assinaturas */}
          {config.assinatura && (
            <div className="grid grid-cols-2 gap-12 mt-16">
              <div className="text-center">
                <div className="border-t border-black pt-1">
                  <p className="text-xs">{paciente.nome}</p>
                  <p className="text-[10px] text-gray-500">Paciente</p>
                </div>
              </div>
              {config.pe_dentista && (
                <div className="text-center">
                  <div className="border-t border-black pt-1">
                    <p className="text-xs">{dentista?.nome ?? "Profissional Responsável"}</p>
                    {dentista?.cro && <p className="text-[10px] text-gray-500">CRO {dentista.cro}</p>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Print CSS */}
        <style>{`
          @media print {
            body * { visibility: hidden; }
            #print-area, #print-area * { visibility: visible; }
            #print-area { position: absolute; left: 0; top: 0; width: 100%; }
            @page { size: A4; margin: 0; }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
