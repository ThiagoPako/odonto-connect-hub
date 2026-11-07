// WhatsApp ponta a ponta com Evolution SIMULADA: lembrete 24 h com botões, confirmar/remarcar, SAIR, boas-vindas e menu de
// filas, fora do horário, pesquisa só em "atendido", isolamento entre clínicas, janela de horário, dedupe e ritmo.
// Rodar com:  E2E_WA_DB=<banco local> npx playwright test -c playwright.whatsapp.config.ts
// Estrutura: backend em modo de teste (e2e/api-teste.mjs, sem crons) + fake Evolution (e2e/fake-evolution.mjs).
// A fila anda quando o teste chama /__tick (processAutomationJobs direto); o produto não é alterado.
import { test, expect, type APIRequestContext } from "@playwright/test";

const API = `http://127.0.0.1:${process.env.E2E_WA_API_PORT || "3071"}`;
const CTRL = `http://127.0.0.1:${process.env.E2E_WA_CONTROL_PORT || "3072"}`;
const FAKE = `http://127.0.0.1:${process.env.E2E_WA_FAKE_PORT || "4010"}`;
const ALFA = "aaaaaaaa-0000-0000-0000-00000000000a";
const BETA = "bbbbbbbb-0000-0000-0000-00000000000b";
const SENHA = "Teste@123";

type Envio = { n: number; endpoint: string; instance: string; body: any };

