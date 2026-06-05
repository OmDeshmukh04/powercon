import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { LoginRequest, LoginResponse, User, FileUpload, PaginatedResponse } from './types';
import type {
  InvoiceDashboardData, InvoiceSnapshot,
  CustomerSummaryRow, InvoiceListResponse, InvoiceFilterOptions,
} from './types';

const TOKEN_KEY  = 'token';
const TENANT_KEY = 'tenant_id';

type AppRequestConfig = InternalAxiosRequestConfig & { skipAuthRedirect?: boolean };

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  timeout: 30_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const c = config as AppRequestConfig;
  c.headers = c.headers ?? {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) c.headers.Authorization = `Bearer ${token}`;
  const tenantId = localStorage.getItem(TENANT_KEY);
  if (tenantId) c.headers['X-Tenant-Id'] = tenantId;
  return c;
});

let _logoutTimer: ReturnType<typeof setTimeout> | null = null;
api.interceptors.response.use(
  res => res,
  err => {
    const config = err.config as AppRequestConfig | undefined;
    if (err.response?.status === 401 && !config?.skipAuthRedirect) {
      if (!_logoutTimer) {
        _logoutTimer = setTimeout(() => {
          _logoutTimer = null;
          localStorage.removeItem(TOKEN_KEY);
          window.location.href = '/login';
        }, 500);
      }
    }
    return Promise.reject(err);
  },
);

export type { AppRequestConfig };
export default api;

// ─── Auth ────────────────────────────────────────────────────────
export async function login(data: LoginRequest): Promise<LoginResponse> {
  const res = await api.post('/v1/auth/login', data);
  const payload = res.data?.data ?? res.data ?? {};
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
  role: 'admin' | 'finance' | 'support',
  data: { email: string; password: string; name?: string },
): Promise<User> {
  const res = await api.post<User>(`/v1/auth/register/${role}`, data);
  return res.data;
}

// ─── Uploads ─────────────────────────────────────────────────────
export async function getUploads(): Promise<FileUpload[]> {
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

// ─── Invoice Dashboard ───────────────────────────────────────────
export async function getInvoiceDashboard(opts?: {
  snapshotId?: number;
  dateFrom?: string;
  dateTo?: string;
}): Promise<InvoiceDashboardData> {
  const params: Record<string, string | number> = {};
  if (opts?.snapshotId) params.snapshot_id = opts.snapshotId;
  if (opts?.dateFrom)   params.date_from   = opts.dateFrom;
  if (opts?.dateTo)     params.date_to     = opts.dateTo;
  const res = await api.get('/v1/invoice-dashboard/summary', { params });
  return res.data as InvoiceDashboardData;
}

export async function getInvoiceSnapshots(): Promise<InvoiceSnapshot[]> {
  const res = await api.get('/v1/invoice-dashboard/snapshots');
  return (res.data?.snapshots ?? []) as InvoiceSnapshot[];
}

export async function getCustomerSummary(snapshotId?: number): Promise<CustomerSummaryRow[]> {
  const params: Record<string, number> = {};
  if (snapshotId) params.snapshot_id = snapshotId;
  const res = await api.get('/v1/invoice-dashboard/customers', { params });
  return (res.data?.customers ?? []) as CustomerSummaryRow[];
}

export async function getInvoiceList(opts: {
  customer?: string; status?: string; projectType?: string;
  search?: string; page?: number; pageSize?: number;
} = {}): Promise<InvoiceListResponse> {
  const params: Record<string, string | number> = {
    page: opts.page ?? 1, page_size: opts.pageSize ?? 50,
  };
  if (opts.customer)    params.customer = opts.customer;
  if (opts.status)      params.status = opts.status;
  if (opts.projectType) params.project_type = opts.projectType;
  if (opts.search)      params.search = opts.search;
  const res = await api.get('/v1/invoice-dashboard/invoices', { params });
  return res.data as InvoiceListResponse;
}

export async function getInvoiceFilterOptions(): Promise<InvoiceFilterOptions> {
  const res = await api.get('/v1/invoice-dashboard/invoice-filters');
  return res.data as InvoiceFilterOptions;
}

// ─── Pagination helper (kept for Upload page) ────────────────────
export function coercePaginated<T>(payload: unknown, listKey: string): PaginatedResponse<T> {
  const p = payload as Record<string, unknown>;
  const items = (p?.items ?? (p as Record<string, unknown>)?.[listKey] ?? []) as T[];
  const meta  = (p?.meta ?? {}) as Record<string, unknown>;
  const total     = Number(p?.total     ?? (meta as Record<string,unknown>)?.total     ?? items.length ?? 0);
  const page      = Number(p?.page      ?? (meta as Record<string,unknown>)?.page      ?? 1);
  const page_size = Number(p?.page_size ?? (meta as Record<string,unknown>)?.page_size ?? items.length ?? 0);
  const pages     = Number(p?.pages     ?? (page_size > 0 ? Math.ceil(total / page_size) : 1));
  return { items, total, page, page_size, pages };
}
