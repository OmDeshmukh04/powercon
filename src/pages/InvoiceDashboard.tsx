import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { getInvoiceDashboard, getInvoiceSnapshots } from '../api';
import type { InvoiceDashboardData, InvoiceSnapshot } from '../types';

/* ── Official Powercon palette (mirrors CSS variables) ─────────────────────
   Primary blues + silver/gray family.
   Rule:
     2-colour charts  → C.b1 (dark blue)  +  C.g1 (silver)
     Multi-colour     → blue shades first, then g1/g2/g3 neutrals
     Pie charts       → same multi-colour set, always consistent            */
const C = {
  /* Blues — primary brand */
  b1: '#014569',   // --accent       darkest blue
  b2: '#026aa2',   // --accent-d     medium blue
  b3: '#0891b2',   // --cyan         lightest blue/teal
  b4: '#0f4c75',   // deep blue (derived)
  /* Grays — secondary / neutral */
  g1: '#6b7e96',   // --silver       main gray
  g2: '#94a3b8',   // --text3        lighter gray
  g3: '#cbd5e1',   // --border2      lightest gray
  /* Used only for Retention / special buckets */
  amber: '#d97706',
  /* Text & structure */
  text:   '#1e293b',
  text2:  '#64748b',
  border: '#e2e8f0',
} as const;

/* Pie / multi-segment palette — blues then neutrals */
const PIE_COLORS = [C.b1, C.b3, C.b2, C.g1, C.b4, C.g2, C.b3, '#1a5f7a', '#1b6ca8', C.g3, '#3a7ca5'];

/* 2-colour pair — dark blue + silver */
const DUO = { primary: C.b1, secondary: C.g1 };

const TT  = { backgroundColor: '#fff', borderColor: C.border, textStyle: { color: C.text, fontSize: 12 }, extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,.08);border-radius:8px' };
const AX  = { fontFamily: 'Montserrat,sans-serif', fontSize: 10, color: C.text2 };
const BR4 = [4, 4, 0, 0] as [number, number, number, number];

/* DataZoom slider — added to every bar chart */
const DATA_ZOOM = [
  { type: 'slider' as const, bottom: 2, height: 14,
    borderColor: C.border, fillerColor: 'rgba(1,69,105,.08)',
    handleStyle: { color: C.b1 }, labelFormatter: '' },
  { type: 'inside' as const },
];
/* Grid with extra bottom room for the dataZoom slider */
const GRID = { top: 14, right: 14, bottom: 48, left: 52 };
const GRID_H = { top: 10, right: 60, bottom: 32, left: 120 }; // horizontal bars

/* Project pipeline: 5 metrics — dark→light blue family + silver */
const PP = { po_fy30: C.b1, fy26_po: C.g1, invoiced: C.b2, payment_due: C.b3, receipt: C.g2 };

const INR      = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const fmtCr    = (n: number) => `₹${INR.format(+(n / 1e7).toFixed(2))} Cr`;
const fmtL     = (n: number) => `₹${INR.format(+(n / 1e5).toFixed(2))} L`;
const fmtMonth = (m: string) => {
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1).toLocaleString('en-IN', { month: 'short' }) + '-' + y.slice(2);
};

/* ── useChart hook ──
   Single effect keyed on data deps: lazily creates the ECharts instance the
   first time data arrives (so init + setOption are always in the same tick),
   then updates on every subsequent data change.
   A separate cleanup-only effect disposes on component unmount.            */
function useChart(
  ref: React.RefObject<HTMLDivElement | null>,
  getOption: () => EChartsOption | null,
  deps: unknown[],
) {
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    // Create the instance lazily — first call when data arrives.
    if (!inst.current || inst.current.isDisposed()) {
      inst.current = echarts.init(ref.current);
    }
    const ch = inst.current;
    const opt = getOption();
    if (opt) ch.setOption(opt, { notMerge: true });
    else ch.clear();

    const onResize = () => { try { ch.resize(); } catch { /* */ } };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // Dispose only when the component unmounts.
  useEffect(() => () => {
    try { inst.current?.dispose(); } catch { /* */ }
    inst.current = null;
  }, []);
}

