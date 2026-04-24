/**
 * Gera um relatório PDF consolidado de relatórios clínicos via janela de impressão.
 */

interface ReportRow {
  id: string;
  patient_name?: string;
  attendant_name?: string;
  queixa_principal?: string;
  procedimento?: string;
  dente_regiao?: string;
  duration_seconds?: number;
  prescricoes?: Array<{ medicamento: string; dosagem: string; posologia: string; duracao: string }> | string;
  created_at: string;
}

interface ExportFilters {
  from?: string;
  to?: string;
  status?: string;
  paciente?: string;
}

export function exportarRelatoriosClinicosPdf(reports: ReportRow[], filters: ExportFilters = {}) {
  const dataAtual = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });

  const totalDuration = reports.reduce((s, r) => s + (r.duration_seconds || 0), 0);
  const comPrescricao = reports.filter(r => {
    const p = Array.isArray(r.prescricoes) ? r.prescricoes : (typeof r.prescricoes === 'string' ? JSON.parse(r.prescricoes || '[]') : []);
    return p.length > 0;
  }).length;
  const pacientesUnicos = new Set(reports.map(r => r.patient_name)).size;

  const filterLabels: string[] = [];
  if (filters.from) filterLabels.push(`De: ${new Date(filters.from).toLocaleDateString("pt-BR")}`);
  if (filters.to) filterLabels.push(`Até: ${new Date(filters.to).toLocaleDateString("pt-BR")}`);
  if (filters.status && filters.status !== 'todos') {
    filterLabels.push(`Status: ${filters.status === 'com_prescricao' ? 'Com prescrição' : 'Sem prescrição'}`);
  }
  if (filters.paciente) filterLabels.push(`Paciente: ${filters.paciente}`);

  const rowsHtml = reports.map((r, i) => {
    const presc = Array.isArray(r.prescricoes) ? r.prescricoes : (typeof r.prescricoes === 'string' ? JSON.parse(r.prescricoes || '[]') : []);
    const created = new Date(r.created_at);
    const data = created.toLocaleDateString("pt-BR");
    const hora = created.toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' });
    const dur = Math.round((r.duration_seconds || 0) / 60);

    return `
      <tr style="border-bottom:1px solid #e2e8f0;${i % 2 === 1 ? 'background:#f8fafb;' : ''}">
        <td style="padding:8px 10px;font-size:11px;color:#444;">${data}<br/><span style="color:#888;">${hora}</span></td>
        <td style="padding:8px 10px;font-size:11px;font-weight:600;color:#1a1a2e;">${r.patient_name || '-'}</td>
        <td style="padding:8px 10px;font-size:11px;color:#444;">${r.attendant_name || '-'}</td>
        <td style="padding:8px 10px;font-size:11px;color:#444;">${r.queixa_principal || '-'}</td>
        <td style="padding:8px 10px;font-size:11px;color:#444;">${r.procedimento || '-'}</td>
        <td style="padding:8px 10px;font-size:11px;color:#444;text-align:center;">${r.dente_regiao || '-'}</td>
        <td style="padding:8px 10px;font-size:11px;color:#444;text-align:center;">${dur} min</td>
        <td style="padding:8px 10px;text-align:center;">
          <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;background:${presc.length > 0 ? '#0d948815' : '#94a3b815'};color:${presc.length > 0 ? '#0d9488' : '#64748b'};border:1px solid ${presc.length > 0 ? '#0d948830' : '#94a3b830'};">${presc.length} Rx</span>
        </td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatórios Clínicos - Odonto Connect</title>
<style>
  @page { size: A4 landscape; margin: 14mm 18mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; line-height: 1.4; }

  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0d9488; padding-bottom: 12px; margin-bottom: 14px; }
  .header h1 { font-size: 18px; color: #0d9488; font-weight: 700; letter-spacing: 1px; }
  .header .subtitle { font-size: 11px; color: #666; }
  .header .date { font-size: 11px; color: #888; text-align: right; }

  .filters { background: #f1f5f9; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; font-size: 11px; color: #475569; }
  .filters strong { color: #0d9488; }

  .kpis { display: flex; gap: 14px; margin-bottom: 16px; }
  .kpi { flex: 1; background: #f8fafb; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; text-align: center; }
  .kpi .value { font-size: 18px; font-weight: 700; color: #0d9488; }
  .kpi .label { font-size: 10px; color: #888; text-transform: uppercase; margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  thead th { background: #0d9488; color: #fff; padding: 9px 10px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }

  .footer { margin-top: 22px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 10px; }

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
    <div>
      <h1>ODONTO CONNECT</h1>
      <div class="subtitle">Relatórios Clínicos IA — Histórico Consolidado</div>
    </div>
    <div class="date">Gerado em: ${dataAtual}</div>
  </div>

  ${filterLabels.length ? `<div class="filters"><strong>Filtros:</strong> ${filterLabels.join(' · ')}</div>` : ''}

  <div class="kpis">
    <div class="kpi"><div class="value">${reports.length}</div><div class="label">Relatórios</div></div>
    <div class="kpi"><div class="value">${pacientesUnicos}</div><div class="label">Pacientes</div></div>
    <div class="kpi"><div class="value">${comPrescricao}</div><div class="label">C/ Prescrição</div></div>
    <div class="kpi"><div class="value">${reports.length - comPrescricao}</div><div class="label">S/ Prescrição</div></div>
    <div class="kpi"><div class="value">${Math.round(totalDuration / 60)}</div><div class="label">Min Totais</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Data/Hora</th>
        <th>Paciente</th>
        <th>Dentista</th>
        <th>Queixa</th>
        <th>Procedimento</th>
        <th style="text-align:center;">Dente/Região</th>
        <th style="text-align:center;">Duração</th>
        <th style="text-align:center;">Prescrições</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;padding:24px;color:#888;font-size:12px;">Nenhum relatório encontrado</td></tr>'}</tbody>
  </table>

  <div class="footer">Relatório gerado eletronicamente pelo sistema Odonto Connect • ${dataAtual}</div>
</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
