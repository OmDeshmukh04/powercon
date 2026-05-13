import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import * as echarts from 'echarts';
import {
  exportExceptionReport,
  getReconSummary,
  getReconAging,
  getInsuranceCashCollected,
  getProviderSummary,
  fetchAppointmentsAllPages,
  fetchChargesAllPages,
  normalizeAppointmentStatus,
} from '../api';
import type {
  ReconStatus,
  ReconSummary,
  ReconAgingBucketItem,
  InsurancePayerBreakdownItem,
  Appointment,
} from '../types';
import ExportDropdown from '../components/ExportDropdown';
import type { ExportSection } from '../components/ExportDropdown';
import {
  exportToExcel,
  exportToPdf,
  exportProviderWiseExcel,
  captureChartImages,
} from '../utils/exportUtils';
import type { KpiEntry, TableSheet, ExportFilterContext } from '../utils/exportUtils';

/* ═══════════════════ CONSTANTS (aligned with Provider Dashboard) ═══════════════════ */
const CURRENCY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

const EC = {
  text: '#1a2332',
  text3: '#46433f',
  border: '#3a4a5d',
  accent: '#004569',
  accent2: '#05a9a9',
  accent3: '#3d79b8',
  success: '#2ECC71',
  warning: '#2563EB',
  danger: '#0b5f97',
  purple: '#480590',
  accentLight: '#5db1b1',
  grey: '#ab5656',
  /** Negative / payment step — matches Provider status waterfall */
  wfNeg: '#f87171',
} as const;

const PROVIDER_STATUS_COLORS = [EC.accent, EC.danger, EC.purple, EC.accent2, EC.accent3];
const CHART_AXIS_MUTED = '#9ca3af';

/** Slider + drag zoom — same pattern as Provider Dashboard bar charts */
const CHART_DATA_ZOOM = [
  { type: 'slider' as const, bottom: 4, height: 16, borderColor: EC.border, fillerColor: 'rgba(1,69,105,.08)', handleStyle: { color: EC.accent }, labelFormatter: '' },
  { type: 'inside' as const },
];

/** Grid: room for dataZoom slider (Provider monthly checkouts style) */
const OD_BAR_GRID = { top: 28, right: 14, bottom: 52, left: 40 };

const AR_AGING_BUCKET_ORDER = ['0-15', '15-30', '30-45', '45-60', '60+'] as const;

const CHART_DIMS = {
  waterfall: { height: 248, grid: { top: 44, right: 28, bottom: 64, left: 68 } },
  barChart:  { height: 228, grid: { top: 14, right: 20, bottom: 40, left: 116 } },
  donut:     { height: 228 },
  /** Pie-of-pie (Provider Hours) + horizontal AR aging */
  horizontal: { height: 268 },
  /** Chart area height; names live in adjacent HTML list */
  pieOfPie: { height: 340 },
} as const;

const TOOLTIP_COMMON = { backgroundColor: '#fff', borderColor: EC.border, textStyle: { color: EC.text, fontSize: 12 }, extraCssText: 'box-shadow:0 4px 16px rgba(0,0,0,.08);border-radius:8px' };

/* ═══════════════════ UTILITIES ═══════════════════ */
const fmt = (n: number): string => CURRENCY_FORMAT.format(n);

function fmtCount(n: number): string {
  return Math.round(n).toLocaleString();
}

function mergeArAgingBuckets(rows: ReconAgingBucketItem[]): ReconAgingBucketItem[] {
  const map = new Map(rows.map((r) => [r.bucket, r]));
  return AR_AGING_BUCKET_ORDER.map((key) => {
    const r = map.get(key);
    return {
      bucket: key,
      count: r?.count ?? 0,
      billed: r?.billed ?? 0,
      balance: r?.balance ?? 0,
    };
  });
}

