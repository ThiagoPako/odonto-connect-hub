/**
 * VPS Database Client — Supabase SDK-compatible interface
 * 
 * Redireciona todas as operações para a API Express na VPS.
 * Uso: import { supabase } from '@/lib/vpsDb';
 */

const VPS_API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://odontoconnect.tech/api';
const TOKEN_KEY = 'app_jwt';
const USER_KEY = 'app_user';

// ==================== AUTH STATE ====================

type AuthUser = {
  id: string;
  email: string;
  name?: string;
  role?: string;
};

type AuthSession = {
  access_token: string;
  user: AuthUser;
};

type AuthChangeEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
type AuthChangeCallback = (event: AuthChangeEvent, session: AuthSession | null) => void;

const authListeners = new Set<AuthChangeCallback>();

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  const session: AuthSession = { access_token: token, user };
  authListeners.forEach((cb) => cb('SIGNED_IN', session));
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  authListeners.forEach((cb) => cb('SIGNED_OUT', null));
}

// ==================== FETCH HELPER ====================

async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: { message: string } | null }> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${VPS_API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      clearAuth();
      return { data: null, error: { message: 'Sessão expirada' } };
    }

    const json = await res.json();

    if (!res.ok) {
      return { data: null, error: { message: json.error || `HTTP ${res.status}` } };
    }

    // API pode retornar { data, error } ou o objeto direto
    if ('data' in json && 'error' in json) {
      return json;
    }
    return { data: json as T, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro de rede';
    return { data: null, error: { message } };
  }
}

// ==================== FILTER / QUERY BUILDER ====================

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in' | 'contains' | 'not' | 'or';

interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}

interface QueryConfig {
  table: string;
  operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  selectColumns?: string;
  filters: Filter[];
  data?: Record<string, unknown> | Record<string, unknown>[];
  orderBy?: { column: string; ascending: boolean }[];
  limitCount?: number;
  singleRow?: boolean;
  maybeSingleRow?: boolean;
  onConflict?: string;
  countOption?: 'exact' | 'planned' | 'estimated';
}

class QueryBuilder<T = unknown> implements PromiseLike<{ data: T | T[] | null; error: { message: string } | null; count?: number }> {
  private config: QueryConfig;

  constructor(config: QueryConfig) {
    this.config = config;
  }

  // ---- Filters ----
  eq(column: string, value: unknown) { this.config.filters.push({ column, op: 'eq', value }); return this; }
  neq(column: string, value: unknown) { this.config.filters.push({ column, op: 'neq', value }); return this; }
  gt(column: string, value: unknown) { this.config.filters.push({ column, op: 'gt', value }); return this; }
  gte(column: string, value: unknown) { this.config.filters.push({ column, op: 'gte', value }); return this; }
  lt(column: string, value: unknown) { this.config.filters.push({ column, op: 'lt', value }); return this; }
  lte(column: string, value: unknown) { this.config.filters.push({ column, op: 'lte', value }); return this; }
  like(column: string, value: string) { this.config.filters.push({ column, op: 'like', value }); return this; }
  ilike(column: string, value: string) { this.config.filters.push({ column, op: 'ilike', value }); return this; }
  is(column: string, value: unknown) { this.config.filters.push({ column, op: 'is', value }); return this; }
  in(column: string, values: unknown[]) { this.config.filters.push({ column, op: 'in', value: values }); return this; }
  contains(column: string, value: unknown) { this.config.filters.push({ column, op: 'contains', value }); return this; }
  not(column: string, op: FilterOp, value: unknown) { this.config.filters.push({ column, op: 'not', value: { op, value } }); return this; }
  or(conditions: string) { this.config.filters.push({ column: '_or', op: 'or', value: conditions }); return this; }

