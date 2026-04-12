/**
 * Gera um PDF de prescrição médica odontológica e abre para impressão/download.
 */

interface Prescricao {
  medicamento: string;
  dosagem: string;
  posologia: string;
  duracao: string;
}

interface PrescricaoData {
  pacienteNome: string;
  pacienteCpf?: string;
  pacienteTelefone?: string;
  pacienteIdade?: number;
  profissional: string;
  croProfissional?: string;
  prescricoes: Prescricao[];
  observacoes?: string;
}

export function exportarPrescricaoPdf(data: PrescricaoData) {
  const dataAtual = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Prescrição - ${data.pacienteNome}</title>
<style>
  @page { size: A4; margin: 20mm 25mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; line-height: 1.5; }
  
  .header { text-align: center; border-bottom: 2px solid #0d9488; padding-bottom: 16px; margin-bottom: 20px; }
  .header h1 { font-size: 20px; color: #0d9488; font-weight: 700; letter-spacing: 1px; }
  .header .subtitle { font-size: 11px; color: #666; margin-top: 4px; }
  
  .rx-symbol { font-size: 28px; font-weight: 800; color: #0d9488; text-align: left; margin: 16px 0 8px; }
  
  .patient-info { background: #f8fafb; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; }
  .patient-info .row { display: flex; gap: 32px; margin-bottom: 4px; font-size: 13px; }
  .patient-info .label { color: #666; font-weight: 500; min-width: 80px; }
  .patient-info .value { color: #1a1a2e; font-weight: 600; }
  
  .prescricao-item { border-left: 3px solid #0d9488; padding: 12px 16px; margin-bottom: 14px; background: #fafffe; border-radius: 0 6px 6px 0; }
  .prescricao-item .medicamento { font-size: 15px; font-weight: 700; color: #1a1a2e; margin-bottom: 4px; }
  .prescricao-item .detalhes { font-size: 13px; color: #444; }
  .prescricao-item .detalhes span { display: inline-block; margin-right: 20px; }
  .prescricao-item .detalhes .dlabel { color: #888; font-size: 11px; text-transform: uppercase; display: block; }

  .observacoes { margin-top: 24px; padding: 14px 18px; background: #fffbf0; border: 1px solid #f0e6c8; border-radius: 8px; font-size: 13px; color: #666; }
  .observacoes strong { color: #b8860b; }
  
  .footer { margin-top: 60px; text-align: center; }
  .footer .linha { border-top: 1px solid #333; width: 280px; margin: 0 auto 8px; }
  .footer .nome { font-size: 14px; font-weight: 600; color: #1a1a2e; }
  .footer .cro { font-size: 12px; color: #666; }
  
  .data { text-align: right; font-size: 12px; color: #888; margin-top: 24px; }
  
  .disclaimer { margin-top: 40px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="no-print" style="text-align:center;padding:12px;background:#0d9488;color:#fff;font-size:14px;cursor:pointer;" onclick="window.print()">
    🖨️ Clique aqui para imprimir ou salvar como PDF
  </div>

  <div class="header">
    <h1>ODONTO CONNECT</h1>
    <div class="subtitle">Clínica Odontológica • Prescrição Médica</div>
  </div>

  <div class="patient-info">
    <div class="row">
      <span class="label">Paciente:</span>
      <span class="value">${data.pacienteNome}</span>
      ${data.pacienteIdade ? `<span class="label" style="margin-left:auto;">Idade:</span><span class="value">${data.pacienteIdade} anos</span>` : ""}
    </div>
    ${data.pacienteTelefone ? `<div class="row"><span class="label">Telefone:</span><span class="value">${data.pacienteTelefone}</span></div>` : ""}
  </div>

  <div class="rx-symbol">Rx</div>

  ${data.prescricoes.map((rx, i) => `
    <div class="prescricao-item">
      <div class="medicamento">${i + 1}. ${rx.medicamento} ${rx.dosagem ? `— ${rx.dosagem}` : ""}</div>
      <div class="detalhes">
        ${rx.posologia ? `<span><span class="dlabel">Posologia</span>${rx.posologia}</span>` : ""}
        ${rx.duracao ? `<span><span class="dlabel">Duração</span>${rx.duracao}</span>` : ""}
      </div>
    </div>
  `).join("")}

  ${data.observacoes ? `
    <div class="observacoes">
      <strong>Observações:</strong> ${data.observacoes}
    </div>
  ` : ""}

  <div class="data">${dataAtual}</div>

  <div class="footer">
    <div class="linha"></div>
    <div class="nome">${data.profissional}</div>
    ${data.croProfissional ? `<div class="cro">CRO: ${data.croProfissional}</div>` : `<div class="cro">Cirurgião(ã) Dentista</div>`}
  </div>

  <div class="disclaimer">
    Este documento foi gerado eletronicamente pelo sistema Odonto Connect.
  </div>
</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
