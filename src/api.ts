import axios, { type InternalAxiosRequestConfig } from 'axios';
import type {
  LoginRequest,
  LoginResponse,
  User,
  Appointment,
  AppointmentFilters,
  AppointmentKPIs,
  AppointmentSummary,
  AppointmentDailySeriesItem,
  AppointmentHeatmapItem,
  PaginatedResponse,
  ReconRow,
  ReconSummary,
  ProviderSummary,
  BankSummary,
  FileUpload,
  Provider,
  InsuranceCashCollectedResponse,
  ProviderTarget,
  ReconAgingBucketItem,
} from './types';

const TOKEN_KEY = 'token';
const TENANT_KEY = 'tenant_id';

// ─── Axios Instance ─────────────────────────────────────────────
type AppRequestConfig = InternalAxiosRequestConfig & { skipAuthRedirect?: boolean };

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  timeout: 30_000,
});

// Inject auth token on every request
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const typedConfig = config as AppRequestConfig;
  typedConfig.headers = typedConfig.headers ?? {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    typedConfig.headers.Authorization = `Bearer ${token}`;
  }
  const tenantId = localStorage.getItem(TENANT_KEY);
  if (tenantId) {
    typedConfig.headers['X-Tenant-Id'] = tenantId;
  }
  return typedConfig;
});

// Redirect to login on 401 unless the request opts out.
// Debounced so concurrent in-flight requests that already sent the token
// (e.g., upload POST + getUploads GET racing) don't each independently
// clear the token before the other can complete.
let _logoutTimer: ReturnType<typeof setTimeout> | null = null;

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const config = err.config as AppRequestConfig | undefined;
    if (err.response?.status === 401 && !config?.skipAuthRedirect) {
      // Debounce: only act on the FIRST 401 in a 500 ms window.
      if (!_logoutTimer) {
        _logoutTimer = setTimeout(() => {
          _logoutTimer = null;
          localStorage.removeItem(TOKEN_KEY);
          window.location.href = '/login';
        }, 500);
      }
    }
    return Promise.reject(err);
  }
);

export type { AppRequestConfig };
export default api;

export type AppointmentStatusKey = 'checked_out' | 'no_show' | 'cancelled' | 'rescheduled' | 'scheduled';

/** Aligns with reconciliation SQL (ILIKE %checkout%) and backend appointment summary — substring match, one bucket per row. */
export function normalizeAppointmentStatus(status?: string): AppointmentStatusKey {
  const raw = (status ?? '').trim().toLowerCase();
  if (!raw) return 'scheduled';
  if (/\bnot\b\s+check/.test(raw) || raw.includes('unchecked')) return 'scheduled';
  if (raw.includes('cancel')) return 'cancelled';
  if (raw.includes('reschedule')) return 'rescheduled';
  if (raw.includes('no-show') || raw.includes('no show') || raw.includes('noshow')) return 'no_show';
  if (
    raw.includes('check-out') ||
    raw.includes('checkout') ||
    raw.includes('checked out') ||
    raw.includes('checked_out')
  ) {
    return 'checked_out';
  }
  if (raw === 'pending' || raw === 'scheduled' || raw.includes('scheduled')) return 'scheduled';
  return 'scheduled';
}

function toIsoDay(dateLike?: string): string {
  if (!dateLike) return '';
  const iso = new Date(dateLike).toISOString();
  return iso.slice(0, 10);
}

const MAX_APPOINTMENTS_PAGE_SIZE = 200;

