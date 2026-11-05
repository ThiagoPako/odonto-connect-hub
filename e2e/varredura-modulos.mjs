// Varredura de usabilidade: loga em cada perfil de teste e visita todas as rotas do app,
// registrando redirecionamentos, erros de console, respostas de API >= 400 e um trecho do texto.
// Pré-requisito: ambiente local (docs/operacao/ambiente-local.md) — backend :3002 e `web-local` :5173.
// Uso: node e2e/varredura-modulos.mjs <saida.json> [pastaCapturas]
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const PERFIS = [
  ['admin', 'admin.alfa@teste.local'], ['dentista', 'dentista.alfa@teste.local'],
  ['recepcionista', 'recepcao.alfa@teste.local'], ['comercial', 'comercial.alfa@teste.local'],
  ['super-admin', 'super@teste.local'],
];
const ROTAS = ['dashboard','agenda','pacientes','atendimento','prontuario','exames','pedido-exame','orcamentos','tratamentos','procedimentos','financeiro','comissoes','crm','contatos','chat','canais','disparos','campanhas','automacoes','reativacao','estoque','analytics','metricas','relatorios-clinicos','painel-comercial','painel-dentista','dentistas','equipe','usuarios','integracoes','configuracoes','configuracoes/agenda','minha-assinatura','perfil','super-admin'];
const [saida, capturas] = process.argv.slice(2);
if (capturas) mkdirSync(capturas, { recursive: true });
const browser = await chromium.launch();
const resultado = {};
for (const [perfil, email] of PERFIS) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const page = await ctx.newPage();
  const lista = (resultado[perfil] = {});
  let atual = null;
  page.on('console', (m) => { if (m.type() === 'error' && atual) atual.console.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => { if (atual) atual.pageerror.push(String(e).slice(0, 200)); });
  page.on('response', (r) => { if (atual && r.url().includes('/api/') && r.status() >= 400) atual.api.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('admin@odontoconnect.tech').fill(email);
  await page.locator('input[type=password]').fill('Teste@123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
  for (const rota of ROTAS) {
    atual = { final: '', titulo: '', texto: '', console: [], pageerror: [], api: [] };
    try {
      await page.goto(`${BASE}/${rota}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      atual.final = new URL(page.url()).pathname;
      atual.texto = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400);
      if (capturas) await page.screenshot({ path: `${capturas}/${perfil}__${rota.replace('/', '_')}.png` }).catch(() => {});
    } catch (e) { atual.texto = 'ERRO: ' + String(e).slice(0, 150); }
    lista[rota] = atual;
  }
  await ctx.close();
}
await browser.close();
writeFileSync(saida, JSON.stringify(resultado, null, 1));
console.log('ok', saida);
