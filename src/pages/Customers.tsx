import { useEffect, useMemo, useState } from 'react';
import { getCustomerSummary } from '../api';
import type { CustomerSummaryRow } from '../types';

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const cr = (n: number) => `₹${INR.format(+(n / 1e7).toFixed(2))} Cr`;

type SortKey = keyof Pick<CustomerSummaryRow, 'receivable' | 'outstanding' | 'received' | 'invoiced' | 'invoice_count' | 'collection_rate'>;

export default function Customers() {
  const [rows, setRows]     = useState<CustomerSummaryRow[]>([]);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('receivable');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoad(true);
    getCustomerSummary()
      .then(setRows).catch(e => setError(e?.message ?? 'Failed to load'))
      .finally(() => setLoad(false));
  }, []);

  const filtered = useMemo(() => {
    const f = rows.filter(r => r.customer.toLowerCase().includes(search.toLowerCase()));
    return [...f].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  }, [rows, sortKey, search]);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    invoiced: t.invoiced + r.invoiced,
    receivable: t.receivable + r.receivable,
    received: t.received + r.received,
    outstanding: t.outstanding + r.outstanding,
  }), { invoiced: 0, receivable: 0, received: 0, outstanding: 0 }), [rows]);

  const th = (label: string, key?: SortKey) => (
    <th
      style={{ cursor: key ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
      onClick={() => key && setSortKey(key)}
    >
      {label}{key && sortKey === key ? ' ▾' : ''}
    </th>
  );

  return (
    <div className="page-enter">
      <div className="ph-row" style={{ marginBottom: 16 }}>
        <div className="ph"><h1>Customers</h1><p>Customer-wise invoicing &amp; collection summary</p></div>
      </div>

      {/* totals */}
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
        {[
          { l: 'Total Invoiced', v: cr(totals.invoiced), c: 'c-blue' },
          { l: 'Total Receivable', v: cr(totals.receivable), c: 'c-blue' },
          { l: 'Total Received', v: cr(totals.received), c: 'c-green' },
          { l: 'Total Outstanding', v: cr(totals.outstanding), c: 'c-amber' },
        ].map(k => (
          <div key={k.l} className={`kpi-card ${k.c}`}>
            <div className="kpi-label">{k.l}</div>
            <div className="kpi-val" style={{ fontWeight: 500, letterSpacing: '-0.5px' }}>{loading ? ' ' : k.v}</div>
            <div className="kpi-sub">{rows.length} customers</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="c-head">
          <div><div className="c-title">All Customers</div><div className="c-sub">{filtered.length} shown</div></div>
          <div className="fi-search" style={{ maxWidth: 220 }}>
            <span className="fi-search-icon">🔍</span>
            <input placeholder="Search customer…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        {loading ? <div className="c-body text-center t-muted">Loading…</div>
          : error ? <div className="c-body t-red">{error}</div>
          : (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  {th('Customer')}
                  {th('Invoices', 'invoice_count')}
                  {th('Invoiced', 'invoiced')}
                  {th('Receivable', 'receivable')}
                  {th('Received', 'received')}
                  {th('Outstanding', 'outstanding')}
                  {th('Collection %', 'collection_rate')}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.customer}>
                    <td className="bold">{r.customer}</td>
                    <td>{r.invoice_count}</td>
                    <td className="mono">{cr(r.invoiced)}</td>
                    <td className="mono">{cr(r.receivable)}</td>
                    <td className="mono t-green">{cr(r.received)}</td>
                    <td className="mono t-amber">{cr(r.outstanding)}</td>
                    <td>
                      <span className={`badge ${r.collection_rate >= 75 ? 'bg-green' : r.collection_rate >= 40 ? 'bg-amber' : 'bg-red'}`}>
                        {r.collection_rate}%
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan={7} className="text-center t-muted">No customers</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
