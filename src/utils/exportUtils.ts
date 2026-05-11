/**
 * exportUtils.ts — Executive-grade export for CFO/CEO presentations
 * ──────────────────────────────────────────────────────────────────
 * PDF:   Branded header, KPI card boxes, framed charts, styled tables
 * Excel: ExcelJS with colored headers, bordered KPI boxes, freeze panes
 */

import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type * as echarts from 'echarts';

/* ═══════════════════════════ TYPES ═══════════════════════════ */

export interface ExportFilterContext {
  dateFrom?: string;
  dateTo?: string;
  providerName?: string;
  dashboardName: string;
}

export interface KpiEntry {
  label: string;
  value: string | number;
  sub?: string;
}

export interface TableSheet {
  sheetName: string;
  headers: string[];
  rows: (string | number)[][];
}

export interface ChartCapture {
  title: string;
  dataUrl: string;
}

/* ═══════════════════════════ BRAND COLORS ═══════════════════════════ */

const BRAND = {
  navy:      '1A3A5C',
  navyRgb:   [26, 58, 92] as [number, number, number],
  accent:    '2D7FC1',
  accentRgb: [45, 127, 193] as [number, number, number],
  dark:      '0F2137',
  darkRgb:   [15, 33, 55] as [number, number, number],
  white:     'FFFFFF',
  whiteRgb:  [255, 255, 255] as [number, number, number],
  text:      '1A2332',
  textRgb:   [26, 35, 50] as [number, number, number],
  muted:     '6B7E96',
  mutedRgb:  [107, 126, 150] as [number, number, number],
  border:    'D8E2EE',
  borderRgb: [216, 226, 238] as [number, number, number],
  bgLight:   'F0F4F8',
  bgRow:     'F7F9FC',
  green:     '0D9E6E',
  amber:     'D97706',
  red:       'DC3545',
};

/* ═══════════════════════════ HELPERS ═══════════════════════════ */

function ts(): string { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
function safeName(n: string): string { return n.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_'); }

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function captureChartImages(charts: echarts.ECharts[], titles: string[]): ChartCapture[] {
  return charts.map((c, i) => {
    try {
      return { title: titles[i] || `Chart ${i + 1}`, dataUrl: c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' }) };
    } catch { return null; }
  }).filter(Boolean) as ChartCapture[];
}

/* ═══════════════════════════════════════════════════════════════
   EXCEL — Executive styled with ExcelJS
   ═══════════════════════════════════════════════════════════════ */

const FONT_HEADER: Partial<ExcelJS.Font> = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF' + BRAND.white } };
const FONT_TITLE: Partial<ExcelJS.Font> = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF' + BRAND.navy } };
const FONT_SUB: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, color: { argb: 'FF' + BRAND.muted } };
const FONT_KPI_VAL: Partial<ExcelJS.Font> = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF' + BRAND.dark } };
const FONT_KPI_LABEL: Partial<ExcelJS.Font> = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF' + BRAND.muted } };
const FONT_BODY: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, color: { argb: 'FF' + BRAND.text } };
const FILL_NAVY: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND.navy } };
const FILL_ACCENT: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND.accent } };
const FILL_LIGHT: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND.bgLight } };
const FILL_ROW: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND.bgRow } };
const FILL_WHITE: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF' + BRAND.border } },
  bottom: { style: 'thin', color: { argb: 'FF' + BRAND.border } },
  left: { style: 'thin', color: { argb: 'FF' + BRAND.border } },
  right: { style: 'thin', color: { argb: 'FF' + BRAND.border } },
};
const BORDER_BOX: Partial<ExcelJS.Borders> = {
  top: { style: 'medium', color: { argb: 'FF' + BRAND.border } },
  bottom: { style: 'medium', color: { argb: 'FF' + BRAND.border } },
  left: { style: 'medium', color: { argb: 'FF' + BRAND.border } },
  right: { style: 'medium', color: { argb: 'FF' + BRAND.border } },
};

