/**
 * Supabase-backed adapters that match the `*Api` surface used across the app.
 * Each method returns `{ data, error }` to match the previous vpsApi shape,
 * so consuming components don't need to change.
 *
 * Phase 1: Pacientes, Dentistas, Agenda.
 */
import { supabase } from '@/integrations/supabase/client';

type Result<T = any> = { data: T | null; error: string | null };
/* eslint-disable @typescript-eslint/no-explicit-any */

function err(e: unknown): string {
  if (!e) return 'Erro desconhecido';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  const anyE = e as { message?: string };
  return anyE.message || 'Erro desconhecido';
}

async function getTenantId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  return (data?.tenant_id as string | null) ?? null;
}

// ─── Pacientes ─────────────────────────────────────────────

export const pacientesApi = {
  list: async (): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('pacientes')
      .select('*')
      .order('nome', { ascending: true });
    return { data, error: error ? err(error) : null };
  },

  create: async (body: Record<string, unknown>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload: Record<string, unknown> = { ...body, tenant_id };
    // strip empty strings that violate check constraints (e.g. sexo)
    for (const k of Object.keys(payload)) {
      if (payload[k] === '') payload[k] = null;
    }
    const { data, error } = await supabase
      .from('pacientes')
      .insert(payload as never)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },

  update: async (id: string, body: Record<string, unknown>): Promise<Result<any>> => {
    const payload: Record<string, unknown> = { ...body };
    delete payload.id;
    delete payload.tenant_id;
    for (const k of Object.keys(payload)) {
      if (payload[k] === '') payload[k] = null;
    }
    const { data, error } = await supabase
      .from('pacientes')
      .update(payload as never)
      .eq('id', id)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },

  delete: async (id: string): Promise<Result<{ success: true }>> => {
    const { error } = await supabase.from('pacientes').delete().eq('id', id);
    return { data: error ? null : { success: true }, error: error ? err(error) : null };
  },

  getAnamnese: async (pacienteId: string): Promise<Result<any>> => {
    const { data, error } = await supabase
      .from('anamneses')
      .select('*')
      .eq('paciente_id', pacienteId)
      .maybeSingle();
    return { data, error: error ? err(error) : null };
  },

  saveAnamnese: async (pacienteId: string, body: Record<string, unknown>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload = { ...body, paciente_id: pacienteId, tenant_id, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from('anamneses')
      .upsert(payload as never, { onConflict: 'paciente_id' })
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },

  getOdontograma: async (pacienteId: string): Promise<Result<any>> => {
    const { data, error } = await supabase
      .from('odontogramas')
      .select('*')
      .eq('paciente_id', pacienteId)
      .maybeSingle();
    return { data, error: error ? err(error) : null };
  },

  saveOdontograma: async (pacienteId: string, body: Record<string, unknown>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload = { ...body, paciente_id: pacienteId, tenant_id, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from('odontogramas')
      .upsert(payload as never, { onConflict: 'paciente_id' })
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },

  getHistorico: async (pacienteId: string): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('agendamentos')
      .select('id, data, hora, duracao, procedimento, status, observacoes, dentistas:dentista_id(nome, especialidade)')
      .eq('paciente_id', pacienteId)
      .order('data', { ascending: false })
      .order('hora', { ascending: false });
    if (error) return { data: null, error: err(error) };
    const mapped = (data ?? []).map((row: Record<string, unknown>) => {
      const d = row.dentistas as { nome?: string; especialidade?: string } | null;
      return {
        id: row.id,
        data: row.data,
        hora: row.hora,
        duracao: row.duracao,
        procedimento: row.procedimento ?? null,
        status: row.status,
        observacoes: row.observacoes ?? null,
        dentista_nome: d?.nome ?? null,
        dentista_especialidade: d?.especialidade ?? null,
      };
    });
    return { data: mapped, error: null };
  },
};

// ─── Dentistas ─────────────────────────────────────────────

export const dentistasApi = {
  list: async (): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('dentistas')
      .select('*')
      .order('nome', { ascending: true });
    return { data, error: error ? err(error) : null };
  },

  create: async (body: Record<string, unknown>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload = { ...body, tenant_id };
    const { data, error } = await supabase
      .from('dentistas')
      .insert(payload as never)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },

  update: async (id: string, body: Record<string, unknown>): Promise<Result<any>> => {
    const payload = { ...body };
    delete payload.id;
    delete payload.tenant_id;
    const { data, error } = await supabase
      .from('dentistas')
      .update(payload as never)
      .eq('id', id)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },

  delete: async (id: string): Promise<Result<{ success: true }>> => {
    const { error } = await supabase.from('dentistas').delete().eq('id', id);
    return { data: error ? null : { success: true }, error: error ? err(error) : null };
  },
};

