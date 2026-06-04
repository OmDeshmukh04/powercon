// ─── Invoice Dashboard ──────────────────────────────────────────
export interface InvoiceSnapshot {
  id: number;
  as_on_date: string | null;
  label: string | null;
  is_latest: boolean;
  created_at?: string;
}

export interface InvoiceKpis {
  ytd_invoices_accrued: number;
  submitted_invoices: number;
  shortfall: number;
  amount_received: number;
  balance_outstanding: number;
  cost_of_delayed_payment: number;
}

export interface InvoiceDashboardData {
  snapshot: InvoiceSnapshot | null;
  kpis: InvoiceKpis;
  date_from: string | null;
  date_to: string | null;
  invoices_due_by_customer: Array<{ customer: string; balance: number }>;
  delay_reasons: Array<{ reason: string; amount: number }>;
  project_breakdown: Array<{
    project_type: string; po: number; invoiced: number; receivable: number; received: number;
  }>;
  monthly_invoicing: Array<{ month: string; invoiced: number; received: number }>;
  ar_aging: Array<{ bucket: string; amount: number }>;
  fy26_po_quarterly: Array<{ quarter: string; value: number }>;
  fy26_po_quarterly_stacked: Array<Record<string, number | string>>;
  planned_vs_actual: Array<{ month: string; planned: number; actual: number }>;
  opportunity_cost_monthly: Array<{ month: string; opportunity_cost: number }>;
  monthly_ar_days: Array<{ month: string; ar_days: number; submission_delay_days: number }>;
  project_pipeline: Array<{
    project_type: string; po_fy30: number; fy26_po: number;
    invoiced: number; payment_due: number; receipt: number;
  }>;
}

// ─── Auth ───────────────────────────────────────────────────────
export type Role = 'admin' | 'finance' | 'support';

export interface User {
  id: number;
  email: string;
  full_name?: string | null;
  role: Role;
  name?: string;
  is_active?: boolean;
  tenant_id?: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  token?: string;
  user?: User;
}

// ─── Pagination ─────────────────────────────────────────────────
export interface PaginationMeta {
  total: number;
  page: number;
  page_size: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

// ─── Uploads ────────────────────────────────────────────────────
export interface FileUpload {
  upload_id: number;
  filename: string;
  file_type: string;
  status: string;
  rows?: { accepted?: number; rejected?: number };
  error_message?: string | null;
  uploaded_at: string;
  tenant_id?: number;
}
