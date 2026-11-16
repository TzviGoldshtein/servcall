/**
 * בונה הטבלאות הצולבות. כל הפיבוטים בדו"חות — סוג קריאה × סטטוס, קבוצה+לקוח ×
 * סטטוס וכן הלאה — עוברים כאן, ולכן הסכומים (שורה, עמודה וסכום-על) מחושבים
 * במקום אחד ונבדקים בטסטים ולא מול מסך.
 *
 * זו פונקציה טהורה: אין בה SQL ואין בה שפה. מי שקורא לה כבר תרגם קודים לשמות.
 */
import type { PivotBlock, PivotRow } from './types.ts';

export interface PivotFact {
  /** מפתחות השורה, מהרמה החיצונית לפנימית: ['קבוצה','לקוח'] או ['סוג קריאה']. */
  rowKeys: string[];
  col: string;
  /** ברירת המחדל 1 — ספירת קריאות. בדו"חות שעות מגיעות כאן שעות. */
  value?: number;
}

export interface PivotOptions {
  rowHeads: string[];
  /** סדר העמודות מטבלת הקוד. עמודה שאין בה נתון נשארת ומוצגת כאפס. */
  cols?: string[];
  totalLabel: string;
  sumLabel: string;
  title?: string;
  note?: string;
  /** מה לכתוב כשהמפתח ריק (קריאה בלי סוג, לקוח בלי קבוצה). */
  emptyLabel?: string;
}

/** מספרי שעות נסכמים בשברים; עיגול לשתי ספרות מונע 7.199999999 בסכומים. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const he = (a: string, b: string) => a.localeCompare(b, 'he');

export function buildPivot(facts: PivotFact[], opts: PivotOptions): PivotBlock {
  const empty = opts.emptyLabel ?? '—';
  const depth = Math.max(1, opts.rowHeads.length);
  const norm = (keys: string[]): string[] =>
    Array.from({ length: depth }, (_, i) => (keys[i] ?? '').trim() || empty);

  // העמודות: הסדר שהועבר, ועוד מה שהופיע בנתונים ולא נמצא ברשימה
  const cols = [...(opts.cols ?? [])];
  const colSeen = new Set(cols);
  const extra: string[] = [];
  for (const f of facts) {
    const col = (f.col ?? '').trim() || empty;
    if (!colSeen.has(col)) {
      colSeen.add(col);
      extra.push(col);
    }
  }
  extra.sort(he);
  cols.push(...extra);
  const colIndex = new Map(cols.map((c, i) => [c, i]));

  // צבירה לפי צירוף מפתחות השורה
  const bucket = new Map<string, { keys: string[]; values: number[] }>();
  for (const f of facts) {
    const keys = norm(f.rowKeys);
    const id = keys.join('\u0000');
    let row = bucket.get(id);
    if (!row) {
      row = { keys, values: cols.map(() => 0) };
      bucket.set(id, row);
    }
    const ci = colIndex.get((f.col ?? '').trim() || empty);
    if (ci === undefined) continue;
    row.values[ci] = (row.values[ci] ?? 0) + (f.value ?? 1);
  }

  const sorted = [...bucket.values()].sort((a, b) => {
    for (let i = 0; i < depth; i++) {
      const d = he(a.keys[i] ?? '', b.keys[i] ?? '');
      if (d !== 0) return d;
    }
    return 0;
  });

  const rows: PivotRow[] = sorted.map((r) => ({
    keys: r.keys,
    spans: r.keys.map(() => 1),
    values: r.values.map(round2),
    total: round2(r.values.reduce((s, v) => s + v, 0)),
  }));

  // מיזוג אנכי: תא הקבוצה נמתח על כל השורות של אותה קבוצה. הרמה האחרונה
  // (הלקוח עצמו) לא ממוזגת אף פעם.
  for (let level = 0; level < depth - 1; level++) {
    let i = 0;
    while (i < rows.length) {
      let j = i + 1;
      // שורות ממוזגות רק אם כל הרמות שמעל זהות גם הן
      const same = (a: PivotRow, b: PivotRow) => {
        for (let l = 0; l <= level; l++) if (a.keys[l] !== b.keys[l]) return false;
        return true;
      };
      while (j < rows.length && same(rows[i]!, rows[j]!)) j++;
      rows[i]!.spans[level] = j - i;
      for (let k = i + 1; k < j; k++) rows[k]!.spans[level] = 0;
      i = j;
    }
  }

  const colTotals = cols.map((_, ci) => round2(rows.reduce((s, r) => s + (r.values[ci] ?? 0), 0)));
  const grandTotal = round2(rows.reduce((s, r) => s + r.total, 0));

  return {
    kind: 'pivot',
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.note ? { note: opts.note } : {}),
    rowHeads: opts.rowHeads.length ? opts.rowHeads : ['—'],
    cols,
    rows,
    colTotals,
    grandTotal,
    totalLabel: opts.totalLabel,
    sumLabel: opts.sumLabel,
  };
}

/**
 * סיכום חד-ממדי (לפי סוג, לפי משך, לפי גורם מטפל) — אותה צבירה, בלי עמודות.
 * מחזיר שורות ממוינות בסדר יורד של הכמות, עם אחוז מהסך.
 */
export interface Tally {
  label: string;
  value: number;
  share: number;
}

export function tally(facts: { label: string; value?: number }[], emptyLabel = '—'): { rows: Tally[]; total: number } {
  const bucket = new Map<string, number>();
  for (const f of facts) {
    const key = (f.label ?? '').trim() || emptyLabel;
    bucket.set(key, (bucket.get(key) ?? 0) + (f.value ?? 1));
  }
  const total = round2([...bucket.values()].reduce((s, v) => s + v, 0));
  const rows = [...bucket.entries()]
    .map(([label, value]) => ({ label, value: round2(value), share: total ? round2((value / total) * 100) : 0 }))
    .sort((a, b) => b.value - a.value || he(a.label, b.label));
  return { rows, total };
}