// ─── Agenda ────────────────────────────────────────────────

export interface AgendamentoFlat {
  id: string;
  paciente_id: string;
  paciente_nome: string;
  dentista_id: string;
  dentista_nome: string;
  data: string;
  hora: string;
  duracao: number;
  procedimento: string;
  status: string;
  observacoes: string;
  telefone?: string;
  marcadores?: Array<{ id: string; nome: string; cor: string }>;
}

function flattenAgendamento(row: Record<string, unknown>): AgendamentoFlat {
  const p = row.pacientes as { nome?: string; telefone?: string; celular?: string } | null;
  const d = row.dentistas as { nome?: string } | null;
  return {
    id: row.id as string,
    paciente_id: (row.paciente_id as string) ?? '',
    paciente_nome: p?.nome ?? '',
    dentista_id: (row.dentista_id as string) ?? '',
    dentista_nome: d?.nome ?? '',
    data: row.data as string,
    hora: (row.hora as string) ?? '',
    duracao: (row.duracao as number) ?? 30,
    procedimento: (row.procedimento as string) ?? '',
    status: (row.status as string) ?? 'agendado',
    observacoes: (row.observacoes as string) ?? '',
    telefone: p?.celular ?? p?.telefone ?? '',
    marcadores: [],
  };
}

export const agendaApi = {
  list: async (params?: Record<string, string>): Promise<Result<AgendamentoFlat[]>> => {
    let q = supabase
      .from('agendamentos')
      .select('*, pacientes:paciente_id(nome, telefone, celular), dentistas:dentista_id(nome)')
      .order('data', { ascending: true })
      .order('hora', { ascending: true });
    if (params?.data_inicio) q = q.gte('data', params.data_inicio);
    if (params?.data_fim) q = q.lte('data', params.data_fim);
    if (params?.dentista_id) q = q.eq('dentista_id', params.dentista_id);
    const { data, error } = await q;
    if (error) return { data: null, error: err(error) };
    return { data: (data ?? []).map(flattenAgendamento), error: null };
  },

  create: async (body: Record<string, unknown>): Promise<Result<{ id: string; success: boolean }>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const allowed = ['paciente_id', 'dentista_id', 'data', 'hora', 'duracao', 'procedimento', 'status', 'observacoes'];
    const payload: Record<string, unknown> = { tenant_id };
    for (const k of allowed) if (body[k] !== undefined) payload[k] = body[k];
    const { data, error } = await supabase
      .from('agendamentos')
      .insert(payload as never)
      .select('id')
      .single();
    if (error) return { data: null, error: err(error) };
    return { data: { id: (data as { id: string }).id, success: true }, error: null };
  },

  createSerie: async (body: {
    paciente_id: string;
    dentista_id: string;
    data_inicio: string;
    hora: string;
    duracao?: number;
    procedimento?: string;
    quantidade: number;
    intervalo_dias: number;
    observacoes?: string;
    categoria?: string;
    categoria_cor?: string;
    primeira_consulta?: boolean;
    confirmacao_canal?: string;
    confirmacao_quando?: string;
    sala?: string;
  }): Promise<Result<{ serie_id: string; total: number; agendamentos: { id: string; data: string }[] }>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const rows: Record<string, unknown>[] = [];
    const start = new Date(body.data_inicio + 'T00:00:00');
    for (let i = 0; i < body.quantidade; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i * body.intervalo_dias);
      rows.push({
        tenant_id,
        paciente_id: body.paciente_id,
        dentista_id: body.dentista_id,
        data: d.toISOString().slice(0, 10),
        hora: body.hora,
        duracao: body.duracao ?? 30,
        procedimento: body.procedimento ?? null,
        observacoes: body.observacoes ?? null,
        status: 'agendado',
      });
    }
    const { data, error } = await supabase
      .from('agendamentos')
      .insert(rows as never)
      .select('id, data');
    if (error) return { data: null, error: err(error) };
    return {
      data: {
        serie_id: crypto.randomUUID(),
        total: rows.length,
        agendamentos: (data ?? []) as { id: string; data: string }[],
      },
      error: null,
    };
  },

  update: async (id: string, body: Record<string, unknown>): Promise<Result<any>> => {
    const allowed = ['status', 'hora', 'data', 'duracao', 'procedimento', 'observacoes', 'dentista_id', 'paciente_id'];
    const payload: Record<string, unknown> = {};
    for (const k of allowed) if (body[k] !== undefined) payload[k] = body[k];
    const { data, error } = await supabase
      .from('agendamentos')
      .update(payload as never)
      .eq('id', id)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },

  delete: async (id: string, _opts?: { serie?: boolean }): Promise<Result<{ success: true }>> => {
    const { error } = await supabase.from('agendamentos').delete().eq('id', id);
    return { data: error ? null : { success: true }, error: error ? err(error) : null };
  },
};

