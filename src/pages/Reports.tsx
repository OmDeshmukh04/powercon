// src/pages/Reports.tsx
import { useEffect, useState } from 'react';
import { getReconSummary, getProviderSummary } from '../api';

export default function Reports() {
  const [summary, setSummary] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getReconSummary({}), getProviderSummary()])
      .then(([sumRes, provRes]) => {
        setSummary(sumRes);
        const rows = Array.isArray(provRes) ? provRes : [];
        setProviders(rows);
        setLoading(false);
      })
      .catch(console.error);
  }, []);

  if (loading) {
    return (
      <div className="page-enter">
        <div className="card">
          <div className="c-body text-center t-muted">Loading reports...</div>
        </div>
      </div>
    );
  }

  const totals = summary?.totals || { billed: 0, paid: 0, balance: 0 };
  const statusRows = summary?.summary || [];

  const formatMoney = (val: number) => val ? `$${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—';

  return (
    <div className="page-enter">
      <div className="ph" style={{ marginBottom: 16 }}>
        <h1>Reports</h1>
        <p>Download reconciliations and review performance summaries.</p>
      </div>
      <div className="kpi-row cols3">
        <div className="kpi-card c-amber">
          <div className="kpi-label">Total Billed</div>
          <div className="kpi-val">{formatMoney(totals.billed)}</div>
          <div className="kpi-emoji">💳</div>
        </div>
        <div className="kpi-card c-green">
          <div className="kpi-label">Total Paid</div>
          <div className="kpi-val">{formatMoney(totals.paid)}</div>
          <div className="kpi-emoji">💰</div>
        </div>
        <div className="kpi-card c-red">
          <div className="kpi-label">Balance</div>
          <div className="kpi-val">{formatMoney(totals.balance)}</div>
          <div className="kpi-emoji">⚠️</div>
        </div>
      </div>

      <div className="card">
        <div className="c-head"><div className="c-title">📥 Download Reports</div></div>
        <div className="dl-grid">
          <div className="dl-card" onClick={() => alert('Download Reconciliation Summary')}>
            <div className="dl-card-icon">📊</div>
            <div><div className="dl-card-title">Reconciliation Summary</div><div className="dl-card-sub">Full reconciliation breakdown — XLSX</div></div>
          </div>
          <div className="dl-card" onClick={() => alert('Download Provider Report')}>
            <div className="dl-card-icon">🩺</div>
            <div><div className="dl-card-title">Provider Report</div><div className="dl-card-sub">Per-provider billing & collections</div></div>
          </div>
          <div className="dl-card" onClick={() => alert('Download Exceptions Report')}>
            <div className="dl-card-icon">⚠️</div>
            <div><div className="dl-card-title">Exceptions Report</div><div className="dl-card-sub">Orphan charges, missing charges & unmatched</div></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="c-head"><div className="c-title">Payment Status Summary</div></div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '28%' }} /><col style={{ width: '10%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '14%' }} /></colgroup>
            <thead><tr><th>Status</th><th>Count</th><th>Billed</th><th>Paid</th><th>Balance</th><th>Share</th></tr></thead>
            <tbody>
              {statusRows.map((row: any) => {
                const share = totals.count ? Math.round((row.count / totals.count) * 100) : 0;
                return (
                  <tr key={row.status}>
                    <td><span className="badge bg-gray">{row.status.replace(/_/g, ' ')}</span></td>
                    <td className="bold">{row.count}</td>
                    <td className="mono">{formatMoney(row.billed)}</td>
                    <td className="mono t-green">{formatMoney(row.paid)}</td>
                    <td className="mono t-amber">{formatMoney(row.balance)}</td>
                    <td>
                      <div className="flex ai-c gap-2">
                        <div className="prog" style={{ width: 60 }}><div className="prog-fill" style={{ width: `${share}%` }}></div></div>
                        <span className="t-muted">{share}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="c-head"><div className="c-title">🏆 Top Providers</div></div>
        <div className="tbl-wrap">
          <table style={{ tableLayout: 'fixed' }}>
            <colgroup><col style={{ width: '30%' }} /><col style={{ width: '15%' }} /><col style={{ width: '18%' }} /><col style={{ width: '18%' }} /><col style={{ width: '19%' }} /></colgroup>
            <thead><tr><th>Provider</th><th>Appts</th><th>Billed</th><th>Paid</th><th>Collection Rate</th></tr></thead>
            <tbody>
              {providers.slice(0, 8).map((p: any) => {
                const rate = p.billed_amount ? Math.round((p.paid_amount / p.billed_amount) * 100) : 0;
                return (
                  <tr key={p.provider_id}>
                    <td className="bold">{p.provider_name}</td>
                    <td>{p.appointment_count}</td>
                    <td className="mono">{formatMoney(p.billed_amount)}</td>
                    <td className="mono t-green">{formatMoney(p.paid_amount)}</td>
                    <td>
                      <div className="flex ai-c gap-2">
                        <div className="prog" style={{ width: 80 }}><div className="prog-fill" style={{ width: `${rate}%` }}></div></div>
                        <span className={rate >= 80 ? 't-green' : rate >= 60 ? 't-amber' : 't-red'}>{rate}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}