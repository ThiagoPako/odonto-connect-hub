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