async function buildAppointmentSummaryFromList(
  filters: Pick<AppointmentFilters, 'date_from' | 'date_to' | 'provider'> = {}
): Promise<AppointmentSummary> {
  const params: Record<string, string | number> = {
    page: 1,
    page_size: MAX_APPOINTMENTS_PAGE_SIZE,
  };
  if (filters.date_from) params.start_date = filters.date_from;
  if (filters.date_to) params.end_date = filters.date_to;
  if (filters.provider) params.provider_id = filters.provider;

  const all: Appointment[] = [];
  let currentPage = 1;
  let pages = 1;

  do {
    params.page = currentPage;
    const res = await api.get('/v1/appointments', { params });
    const paged = coercePaginated<Appointment>(res.data, 'appointments');
    all.push(...paged.items);
    pages = Math.max(1, paged.pages || 1);
    currentPage += 1;
  } while (currentPage <= pages && currentPage <= 50);

  const byDay = new Map<string, AppointmentDailySeriesItem>();
  const heatBySlot = new Map<string, AppointmentHeatmapItem>();
  const uniqueDates = all.map((a) => toIsoDay(a.appt_date)).filter(Boolean).sort();
  const minDate = uniqueDates[0] ?? null;
  const maxDate = uniqueDates[uniqueDates.length - 1] ?? null;

  let checkedOut = 0;
  let noShow = 0;
  let cancelled = 0;
  let rescheduled = 0;
  let scheduled = 0;

  for (const appt of all) {
    const day = toIsoDay(appt.appt_date);
    const key = normalizeAppointmentStatus(appt.status);

    if (!byDay.has(day)) {
      byDay.set(day, {
        appt_date: day,
        total: 0,
        checked_out: 0,
        no_show: 0,
        cancelled: 0,
        rescheduled: 0,
        scheduled: 0,
      });
    }

    const row = byDay.get(day)!;
    row.total += 1;
    row[key] += 1;

    if (key === 'checked_out') checkedOut += 1;
    else if (key === 'no_show') noShow += 1;
    else if (key === 'cancelled') cancelled += 1;
    else if (key === 'rescheduled') rescheduled += 1;
    else scheduled += 1;

    const dt = new Date(appt.appt_date);
    const weekday = (dt.getDay() + 6) % 7;
    const hour = Number((appt.start_time ?? '00:00').split(':')[0]) || 0;
    const heatKey = `${weekday}-${hour}`;
    const currentHeat = heatBySlot.get(heatKey) ?? { weekday, hour, count: 0 };
    currentHeat.count += 1;
    heatBySlot.set(heatKey, currentHeat);
  }

  const total = all.length;
  const kpis: AppointmentKPIs = {
    total,
    checked_out: checkedOut,
    no_show: noShow,
    cancelled,
    rescheduled,
    scheduled,
    checkout_rate: total > 0 ? (checkedOut / total) * 100 : 0,
    noshow_rate: total > 0 ? (noShow / total) * 100 : 0,
  };

  return {
    kpis,
    bounds: { min_date: minDate, max_date: maxDate },
    daily: Array.from(byDay.values()).sort((a, b) => a.appt_date.localeCompare(b.appt_date)),
    heatmap: Array.from(heatBySlot.values()),
  };
}

function coercePaginated<T>(
  payload: any,
  listKey: string
): PaginatedResponse<T> {
  const items = payload?.items ?? payload?.[listKey] ?? [];
  const meta = payload?.meta ?? {};
  const total = Number(payload?.total ?? meta?.total ?? items.length ?? 0);
  const page = Number(payload?.page ?? meta?.page ?? 1);
  const page_size = Number(payload?.page_size ?? meta?.page_size ?? items.length ?? 0);
  const pages = Number(payload?.pages ?? (page_size > 0 ? Math.ceil(total / page_size) : 1));

  return { items, total, page, page_size, pages };
}

// ─── Auth ───────────────────────────────────────────────────────
export async function login(data: LoginRequest): Promise<LoginResponse> {
  const res = await api.post('/v1/auth/login', data);
  const payload = res.data?.data ?? res.data ?? {};

  // Backend currently returns { token, user_id, email, role, provider_id }.
  // Normalize to frontend LoginResponse shape.
  const token = payload.access_token ?? payload.token;

  return {
    access_token: token ?? '',
    token_type: payload.token_type ?? 'bearer',
    user: payload.user,
  };
}

export async function getMe(): Promise<User> {
  const res = await api.get<User>('/v1/auth/me');
  return res.data;
}

export async function getUsers(): Promise<User[]> {
  const res = await api.get<{ users: User[] }>('/v1/auth/users');
  return res.data.users ?? [];
}