// Marcadores ainda não têm tabela dedicada — stub vazio
export interface MarcadorAgenda { id: string; nome: string; cor: string }
export const marcadoresAgendaApi = {
  list: async (): Promise<Result<MarcadorAgenda[]>> => ({ data: [], error: null }),
  create: async (nome: string, cor: string): Promise<Result<MarcadorAgenda>> => ({
    data: { id: crypto.randomUUID(), nome, cor }, error: null,
  }),
  delete: async (_id: string): Promise<Result<{ success: true }>> => ({ data: { success: true }, error: null }),
};

// ═══════════════════════════════════════════════════════════
// Fase 2: CRUDs genéricos
// ═══════════════════════════════════════════════════════════

function stripEmpty(o: Record<string, any>): Record<string, any> {
  const r: Record<string, any> = {};
  for (const k of Object.keys(o)) r[k] = o[k] === '' ? null : o[k];
  return r;
}

type Allowed<T> = readonly (keyof T)[] | null;

function pickAllowed(body: Record<string, any>, allowed: readonly string[] | null): Record<string, any> {
  if (!allowed) return { ...body };
  const out: Record<string, any> = {};
  for (const k of allowed) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

function makeCrud<TTable extends string>(opts: {
  table: TTable;
  orderBy?: { column: string; ascending?: boolean };
  allowedCreate?: readonly string[];
  allowedUpdate?: readonly string[];
  selectExtra?: string;
}) {
  const orderBy = opts.orderBy ?? { column: 'created_at', ascending: false };
  const selectCols = opts.selectExtra ?? '*';
  return {
    list: async (params?: Record<string, string>): Promise<Result<any[]>> => {
      let q = (supabase.from(opts.table as any) as any)
        .select(selectCols)
        .order(orderBy.column, { ascending: orderBy.ascending ?? false });
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== '') q = q.eq(k, v);
        }
      }
      const { data, error } = await q;
      return { data, error: error ? err(error) : null };
    },
    create: async (body: Record<string, any>): Promise<Result<any>> => {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
      const payload = stripEmpty({ ...pickAllowed(body, opts.allowedCreate ?? null), tenant_id });
      const { data, error } = await (supabase.from(opts.table as any) as any)
        .insert(payload)
        .select()
        .single();
      return { data, error: error ? err(error) : null };
    },
    update: async (id: string, body: Record<string, any>): Promise<Result<any>> => {
      const payload = stripEmpty(pickAllowed(body, opts.allowedUpdate ?? null));
      delete payload.id;
      delete payload.tenant_id;
      const { data, error } = await (supabase.from(opts.table as any) as any)
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      return { data, error: error ? err(error) : null };
    },
    delete: async (id: string): Promise<Result<{ success: true }>> => {
      const { error } = await (supabase.from(opts.table as any) as any).delete().eq('id', id);
      return { data: error ? null : { success: true }, error: error ? err(error) : null };
    },
  };
}

// ─── Tratamentos ───────────────────────────────────────────
const _tratamentosCrud = makeCrud({ table: 'tratamentos', orderBy: { column: 'created_at', ascending: false } });
export const tratamentosApi = {
  list: (params?: Record<string, string>) => _tratamentosCrud.list(params),
  create: (body: Record<string, any>) => _tratamentosCrud.create(body),
  update: (id: string, body: Record<string, any>) => _tratamentosCrud.update(id, body),
  delete: (id: string) => _tratamentosCrud.delete(id),
  getEtapas: async (tratamentoId: string): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('tratamento_etapas')
      .select('*')
      .eq('tratamento_id', tratamentoId)
      .order('ordem', { ascending: true });
    return { data, error: error ? err(error) : null };
  },
  addEtapa: async (tratamentoId: string, body: Record<string, any>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload = stripEmpty({ ...body, tratamento_id: tratamentoId, tenant_id });
    const { data, error } = await supabase
      .from('tratamento_etapas')
      .insert(payload as never)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },
  updateEtapa: async (id: string, body: Record<string, any>): Promise<Result<any>> => {
    const payload = stripEmpty(body);
    delete payload.id;
    delete payload.tenant_id;
    const { data, error } = await supabase
      .from('tratamento_etapas')
      .update(payload as never)
      .eq('id', id)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },
  deleteEtapa: async (id: string): Promise<Result<{ success: true }>> => {
    const { error } = await supabase.from('tratamento_etapas').delete().eq('id', id);
    return { data: error ? null : { success: true }, error: error ? err(error) : null };
  },
};

