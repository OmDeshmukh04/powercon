import { useState, useRef, useEffect } from 'react';
import * as echarts from 'echarts';
import { getAppointments, getReconSummary, getProviderSummary } from '../api';
import type { Appointment, ReconSummary, ProviderSummary } from '../types';

const EC = { text: '#1a2332', text3: '#8496ae', border: '#d8e2ee', accent: '#2d7fc1', green: '#0d9e6e', amber: '#d97706', red: '#dc3545', purple: '#6f42c1' };

function fmt(n: number) { return n.toLocaleString(); }

export default function Dashboard() {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [recon, setRecon] = useState<ReconSummary | null>(null);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refReconTrend = useRef<HTMLDivElement>(null);
  const refProviders = useRef<HTMLDivElement>(null);
  const charts = useRef<echarts.ECharts[]>([]);

  // Load data
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [a, r, p] = await Promise.all([
          getAppointments({ page: 1, page_size: 5 }),
          getReconSummary(),
          getProviderSummary(),
        ]);
        setAppts(a.items);
        setRecon(r);
        setProviders(p);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Build charts
  useEffect(() => {
    charts.current.forEach(c => c.dispose());
    charts.current = [];

    // Reconciliation summary by status (pie chart)
    if (refReconTrend.current && recon) {
      const c = echarts.init(refReconTrend.current);
      charts.current.push(c);
      const data = recon.rows.map(r => ({ name: r.status, value: r.count }));
      c.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', formatter: '{b}: {c}' },
        legend: { show: false },
        series: [{
          type: 'pie',
          radius: ['30%', '70%'],
          data,
          label: { formatter: '{b}: {c}', fontSize: 10 },
          itemStyle: { borderRadius: 3, borderWidth: 1, borderColor: '#fff' },
          emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,.5)' } },
        }],
      });
    }

    // Provider comparison (bar chart)
    if (refProviders.current && providers.length > 0) {
      const c = echarts.init(refProviders.current);
      charts.current.push(c);
      const names = providers.map(p => p.provider_name).slice(0, 8);
      const collected = providers.map(p => p.paid).slice(0, 8);
      c.setOption({
        backgroundColor: 'transparent',
        grid: { top: 10, right: 10, bottom: 24, left: 60 },
        xAxis: { type: 'category', data: names, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: EC.text3, fontSize: 10 } },
        yAxis: { axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: EC.border } }, axisLabel: { color: EC.text3, fontSize: 10 } },
        tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: EC.border, textStyle: { color: EC.text, fontSize: 12 } },
        series: [{ name: 'Collected', type: 'bar', data: collected, itemStyle: { color: EC.green, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 24 }],
      });
    }

    const handleResize = () => charts.current.forEach(ch => { try { ch.resize(); } catch (_) {} });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [recon, providers]);

  const totalAppts = appts.length;
  const totalRecon = recon?.total_paid || 0;
  const totalProviders = providers.length;
  const avgCollection = providers.length ? providers.reduce((s, p) => s + p.paid, 0) / providers.length : 0;

  return (
    <div className="page-enter">
      <div className="ph-row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="ph" style={{ marginBottom: 3 }}>Provider Dashboard</h1>
          <p style={{ fontSize: 13, color: 'var(--text2)' }}>Overview of appointments, reconciliation, and provider performance</p>
        </div>
      </div>

      {/* KPI Row */}
      <div className="kpi-row cols3" style={{ marginBottom: 20 }}>
        <div className="kpi-card c-blue">
          <div className="kpi-label">Total Appointments</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{fmt(totalAppts)}</div>
          <div className="kpi-sub">Last 4 weeks</div>
          <div className="kpi-emoji">📅</div>
        </div>
        <div className="kpi-card c-green">
          <div className="kpi-label">Total Reconciliation</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>${fmt(Math.round(totalRecon))}</div>
          <div className="kpi-sub">Amount</div>
          <div className="kpi-emoji">💰</div>
        </div>
        <div className="kpi-card c-purple">
          <div className="kpi-label">Active Providers</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{fmt(totalProviders)}</div>
          <div className="kpi-sub">Avg ${fmt(Math.round(avgCollection))}</div>
          <div className="kpi-emoji">🏥</div>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-2col" style={{ marginBottom: 20 }}>
        <div className="chart-box">
          <div className="ch-title">Reconciliation Trend</div>
          <div className="ch-sub">Weekly reconciliation amounts</div>
          <div className="ch-wrap" ref={refReconTrend} />
        </div>
        <div className="chart-box">
          <div className="ch-title">Top Providers</div>
          <div className="ch-sub">Collections by provider</div>
          <div className="ch-wrap" ref={refProviders} />
        </div>
      </div>

      {/* Recent Appointments */}
      <div className="card">
        <div className="c-head">
          <div>
            <div className="c-title">Recent Appointments</div>
            <div className="c-sub">Last 5 appointments</div>
          </div>
        </div>
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Patient</th>
                <th>Provider</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text3)', padding: 20 }}>Loading…</td></tr>
              ) : appts.length === 0 ? (
                <tr><td colSpan={4}><div className="empty" style={{ padding: 20 }}><div className="empty-icon">📅</div><div className="empty-title">No data</div></div></td></tr>
              ) : appts.map((a) => (
                <tr key={a.id}>
                  <td className="bold">{a.patient_name}</td>
                  <td className="t-muted">{a.provider_name}</td>
                  <td>{a.appt_date}</td>
                  <td><span className="badge bg-green">✓ {a.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
