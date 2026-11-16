/**
 * המודל הגנרי של דו"ח. כל אחד מאחד-עשר הדו"חות נבנה לכאן, ומכאן יוצא לשלושה
 * פלטים: JSON למסך, HTML→PDF להדפסה ו-Excel. כך הכותרת האחידה, הסכומים
 * והעמודות מוגדרים פעם אחת, ואין שלוש גרסאות של אותו דו"ח שמתפצלות עם הזמן.
 */
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db.ts';
import type { Ctx } from '../context.ts';
import type { Lang } from '../i18n.ts';

/**
 * מה שמודול מסלולים מקבל מקליפת השרת. ה-Ctx נבנה פר בקשה (מי מבקש ובאיזו
 * חברה), ולכן הוא מגיע דרך `ctxOf(req)` ולא כשדה קבוע. קליפת השרת
 * (feat/core-shell) מעבירה כאן את אותו ctx שהיא בונה ב-hook האימות.
 */
export interface AppCtx {
  db: Db;
  ctxOf(req: FastifyRequest): Ctx;
}

export type Align = 'start' | 'center' | 'end';
/** גוון תא. 'red' הוא התיאור האדום של "איתור קריאות" — כך בדו"ח המקורי. */
export type Tone = 'plain' | 'red' | 'muted' | 'strong';

export interface Column {
  key: string;
  label: string;
  align?: Align;
  /** עמודה מספרית: מיושרת, מסוכמת ומקבלת פורמט מספר ב-Excel. */
  numeric?: boolean;
  /** רוחב מוצע בתווים — ל-Excel ולרמז לדפדפן. */
  width?: number;
}

export interface Cell {
  text: string;
  /** הערך הגולמי, כשהתא מספרי — Excel שומר מספר ולא מחרוזת. */
  num?: number;
  tone?: Tone;
}

export interface TableBlock {
  kind: 'table';
  title?: string;
  note?: string;
  columns: Column[];
  rows: Cell[][];
  /** שורת סכום בתחתית הטבלה. */
  total?: Cell[];
  /** שורות ביניים (סכום פר עובד מדווח) מסומנות כדי לקבל הדגשה. */
  subtotalRows?: number[];
}

/**
 * טבלה צולבת: שורות (עד שתי רמות — קבוצה ולקוח), עמודות, סכום לכל שורה,
 * סכום לכל עמודה וסכום-על. `spans` אומר לכמה שורות התא של הרמה הראשונה
 * נמתח, כדי שתא הקבוצה ימוזג אנכית מעל הלקוחות שלה.
 */
export interface PivotBlock {
  kind: 'pivot';
  title?: string;
  note?: string;
  rowHeads: string[];
  cols: string[];
  rows: PivotRow[];
  colTotals: number[];
  grandTotal: number;
  totalLabel: string;
  sumLabel: string;
}

export interface PivotRow {
  keys: string[];
  /** לכל רמת שורה: לכמה שורות התא נמתח. 0 = התא כבר מוזג בשורה שמעל. */
  spans: number[];
  values: number[];
  total: number;
}

export interface Bar {
  label: string;
  value: number;
  /** צבע קבוע (סטטוס) או ריק — ואז הגרף משתמש בצבע המשני של החברה. */
  color?: string;
}

/** גרף עמודות אופקי ממוין. במקור היו אלה עוגות תלת-ממד, בלתי קריאות בעשרות לקוחות. */
export interface ChartBlock {
  kind: 'chart';
  title: string;
  subtitle?: string;
  bars: Bar[];
  total: number;
  valueLabel: string;
}

/** "איתור קריאות": שתי שורות לכל קריאה — פרטים, ואז התיאור באדום. */
export interface CallListBlock {
  kind: 'callList';
  title?: string;
  columns: Column[];
  items: CallListItem[];
  count: number;
  countLabel: string;
}

export interface CallListItem {
  cells: Cell[];
  description: string;
  /** היסטוריית לקוח: האירועים של הקריאה מתחת לשורה האדומה. */
  events?: { when: string; who: string; body: string }[];
}

/** בלוק שדות — "פרטים נוספים" בדו"ח המפורט. */
export interface FieldsBlock {
  kind: 'fields';
  title: string;
  fields: { label: string; value: string; tone?: Tone }[];
}

/** שבירת עמוד: הדו"ח המפורט הוא עמוד לכל קריאה. */
export interface BreakBlock {
  kind: 'break';
}

export type Block = TableBlock | PivotBlock | ChartBlock | CallListBlock | FieldsBlock | BreakBlock;

/** הכותרת האחידה של כל דו"ח. */
export interface ReportHead {
  systemName: string;
  companyName: string;
  /** נתיב הלוגו כ-data URI, או null כשאין לוגו לחברה. */
  companyLogo: string | null;
  reportName: string;
  generatedAt: string;
  byLabel: string;
  byUser: string;
  /** טווח התאריכים והסינון שנבחר, כטקסט קריא. */
  filterText: string;
  brand: { primary: string; onPrimary: string; accent: string };
  lang: Lang;
  dir: 'rtl' | 'ltr';
  pageLabel: string;
}

export interface ReportResult {
  id: string;
  head: ReportHead;
  blocks: Block[];
  /** פריסה: דו"ח מפורט יוצא לאורך, טבלאות רחבות לרוחב. */
  orientation: 'portrait' | 'landscape';
}
