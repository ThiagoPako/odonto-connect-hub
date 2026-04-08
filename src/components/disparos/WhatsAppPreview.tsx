import { Check } from "lucide-react";

interface WhatsAppPreviewProps {
  mensagem: string;
  nomeContato?: string;
}

export function WhatsAppPreview({ mensagem, nomeContato = "Luíza" }: WhatsAppPreviewProps) {
  // Replace variables with example values
  const previewMsg = mensagem
    .replace(/\{\{nome\}\}/g, nomeContato)
    .replace(/\{\{data\}\}/g, "15/04/2026")
    .replace(/\{\{horario\}\}/g, "14:00")
    .replace(/\{\{dentista\}\}/g, "Dr. Rafael")
    .replace(/\{\{procedimento\}\}/g, "Limpeza");

  return (
    <div className="bg-muted/30 rounded-xl border border-border p-4">
      <h4 className="text-xs font-semibold text-muted-foreground mb-3">Preview do Disparo</h4>
      <div className="bg-[#e5ddd5] rounded-xl overflow-hidden max-w-[280px] mx-auto">
        {/* WhatsApp header */}
        <div className="bg-[#075e54] px-3 py-2 flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-[#128c7e] flex items-center justify-center text-[10px] font-bold text-white">
            {nomeContato.charAt(0)}
          </div>
          <span className="text-white text-xs font-medium">{nomeContato}</span>
        </div>
        {/* Chat area */}
        <div className="p-3 min-h-[200px] space-y-2" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}>
          {/* Outgoing message bubble */}
          <div className="flex justify-end">
            <div className="bg-[#dcf8c6] rounded-lg rounded-tr-none px-3 py-2 max-w-[240px] shadow-sm">
              <p className="text-[11px] text-[#303030] whitespace-pre-line leading-relaxed">
                {previewMsg || "Sua mensagem aparecerá aqui..."}
              </p>
              <div className="flex items-center justify-end gap-1 mt-1">
                <span className="text-[9px] text-[#999]">17:30</span>
                <Check className="h-3 w-3 text-[#4fc3f7]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
