/**
 * Gera um relatório PDF de tratamentos em andamento via janela de impressão.
 */

interface TratamentoReport {
  paciente_nome: string;
  dentista_nome: string;
  descricao: string;
  plano: string;
  valor: number;
  status: string;
  created_at: string;
  etapas_total: number;
  etapas_concluidas: number;
}

const statusLabels: Record<string, string> = {
  planejado: 'Planejado',
  em_andamento: 'Em Andamento',
  pausado: 'Pausado',
  finalizado: 'Finalizado',
};

const statusColors: Record<string, string> = {
  planejado: '#3b82f6',
  em_andamento: '#0d9488',
  pausado: '#f59e0b',
  finalizado: '#6b7280',
};

export function exportarTratamentosPdf(tratamentos: TratamentoReport[]) {
  const dataAtual = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });

  const totalValor = tratamentos.reduce((s, t) => s + t.valor, 0);
  const emAndamento = tratamentos.filter(t => t.status === 'em_andamento').length;
  const planejados = tratamentos.filter(t => t.status === 'planejado').length;
  const pausados = tratamentos.filter(t => t.status === 'pausado').length;

  const rowsHtml = tratamentos.map((t, i) => {
    const progress = t.etapas_total > 0 ? Math.round((t.etapas_concluidas / t.etapas_total) * 100) : 0;
    const statusColor = statusColors[t.status] || '#6b7280';
    const statusLabel = statusLabels[t.status] || t.status;
    const created = t.created_at ? new Date(t.created_at).toLocaleDateString("pt-BR") : '-';

    return `
      <tr style="border-bottom:1px solid #e2e8f0;${i % 2 === 1 ? 'background:#f8fafb;' : ''}">
        <td style="padding:10px 12px;font-size:12px;font-weight:600;color:#1a1a2e;">${t.paciente_nome}</td>
        <td style="padding:10px 12px;font-size:12px;color:#444;">${t.dentista_nome}</td>
        <td style="padding:10px 12px;font-size:12px;color:#444;">${t.descricao}</td>
        <td style="padding:10px 12px;font-size:12px;color:#444;">${t.plano || '-'}</td>
        <td style="padding:10px 12px;font-size:12px;text-align:right;font-weight:600;">R$ ${t.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
        <td style="padding:10px 12px;text-align:center;">
          <span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;background:${statusColor}15;color:${statusColor};border:1px solid ${statusColor}30;">${statusLabel}</span>
        </td>
        <td style="padding:10px 12px;text-align:center;">
          <div style="display:flex;align-items:center;gap:6px;justify-content:center;">
            <div style="width:50px;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;">
              <div style="width:${progress}%;height:100%;background:${statusColor};border-radius:3px;"></div>
            </div>
            <span style="font-size:10px;color:#666;">${progress}%</span>
          </div>
        </td>
        <td style="padding:10px 12px;font-size:11px;color:#888;text-align:center;">${created}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Tratamentos - Odonto Connect</title>
<style>
  @page { size: A4 landscape; margin: 15mm 20mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; line-height: 1.4; }

  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0d9488; padding-bottom: 14px; margin-bottom: 16px; }
  .header h1 { font-size: 18px; color: #0d9488; font-weight: 700; letter-spacing: 1px; }
  .header .subtitle { font-size: 11px; color: #666; }
  .header .date { font-size: 11px; color: #888; text-align: right; }

  .kpis { display: flex; gap: 16px; margin-bottom: 18px; }
  .kpi { flex: 1; background: #f8fafb; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; text-align: center; }
  .kpi .value { font-size: 20px; font-weight: 700; color: #0d9488; }
  .kpi .label { font-size: 10px; color: #888; text-transform: uppercase; margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  thead th { background: #0d9488; color: #fff; padding: 10px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }

  .footer { margin-top: 24px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 10px; }

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
      <div class="subtitle">Relatório de Tratamentos em Andamento</div>
    </div>
    <div class="date">Gerado em: ${dataAtual}</div>
  </div>

  <div class="kpis">
    <div class="kpi">
      <div class="value">${tratamentos.length}</div>
      <div class="label">Total Tratamentos</div>
    </div>
    <div class="kpi">
      <div class="value">${emAndamento}</div>
      <div class="label">Em Andamento</div>
    </div>
    <div class="kpi">
      <div class="value">${planejados}</div>
      <div class="label">Planejados</div>
    </div>
    <div class="kpi">
      <div class="value">${pausados}</div>
      <div class="label">Pausados</div>
    </div>
    <div class="kpi">
      <div class="value">R$ ${(totalValor / 1000).toFixed(1)}k</div>
      <div class="label">Valor Total</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Paciente</th>
        <th>Dentista</th>
        <th>Tratamento</th>
        <th>Plano</th>
        <th style="text-align:right;">Valor</th>
        <th style="text-align:center;">Status</th>
        <th style="text-align:center;">Progresso</th>
        <th style="text-align:center;">Início</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer">
    Relatório gerado eletronicamente pelo sistema Odonto Connect • ${dataAtual}
  </div>
</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