// ─── Orçamentos ────────────────────────────────────────────
const _orcamentosCrud = makeCrud({ table: 'orcamentos', orderBy: { column: 'created_at', ascending: false } });
export const orcamentosApi = {
  list: () => _orcamentosCrud.list(),
  create: async (body: Record<string, any>): Promise<Result<{ id: string; success: boolean }>> => {
    const r = await _orcamentosCrud.create(body);
    if (r.error || !r.data) return { data: null, error: r.error };
    return { data: { id: (r.data as any).id, success: true }, error: null };
  },
  update: (id: string, body: Record<string, any>) => _orcamentosCrud.update(id, body),
  delete: (id: string) => _orcamentosCrud.delete(id),
  updateStatus: async (id: string, status: string): Promise<Result<any>> => {
    const { data, error } = await supabase
      .from('orcamentos')
      .update({ status } as never)
      .eq('id', id)
      .select()
      .single();
    if (error) return { data: null, error: err(error) };
    return { data: { success: true, budget: data, leadMoved: false }, error: null };
  },
};

// ─── Prontuários ───────────────────────────────────────────
export const prontuariosApi = makeCrud({ table: 'prontuarios' });

// ─── Comissões ─────────────────────────────────────────────
export const comissoesApi = makeCrud({ table: 'comissoes', orderBy: { column: 'data', ascending: false } });

// ─── Contatos ──────────────────────────────────────────────
export const contatosApi = makeCrud({ table: 'contatos', orderBy: { column: 'nome', ascending: true } });

// ─── Financeiro principal ──────────────────────────────────
export const financeiroApi = makeCrud({ table: 'financeiro', orderBy: { column: 'data', ascending: false } });

// ─── Financeiro — sub-módulos ──────────────────────────────
export const finBanksApi = makeCrud({ table: 'fin_bank_accounts', orderBy: { column: 'name', ascending: true } });
export const finEmployeesApi = (() => {
  const c = makeCrud({ table: 'fin_employees', orderBy: { column: 'name', ascending: true } });
  return { list: c.list, create: c.create, delete: c.delete };
})();
export const finPayrollsApi = (() => {
  const c = makeCrud({ table: 'fin_payrolls', orderBy: { column: 'month', ascending: false } });
  return { list: c.list, create: c.create, update: c.update };
})();
export const finBillsApi = makeCrud({ table: 'fin_bills', orderBy: { column: 'due_date', ascending: true } });
export const finMovementsApi = (() => {
  const c = makeCrud({ table: 'fin_movements', orderBy: { column: 'date', ascending: false } });
  return { list: c.list, create: c.create };
})();
export const finOverdueApi = (() => {
  const c = makeCrud({ table: 'fin_overdue', orderBy: { column: 'days_late', ascending: false } });
  return { list: c.list, create: c.create, delete: c.delete };
})();

// ─── Estoque ───────────────────────────────────────────────
const _estoqueCrud = makeCrud({ table: 'estoque', orderBy: { column: 'nome', ascending: true } });
export const estoqueApi = {
  list: () => _estoqueCrud.list(),
  create: (body: Record<string, any>) => _estoqueCrud.create(body),
  update: (id: string, body: Record<string, any>) => _estoqueCrud.update(id, body),
  delete: (id: string) => _estoqueCrud.delete(id),
  getMovimentos: async (itemId: string): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('estoque_movimentos')
      .select('*')
      .eq('item_id', itemId)
      .order('created_at', { ascending: false });
    return { data, error: error ? err(error) : null };
  },
  addMovimento: async (itemId: string, body: Record<string, any>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload = stripEmpty({ ...body, item_id: itemId, tenant_id });
    const { data, error } = await supabase
      .from('estoque_movimentos')
      .insert(payload as never)
      .select()
      .single();
    if (error) return { data: null, error: err(error) };
    // ajustar quantidade no item
    const qty = Number(body.quantidade ?? 0);
    const tipo = body.tipo as string;
    if (qty && (tipo === 'entrada' || tipo === 'saida' || tipo === 'ajuste')) {
      const { data: item } = await supabase.from('estoque').select('quantidade').eq('id', itemId).maybeSingle();
      const atual = Number((item as any)?.quantidade ?? 0);
      const novo = tipo === 'entrada' ? atual + qty : tipo === 'saida' ? atual - qty : qty;
      await supabase.from('estoque').update({ quantidade: novo } as never).eq('id', itemId);
    }
    return { data, error: null };
  },
};

