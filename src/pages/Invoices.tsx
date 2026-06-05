import { useEffect, useState } from 'react';
import { getInvoiceList, getInvoiceFilterOptions } from '../api';
import type { InvoiceRow, InvoiceFilterOptions } from '../types';

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (n: number) => `₹${INR.format(Math.round(n))}`;

const statusBadge = (s: string | null) => {
  const v = (s ?? '').toLowerCase();
  if (v.includes('submit')) return 'bg-green';
  if (v.includes('pend'))   return 'bg-amber';
  if (v.includes('delay'))  return 'bg-red';
  return 'bg-gray';
};

export default function Invoices() {
  const [rows, setRows]   = useState<InvoiceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage]   = useState(1);
  const [loading, setLoad] = useState(true);
  const [opts, setOpts]   = useState<InvoiceFilterOptions>({ customers: [], statuses: [], project_types: [] });

  const [customer, setCustomer]       = useState('');
  const [status, setStatus]           = useState('');
  const [projectType, setProjectType] = useState('');
  const [search, setSearch]           = useState('');

  useEffect(() => { getInvoiceFilterOptions().then(setOpts).catch(() => {}); }, []);

  useEffect(() => {
    setLoad(true);
    getInvoiceList({ customer, status, projectType, search, page, pageSize: 50 })
      .then(r => { setRows(r.items); setTotal(r.total); setPages(r.pages); })
      .catch(() => { setRows([]); setTotal(0); setPages(1); })
      .finally(() => setLoad(false));
  }, [customer, status, projectType, search, page]);

  // reset to page 1 whenever a filter changes
  useEffect(() => { setPage(1); }, [customer, status, projectType, search]);

  return (
    <div className="page-enter">
      <div className="ph-row" style={{ marginBottom: 16 }}>
        <div className="ph"><h1>Invoices</h1><p>Full invoice register from the latest MIS upload</p></div>
        <span className="active-range-pill">{total} invoices</span>
      </div>

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
        <select className="fi-select" value={projectType} onChange={e => setProjectType(e.target.value)}>
          <option value="">All types</option>
          {opts.project_types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="fi-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {opts.statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(customer || status || projectType || search) && (
          <button className="btn btn-xs btn-outline" onClick={() => { setCustomer(''); setStatus(''); setProjectType(''); setSearch(''); }}>
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
                <th>Gross</th>
                <th>Received</th>
                <th>Balance</th>
                <th>Status</th>
                <th>AR Days</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center t-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="text-center t-muted">No invoices match the filters</td></tr>
              ) : rows.map(r => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{r.invoice_number ?? '—'}</td>
                  <td>{r.customer ?? '—'}</td>
                  <td>{r.project_type ?? '—'}</td>
                  <td>{r.invoicing_period ? new Date(r.invoicing_period).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : '—'}</td>
                  <td className="mono">{money(r.gross_invoice_amount)}</td>
                  <td className="mono t-green">{money(r.amount_received)}</td>
                  <td className="mono t-amber">{money(r.balance_outstanding)}</td>
                  <td><span className={`badge ${statusBadge(r.status)}`}>{r.status ?? '—'}</span></td>
                  <td>{r.aging_days ?? '—'}</td>
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
