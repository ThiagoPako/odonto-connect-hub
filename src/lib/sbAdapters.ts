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
    if (params?.data) q = q.eq('data', params.data);
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

// ─── Painel Dentista ───────────────────────────────────────
function iniciaisOf(nome: string): string {
  return (nome || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '??';
}

async function resolveDentistaId(maybeId?: string): Promise<string | null> {
  if (maybeId) return maybeId;
  const { data: u } = await supabase.auth.getUser();
  const email = u.user?.email;
  if (email) {
    const { data } = await supabase
      .from('dentistas')
      .select('id')
      .eq('email', email)
      .eq('ativo', true)
      .maybeSingle();
    if ((data as any)?.id) return (data as any).id as string;
  }
  const { data: first } = await supabase
    .from('dentistas')
    .select('id')
    .eq('ativo', true)
    .order('nome', { ascending: true })
    .limit(1)
    .maybeSingle();
  return ((first as any)?.id as string) ?? null;
}

export const painelDentistaApi = {
  get: async (dentistaId?: string): Promise<Result<any>> => {
    const id = await resolveDentistaId(dentistaId);
    if (!id) return { data: null, error: 'Dentista não encontrado' };

    const { data: dentistaRow, error: dErr } = await supabase
      .from('dentistas')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (dErr || !dentistaRow) return { data: null, error: dErr ? err(dErr) : 'Dentista não encontrado' };
    const d = dentistaRow as any;

    const hoje = new Date().toISOString().slice(0, 10);

    const [agRes, orcRes, prntRes, comRes, tratRes] = await Promise.all([
      supabase
        .from('agendamentos')
        .select('id, paciente_id, data, hora, duracao, procedimento, status, observacoes, pacientes:paciente_id(nome)')
        .eq('dentista_id', id)
        .gte('data', hoje)
        .order('data', { ascending: true })
        .order('hora', { ascending: true })
        .limit(200),
      supabase
        .from('orcamentos')
        .select('id, paciente_id, itens, valor_total, status, created_at, pacientes:paciente_id(nome)')
        .eq('dentista_id', id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('prontuarios')
        .select('id, paciente_id, descricao, titulo, tipo, updated_at, pacientes:paciente_id(nome)')
        .eq('dentista_id', id)
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase
        .from('comissoes')
        .select('id, procedimento, data, valor, percentual, status, pago, pacientes:paciente_id(nome)')
        .eq('dentista_id', id)
        .order('data', { ascending: false })
        .limit(200),
      supabase
        .from('tratamentos')
        .select('id, paciente_id, descricao, dente, valor, status, plano, observacoes, created_at, updated_at, pacientes:paciente_id(nome)')
        .eq('dentista_id', id)
        .order('updated_at', { ascending: false })
        .limit(200),
    ]);

    const agendamentosRows: any[] = (agRes.data as any[]) ?? [];

    const atendimentos = agendamentosRows
      .filter((r) => r.data === hoje)
      .map((r) => ({
        id: r.id,
        pacienteId: r.paciente_id ?? undefined,
        pacienteNome: r.pacientes?.nome ?? 'Paciente',
        pacienteIniciais: iniciaisOf(r.pacientes?.nome ?? ''),
        horario: (r.hora as string)?.slice(0, 5) ?? '',
        tipo: r.procedimento ?? 'Consulta',
        status: r.status === 'em_atendimento' ? 'em_atendimento'
          : r.status === 'concluido' || r.status === 'finalizado' ? 'concluido'
          : r.status === 'cancelado' || r.status === 'falta' ? 'cancelado'
          : 'agendado',
        procedimento: r.procedimento ?? '',
      }));

    const agenda = agendamentosRows.map((r) => ({
      id: r.id,
      pacienteId: r.paciente_id ?? undefined,
      pacienteNome: r.pacientes?.nome ?? 'Paciente',
      data: r.data,
      horario: (r.hora as string)?.slice(0, 5) ?? '',
      duracao: r.duracao ?? 30,
      tipo: r.procedimento ?? 'Consulta',
      status: r.status === 'confirmado' ? 'confirmado'
        : r.status === 'cancelado' || r.status === 'falta' ? 'cancelado'
        : 'agendado',
      observacao: r.observacoes ?? undefined,
    }));

    const orcamentos = ((orcRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      pacienteId: r.paciente_id ?? undefined,
      pacienteNome: r.pacientes?.nome ?? 'Paciente',
      itens: Array.isArray(r.itens) ? r.itens.map((it: any) => ({
        procedimento: it.procedimento ?? it.nome ?? '',
        valor: Number(it.valor ?? it.preco ?? 0),
        quantidade: Number(it.quantidade ?? 1),
      })) : [],
      total: Number(r.valor_total ?? 0),
      status: r.status ?? 'pendente',
      criadoEm: r.created_at,
    }));

    const prontuarios = ((prntRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      pacienteId: r.paciente_id ?? undefined,
      pacienteNome: r.pacientes?.nome ?? 'Paciente',
      pacienteIniciais: iniciaisOf(r.pacientes?.nome ?? ''),
      ultimaConsulta: r.updated_at,
      diagnostico: r.titulo ?? '',
      tratamento: r.tipo ?? '',
      observacoes: r.descricao ?? '',
      alergias: [] as string[],
    }));

    const comissoes = ((comRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      pacienteNome: r.pacientes?.nome ?? 'Paciente',
      procedimento: r.procedimento ?? '',
      data: r.data,
      valorProcedimento: Number(r.valor ?? 0),
      percentual: Number(r.percentual ?? 0),
      valorComissao: Number(r.valor ?? 0) * (Number(r.percentual ?? 0) / 100),
      status: r.pago ? 'paga' : (r.status ?? 'pendente'),
    }));

    const tratamentos = ((tratRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      pacienteId: r.paciente_id ?? undefined,
      pacienteNome: r.pacientes?.nome ?? 'Paciente',
      descricao: r.descricao ?? '',
      dente: r.dente ?? '',
      valor: Number(r.valor ?? 0),
      status: r.status ?? 'planejado',
      plano: r.plano ?? '',
      observacoes: r.observacoes ?? '',
      criadoEm: r.created_at,
      atualizadoEm: r.updated_at,
    }));

    return {
      data: {
        dentista: {
          id: d.id,
          nome: d.nome,
          email: d.email ?? '',
          telefone: d.telefone ?? undefined,
          cro: d.cro ?? undefined,
          especialidade: d.especialidade ?? undefined,
          comissao: Number(d.comissao_percentual ?? 0),
          status: d.ativo ? 'ativo' : 'inativo',
        },
        atendimentos,
        agenda,
        orcamentos,
        prontuarios,
        comissoes,
        tratamentos,
      },
      error: null,
    };
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

// ─── Chat / Mensagens ──────────────────────────────────────

