import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import * as echarts from 'echarts';
import { exportExceptionReport, getReconSummary, getInsuranceCashCollected, getProviderSummary } from '../api';
import type { ReconStatus, ReconSummary, InsurancePayerBreakdownItem } from '../types';
import ExportDropdown from '../components/ExportDropdown';
import type { ExportSection } from '../components/ExportDropdown';
import {
  exportToExcel,
  exportToPdf,
  exportProviderWiseExcel,
  captureChartImages,
} from '../utils/exportUtils';
import type { KpiEntry, TableSheet, ExportFilterContext } from '../utils/exportUtils';

/* ═══════════════════ CONSTANTS ═══════════════════ */
const CURRENCY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

const FC = {
  accent:  '#2d7fc1',
  accentD: '#1a4a72',
  accent2: '#0d9e6e',
  accent3: '#d97706',
  green:   '#0d9e6e',
  amber:   '#d97706',
  red:     '#dc3545',
  purple:  '#6f42c1',
  cyan:    '#0891b2',
  text:    '#1a2332',
  text2:   '#4a5e78',
  text3:   '#8496ae',
  border:  '#d8e2ee',
} as const;

const PROVIDER_CHECKOUT_COLOR = '#004569';


const CHART_DIMS = {
  waterfall: { height: 248, grid: { top: 44, right: 28, bottom: 64, left: 68 } },
  barChart:  { height: 228, grid: { top: 14, right: 20, bottom: 40, left: 116 } },
  donut:     { height: 228 },
} as const;

const TOOLTIP_COMMON = { backgroundColor: '#fff', borderColor: FC.border, textStyle: { color: FC.text, fontSize: 12 }, extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,.08);border-radius:8px' };

/* ═══════════════════ UTILITIES ═══════════════════ */
const fmt = (n: number): string => CURRENCY_FORMAT.format(n);

const createResizeHandler = (charts: echarts.ECharts[]): (() => void) => {
  return () => { charts.forEach((ch) => { try { ch.resize(); } catch { /* silently ignore */ } }); };
};


