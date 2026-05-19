// ─── Auth ───────────────────────────────────────────────────────
export type Role = 'admin' | 'finance' | 'support' | 'provider';

export interface User {
  id: number;
  email: string;
  full_name?: string | null;
  role: Role;
  name?: string;
  is_active?: boolean;
  tenant_id?: string | null;
}

export interface PaginationMeta {
  total: number;
  page: number;
  page_size: number;
}

export interface Upload {
  id: number;
  upload_id?: string;
  filename: string;
  status: string;
  file_type?: string;
  uploaded_at: string;
  tenant_id?: number;
  error_message?: string;
  rows?: {
    accepted?: number;
    rejected?: number;
    unassigned?: number;
  };
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
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

// ─── Appointments ───────────────────────────────────────────────
export type AppointmentStatus =
  | 'Checked Out'
  | 'No-show'
  | 'Cancelled'
  | 'Rescheduled'
  | 'Scheduled';

export interface Appointment {
  id: string;
  patient_name: string;
  patient_id: string;
  provider_name: string;
  appt_date: string;       // ISO date string
  start_time?: string;
  end_time?: string;
  status: AppointmentStatus;
  ticket_number?: string;
  tenant_id: string;
}

export interface AppointmentFilters {
  date_from?: string;
  date_to?: string;
  provider?: string;
  status?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

export interface AppointmentKPIs {
  total: number;
  checked_out: number;
  no_show: number;
  cancelled: number;
  rescheduled: number;
  scheduled: number;
  checkout_rate: number;
  noshow_rate: number;
}

// ─── Reconciliation ─────────────────────────────────────────────
export type ReconStatus =
  | 'noshow_fee_collected'
  | 'noshow_no_fee'
  | 'checkout_charge_era'
  | 'checkout_charge_no_era'
  | 'checkout_no_charge'
  | 'era_no_charge'
  | 'charge_no_appt'
  | 'no_match';

export interface ReconRow {
  id: number;
  patient_name: string;
  provider_name: string;
  service_date: string;
  recon_status: ReconStatus;
  billed_amount: number;
  paid_amount: number;
  balance: number;
  cpt_code?: string;
  tenant_id: number;
}

export interface ReconSummaryRow {
  status: ReconStatus;
  count: number;
  billed: number;
  paid: number;
  balance: number;
}

export interface ReconSummary {
  rows: ReconSummaryRow[];
  total_count: number;
  total_billed: number;
  total_paid: number;
  total_balance: number;
  collection_rate: number;
}

/** Matches GET /v1/reconciliation/aging bucket labels */
export interface ReconAgingBucketItem {
  bucket: string;
  count: number;
  billed: number;
  balance: number;
}

export interface ProviderSummary {
  provider_name: string;
  appointment_count: number;
  billed: number;
  paid: number;
  collection_rate: number;
}

// ─── Bank Transactions ──────────────────────────────────────────
export interface BankSummary {
  credits: number;
  debits: number;
  txn_count: number;
  bounds: {
    min_date: string | null;
    max_date: string | null;
  };
}

export interface InsurancePayerBreakdownItem {
  payer_name: string;
  era_processed_amount: number;
  cash_collected_mapped_amount: number;
  unmapped_gap_amount: number;
}

export interface InsuranceCashCollectedResponse {
  insurance_cash_collected: number;
  era_processed_amount: number;
  cash_collected_mapped_amount: number;
  unmapped_gap_amount: number;
  payer_breakdown: InsurancePayerBreakdownItem[];
}

// ─── Uploads ────────────────────────────────────────────────────
export type UploadStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type FileType = 'appointments' | 'charges' | 'era' | 'bank_statement';

export interface FileUpload {
  upload_id: string;
  filename: string;
  file_type: FileType;
  status: UploadStatus;
  uploaded_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  description?: string | null;
  rows?: {
    accepted?: number;
    rejected?: number;
    unassigned?: number;
  };
}

// ─── Providers ──────────────────────────────────────────────────
export interface Provider {
  id: string;
  name: string;
  tenant_id: string;
}

export interface ProviderTarget {
  provider_id: string;
  weekly_checkout_target: number;
  monthly_checkout_target: number;
}

// ─── Appointment summary / analytics ────────────────────────────
export interface AppointmentDailySeriesItem {
  appt_date: string; // ISO date string
  total: number;
  checked_out: number;
  no_show: number;
  cancelled: number;
  rescheduled: number;
  scheduled: number;
}

export interface AppointmentHeatmapItem {
  weekday: number; // 0=Mon..6=Sun
  hour: number; // 0-23
  count: number;
}

export interface AppointmentDateBounds {
  min_date?: string | null;
  max_date?: string | null;
}

export interface AppointmentSummary {
  kpis: AppointmentKPIs;
  bounds: AppointmentDateBounds;
  daily: AppointmentDailySeriesItem[];
  heatmap: AppointmentHeatmapItem[];
}

// ─── Reports / Charts ───────────────────────────────────────────
export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

export interface StatusBreakdown {
  status: string;
  count: number;
  billed: number;
  paid: number;
  pct: number;
}