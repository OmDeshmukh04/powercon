import { useState, useEffect, useRef, useCallback } from 'react';
import * as echarts from 'echarts';
import { getAppointments, getAppointmentSummary, getProviders } from '../api';
import type { AppointmentKPIs, Provider, AppointmentFilters, AppointmentSummary } from '../types';
import ExportDropdown from '../components/ExportDropdown';
import type { ExportSection } from '../components/ExportDropdown';
import {
  exportToExcel,
  exportToPdf,
  exportProviderWiseExcel,
  captureChartImages,
} from '../utils/exportUtils';
import type { KpiEntry, TableSheet, ExportFilterContext } from '../utils/exportUtils';

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
};
const PROVIDER_STATUS_COLORS = [EC.accent, EC.danger, EC.purple, EC.accent2, EC.accent3];

function fmt(n: number) { return n.toLocaleString(); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function weeksAgoStr(n: number) { const d = new Date(); d.setDate(d.getDate() - n * 7); return d.toISOString().split('T')[0]; }
function isoWeekKey(d: string) {
  const date = new Date(d + 'T00:00:00');
  const day = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - day + 3); // move to Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.floor((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export default function ProviderDashboard() {
  // Filters
  const [dateFrom,  setDateFrom]  = useState(weeksAgoStr(4));
  const [dateTo,    setDateTo]    = useState(todayStr());
  const [provider,  setProvider]  = useState('');
  const [pageSize,  setPageSize]  = useState(50);
  const [page,      setPage]      = useState(1);

  // Data
  const [kpis,      setKpis]      = useState<AppointmentKPIs | null>(null);
  const [summary,   setSummary]   = useState<AppointmentSummary | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading,   setLoading]   = useState(true);

  // Chart refs
  const refStatusDist   = useRef<HTMLDivElement>(null);
  const refStatusTrend  = useRef<HTMLDivElement>(null);
  const refCompletionVs = useRef<HTMLDivElement>(null);
  const refMonthlyChk   = useRef<HTMLDivElement>(null);
  const refNoShowRate   = useRef<HTMLDivElement>(null);
  const refHeatmap      = useRef<HTMLDivElement>(null);
  const charts     = useRef<echarts.ECharts[]>([]);
  const didInitRange = useRef(false);
  const summaryRef = useRef<AppointmentSummary | null>(null);

  // Export state
  const [exportLoading, setExportLoading] = useState(false);
  const [exportLoadingId, setExportLoadingId] = useState<string | null>(null);

  // Chart title map (matches chart ref order)
  const CHART_TITLES = [
    'Status Distribution',
    'Status Trend',
    'Check-out vs Rescheduled',
    'Monthly Checkouts',
    'No-show Rate %',
    'Daily Activity Heatmap',
  ];

  const PAGE_SIZE = pageSize;

  // Load providers once
  useEffect(() => { getProviders().then(setProviders).catch(() => {}); }, []);

  // Fetch summary then appointments (mount / filter changes)
  const fetchSummaryAndAppointments = useCallback(async (opts?: { resetPage?: boolean }) => {
    if (opts?.resetPage) setPage(1);
    setLoading(true);
    try {
      console.log('DEBUG: Calling getAppointmentSummary with', { date_from: dateFrom || undefined, date_to: dateTo || undefined, provider: provider || undefined });
      const summary = await getAppointmentSummary({ date_from: dateFrom || undefined, date_to: dateTo || undefined, provider: provider || undefined });
      console.log('DEBUG: API summary response:', JSON.stringify(summary, null, 2));
      console.log('DEBUG: KPIs from response:', JSON.stringify(summary.kpis, null, 2));
      summaryRef.current = summary;
      setSummary(summary);
      setKpis(summary.kpis);

      const min = summary?.bounds?.min_date ?? null;
      const max = summary?.bounds?.max_date ?? null;
      if (!didInitRange.current && min && max) {
        didInitRange.current = true;
        setDateFrom(min);
        setDateTo(max);
      }

      const filters: AppointmentFilters = {
        date_from: (summary?.bounds?.min_date ?? dateFrom) || undefined,
        date_to:   (summary?.bounds?.max_date ?? dateTo)   || undefined,
        provider:  provider || undefined,
        page:      1,
        page_size: PAGE_SIZE,
      };

      await getAppointments(filters);
      setPage(1);
    } catch {
      // keep stale
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, provider, PAGE_SIZE]);

  // Fetch appointments only (page changes)
  const fetchAppointments = useCallback(async (pg: number) => {
    setLoading(true);
    try {
      const filters: AppointmentFilters = {
        date_from: dateFrom || undefined,
        date_to:   dateTo   || undefined,
        provider:  provider || undefined,
        page:      pg,
        page_size: PAGE_SIZE,
      };
      await getAppointments(filters);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, provider, PAGE_SIZE]);

  // mount
  useEffect(() => { fetchSummaryAndAppointments({ resetPage: true }); }, []);

  // filters change (skip first mount)
  const filtersInitialized = useRef(false);
  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    fetchSummaryAndAppointments({ resetPage: true });
  }, [dateFrom, dateTo, provider, fetchSummaryAndAppointments]);

  // page change
  useEffect(() => { if (page > 1) fetchAppointments(page); }, [page, fetchAppointments]);

  // page-size change only affects table paging
  useEffect(() => {
    if (!filtersInitialized.current) return;
    setPage(1);
    fetchAppointments(1);
  }, [pageSize, fetchAppointments]);

  // charts
  useEffect(() => {
    if (!kpis || !summary) return;

    console.log('KPIs:', kpis);
    console.log('Summary daily sample:', summary.daily?.slice(0, 3));

    const timer = setTimeout(() => {
      charts.current.forEach((c) => { try { c.dispose(); } catch (_) {} });
      charts.current = [];

      const ZOOM = [
        { type: 'slider', bottom: 4, height: 16, borderColor: EC.border, fillerColor: 'rgba(1,69,105,.08)', handleStyle: { color: EC.accent }, labelFormatter: '' },
        { type: 'inside' }
      ];

      if (refStatusDist.current) {
        console.log('refStatusDist height:', refStatusDist.current.clientHeight);
        const c = echarts.init(refStatusDist.current); charts.current.push(c);
        const statusData = [
          { name: 'Checked Out', value: kpis.checked_out,  itemStyle: { color: EC.accent } },
          { name: 'No-show',     value: kpis.no_show,      itemStyle: { color: EC.danger } },
          { name: 'Cancelled',   value: kpis.cancelled,    itemStyle: { color: EC.purple } },
          { name: 'Rescheduled', value: kpis.rescheduled,  itemStyle: { color: EC.accent2 } },
          { name: 'Pending',     value: kpis.pending,      itemStyle: { color: EC.accent3 } },
        ];
        const total = statusData.reduce((sum, item) => sum + item.value, 0);
        c.setOption({
          backgroundColor: 'transparent',
          color: PROVIDER_STATUS_COLORS,
          tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
          legend: {
            orient: 'vertical',
            right: 8,
            top: 'center',
            textStyle: { fontSize: 11, color: EC.text },
            formatter: (name: string) => {
              const item = statusData.find((d) => d.name === name);
              const pct = item && total ? ((item.value / total) * 100).toFixed(0) : '0';
              return `${name}  (${pct}%)`;
            }
          },
          series: [{
            type: 'pie',
            radius: ['52%', '78%'],
            center: ['38%', '50%'],
            data: statusData,
            label: { show: false },
            emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,.2)' } }
          }]
        });
      }

    if (refStatusTrend.current) {
      const c = echarts.init(refStatusTrend.current); charts.current.push(c);
      const byWeek: Record<string, { checked_out: number; no_show: number; cancelled: number; rescheduled: number; pending: number }> = {};
      for (const d of summary.daily ?? []) {
        const key = isoWeekKey(d.appt_date);
        byWeek[key] ??= { checked_out: 0, no_show: 0, cancelled: 0, rescheduled: 0, pending: 0 };
        byWeek[key].checked_out += Number(d.checked_out ?? 0);
        byWeek[key].no_show += Number(d.no_show ?? 0);
        byWeek[key].cancelled += Number(d.cancelled ?? 0);
        byWeek[key].rescheduled += Number(d.rescheduled ?? 0);
        byWeek[key].pending += Number(d.pending ?? 0);
      }
      const weeks = Object.keys(byWeek).sort();
      c.setOption({
        backgroundColor: 'transparent',
        grid: { top: 28, right: 12, bottom: 48, left: 36 },
        legend: { top: 0, left: 8, itemWidth: 14, itemHeight: 10, itemGap: 14, textStyle: { color: EC.text, fontSize: 12, fontWeight: 500 }, padding: [0, 0, 10, 0] },
        dataZoom: ZOOM,
        xAxis: { data: weeks, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: EC.text3, fontSize: 10 } },
        yAxis: { axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: EC.text3, fontSize: 10 } },
        tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: EC.border, textStyle: { color: EC.text, fontSize: 12 } },
        series: [
          { name: 'Checked Out', type: 'line', data: weeks.map((w) => byWeek[w].checked_out), smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { color: EC.accent, width: 2 }, itemStyle: { color: EC.accent } },
          { name: 'No-show', type: 'line', data: weeks.map((w) => byWeek[w].no_show), smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { color: EC.danger, width: 2 }, itemStyle: { color: EC.danger } },
          { name: 'Cancelled', type: 'line', data: weeks.map((w) => byWeek[w].cancelled), smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { color: EC.purple, width: 2 }, itemStyle: { color: EC.purple } },
          { name: 'Rescheduled', type: 'line', data: weeks.map((w) => byWeek[w].rescheduled), smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { color: EC.accent2, width: 2 }, itemStyle: { color: EC.accent2 } },
          { name: 'Pending', type: 'line', data: weeks.map((w) => byWeek[w].pending), smooth: true, symbol: 'circle', symbolSize: 4, lineStyle: { color: EC.accent3, width: 2 }, itemStyle: { color: EC.accent3 } },
        ]
      });
    }

    if (refCompletionVs.current) {
      const c = echarts.init(refCompletionVs.current); charts.current.push(c);
      const byWeek: Record<string, { checked: number; rescheduled: number }> = {};
      for (const d of summary.daily ?? []) {
        const key = isoWeekKey(d.appt_date);
        byWeek[key] ??= { checked: 0, rescheduled: 0 };
        byWeek[key].checked += Number(d.checked_out ?? 0);
        byWeek[key].rescheduled += Number(d.rescheduled ?? 0);
      }
      const weeks = Object.keys(byWeek).sort();
      c.setOption({
        backgroundColor: 'transparent',
        grid: { top: 28, right: 12, bottom: 48, left: 36 },
        legend: { top: 0, left: 8, itemWidth: 14, itemHeight: 10, itemGap: 14, textStyle: { color: EC.text, fontSize: 12, fontWeight: 500 } },
        dataZoom: ZOOM,
        xAxis: { data: weeks, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: EC.text, fontSize: 10 } },
        yAxis: { axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: EC.text, fontSize: 10 } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#fff', borderColor: EC.border, textStyle: { color: EC.text, fontSize: 12 } },
        series: [
          { name: 'Checked Out', type: 'bar', data: weeks.map((w) => byWeek[w].checked), itemStyle: { color: EC.accent, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 24 },
          { name: 'Rescheduled', type: 'bar', data: weeks.map((w) => byWeek[w].rescheduled), itemStyle: { color: EC.accent2, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 24 },
        ]
      });
    }

    if (refMonthlyChk.current) {
      const c = echarts.init(refMonthlyChk.current); charts.current.push(c);
      const byMonth = new Map<string, number>();
      for (const d of summary.daily ?? []) {
        const month = d.appt_date.slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0) + Number(d.checked_out ?? 0));
      }
      const months = Array.from(byMonth.keys()).sort();
      const monthData = months.map((m) => byMonth.get(m) ?? 0);
      c.setOption({
        backgroundColor: 'transparent',
        grid: { top: 28, right: 12, bottom: 48, left: 36 },
        legend: { top: 0, left: 8, itemWidth: 14, itemHeight: 10, itemGap: 14, textStyle: { color: EC.text, fontSize: 12, fontWeight: 500 } },
        dataZoom: ZOOM,
        xAxis: { data: months, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: EC.text, fontSize: 10 } },
        yAxis: { axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: EC.text, fontSize: 10 } },
        tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: EC.border, textStyle: { color: EC.text, fontSize: 12 } },
        series: [{ name: 'Checked Out', type: 'line', smooth: true, data: monthData, symbol: 'circle', symbolSize: 6, lineStyle: { color: EC.accent, width: 2.5 }, itemStyle: { color: EC.accent } }]
      });
    }

    if (refNoShowRate.current) {
      const c = echarts.init(refNoShowRate.current); charts.current.push(c);
      const weeks = Array.from(new Set((summary.daily ?? []).map((d) => isoWeekKey(d.appt_date)))).sort();
      const rates = weeks.map((w) => {
        const items = (summary.daily ?? []).filter((d) => isoWeekKey(d.appt_date) === w);
        const total = items.reduce((sum, d) => sum + Number(d.total ?? 0), 0) || 1;
        const noShow = items.reduce((sum, d) => sum + Number(d.no_show ?? 0), 0);
        return Number(((noShow / total) * 100).toFixed(2));
      });
      const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
      c.setOption({
        backgroundColor: 'transparent',
        grid: { top: 28, right: 12, bottom: 48, left: 40 },
        legend: { top: 0, left: 8, data: ['No-show %'], itemWidth: 14, itemHeight: 10, textStyle: { color: EC.text, fontSize: 12, fontWeight: 500 } },
        dataZoom: ZOOM,
        xAxis: { data: weeks, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: EC.text, fontSize: 10 } },
        yAxis: { axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { color: EC.text, fontSize: 10 } },
        tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: EC.border, textStyle: { color: EC.text, fontSize: 12 } },
        series: [{ type: 'line', name: 'No-show %', data: rates, smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { color: EC.danger, width: 2.5 }, itemStyle: { color: EC.danger }, markLine: { silent: true, data: [{ yAxis: Number(avg.toFixed(2)) }], lineStyle: { color: EC.warning, type: 'dashed' }, label: { formatter: `Avg ${avg.toFixed(1)}%` } } }]
      });
    }

    if (refHeatmap.current) {
      const c = echarts.init(refHeatmap.current); charts.current.push(c);
      const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']; const hours = Array.from({ length: 24 }, (_, h) => `${h}:00`);
      const data: [number, number, number][] = (summary.heatmap ?? []).map((p) => [p.hour, p.weekday, p.count]); const max = data.reduce((m, x) => Math.max(m, x[2]), 0);
      c.setOption({
        backgroundColor: 'transparent',
        grid: { top: 6, right: 12, bottom: 36, left: 44 },
        xAxis: { type: 'category', data: hours, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: EC.text, fontSize: 9 } },
        yAxis: { type: 'category', data: days, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: EC.text, fontSize: 10 } },
        visualMap: { show: false, min: 0, max: Math.max(1, max), inRange: { color: [EC.accentLight, EC.accent] } },
        tooltip: { formatter: (p: any) => `${days[p.value[1]]} ${hours[p.value[0]]}: ${p.value[2]} appts`, backgroundColor: '#fff', borderColor: EC.border, textStyle: { color: EC.text, fontSize: 12 } },
        series: [{ type: 'heatmap', data, itemStyle: { borderRadius: 3, borderWidth: 2, borderColor: '#fff' } }]
      });
    }

    const handleResize = () => charts.current.forEach((ch) => { try { ch.resize(); } catch (_) {} });
    window.addEventListener('resize', handleResize);
    (window as any).currentResizeHandler = handleResize;
  }, 0);

  return () => {
    clearTimeout(timer);
    if ((window as any).currentResizeHandler) {
      window.removeEventListener('resize', (window as any).currentResizeHandler);
      (window as any).currentResizeHandler = null;
    }
  };
}, [summary]);

  // Actions
  function applyFilters() { setPage(1); fetchSummaryAndAppointments({ resetPage: true }); }
  function clearFilters() { setDateFrom(weeksAgoStr(4)); setDateTo(todayStr()); setProvider(''); setPageSize(50); setPage(1); fetchSummaryAndAppointments({ resetPage: true }); }

  const rangePill = dateFrom && dateTo ? `📅 ${dateFrom} – ${dateTo}` : '📅 All dates';
  const selectedProviderName = provider ? providers.find((p) => String(p.id) === provider)?.name ?? 'Provider' : undefined;

  /* ═══════════════════ EXPORT HELPERS ═══════════════════ */
  function buildFilterContext(): ExportFilterContext {
    return {
      dashboardName: 'Provider Dashboard',
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      providerName: selectedProviderName,
    };
  }

  function buildKpis(): KpiEntry[] {
    if (!kpis) return [];
    return [
      { label: 'Total Appointments', value: fmt(kpis.total), sub: '↑ 12.4% vs last period' },
      { label: 'Checked Out', value: fmt(kpis.checked_out), sub: `${kpis.checkout_rate.toFixed(1)}% completion` },
      { label: 'No-shows', value: fmt(kpis.no_show), sub: `${kpis.noshow_rate.toFixed(2)}% no-show rate` },
      { label: 'Cancelled', value: fmt(kpis.cancelled), sub: `${kpis.total ? ((kpis.cancelled / kpis.total) * 100).toFixed(1) : 0}% of scheduled` },
      { label: 'Rescheduled', value: fmt(kpis.rescheduled), sub: `${kpis.total ? ((kpis.rescheduled / kpis.total) * 100).toFixed(1) : 0}% rescheduled` },
      { label: 'Pending', value: fmt(kpis.pending) },
    ];
  }

  function buildDailySheet(): TableSheet {
    return {
      sheetName: 'Daily Data',
      headers: ['Date', 'Total', 'Checked Out', 'No-show', 'Cancelled', 'Rescheduled', 'Pending'],
      rows: (summary?.daily ?? []).map((d) => [
        d.appt_date,
        d.total,
        d.checked_out,
        d.no_show,
        d.cancelled,
        d.rescheduled,
        d.pending,
      ]),
    };
  }

  function buildHeatmapSheet(): TableSheet {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return {
      sheetName: 'Heatmap Data',
      headers: ['Day', 'Hour', 'Count'],
      rows: (summary?.heatmap ?? []).map((h) => [days[h.weekday] ?? '', `${h.hour}:00`, h.count]),
    };
  }

  async function handleExportExcel(id: string) {
    setExportLoading(true);
    setExportLoadingId(id);
    try {
      await exportToExcel({
        filters: buildFilterContext(),
        kpis: buildKpis(),
        sheets: [buildDailySheet(), buildHeatmapSheet()],
      });
    } finally {
      setExportLoading(false);
      setExportLoadingId(null);
    }
  }

  async function handleExportPdf(id: string) {
    setExportLoading(true);
    setExportLoadingId(id);
    try {
      const chartImages = captureChartImages(charts.current, CHART_TITLES);
      exportToPdf({
        filters: buildFilterContext(),
        kpis: buildKpis(),
        charts: chartImages,
        tables: [{
          title: 'Daily Appointment Data',
          headers: buildDailySheet().headers,
          rows: buildDailySheet().rows,
        }],
      });
    } finally {
      setExportLoading(false);
      setExportLoadingId(null);
    }
  }

  async function handleExportProviderWise(id: string) {
    setExportLoading(true);
    setExportLoadingId(id);
    try {
      const providerData: { name: string; kpis: KpiEntry[]; sheet: TableSheet }[] = [];

      for (const prov of providers) {
        const provSummary = await getAppointmentSummary({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          provider: String(prov.id),
        });
        const pk = provSummary.kpis;
        providerData.push({
          name: prov.name,
          kpis: [
            { label: 'Total', value: pk.total },
            { label: 'Checked Out', value: pk.checked_out, sub: `${pk.checkout_rate.toFixed(1)}%` },
            { label: 'No-show', value: pk.no_show, sub: `${pk.noshow_rate.toFixed(2)}%` },
            { label: 'Cancelled', value: pk.cancelled },
            { label: 'Rescheduled', value: pk.rescheduled },
            { label: 'Pending', value: pk.pending },
          ],
          sheet: {
            sheetName: 'Daily',
            headers: ['Date', 'Total', 'Checked Out', 'No-show', 'Cancelled', 'Rescheduled', 'Pending'],
            rows: provSummary.daily.map((d) => [
              d.appt_date, d.total, d.checked_out, d.no_show, d.cancelled, d.rescheduled, d.pending,
            ]),
          },
        });
      }

      await exportProviderWiseExcel({
        filters: buildFilterContext(),
        providers: providerData,
      });
    } finally {
      setExportLoading(false);
      setExportLoadingId(null);
    }
  }

  async function handleExportAllProviders(id: string) {
    setExportLoading(true);
    setExportLoadingId(id);
    try {
      const allSummary = await getAppointmentSummary({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      const ak = allSummary.kpis;
      await exportToExcel({
        filters: { ...buildFilterContext(), providerName: 'All Providers' },
        kpis: [
          { label: 'Total', value: ak.total },
          { label: 'Checked Out', value: ak.checked_out, sub: `${ak.checkout_rate.toFixed(1)}%` },
          { label: 'No-show', value: ak.no_show, sub: `${ak.noshow_rate.toFixed(2)}%` },
          { label: 'Cancelled', value: ak.cancelled },
          { label: 'Rescheduled', value: ak.rescheduled },
          { label: 'Pending', value: ak.pending },
        ],
        sheets: [{
          sheetName: 'Daily Data (All)',
          headers: ['Date', 'Total', 'Checked Out', 'No-show', 'Cancelled', 'Rescheduled', 'Pending'],
          rows: allSummary.daily.map((d) => [
            d.appt_date, d.total, d.checked_out, d.no_show, d.cancelled, d.rescheduled, d.pending,
          ]),
        }],
        filename: `Provider_Dashboard_AllProviders_${new Date().toISOString().slice(0, 10)}.xlsx`,
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
        { id: 'cv-excel', label: 'Excel (.xlsx)', icon: '📊', description: 'KPIs + daily data', onClick: () => handleExportExcel('cv-excel') },
        { id: 'cv-pdf', label: 'PDF Report', icon: '📄', description: 'KPIs + charts + data', onClick: () => handleExportPdf('cv-pdf') },
      ],
    },
    {
      title: 'Provider-wise',
      options: [
        { id: 'pw-excel', label: 'Excel (.xlsx)', icon: '👥', description: 'One sheet per provider', onClick: () => handleExportProviderWise('pw-excel') },
      ],
    },
    {
      title: 'All Providers',
      options: [
        { id: 'all-excel', label: 'Excel (.xlsx)', icon: '📋', description: 'Combined data dump', onClick: () => handleExportAllProviders('all-excel') },
      ],
    },
  ];

  return (
    <div>
      {/* HEADER */}
      <div className="ph-row" style={{ alignItems: 'center', marginBottom: 18 }}>
        <div style={{ width: '100%' }}>
          <div className="inline-daterange" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span className="idr-label">📅 Date range</span>
            <input type="date" className="fi-date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="idr-sep">to</span>
            <input type="date" className="fi-date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <select className="fi-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">All Providers</option>
              {providers.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
            <button className="fi-btn fi-btn-accent" onClick={applyFilters}>Apply</button>
            <button className="fi-btn fi-btn-outline" onClick={clearFilters}>✕ Clear</button>
            <ExportDropdown
              sections={exportSections}
              disabled={loading || !kpis}
              loading={exportLoading}
              loadingId={exportLoadingId}
            />
            <span className="active-range-pill">{rangePill}</span>
          </div>
        </div>
      </div>

      <div className="kpi-row cols6" style={{ marginBottom: 18 }}>
        <div className="kpi-card c-blue span2">
          <div className="kpi-label">Total Appointments</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{kpis ? fmt(kpis.total) : '—'}</div>
          <div className="kpi-sub up">↑ 12.4% vs last period</div>
          <div className="kpi-emoji">📅</div>
        </div>
        <div className="kpi-card c-blue">
          <div className="kpi-label">Checked Out</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{kpis ? fmt(kpis.checked_out) : '—'}</div>
          <div className="kpi-sub up">{kpis ? `${kpis.checkout_rate.toFixed(1)}% completion` : '—'}</div>
          <div className="kpi-emoji">✅</div>
        </div>
        <div className="kpi-card c-red">
          <div className="kpi-label">No-shows</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{kpis ? fmt(kpis.no_show) : '—'}</div>
          <div className="kpi-sub dn">{kpis ? `${kpis.noshow_rate.toFixed(2)}% no-show rate` : '—'}</div>
          <div className="kpi-emoji">❌</div>
        </div>
        <div className="kpi-card c-amber">
          <div className="kpi-label">Cancelled</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{kpis ? fmt(kpis.cancelled) : '—'}</div>
          <div className="kpi-sub">{kpis ? `${kpis.total ? ((kpis.cancelled / kpis.total) * 100).toFixed(1) : 0}% of scheduled` : '—'}</div>
          <div className="kpi-emoji">🔕</div>
        </div>
        <div className="kpi-card c-teal">
          <div className="kpi-label">Rescheduled</div>
          <div className={`kpi-val${loading ? ' skeleton' : ''}`}>{kpis ? fmt(kpis.rescheduled) : '—'}</div>
          <div className="kpi-sub">{kpis ? `${kpis.total ? ((kpis.rescheduled / kpis.total) * 100).toFixed(1) : 0}% rescheduled` : '—'}</div>
          <div className="kpi-emoji">🔄</div>
        </div>
      </div>

      <div className="dash-section">📊 Status &amp; Distribution</div>
      <div className="charts-2col" style={{ marginBottom: 14 }}>
        <div className="chart-box">
          <div className="ch-head">
            <div>
              <div className="ch-title">Status Distribution</div>
              <div className="ch-sub">Proportion of each appointment outcome this period</div>
            </div>
          </div>
          <div className="ch-wrap" style={{ width: '100%' }}><div ref={refStatusDist} style={{ height: '100%', width: '100%' }} /></div>
        </div>
        <div className="chart-box">
          <div className="ch-title">Status Trend</div>
          <div className="ch-sub">Appointment statuses over time</div>
            <div className="ch-wrap" style={{ width: '100%' }}><div ref={refStatusTrend} style={{ height: '100%', width: '100%' }} /></div>
        </div>
      </div>

      <div className="dash-section">✅ Completion</div>
      <div className="charts-2col" style={{ marginBottom: 14 }}>
        <div className="chart-box">
          <div className="ch-title">No-show Rate %</div>
          <div className="ch-sub">Weekly no-show percentage with average marker</div>
          <div className="ch-wrap" style={{ width: '100%' }}><div ref={refNoShowRate} style={{ height: '100%', width: '100%' }} /></div>
        </div>
        <div className="chart-box">
          <div className="ch-title">Monthly Checkouts</div>
          <div className="ch-sub">Completed appointment volume with trend line overlay</div>
          <div className="ch-wrap" style={{ width: '100%' }}><div ref={refMonthlyChk} style={{ height: '100%', width: '100%' }} /></div>
        </div>
      </div>

      <div className="dash-section">📉 Volume &amp; No-show Rate</div>
      <div className="chart-box" style={{ marginBottom: 14 }}>
        <div className="ch-title">Check-out vs Rescheduled</div>
        <div className="ch-sub">Completed vs deferred appointments by period</div>
        <div className="ch-wrap" style={{ width: '100%' }}><div ref={refCompletionVs} style={{ height: '100%', width: '100%' }} /></div>
      </div>
      <div className="chart-box" style={{ marginBottom: 14 }}>
        <div className="ch-title">Daily Activity Heatmap</div>
        <div className="ch-sub">Appointment intensity by day — last 12 weeks</div>
        <div id="op-heatmap-wrap" ref={refHeatmap} className="ch-wrap-heat" style={{ marginTop: 4 }} />
      </div>
    </div>
  );
}