/** Sorted provider → appointment counts for side list (matches pie segments order / colors). */
function buildProviderAppointmentBreakdown(
  appointments: Appointment[],
): Array<{ name: string; count: number; pct: number }> {
  const counts = new Map<string, number>();
  for (const a of appointments) {
    const name = (a.provider_name || 'Unknown').trim() || 'Unknown';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return [];
  return sorted.map(([name, count]) => ({
    name,
    count,
    pct: (count / total) * 100,
  }));
}

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

  // New chart data states
  const [appointmentsData, setAppointmentsData] = useState<Appointment[]>([]);
  const [chargesData, setChargesData] = useState<any[]>([]);
  const [providersList, setProvidersList] = useState<string[]>([]);
  const [arAgingBuckets, setArAgingBuckets] = useState<ReconAgingBucketItem[]>([]);

  /* ── REFS ── */
  const refWaterfall = useRef<HTMLDivElement>(null);
  const refEraStatus = useRef<HTMLDivElement>(null);
  const refEncountersWeekly = useRef<HTMLDivElement>(null);
  const refEncountersMonthly = useRef<HTMLDivElement>(null);
  const refNewPatientsWeekly = useRef<HTMLDivElement>(null);
  const refNewPatientsMonthly = useRef<HTMLDivElement>(null);
  const refProviderHours = useRef<HTMLDivElement>(null);
  const refArAging = useRef<HTMLDivElement>(null);
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
    // Payment Received = total ERA payments collected
    // insuranceCashCollected (bank cash) is kept in state but not used in formula for now
    const paymentReceived = eraProcessedAmount;

    /*
     * AR Waterfall (timeline-based)
     * ─────────────────────────────────────────────
     *  Opening AR  = prior period's net outstanding balance
     *                (0 for the very first period on record)
     *  + Charges   = gross charges billed THIS period
     *  − Payment Received = total ERA payments collected THIS period
     *  = Outstanding AR
     *
     *  Formula:  Outstanding = Opening + Charges − ERA Collected
     */
    const openingAr     = priorBalance;
    const outstandingAr = Math.max(openingAr + chargesGenerated - paymentReceived, 0);

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
        paymentReceived,
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

  const arAgingIsEmpty = useMemo(() => {
    const m = mergeArAgingBuckets(arAgingBuckets);
    return m.every((b) => b.count === 0 && Math.abs(b.balance) < 0.01);
  }, [arAgingBuckets]);

  const providerHoursBreakdown = useMemo(
    () => buildProviderAppointmentBreakdown(appointmentsData),
    [appointmentsData],
  );


  /* ── EVENT HANDLERS ── */
  const loadSummaryAndRows = useCallback(async (start = dateFrom, end = dateTo): Promise<void> => {
    setLoading(true);
    try {
      /*
       * Fire multiple requests in parallel:
       *  1. Current period reconciliation summary
       *  2. Insurance / bank cash-collected for this period
       *  3. Prior period reconciliation summary (end_date = start - 1 day)
       *     → its total_balance becomes the Opening AR for the waterfall
       *  4. Appointments data for encounter charts
       *  5. Charges data for new patient analysis
       */
      const priorEndDate = start ? dayBefore(start) : undefined;

      const [summaryData, insuranceData, priorData, appointmentsList, chargesList, agingRows] = await Promise.all([
        getReconSummary({ start_date: start || undefined, end_date: end || undefined }),
        getInsuranceCashCollected({ start_date: start || undefined, end_date: end || undefined }),
        // Only fetch prior if there is a start_date; otherwise Opening AR = 0 (all-time query)
        priorEndDate
          ? getReconSummary({ end_date: priorEndDate })
          : Promise.resolve(null),
        fetchAppointmentsAllPages({ date_from: start || undefined, date_to: end || undefined }),
        fetchChargesAllPages({ date_from: start || undefined, date_to: end || undefined }),
        getReconAging({ start_date: start || undefined, end_date: end || undefined }),
      ]);

      setSummary(summaryData);
      setInsuranceCashCollected(
        insuranceData.cash_collected_mapped_amount || insuranceData.insurance_cash_collected || 0,
      );
      setEraProcessedAmount(insuranceData.era_processed_amount || 0);
      setPayerBreakdown(insuranceData.payer_breakdown || []);
      // Opening AR = net balance of everything before this period
      setPriorBalance(priorData?.total_balance ?? 0);
      
      setAppointmentsData(appointmentsList);
      setChargesData(chargesList);
      setArAgingBuckets(agingRows);

      const providers = Array.from(new Set(appointmentsList.map((a: any) => a.provider_name).filter(Boolean))) as string[];
      setProvidersList(providers);
    } catch (error) {
      console.error('Failed to load reconciliation summary:', error);
      // Log additional details for debugging
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
      }
      setSummary(null);
      setInsuranceCashCollected(0);
      setEraProcessedAmount(0);
      setPayerBreakdown([]);
      setPriorBalance(0);
      setAppointmentsData([]);
      setChargesData([]);
      setProvidersList([]);
      setArAgingBuckets([]);
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
    
    let mounted = true;
    const timer = setTimeout(() => {
      if (!mounted) return;
      
      // Safely dispose all existing charts
      chartsRef.current.forEach((c) => {
        try {
          if (c && !c.isDisposed()) {
            c.dispose();
          }
        } catch (e) {
          // Silently ignore disposal errors
        }
      });
      chartsRef.current = [];

      // Render new charts only if containers still exist
      if (mounted) {
        if (refWaterfall.current) renderWaterfallChart(refWaterfall.current, chartsRef.current);
        if (refEraStatus.current) renderEraChart(refEraStatus.current, kpis, chartsRef.current);
        if (refEncountersWeekly.current) renderEncountersWeekly(refEncountersWeekly.current, appointmentsData, chartsRef.current);
        if (refEncountersMonthly.current) renderEncountersMonthly(refEncountersMonthly.current, appointmentsData, chartsRef.current);
        if (refNewPatientsWeekly.current) renderNewPatientsWeekly(refNewPatientsWeekly.current, chargesData, chartsRef.current);
        if (refNewPatientsMonthly.current) renderNewPatientsMonthly(refNewPatientsMonthly.current, chargesData, chartsRef.current);
        if (refProviderHours.current) renderProviderHours(refProviderHours.current, appointmentsData, chartsRef.current);
        if (refArAging.current) renderArAging(refArAging.current, arAgingBuckets, chartsRef.current);

        resizeHandlerRef.current = createResizeHandler(chartsRef.current);
        window.addEventListener('resize', resizeHandlerRef.current);
      }
    }, 0);

    return () => {
      mounted = false;
      clearTimeout(timer);
      if (resizeHandlerRef.current) window.removeEventListener('resize', resizeHandlerRef.current);
      // Don't dispose charts on unmount - React will handle DOM cleanup
    };
  }, [loading, summary, payerBreakdown, kpis, appointmentsData, chargesData, arAgingBuckets]);

  /* ── CHART RENDER FUNCTIONS ── */
  const renderWaterfallChart = (container: HTMLDivElement, chartsArray: echarts.ECharts[]): void => {
    const chart = echarts.init(container);
    chartsArray.push(chart);

    /*
     * Proper ECharts waterfall — 4 bars, stacked with a transparent placeholder
     *
     * Running totals:
     *   t0 = openingAr
     *   t1 = t0 + chargesGenerated
     *   t2 = t1 - paymentReceived (ERA total)  → closing / outstanding AR
     */
    const t0 = kpis.openingAr;
    const t1 = t0 + kpis.chargesGenerated;
    const t2 = t1 - kpis.paymentReceived; // closing / outstanding AR

    const categories = [
      'Opening AR',
      'Billing in Period',
      'Payment Received',
      'Closing AR',
    ];

    // Invisible placeholder bases
    const placeholders = [0, t0, t2, 0];

    // Actual bar heights (always positive — direction comes from color + placeholder)
    const heights = [
      t0,                       // Opening AR       ↑ (increase from 0)
      kpis.chargesGenerated,    // Charges          ↑ (increase from t0)
      kpis.paymentReceived,     // Payment Received ↓ (decrease, ERA total)
      t2,                       // Closing AR  (total, from 0)
    ];

    // True values for tooltip
    const trueVals = [t0, kpis.chargesGenerated, -kpis.paymentReceived, t2];

    const barColors = [
      EC.accent,
      EC.accent,
      EC.wfNeg,
      EC.accent,
    ];

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 48, right: 20, bottom: 64, left: 72 },
      dataZoom: CHART_DATA_ZOOM,
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
          color: CHART_AXIS_MUTED,
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
          color: CHART_AXIS_MUTED,
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
            color: EC.text,
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

    const charged = data.checkoutChargeEraCount + data.checkoutChargeNoEraCount;
    const pieData = [
      { name: 'Charges', value: charged, itemStyle: { color: EC.accent } },
      { name: 'ERA Approved', value: data.checkoutChargeEraCount, itemStyle: { color: EC.accent2 } },
      { name: 'Missing ERA', value: data.checkoutChargeNoEraCount, itemStyle: { color: EC.danger } },
    ];

    chart.setOption({
      backgroundColor: 'transparent',
      color: [EC.accent, EC.accent2, EC.danger],
      tooltip: {
        trigger: 'item',
        ...TOOLTIP_COMMON,
        formatter: (p: any) => `<div style="font-weight:700">${p.name}</div>${p.value}`,
      },
      legend: { bottom: 0, textStyle: { color: CHART_AXIS_MUTED, fontSize: 11 } },
      series: [
        {
          type: 'pie',
          radius: ['46%', '74%'],
          center: ['50%', '45%'],
          data: pieData,
          label: { formatter: '{b}: {c}', color: EC.text, fontSize: 11 },
          labelLine: { length: 8, length2: 8 },
          emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,.2)' } },
        },
      ],
    });
  };

  /* ═══════════════════ NEW CHART FUNCTIONS ═══════════════════ */

  const renderEncountersWeekly = (container: HTMLDivElement, appointments: Appointment[], chartsArray: echarts.ECharts[]): void => {
    try {
      if (!container || !appointments.length) return;
      const chart = echarts.init(container, null, { renderer: 'canvas' });
      chartsArray.push(chart);

      const weeklyTotals = new Map<string, number>();
      for (const appt of appointments) {
        if (!appt.appt_date || normalizeAppointmentStatus(appt.status) !== 'checked_out') continue;
        const date = new Date(`${appt.appt_date}T12:00:00`);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        const weekKey = weekStart.toISOString().split('T')[0];
        weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) || 0) + 1);
      }

      const weeks = Array.from(weeklyTotals.keys()).sort();
      const values = weeks.map((w) => weeklyTotals.get(w) || 0);

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', ...TOOLTIP_COMMON },
        grid: OD_BAR_GRID,
        dataZoom: CHART_DATA_ZOOM,
        xAxis: {
          type: 'category',
          data: weeks,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: CHART_AXIS_MUTED, fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: CHART_AXIS_MUTED, fontSize: 10 },
        },
        series: [
          {
            name: 'Checkouts',
            type: 'bar',
            data: values,
            itemStyle: { color: EC.accent, borderRadius: [5, 5, 0, 0] },
            barMaxWidth: 36,
            label: {
              show: true,
              position: 'top',
              color: EC.text,
              fontSize: 10,
              fontWeight: 700,
              formatter: (p: any) => fmtCount(Number(p.value ?? 0)),
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering encounters weekly chart:', error);
    }
  };

  const renderEncountersMonthly = (container: HTMLDivElement, appointments: Appointment[], chartsArray: echarts.ECharts[]): void => {
    try {
      if (!container || !appointments.length) return;
      const chart = echarts.init(container, null, { renderer: 'canvas' });
      chartsArray.push(chart);

      const monthlyTotals = new Map<string, number>();
      for (const appt of appointments) {
        if (!appt.appt_date || normalizeAppointmentStatus(appt.status) !== 'checked_out') continue;
        const date = new Date(`${appt.appt_date}T12:00:00`);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) || 0) + 1);
      }

      const months = Array.from(monthlyTotals.keys()).sort();
      const values = months.map((m) => monthlyTotals.get(m) || 0);

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', ...TOOLTIP_COMMON },
        grid: OD_BAR_GRID,
        dataZoom: CHART_DATA_ZOOM,
        xAxis: {
          type: 'category',
          data: months,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: CHART_AXIS_MUTED, fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: CHART_AXIS_MUTED, fontSize: 10 },
        },
        series: [
          {
            name: 'Checkouts',
            type: 'bar',
            data: values,
            itemStyle: { color: EC.accent, borderRadius: [5, 5, 0, 0] },
            barMaxWidth: 36,
            label: {
              show: true,
              position: 'top',
              color: EC.text,
              fontSize: 10,
              fontWeight: 700,
              formatter: (p: any) => fmtCount(Number(p.value ?? 0)),
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering encounters monthly chart:', error);
    }
  };

  const renderNewPatientsWeekly = (container: HTMLDivElement, charges: any[], chartsArray: echarts.ECharts[]): void => {
    try {
      if (!container || !charges.length) return;
      const chart = echarts.init(container, null, { renderer: 'canvas' });
      chartsArray.push(chart);

      const weeklyTotals = new Map<string, number>();
      for (const charge of charges) {
        if (charge.cpt_code !== '90791' || !charge.service_date) continue;
        const date = new Date(`${charge.service_date}T12:00:00`);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        const weekKey = weekStart.toISOString().split('T')[0];
        weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) || 0) + 1);
      }

      const weeks = Array.from(weeklyTotals.keys()).sort();
      const values = weeks.map((w) => weeklyTotals.get(w) || 0);

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', ...TOOLTIP_COMMON },
        grid: OD_BAR_GRID,
        dataZoom: CHART_DATA_ZOOM,
        xAxis: {
          type: 'category',
          data: weeks,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: CHART_AXIS_MUTED, fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: CHART_AXIS_MUTED, fontSize: 10 },
        },
        series: [
          {
            name: 'New patients',
            type: 'bar',
            data: values,
            itemStyle: { color: EC.accent, borderRadius: [5, 5, 0, 0] },
            barMaxWidth: 36,
            label: {
              show: true,
              position: 'top',
              color: EC.text,
              fontSize: 10,
              fontWeight: 700,
              formatter: (p: any) => fmtCount(Number(p.value ?? 0)),
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering new patients weekly chart:', error);
    }
  };

  const renderNewPatientsMonthly = (container: HTMLDivElement, charges: any[], chartsArray: echarts.ECharts[]): void => {
    try {
      if (!container || !charges.length) return;
      const chart = echarts.init(container, null, { renderer: 'canvas' });
      chartsArray.push(chart);

      const monthlyTotals = new Map<string, number>();
      for (const charge of charges) {
        if (charge.cpt_code !== '90791' || !charge.service_date) continue;
        const date = new Date(`${charge.service_date}T12:00:00`);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyTotals.set(monthKey, (monthlyTotals.get(monthKey) || 0) + 1);
      }

      const months = Array.from(monthlyTotals.keys()).sort();
      const values = months.map((m) => monthlyTotals.get(m) || 0);

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', ...TOOLTIP_COMMON },
        grid: OD_BAR_GRID,
        dataZoom: CHART_DATA_ZOOM,
        xAxis: {
          type: 'category',
          data: months,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: CHART_AXIS_MUTED, fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { color: CHART_AXIS_MUTED, fontSize: 10 },
        },
        series: [
          {
            name: 'New patients',
            type: 'bar',
            data: values,
            itemStyle: { color: EC.accent, borderRadius: [5, 5, 0, 0] },
            barMaxWidth: 36,
            label: {
              show: true,
              position: 'top',
              color: EC.text,
              fontSize: 10,
              fontWeight: 700,
              formatter: (p: any) => fmtCount(Number(p.value ?? 0)),
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering new patients monthly chart:', error);
    }
  };

  const renderProviderHours = (container: HTMLDivElement, appointments: Appointment[], chartsArray: echarts.ECharts[]): void => {
    try {
      if (!container || !appointments.length) return;
      const chart = echarts.init(container, null, { renderer: 'canvas' });
      chartsArray.push(chart);

      const counts = new Map<string, number>();
      for (const appt of appointments) {
        const name = (appt.provider_name || 'Unknown').trim() || 'Unknown';
        counts.set(name, (counts.get(name) || 0) + 1);
      }

      const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
      const total = sorted.reduce((s, [, v]) => s + v, 0);
      if (total <= 0) return;

      const topN = 4;
      const hasRest = sorted.length > topN;
      const mainSlices = hasRest ? sorted.slice(0, topN) : sorted;
      const rest = hasRest ? sorted.slice(topN) : [];
      const otherSum = rest.reduce((s, [, v]) => s + v, 0);

      const mainData = mainSlices.map(([name, value], i) => ({
        name,
        value,
        itemStyle: { color: PROVIDER_STATUS_COLORS[i % PROVIDER_STATUS_COLORS.length] },
      }));
      if (hasRest && otherSum > 0) {
        mainData.push({
          name: 'Other',
          value: otherSum,
          itemStyle: { color: EC.grey },
        });
      }

      const tooltipFmt = (p: any) => {
        const pct = total ? ((Number(p.value) / total) * 100).toFixed(1) : '0';
        return `<div style="font-weight:700">${p.name}</div>${fmtCount(Number(p.value))} (${pct}%)`;
      };

      /* Labels live in HTML beside chart — avoids overlap between pies / under charts */
      const pieEmphasis = { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,.15)' } };

      const sliceBorder = {
        borderColor: '#fff',
        borderWidth: 2,
        borderRadius: 3,
      };

      const emptyLabel = { show: false };
      const emptyLabelLine = { show: false };

      if (!hasRest) {
        chart.setOption({
          backgroundColor: 'transparent',
          color: PROVIDER_STATUS_COLORS,
          tooltip: { trigger: 'item', ...TOOLTIP_COMMON, formatter: tooltipFmt },
          series: [
            {
              name: 'Appointments',
              type: 'pie',
              radius: ['42%', '70%'],
              center: ['50%', '50%'],
              padAngle: 1,
              data: mainData.map((d) => ({
                ...d,
                itemStyle: { ...d.itemStyle, ...sliceBorder },
              })),
              label: emptyLabel,
              labelLine: emptyLabelLine,
              emphasis: pieEmphasis,
            },
          ],
        });
        return;
      }

      const subData = rest.map(([name, value], i) => ({
        name: name.length > 20 ? `${name.slice(0, 18)}…` : name,
        value,
        itemStyle: { color: PROVIDER_STATUS_COLORS[(i + 1) % PROVIDER_STATUS_COLORS.length] },
      }));

      chart.setOption({
        backgroundColor: 'transparent',
        color: PROVIDER_STATUS_COLORS,
        tooltip: { trigger: 'item', ...TOOLTIP_COMMON, formatter: tooltipFmt },
        series: [
          {
            name: 'All providers',
            type: 'pie',
            radius: [0, '50%'],
            center: ['36%', '50%'],
            padAngle: 1,
            data: mainData.map((d) => ({
              ...d,
              itemStyle: { ...d.itemStyle, ...sliceBorder },
            })),
            label: emptyLabel,
            labelLine: emptyLabelLine,
            emphasis: pieEmphasis,
          },
          {
            name: 'Other detail',
            type: 'pie',
            radius: [0, '38%'],
            center: ['72%', '50%'],
            padAngle: 1,
            data: subData.map((d) => ({
              ...d,
              itemStyle: { ...d.itemStyle, ...sliceBorder },
            })),
            label: emptyLabel,
            labelLine: emptyLabelLine,
            emphasis: pieEmphasis,
          },
        ],
        graphic: [
          {
            type: 'line',
            shape: { x1: 0, y1: 0, x2: 36, y2: 0 },
            style: { stroke: EC.border, lineWidth: 1.5 },
            left: '54%',
            top: '50%',
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering provider hours chart:', error);
    }
  };

  const renderArAging = (container: HTMLDivElement, rows: ReconAgingBucketItem[], chartsArray: echarts.ECharts[]): void => {
    try {
      if (!container) return;
      const merged = mergeArAgingBuckets(rows);
      const totalBal = merged.reduce((s, b) => s + b.balance, 0);
      const totalCt = merged.reduce((s, b) => s + b.count, 0);
      if (totalBal === 0 && totalCt === 0) return;

      const chart = echarts.init(container, null, { renderer: 'canvas' });
      chartsArray.push(chart);

      const categories = merged.map((b) => b.bucket);
      const balances = merged.map((b) => b.balance);

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          ...TOOLTIP_COMMON,
          formatter: (params: any) => {
            const p = Array.isArray(params) ? params[0] : params;
            const i = p?.dataIndex ?? 0;
            const row = merged[i];
            return `<div style="font-weight:700">${row.bucket}</div>`
              + `${fmt(row.balance)} outstanding<br/><span style="color:${CHART_AXIS_MUTED};font-size:11px">${row.count} claims</span>`;
          },
        },
        grid: { left: 52, right: 24, top: 8, bottom: 8 },
        xAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: CHART_AXIS_MUTED,
            fontSize: 10,
            formatter: (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`),
          },
        },
        yAxis: {
          type: 'category',
          data: categories,
          inverse: true,
          axisLine: { show: true, lineStyle: { color: EC.border } },
          axisTick: { show: false },
          axisLabel: { color: EC.text, fontSize: 11 },
        },
        series: [
          {
            type: 'bar',
            data: balances.map((bal, i) => ({
              value: bal,
              itemStyle: {
                color: PROVIDER_STATUS_COLORS[i % PROVIDER_STATUS_COLORS.length],
                borderRadius: [0, 4, 4, 0],
              },
            })),
            barMaxWidth: 28,
            label: {
              show: true,
              position: 'insideLeft',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              formatter: (p: any) => {
                const v = Number(p.value ?? 0);
                return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : fmt(v);
              },
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering AR aging chart:', error);
    }
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
      { label: 'Payment Received (ERA)', value: fmt(kpis.paymentReceived) },
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
      const provSummaries = await getProviderSummary({
        start_date: dateFrom || undefined,
        end_date: dateTo || undefined,
      });
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
      const provSummaries = await getProviderSummary({
        start_date: dateFrom || undefined,
        end_date: dateTo || undefined,
      });
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
        <ReconStatusStrip
          warnings={warnings}
          exporting={exporting}
          onExport={handleExportException}
          mismatchPercent={
            (() => {
              const totalClaimed = kpis.checkoutChargeEraCount + kpis.checkoutChargeNoEraCount;
              if (!totalClaimed) return 0;
              return (kpis.checkoutChargeNoEraCount / totalClaimed) * 100;
            })()
          }
        />
      )}

      {/* ── KPI ROW (Provider Dashboard card style) ── */}
      <div
        className="kpi-row od-financial-kpis"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, marginBottom: 18 }}
        aria-label="Financial KPI metrics"
      >
        <div className="kpi-card c-blue">
          <div className="kpi-label">Opening AR</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{loading ? '\u00A0' : fmt(kpis.openingAr)}</div>
          <div className="kpi-sub">Period start balance</div>
          <div className="kpi-emoji">📌</div>
        </div>
        <div className="kpi-card c-amber">
          <div className="kpi-label">Charges</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{loading ? '\u00A0' : fmt(kpis.chargesGenerated)}</div>
          <div className="kpi-sub">Billed in range</div>
          <div className="kpi-emoji">🧾</div>
        </div>
        <div className="kpi-card c-teal">
          <div className="kpi-label">Payment Received</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{loading ? '\u00A0' : fmt(kpis.paymentReceived)}</div>
          <div className="kpi-sub">ERA total</div>
          <div className="kpi-emoji">💵</div>
        </div>
        <div className={`kpi-card ${kpis.outstandingTrendUp ? 'c-red' : 'c-green'}`}>
          <div className="kpi-label">Outstanding AR</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{loading ? '\u00A0' : fmt(kpis.outstandingAr)}</div>
          <div
            className={`kpi-sub${
              !loading && kpis.outstandingTrendLabel && kpis.outstandingTrendLabel !== '—'
                ? kpis.outstandingTrendUp
                  ? ' dn'
                  : ' up'
                : ''
            }`}
          >
            {!loading ? kpis.outstandingTrendLabel : '—'}
          </div>
          <div className="kpi-emoji">🎯</div>
        </div>
      </div>

      {/* ── AR WATERFALL + CHECKOUT–CHARGE–ERA PIE (single row) ── */}
      <section
        aria-label="Account receivable waterfall and checkout ERA coverage"
        className="od-section"
      >
        <div className="charts-2col" style={{ alignItems: 'stretch' }}>
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

          <div className="chart-box od-chart-box">
            <h3 className="ch-title">Checkout–Charge–ERA Pie</h3>
            <p className="ch-sub">Charges vs ERA approval coverage</p>
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
                {(kpis.checkoutChargeEraCount + kpis.checkoutChargeNoEraCount) > 0 && (
                  <span className="od-era-count od-era-count--blue">
                    <span className="od-era-dot" style={{ background: EC.accent }} />
                    {kpis.checkoutChargeEraCount + kpis.checkoutChargeNoEraCount} Charges
                  </span>
                )}
                {kpis.checkoutChargeEraCount > 0 && (
                  <span className="od-era-count od-era-count--green">
                    <span className="od-era-dot" style={{ background: EC.accent2 }} />
                    {kpis.checkoutChargeEraCount} Approved
                  </span>
                )}
                {kpis.checkoutChargeNoEraCount > 0 && (
                  <span className="od-era-count od-era-count--amber">
                    <span className="od-era-dot" style={{ background: EC.danger }} />
                    {kpis.checkoutChargeNoEraCount} No ERA
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── ENCOUNTERS WEEKLY + MONTHLY (2-column row) ── */}
      <section
        aria-label="Weekly and monthly encounter metrics"
        className="od-section"
      >
        <div className="charts-2col" style={{ alignItems: 'stretch' }}>
          <div className="chart-box od-chart-box">
            <h3 className="ch-title">Encounters Weekly</h3>
            <p className="ch-sub">Total checkouts per week (all providers)</p>
            <div
              ref={refEncountersWeekly}
              style={{ height: CHART_DIMS.barChart.height, width: '100%', position: 'relative' }}
              className={loading ? 'ch-loading' : ''}
            >
              {!loading && appointmentsData.length === 0 && (
                <div className="ch-no-data">
                  <div className="ch-no-data-icon">📋</div>
                  <div className="ch-no-data-text">No encounter data</div>
                  <div className="ch-no-data-hint">Upload appointments to see weekly encounters</div>
                </div>
              )}
            </div>
          </div>

          <div className="chart-box od-chart-box">
            <h3 className="ch-title">Encounters Monthly</h3>
            <p className="ch-sub">Total checkouts per month (all providers)</p>
            <div
              ref={refEncountersMonthly}
              style={{ height: CHART_DIMS.barChart.height, width: '100%', position: 'relative' }}
              className={loading ? 'ch-loading' : ''}
            >
              {!loading && appointmentsData.length === 0 && (
                <div className="ch-no-data">
                  <div className="ch-no-data-icon">📋</div>
                  <div className="ch-no-data-text">No encounter data</div>
                  <div className="ch-no-data-hint">Upload appointments to see monthly encounters</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── NEW PATIENTS WEEKLY + MONTHLY (2-column row) ── */}
      <section
        aria-label="New patient metrics (CPT 90791)"
        className="od-section"
      >
        <div className="charts-2col" style={{ alignItems: 'stretch' }}>
          <div className="chart-box od-chart-box">
            <h3 className="ch-title">New Patients Weekly</h3>
            <p className="ch-sub">CPT 90791 — total new patient visits per week</p>
            <div
              ref={refNewPatientsWeekly}
              style={{ height: CHART_DIMS.barChart.height, width: '100%', position: 'relative' }}
              className={loading ? 'ch-loading' : ''}
            >
              {!loading && chargesData.filter(c => c.cpt_code === '90791').length === 0 && (
                <div className="ch-no-data">
                  <div className="ch-no-data-icon">👤</div>
                  <div className="ch-no-data-text">No new patients</div>
                  <div className="ch-no-data-hint">Upload charges with CPT 90791 to see weekly new patients</div>
                </div>
              )}
            </div>
          </div>

          <div className="chart-box od-chart-box">
            <h3 className="ch-title">New Patients Monthly</h3>
            <p className="ch-sub">CPT 90791 — total new patient visits per month</p>
            <div
              ref={refNewPatientsMonthly}
              style={{ height: CHART_DIMS.barChart.height, width: '100%', position: 'relative' }}
              className={loading ? 'ch-loading' : ''}
            >
              {!loading && chargesData.filter(c => c.cpt_code === '90791').length === 0 && (
                <div className="ch-no-data">
                  <div className="ch-no-data-icon">👤</div>
                  <div className="ch-no-data-text">No new patients</div>
                  <div className="ch-no-data-hint">Upload charges with CPT 90791 to see monthly new patients</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── PROVIDER HOURS + AR AGING (2-column row) ── */}
      <section
        aria-label="Provider productivity and AR aging"
        className="od-section"
      >
        <div className="charts-2col" style={{ alignItems: 'stretch' }}>
          <div className="chart-box od-chart-box">
            <h3 className="ch-title">Provider Hours</h3>
            <p className="ch-sub">Appointment volume by provider</p>
            <div className={`od-ph-layout${loading ? ' ch-loading' : ''}`}>
              {!loading && appointmentsData.length === 0 ? (
                <div className="ch-no-data od-ph-empty">
                  <div className="ch-no-data-icon">⏰</div>
                  <div className="ch-no-data-text">No provider data</div>
                  <div className="ch-no-data-hint">Upload appointments to see provider hours</div>
                </div>
              ) : (
                <>
                  <div
                    ref={refProviderHours}
                    className="od-ph-chart"
                    style={{ height: CHART_DIMS.pieOfPie.height, minHeight: CHART_DIMS.pieOfPie.height }}
                  />
                  {!loading && providerHoursBreakdown.length > 0 && (
                    <aside className="od-ph-side" aria-label="Provider appointment counts">
                      <div className="od-ph-side-title">Breakdown</div>
                      <ul className="od-ph-list">
                        {providerHoursBreakdown.map((row, i) => (
                          <li key={`${row.name}-${i}`} className="od-ph-row">
                            <span
                              className="od-ph-swatch"
                              style={{ background: PROVIDER_STATUS_COLORS[i % PROVIDER_STATUS_COLORS.length] }}
                              aria-hidden
                            />
                            <span className="od-ph-name" title={row.name}>
                              {row.name}
                            </span>
                            <span className="od-ph-meta">
                              <span className="od-ph-count">{fmtCount(row.count)}</span>
                              <span className="od-ph-pct">{row.pct.toFixed(1)}%</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </aside>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="chart-box od-chart-box">
            <h3 className="ch-title">AR Aging</h3>
            <p className="ch-sub">Outstanding balance by claim age (pending items)</p>
            <div
              ref={refArAging}
              style={{ height: CHART_DIMS.horizontal.height, width: '100%', position: 'relative' }}
              className={loading ? 'ch-loading' : ''}
            >
              {!loading && arAgingIsEmpty && (
                <div className="ch-no-data">
                  <div className="ch-no-data-icon">💰</div>
                  <div className="ch-no-data-text">No AR aging data</div>
                  <div className="ch-no-data-hint">No pending claims in range, or run reconciliation</div>
                </div>
              )}
            </div>
          </div>
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

/* ── Recon Status Strip (single line, conditional) ── */
interface ReconStatusStripProps {
  warnings: Array<{ key: 'checkout_no_charge' | 'checkout_charge_no_era'; msg: string }>;
  exporting: string | null;
  onExport: (key: 'checkout_no_charge' | 'checkout_charge_no_era') => Promise<void>;
  mismatchPercent: number;
}

function ReconStatusStrip({ warnings, exporting, onExport, mismatchPercent }: ReconStatusStripProps) {
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

      <span className={`od-status-item ${allOk ? 'od-status-item--ok' : 'od-status-item--warn'}`}>
        <span className={`od-status-dot ${allOk ? 'od-status-dot--ok' : 'od-status-dot--warn'}`} />
        {allOk ? '100% Claimed Files Matched' : `${mismatchPercent.toFixed(1)}% claim file errors`}
      </span>

      <span className="od-status-sep" />

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