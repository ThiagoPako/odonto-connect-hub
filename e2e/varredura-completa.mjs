// Varredura completa: por perfil x rota x viewport (1366 e 375). Coleta erros de console, avisos do React,
// pageerror, respostas de API >= 400, textos "undefined/null/NaN", overflow horizontal a 375 px e
// botões "Novo/Nova/Adicionar" que não abrem nada. Não clica em nada destrutivo.
// Uso: E2E_BASE_URL=http://localhost:5191 node e2e/varredura-completa.mjs <saida.json>
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const PERFIS = [['admin', 'admin.alfa@teste.local'], ['dentista', 'dentista.alfa@teste.local'], ['recepcionista', 'recepcao.alfa@teste.local'], ['comercial', 'comercial.alfa@teste.local'], ['super-admin', 'super@teste.local']];
const ROTAS = ['dashboard','agenda','pacientes','atendimento','prontuario','orcamentos','tratamentos','procedimentos','financeiro','comissoes','crm','contatos','chat','canais','disparos','campanhas','automacoes','reativacao','estoque','analytics','metricas','painel-comercial','painel-dentista','dentistas','equipe','usuarios','integracoes','configuracoes','configuracoes/agenda','minha-assinatura','perfil','super-admin'];
const RUIM = /\b(undefined|NaN|\[object Object\])\b|(^|[\s:>])null([\s,.<]|$)/;
const saida = process.argv[2];
const browser = await chromium.launch();
const res = {};
for (const [perfil, email] of PERFIS) {
  for (const [vp, w, h] of [['desktop', 1366, 800], ['mobile375', 375, 812]]) {
    if (vp === 'mobile375' && perfil !== 'admin' && perfil !== 'recepcionista') continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    let at = null;
    page.on('console', (m) => { if (!at) return; const t = m.text().slice(0, 220); if (m.type() === 'error') at.console.push(t); else if (m.type() === 'warning' && /react|key|hydrat|validateDOM|act\(/i.test(t)) at.reactWarn.push(t); });
    page.on('pageerror', (e) => { if (at) at.pageerror.push(String(e).slice(0, 200)); });
    page.on('response', (r) => { if (at && r.url().includes('/api/') && r.status() >= 400) at.api.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(`${BASE}/login`);
    await page.locator('#email').fill(email);
    await page.locator('input[type=password]').fill('Teste@123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
    for (const rota of ROTAS) {
      at = { final: '', console: [], reactWarn: [], pageerror: [], api: [], textoRuim: [], overflow: null, botoesMortos: [], erroTela: false };
      try {
        await page.goto(`${BASE}/${rota}`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);
        at.final = new URL(page.url()).pathname;
        const txt = await page.locator('body').innerText();
        for (const l of txt.split('\n')) if (RUIM.test(l)) at.textoRuim.push(l.trim().slice(0, 100));
        at.textoRuim = [...new Set(at.textoRuim)].slice(0, 5);
        at.erroTela = /something went wrong|algo deu errado|erro inesperado/i.test(txt);
        if (vp === 'mobile375') at.overflow = await page.evaluate(() => { const d = document.documentElement; return d.scrollWidth > d.clientWidth + 1 ? `scrollWidth ${d.scrollWidth} > ${d.clientWidth}` : null; });
        if (vp === 'desktop' && perfil === 'admin') {
          const botoes = page.locator('main button, main a[role=button]').filter({ hasText: /^\s*(\+\s*)?(novo|nova|adicionar|criar)\b/i });
          const n = Math.min(await botoes.count(), 3);
          for (let i = 0; i < n; i++) {
            const b = botoes.nth(i); const rotulo = ((await b.innerText().catch(() => '')) || '').trim().slice(0, 30);
            const antes = await page.evaluate(() => document.body.innerHTML.length + '|' + location.href + '|' + document.querySelectorAll('[role=dialog],[data-state=open]').length);
            const req = []; const f = (r) => req.push(r.url()); page.on('request', f);
            await b.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500);
            page.off('request', f);
            const depois = await page.evaluate(() => document.body.innerHTML.length + '|' + location.href + '|' + document.querySelectorAll('[role=dialog],[data-state=open]').length);
            if (antes === depois && !req.length) at.botoesMortos.push(rotulo);
            await page.keyboard.press('Escape').catch(() => {});
            if (new URL(page.url()).pathname !== at.final) await page.goto(`${BASE}/${rota}`, { waitUntil: 'domcontentloaded' });
          }
        }
      } catch (e) { at.pageerror.push('ERRO: ' + String(e).slice(0, 150)); }
      (res[`${perfil}/${vp}`] ||= {})[rota] = at;
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(saida, JSON.stringify(res, null, 1));
console.log('ok', saida);