export async function deleteUser(id: number): Promise<void> {
  await api.delete(`/v1/auth/users/${id}`);
}

export async function registerUser(
  role: 'admin' | 'finance' | 'support' | 'provider',
  data: { email: string; password: string; name?: string }
): Promise<User> {
  const res = await api.post<User>(`/v1/auth/register/${role}`, data);
  return res.data;
}

// ─── Appointments ───────────────────────────────────────────────
export async function getAppointments(
  filters: AppointmentFilters = {}
): Promise<PaginatedResponse<Appointment>> {
  const params: Record<string, string | number> = {};
  if (filters.date_from)  params.start_date = filters.date_from;
  if (filters.date_to)    params.end_date   = filters.date_to;
  if (filters.provider)   params.provider_id = filters.provider;
  if (filters.status)     params.status     = filters.status;
  if (filters.search)     params.patient_id = filters.search;
  if (filters.page)       params.page       = filters.page;
  if (filters.page_size)  params.page_size  = Math.min(filters.page_size, MAX_APPOINTMENTS_PAGE_SIZE);

  const res = await api.get('/v1/appointments', { params });
  return coercePaginated<Appointment>(res.data, 'appointments');
}

/** Fetches every page (API caps page_size at 200) for charts and aggregations. */
export async function fetchAppointmentsAllPages(
  filters: Pick<AppointmentFilters, 'date_from' | 'date_to' | 'provider' | 'status'> = {}
): Promise<Appointment[]> {
  const all: Appointment[] = [];
  let page = 1;
  let pages = 1;
  const page_size = MAX_APPOINTMENTS_PAGE_SIZE;
  do {
    const paged = await getAppointments({ ...filters, page, page_size });
    all.push(...paged.items);
    pages = Math.max(1, paged.pages || 1);
    page += 1;
  } while (page <= pages && page <= 100);
  return all;
}

export async function getAppointmentKPIs(
  filters: Pick<AppointmentFilters, 'date_from' | 'date_to' | 'provider'> = {}
): Promise<AppointmentKPIs> {
  const summary = await getAppointmentSummary(filters);
  return summary.kpis;
}

export async function getAppointmentSummary(
  filters: Pick<AppointmentFilters, 'date_from' | 'date_to' | 'provider'> = {}
): Promise<AppointmentSummary> {
  const params: Record<string, string> = {};
  if (filters.date_from) params.start_date = filters.date_from;
  if (filters.date_to) params.end_date = filters.date_to;
  if (filters.provider) params.provider_id = filters.provider;

  try {
    const res = await api.get('/v1/appointments/summary', { params });
    return res.data as AppointmentSummary;
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return buildAppointmentSummaryFromList(filters);
    }
    throw err;
  }
}

// ─── Providers ──────────────────────────────────────────────────
export async function getProviders(): Promise<Provider[]> {
  const res = await api.get<{ providers: Provider[] }>('/v1/providers');
  return res.data.providers ?? [];
}

export async function getProviderTargets(): Promise<ProviderTarget[]> {
  const res = await api.get<{ targets: ProviderTarget[] }>('/v1/providers/targets');
  return res.data.targets ?? [];
}

export async function upsertProviderTargets(targets: ProviderTarget[]): Promise<ProviderTarget[]> {
  const res = await api.put<{ targets: ProviderTarget[] }>('/v1/providers/targets', { targets });
  return res.data.targets ?? [];
}

// ─── Reconciliation ─────────────────────────────────────────────
export async function runReconciliation(): Promise<{ message: string }> {
  const res = await api.post<{ rows_processed: number; duration_ms: number }>('/v1/reconciliation/run');
  return { message: `Reconciliation complete: ${res.data.rows_processed} rows processed` };
}

export async function getReconAging(params: {
  start_date?: string;
  end_date?: string;
  period?: string;
} = {}): Promise<ReconAgingBucketItem[]> {
  const query: Record<string, string> = {};
  if (params.start_date) query.start_date = params.start_date;
  if (params.end_date) query.end_date = params.end_date;
  if (params.period) query.period = params.period;

  const res = await api.get<ReconAgingBucketItem[]>('/v1/reconciliation/aging', { params: query });
  return Array.isArray(res.data) ? res.data : [];
}