function addBrandedHeader(ws: ExcelJS.Worksheet, title: string, filters: ExportFilterContext, colCount: number) {
  // Row 1: Brand banner (dark navy)
  const r1 = ws.getRow(1);
  r1.height = 36;
  ws.mergeCells(1, 1, 1, colCount);
  const c1 = ws.getCell('A1');
  c1.value = 'Empowered Mind-Body Therapy';
  c1.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  c1.fill = FILL_NAVY;
  c1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  for (let c = 2; c <= colCount; c++) { ws.getCell(1, c).fill = FILL_NAVY; }

  // Row 2: Dashboard title
  const r2 = ws.getRow(2);
  r2.height = 30;
  ws.mergeCells(2, 1, 2, colCount);
  const c2 = ws.getCell('A2');
  c2.value = title;
  c2.font = FONT_TITLE;
  c2.fill = FILL_WHITE;
  c2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  for (let c = 2; c <= colCount; c++) { ws.getCell(2, c).fill = FILL_WHITE; }

  // Row 3: Date range + provider
  const r3 = ws.getRow(3);
  r3.height = 20;
  ws.mergeCells(3, 1, 3, colCount);
  const dateStr = `${filters.dateFrom ?? 'All dates'} — ${filters.dateTo ?? 'All dates'}`;
  const provStr = filters.providerName ? `  |  Provider: ${filters.providerName}` : '  |  All Providers';
  const c3 = ws.getCell('A3');
  c3.value = `Date Range: ${dateStr}${provStr}    |    Exported: ${new Date().toLocaleString()}`;
  c3.font = FONT_SUB;
  c3.fill = FILL_LIGHT;
  c3.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  for (let c = 2; c <= colCount; c++) { ws.getCell(3, c).fill = FILL_LIGHT; }

  // Row 4: Accent divider line
  const r4 = ws.getRow(4);
  r4.height = 4;
  for (let c = 1; c <= colCount; c++) {
    ws.getCell(4, c).fill = FILL_ACCENT;
  }
}

function addKpiBoxes(ws: ExcelJS.Worksheet, kpis: KpiEntry[], startRow: number, colCount: number) {
  // Section label
  const labelRow = ws.getRow(startRow);
  labelRow.height = 22;
  ws.mergeCells(startRow, 1, startRow, colCount);
  const lc = ws.getCell(startRow, 1);
  lc.value = '  KEY PERFORMANCE INDICATORS';
  lc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + BRAND.muted }, };
  lc.alignment = { vertical: 'middle' };

  // KPI cards: 3 per row, each card = 2 cols wide
  const cardsPerRow = Math.min(Math.floor(colCount / 2), 4);
  let row = startRow + 1;

  for (let i = 0; i < kpis.length; i += cardsPerRow) {
    const valueRow = row;
    const labelRowNum = row + 1;
    const subRow = row + 2;

    ws.getRow(valueRow).height = 28;
    ws.getRow(labelRowNum).height = 18;
    ws.getRow(subRow).height = 16;

    for (let j = 0; j < cardsPerRow && i + j < kpis.length; j++) {
      const kpi = kpis[i + j];
      const col1 = j * 2 + 1;
      const col2 = j * 2 + 2;

      // Merge 2 cols for the KPI value
      ws.mergeCells(valueRow, col1, valueRow, col2);
      const valCell = ws.getCell(valueRow, col1);
      valCell.value = kpi.value;
      valCell.font = FONT_KPI_VAL;
      valCell.alignment = { horizontal: 'center', vertical: 'bottom' };
      valCell.fill = FILL_WHITE;
      valCell.border = { top: BORDER_BOX.top, left: BORDER_BOX.left, right: BORDER_BOX.right };
      ws.getCell(valueRow, col2).border = { top: BORDER_BOX.top, right: BORDER_BOX.right };

      // Label
      ws.mergeCells(labelRowNum, col1, labelRowNum, col2);
      const labCell = ws.getCell(labelRowNum, col1);
      labCell.value = kpi.label.toUpperCase();
      labCell.font = FONT_KPI_LABEL;
      labCell.alignment = { horizontal: 'center', vertical: 'top' };
      labCell.fill = FILL_WHITE;
      labCell.border = { left: BORDER_BOX.left, right: BORDER_BOX.right };
      ws.getCell(labelRowNum, col2).border = { right: BORDER_BOX.right };

      // Sub
      ws.mergeCells(subRow, col1, subRow, col2);
      const subCell = ws.getCell(subRow, col1);
      subCell.value = kpi.sub ?? '';
      subCell.font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF' + BRAND.muted } };
      subCell.alignment = { horizontal: 'center', vertical: 'top' };
      subCell.fill = FILL_WHITE;
      subCell.border = { bottom: BORDER_BOX.bottom, left: BORDER_BOX.left, right: BORDER_BOX.right };
      ws.getCell(subRow, col2).border = { bottom: BORDER_BOX.bottom, right: BORDER_BOX.right };
    }

    row += 4; // 3 rows per card + 1 spacing
  }

  return row;
}