/* ── FY helpers ── */
function fyStart(d: Date) { const m = d.getMonth()+1, y = m>=4?d.getFullYear():d.getFullYear()-1; return `${y}-04-01`; }
function fyEnd(d: Date)   { const m = d.getMonth()+1, y = m>=4?d.getFullYear()+1:d.getFullYear(); return `${y}-03-31`; }

/* ════════════════════════════════════════════════════════════════ */
export default function InvoiceDashboard() {
  const today = new Date();

  const [data, setData]       = useState<InvoiceDashboardData | null>(null);
  const [snaps, setSnaps]     = useState<InvoiceSnapshot[]>([]);
  const [selSnap, setSelSnap] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(fyStart(today));
  const [dateTo,   setDateTo]   = useState(fyEnd(today));
  const [applied,  setApplied]  = useState({ from: fyStart(today), to: fyEnd(today) });

  /* 13 chart refs — one per chart */
  const refDue      = useRef<HTMLDivElement>(null);  // 1. Invoices Due pie
  const refDelay    = useRef<HTMLDivElement>(null);  // 2. Delay Reasons pie
  const refOppCost  = useRef<HTMLDivElement>(null);  // 3. Opportunity Cost monthly
  const refArDays   = useRef<HTMLDivElement>(null);  // 4. Monthly AR Days stacked
  const refAging    = useRef<HTMLDivElement>(null);  // 5. AR Aging buckets
  const refPlanned  = useRef<HTMLDivElement>(null);  // 6. Planned vs Actual
  const refQuarter  = useRef<HTMLDivElement>(null);  // 7. Quarterly FY26 POs stacked
  const refTotal    = useRef<HTMLDivElement>(null);  // 8. Total pipeline (horizontal)
  const refConst    = useRef<HTMLDivElement>(null);  // 9. Construction pipeline (horizontal)
  const refOps      = useRef<HTMLDivElement>(null);  // 10. Operations pipeline (horizontal)
  const refDev      = useRef<HTMLDivElement>(null);  // 11. Development pipeline (horizontal)

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getInvoiceDashboard({ snapshotId: selSnap, dateFrom: applied.from, dateTo: applied.to }),
      getInvoiceSnapshots(),
    ])
      .then(([d, s]) => { setData(d); setSnaps(s); setError(null); })
      .catch(e => setError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, [selSnap, applied]);

  function applyRange() { setApplied({ from: dateFrom, to: dateTo }); }

  function setPreset(p: 'thisfy' | 'lastfy' | 'thisq' | 'all') {
    const y = today.getFullYear(), m = today.getMonth() + 1;
    const curFy = m >= 4 ? y : y - 1;
    const map: Record<string, [string, string]> = {
      thisfy: [`${curFy}-04-01`,     `${curFy+1}-03-31`],
      lastfy: [`${curFy-1}-04-01`,   `${curFy}-03-31`],
      thisq:  m>=10?[`${y}-10-01`,`${y}-12-31`]:m>=7?[`${y}-07-01`,`${y}-09-30`]:m>=4?[`${y}-04-01`,`${y}-06-30`]:[`${y}-01-01`,`${y}-03-31`],
      all:    ['', ''],
    };
    const [f, t] = map[p];
    setDateFrom(f); setDateTo(t); setApplied({ from: f, to: t });
  }

  const d    = data;
  const kpis = d?.kpis;

  /* shared pie label config — lines/arrows pointing outward */
  const PIE_LABEL = {
    show: true, position: 'outside' as const, fontSize: 10.5, color: C.text,
    formatter: (p: any) => `${p.percent}%`,
  };
  const PIE_LABEL_LINE = { show: true, length: 8, length2: 16, smooth: 0.4, lineStyle: { color: C.g1 } };

  /* ── 1. Invoices Due pie ── */
  useChart(refDue, () => {
    if (!d?.invoices_due_by_customer?.length) return null;
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', ...TT, formatter: (p: any) => `<b>${p.name}</b><br/>${fmtCr(p.value)} (${p.percent}%)` },
      legend: { bottom: 0, left: 'center', orient: 'horizontal', itemWidth: 10, itemHeight: 10, itemGap: 8, textStyle: { fontSize: 10, color: C.text2 } },
      series: [{ type: 'pie', radius: ['32%', '58%'], center: ['50%', '44%'],
        label: PIE_LABEL, labelLine: PIE_LABEL_LINE,
        emphasis: { label: { fontSize: 11, fontWeight: 700 } },
        data: d.invoices_due_by_customer.map((r, i) => ({ name: r.customer, value: r.balance, itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] } })),
      }],
    };
  }, [d?.invoices_due_by_customer]);

  /* ── 2. Delay Reasons pie ──
     Note: Excel shows 3 subcategories (Attendance/WCC/PO Pending) derived from
     customer-specific sheets we don't parse. We show status-based categories
     from the Input sheet which is the available source data.               */
  useChart(refDelay, () => {
    if (!d?.delay_reasons?.length) return null;
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', ...TT, formatter: (p: any) => `<b>${p.name}</b><br/>₹${INR.format(Math.round(+p.value))} (${p.percent}%)` },
      legend: { bottom: 0, left: 'center', orient: 'horizontal', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10, color: C.text2 } },
      series: [{ type: 'pie', radius: ['32%', '58%'], center: ['50%', '44%'],
        label: PIE_LABEL, labelLine: PIE_LABEL_LINE,
        emphasis: { label: { fontSize: 11, fontWeight: 700 } },
        data: d.delay_reasons.map((r, i) => ({ name: r.reason, value: r.amount, itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] } })),
      }],
    };
  }, [d?.delay_reasons]);

  /* ── 3. Opportunity Cost — waterfall-style bar (blue = cost, amber = recovery) ── */
  useChart(refOppCost, () => {
    if (!d?.opportunity_cost_monthly?.length) return null;
    const months = d.opportunity_cost_monthly.map(r => fmtMonth(r.month));
    const vals   = d.opportunity_cost_monthly.map(r => +(r.opportunity_cost / 1e5).toFixed(2));
    // Waterfall: each bar sits on top of the running total of previous bars
    let running = 0;
    const offsets = vals.map(v => { const o = v >= 0 ? running : running + v; running += v; return +o.toFixed(2); });
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', ...TT, formatter: (params: any) => {
        const i = params[0]?.dataIndex ?? 0;
        return `<b>${months[i]}</b><br/>₹${vals[i]}L`;
      }},
      dataZoom: DATA_ZOOM,
      grid: { ...GRID, top: 20 },
      xAxis: { type: 'category', data: months, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AX } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { ...AX, formatter: (v: number) => `${v}L` } },
      series: [
        { type: 'bar', stack: 'wf', silent: true, barMaxWidth: 36,
          data: offsets, itemStyle: { color: 'transparent' } },
        { type: 'bar', stack: 'wf', barMaxWidth: 36,
          data: vals.map(v => ({ value: Math.abs(v), itemStyle: { color: v < 0 ? C.amber : C.b1, borderRadius: BR4 } })),
          label: { show: true, position: 'top' as const, fontSize: 10, color: C.text2, formatter: (p: any) => `${vals[p.dataIndex]}` } },
      ],
    };
  }, [d?.opportunity_cost_monthly]);

  /* ── 4. Monthly AR Days stacked ── */
  useChart(refArDays, () => {
    if (!d?.monthly_ar_days?.length) return null;
    const months = d.monthly_ar_days.map(r => fmtMonth(r.month));
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', ...TT, axisPointer: { type: 'shadow' } },
      legend: { bottom: 18, left: 'center', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10, color: C.text2 } },
      dataZoom: DATA_ZOOM,
      grid: { ...GRID, bottom: 64 },
      xAxis: { type: 'category', data: months, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AX } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { ...AX } },
      series: [
        { name: 'AR Days', type: 'bar', stack: 'ar', barMaxWidth: 36,
          data: d.monthly_ar_days.map(r => r.ar_days), itemStyle: { color: DUO.primary },
          label: { show: true, position: 'inside' as const, fontSize: 10, color: '#fff', formatter: (p: any) => p.value > 0 ? `${p.value}` : '' } },
        { name: 'Submission Delay Days', type: 'bar', stack: 'ar', barMaxWidth: 36,
          data: d.monthly_ar_days.map(r => r.submission_delay_days), itemStyle: { color: DUO.secondary },
          label: { show: true, position: 'top' as const, fontSize: 10, color: C.text2, formatter: (p: any) => p.value > 0 ? `${p.value}` : '' } },
      ],
    };
  }, [d?.monthly_ar_days]);

  /* ── 5. AR Aging buckets ── */
  useChart(refAging, () => {
    if (!d?.ar_aging?.length) return null;
    const AGING_COLORS: Record<string, string> = { '0-15': C.b1, '15-30': C.b1, '30-45': C.b1, '45-60': C.b1, '60+': C.b1, Retention: C.amber, 'Not received': C.g1 };
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', ...TT, formatter: (params: any) => `<b>${params[0]?.name}</b><br/>${fmtCr(params[0]?.value * 1e7)}` },
      dataZoom: DATA_ZOOM,
      grid: GRID,
      xAxis: { type: 'category', data: d.ar_aging.map(r => r.bucket), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AX } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { ...AX, formatter: (v: number) => `${v}Cr` } },
      series: [{ type: 'bar', barMaxWidth: 42,
        data: d.ar_aging.map(r => ({ value: +(r.amount / 1e7).toFixed(2), itemStyle: { color: AGING_COLORS[r.bucket] ?? C.b1, borderRadius: BR4 } })),
        label: { show: true, position: 'top' as const, fontSize: 10, color: C.text2, formatter: (p: any) => `${p.value}` },
      }],
    };
  }, [d?.ar_aging]);

  /* ── 6. Planned vs Actual ── */
  useChart(refPlanned, () => {
    if (!d?.planned_vs_actual?.length) return null;
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', ...TT, formatter: (params: any) =>
        `<b>${params[0]?.name}</b><br/>${params.map((p: any) => `${p.marker}${p.seriesName}: ${fmtCr(p.value * 1e7)}`).join('<br/>')}` },
      legend: { bottom: 18, left: 'center', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10, color: C.text2 } },
      dataZoom: DATA_ZOOM,
      grid: { ...GRID, bottom: 64 },
      xAxis: { type: 'category', data: d.planned_vs_actual.map(r => fmtMonth(r.month)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AX } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { ...AX, formatter: (v: number) => `${v}Cr` } },
      series: [
        { name: 'Planned', type: 'bar', barMaxWidth: 22, data: d.planned_vs_actual.map(r => +(r.planned / 1e7).toFixed(2)), itemStyle: { color: DUO.secondary, borderRadius: BR4 } },
        { name: 'Actual',  type: 'bar', barMaxWidth: 22, data: d.planned_vs_actual.map(r => +(r.actual  / 1e7).toFixed(2)), itemStyle: { color: DUO.primary,   borderRadius: BR4 } },
      ],
    };
  }, [d?.planned_vs_actual]);

  /* ── 7. Quarterly FY26 POs — stacked by project type ── */
  useChart(refQuarter, () => {
    const rows = d?.fy26_po_quarterly_stacked;
    if (!rows?.length) return null;
    const quarters  = rows.map(r => r.quarter as string);
    const allTypes  = Object.keys(rows[0] ?? {}).filter(k => k !== 'quarter');
    const TYPE_COLORS: Record<string, string> = { Operations: C.b1, Construction: C.b2, Development: C.g1, 'One-Time': C.b3, Unspecified: C.g2 };
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', ...TT, axisPointer: { type: 'shadow' } },
      legend: { bottom: 18, left: 'center', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10, color: C.text2 } },
      dataZoom: DATA_ZOOM,
      grid: { ...GRID, bottom: 64 },
      xAxis: { type: 'category', data: quarters, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AX } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { ...AX, formatter: (v: number) => `${v}Cr` } },
      series: allTypes.map((pt, i) => ({
        name: pt, type: 'bar' as const, stack: 'q', barMaxWidth: 48,
        data: rows.map(r => (r[pt] as number) ?? 0),
        itemStyle: { color: TYPE_COLORS[pt] ?? PIE_COLORS[i % PIE_COLORS.length], borderRadius: i === allTypes.length - 1 ? BR4 : [0,0,0,0] as [number,number,number,number] },
        label: { show: true, position: 'inside' as const, fontSize: 10, color: '#fff', formatter: (p: any) => p.value > 0 ? `${p.value}` : '' },
      })),
    };
  }, [d?.fy26_po_quarterly_stacked]);

  /* ── helper for project pipeline horizontal bar charts ── */
  function pipelineOption(projectType: string): EChartsOption | null {
    const row = d?.project_pipeline?.find(r => r.project_type === projectType);
    if (!row) return null;
    const cats   = ['PO (upto FY30)', 'FY 26 PO', 'Invoice', 'Payment Due / Eligible', 'Receipt'];
    const vals   = [row.po_fy30, row.fy26_po, row.invoiced, row.payment_due, row.receipt];
    const colors = [PP.po_fy30, PP.fy26_po, PP.invoiced, PP.payment_due, PP.receipt];
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', ...TT, axisPointer: { type: 'shadow' }, formatter: (params: any) => `<b>${params[0]?.name}</b><br/>${params[0]?.value} Cr` },
      grid: GRID_H,
      xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false } },
      yAxis: { type: 'category', data: cats, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...AX, width: 110 } },
      series: [{ type: 'bar', barMaxWidth: 40,
        data: vals.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [0, 4, 4, 0] as [number,number,number,number] } })),
        label: { show: true, position: 'right' as const, fontSize: 11, color: C.text2, formatter: (p: any) => `${p.value}` },
      }],
    };
  }

  /* ── 8. Total pipeline ── */
  useChart(refTotal, () => pipelineOption('Total'), [d?.project_pipeline]);

  /* ── 9. Construction pipeline (EPC → Construction via backend mapping) ── */
  useChart(refConst, () => pipelineOption('Construction'), [d?.project_pipeline]);

  /* ── 10. Operations pipeline (O&M → Operations via backend mapping) ── */
  useChart(refOps, () => pipelineOption('Operations'), [d?.project_pipeline]);

  /* ── 11. Development pipeline ── */
  useChart(refDev, () => pipelineOption('Development'), [d?.project_pipeline]);

  /* ── render ── */
  const snap = d?.snapshot;

  return (
    <div className="page-enter">

      {/* Compact toolbar — period presets + custom range + snapshot info */}
      <div className="filter-bar" style={{ marginBottom: 18 }}>
        <span className="fi">📅 Period</span>
        {(['thisfy', 'lastfy', 'thisq', 'all'] as const).map(p => {
          const isActive =
            p === 'all'    ? (!applied.from && !applied.to) :
            p === 'thisfy' ? applied.from === fyStart(today) :
            p === 'lastfy' ? applied.from === `${(today.getMonth()+1>=4?today.getFullYear()-1:today.getFullYear()-2)}-04-01` :
            false;
          return (
            <button key={p} className={`btn btn-xs ${isActive ? 'btn-accent' : 'btn-outline'}`}
              onClick={() => setPreset(p)}>
              {{ thisfy: 'This FY', lastfy: 'Last FY', thisq: 'This Quarter', all: 'All' }[p]}
            </button>
          );
        })}
        <input type="date" className="fi-date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span className="fi">to</span>
        <input type="date" className="fi-date" value={dateTo}   onChange={e => setDateTo(e.target.value)} />
        <button className="btn btn-accent btn-xs" onClick={applyRange} disabled={loading}>{loading ? '…' : 'Apply'}</button>

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {snaps.length > 1 && (
            <select className="fi-select" value={selSnap ?? ''} onChange={e => setSelSnap(e.target.value ? +e.target.value : undefined)}>
              <option value="">Latest snapshot</option>
              {snaps.map(s => <option key={s.id} value={s.id}>{s.as_on_date ?? `Snapshot #${s.id}`}</option>)}
            </select>
          )}
          {snap && <span className="active-range-pill">As on {snap.as_on_date ?? '—'}</span>}
        </span>
      </div>

      {error && <div className="card" style={{ marginBottom: 16 }}><div className="c-body t-red">{error}</div></div>}

      {/* KPI row 1 */}
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 14 }}>
        <KpiCard label="YTD Invoices Accrued" value={kpis ? fmtCr(kpis.ytd_invoices_accrued) : '—'} sub="Total invoices raised"   emoji="🧾" color="c-blue"  loading={loading} />
        <KpiCard label="Submitted Invoices"   value={kpis ? fmtCr(kpis.submitted_invoices)   : '—'} sub="Successfully submitted" emoji="✅" color="c-green" loading={loading} />
        <KpiCard label="Shortfall"            value={kpis ? fmtCr(kpis.shortfall)             : '—'} sub="Accrued minus submitted" emoji="⚠️" color="c-amber" loading={loading} />
      </div>
      {/* KPI row 2 */}
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        <KpiCard label="Amount Received"      value={kpis ? fmtCr(kpis.amount_received)       : '—'} sub="Payments collected"     emoji="💵" color="c-green" loading={loading} />
        <KpiCard label="Balance Outstanding"  value={kpis ? fmtCr(kpis.balance_outstanding)   : '—'} sub="Pending receivables"    emoji="📌" color="c-blue"  loading={loading} />
        <KpiCard label="Cost of Delayed Pymt" value={kpis ? fmtL(kpis.cost_of_delayed_payment): '—'} sub="Opportunity cost @ 12%" emoji="⏳" color="c-red"   loading={loading} />
      </div>

      {/* Section: Invoicing overview */}
      <div className="dash-section" style={{ marginBottom: 10 }}>Invoices Due &amp; Delay Analysis</div>
      <div className="charts-2col" style={{ marginBottom: 16 }}>
        <ChartBox title="Invoices Due (YTD)"         sub="Balance outstanding by customer"     refEl={refDue}    loading={loading} empty={!d?.invoices_due_by_customer?.length} />
        <ChartBox title="Reasons for Delay"          sub="Amount blocked by reason (INR)"      refEl={refDelay}  loading={loading} empty={!d?.delay_reasons?.length} emptyMsg="No delay reasons recorded" />
      </div>

      {/* Section: Payment & AR */}
      <div className="dash-section" style={{ marginBottom: 10 }}>Receivables &amp; AR Metrics</div>
      <div className="charts-2col" style={{ marginBottom: 16 }}>
        <ChartBox title="Opportunity Cost (Lakhs)"   sub="Monthly delayed payment cost"        refEl={refOppCost} loading={loading} empty={!d?.opportunity_cost_monthly?.length} />
        <ChartBox title="Monthly AR Days"            sub="AR Days + Submission Delay (stacked)" refEl={refArDays} loading={loading} empty={!d?.monthly_ar_days?.length} />
      </div>
      <div className="charts-2col" style={{ marginBottom: 16 }}>
        <ChartBox title="AR Aging Buckets"           sub="Weighted average outstanding (INR Cr)" refEl={refAging}  loading={loading} empty={!d?.ar_aging?.length} />
        <ChartBox title="Planned vs Actual"          sub="Monthly invoicing (INR Cr)"            refEl={refPlanned} loading={loading} empty={!d?.planned_vs_actual?.length} />
      </div>

      {/* Section: PO / Pipeline */}
      <div className="dash-section" style={{ marginBottom: 10 }}>Project Pipeline &amp; PO Breakup</div>
      <div style={{ marginBottom: 16 }}>
        <ChartBox title="Quarterly Breakup of FY26 POs" sub="Stacked by project type (INR Cr)" refEl={refQuarter} loading={loading} empty={!d?.fy26_po_quarterly_stacked?.length} height={240} />
      </div>
      <div className="charts-2col" style={{ marginBottom: 16 }}>
        <ChartBox title="Total (INR Cr)"                sub="PO / FY26 PO / Invoice / Payment Due / Receipt" refEl={refTotal} loading={loading} empty={!d?.project_pipeline?.some(r => r.project_type === 'Total')}        height={220} />
        <ChartBox title="Project Construction (INR Cr)" sub="PO / FY26 PO / Invoice / Payment Due / Receipt" refEl={refConst} loading={loading} empty={!d?.project_pipeline?.some(r => r.project_type === 'Construction')} height={220} />
      </div>
      <div className="charts-2col" style={{ marginBottom: 16 }}>
        <ChartBox title="Project Operations (INR Cr)"   sub="PO / FY26 PO / Invoice / Payment Due / Receipt" refEl={refOps}   loading={loading} empty={!d?.project_pipeline?.some(r => r.project_type === 'Operations')}   height={220} />
        <ChartBox title="Project Development (INR Cr)"  sub="PO / FY26 PO / Invoice / Payment Due / Receipt" refEl={refDev}   loading={loading} empty={!d?.project_pipeline?.some(r => r.project_type === 'Development')}  height={220} />
      </div>

      {snap?.created_at && (
        <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right', marginBottom: 8 }}>
          Snapshot #{snap.id} · {new Date(snap.created_at).toLocaleString('en-IN')}
        </div>
      )}
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