export async function getReconSummary(
  params: { start_date?: string; end_date?: string } = {}
): Promise<ReconSummary> {
  const query: Record<string, string> = {};
  if (params.start_date) query.start_date = params.start_date;
  if (params.end_date) query.end_date = params.end_date;

  const res = await api.get('/v1/reconciliation/summary', { params: query });
  const summaryRows = res.data?.summary ?? [];
  const totals = res.data?.totals ?? {};

  return {
    rows: summaryRows.map((r: any) => ({
      status: r.status,
      count: Number(r.count ?? 0),
      billed: Number(r.billed ?? 0),
      paid: Number(r.paid ?? 0),
      balance: Number(r.balance ?? 0),
    })),
    total_count: Number(totals.count ?? 0),
    total_billed: Number(totals.billed ?? 0),
    total_paid: Number(totals.paid ?? 0),
    total_balance: Number(totals.balance ?? 0),
    collection_rate: Number(totals.billed ?? 0) > 0 ? (Number(totals.paid ?? 0) / Number(totals.billed ?? 0)) * 100 : 0,
  };
}

export async function getReconRows(
  params: {
    status?: string;
    provider_id?: number;
    start_date?: string;
    end_date?: string;
    page?: number;
    page_size?: number;
  } = {}
): Promise<PaginatedResponse<ReconRow>> {
  const res = await api.get('/v1/reconciliation/results', { params });
  const paged = coercePaginated<any>(res.data, 'results');

  return {
    ...paged,
    items: paged.items.map((row) => {
      const billedAmount = Number(row.billed ?? row.billed_amount ?? 0);
      const paidAmount = Number(row.paid ?? row.paid_amount ?? 0);
      const adjustmentAmount = Number(row.adjustment ?? row.adj_amount ?? 0);
      const balance = row.balance != null ? Number(row.balance) : billedAmount - paidAmount - adjustmentAmount;

      return {
        id: row.id,
        patient_name: row.patient_name ?? '',
        provider_name: row.provider_name ?? '',
        service_date: row.service_date ?? '',
        recon_status: row.status ?? row.recon_status ?? 'no_match',
        billed_amount: billedAmount,
        paid_amount: paidAmount,
        balance,
        cpt_code: row.cpt_code,
        tenant_id: Number(row.tenant_id ?? 0),
      } as ReconRow;
    }),
  };
}

export async function getProviderSummary(params: {
  start_date?: string;
  end_date?: string;
} = {}): Promise<ProviderSummary[]> {
  const query: Record<string, string> = {};
  if (params.start_date) query.start_date = params.start_date;
  if (params.end_date) query.end_date = params.end_date;

  const res = await api.get<any[]>('/v1/reconciliation/provider-summary', { params: query });
  const grouped = new Map<string, ProviderSummary>();

  for (const row of res.data ?? []) {
    const key = row.provider_name ?? 'Unknown';
    const current = grouped.get(key) ?? {
      provider_name: key,
      appointment_count: 0,
      billed: 0,
      paid: 0,
      collection_rate: 0,
    };
    current.appointment_count += Number(row.count ?? 0);
    current.billed += Number(row.billed ?? 0);
    current.paid += Number(row.paid ?? 0);
    current.collection_rate = current.billed > 0 ? (current.paid / current.billed) * 100 : 0;
    grouped.set(key, current);
  }

  return Array.from(grouped.values());
}