function addDataTable(ws: ExcelJS.Worksheet, headers: string[], rows: (string | number)[][], startRow: number): number {
  // Header row
  const hr = ws.getRow(startRow);
  hr.height = 24;
  headers.forEach((h, i) => {
    const cell = ws.getCell(startRow, i + 1);
    cell.value = h;
    cell.font = FONT_HEADER;
    cell.fill = FILL_NAVY;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDER_THIN;
  });

  // Data rows
  rows.forEach((row, ri) => {
    const r = ws.getRow(startRow + 1 + ri);
    r.height = 20;
    row.forEach((val, ci) => {
      const cell = ws.getCell(startRow + 1 + ri, ci + 1);
      cell.value = val;
      cell.font = FONT_BODY;
      cell.alignment = { horizontal: ci === 0 ? 'left' : 'center', vertical: 'middle', indent: ci === 0 ? 1 : 0 };
      cell.fill = ri % 2 === 0 ? FILL_WHITE : FILL_ROW;
      cell.border = BORDER_THIN;
    });
  });

  return startRow + 1 + rows.length;
}

async function saveWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename,
  );
}

/* ── Public Excel exports ── */

export async function exportToExcel(opts: {
  filters: ExportFilterContext;
  kpis: KpiEntry[];
  sheets: TableSheet[];
  filename?: string;
}): Promise<void> {
  const { filters, kpis, sheets, filename } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Empowered Mind-Body Therapy';
  wb.created = new Date();

  const maxCols = Math.max(8, ...sheets.map(s => s.headers.length));

  // ── Summary sheet ──
  const ws = wb.addWorksheet('Executive Summary', { properties: { tabColor: { argb: 'FF' + BRAND.navy } } });
  ws.columns = Array.from({ length: maxCols }, () => ({ width: 18 }));

  addBrandedHeader(ws, filters.dashboardName, filters, maxCols);
  const afterKpi = addKpiBoxes(ws, kpis, 6, maxCols);

  // Add first data sheet inline if small
  if (sheets.length > 0 && sheets[0].rows.length <= 30) {
    const s = sheets[0];
    const secRow = afterKpi + 1;
    ws.mergeCells(secRow, 1, secRow, maxCols);
    const sc = ws.getCell(secRow, 1);
    sc.value = `  ${s.sheetName.toUpperCase()}`;
    sc.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF' + BRAND.muted } };
    ws.getRow(secRow).height = 22;
    addDataTable(ws, s.headers, s.rows, secRow + 1);
  }

  // ── Additional sheets ──
  for (const sheet of sheets) {
    const ds = wb.addWorksheet(sheet.sheetName.slice(0, 31), { properties: { tabColor: { argb: 'FF' + BRAND.accent } } });
    const cols = sheet.headers.length;
    ds.columns = sheet.headers.map(h => ({ width: Math.max(h.length + 6, 16) }));
    addBrandedHeader(ds, sheet.sheetName, filters, cols);
    const tableStart = 6;
    addDataTable(ds, sheet.headers, sheet.rows, tableStart);
    ds.views = [{ state: 'frozen', ySplit: tableStart, showGridLines: false }];
  }

  ws.views = [{ showGridLines: false }];
  await saveWorkbook(wb, filename ?? `${safeName(filters.dashboardName)}_${ts()}.xlsx`);
}