function rowToChatMessage(row: Record<string, any>): any {
  return {
    id: row.id,
    lead_id: row.lead_id,
    lead_name: row.metadata?.lead_name ?? row.metadata?.leadName ?? undefined,
    content: row.content ?? '',
    sender: row.sender === 'agent' || row.sender === 'me' || row.sender === 'attendant' ? 'attendant' : 'lead',
    type: row.type ?? 'text',
    timestamp: row.timestamp ?? row.created_at,
    status: row.status ?? undefined,
    media_url: row.media_url ?? undefined,
    file_name: row.file_name ?? undefined,
    mime_type: row.mime_type ?? undefined,
    reply_to_id: row.reply_to_id ?? undefined,
    metadata: row.metadata ?? {},
  };
}

export const sbMessagesApi = {
  list: async (
    leadId: string,
    params?: { before?: string; limit?: number },
  ): Promise<Result<{ messages: any[]; hasMore: boolean }>> => {
    const limit = params?.limit ?? 50;
    const tenant_id = await getTenantId();
    let q = supabase
      .from('chat_messages')
      .select('*')
      .eq('lead_id', leadId)
      .order('timestamp', { ascending: false })
      .limit(limit + 1);
    if (params?.before) q = q.lt('timestamp', params.before);
    const { data, error } = await q;
    if (error) return { data: null, error: err(error) };

    let rows = (data ?? []) as Record<string, any>[];

    // Some older webhook/import versions persisted WhatsApp messages with the
    // phone filled but with lead_id missing or not matching the CRM lead UUID.
    // When the queue resolves the lead by phone, opening the chat would then
    // show an empty conversation. If the exact lead_id lookup returns nothing,
    // recover by matching the same tenant + last 11 digits of the phone.
    if (rows.length === 0 && tenant_id) {
      let phoneSuffix = normalizePhoneDigits(leadId).slice(-11);
      if (!phoneSuffix || phoneSuffix.length < 8) {
        const { data: leadPhone } = await supabase
          .from('crm_leads')
          .select('telefone')
          .eq('tenant_id', tenant_id)
          .eq('id', leadId)
          .maybeSingle();
        phoneSuffix = normalizePhoneDigits((leadPhone as any)?.telefone).slice(-11);
      }

      if (phoneSuffix) {
        let phoneQuery = supabase
          .from('chat_messages')
          .select('*')
          .eq('tenant_id', tenant_id)
          .order('timestamp', { ascending: false })
          .limit(1000);
        if (params?.before) phoneQuery = phoneQuery.lt('timestamp', params.before);
        const { data: phoneRows, error: phoneError } = await phoneQuery;
        if (!phoneError) {
          rows = ((phoneRows ?? []) as Record<string, any>[])
            .filter((row) => {
              const meta = (row.metadata ?? {}) as Record<string, any>;
              const rowPhone = normalizePhoneDigits(row.phone || meta.remoteJidAlt || meta.remoteJid || '');
              return String(row.lead_id ?? '') === leadId || rowPhone.endsWith(phoneSuffix);
            })
            .slice(0, limit + 1);
        }
      }
    }

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    // Return oldest-first
    const messages = sliced.map(rowToChatMessage).reverse();
    return { data: { messages, hasMore }, error: null };
  },

  save: async (body: {
    id: string;
    leadId: string;
    content: string;
    type: string;
    status?: string;
    fileName?: string;
    fileUrl?: string;
    mimeType?: string;
    replyTo?: { messageId: string; content: string; sender: string } | null;
    instance?: string;
    phone?: string;
  }): Promise<Result<{ success: boolean; mediaUrl?: string }>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const { data: userData } = await supabase.auth.getUser();
    const row = stripEmpty({
      id: body.id,
      tenant_id,
      lead_id: body.leadId,
      content: body.content,
      sender: 'attendant',
      type: body.type,
      status: body.status ?? 'sent',
      media_url: body.fileUrl,
      file_name: body.fileName,
      mime_type: body.mimeType,
      reply_to_id: body.replyTo?.messageId,
      reply_to_content: body.replyTo?.content,
      reply_to_sender: body.replyTo?.sender,
      attendant_id: userData.user?.id,
      attendant_name: userData.user?.user_metadata?.nome ?? userData.user?.email,
      instance: body.instance,
      phone: body.phone,
      timestamp: new Date().toISOString(),
    });
    const { error } = await supabase.from('chat_messages').upsert(row as never, { onConflict: 'id' });
    if (error) return { data: null, error: err(error) };
    return { data: { success: true, mediaUrl: body.fileUrl }, error: null };
  },

  saveBatch: async (
    messages: Array<Record<string, any>>,
  ): Promise<Result<{ success: boolean; count: number }>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const rows = messages.map((m) =>
      stripEmpty({ ...m, tenant_id, timestamp: m.timestamp ?? new Date().toISOString() }),
    );
    const { error } = await supabase.from('chat_messages').upsert(rows as never, { onConflict: 'id' });
    if (error) return { data: null, error: err(error) };
    return { data: { success: true, count: rows.length }, error: null };
  },

  markRead: async (leadId: string): Promise<Result<{ success: boolean }>> => {
    const tenant_id = await getTenantId();
    const { data: userData } = await supabase.auth.getUser();
    if (!tenant_id || !userData.user) return { data: null, error: 'Sem sessão' };
    const { error } = await supabase
      .from('chat_read_status')
      .upsert(
        { tenant_id, user_id: userData.user.id, lead_id: leadId, last_read_at: new Date().toISOString() } as never,
        { onConflict: 'lead_id,user_id' },
      );
    return { data: { success: !error }, error: error ? err(error) : null };
  },

  updateStatus: async (id: string, status: string): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('chat_messages').update({ status } as never).eq('id', id);
    return { data: { success: !error }, error: error ? err(error) : null };
  },

  delete: async (id: string, _hard = false): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('chat_messages').delete().eq('id', id);
    return { data: { success: !error }, error: error ? err(error) : null };
  },

  unreadCounts: async (): Promise<Result<Record<string, number>>> => {
    const tenant_id = await getTenantId();
    const { data: userData } = await supabase.auth.getUser();
    if (!tenant_id || !userData.user) return { data: {}, error: null };

    const { data: reads } = await supabase
      .from('chat_read_status')
      .select('lead_id, last_read_at')
      .eq('user_id', userData.user.id);
    const readMap = new Map<string, string>();
    (reads ?? []).forEach((r: any) => readMap.set(r.lead_id, r.last_read_at));

    // Fetch recent incoming messages (last 1000) and tally unread per lead
    const { data: msgs, error } = await supabase
      .from('chat_messages')
      .select('lead_id, timestamp, sender')
      .eq('tenant_id', tenant_id)
      .neq('sender', 'attendant')
      .order('timestamp', { ascending: false })
      .limit(1000);
    if (error) return { data: null, error: err(error) };

    const counts: Record<string, number> = {};
    (msgs ?? []).forEach((m: any) => {
      const lastRead = readMap.get(m.lead_id);
      if (!lastRead || new Date(m.timestamp) > new Date(lastRead)) {
        counts[m.lead_id] = (counts[m.lead_id] ?? 0) + 1;
      }
    });
    return { data: counts, error: null };
  },

  search: async (q: string, leadId?: string): Promise<Result<any[]>> => {
    const tenant_id = await getTenantId();
    let query = supabase
      .from('chat_messages')
      .select('*')
      .ilike('content', `%${q}%`)
      .order('timestamp', { ascending: false })
      .limit(50);
    if (tenant_id) query = query.eq('tenant_id', tenant_id);
    if (leadId) query = query.eq('lead_id', leadId);
    const { data, error } = await query;
    if (error) return { data: null, error: err(error) };
    return { data: (data ?? []).map(rowToChatMessage), error: null };
  },
};

