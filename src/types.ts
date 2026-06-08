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

export interface CustomerSummaryRow {
  customer: string;
  invoice_count: number;
  invoiced: number;
  receivable: number;
  received: number;
  outstanding: number;
  opportunity_cost: number;
  collection_rate: number;
}

export interface InvoiceRow {
  id: number;
  invoice_number: string | null;
  customer: string | null;
  project: string | null;
  project_type: string | null;
  invoice_type: string | null;
  invoicing_period: string | null;
  gross_invoice_amount: number;
  total_receivable: number;
  amount_received: number;
  balance_outstanding: number;
  status: string | null;
  aging_days: number | null;
  aging_bucket: string | null;
  opportunity_cost: number;
}

export interface InvoiceListResponse {
  items: InvoiceRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  snapshot?: { id: number; as_on_date: string | null };
}

export interface InvoiceFilterOptions {
  customers: string[];
  statuses: string[];
  project_types: string[];
}

// ─── Collections workbench ──────────────────────────────────────
export interface CollectionsSummary {
  total_outstanding: number;
  invoice_count: number;
  avg_days_overdue: number;
  total_opportunity_cost: number;
}

export interface CollectionsBucket {
  bucket: string;
  amount: number;
  count: number;
}

export interface CollectionsRow {
  id: number;
  invoice_number: string | null;
  customer: string | null;
  project: string | null;
  project_type: string | null;
  invoicing_period: string | null;
  total_receivable: number;
  amount_received: number;
  balance_outstanding: number;
  receipt_due_date: string | null;
  aging_days: number | null;
  aging_bucket: string | null;
  status: string | null;
  delay_reason: string | null;
  opportunity_cost: number;
}

export interface CollectionsResponse {
  snapshot: { id: number; as_on_date: string | null } | null;
  summary: CollectionsSummary;
  by_bucket: CollectionsBucket[];
  items: CollectionsRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
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
