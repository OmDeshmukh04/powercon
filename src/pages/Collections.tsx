import { useEffect, useState } from 'react';
import { getCollections, getInvoiceFilterOptions } from '../api';
import type { CollectionsRow, CollectionsSummary, CollectionsBucket, InvoiceFilterOptions } from '../types';

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (n: number) => `₹${INR.format(Math.round(n))}`;
const fmtCr = (n: number) => `₹${(n / 1e7).toFixed(2)} Cr`;

const BUCKET_COLOR: Record<string, string> = {
  '0-15': 'bg-green',
  '15-30': 'bg-amber',
  '30-45': 'bg-amber',
  '45-60': 'bg-red',
  '60+': 'bg-red',
  'Retention': 'bg-gray',
  'Not received': 'bg-gray',
};

export default function Collections() {
  const [rows, setRows]       = useState<CollectionsRow[]>([]);
  const [summary, setSummary] = useState<CollectionsSummary | null>(null);
  const [buckets, setBuckets] = useState<CollectionsBucket[]>([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(1);
  const [page, setPage]       = useState(1);
  const [loading, setLoad]    = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [opts, setOpts]       = useState<InvoiceFilterOptions>({ customers: [], statuses: [], project_types: [] });

  const [bucket, setBucket]     = useState('');
  const [customer, setCustomer] = useState('');
  const [search, setSearch]     = useState('');

  useEffect(() => { getInvoiceFilterOptions().then(setOpts).catch(() => {}); }, []);

  useEffect(() => {
    setLoad(true);
    setError(null);
    getCollections({ bucket, customer, search, page, pageSize: 50 })
      .then(r => {
        setRows(r.items); setSummary(r.summary); setBuckets(r.by_bucket);
        setTotal(r.total); setPages(r.pages);
      })
      .catch(() => {
        setRows([]); setSummary(null); setBuckets([]); setTotal(0); setPages(1);
        setError('Failed to load collections data');
      })
      .finally(() => setLoad(false));
  }, [bucket, customer, search, page]);

  // reset to page 1 whenever a filter changes
  useEffect(() => { setPage(1); }, [bucket, customer, search]);

  return (
    <div className="page-enter">
      <div className="ph-row" style={{ marginBottom: 16 }}>
        <div className="ph"><h1>Collections</h1><p>Outstanding receivables — chase list sorted by days overdue</p></div>
        <span className="active-range-pill">{total} outstanding</span>
      </div>

      {error && <div className="card" style={{ marginBottom: 16 }}><div className="c-body t-red">{error}</div></div>}

      {/* KPI row */}
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
        <KpiCard label="Total Outstanding"   value={summary ? fmtCr(summary.total_outstanding) : '—'} sub="Balance still to be received" emoji="📌" color="c-blue"  loading={loading} />
        <KpiCard label="Overdue Invoices"    value={summary ? `${summary.invoice_count}` : '—'}        sub="With balance outstanding"    emoji="🧾" color="c-amber" loading={loading} />
        <KpiCard label="Avg Days Overdue"    value={summary ? `${summary.avg_days_overdue} days` : '—'} sub="Average aging across list"   emoji="⏳" color="c-red"   loading={loading} />
        <KpiCard label="Cost of Delay"       value={summary ? money(summary.total_opportunity_cost) : '—'} sub="Opportunity cost @ 12%"  emoji="💸" color="c-red"   loading={loading} />
      </div>

      {/* aging bucket chips */}
      {buckets.length > 0 && (
        <div className="filter-bar" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          <span className="fi">📊 Aging</span>
          <button className={`btn btn-xs ${bucket === '' ? 'btn-accent' : 'btn-outline'}`} onClick={() => setBucket('')}>
            All buckets
          </button>
          {buckets.map(b => (
            <button key={b.bucket} className={`btn btn-xs ${bucket === b.bucket ? 'btn-accent' : 'btn-outline'}`}
              onClick={() => setBucket(prev => prev === b.bucket ? '' : b.bucket)}>
              {b.bucket} · {money(b.amount)} ({b.count})
            </button>
          ))}
        </div>
      )}

      {/* filters */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <div className="fi-search" style={{ maxWidth: 220 }}>
          <span className="fi-search-icon">🔍</span>
          <input placeholder="Search invoice no…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="fi-select" value={customer} onChange={e => setCustomer(e.target.value)}>
          <option value="">All customers</option>
          {opts.customers.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(bucket || customer || search) && (
          <button className="btn btn-xs btn-outline" onClick={() => { setBucket(''); setCustomer(''); setSearch(''); }}>
            Clear
          </button>
        )}
      </div>

      <div className="card">
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Period</th>
                <th>Receivable</th>
                <th>Received</th>
                <th>Balance</th>
                <th>Receipt Due</th>
                <th>Days Overdue</th>
                <th>Aging</th>
                <th>Delay Reason</th>
                <th>Opp. Cost</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="text-center t-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={12} className="text-center t-muted">Nothing outstanding — all caught up 🎉</td></tr>
              ) : rows.map(r => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{r.invoice_number ?? '—'}</td>
                  <td>{r.customer ?? '—'}</td>
                  <td>{r.project_type ?? '—'}</td>
                  <td>{r.invoicing_period ? new Date(r.invoicing_period).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : '—'}</td>
                  <td className="mono">{money(r.total_receivable)}</td>
                  <td className="mono t-green">{money(r.amount_received)}</td>
                  <td className="mono t-amber">{money(r.balance_outstanding)}</td>
                  <td>{r.receipt_due_date ? new Date(r.receipt_due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                  <td className="mono">{r.aging_days ?? '—'}</td>
                  <td>{r.aging_bucket ? <span className={`badge ${BUCKET_COLOR[r.aging_bucket] ?? 'bg-gray'}`}>{r.aging_bucket}</span> : '—'}</td>
                  <td style={{ fontSize: 11 }}>{r.delay_reason ?? '—'}</td>
                  <td className="mono t-red">{money(r.opportunity_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tbl-footer">
          <span>Page {page} of {pages} · {total} total</span>
          <div className="pag">
            <button className="pg" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <button className="pg" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── sub-components ── */

function KpiCard({ label, value, sub, emoji, color, loading }: {
  label: string; value: string; sub: string; emoji: string; color: string; loading: boolean;
}) {
  return (
    <div className={`kpi-card ${color}`}>
      <div className="kpi-label">{label}</div>
      <div
        className={`kpi-val${loading ? ' skeleton' : ''}`}
        style={{ fontWeight: 500, letterSpacing: '-0.5px' }}
      >
        {loading ? ' ' : value}
      </div>
      <div className="kpi-sub">{sub}</div>
      <div className="kpi-emoji">{emoji}</div>
    </div>
  );
}
