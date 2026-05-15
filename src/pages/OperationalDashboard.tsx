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
const CURRENCY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

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

// ── Provider Hours: vibrant multi-color palette matching providerwise pie charts ──
const PROVIDER_STATUS_COLORS = ['#004569', '#0b5f97', '#016b8f', '#05a9a9', '#3d79b8', '#6b7280', '#5db1b1', '#ab5656'];
const CHART_AXIS_MUTED = '#9ca3af';
const CHART_AXIS_TEXT_STYLE = { fontFamily: 'Montserrat, sans-serif', fontSize: 10, fontWeight: 400 };
const LEGEND_TEXT_STYLE = { color: '#1e293b', fontSize: 11, fontWeight: 600, fontFamily: 'Montserrat, sans-serif' };
const CHART_LEGEND_BOTTOM = { bottom: 4, left: 'center' as const, orient: 'horizontal' as const, itemWidth: 12, itemHeight: 10, itemGap: 14, textStyle: LEGEND_TEXT_STYLE };

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
  /** Pie-of-pie (Provider Hours) + AR aging histogram */
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

const createResizeHandler = (charts: echarts.ECharts[]): (() => void) => {
  return () => { charts.forEach((ch) => { try { ch.resize(); } catch { /* silently ignore */ } }); };
};

// ── CHANGE 3: Normalize provider names to Title Case ──
function toTitleCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── CHANGE 1 & 2: Date label helpers ──

/**
 * Format a YYYY-MM month key to "Jan-26" style.
 */
function fmtMonthLabel(monthKey: string): string {
  // monthKey = "2025-01"
  const [yearStr, monStr] = monthKey.split('-');
  const date = new Date(Number(yearStr), Number(monStr) - 1, 1);
  const monthAbbr = date.toLocaleString('en-US', { month: 'short' }); // "Jan"
  const yr2 = String(date.getFullYear()).slice(-2);                    // "26"
  return `${monthAbbr}-${yr2}`;
}

/**
 * Format a YYYY-MM-DD week-start key to a two-line label:
 *   Line 1 (top):    "w1", "w2", …  (sequential index, 1-based)
 *   Line 2 (bottom): "Jan-26"
 * ECharts interprets "\n" in category labels as a line break.
 */