const normalizePhoneDigits = (value?: string | null): string => (value ?? '').replace(/\D/g, '');

const isUsableLeadName = (value?: string | null): boolean => {
  const v = (value ?? '').trim();
  return !!v && !v.includes('@') && Number.isNaN(Number(v.replace(/\D/g, '')));
};

async function fetchChatMessagesForLeadList(tenant_id: string, maxRows = 20_000): Promise<Record<string, any>[]> {
  const all: Record<string, any>[] = [];
  const pageSize = 1000;

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('lead_id, content, sender, type, timestamp, phone, instance, metadata')
      .eq('tenant_id', tenant_id)
      .order('timestamp', { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const batch = (data ?? []) as Record<string, any>[];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }

  return all;
}

export const sbQueueLeadsApi = {
  list: async (): Promise<Result<{ queue: any[]; active: any[] }>> => {
    try {
      const tenant_id = await getTenantId();
      const { data: userData } = await supabase.auth.getUser();
      if (!tenant_id) return { data: { queue: [], active: [] }, error: null };

      const [{ data: leads, error: leadsError }, { data: sessions, error: sessionsError }, { data: reads }] = await Promise.all([
        supabase
          .from('crm_leads')
          .select('id,nome,telefone,avatar_url,queue_id,queue_name,origem,priority,kanban_stage,updated_at')
          .eq('tenant_id', tenant_id),
        supabase
          .from('attendance_sessions')
          .select('id,lead_id,lead_phone,status,attendant_id,attendant_name,started_waiting_at,assigned_at,queue_id,queue_name,created_at')
          .eq('tenant_id', tenant_id)
          .in('status', ['waiting', 'active'])
          .order('created_at', { ascending: false }),
        userData.user
          ? supabase.from('chat_read_status').select('lead_id,last_read_at').eq('tenant_id', tenant_id).eq('user_id', userData.user.id)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      if (leadsError) return { data: null, error: err(leadsError) };
      if (sessionsError) return { data: null, error: err(sessionsError) };

      const chatRows = await fetchChatMessagesForLeadList(tenant_id);
      const leadMap = new Map<string, any>();
      const leadByPhone = new Map<string, any>();
      (leads ?? []).forEach((lead: any) => leadMap.set(String(lead.id), lead));
      (leads ?? []).forEach((lead: any) => {
        const phone = normalizePhoneDigits(lead.telefone);
        if (phone) leadByPhone.set(phone.slice(-11), lead);
      });

      const sessionMap = new Map<string, any>();
      (sessions ?? []).forEach((session: any) => {
        const leadId = String(session.lead_id ?? '');
        const phoneKey = normalizePhoneDigits(session.lead_phone).slice(-11);
        const key = leadId || phoneKey;
        if (key && !sessionMap.has(key)) sessionMap.set(key, session);
      });

      const readMap = new Map<string, string>();
      (reads ?? []).forEach((read: any) => readMap.set(String(read.lead_id), String(read.last_read_at)));

      const latestByLead = new Map<string, any>();
      const unreadByLead = new Map<string, number>();
      for (const msg of chatRows) {
        const meta = (msg.metadata ?? {}) as Record<string, any>;
        const msgPhone = normalizePhoneDigits(msg.phone || meta.remoteJidAlt || meta.remoteJid || '');
        const phoneKey = msgPhone.slice(-11);
        const matchedLead = phoneKey ? leadByPhone.get(phoneKey) : null;
        const leadId = String(matchedLead?.id || msg.lead_id || phoneKey || '');
        if (!leadId) continue;
        if (!latestByLead.has(leadId)) latestByLead.set(leadId, { ...msg, lead_id: leadId, phone: msg.phone || msgPhone });

        const isIncoming = !['attendant', 'agent', 'me'].includes(String(msg.sender ?? ''));
        const lastRead = readMap.get(leadId);
        if (isIncoming && (!lastRead || new Date(msg.timestamp) > new Date(lastRead))) {
          unreadByLead.set(leadId, (unreadByLead.get(leadId) ?? 0) + 1);
        }
      }

      const leadIds = new Set<string>([...latestByLead.keys(), ...sessionMap.keys()]);
      const queue: any[] = [];
      const active: any[] = [];

      for (const leadId of leadIds) {
        const session = sessionMap.get(leadId);
        const latest = latestByLead.get(leadId);
        const meta = (latest?.metadata ?? {}) as Record<string, any>;
        const latestPhone = latest?.phone || normalizePhoneDigits(meta.remoteJidAlt || meta.remoteJid || '');
        const crmLead = leadMap.get(leadId) || leadByPhone.get(normalizePhoneDigits(latestPhone || session?.lead_phone).slice(-11));
        const phone = crmLead?.telefone || latestPhone || session?.lead_phone || '';
        const fallbackName = meta.contactName || meta.pushName || normalizePhoneDigits(phone) || 'Sem nome';
        const name = isUsableLeadName(crmLead?.nome) ? crmLead.nome : fallbackName;
        const lastMessageTime = latest?.timestamp || session?.assigned_at || session?.started_waiting_at || session?.created_at || crmLead?.updated_at || new Date().toISOString();

        const item = {
          id: leadId,
          name,
          phone,
          avatarUrl: crmLead?.avatar_url ?? null,
          queueId: session?.queue_id || crmLead?.queue_id || undefined,
          queueName: session?.queue_name || crmLead?.queue_name || undefined,
          origem: crmLead?.origem,
          priority: crmLead?.priority || false,
          lastMessage: latest?.content || '',
          lastMessageTime,
          unreadCount: unreadByLead.get(leadId) ?? 0,
          sessionStatus: session?.status || 'waiting',
          attendantId: session?.attendant_id || undefined,
          attendantName: session?.attendant_name || undefined,
          instance: latest?.instance || undefined,
        };

        if (session?.status === 'active' && session?.attendant_id) active.push(item);
        else queue.push(item);
      }

      const byRecent = (a: any, b: any) => new Date(b.lastMessageTime || 0).getTime() - new Date(a.lastMessageTime || 0).getTime();
      queue.sort((a, b) => (a.priority && !b.priority ? -1 : !a.priority && b.priority ? 1 : byRecent(a, b)));
      active.sort(byRecent);

      return { data: { queue, active }, error: null };
    } catch (e) {
      return { data: null, error: err(e) };
    }
  },
};

// ─── Attendance Queues ──────────────────────────────────────

export const sbQueuesApi = {
  list: async (): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('attendance_queues')
      .select('*')
      .order('created_at', { ascending: true });
    return { data, error: error ? err(error) : null };
  },
  create: async (body: Record<string, any>): Promise<Result<{ success: boolean; id: string }>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload = {
      tenant_id,
      name: body.name,
      color: body.color ?? '#3B82F6',
      icon: body.icon ?? '📋',
      description: body.description ?? null,
      whatsapp_button_label: body.whatsapp_button_label ?? null,
      contact_numbers: body.contact_numbers ?? [],
      team_member_ids: body.team_member_ids ?? [],
      active: body.active ?? true,
    };
    const { data, error } = await supabase
      .from('attendance_queues')
      .insert(payload)
      .select('id')
      .single();
    if (error) return { data: null, error: err(error) };
    return { data: { success: true, id: data!.id }, error: null };
  },
  update: async (id: string, body: Record<string, unknown>): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('attendance_queues').update(body as any).eq('id', id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true }, error: null };
  },
  delete: async (id: string): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('attendance_queues').delete().eq('id', id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true }, error: null };
  },
};