// ─── CRM Leads ─────────────────────────────────────────────
export const crmApi = {
  list: async (params?: Record<string, string>): Promise<Result<{ rows: any[]; total: number; limit: number; offset: number }>> => {
    let q = supabase
      .from('crm_leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });
    if (params?.status) q = q.eq('status', params.status);
    if (params?.kanban_stage) q = q.eq('kanban_stage', params.kanban_stage);
    if (params?.assigned_to) q = q.eq('assigned_to', params.assigned_to);
    const limit = params?.limit ? Number(params.limit) : 100;
    const offset = params?.offset ? Number(params.offset) : 0;
    q = q.range(offset, offset + limit - 1);
    const { data, error, count } = await q;
    if (error) return { data: null, error: err(error) };
    return { data: { rows: data ?? [], total: count ?? 0, limit, offset }, error: null };
  },
  kanban: async (): Promise<Result<Record<string, any[]>>> => {
    const { data, error } = await supabase
      .from('crm_leads')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return { data: null, error: err(error) };
    const grouped: Record<string, any[]> = {};
    for (const row of data ?? []) {
      const stage = (row as any).kanban_stage ?? 'lead';
      (grouped[stage] ??= []).push(row);
    }
    return { data: grouped, error: null };
  },
  updateStage: async (id: string, stage: string, _reason?: string): Promise<Result<any>> => {
    const { data, error } = await supabase
      .from('crm_leads')
      .update({ kanban_stage: stage, updated_at: new Date().toISOString() } as never)
      .eq('id', id)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },
  updateConsciousness: async (id: string, level: string): Promise<Result<any>> => {
    const { data, error } = await supabase
      .from('crm_leads')
      .update({ consciousness_level: level } as never)
      .eq('id', id)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },
  assign: async (id: string, assignedTo: string, assignedToName: string): Promise<Result<any>> => {
    const { data, error } = await supabase
      .from('crm_leads')
      .update({ assigned_to: assignedTo, assigned_to_name: assignedToName } as never)
      .eq('id', id)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },
  movements: async (_id: string): Promise<Result<any[]>> => ({ data: [], error: null }),
  convertToPatient: async (id: string): Promise<Result<any>> => {
    const { data: lead, error: leadErr } = await supabase
      .from('crm_leads').select('*').eq('id', id).maybeSingle();
    if (leadErr || !lead) return { data: null, error: leadErr ? err(leadErr) : 'Lead não encontrado' };
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    if ((lead as any).paciente_id) {
      return { data: { success: true, conflict: false, paciente_id: (lead as any).paciente_id }, error: null };
    }
    const { data: pac, error: pacErr } = await supabase
      .from('pacientes')
      .insert({
        tenant_id,
        nome: (lead as any).nome,
        telefone: (lead as any).telefone,
        celular: (lead as any).telefone,
        email: (lead as any).email,
      } as never)
      .select('id, nome')
      .single();
    if (pacErr || !pac) return { data: null, error: pacErr ? err(pacErr) : 'Falha ao criar paciente' };
    await supabase.from('crm_leads')
      .update({ paciente_id: (pac as any).id } as never)
      .eq('id', id);
    return { data: { success: true, paciente_id: (pac as any).id, nome: (pac as any).nome, paciente_nome: (pac as any).nome }, error: null };
  },
  linkToPatient: async (id: string, pacienteId: string): Promise<Result<any>> => {
    const { data: pac } = await supabase.from('pacientes').select('nome').eq('id', pacienteId).maybeSingle();
    const { error } = await supabase
      .from('crm_leads')
      .update({ paciente_id: pacienteId } as never)
      .eq('id', id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true, paciente_id: pacienteId, paciente_nome: (pac as any)?.nome ?? '' }, error: null };
  },
  history: async (id: string): Promise<Result<any[]>> => {
    const { data: lead } = await supabase.from('crm_leads').select('paciente_id').eq('id', id).maybeSingle();
    const pid = (lead as any)?.paciente_id;
    if (!pid) return { data: [], error: null };
    const { data, error } = await supabase
      .from('agendamentos')
      .select('id, data, hora, procedimento, status, dentistas:dentista_id(nome)')
      .eq('paciente_id', pid)
      .order('data', { ascending: false });
    if (error) return { data: null, error: err(error) };
    const mapped = (data ?? []).map((r: any) => ({
      id: r.id, data: r.data, hora: r.hora,
      procedimento: r.procedimento ?? '', status: r.status,
      dentista_nome: r.dentistas?.nome ?? '',
    }));
    return { data: mapped, error: null };
  },
  create: async (body: { nome: string; telefone?: string; email?: string; origem?: string; stage?: string; value?: number }): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload: Record<string, any> = {
      tenant_id, nome: body.nome,
      telefone: body.telefone ?? null,
      email: body.email ?? null,
      origem: body.origem ?? null,
      kanban_stage: body.stage ?? 'lead',
      valor: body.value ?? 0,
    };
    const { data, error } = await supabase
      .from('crm_leads')
      .insert(payload as never)
      .select()
      .single();
    return { data, error: error ? err(error) : null };
  },
};