export async function exportExceptionReport(params: {
  status: 'checkout_no_charge' | 'checkout_charge_no_era';
  start_date?: string;
  end_date?: string;
  provider_id?: number;
}): Promise<void> {
  const res = await api.get('/v1/reconciliation/exceptions/export', {
    params,
    responseType: 'blob',
  });

  const blob = new Blob(
    [res.data],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${params.status}_${today}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// ─── Uploads ────────────────────────────────────────────────────
export async function getUploads(): Promise<FileUpload[]> {
  // skipAuthRedirect: a 401 here (e.g. token expired mid-upload) should show
  // an inline error, not force a full page redirect that interrupts the flow.
  const res = await api.get('/v1/uploads', { skipAuthRedirect: true } as AppRequestConfig);
  return (res.data?.uploads ?? []) as FileUpload[];
}

export async function uploadFile(fileOrForm: File | FormData): Promise<FileUpload> {
  const res = await api.post('/v1/uploads', fileOrForm, {
    headers: { 'Content-Type': 'multipart/form-data' },
    skipAuthRedirect: true,
  } as AppRequestConfig);
  return res.data as FileUpload;
}

export const createUpload = uploadFile;

export async function deleteUpload(id: number): Promise<void> {
  await api.delete(`/v1/uploads/${id}`);
}

export async function getBankSummary(params: {
  start_date?: string;
  end_date?: string;
} = {}): Promise<BankSummary> {
  const query: Record<string, string> = {};
  if (params.start_date) query.start_date = params.start_date;
  if (params.end_date) query.end_date = params.end_date;

  const res = await api.get('/v1/bank-transactions/summary', { params: query });
  return {
    credits: Number(res.data.credits ?? 0),
    debits: Number(res.data.debits ?? 0),
    txn_count: Number(res.data.txn_count ?? 0),
    bounds: {
      min_date: res.data.bounds?.min_date ?? null,
      max_date: res.data.bounds?.max_date ?? null,
    },
  };
}

export async function getInsuranceCashCollected(params: {
  start_date?: string;
  end_date?: string;
} = {}): Promise<InsuranceCashCollectedResponse> {
  const query: Record<string, string> = {};
  if (params.start_date) query.start_date = params.start_date;
  if (params.end_date) query.end_date = params.end_date;

  const res = await api.get('/v1/bank-transactions/insurance-cash-collected', { params: query });
  return {
    insurance_cash_collected: Number(res.data.insurance_cash_collected ?? 0),
    era_processed_amount: Number(res.data.era_processed_amount ?? 0),
    cash_collected_mapped_amount: Number(res.data.cash_collected_mapped_amount ?? 0),
    unmapped_gap_amount: Number(res.data.unmapped_gap_amount ?? 0),
    payer_breakdown: Array.isArray(res.data.payer_breakdown)
      ? res.data.payer_breakdown.map((row: any) => ({
          payer_name: String(row.payer_name ?? 'Unknown'),
          era_processed_amount: Number(row.era_processed_amount ?? 0),
          cash_collected_mapped_amount: Number(row.cash_collected_mapped_amount ?? 0),
          unmapped_gap_amount: Number(row.unmapped_gap_amount ?? 0),
        }))
      : [],
  };
}

// ─── Charges ────────────────────────────────────────────────────
const MAX_CHARGES_PAGE_SIZE = 200;

export async function getCharges(
  filters: {
    date_from?: string;
    date_to?: string;
    cpt_code?: string;
    provider_id?: string;
    page?: number;
    page_size?: number;
  } = {}
): Promise<PaginatedResponse<any>> {
  const page_size = Math.min(filters.page_size ?? MAX_CHARGES_PAGE_SIZE, MAX_CHARGES_PAGE_SIZE);
  const params: Record<string, string | number> = { page: filters.page ?? 1, page_size };
  if (filters.date_from) params.start_date = filters.date_from;
  if (filters.date_to) params.end_date = filters.date_to;
  if (filters.cpt_code) params.cpt_code = filters.cpt_code;
  if (filters.provider_id) params.provider_id = filters.provider_id;

  const res = await api.get('/v1/charges', { params });
  return coercePaginated<any>(res.data, 'charges');
}

export async function fetchChargesAllPages(
  filters: { date_from?: string; date_to?: string; cpt_code?: string; provider_id?: string } = {}
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  let pages = 1;
  do {
    const paged = await getCharges({ ...filters, page, page_size: MAX_CHARGES_PAGE_SIZE });
    all.push(...paged.items);
    pages = Math.max(1, paged.pages || 1);
    page += 1;
  } while (page <= pages && page <= 100);
  return all;
}