// ─── Attendance Sessions ────────────────────────────────────

export const sbSessionsApi = {
  start: async (body: { leadId: string; leadName?: string; leadPhone?: string; queueId?: string; queueName?: string }): Promise<Result<{ success: boolean; id: string }>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const now = new Date().toISOString();
    const payload = {
      tenant_id,
      lead_id: body.leadId,
      lead_name: body.leadName ?? null,
      lead_phone: body.leadPhone ?? null,
      queue_id: body.queueId ?? null,
      queue_name: body.queueName ?? null,
      status: 'waiting',
      started_waiting_at: now,
    };
    const { data, error } = await supabase
      .from('attendance_sessions')
      .insert(payload)
      .select('id')
      .single();
    if (error) return { data: null, error: err(error) };
    return { data: { success: true, id: data!.id }, error: null };
  },
  assign: async (body: { leadId: string }): Promise<Result<{ success: boolean; id: string; waitTime: number }>> => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return { data: null, error: 'Não autenticado' };
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const { data: profile } = await supabase
      .from('profiles').select('nome').eq('id', userData.user.id).maybeSingle();
    // Find latest waiting session for this lead
    const { data: session, error: findErr } = await supabase
      .from('attendance_sessions')
      .select('id, started_waiting_at')
      .eq('lead_id', body.leadId)
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findErr) return { data: null, error: err(findErr) };
    if (!session) {
      const { data: lead } = await supabase
        .from('crm_leads')
        .select('nome,telefone,queue_id,queue_name')
        .eq('id', body.leadId)
        .maybeSingle();
      const now = new Date().toISOString();
      const { data: created, error: createErr } = await supabase
        .from('attendance_sessions')
        .insert({
          tenant_id,
          lead_id: body.leadId,
          lead_name: (lead as any)?.nome ?? null,
          lead_phone: (lead as any)?.telefone ?? null,
          queue_id: (lead as any)?.queue_id ?? null,
          queue_name: (lead as any)?.queue_name ?? null,
          attendant_id: userData.user.id,
          attendant_name: profile?.nome ?? null,
          assigned_at: now,
          started_waiting_at: now,
          wait_time_seconds: 0,
          status: 'active',
        } as never)
        .select('id')
        .single();
      if (createErr) return { data: null, error: err(createErr) };
      return { data: { success: true, id: (created as any).id, waitTime: 0 }, error: null };
    }
    const now = new Date();
    const waitTime = session.started_waiting_at
      ? Math.floor((now.getTime() - new Date(session.started_waiting_at).getTime()) / 1000)
      : 0;
    const { error } = await supabase
      .from('attendance_sessions')
      .update({
        attendant_id: userData.user.id,
        attendant_name: profile?.nome ?? null,
        assigned_at: now.toISOString(),
        wait_time_seconds: waitTime,
        status: 'active',
      })
      .eq('id', session.id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true, id: session.id, waitTime }, error: null };
  },
  checkActive: async (leadId: string): Promise<Result<{ active: boolean; attendantId?: string; attendantName?: string; isCurrentUser?: boolean }>> => {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('attendance_sessions')
      .select('attendant_id, attendant_name, status')
      .eq('lead_id', leadId)
      .in('status', ['active', 'waiting'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { data: null, error: err(error) };
    if (!data || data.status !== 'active') {
      return { data: { active: false }, error: null };
    }
    return {
      data: {
        active: true,
        attendantId: data.attendant_id ?? undefined,
        attendantName: data.attendant_name ?? undefined,
        isCurrentUser: userData.user?.id === data.attendant_id,
      },
      error: null,
    };
  },
  firstResponse: async (body: { leadId: string }): Promise<Result<any>> => {
    const { data: session, error: findErr } = await supabase
      .from('attendance_sessions')
      .select('id, assigned_at, first_response_at')
      .eq('lead_id', body.leadId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findErr) return { data: null, error: err(findErr) };
    if (!session || session.first_response_at) return { data: { success: true }, error: null };
    const now = new Date();
    const respTime = session.assigned_at
      ? Math.floor((now.getTime() - new Date(session.assigned_at).getTime()) / 1000)
      : 0;
    const { error } = await supabase
      .from('attendance_sessions')
      .update({ first_response_at: now.toISOString(), response_time_seconds: respTime })
      .eq('id', session.id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true }, error: null };
  },
  close: async (body: { leadId: string; leadPhone?: string; instance?: string }): Promise<Result<{ success: boolean; sessionId?: string; duration?: number }>> => {
    const { data: session, error: findErr } = await supabase
      .from('attendance_sessions')
      .select('id, assigned_at, started_waiting_at')
      .eq('lead_id', body.leadId)
      .in('status', ['active', 'waiting'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findErr) return { data: null, error: err(findErr) };
    if (!session) return { data: { success: true }, error: null };
    const now = new Date();
    const startRef = session.assigned_at ?? session.started_waiting_at;
    const duration = startRef
      ? Math.floor((now.getTime() - new Date(startRef).getTime()) / 1000)
      : 0;
    const { error } = await supabase
      .from('attendance_sessions')
      .update({ status: 'closed', closed_at: now.toISOString(), duration_seconds: duration })
      .eq('id', session.id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true, sessionId: session.id, duration }, error: null };
  },
  list: async (params?: { active?: boolean }): Promise<Result<any[]>> => {
    try {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant' };
      let q = (supabase as any).from('attendance_sessions').select('*').eq('tenant_id', tenant_id);
      if (params?.active) {
        q = q.in('status', ['active', 'waiting']);
      }
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) return { data: null, error: err(error) };
      const mapped = (data || []).map((s: any) => ({
        ...s,
        lead_nome: s.lead_name || 'Sem nome',
        started_at: s.assigned_at || s.started_waiting_at || s.created_at
      }));
      return { data: mapped, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
};

// ─── Media Upload (Supabase Storage: bucket chat-media) ─────

export const sbMediaApi = {
  upload: async (file: File): Promise<{ url: string | null; error: string | null }> => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? 'anon';
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin';
      const safeBase = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
      const path = `${uid}/${Date.now()}-${safeBase}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('chat-media')
        .upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });
      if (upErr) return { url: null, error: err(upErr) };
      const { data } = supabase.storage.from('chat-media').getPublicUrl(path);
      return { url: data.publicUrl, error: null };
    } catch (e) {
      return { url: null, error: err(e) };
    }
  },
};

// ─── Lead Tags ──────────────────────────────────────────────

export const sbTagsApi = {
  list: async (): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('lead_tags')
      .select('*')
      .order('name', { ascending: true });
    if (error) return { data: null, error: err(error) };
    return { data, error: null };
  },
  create: async (body: { name: string; color?: string; icon?: string }): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const { data, error } = await supabase
      .from('lead_tags')
      .insert({ tenant_id, name: body.name, color: body.color ?? '#3B82F6', icon: body.icon ?? '📌' })
      .select('*')
      .single();
    if (error) return { data: null, error: err(error) };
    return { data, error: null };
  },
  update: async (id: string, body: { name?: string; color?: string; icon?: string }): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('lead_tags').update(body).eq('id', id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true }, error: null };
  },
  delete: async (id: string): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('lead_tags').delete().eq('id', id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true }, error: null };
  },
  assignments: async (): Promise<Result<Record<string, string[]>>> => {
    const { data, error } = await supabase
      .from('lead_tag_assignments')
      .select('lead_id, tag_id');
    if (error) return { data: null, error: err(error) };
    const map: Record<string, string[]> = {};
    (data ?? []).forEach((r: any) => {
      (map[r.lead_id] ||= []).push(r.tag_id);
    });
    return { data: map, error: null };
  },
  toggle: async (leadId: string, tagId: string): Promise<Result<{ action: 'added' | 'removed' }>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const { data: existing } = await supabase
      .from('lead_tag_assignments')
      .select('id')
      .eq('lead_id', leadId)
      .eq('tag_id', tagId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase.from('lead_tag_assignments').delete().eq('id', existing.id);
      if (error) return { data: null, error: err(error) };
      return { data: { action: 'removed' }, error: null };
    }
    const { error } = await supabase
      .from('lead_tag_assignments')
      .insert({ tenant_id, lead_id: leadId, tag_id: tagId });
    if (error) return { data: null, error: err(error) };
    return { data: { action: 'added' }, error: null };
  },
};

// ─── Contatos ───────────────────────────────────────────────

export const sbContatosApi = {
  list: async (_params?: Record<string, string>): Promise<Result<any[]>> => {
    const { data, error } = await supabase
      .from('contatos')
      .select('*')
      .order('nome', { ascending: true });
    if (error) return { data: null, error: err(error) };
    return { data, error: null };
  },
  create: async (body: Record<string, any>): Promise<Result<any>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const payload: Record<string, any> = { tenant_id, ...body };
    for (const k of Object.keys(payload)) if (payload[k] === '') payload[k] = null;
    const { data, error } = await supabase.from('contatos').insert(payload).select('*').single();
    if (error) return { data: null, error: err(error) };
    return { data, error: null };
  },
  update: async (id: string, body: Record<string, any>): Promise<Result<any>> => {
    const payload: Record<string, any> = { ...body };
    delete payload.id; delete payload.tenant_id; delete payload.created_at; delete payload.updated_at;
    for (const k of Object.keys(payload)) if (payload[k] === '') payload[k] = null;
    const { data, error } = await supabase.from('contatos').update(payload as any).eq('id', id).select('*').single();
    if (error) return { data: null, error: err(error) };
    return { data, error: null };
  },
  delete: async (id: string): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('contatos').delete().eq('id', id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true }, error: null };
  },
  toggleFavorito: async (id: string): Promise<Result<any>> => {
    const { data: row } = await supabase.from('contatos').select('favorito').eq('id', id).maybeSingle();
    const { data, error } = await supabase
      .from('contatos')
      .update({ favorito: !row?.favorito })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return { data: null, error: err(error) };
    return { data, error: null };
  },
  bulkImport: async (contatos: Array<{ telefone: string; nome: string }>): Promise<Result<{ imported: number; skipped: number; total: number }>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    if (!contatos.length) return { data: { imported: 0, skipped: 0, total: 0 }, error: null };
    const phones = contatos.map(c => c.telefone).filter(Boolean);
    const { data: existing } = await supabase
      .from('contatos')
      .select('telefone')
      .in('telefone', phones);
    const existSet = new Set((existing ?? []).map((r: any) => r.telefone));
    const toInsert = contatos
      .filter(c => c.telefone && !existSet.has(c.telefone))
      .map(c => ({ tenant_id, nome: c.nome || c.telefone, telefone: c.telefone, tipo: 'whatsapp' }));
    if (!toInsert.length) {
      return { data: { imported: 0, skipped: contatos.length, total: contatos.length }, error: null };
    }
    const { error } = await supabase.from('contatos').insert(toInsert);
    if (error) return { data: null, error: err(error) };
    return {
      data: { imported: toInsert.length, skipped: contatos.length - toInsert.length, total: contatos.length },
      error: null,
    };
  },
  syncNow: async () => ({ data: null, error: 'Sincronização WhatsApp disponível apenas via VPS' } as Result<any>),
  syncStatus: async () => {
    const { count } = await supabase
      .from('contatos')
      .select('id', { count: 'exact', head: true });
    return {
      data: { autoSync: false, intervalMinutes: 0, totalContatos: count ?? 0 },
      error: null,
    } as Result<any>;
  },
};

// ─── Transfer Logs ──────────────────────────────────────────
export const sbTransferApi = {
  async create(body: {
    leadId: string;
    leadName?: string;
    leadPhone?: string;
    toUserId: string;
    toUserName?: string;
    reason: string;
    queueId?: string;
    queueName?: string;
  }): Promise<Result<{ success: boolean; id: string }>> {
    try {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant' };
      const { data: userData } = await supabase.auth.getUser();
      const from_user_id = userData.user?.id ?? null;
      let from_user_name: string | null = null;
      if (from_user_id) {
        const { data: prof } = await supabase
          .from('profiles').select('nome').eq('id', from_user_id).maybeSingle();
        from_user_name = (prof?.nome as string | null) ?? null;
      }
      const { data, error } = await supabase
        .from('transfer_logs')
        .insert({
          tenant_id,
          lead_id: body.leadId,
          lead_name: body.leadName ?? null,
          lead_phone: body.leadPhone ?? null,
          from_user_id,
          from_user_name,
          to_user_id: body.toUserId,
          to_user_name: body.toUserName ?? null,
          reason: body.reason,
          queue_id: body.queueId ?? null,
          queue_name: body.queueName ?? null,
        } as any)
        .select('id')
        .single();
      if (error) return { data: null, error: error.message };
      return { data: { success: true, id: (data as any).id }, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
  async list(params?: Record<string, string>): Promise<Result<any[]>> {
    try {
      let q = supabase.from('transfer_logs').select('*').order('created_at', { ascending: false });
      if (params?.leadId) q = q.eq('lead_id', params.leadId);
      if (params?.userId) q = q.or(`from_user_id.eq.${params.userId},to_user_id.eq.${params.userId}`);
      if (params?.limit) q = q.limit(Number(params.limit));
      const { data, error } = await q;
      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
};

// ─── User Preferences ──────────────────────────────────────
export const sbUserPreferencesApi = {
  async get(): Promise<Result<any>> {
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { data: null, error: 'Não autenticado' };
      const { data, error } = await supabase
        .from('user_preferences').select('*').eq('user_id', u.user.id).maybeSingle();
      if (error) return { data: null, error: error.message };
      return { data: data ?? null, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
  async update(body: Record<string, any>): Promise<Result<any>> {
    try {
      const tenant_id = await getTenantId();
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || !tenant_id) return { data: null, error: 'Não autenticado' };
      const { data, error } = await supabase
        .from('user_preferences')
        .upsert({ user_id: u.user.id, tenant_id, ...body } as any, { onConflict: 'user_id' })
        .select('*').single();
      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
};

// ─── Push Subscriptions ────────────────────────────────────
export const sbPushSubscriptionsApi = {
  async subscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<Result<any>> {
    try {
      const tenant_id = await getTenantId();
      const { data: u } = await supabase.auth.getUser();
      if (!tenant_id || !u.user) return { data: null, error: 'Não autenticado' };
      const { data, error } = await supabase
        .from('push_subscriptions')
        .upsert({
          tenant_id,
          user_id: u.user.id,
          endpoint: sub.endpoint,
          keys_p256dh: sub.keys.p256dh,
          keys_auth: sub.keys.auth,
        } as any, { onConflict: 'endpoint' })
        .select('*').single();
      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
  async unsubscribe(endpoint: string): Promise<Result<{ success: boolean }>> {
    try {
      const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      if (error) return { data: null, error: error.message };
      return { data: { success: true }, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
};

// ─── Reactivation ─────────────────────────────────────────
export const sbReactivationApi = makeCrud({ table: 'reactivation_rules', orderBy: { column: 'created_at', ascending: false } });
export const sbReactivationSendsApi = makeCrud({ table: 'reactivation_sends', orderBy: { column: 'sent_at', ascending: false } });

// ─── Satisfaction Ratings ─────────────────────────────────
export const sbSatisfactionApi = {
  async create(body: {
    sessionId?: string;
    leadId: string;
    leadPhone?: string;
    rating: number;
    attendantId?: string;
    attendantName?: string;
  }): Promise<Result<any>> {
    try {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant' };
      const { data, error } = await supabase
        .from('satisfaction_ratings')
        .insert({
          tenant_id,
          session_id: body.sessionId ?? null,
          lead_id: body.leadId,
          lead_phone: body.leadPhone ?? null,
          rating: body.rating,
          attendant_id: body.attendantId ?? null,
          attendant_name: body.attendantName ?? null,
        } as any)
        .select('*').single();
      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
  async list(params?: { sessionId?: string; leadId?: string }): Promise<Result<any[]>> {
    try {
      let q = supabase.from('satisfaction_ratings').select('*').order('created_at', { ascending: false });
      if (params?.sessionId) q = q.eq('session_id', params.sessionId);
      if (params?.leadId) q = q.eq('lead_id', params.leadId);
      const { data, error } = await q;
      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
};

// ─── System Settings ──────────────────────────────────────
export const sbSystemSettingsApi = {
  async get(key: string): Promise<Result<any>> {
    try {
      const { data, error } = await supabase
        .from('system_settings').select('value').eq('key', key).maybeSingle();
      if (error) return { data: null, error: error.message };
      return { data: (data as any)?.value ?? null, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
  async set(key: string, value: any): Promise<Result<any>> {
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .upsert({ key, value } as any, { onConflict: 'key' })
        .select('*').single();
      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
};

// ─── Attendance Settings (per-tenant via system_settings) ─
const ATTENDANCE_KEY = 'attendance_settings';
export const sbAttendanceSettingsApi = {
  async get(): Promise<Result<any>> {
    try {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant' };
      const key = `${ATTENDANCE_KEY}:${tenant_id}`;
      const { data } = await supabase
        .from('system_settings').select('value').eq('key', key).maybeSingle();
      return { data: (data as any)?.value ?? {}, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
  async update(body: any): Promise<Result<any>> {
    try {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant' };
      const key = `${ATTENDANCE_KEY}:${tenant_id}`;
      const { data, error } = await supabase
        .from('system_settings')
        .upsert({ key, value: body } as any, { onConflict: 'key' })
        .select('value').single();
      if (error) return { data: null, error: error.message };
      return { data: (data as any).value, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
};

// ─── Metrics Api ──────────────────────────────────────────
export const sbMetricsApi = {
  async attendance(days?: number): Promise<Result<any>> {
    try {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant' };
      const since = days ? new Date(Date.now() - days * 86400000).toISOString() : null;

      let sq = supabase.from('attendance_sessions').select('*').eq('tenant_id', tenant_id);
      if (since) sq = sq.gte('created_at', since);
      const { data: sessions, error: e1 } = await sq;
      if (e1) return { data: null, error: e1.message };

      let rq = supabase.from('satisfaction_ratings').select('*').eq('tenant_id', tenant_id);
      if (since) rq = rq.gte('created_at', since);
      const { data: ratings, error: e2 } = await rq;
      if (e2) return { data: null, error: e2.message };

      const ss = (sessions ?? []) as any[];
      const closed = ss.filter((s) => s.status === 'closed');
      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const nums = (key: string) => ss.map((s) => s[key]).filter((v) => v != null) as number[];
      const waits = nums('wait_time_seconds');
      const general = {
        total_sessions: String(ss.length),
        closed_sessions: String(closed.length),
        avg_wait_time: avg(waits)?.toString() ?? null,
        avg_response_time: avg(nums('response_time_seconds'))?.toString() ?? null,
        avg_duration: avg(nums('duration_seconds'))?.toString() ?? null,
        max_wait_time: waits.length ? Math.max(...waits) : null,
        min_wait_time: waits.length ? Math.min(...waits) : null,
      };

      const byAtt = new Map<string, any[]>();
      for (const s of ss) {
        if (!s.attendant_id) continue;
        const arr = byAtt.get(s.attendant_id) ?? [];
        arr.push(s); byAtt.set(s.attendant_id, arr);
      }
      const perAttendant = Array.from(byAtt.entries()).map(([id, arr]) => ({
        attendant_id: id,
        attendant_name: arr[0]?.attendant_name ?? '',
        total_sessions: String(arr.length),
        closed_sessions: String(arr.filter((x) => x.status === 'closed').length),
        avg_wait_time: avg(arr.map((x) => x.wait_time_seconds).filter((v) => v != null))?.toString() ?? null,
        avg_response_time: avg(arr.map((x) => x.response_time_seconds).filter((v) => v != null))?.toString() ?? null,
        avg_duration: avg(arr.map((x) => x.duration_seconds).filter((v) => v != null))?.toString() ?? null,
      }));

      const rr = (ratings ?? []) as any[];
      const ratingNums = rr.map((r) => r.rating);
      const satisfaction = {
        avg_rating: avg(ratingNums)?.toString() ?? null,
        total_ratings: String(rr.length),
        five_star: String(ratingNums.filter((r) => r === 5).length),
        four_star: String(ratingNums.filter((r) => r === 4).length),
        three_star: String(ratingNums.filter((r) => r === 3).length),
        two_star: String(ratingNums.filter((r) => r === 2).length),
        one_star: String(ratingNums.filter((r) => r === 1).length),
      };

      const byAttR = new Map<string, any[]>();
      for (const r of rr) {
        if (!r.attendant_id) continue;
        const arr = byAttR.get(r.attendant_id) ?? [];
        arr.push(r); byAttR.set(r.attendant_id, arr);
      }
      const satisfactionPerAttendant = Array.from(byAttR.entries()).map(([id, arr]) => ({
        attendant_id: id,
        attendant_name: arr[0]?.attendant_name ?? '',
        avg_rating: (avg(arr.map((x) => x.rating)) ?? 0).toString(),
        total_ratings: String(arr.length),
      }));

      return { data: { general, perAttendant, satisfaction, satisfactionPerAttendant }, error: null };
    } catch (e) { return { data: null, error: err(e) }; }
  },
};

// ─── Comercial / CRM ───────────────────────────────────────
export const leadsApi = makeCrud({ table: 'leads', orderBy: { column: 'created_at', ascending: false } });
export const funisApi = makeCrud({ table: 'funis', orderBy: { column: 'ordem', ascending: true } });
export const etapasApi = makeCrud({ table: 'etapas', orderBy: { column: 'ordem', ascending: true } });
export const followUpsApi = makeCrud({ table: 'follow_ups', orderBy: { column: 'data_agendada', ascending: true } });
export const atendentesApi = makeCrud({ table: 'atendentes', orderBy: { column: 'nome', ascending: true } });
export const origensApi = makeCrud({ table: 'origens', orderBy: { column: 'nome', ascending: true } });

export const comercialApi = {
  painel: async (attendantId?: string): Promise<Result<any>> => {
    try {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant' };

      // Parallel queries for dashboard components
      const [leadsRes, agendamentosRes, followUpsRes] = await Promise.all([
        supabase.from('leads').select('*').eq('tenant_id', tenant_id),
        supabase.from('agendamentos').select('*').eq('tenant_id', tenant_id).gte('data', new Date().toISOString().split('T')[0]),
        supabase.from('follow_ups').select('*, leads(nome)').eq('tenant_id', tenant_id).eq('status', 'pendente').order('data_agendada', { ascending: true })
      ]);

      const leads = leadsRes.data ?? [];
      const agendamentos = agendamentosRes.data ?? [];
      const followUpsRaw = followUpsRes.data ?? [];

      const filteredLeads = attendantId ? leads.filter(l => l.atendente_id === attendantId) : leads;
      
      const leadsPendentes = filteredLeads.filter(l => l.status === 'novo').length;
      const agendamentosHoje = agendamentos.length;
      const convertidos = leads.filter(l => l.status === 'convertido').length;
      const taxaConversao = leads.length > 0 ? (convertidos / leads.length) * 100 : 0;

      // Group by origin for conversion chart
      const originsMap = new Map<string, { leads: number, convertidos: number }>();
      leads.forEach(l => {
        const origin = l.origem || 'Outros';
        const stats = originsMap.get(origin) || { leads: 0, convertidos: 0 };
        stats.leads++;
        if (l.status === 'convertido') stats.convertidos++;
        originsMap.set(origin, stats);
      });

      const conversionByOrigin = Array.from(originsMap.entries()).map(([origin, stats]) => ({
        origin,
        leads: stats.leads,
        convertidos: stats.convertidos,
        rate: stats.leads > 0 ? (stats.convertidos / stats.leads) * 100 : 0
      }));

      const data = {
        attendantId: attendantId || 'all',
        kpis: {
          atendimentosHoje: 0,
          agendamentosHoje,
          taxaConversao,
          leadsPendentes
        },
        followUps: followUpsRaw.map((f: any) => ({
          id: f.id,
          leadName: f.leads?.nome || 'Lead s/ Nome',
          type: f.tipo,
          scheduledAt: f.data_agendada,
          note: f.nota || ''
        })),
        conversionByOrigin
      };

      return { data, error: null };
    } catch (e) {
      return { data: null, error: err(e) };
    }
  }
};

// ─── Catálogo de Procedimentos ──────────────────────────────

export interface ProcedimentoCatalogo {
  id: string;
  codigo: string | null;
  nome: string;
  categoria: string | null;
  valor_particular: number;
  valor_convenio: number;
  duracao_minutos: number;
  cor: string;
  requer_dente: boolean;
  requer_face: boolean;
  ativo: boolean;
  descricao: string | null;
  versao_atual?: number;
}

export interface ProcedimentoVersao {
  id: string;
  procedimento_id: string;
  versao: number;
  codigo: string | null;
  nome: string;
  categoria: string | null;
  valor_particular: number;
  valor_convenio: number;
  duracao_minutos: number;
  cor: string | null;
  requer_dente: boolean;
  requer_face: boolean;
  descricao: string | null;
  motivo: string | null;
  alterado_por: string | null;
  valido_desde: string;
  valido_ate: string | null;
  created_at: string;
}

export const procedimentosCatalogoApi = {
  list: async (): Promise<Result<ProcedimentoCatalogo[]>> => {
    const { data, error } = await supabase
      .from('procedimentos_catalogo')
      .select('*')
      .order('nome', { ascending: true });
    if (error) return { data: null, error: err(error) };
    return { 
      data: (data ?? []).map(r => ({
        ...r,
        valor_particular: Number(r.valor_particular ?? 0),
        valor_convenio: Number(r.valor_convenio ?? 0),
      })) as ProcedimentoCatalogo[], 
      error: null 
    };
  },

  create: async (body: Partial<ProcedimentoCatalogo>): Promise<Result<ProcedimentoCatalogo>> => {
    const tenant_id = await getTenantId();
    if (!tenant_id) return { data: null, error: 'Sem tenant ativo' };
    const { data, error } = await supabase
      .from('procedimentos_catalogo')
      .insert({ tenant_id, ...stripEmpty(body) } as any)
      .select('*')
      .single();
    if (error) return { data: null, error: err(error) };
    return { 
      data: {
        ...data,
        valor_particular: Number(data.valor_particular ?? 0),
        valor_convenio: Number(data.valor_convenio ?? 0),
      } as ProcedimentoCatalogo, 
      error: null 
    };
  },

  update: async (id: string, body: Partial<ProcedimentoCatalogo> & { motivo_versao?: string }): Promise<Result<ProcedimentoCatalogo>> => {
    const { data, error } = await supabase
      .from('procedimentos_catalogo')
      .update(stripEmpty(body) as any)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return { data: null, error: err(error) };
    return { 
      data: {
        ...data,
        valor_particular: Number(data.valor_particular ?? 0),
        valor_convenio: Number(data.valor_convenio ?? 0),
      } as ProcedimentoCatalogo, 
      error: null 
    };
  },

  delete: async (id: string): Promise<Result<{ success: boolean }>> => {
    const { error } = await supabase.from('procedimentos_catalogo').delete().eq('id', id);
    if (error) return { data: null, error: err(error) };
    return { data: { success: true }, error: null };
  },

  versoes: async (id: string): Promise<Result<ProcedimentoVersao[]>> => {
    const { data, error } = await supabase
      .from('procedimentos_versoes')
      .select('*')
      .eq('procedimento_id', id)
      .order('versao', { ascending: false });
    if (error) return { data: null, error: err(error) };
    return { 
      data: (data ?? []).map(r => ({
        ...r,
        valor_particular: Number(r.valor_particular ?? 0),
        valor_convenio: Number(r.valor_convenio ?? 0),
      })) as ProcedimentoVersao[], 
      error: null 
    };
  },

  versaoEm: async (id: string, dataIso: string): Promise<Result<ProcedimentoVersao | null>> => {
    const { data, error } = await supabase
      .from('procedimentos_versoes')
      .select('*')
      .eq('procedimento_id', id)
      .lte('valido_desde', dataIso)
      .or(`valido_ate.is.null,valido_ate.gte.${dataIso}`)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { data: null, error: err(error) };
    if (!data) return { data: null, error: null };
    return { 
      data: {
        ...data,
        valor_particular: Number(data.valor_particular ?? 0),
        valor_convenio: Number(data.valor_convenio ?? 0),
      } as ProcedimentoVersao, 
      error: null 
    };
  },
};

// ─── Dashboard ──────────────────────────────────────────────
export const sbDashboardApi = {
  getKpis: async (): Promise<Result<any>> => {
    try {
      const tenant_id = await getTenantId();
      if (!tenant_id) return { data: null, error: 'Sem tenant' };

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

      // Parallel queries for dashboard components
      const [
        pacientesCount,
        agendaHoje,
        movimentacoes,
        orcamentos,
        leads,
        estoque
      ] = await Promise.all([
        (supabase as any).from('pacientes').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant_id),
        (supabase as any).from('agendamentos').select('*').eq('tenant_id', tenant_id).eq('data', todayStr),
        (supabase as any).from('movimentacoes_financeiras').select('*').eq('tenant_id', tenant_id).gte('data', firstDayOfMonth),
        (supabase as any).from('orcamentos').select('*').eq('tenant_id', tenant_id),
        (supabase as any).from('leads').select('*').eq('tenant_id', tenant_id),
        (supabase as any).from('estoque').select('*').eq('tenant_id', tenant_id)
      ]);

      const totalPacientes = pacientesCount.count || 0;
      
      const agendaData = (agendaHoje.data || []) as any[];
      const dashboardAgenda = {
        total: agendaData.length,
        finalizados: agendaData.filter(a => a.status === 'concluido').length,
        emAtendimento: agendaData.filter(a => a.status === 'em_atendimento').length,
        aguardando: agendaData.filter(a => a.status === 'agendado').length,
        faltas: agendaData.filter(a => a.status === 'cancelado').length,
        encaixes: 0, // Not explicitly tracked in schema
        taxaPresenca: agendaData.length > 0 
          ? Math.round((agendaData.filter(a => a.status === 'concluido').length / agendaData.length) * 100)
          : 0
      };

      const movs = (movimentacoes.data || []) as any[];
      const receitaMensal = movs.filter(m => m.tipo === 'receita').reduce((acc, m) => acc + Number(m.valor || 0), 0);
      const despesaMensal = movs.filter(m => m.tipo === 'despesa').reduce((acc, m) => acc + Number(m.valor || 0), 0);

      const orcs = (orcamentos.data || []) as any[];
      const aprovados = orcs.filter(o => o.status === 'aprovado' || o.status === 'finalizado');
      const valorAprovado = aprovados.reduce((acc, o) => acc + Number(o.valor_total || 0), 0);
      
      const dashboardOrcamentos = {
        total: orcs.length,
        pendentes: orcs.filter(o => o.status === 'pendente').length,
        aprovados: aprovados.length,
        reprovados: orcs.filter(o => o.status === 'reprovado').length,
        valorAprovado,
        taxaConversao: orcs.length > 0 ? Math.round((aprovados.length / orcs.length) * 100) : 0,
        ticketMedio: aprovados.length > 0 ? valorAprovado / aprovados.length : 0
      };

      const ls = (leads.data || []) as any[];
      const dashboardCrm = {
        totalLeadsKanban: ls.length,
        semResposta: ls.filter(l => l.status === 'novo').length,
        ativos: ls.filter(l => l.status !== 'perdido' && l.status !== 'convertido').length,
        inativos: ls.filter(l => l.status === 'perdido').length,
        receitaTotal: ls.filter(l => l.status === 'convertido').reduce((acc, l) => acc + Number(l.valor_estimado || 0), 0)
      };

      const est = (estoque.data || []) as any[];
      const abaixoMinimo = est.filter(i => (i.quantidade || 0) <= (i.quantidade_minima || 0) && (i.quantidade || 0) > 0);
      const semEstoque = est.filter(i => (i.quantidade || 0) <= 0);
      
      const dashboardEstoque = {
        totalItens: est.length,
        abaixoMinimo: abaixoMinimo.length,
        itensAbaixoMinimo: abaixoMinimo.map(i => i.nome),
        semEstoque: semEstoque.length,
        itensSemEstoque: semEstoque.map(i => i.nome),
        valorTotalEstoque: est.reduce((acc, i) => acc + (Number(i.valor_unitario || 0) * (i.quantidade || 0)), 0)
      };


      // Group by origin for conversion chart
      const originsMap = new Map<string, { leads: number, convertidos: number }>();
      ls.forEach((l: any) => {
        const origin = l.origem || 'Outros';
        const stats = originsMap.get(origin) || { leads: 0, convertidos: 0 };
        stats.leads++;
        if (l.status === 'convertido') stats.convertidos++;
        originsMap.set(origin, stats);
      });

      const conversionByOrigin = Array.from(originsMap.entries()).map(([origin, stats]) => ({
        origin,
        leads: stats.leads,
        convertidos: stats.convertidos,
        rate: stats.leads > 0 ? (stats.convertidos / stats.leads) * 100 : 0
      }));

      const data = {
        totalPacientes,
        agendaHoje: dashboardAgenda.total,
        receitaMensal,
        despesaMensal,
        agenda: dashboardAgenda,
        orcamentos: dashboardOrcamentos,
        crm: dashboardCrm,
        pacientes: { totalCadastrados: totalPacientes },
        estoque: dashboardEstoque,
        conversionByOrigin
      };

      return { data, error: null };
    } catch (e) {
      return { data: null, error: err(e) };
    }
  }
};