  // ---- Modifiers ----
  order(column: string, opts?: { ascending?: boolean }) {
    if (!this.config.orderBy) this.config.orderBy = [];
    this.config.orderBy.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(count: number) { this.config.limitCount = count; return this; }
  single() { this.config.singleRow = true; return this; }
  maybeSingle() { this.config.maybeSingleRow = true; return this; }

  // ---- Thenable ----
  then<TResult1 = { data: T | T[] | null; error: { message: string } | null; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: T | T[] | null; error: { message: string } | null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: T | T[] | null; error: { message: string } | null; count?: number }> {
    const { table, operation, selectColumns, filters, data, orderBy, limitCount, singleRow, maybeSingleRow, onConflict, countOption } = this.config;

    const body: Record<string, unknown> = {
      table,
      operation,
      filters,
    };

    if (selectColumns) body.select = selectColumns;
    if (data) body.data = data;
    if (orderBy) body.order = orderBy;
    if (limitCount) body.limit = limitCount;
    if (singleRow || maybeSingleRow) body.single = true;
    if (onConflict) body.onConflict = onConflict;
    if (countOption) body.count = countOption;

    const result = await apiFetch<T | T[]>('/db/query', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (maybeSingleRow && result.error?.message?.includes('no rows')) {
      return { data: null, error: null };
    }

    return result as { data: T | T[] | null; error: { message: string } | null; count?: number };
  }
}

// ==================== TABLE BUILDER ====================

class TableBuilder<T = unknown> {
  private table: string;

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string) {
    return new QueryBuilder<T>({
      table: this.table,
      operation: 'select',
      selectColumns: columns || '*',
      filters: [],
    });
  }

  insert(data: Partial<T> | Partial<T>[]) {
    return new QueryBuilder<T>({
      table: this.table,
      operation: 'insert',
      data: data as Record<string, unknown> | Record<string, unknown>[],
      filters: [],
    });
  }

  update(data: Partial<T>) {
    return new QueryBuilder<T>({
      table: this.table,
      operation: 'update',
      data: data as Record<string, unknown>,
      filters: [],
    });
  }

  delete() {
    return new QueryBuilder<T>({
      table: this.table,
      operation: 'delete',
      filters: [],
    });
  }

  upsert(data: Partial<T> | Partial<T>[], opts?: { onConflict?: string }) {
    return new QueryBuilder<T>({
      table: this.table,
      operation: 'upsert',
      data: data as Record<string, unknown> | Record<string, unknown>[],
      filters: [],
      onConflict: opts?.onConflict,
    });
  }
}

// ==================== MAIN CLIENT ====================

export const supabase = {
  from<T = unknown>(table: string) {
    return new TableBuilder<T>(table);
  },

  auth: {
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const result = await apiFetch<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (result.data?.token) {
        setAuth(result.data.token, result.data.user);
        return {
          data: {
            session: { access_token: result.data.token, user: result.data.user },
            user: result.data.user,
          },
          error: null,
        };
      }

      return { data: { session: null, user: null }, error: result.error };
    },

    async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, unknown> } }) {
      const result = await apiFetch<{ token: string; user: AuthUser }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, ...options?.data }),
      });

      if (result.data?.token) {
        setAuth(result.data.token, result.data.user);
        return {
          data: {
            session: { access_token: result.data.token, user: result.data.user },
            user: result.data.user,
          },
          error: null,
        };
      }

      return { data: { session: null, user: null }, error: result.error };
    },

    async signOut() {
      clearAuth();
      return { error: null };
    },

    async getUser() {
      const token = getStoredToken();
      if (!token) return { data: { user: null }, error: null };

      const result = await apiFetch<AuthUser>('/auth/me');
      if (result.data) {
        return { data: { user: result.data }, error: null };
      }
      return { data: { user: null }, error: result.error };
    },

    async getSession() {
      const token = getStoredToken();
      const user = getStoredUser();
      if (!token || !user) return { data: { session: null }, error: null };
      return {
        data: { session: { access_token: token, user } },
        error: null,
      };
    },

    onAuthStateChange(callback: AuthChangeCallback) {
      authListeners.add(callback);
      // Emitir estado inicial
      const token = getStoredToken();
      const user = getStoredUser();
      if (token && user) {
        callback('SIGNED_IN', { access_token: token, user });
      }
      return {
        data: {
          subscription: {
            unsubscribe: () => authListeners.delete(callback),
          },
        },
      };
    },
  },

  async rpc(functionName: string, args?: Record<string, unknown>) {
    return apiFetch(`/rpc/${functionName}`, {
      method: 'POST',
      body: JSON.stringify(args || {}),
    });
  },

  functions: {
    async invoke(name: string, options?: { body?: unknown }) {
      return apiFetch(`/functions/${name}`, {
        method: 'POST',
        body: JSON.stringify(options?.body || {}),
      });
    },
  },

  storage: {
    from(bucket: string) {
      return {
        async upload(path: string, file: File) {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('bucket', bucket);
          formData.append('path', path);

          const token = getStoredToken();
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;

          try {
            const res = await fetch(`${VPS_API_BASE}/upload`, {
              method: 'POST',
              headers,
              body: formData,
            });
            const json = await res.json();
            return { data: json.data || { path: json.path }, error: null };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Upload failed';
            return { data: null, error: { message } };
          }
        },

        getPublicUrl(path: string) {
          const baseUrl = VPS_API_BASE.replace('/api', '');
          return { data: { publicUrl: `${baseUrl}/uploads/${bucket}/${path}` } };
        },

        async remove(paths: string[]) {
          return apiFetch('/storage/remove', {
            method: 'POST',
            body: JSON.stringify({ bucket, paths }),
          });
        },

        async list(folder?: string) {
          return apiFetch(`/storage/list?bucket=${bucket}&folder=${folder || ''}`);
        },
      };
    },
  },
};

export default supabase;
