/**
 * גרפי ההתפלגות. המערכת הקודמת ציירה עוגות תלת-ממד: עם עשרות לקוחות העוגה
 * הופכת לטבעת של פסים בלי שמות, ואי אפשר להשוות שני פלחים שכנים. כאן זה
 * גרף עמודות אופקי ממוין יורד, עם הערך כתוב על כל עמודה, עשרה עד חמישה-עשר
 * הגדולים ועוד עמודת "אחרים" שאוספת את הזנב.
 *
 * ה-SVG נבנה בשרת כדי שה-PDF ייראה בדיוק כמו המסך; הדפדפן מצייר את אותו
 * מודל נתונים בעצמו.
 */
import type { Bar, ChartBlock } from './types.ts';
import { round2 } from './pivot.ts';

export interface ChartSlice {
  label: string;
  value: number;
  color?: string;
}

export interface TopBarsOptions {
  /** כמה עמודות אמיתיות להציג לפני ש"אחרים" נכנס. 10–15 הוא הטווח הקריא. */
  max?: number;
  otherLabel: string;
  otherColor?: string;
}

export interface TopBarsResult {
  bars: Bar[];
  total: number;
  /** כמה ערכים נאספו ל"אחרים" — נכתב בכותרת המשנה כדי שלא ייעלמו בשקט. */
  foldedCount: number;
}

export function topBars(slices: ChartSlice[], opts: TopBarsOptions): TopBarsResult {
  const max = Math.min(15, Math.max(5, opts.max ?? 12));
  const sorted = [...slices]
    .filter((s) => (s.value || 0) !== 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'he'));
  const total = round2(sorted.reduce((sum, s) => sum + s.value, 0));
  if (sorted.length <= max + 1) {
    return {
      bars: sorted.map((s) => ({ label: s.label, value: round2(s.value), ...(s.color ? { color: s.color } : {}) })),
      total,
      foldedCount: 0,
    };
  }
  const head = sorted.slice(0, max);
  const tail = sorted.slice(max);
  const other = round2(tail.reduce((sum, s) => sum + s.value, 0));
  return {
    bars: [
      ...head.map((s) => ({ label: s.label, value: round2(s.value), ...(s.color ? { color: s.color } : {}) })),
      { label: opts.otherLabel, value: other, ...(opts.otherColor ? { color: opts.otherColor } : {}) },
    ],
    total,
    foldedCount: tail.length,
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SvgOptions {
  dir: 'rtl' | 'ltr';
  /** צבע ברירת המחדל לעמודה — הצבע המשני של החברה. צבעי סטטוס מגיעים על הנתון עצמו. */
  accent: string;
  width?: number;
}

/**
 * גרף העמודות כ-SVG. בעברית התוויות בימין והעמודות גדלות שמאלה, כך שהקריאה
 * זורמת באותו כיוון כמו הטקסט.
 */
export function barChartSvg(block: ChartBlock, opts: SvgOptions): string {
  const W = opts.width ?? 980;
  const rtl = opts.dir === 'rtl';
  const rowH = 28;
  const padTop = 8;
  const padBottom = 18;
  const labelW = 230;
  const valueW = 86;
  const plotW = Math.max(120, W - labelW - valueW - 24);
  const bars = block.bars;
  const H = padTop + bars.length * rowH + padBottom;
  const max = bars.reduce((m, b) => Math.max(m, b.value), 0) || 1;

  // ראשית הצירים: בעברית מימין לשמאל
  const plotStart = rtl ? W - labelW - 12 : labelW + 12;
  const sign = rtl ? -1 : 1;
  const labelX = rtl ? W - 4 : labelW;
  const labelAnchor = rtl ? 'end' : 'end';

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(block.title)}" class="chart">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="none"/>`);

  bars.forEach((bar, i) => {
    const y = padTop + i * rowH;
    const barH = 16;
    const len = Math.max(1, (bar.value / max) * plotW);
    const x = rtl ? plotStart - len : plotStart;
    const fill = bar.color ?? opts.accent;
    const valueX = plotStart + sign * (len + 8);
    parts.push(
      `<text x="${labelX}" y="${y + barH - 2}" text-anchor="${labelAnchor}" class="bar-label">${esc(bar.label)}</text>`,
    );
    parts.push(`<rect x="${x}" y="${y}" width="${len}" height="${barH}" rx="2" fill="${esc(fill)}"/>`);
    parts.push(
      `<text x="${valueX}" y="${y + barH - 2}" text-anchor="${rtl ? 'end' : 'start'}" class="bar-value">${esc(formatValue(bar.value))}</text>`,
    );
  });

  // קו הבסיס, כדי שהעין תמצא את ההתחלה של כל העמודות
  parts.push(
    `<line x1="${plotStart}" y1="${padTop - 4}" x2="${plotStart}" y2="${padTop + bars.length * rowH}" stroke="currentColor" stroke-opacity="0.25"/>`,
  );
  parts.push('</svg>');
  return parts.join('');
}

const formatValue = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));