export async function exportProviderWiseExcel(opts: {
  filters: ExportFilterContext;
  providers: { name: string; kpis: KpiEntry[]; sheet: TableSheet }[];
  filename?: string;
}): Promise<void> {
  const { filters, providers, filename } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Empowered Mind-Body Therapy';
  wb.created = new Date();

  // Overview sheet
  const ov = wb.addWorksheet('Overview', { properties: { tabColor: { argb: 'FF' + BRAND.navy } } });
  ov.columns = Array.from({ length: 4 }, () => ({ width: 22 }));
  addBrandedHeader(ov, `${filters.dashboardName} — Provider Breakdown`, filters, 4);
  addDataTable(ov, ['Provider', '# KPIs', 'Sheet Name', 'Status'], providers.map(p => [p.name, p.kpis.length, p.name.slice(0, 31), 'Included']), 6);
  ov.views = [{ showGridLines: false }];

  // Per-provider sheets
  for (const prov of providers) {
    const sheetName = prov.name.replace(/[\\/*?[\]]/g, '').slice(0, 31) || 'Provider';
    const ps = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: 'FF' + BRAND.accent } } });
    const cols = Math.max(8, prov.sheet.headers.length);
    ps.columns = Array.from({ length: cols }, () => ({ width: 18 }));
    addBrandedHeader(ps, prov.name, { ...filters, providerName: prov.name }, cols);
    const afterKpi = addKpiBoxes(ps, prov.kpis, 6, cols);
    addDataTable(ps, prov.sheet.headers, prov.sheet.rows, afterKpi + 1);
    ps.views = [{ showGridLines: false }];
  }

  await saveWorkbook(wb, filename ?? `${safeName(filters.dashboardName)}_ProviderWise_${ts()}.xlsx`);
}

/* ═══════════════════════════════════════════════════════════════
   PDF — Executive boardroom quality
   ═══════════════════════════════════════════════════════════════ */

export function exportToPdf(opts: {
  filters: ExportFilterContext;
  kpis: KpiEntry[];
  charts: ChartCapture[];
  tables: { title: string; headers: string[]; rows: (string | number)[][] }[];
  filename?: string;
}): void {
  const { filters, kpis, charts, tables, filename } = opts;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();   // ~297
  const H = doc.internal.pageSize.getHeight();   // ~210
  const M = 16; // margin
  let y = 0;

  /* ── PAGE 1: COVER HEADER ── */

  // Dark navy banner
  doc.setFillColor(...BRAND.darkRgb);
  doc.rect(0, 0, W, 32, 'F');

  // Accent stripe under banner
  doc.setFillColor(...BRAND.accentRgb);
  doc.rect(0, 32, W, 2.5, 'F');

  // Brand name
  doc.setTextColor(...BRAND.whiteRgb);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('EMPOWERED MIND-BODY THERAPY', M, 13);

  // Dashboard title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(filters.dashboardName, M, 25);

  // Right-aligned metadata
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const dateRange = `${filters.dateFrom ?? 'All dates'}  —  ${filters.dateTo ?? 'All dates'}`;
  const provLabel = filters.providerName ?? 'All Providers';
  doc.text(dateRange, W - M, 15, { align: 'right' });
  doc.text(provLabel, W - M, 21, { align: 'right' });
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleString()}`, W - M, 27, { align: 'right' });

  y = 42;

  /* ── KPI CARDS ── */
  doc.setTextColor(...BRAND.mutedRgb);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('KEY PERFORMANCE INDICATORS', M, y);
  y += 4;

  const visibleKpis = kpis.slice(0, 8);
  const cardCount = visibleKpis.length;
  const gap = 4;
  const totalGap = gap * (cardCount - 1);
  const cardW = (W - 2 * M - totalGap) / cardCount;
  const cardH = 24;

  visibleKpis.forEach((kpi, i) => {
    const x = M + i * (cardW + gap);

    // Card background with rounded corners
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...BRAND.borderRgb);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');

    // Accent bottom border
    doc.setFillColor(...BRAND.accentRgb);
    doc.rect(x + 1, y + cardH - 2.5, cardW - 2, 2, 'F');

    // Value
    doc.setTextColor(...BRAND.darkRgb);
    doc.setFontSize(cardW > 50 ? 14 : 11);
    doc.setFont('helvetica', 'bold');
    const valStr = String(kpi.value);
    doc.text(valStr, x + cardW / 2, y + 10, { align: 'center' });

    // Label
    doc.setTextColor(...BRAND.mutedRgb);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.text(kpi.label.toUpperCase(), x + cardW / 2, y + 16, { align: 'center' });

    // Sub text
    if (kpi.sub) {
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'normal');
      doc.text(kpi.sub, x + cardW / 2, y + 20, { align: 'center' });
    }
  });

  y += cardH + 8;

  /* ── CHARTS ── */
  if (charts.length > 0) {
    doc.setTextColor(...BRAND.mutedRgb);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('CHARTS & ANALYTICS', M, y);
    y += 5;

    const chartGap = 8;
    const perRow = Math.min(charts.length, 2);
    const cw = (W - 2 * M - chartGap * (perRow - 1)) / perRow;
    const ch = cw * 0.48;

    for (let i = 0; i < charts.length; i += perRow) {
      if (y + ch + 16 > H - 18) { doc.addPage(); y = M; }

      for (let j = 0; j < perRow && i + j < charts.length; j++) {
        const chart = charts[i + j];
        const cx = M + j * (cw + chartGap);

        // Chart frame
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...BRAND.borderRgb);
        doc.setLineWidth(0.3);
        doc.roundedRect(cx, y, cw, ch + 8, 2, 2, 'FD');

        // Chart title inside frame
        doc.setTextColor(...BRAND.textRgb);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text(chart.title, cx + 4, y + 5);

        // Chart image
        try {
          doc.addImage(chart.dataUrl, 'PNG', cx + 2, y + 8, cw - 4, ch - 2);
        } catch {
          doc.setTextColor(...BRAND.mutedRgb);
          doc.setFontSize(7);
          doc.text('Chart unavailable', cx + cw / 2, y + ch / 2, { align: 'center' });
        }
      }
      y += ch + 14;
    }
  }

  /* ── DATA TABLES ── */
  for (const table of tables) {
    if (y + 24 > H - 18) { doc.addPage(); y = M; }

    doc.setTextColor(...BRAND.mutedRgb);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(table.title.toUpperCase(), M, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      head: [table.headers],
      body: table.rows.map(r => r.map(String)),
      margin: { left: M, right: M },
      styles: {
        font: 'helvetica', fontSize: 8, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        lineColor: BRAND.borderRgb, lineWidth: 0.15, textColor: BRAND.textRgb,
      },
      headStyles: {
        fillColor: BRAND.navyRgb, textColor: BRAND.whiteRgb, fontStyle: 'bold', fontSize: 8,
        cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      theme: 'grid',
      tableLineColor: BRAND.borderRgb,
      tableLineWidth: 0.15,
    });

    y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : y + 30;
  }

  /* ── FOOTER ON EVERY PAGE ── */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);

    // Thin line above footer
    doc.setDrawColor(...BRAND.borderRgb);
    doc.setLineWidth(0.3);
    doc.line(M, H - 12, W - M, H - 12);

    // Left: brand
    doc.setFontSize(7);
    doc.setTextColor(...BRAND.mutedRgb);
    doc.setFont('helvetica', 'normal');
    doc.text('Empowered Mind-Body Therapy  |  Confidential', M, H - 8);

    // Center: generated timestamp
    doc.text(new Date().toLocaleString(), W / 2, H - 8, { align: 'center' });

    // Right: page number
    doc.setFont('helvetica', 'bold');
    doc.text(`Page ${i} of ${pages}`, W - M, H - 8, { align: 'right' });
  }

  doc.save(filename ?? `${safeName(filters.dashboardName)}_${ts()}.pdf`);
}
