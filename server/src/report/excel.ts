/**
 * ייצוא דו"ח ל-Excel. אותו מודל שממנו נבנה ה-PDF, כדי שהמספרים יהיו זהים
 * בדיוק בשני הקבצים.
 *
 * שתי הקפדות: מספרים נשמרים כמספרים ולא כמחרוזות (אחרת אי אפשר לסכם אותם
 * בגיליון), והגיליון נפתח מימין לשמאל כשהדו"ח בעברית.
 */
import ExcelJS from 'exceljs';
import type { Block, Cell, Column, ReportResult, Tone } from './types.ts';
import { STATUS_COLORS } from './status.ts';

const argb = (hex: string): string => 'FF' + hex.replace('#', '').toUpperCase().padStart(6, '0').slice(-6);

const TONE_COLOR: Record<Exclude<Tone, 'plain'>, string> = {
  red: STATUS_COLORS.open,
  muted: '#6B7280',
  strong: '#1B1F24',
};

const sheetName = (name: string, used: Set<string>): string => {
  // אקסל אוסר על חלק מהתווים ומגביל ל-31 תווים
  const base = (name || 'דוח').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 28) || 'דוח';
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) candidate = `${base} ${i++}`;
  used.add(candidate);
  return candidate;
};

export async function renderReportExcel(result: ReportResult): Promise<Buffer> {
  const { head } = result;
  const wb = new ExcelJS.Workbook();
  wb.creator = head.byUser;
  wb.created = new Date();

  const used = new Set<string>();
  // דו"ח עם כמה טבלאות מקבל גיליון לכל טבלה; דו"ח רציף (קריאות, דו"ח מפורט)
  // נשאר בגיליון אחד כדי שלא ייווצרו מאות לשוניות.
  const titled = result.blocks.filter((b) => (b.kind === 'table' || b.kind === 'pivot' || b.kind === 'chart') && b.title);
  const perSheet = titled.length > 1 && !result.blocks.some((b) => b.kind === 'break' || b.kind === 'callList');

  let ws: ExcelJS.Worksheet | null = null;
  const newSheet = (title: string): ExcelJS.Worksheet => {
    const sheet = wb.addWorksheet(sheetName(title, used), {
      views: [{ rightToLeft: head.dir === 'rtl' }],
      pageSetup: { orientation: result.orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    writeHead(sheet, result, title);
    return sheet;
  };

  for (const block of result.blocks) {
    const title = 'title' in block ? block.title : undefined;
    if (!ws || (perSheet && title)) ws = newSheet(title ?? head.reportName);
    writeBlock(ws, block, result);
  }
  if (!ws) {
    ws = newSheet(head.reportName);
    ws.addRow([head.emptyText]);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** הכותרת האחידה, בשורות הראשונות של כל גיליון. */
function writeHead(ws: ExcelJS.Worksheet, result: ReportResult, title: string): void {
  const { head } = result;
  const line1 = ws.addRow([head.systemName, '', `${head.generatedAt}`]);
  line1.font = { bold: true, size: 12, color: { argb: argb(head.brand.primary) } };
  const line2 = ws.addRow([head.companyName, '', `${head.byLabel} ${head.byUser}`]);
  line2.font = { size: 10 };

  const bar = ws.addRow([title === head.reportName ? head.reportName : `${head.reportName} — ${title}`]);
  bar.font = { bold: true, size: 13, color: { argb: argb(head.brand.onPrimary) } };
  bar.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(head.brand.primary) } };
  });
  ws.getCell(bar.number, 1).alignment = { vertical: 'middle' };
  ws.getRow(bar.number).height = 20;

  if (head.filterText) {
    const f = ws.addRow([head.filterText]);
    f.font = { size: 9, color: { argb: 'FF4B5563' } };
  }
  ws.addRow([]);
}

const value = (cell: Cell | undefined, col: Column | undefined): string | number =>
  cell === undefined ? '' : col?.numeric && cell.num !== undefined ? cell.num : cell.text;

function styleCell(c: ExcelJS.Cell, tone: Tone | undefined, numeric: boolean | undefined, dir: 'rtl' | 'ltr'): void {
  if (tone && tone !== 'plain') {
    c.font = { color: { argb: argb(TONE_COLOR[tone]) }, bold: tone === 'strong' };
  }
  c.alignment = {
    horizontal: numeric ? (dir === 'rtl' ? 'left' : 'right') : dir === 'rtl' ? 'right' : 'left',
    vertical: 'top',
    wrapText: !numeric,
  };
}

function headerRow(ws: ExcelJS.Worksheet, labels: string[], result: ReportResult): ExcelJS.Row {
  const row = ws.addRow(labels);
  row.font = { bold: true, color: { argb: argb(result.head.brand.onPrimary) } };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(result.head.brand.primary) } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  return row;
}

function applyWidths(ws: ExcelJS.Worksheet, columns: Column[]): void {
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    const want = c.width ?? (c.numeric ? 12 : 20);
    if (!col.width || col.width < want) col.width = want;
  });
}