// ── utilitários ─────────────────────────────────────────────────────────────
async function sql(r: APIRequestContext, texto: string, params: unknown[] = []) {
  const resp = await r.post(`${CTRL}/__sql`, { data: { sql: texto, params } });
  const j = await resp.json();
  if (!resp.ok()) throw new Error(`SQL falhou: ${j.error} :: ${texto.slice(0, 120)}`);
  return j.rows as any[];
}
/** Um ciclo da fila (ritmo e cache de instâncias zerados). */
const tick = async (r: APIRequestContext, reset = true) => { await r.post(`${CTRL}/__tick`, { data: { reset } }); };
/** Roda ciclos até a condição valer (cada ciclo envia no máximo 1 mensagem por número). */
async function tickAte(r: APIRequestContext, cond: () => Promise<boolean>, max = 8) {
  // O webhook responde antes de terminar de processar (lead, menu, respostas): dá um respiro entre os ciclos.
  for (let i = 0; i < max; i++) { await new Promise((ok) => setTimeout(ok, 250)); await tick(r); if (await cond()) return true; }
  return cond();
}
/** Esvazia a fila da clínica (um job por número por ciclo): para testes que geraram muitas mensagens. */
async function drenar(r: APIRequestContext, tenant: string, max = 40) {
  for (let i = 0; i < max; i++) {
    const [{ n }] = await sql(r, `SELECT count(*)::int AS n FROM automation_jobs WHERE status='pending' AND tenant_id=$1 AND scheduled_at <= NOW()`, [tenant]);
    if (!n) return;
    await tick(r);
  }
}
const fakeReset = (r: APIRequestContext) => r.post(`${FAKE}/__reset`);
async function enviosPara(r: APIRequestContext, phone: string): Promise<Envio[]> {
  const log = (await (await r.get(`${FAKE}/__log`)).json()) as Envio[];
  return log.filter((l) => l.endpoint?.startsWith("send") && String(l.body?.number || "").startsWith(phone));
}
const textoDe = (e: Envio) => e.body?.text || e.body?.description || "";
async function webhook(r: APIRequestContext, corpo: Record<string, unknown>) {
  const resp = await r.post(`${FAKE}/__webhook`, { data: corpo });
  return (await resp.json()) as { status: number; body: any };
}
const telefoneNovo = () => `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
async function jobsDe(r: APIRequestContext, phone: string, triggers?: string[]) {
  const rows = await sql(r, `SELECT id, status, trigger_event, category, instance, error, message, variables, tenant_id FROM automation_jobs WHERE RIGHT(regexp_replace(patient_phone,'\\D','','g'),8) = RIGHT($1,8) ORDER BY created_at`, [phone]);
  return triggers ? rows.filter((j) => triggers.includes(j.trigger_event)) : rows;
}
async function login(r: APIRequestContext, email: string) {
  const resp = await r.post(`${API}/api/auth/login`, { data: { email, password: SENHA } });
  expect(resp.status()).toBe(200);
  return ((await resp.json()) as { token: string }).token;
}
const brt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d); // AAAA-MM-DD
/** Paciente + consulta de AMANHÃ (a véspera é o padrão do lembrete). */
async function pacienteComConsulta(r: APIRequestContext, tenant: string, nome: string, hora = "15:00") {
  const phone = telefoneNovo();
  const pac = (await sql(r, `INSERT INTO pacientes (nome, telefone, tenant_id) VALUES ($1,$2,$3) RETURNING id`, [nome, phone, tenant]))[0].id;
  const amanha = brt(new Date(Date.now() + 24 * 3600_000));
  const ag = (await sql(r, `INSERT INTO agendamentos (paciente_id, data, hora, status, tenant_id) VALUES ($1,$2,$3,'agendado',$4) RETURNING id`, [pac, amanha, hora, tenant]))[0].id;
  return { phone, pac, ag: ag as string };
}
const statusDe = async (r: APIRequestContext, ag: string) => (await sql(r, `SELECT status FROM agendamentos WHERE id=$1`, [ag]))[0].status as string;
const HORARIO_ABERTO = Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, { enabled: true, openTime: "00:00", closeTime: "23:59" }]));
const HORARIO_FECHADO = Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, { enabled: false, openTime: "08:00", closeTime: "18:00" }]));
async function configurarAtendimento(r: APIRequestContext, cfg: Record<string, unknown>) {
  const token = await login(r, "admin.alfa@teste.local");
  const resp = await r.put(`${API}/api/attendance-settings`, { headers: { Authorization: `Bearer ${token}` }, data: cfg });
  expect(resp.status()).toBe(200);
}
/** Último domingo (passado) às 10:00 de Brasília: fora da janela de envio e do expediente padrão. */
function domingoPassado(): string {
  const d = new Date(Date.now() - 24 * 3600_000);
  while (d.getUTCDay() !== 0 || brt(d) === brt(new Date())) d.setUTCDate(d.getUTCDate() - 1);
  return `${brt(d)}T13:00:00Z`;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  await sql(request, `INSERT INTO whatsapp_instances (instance_name, tenant_id) VALUES ('e2e-alfa',$1),('e2e-beta',$2) ON CONFLICT (instance_name) DO UPDATE SET tenant_id = EXCLUDED.tenant_id`, [ALFA, BETA]);
});
test.beforeEach(async ({ request }) => {
  // A fila pega 1 job por número por ciclo: sobras de testes anteriores (ou lembretes da semente) não podem ocupar a vez.
  await sql(request, `UPDATE automation_jobs SET status='cancelled' WHERE status='pending' AND (tenant_id IN ($1,$2) OR instance IN ('e2e-alfa','e2e-beta'))`, [ALFA, BETA]);
  // Número "maduro" (faixa de 80 envios/h) e contadores limpos: reexecuções não esbarram no limite por hora/dia do número.
  await sql(request, `UPDATE whatsapp_instances SET created_at = NOW() - interval '60 days', paused_until = NULL WHERE instance_name IN ('e2e-alfa','e2e-beta')`);
  await sql(request, `UPDATE automation_jobs SET sent_at = sent_at - interval '30 hours' WHERE instance IN ('e2e-alfa','e2e-beta') AND status='sent' AND sent_at > NOW() - interval '30 hours' AND created_at < NOW() - interval '1 minute'`);
  await fakeReset(request);
  await request.post(`${CTRL}/__clock`, { data: { iso: null } });
  await configurarAtendimento(request, { businessHours: HORARIO_ABERTO, autoGreetingEnabled: false });
});
test.afterEach(async ({ request }) => { await request.post(`${CTRL}/__clock`, { data: { iso: null } }); });

// ── 1. Lembrete de 24 h com botões; paciente clica "Confirmar" ─────────────
test("W1. lembrete de 24 h sai com botões (com nome, sem procedimento) e o clique em Confirmar confirma a consulta", async ({ request }) => {
  const { phone, ag } = await pacienteComConsulta(request, ALFA, "Maria da Silva (e2e)");
  await sql(request, `UPDATE agendamentos SET procedimento='Canal (segredo clínico)' WHERE id=$1`, [ag]);
  await request.post(`${CTRL}/__reminders`);
  const jobs = await jobsDe(request, phone, ["appointment_reminder"]);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].status).toBe("pending");
  expect(jobs[0].instance).toBe("e2e-alfa");
  expect(await tickAte(request, async () => (await enviosPara(request, phone)).length > 0)).toBe(true);
  const [env] = await enviosPara(request, phone);
  expect(env.endpoint).toBe("sendButtons");
  expect(env.instance).toBe("e2e-alfa");
  expect(textoDe(env)).toContain("Olá, Maria!");
  expect(textoDe(env)).not.toMatch(/Canal|segredo/i);                                 // dado de saúde fora da tela bloqueada
  const botoes = (env.body.buttons as any[]).map((b) => [b.buttonId, b.buttonText.displayText]);
  expect(botoes).toEqual([[`appt_confirm_${ag}`, "Confirmar"], [`appt_reschedule_${ag}`, "Preciso remarcar"]]);
  expect((await jobsDe(request, phone, ["appointment_reminder"]))[0].status).toBe("sent");

  // Outro número clicando no mesmo botão não confirma a consulta
  const intruso = telefoneNovo();
  await webhook(request, { kind: "button", instance: "e2e-alfa", phone: intruso, buttonId: `appt_confirm_${ag}`, displayText: "Confirmar" });
  await expect.poll(() => statusDe(request, ag), { timeout: 3000 }).toBe("agendado");

  // O paciente clica em Confirmar
  const r = await webhook(request, { kind: "button", instance: "e2e-alfa", phone, buttonId: `appt_confirm_${ag}`, displayText: "Confirmar" });
  expect(r.status).toBe(200);
  await expect.poll(() => statusDe(request, ag)).toBe("confirmado");
  expect((await jobsDe(request, phone, ["appointment_reminder"]))[0].variables.confirmationReply).toBe("confirmado");
  // Resposta ao paciente sai pela fila; clique repetido não duplica nem desfaz
  expect(await tickAte(request, async () => (await enviosPara(request, phone)).some((e) => /Presença confirmada/.test(textoDe(e))))).toBe(true);
  await webhook(request, { kind: "button", instance: "e2e-alfa", phone, buttonId: `appt_confirm_${ag}`, displayText: "Confirmar" });
  await tick(request); await tick(request);
  expect((await enviosPara(request, phone)).filter((e) => /Presença confirmada/.test(textoDe(e)))).toHaveLength(1);
  // A agenda mostra o status do lembrete
  const token = await login(request, "admin.alfa@teste.local");
  const agenda = (await (await request.get(`${API}/api/agenda`, { headers: { Authorization: `Bearer ${token}` } })).json()) as any[];
  expect(agenda.find((a) => a.id === ag).lembrete_status).toBe("confirmado");
  expect(agenda.find((a) => a.id === ag).paciente_nome).toBe("Maria da Silva (e2e)");
});

// ── 2. "Preciso remarcar" avisa a recepção ───────────────────────────────────
test("W2. 'Preciso remarcar' muda o status, avisa a recepção em tempo real e responde ao paciente", async ({ request }) => {
  const { phone, ag } = await pacienteComConsulta(request, ALFA, "João Remarca (e2e)", "16:00");
  await request.post(`${CTRL}/__reminders`);
  await tickAte(request, async () => (await enviosPara(request, phone)).length > 0);

  // Recepção conectada ao SSE da clínica
  const token = await login(request, "recepcao.alfa@teste.local");
  const ac = new AbortController();
  const eventos: string[] = [];
  const sse = fetch(`${API}/api/events?token=${token}&tenantId=${ALFA}`, { signal: ac.signal }).then(async (res) => {
    const leitor = res.body!.getReader(); const dec = new TextDecoder();
    for (;;) { const { value, done } = await leitor.read(); if (done) break; eventos.push(dec.decode(value)); }
  }).catch(() => {});
  await expect.poll(() => eventos.join("")).toContain("event: connected");

  await webhook(request, { kind: "button", instance: "e2e-alfa", phone, buttonId: `appt_reschedule_${ag}`, displayText: "Preciso remarcar" });
  await expect.poll(() => statusDe(request, ag)).toBe("remarcar");
  await expect.poll(() => eventos.join("")).toContain("appointment_reschedule_requested");
  expect(eventos.join("")).toContain(ag);
  ac.abort(); await sse;
  expect(await tickAte(request, async () => (await enviosPara(request, phone)).some((e) => /remarcar/i.test(textoDe(e)) && e.endpoint === "sendText"))).toBe(true);
  // Não reenvia lembrete para consulta em "remarcar"
  await request.post(`${CTRL}/__reminders`);
  expect((await jobsDe(request, phone, ["appointment_reminder"])).length).toBe(1);
});

// ── 3. SAIR → opt-out → confirmação → nenhum envio depois ───────────────────
test("W3. SAIR registra o descadastro, confirma uma vez e nada mais é enviado (nem o que estava na fila)", async ({ request }) => {
  const { phone, ag } = await pacienteComConsulta(request, ALFA, "Paula Sair (e2e)", "17:00");
  await request.post(`${CTRL}/__reminders`);                     // lembrete já na fila, ainda não enviado
  expect((await jobsDe(request, phone, ["appointment_reminder"]))[0].status).toBe("pending");

  const r = await webhook(request, { kind: "text", instance: "e2e-alfa", phone, text: "SAIR" });
  expect(r.status).toBe(200);
  await expect.poll(async () => (await sql(request, `SELECT 1 FROM whatsapp_opt_outs WHERE tenant_id=$1 AND phone_key LIKE '%'||RIGHT($2,8)`, [ALFA, phone])).length).toBe(1);
  expect(await tickAte(request, async () => (await enviosPara(request, phone)).length > 0)).toBe(true);
  const enviados = await enviosPara(request, phone);
  expect(enviados).toHaveLength(1);                              // só a confirmação do SAIR
  expect(enviados[0].endpoint).toBe("sendText");
  expect(textoDe(enviados[0])).toMatch(/não vai mais enviar mensagens automáticas/);
  const lembrete = (await jobsDe(request, phone, ["appointment_reminder"]))[0];
  expect(lembrete.status).toBe("cancelled");                     // o que estava na fila foi cancelado pelo SAIR

  // Depois do SAIR: lembrete novo não é criado, segundo SAIR não gera segunda confirmação
  await sql(request, `DELETE FROM automation_jobs WHERE flow_id=$1`, [`reminder_${ag}`]);
  await request.post(`${CTRL}/__reminders`);
  expect(await jobsDe(request, phone, ["appointment_reminder"])).toHaveLength(0);
  await webhook(request, { kind: "text", instance: "e2e-alfa", phone, text: "sair" });
  await tick(request); await tick(request);
  expect(await enviosPara(request, phone)).toHaveLength(1);
  // Mesmo um job manual/campanha é barrado na fila
  await sql(request, `INSERT INTO automation_jobs (id, tenant_id, instance, patient_phone, message, category, channel, status, scheduled_at, trigger_event, expires_at)
                      VALUES (gen_random_uuid()::text,$1,'e2e-alfa',$2,'Promoção qualquer','marketing','whatsapp','pending',NOW(),'manual',NOW()+interval '1 day')`, [ALFA, phone]);
  await tick(request);
  expect(await enviosPara(request, phone)).toHaveLength(1);
  expect((await jobsDe(request, phone, ["manual"]))[0].error).toMatch(/SAIR/);
});

// ── 4. Boas-vindas + menu de filas + escolha de setor ───────────────────────
test("W4. contato novo recebe boas-vindas, depois o menu de filas com botões; a escolha leva ao setor", async ({ request }) => {
  await configurarAtendimento(request, { businessHours: HORARIO_ABERTO, autoGreetingEnabled: true, welcomeMessage: "Bem-vindo à Clínica Alfa (e2e)!" });
  await sql(request, `UPDATE attendance_queues SET active=false WHERE tenant_id=$1`, [ALFA]); // (leads antigos apontam para filas antigas: desativa em vez de apagar)
  const filas = await sql(request, `INSERT INTO attendance_queues (name, icon, active, tenant_id) VALUES ('Recepção E2E','📞',true,$1),('Financeiro E2E','💰',true,$1) RETURNING id, name`, [ALFA]);
  const phone = telefoneNovo();
  const r = await webhook(request, { kind: "text", instance: "e2e-alfa", phone, text: "Oi, boa tarde", pushName: "Contato Novo E2E" });
  expect(r.status).toBe(200);
  await expect.poll(async () => (await sql(request, `SELECT 1 FROM crm_leads WHERE tenant_id=$1 AND telefone=$2`, [ALFA, phone])).length).toBe(1);

  expect(await tickAte(request, async () => (await enviosPara(request, phone)).length >= 1)).toBe(true);
  expect(textoDe((await enviosPara(request, phone))[0])).toContain("Bem-vindo à Clínica Alfa (e2e)!");
  expect(await tickAte(request, async () => (await enviosPara(request, phone)).some((e) => e.endpoint === "sendButtons"))).toBe(true);
  const menu = (await enviosPara(request, phone)).find((e) => e.endpoint === "sendButtons")!;
  expect((menu.body.buttons as any[]).map((b) => b.buttonId).sort()).toEqual(filas.map((f) => `queue_${f.id}`).sort());
  expect(JSON.stringify(menu.body.buttons)).toContain("Financeiro E2E");

  const escolhida = filas.find((f) => f.name === "Financeiro E2E")!;
  await webhook(request, { kind: "button", instance: "e2e-alfa", phone, buttonId: `queue_${escolhida.id}`, displayText: "💰 Financeiro E2E" });
  await expect.poll(async () => (await sql(request, `SELECT queue_id, awaiting_queue_selection FROM crm_leads WHERE tenant_id=$1 AND telefone=$2`, [ALFA, phone]))[0]).toMatchObject({ queue_id: escolhida.id, awaiting_queue_selection: false });
  expect(await tickAte(request, async () => (await enviosPara(request, phone)).some((e) => /direcionado para o setor/.test(textoDe(e))))).toBe(true);
  expect(textoDe((await enviosPara(request, phone)).at(-1)!)).toContain("Financeiro E2E");
  // Opção inválida: o menu volta (resposta de atendimento)
  const outro = telefoneNovo();
  await webhook(request, { kind: "text", instance: "e2e-alfa", phone: outro, text: "oi" });
  await tickAte(request, async () => (await enviosPara(request, outro)).some((e) => e.endpoint === "sendButtons"));
  await webhook(request, { kind: "text", instance: "e2e-alfa", phone: outro, text: "7" });
  await expect.poll(async () => (await sql(request, `SELECT awaiting_queue_selection FROM crm_leads WHERE tenant_id=$1 AND telefone=$2`, [ALFA, outro]))[0].awaiting_queue_selection).toBe(true);
});

// ── 5. Fora do horário ───────────────────────────────────────────────────────
test("W5. mensagem fora do expediente recebe o aviso de fechado (mesmo fora da janela de envio) e não o menu", async ({ request }) => {
  await configurarAtendimento(request, { businessHours: HORARIO_FECHADO, autoGreetingEnabled: true, welcomeMessage: "Boas-vindas não devem sair" });
  const phone = telefoneNovo();
  await request.post(`${CTRL}/__clock`, { data: { iso: domingoPassado() } });  // domingo: nem expediente nem janela de envio
  const r = await webhook(request, { kind: "text", instance: "e2e-alfa", phone, text: "Bom dia, tem horário?" });
  expect(r.status).toBe(200);
  await expect.poll(async () => (await jobsDe(request, phone, ["auto_reply"])).length).toBe(1);
  expect((await jobsDe(request, phone, ["auto_reply"]))[0].category).toBe("service");
  expect(await tickAte(request, async () => (await enviosPara(request, phone)).length > 0)).toBe(true);
  const enviados = await enviosPara(request, phone);
  expect(enviados).toHaveLength(1);
  expect(enviados[0].endpoint).toBe("sendText");
  expect(textoDe(enviados[0])).toMatch(/fechado agora/);
  expect(textoDe(enviados[0])).toContain("Clínica Alfa");
  // Mensagem personalizada da clínica
  await configurarAtendimento(request, { businessHours: HORARIO_FECHADO, offHoursMessage: "Voltamos amanhã às 8h (e2e)" });
  const outro = telefoneNovo();
  await webhook(request, { kind: "text", instance: "e2e-alfa", phone: outro, text: "oi" });
  await tickAte(request, async () => (await enviosPara(request, outro)).length > 0);
  expect(textoDe((await enviosPara(request, outro))[0])).toBe("Voltamos amanhã às 8h (e2e)");
});

// ── 6. Pesquisa de satisfação só em "atendido" ───────────────────────────────
test("W6. pesquisa de satisfação só sai no desfecho 'atendido' (não em follow-up nem para quem deu SAIR)", async ({ request }) => {
  const token = await login(request, "admin.alfa@teste.local");
  const H = { Authorization: `Bearer ${token}` };
  const fechar = async (phone: string, outcome: string) => {
    const lead = (await sql(request, `INSERT INTO crm_leads (id, nome, telefone, origem, status, kanban_stage, tenant_id) VALUES (gen_random_uuid(),'Lead Pesquisa E2E',$1,'whatsapp','novo','lead',$2) RETURNING id`, [phone, ALFA]))[0].id;
    await sql(request, `INSERT INTO attendance_sessions (lead_id, lead_name, lead_phone, status, assigned_at, started_waiting_at, tenant_id) VALUES ($1,'Lead Pesquisa E2E',$2,'active',NOW(),NOW(),$3)`, [lead, phone, ALFA]);
    const r = await request.post(`${API}/api/sessions/close`, { headers: H, data: { leadId: lead, outcome } });
    expect(r.status()).toBe(200);
    return lead as string;
  };
  const pFollow = telefoneNovo(); const pOrc = telefoneNovo(); const pOk = telefoneNovo(); const pSair = telefoneNovo();
  await fechar(pFollow, "follow_up");
  await fechar(pOrc, "orcamento");
  const leadOk = await fechar(pOk, "atendido");
  await sql(request, `INSERT INTO whatsapp_opt_outs (tenant_id, phone_key, phone, source) VALUES ($1,$2,$3,'e2e') ON CONFLICT DO NOTHING`, [ALFA, pSair.slice(2).replace(/^(\d{2})9(\d{8})$/, "$1$2"), pSair]);
  await fechar(pSair, "atendido");
  expect(await jobsDe(request, pFollow, ["satisfaction_survey"])).toHaveLength(0);
  expect(await jobsDe(request, pOrc, ["satisfaction_survey"])).toHaveLength(0);
  expect(await jobsDe(request, pSair, ["satisfaction_survey"])).toHaveLength(0);
  expect(await jobsDe(request, pOk, ["satisfaction_survey"])).toHaveLength(1);
  expect(await tickAte(request, async () => (await enviosPara(request, pOk)).length > 0)).toBe(true);
  const [env] = await enviosPara(request, pOk);
  expect(env.endpoint).toBe("sendButtons");
  expect((env.body.buttons as any[]).map((b) => b.buttonId)).toEqual([`rating_${leadOk}_5`, `rating_${leadOk}_3`, `rating_${leadOk}_1`]);
  expect(await enviosPara(request, pFollow)).toHaveLength(0);
  expect(await enviosPara(request, pOrc)).toHaveLength(0);
  expect(await enviosPara(request, pSair)).toHaveLength(0);
});

// ── 7. A clínica B nunca usa a instância da A ───────────────────────────────
test("W7. isolamento: clínica B nunca envia pelo número da A, e o webhook da A não aceita o token da B", async ({ request }) => {
  // (a) job da B apontando para a instância da A: bloqueado, nada sai
  const pB = telefoneNovo();
  await sql(request, `INSERT INTO automation_jobs (id, tenant_id, instance, patient_phone, message, category, channel, status, scheduled_at, trigger_event, expires_at)
                      VALUES (gen_random_uuid()::text,$1,'e2e-alfa',$2,'Mensagem da B pela instância da A','transactional','whatsapp','pending',NOW(),'manual',NOW()+interval '1 day')`, [BETA, pB]);
  await tick(request);
  expect(await enviosPara(request, pB)).toHaveLength(0);
  const bloqueado = (await jobsDe(request, pB))[0];
  expect(bloqueado.status).toBe("failed");
  expect(bloqueado.error).toMatch(/pertence a outra clínica/);

  // (b) número da B desconectado e o da A aberto: a mensagem da B espera, não "empresta" a instância da A
  await request.post(`${FAKE}/__instances`, { data: { abertas: ["e2e-alfa"], fechadas: ["e2e-beta"] } });
  const pB2 = (await pacienteComConsulta(request, BETA, "Paciente da Beta (e2e)")).phone;
  await request.post(`${CTRL}/__reminders`);
  await tick(request); await tick(request);
  expect(await enviosPara(request, pB2)).toHaveLength(0);
  const espera = (await jobsDe(request, pB2, ["appointment_reminder"]))[0];
  expect(espera.status).toBe("pending");
  expect(espera.instance).not.toBe("e2e-alfa");
  // (c) com o número da B aberto, sai pela e2e-beta
  await request.post(`${FAKE}/__instances`, { data: { abertas: ["e2e-alfa", "e2e-beta"] } });
  await sql(request, `UPDATE automation_jobs SET scheduled_at=NOW(), claimed_at=NULL WHERE id=$1`, [espera.id]);
  expect(await tickAte(request, async () => (await enviosPara(request, pB2)).length > 0)).toBe(true);
  expect((await enviosPara(request, pB2))[0].instance).toBe("e2e-beta");

  // (d) webhook: token de outra instância é recusado; sem token também; com o certo, o lead nasce na clínica dona do número
  const pIn = telefoneNovo();
  expect((await webhook(request, { kind: "text", instance: "e2e-alfa", phone: pIn, text: "oi", tokenDe: "e2e-beta" })).status).toBe(401);
  expect((await webhook(request, { kind: "text", instance: "e2e-alfa", phone: pIn, text: "oi", semToken: true })).status).toBe(401);
  expect(await sql(request, `SELECT 1 FROM crm_leads WHERE telefone=$1`, [pIn])).toHaveLength(0);
  expect((await webhook(request, { kind: "text", instance: "e2e-beta", phone: pIn, text: "oi" })).status).toBe(200);
  await expect.poll(async () => (await sql(request, `SELECT tenant_id FROM crm_leads WHERE telefone=$1`, [pIn])).map((l) => l.tenant_id)).toEqual([BETA]);
  // (e) presença também passa pelo mesmo controle
  expect((await webhook(request, { kind: "presence", instance: "e2e-beta", phone: pIn, status: "composing" })).status).toBe(200);
  expect((await webhook(request, { kind: "presence", instance: "e2e-beta", phone: pIn, semToken: true })).status).toBe(401);
});

// ── 8. Janela de horário, dedupe e ritmo ────────────────────────────────────
test("W8. janela de horário: lembrete espera fora da janela e sai dentro; resposta de atendimento não espera", async ({ request }) => {
  const { phone } = await pacienteComConsulta(request, ALFA, "Janela Teste (e2e)", "18:00");
  await request.post(`${CTRL}/__reminders`);
  await request.post(`${CTRL}/__clock`, { data: { iso: domingoPassado() } });     // domingo: sem envio automático
  await tick(request);
  expect(await enviosPara(request, phone)).toHaveLength(0);
  const preso = (await jobsDe(request, phone, ["appointment_reminder"]))[0];
  expect(preso.status).toBe("pending");
  expect(preso.error).toMatch(/Fora do horário de envio/);
  // Resposta de atendimento (service) sai mesmo no domingo
  await sql(request, `INSERT INTO automation_jobs (id, tenant_id, instance, patient_phone, message, category, channel, status, scheduled_at, trigger_event, expires_at)
                      VALUES (gen_random_uuid()::text,$1,'e2e-alfa',$2,'Resposta de atendimento (e2e)','service','whatsapp','pending',NOW(),'auto_reply',NOW()+interval '1 day')`, [ALFA, phone]);
  await tick(request);
  expect((await enviosPara(request, phone)).map(textoDe)).toEqual(["Resposta de atendimento (e2e)"]);
  // Volta o relógio: o lembrete é liberado (scheduled_at foi empurrado para a próxima janela)
  await request.post(`${CTRL}/__clock`, { data: { iso: null } });
  await sql(request, `UPDATE automation_jobs SET scheduled_at=NOW(), claimed_at=NULL WHERE id=$1`, [preso.id]);
  expect(await tickAte(request, async () => (await enviosPara(request, phone)).some((e) => e.endpoint === "sendButtons"))).toBe(true);
});

test("W9. dedupe (mesmo texto em 24 h), ritmo por número e queda de botões para texto", async ({ request }) => {
  // Dedupe: a segunda cópia idêntica não sai
  const phone = telefoneNovo();
  const novo = (msg: string) => sql(request, `INSERT INTO automation_jobs (id, tenant_id, instance, patient_phone, message, category, channel, status, scheduled_at, trigger_event, expires_at)
      VALUES (gen_random_uuid()::text,$1,'e2e-alfa',$2,$3,'transactional','whatsapp','pending',NOW(),'manual',NOW()+interval '1 day') RETURNING id`, [ALFA, phone, msg]);
  await novo("Texto repetido (e2e)");
  await tick(request);
  expect(await enviosPara(request, phone)).toHaveLength(1);
  const [dup] = await novo("Texto repetido (e2e)");
  await tick(request);
  expect(await enviosPara(request, phone)).toHaveLength(1);
  const dupJob = (await jobsDe(request, phone)).find((j) => j.id === dup.id)!;
  expect(dupJob.status).toBe("failed");
  expect(dupJob.error).toMatch(/idêntica já enviada/);

  // Ritmo: sem zerar o estado, o mesmo número não recebe duas mensagens em seguida
  const p2 = telefoneNovo(); const p3 = telefoneNovo();
  const para = (p: string, msg: string) => sql(request, `INSERT INTO automation_jobs (id, tenant_id, instance, patient_phone, message, category, channel, status, scheduled_at, trigger_event, expires_at)
      VALUES (gen_random_uuid()::text,$1,'e2e-alfa',$2,$3,'transactional','whatsapp','pending',NOW(),'manual',NOW()+interval '1 day')`, [ALFA, p, msg]);
  await para(p2, "ritmo 1 (e2e)"); await para(p3, "ritmo 2 (e2e)");
  await tick(request, true);
  const enviadosCiclo1 = (await enviosPara(request, p2)).length + (await enviosPara(request, p3)).length;
  expect(enviadosCiclo1).toBe(1);                                  // um envio por número por ciclo
  await tick(request, false);                                      // ainda dentro do intervalo de 8–25 s
  expect((await enviosPara(request, p2)).length + (await enviosPara(request, p3)).length).toBe(1);
  await tick(request, true);                                       // estado zerado: o segundo sai
  expect((await enviosPara(request, p2)).length + (await enviosPara(request, p3)).length).toBe(2);

  // Botões sem key.id (aparelho que não exibe botões): cai para o texto numerado, uma vez só
  await request.post(`${FAKE}/__mode`, { data: { instance: "e2e-alfa", mode: "buttons_noid" } });
  const { phone: pb, ag } = await pacienteComConsulta(request, ALFA, "Sem Botões (e2e)", "19:00");
  await request.post(`${CTRL}/__reminders`);
  expect(await tickAte(request, async () => (await jobsDe(request, pb, ["appointment_reminder"]))[0]?.status === "sent")).toBe(true);
  const envs = await enviosPara(request, pb);
  expect(envs.map((e) => e.endpoint)).toEqual(["sendButtons", "sendText"]);
  expect(textoDe(envs[1])).toMatch(/Responda \*1\* para confirmar ou \*2\* para remarcar/);
  // O "1" digitado vale como confirmação
  await webhook(request, { kind: "text", instance: "e2e-alfa", phone: pb, text: "1" });
  await expect.poll(() => statusDe(request, ag)).toBe("confirmado");

  // Evolution recusando (sem conexão): o job falha e não é reenviado em loop
  await request.post(`${FAKE}/__mode`, { data: { instance: "e2e-alfa", mode: "fail" } });
  const pf = telefoneNovo();
  await para(pf, "vai falhar (e2e)");
  await tickAte(request, async () => (await jobsDe(request, pf))[0]?.status === "failed");
  const falhou = (await jobsDe(request, pf))[0];
  expect(falhou.status).toBe("failed");
  const tentativas = (await request.get(`${FAKE}/__log`).then((r) => r.json()) as Envio[]).filter((l) => String(l.body?.number || "").startsWith(pf)).length;
  await tick(request);
  expect((await request.get(`${FAKE}/__log`).then((r) => r.json()) as Envio[]).filter((l) => String(l.body?.number || "").startsWith(pf)).length).toBe(tentativas);
});

test("W10. limite por hora de número novo (20/h): a 21ª mensagem espera, não é descartada", async ({ request }) => {
  await sql(request, `INSERT INTO whatsapp_instances (instance_name, tenant_id, created_at) VALUES ('e2e-novo',$1,NOW()) ON CONFLICT (instance_name) DO UPDATE SET created_at = NOW(), tenant_id = EXCLUDED.tenant_id`, [ALFA]);
  await sql(request, `DELETE FROM automation_jobs WHERE instance='e2e-novo'`);
  await request.post(`${FAKE}/__instances`, { data: { abertas: ["e2e-alfa", "e2e-beta", "e2e-novo"] } });
  for (let i = 0; i < 20; i++) {
    await sql(request, `INSERT INTO automation_jobs (id, tenant_id, instance, patient_phone, message, category, channel, status, scheduled_at, sent_at, trigger_event, expires_at)
        VALUES (gen_random_uuid()::text,$1,'e2e-novo',$2,$3,'transactional','whatsapp','sent',NOW(),NOW() - interval '10 minutes','manual',NOW()+interval '1 day')`, [ALFA, telefoneNovo(), `histórico ${i} (e2e)`]);
  }
  const phone = telefoneNovo();
  await sql(request, `INSERT INTO automation_jobs (id, tenant_id, instance, patient_phone, message, category, channel, status, scheduled_at, trigger_event, expires_at)
      VALUES (gen_random_uuid()::text,$1,'e2e-novo',$2,'21ª mensagem (e2e)','transactional','whatsapp','pending',NOW(),'manual',NOW()+interval '1 day')`, [ALFA, phone]);
  await tick(request);
  expect(await enviosPara(request, phone)).toHaveLength(0);
  const job = (await jobsDe(request, phone))[0];
  expect(job.status).toBe("pending");
  expect(job.error).toMatch(/Limite por hora do número \(20\)/);
  await sql(request, `DELETE FROM automation_jobs WHERE instance='e2e-novo'`);
  await sql(request, `DELETE FROM whatsapp_instances WHERE instance_name='e2e-novo'`);
});

// ── 11. Casos de borda do SAIR e do lembrete ────────────────────────────────
test("W11. SAIR só vale como mensagem inteira; lembrete respeita status, telefone, 'nao' e não duplica", async ({ request }) => {
  const optado = async (phone: string) => (await sql(request, `SELECT 1 FROM whatsapp_opt_outs WHERE tenant_id=$1 AND phone_key LIKE '%'||RIGHT($2,8)`, [ALFA, phone])).length > 0;
  for (const texto of ["Sair!", "  PARAR  ", "stop", "Não quero mais"]) {
    const p = telefoneNovo();
    await webhook(request, { kind: "text", instance: "e2e-alfa", phone: p, text: texto });
    await expect.poll(() => optado(p), { message: `"${texto}" deveria descadastrar` }).toBe(true);
  }
  for (const texto of ["Quero sair mais cedo na consulta", "Não quero cancelar a consulta", "cancelar", "parar de sentir dor, o que faço?"]) {
    const p = telefoneNovo();
    await webhook(request, { kind: "text", instance: "e2e-alfa", phone: p, text: texto });
    await expect.poll(async () => (await sql(request, `SELECT 1 FROM crm_leads WHERE tenant_id=$1 AND telefone=$2`, [ALFA, p])).length).toBe(1); // mensagem foi processada
    expect(await optado(p), `"${texto}" NÃO deveria descadastrar`).toBe(false);
  }

  // Mesmo número com e sem o 9º dígito é a mesma pessoa: o SAIR vale para os dois formatos
  const oito = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const comNove = `55119${oito}`; const semNove = `5511${oito}`;
  await webhook(request, { kind: "text", instance: "e2e-alfa", phone: comNove, text: "SAIR" });
  await expect.poll(() => optado(comNove)).toBe(true);
  await sql(request, `INSERT INTO automation_jobs (id, tenant_id, instance, patient_phone, message, category, channel, status, scheduled_at, trigger_event, expires_at)
                      VALUES (gen_random_uuid()::text,$1,'e2e-alfa',$2,'Campanha (e2e) sem o 9','marketing','whatsapp','pending',NOW(),'manual',NOW()+interval '1 day')`, [ALFA, semNove]);
  await drenar(request, ALFA);
  expect(await enviosPara(request, semNove)).toHaveLength(0);
  expect((await jobsDe(request, semNove, ["manual"]))[0].status).toMatch(/failed|cancelled/);

  await drenar(request, ALFA);
  // Lembrete: 'nao', cancelado e sem telefone não geram pedido; rodar duas vezes gera um só
  const a = await pacienteComConsulta(request, ALFA, "Sem Lembrete (e2e)", "09:00");
  await sql(request, `UPDATE agendamentos SET confirmacao_quando='nao' WHERE id=$1`, [a.ag]);
  const b = await pacienteComConsulta(request, ALFA, "Cancelado (e2e)", "09:30");
  await sql(request, `UPDATE agendamentos SET status='cancelado' WHERE id=$1`, [b.ag]);
  const c = await pacienteComConsulta(request, ALFA, "Sem Telefone (e2e)", "10:00");
  await sql(request, `UPDATE pacientes SET telefone=NULL WHERE id=$1`, [c.pac]);
  const d = await pacienteComConsulta(request, ALFA, "Duplo Lembrete (e2e)", "10:30");
  await request.post(`${CTRL}/__reminders`); await request.post(`${CTRL}/__reminders`);
  expect(await jobsDe(request, a.phone, ["appointment_reminder"])).toHaveLength(0);
  expect(await jobsDe(request, b.phone, ["appointment_reminder"])).toHaveLength(0);
  expect((await sql(request, `SELECT 1 FROM automation_jobs WHERE flow_id=$1`, [`reminder_${c.ag}`]))).toHaveLength(0);
  expect(await jobsDe(request, d.phone, ["appointment_reminder"])).toHaveLength(1);

  // Nome vazio: "Olá!" (nunca "Olá, !")
  const e = await pacienteComConsulta(request, ALFA, " ", "11:00");
  await request.post(`${CTRL}/__reminders`);
  await drenar(request, ALFA);
  const [envE] = await enviosPara(request, e.phone);
  expect(textoDe(envE)).toContain("Olá!");
  expect(textoDe(envE)).not.toContain("Olá, !");

  // Duas consultas do mesmo paciente: o "1" digitado confirma UMA só (a do último pedido enviado)
  const f1 = await pacienteComConsulta(request, ALFA, "Duas Consultas (e2e)", "12:00");
  const amanha = brt(new Date(Date.now() + 24 * 3600_000));
  const f2 = (await sql(request, `INSERT INTO agendamentos (paciente_id, data, hora, status, tenant_id) VALUES ($1,$2,'13:00','agendado',$3) RETURNING id`, [f1.pac, amanha, ALFA]))[0].id as string;
  await request.post(`${CTRL}/__reminders`);
  await drenar(request, ALFA);
  expect((await enviosPara(request, f1.phone)).length).toBeGreaterThanOrEqual(2);
  await webhook(request, { kind: "text", instance: "e2e-alfa", phone: f1.phone, text: "1" });
  await expect.poll(async () => (await sql(request, `SELECT count(*)::int AS n FROM agendamentos WHERE id = ANY($1) AND status='confirmado'`, [[f1.ag, f2]]))[0].n).toBe(1);
});

// ── 12. Boas-vindas fora da janela e menu só com as filas da própria clínica ──
test("W12. fora da janela de envio a boas-vindas não entra e o menu sai direto; menu da B não mostra filas da A", async ({ request }) => {
  await configurarAtendimento(request, { businessHours: HORARIO_ABERTO, autoGreetingEnabled: true, welcomeMessage: "Boas-vindas (e2e) — não deve sair no domingo" });
  await sql(request, `UPDATE attendance_queues SET active=false WHERE tenant_id IN ($1,$2)`, [ALFA, BETA]);
  await sql(request, `INSERT INTO attendance_queues (name, icon, active, tenant_id) VALUES ('Fila só da Alfa','📞',true,$1),('Fila só da Beta','🦷',true,$2)`, [ALFA, BETA]);
  const p = telefoneNovo();
  await request.post(`${CTRL}/__clock`, { data: { iso: domingoPassado() } });
  await webhook(request, { kind: "text", instance: "e2e-alfa", phone: p, text: "oi" });
  expect(await tickAte(request, async () => (await enviosPara(request, p)).some((e) => e.endpoint === "sendButtons"))).toBe(true);
  const envs = await enviosPara(request, p);
  expect(envs.some((e) => /Boas-vindas \(e2e\)/.test(textoDe(e)))).toBe(false);
  expect(JSON.stringify(envs.find((e) => e.endpoint === "sendButtons")!.body.buttons)).toContain("Fila só da Alfa");
  // Mesma fala na instância da Beta: menu com a fila da Beta, nunca a da Alfa
  const q = telefoneNovo();
  await webhook(request, { kind: "text", instance: "e2e-beta", phone: q, text: "oi" });
  expect(await tickAte(request, async () => (await enviosPara(request, q)).some((e) => e.endpoint === "sendButtons"))).toBe(true);
  const menuB = (await enviosPara(request, q)).find((e) => e.endpoint === "sendButtons")!;
  expect(menuB.instance).toBe("e2e-beta");
  expect(JSON.stringify(menuB.body)).toContain("Fila só da Beta");
  expect(JSON.stringify(menuB.body)).not.toContain("Fila só da Alfa");
  // A Beta não herda a configuração de boas-vindas/expediente da Alfa
  expect((await enviosPara(request, q)).some((e) => /Boas-vindas \(e2e\)/.test(textoDe(e)))).toBe(false);
});