function ChartBox({ title, sub, refEl, loading, empty, emptyMsg, height = 240 }: {
  title: string; sub: string;
  refEl: React.RefObject<HTMLDivElement | null>;
  loading: boolean; empty: boolean; emptyMsg?: string; height?: number;
}) {
  const showOverlay = loading || empty;
  return (
    <div className="chart-box" style={{ marginBottom: 0 }}>
      <div className="ch-head">
        <div><div className="ch-title">{title}</div><div className="ch-sub">{sub}</div></div>
      </div>
      <div style={{ position: 'relative', height }}>

        {/* Overlay — loading spinner or empty state */}
        {showOverlay && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, background: '#fff' }}>
            {loading ? (
              <span style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</span>
            ) : (
              <div className="empty" style={{ padding: '24px 0' }}>
                <div className="empty-icon">📊</div>
                <div className="empty-title">{emptyMsg ?? 'No data yet'}</div>
                <div className="empty-sub">Upload a Weekly MIS file to populate</div>
              </div>
            )}
          </div>
        )}

        {/* Chart div is ALWAYS in the DOM — never conditionally unmounted.
            ECharts initialises once on mount; hiding it via visibility keeps
            the ref valid so setOption works the moment data arrives. */}
        <div
          ref={refEl}
          style={{ width: '100%', height: '100%', visibility: showOverlay ? 'hidden' : 'visible' }}
        />
      </div>
    </div>
  );
}
