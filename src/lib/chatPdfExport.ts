import type { ChatMessage } from "@/data/chatMockData";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function exportChatToPdf(messages: ChatMessage[], leadName: string, leadPhone: string) {
  const grouped = new Map<string, ChatMessage[]>();
  for (const msg of messages) {
    const key = formatDate(msg.timestamp);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(msg);
  }

  let rows = "";
  for (const [date, msgs] of grouped) {
    rows += `<tr><td colspan="3" style="text-align:center;padding:12px 0 6px;font-size:11px;color:#888;font-weight:600;">── ${date} ──</td></tr>`;
    for (const msg of msgs) {
      const sender = msg.sender === "lead" ? leadName : "Atendente";
      const senderColor = msg.sender === "lead" ? "#2563eb" : "#16a34a";
      const content = msg.type === "audio"
        ? "🎤 Áudio"
        : msg.type === "image"
          ? "📷 Imagem"
          : msg.type === "document"
            ? `📄 ${msg.fileName || "Documento"}`
            : msg.type === "location"
              ? "📍 Localização"
              : escapeHtml(msg.content || "");

      rows += `<tr>
        <td style="padding:4px 8px;font-size:11px;color:#999;white-space:nowrap;vertical-align:top;">${formatTime(msg.timestamp)}</td>
        <td style="padding:4px 8px;font-size:12px;font-weight:600;color:${senderColor};white-space:nowrap;vertical-align:top;">${escapeHtml(sender)}</td>
        <td style="padding:4px 8px;font-size:12px;color:#333;word-break:break-word;">${content}</td>
      </tr>`;
    }
  }

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<title>Conversa - ${escapeHtml(leadName)}</title>
<style>
  @media print { body { margin: 0; } @page { margin: 1.5cm; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
  .header { border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }
  .header h1 { font-size: 18px; color: #2563eb; margin: 0; }
  .header p { font-size: 12px; color: #666; margin: 4px 0 0; }
  table { width: 100%; border-collapse: collapse; }
  tr:hover td { background: #f8f9fa; }
  .footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #eee; text-align: center; font-size: 10px; color: #aaa; }
</style>
</head><body>
<div class="header">
  <h1>💬 Histórico de Conversa</h1>
  <p><strong>Paciente:</strong> ${escapeHtml(leadName)} &nbsp;|&nbsp; <strong>Telefone:</strong> ${escapeHtml(leadPhone)}</p>
  <p><strong>Total de mensagens:</strong> ${messages.length} &nbsp;|&nbsp; <strong>Exportado em:</strong> ${formatDate(new Date())} às ${formatTime(new Date())}</p>
</div>
<table>${rows}</table>
<div class="footer">Odonto Connect — Histórico exportado automaticamente. Mensagens protegidas contra exclusão.</div>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) {
    win.onload = () => {
      setTimeout(() => {
        win.print();
        URL.revokeObjectURL(url);
      }, 500);
    };
  }
}