function fmtWeekLabel(weekKey: string, idx: number): string {
  const date = new Date(`${weekKey}T12:00:00`);
  const monthAbbr = date.toLocaleString('en-US', { month: 'short' }); // "Jan"
  const yr2 = String(date.getFullYear()).slice(-2);                    // "26"
  return `w${idx + 1}\n${monthAbbr}-${yr2}`;
}

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
  const [loadError, setLoadError] = useState<string | null>(null);

  // New chart data states
  const [appointmentsData, setAppointmentsData] = useState<Appointment[]>([]);
  const [chargesData, setChargesData] = useState<any[]>([]);
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
    const paymentReceived = eraProcessedAmount;

    const openingAr     = priorBalance;
    const outstandingAr = Math.max(openingAr + chargesGenerated - paymentReceived, 0);

    const outstandingTrendUp = outstandingAr > openingAr;
    const trendDelta = openingAr > 0
      ? ((outstandingAr - openingAr) / openingAr) * 100
      : null;
    const outstandingTrendLabel = trendDelta !== null
      ? `${outstandingTrendUp ? '↑' : '↓'} ${Math.abs(trendDelta).toFixed(0)}% vs opening`
      : openingAr === 0 && outstandingAr > 0
        ? 'Closing AR as on period'
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

  /* ── EVENT HANDLERS ── */
  const loadSummaryAndRows = useCallback(async (start = dateFrom, end = dateTo): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const priorEndDate = start ? dayBefore(start) : undefined;

      const summaryData = await getReconSummary({ start_date: start || undefined, end_date: end || undefined });
      const insuranceData = await getInsuranceCashCollected({ start_date: start || undefined, end_date: end || undefined });
      const priorData = priorEndDate
        ? await getReconSummary({ end_date: priorEndDate })
        : null;
      const appointmentsList = await fetchAppointmentsAllPages({ date_from: start || undefined, date_to: end || undefined });
      const chargesList = await fetchChargesAllPages({ date_from: start || undefined, date_to: end || undefined });
      const agingRows = await getReconAging({ start_date: start || undefined, end_date: end || undefined });

      setSummary(summaryData);
      setInsuranceCashCollected(
        insuranceData.cash_collected_mapped_amount || insuranceData.insurance_cash_collected || 0,
      );
      setEraProcessedAmount(insuranceData.era_processed_amount || 0);
      setPayerBreakdown(insuranceData.payer_breakdown || []);
      setPriorBalance(priorData?.total_balance ?? 0);
      
      setAppointmentsData(appointmentsList);
      setChargesData(chargesList);
      setArAgingBuckets(agingRows);
    } catch (error) {
      console.error('Failed to load reconciliation summary:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name
        });
      }
      setLoadError(error instanceof Error ? error.message : 'Failed to load reconciliation data');
      setSummary(null);
      setInsuranceCashCollected(0);
      setEraProcessedAmount(0);
      setPayerBreakdown([]);
      setPriorBalance(0);
      setAppointmentsData([]);
      setChargesData([]);
      setArAgingBuckets([]);
    } finally {     1
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
    };
  }, [loading, summary, payerBreakdown, kpis, appointmentsData, chargesData, arAgingBuckets]);

  /* ── CHART RENDER FUNCTIONS ── */
  const renderWaterfallChart = (container: HTMLDivElement, chartsArray: echarts.ECharts[]): void => {
    const chart = echarts.init(container);
    chartsArray.push(chart);

    const t0 = kpis.openingAr;
    const t1 = t0 + kpis.chargesGenerated;
    const t2 = t1 - kpis.paymentReceived;

    const categories = [
      'Opening AR',
      'Billing in Period',
      'Payment Received',
      'Closing AR',
    ];

    const placeholders = [0, t0, t2, 0];
    const heights = [
      t0,
      kpis.chargesGenerated,
      kpis.paymentReceived,
      t2,
    ];
    const trueVals = [t0, kpis.chargesGenerated, -kpis.paymentReceived, t2];
    const barColors = [EC.accent, EC.accent, EC.wfNeg, EC.accent];
    // Waterfall connectors: each connects the "exit" of one bar to the "entry" of the next
    // Opening top (t0) → Billing bottom (t0);  Billing top (t1) → Payment top (t1);  Payment bottom (t2) → Closing top (t2)
    const connectorYValues = [t0, t1, t2];
    const connectorData = [0, 1, 2].map((i) => [i, i + 1, connectorYValues[i]] as [number, number, number]);

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 48, right: 20, bottom: 64, left: 72 },
      legend: { show: false },
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
          ...CHART_AXIS_TEXT_STYLE,
          color: EC.text,
          interval: 0,
          formatter: (v: string) => v.replace(' ', '\n'),
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          ...CHART_AXIS_TEXT_STYLE,
          color: EC.text,
          formatter: (v: number) =>
            v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`,
        },
      },
      series: [
        {
          name: '_placeholder',
          type: 'bar',
          stack: 'wf',
          silent: true,
          data: placeholders,
          itemStyle: { color: 'transparent' },
          barWidth: 42,
        },
        {
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
            fontWeight: 500,
            color: EC.text,
            formatter: (p: any) => {
              const v = trueVals[p.dataIndex];
              const sign = v < 0 ? '−' : '';
              return `${sign}${fmt(Math.abs(v))}`;
            },
          },
        },
        {
          type: 'custom',
          silent: true,
          data: connectorData,
          renderItem: (_params: any, api: any) => {
            const fromIndex = api.value(0) as number;
            const toIndex = api.value(1) as number;
            const yVal = api.value(2) as number;
            const barHalfWidth = 21;
            const fromPoint = api.coord([fromIndex, yVal]);
            const toPoint = api.coord([toIndex, yVal]);
            return {
              type: 'line',
              shape: {
                x1: fromPoint[0] + barHalfWidth,
                y1: fromPoint[1],
                x2: toPoint[0] - barHalfWidth,
                y2: toPoint[1],
              },
              style: api.style({
                stroke: '#94a3b8',
                lineWidth: 1.5,
                lineDash: [4, 4],
              }),
              silent: true,
              z: 2,
            };
          },
        },
      ],
    });
  };

  // ── CHANGE 4: ERA Reconciliation — legend text made visible ──
  const renderEraChart = (container: HTMLDivElement, data: typeof kpis, chartsArray: echarts.ECharts[]): void => {
    const chart = echarts.init(container);
    chartsArray.push(chart);

    const charged = data.checkoutChargeEraCount + data.checkoutChargeNoEraCount;
    const pieData = [
      { name: 'Checkouts',    value: charged,                      itemStyle: { color: EC.accent } },
      { name: 'Claims Filed', value: data.checkoutChargeEraCount,  itemStyle: { color: EC.accent2 } },
      { name: 'Missing ERAs', value: data.checkoutChargeNoEraCount, itemStyle: { color: '#9ca3af' } },
    ];
    const total = pieData.reduce((s, d) => s + d.value, 0);

    chart.setOption({
      backgroundColor: 'transparent',
      color: [EC.accent, EC.accent2, '#9ca3af'],
      tooltip: {
        trigger: 'item',
        ...TOOLTIP_COMMON,
        formatter: (p: any) => {
          const pct = total ? Math.round((p.value / total) * 100) : 0;
          return `<div style="font-weight:700">${p.name}</div>${fmtCount(p.value)}&nbsp;<span style="color:#64748b">(${pct}%)</span>`;
        },
      },
      legend: {
        orient: 'vertical' as const,
        right: 8,
        top: 'middle' as const,
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 12,
        // ── CHANGE 4: explicit color + enough width so names are never clipped ──
        textStyle: {
          color: '#1e293b',
          fontSize: 11,
          fontWeight: 500,
          fontFamily: 'Montserrat, sans-serif',
        },
        formatter: (name: string) => {
          const item = pieData.find((d) => d.name === name);
          const count = item?.value ?? 0;
          return `${name}  (${fmtCount(count)})`;
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['46%', '72%'],
          // ── shift pie left so legend has space on the right ──
          center: ['34%', '50%'],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            label: { show: false },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,.2)' },
          },
          data: pieData,
        },
      ],
    });
  };

  /* ═══════════════════ NEW CHART FUNCTIONS ═══════════════════ */

  // ── CHANGE 2: Encounters Weekly — labels "w1\nJan-26" ──
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
      // ── "w1\nJan-26", "w2\nJan-26", … ──
      const weekLabels = weeks.map((w, idx) => fmtWeekLabel(w, idx));

      chart.setOption({
        backgroundColor: 'transparent',
        legend: { show: false },
        tooltip: { trigger: 'axis', ...TOOLTIP_COMMON },
        grid: OD_BAR_GRID,
        dataZoom: CHART_DATA_ZOOM,
        xAxis: {
          type: 'category',
          data: weekLabels,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            ...CHART_AXIS_TEXT_STYLE,
            color: EC.text,
            // allow two-line rendering
            rich: {},
          },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
        },
        series: [
          {
            name: 'Checkouts',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            data: values,
            lineStyle: { color: EC.accent, width: 2.5 },
            itemStyle: { color: EC.accent },
            label: {
              show: true,
              position: 'top',
              color: EC.text,
              fontSize: 10,
              fontWeight: 500,
              formatter: (p: any) => fmtCount(Number(p.value ?? 0)),
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering encounters weekly chart:', error);
    }
  };

  // ── CHANGE 1: Encounters Monthly — labels "Jan-26" ──
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
      // ── "Jan-26", "Feb-26", … ──
      const monthLabels = months.map((m) => fmtMonthLabel(m));

      chart.setOption({
        backgroundColor: 'transparent',
        legend: { show: false },
        tooltip: { trigger: 'axis', ...TOOLTIP_COMMON },
        grid: OD_BAR_GRID,
        dataZoom: CHART_DATA_ZOOM,
        xAxis: {
          type: 'category',
          data: monthLabels,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
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
              fontWeight: 500,
              formatter: (p: any) => fmtCount(Number(p.value ?? 0)),
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering encounters monthly chart:', error);
    }
  };

  // ── CHANGE 2: New Patients Weekly — labels "w1\nJan-26" ──
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
      // ── "w1\nJan-26", "w2\nFeb-26", … ──
      const weekLabels = weeks.map((w, idx) => fmtWeekLabel(w, idx));

      chart.setOption({
        backgroundColor: 'transparent',
        legend: { show: false },
        tooltip: { trigger: 'axis', ...TOOLTIP_COMMON },
        grid: OD_BAR_GRID,
        dataZoom: CHART_DATA_ZOOM,
        xAxis: {
          type: 'category',
          data: weekLabels,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            ...CHART_AXIS_TEXT_STYLE,
            color: EC.text,
            rich: {},
          },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
        },
        series: [
          {
            name: 'New patients',
            type: 'line',
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            data: values,
            lineStyle: { color: EC.accent, width: 2.5 },
            itemStyle: { color: EC.accent },
            label: {
              show: true,
              position: 'top',
              color: EC.text,
              fontSize: 10,
              fontWeight: 500,
              formatter: (p: any) => fmtCount(Number(p.value ?? 0)),
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering new patients weekly chart:', error);
    }
  };

  // ── CHANGE 1: New Patients Monthly — labels "Jan-26" ──
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
      // ── "Jan-26", "Feb-26", … ──
      const monthLabels = months.map((m) => fmtMonthLabel(m));

      chart.setOption({
        backgroundColor: 'transparent',
        legend: { show: false },
        tooltip: { trigger: 'axis', ...TOOLTIP_COMMON },
        grid: OD_BAR_GRID,
        dataZoom: CHART_DATA_ZOOM,
        xAxis: {
          type: 'category',
          data: monthLabels,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
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
              fontWeight: 500,
              formatter: (p: any) => fmtCount(Number(p.value ?? 0)),
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error rendering new patients monthly chart:', error);
    }
  };

  // ── CHANGE 3: Provider Hours — gray palette + normalize names to Title Case ──
  const renderProviderHours = (container: HTMLDivElement, appointments: Appointment[], chartsArray: echarts.ECharts[]): void => {
    try {
      if (!container || !appointments.length) return;
      const chart = echarts.init(container, null, { renderer: 'canvas' });
      chartsArray.push(chart);

      // Normalize: trim + Title Case before aggregating
      const counts = new Map<string, number>();
      for (const appt of appointments) {
        const raw = (appt.provider_name || 'Unknown').trim() || 'Unknown';
        const name = toTitleCase(raw);
        counts.set(name, (counts.get(name) || 0) + 1);
      }

      const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
      const total = sorted.reduce((s, [, v]) => s + v, 0);
      if (total <= 0) return;

      const providerNames = sorted.map(([name]) => name.length > 18 ? `${name.slice(0, 16)}…` : name);
      const providerValues = sorted.map(([, value]) => value);

      const tooltipFmt = (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const idx = p?.dataIndex ?? 0;
        const value = Number(p?.value ?? providerValues[idx] ?? 0);
        const name = sorted[idx]?.[0] ?? 'Unknown';
        const pct = total ? Math.round((value / total) * 100) : 0;
        return `<div style="font-weight:700">${name}</div>${fmtCount(value)} appointments (${pct}%)`;
      };

      chart.setOption({
        backgroundColor: 'transparent',
        // gray palette defined in PROVIDER_STATUS_COLORS above
        color: PROVIDER_STATUS_COLORS,
        legend: { ...CHART_LEGEND_BOTTOM, data: ['Appointments'] },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP_COMMON, formatter: tooltipFmt },
        grid: { left: 120, right: 24, top: 8, bottom: 44 },
        xAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
        },
        yAxis: {
          type: 'category',
          data: providerNames,
          inverse: true,
          axisLine: { show: true, lineStyle: { color: EC.border } },
          axisTick: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
        },
        series: [
          {
            name: 'Appointments',
            type: 'bar',
            data: providerValues.map((v, i) => ({
              value: v,
              itemStyle: {
                // cycle through vibrant multi-color palette
                color: PROVIDER_STATUS_COLORS[i % PROVIDER_STATUS_COLORS.length],
                borderRadius: [0, 4, 4, 0],
              },
            })),
            barMaxWidth: 28,
            label: {
              show: true,
              position: 'insideRight',
              // white text on all vibrant-colored bars
              color: '#fff',
              fontSize: 11,
              fontWeight: 500,
              formatter: (p: any) => fmtCount(Number(p.value)),
            },
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
        grid: { left: 52, right: 18, top: 12, bottom: 48 },
        xAxis: {
          type: 'category',
          data: categories,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { ...CHART_AXIS_TEXT_STYLE, color: EC.text },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            ...CHART_AXIS_TEXT_STYLE,
            color: EC.text,
            formatter: (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`),
          },
        },
        series: [
          {
            type: 'bar',
            data: balances.map((bal) => ({
              value: bal,
              itemStyle: {
                color: EC.accent,
                borderRadius: [5, 5, 0, 0],
              },
            })),
            barMaxWidth: 42,
            label: {
              show: true,
              position: 'top',
              color: EC.text,
              fontSize: 10,
              fontWeight: 500,
              formatter: (p: any) => {
                const v = Number(p.value ?? 0);
                return fmt(v);
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
  const CHART_TITLES_OD = ['AR Waterfall', 'ERA Reconciliation'];

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
        total > 0 ? `${Math.round((p.cash_collected_mapped_amount / total) * 100)}%` : '0%',
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
              total > 0 ? `${Math.round((p.cash_collected_mapped_amount / total) * 100)}%` : '0%',
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
          { label: 'Collection Rate', value: `${Math.round(ps.collection_rate)}%` },
        ] as KpiEntry[],
        sheet: {
          sheetName: 'Summary',
          headers: ['Metric', 'Value'],
          rows: [
            ['Appointments', ps.appointment_count],
            ['Billed', ps.billed],
            ['Paid', ps.paid],
            ['Balance', ps.billed - ps.paid],
            ['Collection Rate', `${Math.round(ps.collection_rate)}%`],
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
              `${Math.round(ps.collection_rate)}%`,
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
      {!loading && loadError ? (
        <div className="od-status-strip od-status-strip--warn" role="status" aria-live="polite">
          <span className="od-status-icon">⚠</span>
          <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
            Reconciliation data could not be loaded: {loadError}
          </span>
        </div>
      ) : !loading && !hasData ? (
        <div className="od-status-strip od-status-strip--neutral" role="status">
          <span className="od-status-icon">○</span>
          <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
            No reconciliation data — upload appointments, charges &amp; ERA files then run reconciliation
          </span>
        </div>
      ) : (
        <ReconStatusStrip
          warnings={warnings}
          exporting={exporting}
          onExport={handleExportException}
        />
      )}

      {/* ── KPI ROW ── */}
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
          <div className="kpi-label">Claims Filed</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{loading ? '\u00A0' : fmt(kpis.chargesGenerated)}</div>
          <div className="kpi-sub">Billed in range</div>
          <div className="kpi-emoji">🧾</div>
        </div>
        <div className="kpi-card c-teal">
          <div className="kpi-label">Payment Received</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{loading ? '\u00A0' : fmt(kpis.paymentReceived)}</div>
          <div className="kpi-sub">Total ERAs received</div>
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

      {/* ── AR WATERFALL + ERA RECONCILIATION ── */}
      <section
        aria-label="Account receivable waterfall and checkout ERA coverage"
        className="od-section"
      >
        <div className="charts-2col" style={{ alignItems: 'stretch' }}>
          <div className="chart-box od-chart-box">
            <div className="ch-head">
              <div>
                <h3 className="ch-title">Account Receivable Flow Breakdown</h3>
                <p className="ch-sub">Opening → Billing → Payment Received → Closing</p>
              </div>
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
            <div className="ch-head">
              <div>
                <h3 className="ch-title">ERA Reconciliation</h3>
                <p className="ch-sub">Claims Filed → ERAs Received</p>
              </div>
            </div>
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
                    {kpis.checkoutChargeEraCount + kpis.checkoutChargeNoEraCount} Checkouts
                  </span>
                )}
                {kpis.checkoutChargeEraCount > 0 && (
                  <span className="od-era-count od-era-count--green">
                    <span className="od-era-dot" style={{ background: EC.accent2 }} />
                    {kpis.checkoutChargeEraCount} Claims filed
                  </span>
                )}
                {kpis.checkoutChargeNoEraCount > 0 && (
                  <span className="od-era-count od-era-count--amber">
                    <span className="od-era-dot" style={{ background: EC.danger }} />
                    {kpis.checkoutChargeNoEraCount} Missing ERAs 
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── ENCOUNTERS WEEKLY + MONTHLY ── */}
      <section
        aria-label="Weekly and monthly encounter metrics"
        className="od-section"
      >
        <div className="charts-2col" style={{ alignItems: 'stretch' }}>
          <div className="chart-box od-chart-box">
            <h3 className="ch-title">Encounters Weekly</h3>
            <p className="ch-sub">Total checkouts per week</p>
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
            <p className="ch-sub">Total checkouts per month</p>
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

      {/* ── NEW PATIENTS WEEKLY + MONTHLY ── */}
      <section
        aria-label="New patient metrics (CPT 90791)"
        className="od-section"
      >
        <div className="charts-2col" style={{ alignItems: 'stretch' }}>
          <div className="chart-box od-chart-box">
            <h3 className="ch-title">New Patients Weekly</h3>
            <div className="ch-sub">Weekly Count of New Intakes</div>
            <div
              ref={refNewPatientsWeekly}
              style={{ height: CHART_DIMS.barChart.height, width: '100%', position: 'relative' }}
              className={loading ? 'ch-loading' : ''}
            >
              {!loading && chargesData.filter(c => c.cpt_code === '90791').length === 0 && (
                <div className="ch-no-data">
                  <div className="ch-no-data-icon">👤</div>
                  <div className="ch-no-data-text">No new patients</div>
                  <div className="ch-no-data-hint">Upload charges to see weekly new patients</div>
                </div>
              )}
            </div>
          </div>

          <div className="chart-box od-chart-box">
            <h3 className="ch-title">New Patients Monthly</h3>
            <div className="ch-sub">Monthly Count of New Intakes</div>
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

      {/* ── PROVIDER HOURS + AR AGING ── */}
      <section
        aria-label="Provider productivity and AR aging"
        className="od-section"
      >
        <div className="charts-2col" style={{ alignItems: 'stretch' }}>
          <div className="chart-box od-chart-box">
            <h3 className="ch-title">Providerwise Hours</h3>
            <p className="ch-sub">Checkout volume by provider</p>
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
                </>
              )}
            </div>
          </div>

          <div className="chart-box od-chart-box">
            <h3 className="ch-title">AR Aging Histogram</h3>
            <p className="ch-sub">Outstanding balance distribution by aging bucket</p>
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

/* ── Recon Status Strip ── */
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
      {allOk && (
        <>
          <span className="od-status-icon">✓</span>
          <span className={`od-status-item od-status-item--ok`}>
            <span className={`od-status-dot od-status-dot--ok`} />
            100% Claims Filed
          </span>
        </>
      )}

      <span className="od-status-sep" />

      <StatusItem
        ok={!hasNoCharge}
        okLabel="100% Claims Filed"
        warnLabel="Charges missing"
        warnKey="checkout_no_charge"
        exporting={exporting}
        onExport={onExport}
      />

      <span className="od-status-sep" />

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
                      <span className="od-payer-pct">{Math.round(pct)}%</span>
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