/* ═══════════════════ DATE HELPERS ══════════════════════ */
function todayStr() { return new Date().toISOString().split('T')[0]; }
function weeksAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d.toISOString().split('T')[0];
}
/** Returns the ISO date string for the day before the given YYYY-MM-DD string. */
function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00'); // force local midnight parse
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/* ═══════════════════ COMPONENT ═════════════════════════════ */
export default function OperationalDashboard() {
  /* ── STATE ── */
  const [summary, setSummary] = useState<ReconSummary | null>(null);
  const [insuranceCashCollected, setInsuranceCashCollected] = useState(0);
  const [eraProcessedAmount,     setEraProcessedAmount]     = useState(0);
  const [payerBreakdown,         setPayerBreakdown]         = useState<InsurancePayerBreakdownItem[]>([]);
  /** Net balance of ALL records BEFORE the selected start_date — this is the Opening AR. */
  const [priorBalance,           setPriorBalance]           = useState(0);
  const [dateFrom, setDateFrom] = useState(() => weeksAgoStr(4));
  const [dateTo,   setDateTo]   = useState(() => todayStr());
  const [loading,  setLoading]  = useState(true);
  const [exporting, setExporting] = useState<'checkout_no_charge' | 'checkout_charge_no_era' | null>(null);

  // Export state
  const [exportLoading, setExportLoading] = useState(false);
  const [exportLoadingId, setExportLoadingId] = useState<string | null>(null);

  /* ── REFS ── */
  const refWaterfall = useRef<HTMLDivElement>(null);
  const refEraStatus = useRef<HTMLDivElement>(null);
  const chartsRef    = useRef<echarts.ECharts[]>([]);
  const resizeHandlerRef = useRef<(() => void) | null>(null);

  /* ── DERIVED VALUES ── */
  const countByStatus = (key: ReconStatus): number =>
    summary?.rows?.find((r) => r.status === key)?.count ?? 0;

  const { kpis, warnings, hasData } = useMemo(() => {
    const checkoutNoChargeCount    = countByStatus('checkout_no_charge');
    const checkoutChargeNoEraCount = countByStatus('checkout_charge_no_era');
    const checkoutChargeEraCount   = countByStatus('checkout_charge_era');

    const chargesGenerated = summary?.total_billed ?? 0;
    const cashCollected    = insuranceCashCollected;

    /*
     * AR Waterfall (timeline-based)
     * ─────────────────────────────────────────────
     *  Opening AR  = prior period's net outstanding balance
     *                (0 for the very first period on record)
     *  + Charges   = gross charges billed THIS period
     *  − Cash      = cash receipts collected THIS period
     *  = Outstanding AR  (ERA shown separately as context)
     *
     *  Formula:  Outstanding = Opening + Charges − Cash Collected
     */
    const openingAr     = priorBalance;
    const outstandingAr = Math.max(openingAr + chargesGenerated - cashCollected, 0);

    // Trend: show how much AR grew/shrank vs the opening balance
    const outstandingTrendUp = outstandingAr > openingAr;
    const trendDelta = openingAr > 0
      ? ((outstandingAr - openingAr) / openingAr) * 100
      : null;
    const outstandingTrendLabel = trendDelta !== null
      ? `${outstandingTrendUp ? '↑' : '↓'} ${Math.abs(trendDelta).toFixed(1)}% vs opening`
      : openingAr === 0 && outstandingAr > 0
        ? 'First period — no opening balance'
        : '—';

    const hasData = summary !== null && (summary.total_count ?? 0) > 0;

    return {
      kpis: {
        checkoutNoChargeCount,
        checkoutChargeNoEraCount,
        checkoutChargeEraCount,
        chargesGenerated,
        cashCollected,
        openingAr,
        outstandingAr,
        outstandingTrendUp,
        outstandingTrendLabel,
      },
      hasData,
      warnings: [
        checkoutNoChargeCount > 0 && {
          key: 'checkout_no_charge' as const,
          msg: `${checkoutNoChargeCount} checkout${checkoutNoChargeCount > 1 ? 's' : ''} without charge`,
        },
        checkoutChargeNoEraCount > 0 && {
          key: 'checkout_charge_no_era' as const,
          msg: `${checkoutChargeNoEraCount} charge${checkoutChargeNoEraCount > 1 ? 's' : ''} missing ERA`,
        },
      ].filter(Boolean) as Array<{ key: 'checkout_no_charge' | 'checkout_charge_no_era'; msg: string }>,
    };
  }, [summary, insuranceCashCollected, eraProcessedAmount, priorBalance]);



  /* ── EVENT HANDLERS ── */
  const loadSummaryAndRows = useCallback(async (start = dateFrom, end = dateTo): Promise<void> => {
    setLoading(true);
    try {
      /*
       * Fire three requests in parallel:
       *  1. Current period reconciliation summary
       *  2. Insurance / bank cash-collected for this period
       *  3. Prior period reconciliation summary (end_date = start - 1 day)
       *     → its total_balance becomes the Opening AR for the waterfall
       */
      const priorEndDate = start ? dayBefore(start) : undefined;

      const [summaryData, insuranceData, priorData] = await Promise.all([
        getReconSummary({ start_date: start || undefined, end_date: end || undefined }),
        getInsuranceCashCollected({ start_date: start || undefined, end_date: end || undefined }),
        // Only fetch prior if there is a start_date; otherwise Opening AR = 0 (all-time query)
        priorEndDate
          ? getReconSummary({ end_date: priorEndDate })
          : Promise.resolve(null),
      ]);

      setSummary(summaryData);
      setInsuranceCashCollected(
        insuranceData.cash_collected_mapped_amount || insuranceData.insurance_cash_collected || 0,
      );
      setEraProcessedAmount(insuranceData.era_processed_amount || 0);
      setPayerBreakdown(insuranceData.payer_breakdown || []);
      // Opening AR = net balance of everything before this period
      setPriorBalance(priorData?.total_balance ?? 0);
    } catch (error) {
      console.error('Failed to load reconciliation summary:', error);
      setSummary(null);
      setInsuranceCashCollected(0);
      setEraProcessedAmount(0);
      setPayerBreakdown([]);
      setPriorBalance(0);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  const handleApply = useCallback(() => { loadSummaryAndRows(); }, [loadSummaryAndRows]);

  const handleExportException = useCallback(async (statusKey: 'checkout_no_charge' | 'checkout_charge_no_era'): Promise<void> => {
    setExporting(statusKey);
    try {
      await exportExceptionReport({ status: statusKey, start_date: dateFrom || undefined, end_date: dateTo || undefined });
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(null);
    }
  }, [dateFrom, dateTo]);

  /* ── INITIALIZATION ── */
  useEffect(() => { void loadSummaryAndRows(); }, []);

  /* ── CHART RENDERING ── */
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      chartsRef.current.forEach((c) => { try { c.dispose(); } catch { /* ignore */ } });
      chartsRef.current = [];

      if (refWaterfall.current) renderWaterfallChart(refWaterfall.current, chartsRef.current);
      if (refEraStatus.current) renderEraChart(refEraStatus.current, kpis, chartsRef.current);

      resizeHandlerRef.current = createResizeHandler(chartsRef.current);
      window.addEventListener('resize', resizeHandlerRef.current);
    }, 0);

    return () => {
      clearTimeout(timer);
      if (resizeHandlerRef.current) window.removeEventListener('resize', resizeHandlerRef.current);
    };
  }, [loading, summary, payerBreakdown, kpis]);

  /* ── CHART RENDER FUNCTIONS ── */
  const renderWaterfallChart = (container: HTMLDivElement, chartsArray: echarts.ECharts[]): void => {
    const chart = echarts.init(container);
    chartsArray.push(chart);

    /*
     * Proper ECharts waterfall — 5 bars, stacked with a transparent placeholder
     *
     * Running totals:
     *   t0 = openingAr
     *   t1 = t0 + chargesGenerated
     *   t2 = t1 - eraProcessedAmount
     *   t3 = t2 - cashCollected  (= outstandingAr)
     */
    const t0 = kpis.openingAr;
    const t1 = t0 + kpis.chargesGenerated;
    const t2 = t1 - eraProcessedAmount;
    const t3 = t2 - kpis.cashCollected; // closing / outstanding AR

    const categories = [
      'Opening AR',
      'Billing in Period',
      'Payment Made',
      'Payment Received',
      'Closing AR',
    ];

    // Invisible placeholder bases
    const placeholders = [0, t0, t2, t3, 0];

    // Actual bar heights (always positive — direction comes from color + placeholder)
    const heights = [
      t0,                      // Opening AR  ↑ (increase from 0)
      kpis.chargesGenerated,   // Charges     ↑ (increase from t0)
      eraProcessedAmount,      // ERA         ↓ (decrease, bar sits from t2 to t1)
      kpis.cashCollected,      // Cash        ↓ (decrease, bar sits from t3 to t2)
      t3,                      // Closing AR  (total, from 0)
    ];

    // True values for tooltip
    const trueVals = [t0, kpis.chargesGenerated, -eraProcessedAmount, -kpis.cashCollected, t3];

    const barColors = [
      PROVIDER_CHECKOUT_COLOR,  // Opening AR   — solid dark navy
      PROVIDER_CHECKOUT_COLOR,  // Billing       — solid dark navy (positive)
      FC.red,                   // ERA Payments  — solid red (decrease)
      FC.red,                   // Cash Collected — solid red (decrease)
      PROVIDER_CHECKOUT_COLOR,  // Closing AR    — solid dark navy (total)
    ];

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 48, right: 20, bottom: 64, left: 72 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        ...TOOLTIP_COMMON,
        formatter: (params: any) => {
          const i = params[0]?.dataIndex ?? 0;
          const sign = trueVals[i] < 0 ? '−' : '';
          return `<div style="font-weight:700;margin-bottom:3px">${categories[i]}</div>${sign}${fmt(Math.abs(trueVals[i]))}`;
        },
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: FC.text2,
          fontSize: 10.5,
          fontWeight: 500,
          interval: 0,
          // wrap long labels
          formatter: (v: string) => v.replace(' ', '\n'),
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        // ── remove all horizontal grid lines ──
        splitLine: { show: false },
        axisLabel: {
          color: FC.text3,
          fontSize: 10,
          formatter: (v: number) =>
            v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`,
        },
      },
      series: [
        {
          // Transparent placeholder — lifts each bar to the right starting height
          name: '_placeholder',
          type: 'bar',
          stack: 'wf',
          silent: true,
          data: placeholders,
          itemStyle: { color: 'transparent' },
          barWidth: 42,
        },
        {
          // Actual visible bars
          name: 'AR',
          type: 'bar',
          stack: 'wf',
          barWidth: 42,
          data: heights.map((h, i) => ({
            value: h,
            itemStyle: {
              color: barColors[i],
              borderRadius: [5, 5, 0, 0],
            },
          })),
          label: {
            show: true,
            position: 'top',
            fontSize: 10.5,
            fontWeight: 700,
            color: FC.text2,
            formatter: (p: any) => {
              const v = trueVals[p.dataIndex];
              const sign = v < 0 ? '−' : '';
              return `${sign}${fmt(Math.abs(v))}`;
            },
          },
        },
      ],
    });
  };

  const renderEraChart = (container: HTMLDivElement, data: typeof kpis, chartsArray: echarts.ECharts[]): void => {
    const chart = echarts.init(container);
    chartsArray.push(chart);

    // ── Vertical Bar: Checkout → Charge → ERA status breakdown (left to right) ──
    const bars = [
      { name: 'Total Checkout', value: data.checkoutChargeEraCount + data.checkoutChargeNoEraCount + data.checkoutNoChargeCount, color: PROVIDER_CHECKOUT_COLOR },
      { name: 'Charged',        value: data.checkoutChargeEraCount + data.checkoutChargeNoEraCount, color: PROVIDER_CHECKOUT_COLOR },
      { name: 'ERA Approved',   value: data.checkoutChargeEraCount,   color: PROVIDER_CHECKOUT_COLOR },
      { name: 'Missing ERA',    value: data.checkoutChargeNoEraCount, color: FC.red },
    ];

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 28, right: 16, bottom: 48, left: 16, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        ...TOOLTIP_COMMON,
        formatter: (params: any) => {
          const p = params[0];
          return `<div style="font-weight:700">${p.name}</div>${p.value} visits`;
        },
      },
      xAxis: {
        type: 'category',
        data: bars.map((b) => b.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: FC.text2,
          fontSize: 10.5,
          fontWeight: 500,
          interval: 0,
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
      },
      series: [{
        type: 'bar',
        barWidth: 36,
        data: bars.map((b) => ({
          value: b.value,
          itemStyle: {
              color: b.color,
              borderRadius: [5, 5, 0, 0],
            },
        })),
        label: {
          show: true,
          position: 'top',
          color: FC.text2,
          fontSize: 11,
          fontWeight: 700,
          formatter: (p: any) => `${p.value}`,
        },
      }],
    });
  };


  /* ═══════════════════ EXPORT HELPERS ═══════════════════ */
  const CHART_TITLES_OD = ['AR Waterfall', 'Checkout–Charge–ERA Status'];

  function buildOdFilterContext(): ExportFilterContext {
    return {
      dashboardName: 'Operational Dashboard',
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };
  }

  function buildOdKpis(): KpiEntry[] {
    return [
      { label: 'Opening AR', value: fmt(kpis.openingAr) },
      { label: 'Charges Generated', value: fmt(kpis.chargesGenerated) },
      { label: 'Payment Made (ERA)', value: fmt(eraProcessedAmount) },
      { label: 'Payment Received (Cash)', value: fmt(kpis.cashCollected) },
      { label: 'Outstanding AR', value: fmt(kpis.outstandingAr), sub: kpis.outstandingTrendLabel },
      { label: 'Checkout (No Charge)', value: String(kpis.checkoutNoChargeCount) },
      { label: 'Charge (No ERA)', value: String(kpis.checkoutChargeNoEraCount) },
      { label: 'Charge + ERA', value: String(kpis.checkoutChargeEraCount) },
    ];
  }

  function buildPayerSheet(): TableSheet {
    const total = payerBreakdown.reduce((s, p) => s + p.cash_collected_mapped_amount, 0);
    return {
      sheetName: 'Payer Breakdown',
      headers: ['Insurance Payer', 'Amount Received', '% of Total'],
      rows: payerBreakdown.map((p) => [
        p.payer_name,
        p.cash_collected_mapped_amount,
        total > 0 ? `${((p.cash_collected_mapped_amount / total) * 100).toFixed(1)}%` : '0%',
      ]),
    };
  }

  function buildReconSheet(): TableSheet {
    return {
      sheetName: 'Recon Summary',
      headers: ['Status', 'Count', 'Billed', 'Paid', 'Balance'],
      rows: (summary?.rows ?? []).map((r) => [
        r.status, r.count, r.billed, r.paid, r.balance,
      ]),
    };
  }

  async function handleOdExportExcel(id: string) {
    setExportLoading(true);
    setExportLoadingId(id);
    try {
      await exportToExcel({
        filters: buildOdFilterContext(),
        kpis: buildOdKpis(),
        sheets: [buildPayerSheet(), buildReconSheet()],
      });
    } finally {
      setExportLoading(false);
      setExportLoadingId(null);
    }
  }

  async function handleOdExportPdf(id: string) {
    setExportLoading(true);
    setExportLoadingId(id);
    try {
      const chartImages = captureChartImages(chartsRef.current, CHART_TITLES_OD);
      const total = payerBreakdown.reduce((s, p) => s + p.cash_collected_mapped_amount, 0);
      exportToPdf({
        filters: buildOdFilterContext(),
        kpis: buildOdKpis(),
        charts: chartImages,
        tables: [
          {
            title: 'Insurance Payer Bank Receipts',
            headers: ['Payer', 'Amount Received', '% of Total'],
            rows: payerBreakdown.map((p) => [
              p.payer_name,
              fmt(p.cash_collected_mapped_amount),
              total > 0 ? `${((p.cash_collected_mapped_amount / total) * 100).toFixed(1)}%` : '0%',
            ]),
          },
        ],
      });
    } finally {
      setExportLoading(false);
      setExportLoadingId(null);
    }
  }

  async function handleOdProviderWise(id: string) {
    setExportLoading(true);
    setExportLoadingId(id);
    try {
      const provSummaries = await getProviderSummary();
      const providerData = provSummaries.map((ps) => ({
        name: ps.provider_name,
        kpis: [
          { label: 'Appointments', value: ps.appointment_count },
          { label: 'Billed', value: fmt(ps.billed) },
          { label: 'Paid', value: fmt(ps.paid) },
          { label: 'Collection Rate', value: `${ps.collection_rate.toFixed(1)}%` },
        ] as KpiEntry[],
        sheet: {
          sheetName: 'Summary',
          headers: ['Metric', 'Value'],
          rows: [
            ['Appointments', ps.appointment_count],
            ['Billed', ps.billed],
            ['Paid', ps.paid],
            ['Balance', ps.billed - ps.paid],
            ['Collection Rate', `${ps.collection_rate.toFixed(1)}%`],
          ],
        } as TableSheet,
      }));

      await exportProviderWiseExcel({
        filters: buildOdFilterContext(),
        providers: providerData,
      });
    } finally {
      setExportLoading(false);
      setExportLoadingId(null);
    }
  }

  async function handleOdAllProviders(id: string) {
    setExportLoading(true);
    setExportLoadingId(id);
    try {
      const provSummaries = await getProviderSummary();
      await exportToExcel({
        filters: { ...buildOdFilterContext(), providerName: 'All Providers' },
        kpis: buildOdKpis(),
        sheets: [
          {
            sheetName: 'Provider Summary',
            headers: ['Provider', 'Appointments', 'Billed', 'Paid', 'Balance', 'Collection Rate'],
            rows: provSummaries.map((ps) => [
              ps.provider_name,
              ps.appointment_count,
              ps.billed,
              ps.paid,
              ps.billed - ps.paid,
              `${ps.collection_rate.toFixed(1)}%`,
            ]),
          },
          buildPayerSheet(),
          buildReconSheet(),
        ],
        filename: `Operational_Dashboard_AllProviders_${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
    } finally {
      setExportLoading(false);
      setExportLoadingId(null);
    }
  }

  const exportSections: ExportSection[] = [
    {
      title: 'Current View',
      options: [
        { id: 'od-cv-excel', label: 'Excel (.xlsx)', icon: '📊', description: 'KPIs + payer table + recon', onClick: () => handleOdExportExcel('od-cv-excel') },
        { id: 'od-cv-pdf', label: 'PDF Report', icon: '📄', description: 'KPIs + charts + payer table', onClick: () => handleOdExportPdf('od-cv-pdf') },
      ],
    },
    {
      title: 'Provider-wise',
      options: [
        { id: 'od-pw-excel', label: 'Excel (.xlsx)', icon: '👥', description: 'One sheet per provider', onClick: () => handleOdProviderWise('od-pw-excel') },
      ],
    },
    {
      title: 'All Providers',
      options: [
        { id: 'od-all-excel', label: 'Excel (.xlsx)', icon: '📋', description: 'Combined data dump', onClick: () => handleOdAllProviders('od-all-excel') },
      ],
    },
  ];

  /* ── RENDER ── */

  return (
    <div className="od-root page-enter" role="main">

      {/* ── HEADER ── */}
      <div className="od-header">
        <div className="od-header-left">
          <div className="inline-daterange od-daterange" role="group" aria-label="Date range filter">
            <span className="idr-label">📅 Date range</span>
            <input type="date" className="fi-date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Start date" />
            <span className="idr-sep">to</span>
            <input type="date" className="fi-date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="End date" />
            <button className="fi-btn fi-btn-accent" onClick={handleApply} disabled={loading} aria-label="Apply date filter">
              {loading ? '⟳ Loading…' : 'Apply'}
            </button>
          </div>
        </div>
        <div className="od-header-right">
          <ExportDropdown
            sections={exportSections}
            disabled={loading}
            loading={exportLoading}
            loadingId={exportLoadingId}
          />
        </div>
      </div>

      {/* ── RECON STATUS STRIP ── */}
      {!loading && !hasData ? (
        <div className="od-status-strip od-status-strip--neutral" role="status">
          <span className="od-status-icon">○</span>
          <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
            No reconciliation data — upload appointments, charges &amp; ERA files then run reconciliation
          </span>
        </div>
      ) : (
        <ReconStatusStrip warnings={warnings} exporting={exporting} onExport={handleExportException} />
      )}

      {/* ── KPI FLOW ROW ── */}
      <div className="od-kpi-flow" aria-label="Financial KPI metrics">

        <OdKpiCard
          label="Opening AR"
          value={loading ? '' : fmt(kpis.openingAr)}
          sub=""
          emoji="📌"
          accent="blue"
          loading={loading}
        />
        <div className="od-kpi-op od-kpi-op-plus">+</div>
        <OdKpiCard
          label="Charges"
          value={loading ? '' : fmt(kpis.chargesGenerated)}
          sub=""
          emoji="🧾"
          accent="amber"
          loading={loading}
        />
        <div className="od-kpi-op od-kpi-op-minus">−</div>
        <OdKpiCard
          label="Payment Made"
          value={loading ? '' : fmt(eraProcessedAmount)}
          sub=""
          emoji="📨"
          accent="purple"
          loading={loading}
        />
        <div className="od-kpi-op od-kpi-op-minus">−</div>
        <OdKpiCard
          label="Payment Received"
          value={loading ? '' : fmt(kpis.cashCollected)}
          sub=""
          emoji="💵"
          accent="teal"
          loading={loading}
        />
        <div className="od-kpi-op od-kpi-op-eq">=</div>
        <OdKpiCard
          label="Outstanding AR"
          value={loading ? '' : fmt(kpis.outstandingAr)}
          sub={loading ? '' : kpis.outstandingTrendLabel}
          subVariant={kpis.outstandingTrendUp ? 'danger' : 'success'}
          emoji="🎯"
          accent={kpis.outstandingTrendUp ? 'red' : 'green'}
          loading={loading}
          outcome
        />
      </div>

      {/* ── WATERFALL ── */}
      <section aria-label="Account Receivable Waterfall Analysis" className="od-section">
        <SectionHeader icon="💧" label="Account Receivable Waterfall" />
        <div className="chart-box od-chart-box">
          <div className="od-chart-header">
            <div>
              <h3 className="ch-title">Account Receivable Flow Breakdown</h3>
              <p className="ch-sub">Opening → Billing → Payment Made → Payment Received → Closing</p>
            </div>
            {!loading && (
              <div className={`od-outcome-pill ${kpis.outstandingTrendUp ? 'od-outcome-pill--up' : 'od-outcome-pill--down'}`}>
                {kpis.outstandingTrendUp ? '↑ Account Receivable Growing' : '↓ Account Receivable Shrinking'}
              </div>
            )}
          </div>
          <div
            ref={refWaterfall}
            style={{ height: CHART_DIMS.waterfall.height, width: '100%', position: 'relative' }}
            className={loading ? 'ch-loading' : ''}
          >
            {!loading && kpis.chargesGenerated === 0 && kpis.openingAr === 0 && (
              <div className="ch-no-data">
                <div className="ch-no-data-icon">📊</div>
                <div className="ch-no-data-text">No financial data</div>
                <div className="ch-no-data-hint">Run reconciliation to populate this chart</div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── ERA STATUS ── */}
      <section aria-label="Checkout–Charge–ERA Status" className="od-section">
        <SectionHeader icon="📊" label="Checkout–Charge–ERA Status" />
        <div className="chart-box od-chart-box">
          <h3 className="ch-title">Checkout–Charge–ERA Status</h3>
          <p className="ch-sub">Reconciliation outcome distribution</p>
          <div
            ref={refEraStatus}
            style={{ height: CHART_DIMS.donut.height, width: '100%', position: 'relative' }}
            className={loading ? 'ch-loading' : ''}
          >
            {!loading && kpis.checkoutChargeEraCount === 0 && kpis.checkoutChargeNoEraCount === 0 && kpis.checkoutNoChargeCount === 0 && (
              <div className="ch-no-data">
                <div className="ch-no-data-icon">🔄</div>
                <div className="ch-no-data-text">No reconciliation data</div>
                <div className="ch-no-data-hint">Upload files and run reconciliation</div>
              </div>
            )}
          </div>
          {!loading && (
            <div className="od-era-counts">
              {kpis.checkoutChargeEraCount > 0 && (
                <span className="od-era-count od-era-count--green">
                  <span className="od-era-dot" style={{ background: FC.green }} />
                  {kpis.checkoutChargeEraCount} Approved
                </span>
              )}
              {kpis.checkoutChargeNoEraCount > 0 && (
                <span className="od-era-count od-era-count--amber">
                  <span className="od-era-dot" style={{ background: FC.amber }} />
                  {kpis.checkoutChargeNoEraCount} No ERA
                </span>
              )}
              {kpis.checkoutNoChargeCount > 0 && (
                <span className="od-era-count od-era-count--red">
                  <span className="od-era-dot" style={{ background: FC.red }} />
                  {kpis.checkoutNoChargeCount} No Charge
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── PAYER TABLE ── */}
      <PayerTable payers={payerBreakdown} />
    </div>
  );
}

/* ═════════════════════ SUB-COMPONENTS ═════════════════════ */

/* ── Section Header ── */
function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="od-section-header">
      <span className="od-section-icon">{icon}</span>
      <span className="od-section-label">{label}</span>
    </div>
  );
}

/* ── KPI Card ── */
interface OdKpiCardProps {
  label: string;
  value: string;
  sub: string;
  subVariant?: 'success' | 'danger';
  emoji: string;
  accent: 'blue' | 'amber' | 'purple' | 'teal' | 'green' | 'red';
  loading: boolean;
  outcome?: boolean;
}

function OdKpiCard({ label, value, sub, subVariant, emoji, accent, loading, outcome }: OdKpiCardProps) {
  return (
    <div className={`od-kpi-card od-kpi-card--${accent}${outcome ? ' od-kpi-card--outcome' : ''}`}>
      <div className="od-kpi-label">{label}</div>
      <div className={`od-kpi-val${loading ? ' skeleton' : ''}`}>{value || (loading ? '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0' : '—')}</div>
      {sub && (
        <div className={`od-kpi-sub${subVariant ? ` od-kpi-sub--${subVariant}` : ''}`}>{sub}</div>
      )}
      <div className="od-kpi-emoji">{emoji}</div>
    </div>
  );
}

/* ── Recon Status Strip (single line, conditional) ── */
interface ReconStatusStripProps {
  warnings: Array<{ key: 'checkout_no_charge' | 'checkout_charge_no_era'; msg: string }>;
  exporting: string | null;
  onExport: (key: 'checkout_no_charge' | 'checkout_charge_no_era') => Promise<void>;
}

function ReconStatusStrip({ warnings, exporting, onExport }: ReconStatusStripProps) {
  const hasNoCharge = warnings.some((w) => w.key === 'checkout_no_charge');
  const hasNoEra    = warnings.some((w) => w.key === 'checkout_charge_no_era');
  const allOk       = warnings.length === 0;

  return (
    <div
      className={`od-status-strip${allOk ? ' od-status-strip--ok' : ' od-status-strip--warn'}`}
      role="status"
      aria-live="polite"
    >
      {/* Left: icon */}
      <span className="od-status-icon">{allOk ? '✓' : '⚠'}</span>

      {/* Checkout vs Charge */}
      <StatusItem
        ok={!hasNoCharge}
        okLabel="Checkout vs Charge matched"
        warnLabel={warnings.find((w) => w.key === 'checkout_no_charge')?.msg ?? ''}
        warnKey="checkout_no_charge"
        exporting={exporting}
        onExport={onExport}
      />

      <span className="od-status-sep" />

      {/* ERA */}
      <StatusItem
        ok={!hasNoEra}
        okLabel="All ERA approved"
        warnLabel={warnings.find((w) => w.key === 'checkout_charge_no_era')?.msg ?? ''}
        warnKey="checkout_charge_no_era"
        exporting={exporting}
        onExport={onExport}
      />
    </div>
  );
}

interface StatusItemProps {
  ok: boolean;
  okLabel: string;
  warnLabel: string;
  warnKey: 'checkout_no_charge' | 'checkout_charge_no_era';
  exporting: string | null;
  onExport: (key: 'checkout_no_charge' | 'checkout_charge_no_era') => Promise<void>;
}

function StatusItem({ ok, okLabel, warnLabel, warnKey, exporting, onExport }: StatusItemProps) {
  if (ok) {
    return (
      <span className="od-status-item od-status-item--ok">
        <span className="od-status-dot od-status-dot--ok" />
        {okLabel}
      </span>
    );
  }
  return (
    <span className="od-status-item od-status-item--warn">
      <span className="od-status-dot od-status-dot--warn" />
      <span>{warnLabel}</span>
      <button
        className="od-status-dl"
        onClick={() => void onExport(warnKey)}
        disabled={exporting !== null}
        title="Download exception report"
        aria-label={`Download exception report for ${warnKey}`}
      >
        {exporting === warnKey ? '…' : '⬇ Export'}
      </button>
    </span>
  );
}

/* ── Payer Table ── */
function PayerTable({ payers }: { payers: InsurancePayerBreakdownItem[] }) {
  const total = payers.reduce((s, p) => s + p.cash_collected_mapped_amount, 0);
  return (
    <div className="card od-table-card" id="finance-table">
      <div className="c-head">
        <div>
          <h2 className="c-title">Insurance Payer Bank Receipts</h2>
          <p className="c-sub">Amount received from bank, mapped to insurance payer</p>
        </div>
        {payers.length > 0 && (
          <div className="od-table-total">
            <span className="od-table-total-label">Total</span>
            <span className="od-table-total-val">{CURRENCY_FORMAT.format(total)}</span>
          </div>
        )}
      </div>
      <div className="tbl-wrap">
        <table className="tbl-fin" role="table" aria-label="Insurance payer bank receipts">
          <thead>
            <tr>
              <th scope="col">Insurance Payer</th>
              <th scope="col">Amount Received</th>
            </tr>
          </thead>
          <tbody>
            {payers.length === 0 ? (
              <tr>
                <td colSpan={2}>
                  <div className="tbl-empty-state">
                    <div className="tbl-empty-icon">🏦</div>
                    <div className="tbl-empty-title">No bank receipts mapped</div>
                    <div className="tbl-empty-sub">Upload a bank statement to see insurance cash receipts mapped to payers for the selected date range</div>
                  </div>
                </td>
              </tr>
            ) : (
              payers.map((payer) => {
                const pct = total > 0 ? (payer.cash_collected_mapped_amount / total) * 100 : 0;
                return (
                  <tr key={payer.payer_name}>
                    <td>
                      <div className="od-payer-cell">
                        <span className="bold">{payer.payer_name}</span>
                        <div className="od-payer-bar-wrap">
                          <div className="od-payer-bar" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="mono">{CURRENCY_FORMAT.format(payer.cash_collected_mapped_amount)}</span>
                      <span className="od-payer-pct">{pct.toFixed(1)}%</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}