function writeBlock(ws: ExcelJS.Worksheet, block: Block, result: ReportResult): void {
  const dir = result.head.dir;
  switch (block.kind) {
    case 'break':
      ws.addRow([]);
      return;

    case 'table': {
      if (block.title) {
        const t = ws.addRow([block.title]);
        t.font = { bold: true, size: 11, color: { argb: argb(result.head.brand.primary) } };
      }
      if (block.note) ws.addRow([block.note]).font = { size: 9, color: { argb: 'FF4B5563' } };
      headerRow(ws, block.columns.map((c) => c.label), result);
      block.rows.forEach((row, ri) => {
        const r = ws.addRow(block.columns.map((c, ci) => value(row[ci], c)));
        r.eachCell((cell, ci) => styleCell(cell, row[ci - 1]?.tone, block.columns[ci - 1]?.numeric, dir));
        if (block.subtotalRows?.includes(ri)) r.font = { bold: true };
      });
      if (block.total) {
        const t = ws.addRow(block.columns.map((c, ci) => value(block.total![ci], c)));
        t.font = { bold: true };
        t.eachCell((cell) => {
          cell.border = { top: { style: 'thin' } };
        });
      }
      applyWidths(ws, block.columns);
      ws.addRow([]);
      return;
    }

    case 'pivot': {
      if (block.title) {
        const t = ws.addRow([block.title]);
        t.font = { bold: true, size: 11, color: { argb: argb(result.head.brand.primary) } };
      }
      const labels = [...block.rowHeads, ...block.cols, block.totalLabel];
      const headRowNum = headerRow(ws, labels, result).number;
      const firstDataRow = headRowNum + 1;
      block.rows.forEach((r) => {
        const cells: (string | number)[] = [];
        r.spans.forEach((span, i) => cells.push(span === 0 ? '' : (r.keys[i] ?? '')));
        r.values.forEach((v) => cells.push(v));
        cells.push(r.total);
        const row = ws.addRow(cells);
        row.eachCell((cell, ci) => {
          cell.alignment = {
            horizontal: ci <= block.rowHeads.length ? (dir === 'rtl' ? 'right' : 'left') : 'center',
            vertical: 'middle',
          };
        });
        row.getCell(labels.length).font = { bold: true };
      });
      // מיזוג אנכי של תא הקבוצה — אותו מיזוג שבמסך וב-PDF
      block.rows.forEach((r, ri) => {
        r.spans.forEach((span, level) => {
          if (span > 1) ws.mergeCells(firstDataRow + ri, level + 1, firstDataRow + ri + span - 1, level + 1);
        });
      });
      const totals = ws.addRow([
        block.totalLabel,
        ...block.rowHeads.slice(1).map(() => ''),
        ...block.colTotals,
        block.grandTotal,
      ]);
      totals.font = { bold: true };
      totals.eachCell((cell) => {
        cell.border = { top: { style: 'thin' } };
      });
      applyWidths(ws, [
        ...block.rowHeads.map((h) => ({ key: h, label: h, width: 24 })),
        ...block.cols.map((c) => ({ key: c, label: c, numeric: true, width: 12 })),
        { key: 'total', label: block.totalLabel, numeric: true, width: 10 },
      ]);
      ws.addRow([]);
      return;
    }

    case 'chart': {
      const t = ws.addRow([block.title]);
      t.font = { bold: true, size: 11, color: { argb: argb(result.head.brand.primary) } };
      if (block.subtitle) ws.addRow([block.subtitle]).font = { size: 9, color: { argb: 'FF4B5563' } };
      headerRow(ws, [block.title, block.valueLabel], result);
      for (const bar of block.bars) {
        const r = ws.addRow([bar.label, bar.value]);
        r.getCell(2).alignment = { horizontal: 'center' };
      }
      const total = ws.addRow([block.valueLabel, block.total]);
      total.font = { bold: true };
      applyWidths(ws, [
        { key: 'label', label: block.title, width: 32 },
        { key: 'value', label: block.valueLabel, numeric: true, width: 12 },
      ]);
      ws.addRow([]);
      return;
    }

    case 'callList': {
      if (block.title) ws.addRow([block.title]).font = { bold: true, size: 11 };
      headerRow(ws, block.columns.map((c) => c.label), result);
      for (const item of block.items) {
        const r = ws.addRow(block.columns.map((c, ci) => value(item.cells[ci], c)));
        r.eachCell((cell, ci) => styleCell(cell, item.cells[ci - 1]?.tone, block.columns[ci - 1]?.numeric, dir));
        // השורה השנייה: התיאור, באדום ולרוחב כל העמודות
        const d = ws.addRow([item.description]);
        ws.mergeCells(d.number, 1, d.number, Math.max(1, block.columns.length));
        d.getCell(1).font = { color: { argb: argb(STATUS_COLORS.open) } };
        d.getCell(1).alignment = { wrapText: true, vertical: 'top', horizontal: dir === 'rtl' ? 'right' : 'left' };
        for (const ev of item.events ?? []) {
          const e = ws.addRow(['', `${ev.when} — ${ev.who}: ${ev.body}`]);
          ws.mergeCells(e.number, 2, e.number, Math.max(2, block.columns.length));
          e.getCell(2).font = { size: 9, color: { argb: 'FF4B5563' } };
          e.getCell(2).alignment = { wrapText: true, vertical: 'top', horizontal: dir === 'rtl' ? 'right' : 'left' };
        }
      }
      const count = ws.addRow([`${block.countLabel}: ${block.count}`]);
      count.font = { bold: true };
      applyWidths(ws, block.columns);
      ws.addRow([]);
      return;
    }

    case 'fields': {
      const t = ws.addRow([block.title]);
      t.font = { bold: true, size: 11, color: { argb: argb(result.head.brand.primary) } };
      for (const f of block.fields) {
        const r = ws.addRow([f.label, f.value]);
        r.getCell(1).font = { bold: true };
        if (f.tone && f.tone !== 'plain') r.getCell(2).font = { color: { argb: argb(TONE_COLOR[f.tone]) } };
        r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      }
      applyWidths(ws, [
        { key: 'label', label: '', width: 22 },
        { key: 'value', label: '', width: 60 },
      ]);
      ws.addRow([]);
      return;
    }
  }
}