// ─── Exames ────────────────────────────────────────────────
// Direct Supabase implementations (consumed by src/lib/examesApi.ts wrappers)
export const sbExamesApi = {
  list: async (params: Record<string, any> = {}): Promise<Result<any[]>> => {
    let q = supabase
      .from('exames')
      .select('*, pacientes:paciente_id(nome), dentistas:dentista_solicitante_id(nome)')
      .order('data_solicitacao', { ascending: false });
    if (params.status) q = q.eq('status', params.status);
    if (params.paciente_id) q = q.eq('paciente_id', params.paciente_id);
    if (params.terceirizado !== undefined && params.terceirizado !== '') q = q.eq('terceirizado', params.terceirizado);
    if (params.from) q = q.gte('data_solicitacao', params.from);
    if (params.to) q = q.lte('data_solicitacao', params.to);
    if (params.q) q = q.ilike('tipo_nome', `%${params.q}%`);
    const { data, error } = await q;
    if (error) return { data: null, error: err(error) };
    const mapped = (data ?? []).map((r: any) => ({
      ...r,
      paciente_nome: r.pacientes?.nome ?? null,
      dentista_nome: r.dentistas?.nome ?? null,
    }));
    return { data: mapped, error: null };
  },
  stats: async (): Promise<Result<any>> => {
    const { data, error } = await supabase.from('exames').select('status');
    if (error) return { data: null, error: err(error) };
    const base = { novo: 0, em_andamento: 0, aguardando_laudo: 0, concluido: 0, entregue: 0, cancelado: 0, total: 0 };
    for (const r of data ?? []) {
      const s = (r as any).status as keyof typeof base;
      if (s in base) base[s]++;
      base.total++;
    }
    return { data: base, error: null };
  },
  create: async (body: Record<string, any>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload = stripEmpty({ ...body, tenant_id });
    const { data, error } = await supabase.from('exames').insert(payload as never).select().single();
    return { data, error: error ? err(error) : null };
  },
  update: async (id: string, body: Record<string, any>): Promise<Result<any>> => {
    const payload = stripEmpty(body);
    delete payload.id; delete payload.tenant_id;
    const { data, error } = await supabase.from('exames').update(payload as never).eq('id', id).select().single();
    return { data, error: error ? err(error) : null };
  },
  remove: async (id: string): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('exames').delete().eq('id', id);
    return { data: { success: !error }, error: error ? err(error) : null };
  },
};

export const sbExameTiposApi = {
  list: async (): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('exame_tipos').select('*').order('nome', { ascending: true });
    return { data, error: error ? err(error) : null };
  },
  upsert: async (body: Record<string, any>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload = stripEmpty({ ...body, tenant_id });
    if (payload.id) {
      const { data, error } = await supabase
        .from('exame_tipos').update(payload as never).eq('id', payload.id).select().single();
      return { data, error: error ? err(error) : null };
    }
    delete payload.id;
    const { data, error } = await supabase.from('exame_tipos').insert(payload as never).select().single();
    return { data, error: error ? err(error) : null };
  },
  remove: async (id: string): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('exame_tipos').delete().eq('id', id);
    return { data: { success: !error }, error: error ? err(error) : null };
  },
};
