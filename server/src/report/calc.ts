/**
 * החישובים של בנק השעות, פיצול לחיוב/לא לחיוב ושירותים חודשיים.
 *
 * כולם פונקציות טהורות, בלי SQL: היתרה בבנק שעות אינה נשמרת בשום מקום אלא
 * מחושבת מול השעות שדווחו, וכך גם ההכנסה החודשית. מי שסומך על עמודה שמורה
 * מגלה בסוף שנה שהיא התפצלה מהמציאות — לכן הכל נגזר מהדיווחים, ונבדק בטסטים.
 */
import { round2 } from './pivot.ts';

export { round2 };

// ---------------------------------------------------------------- בנק שעות

/** דיווח שעה בודד כפי שהוא נספר מול הבנק. */
export interface BankHourEntry {
  hours: number;
  /** lookups.counts_in_bank של סוג השעה. NULL/חסר = לא נספר בבנק. */
  countsInBank: boolean | null;
}

export type BankState = 'ok' | 'low' | 'empty' | 'negative';

export interface BankBalance {
  /** שעות שנרכשו — hours_banks.hours. */
  purchased: number;
  /** שעות שדווחו ונספרות בבנק. */
  used: number;
  balance: number;
  /** אחוז הניצול, 0..100 ומעלה. בנק בלי רכישה שדווחו עליו שעות = 100%. */
  usedPct: number;
  state: BankState;
}

export interface BankThresholds {
  /** חלק היתרה מתוך הרכישה שמתחתיו מתריעים. */
  lowPct?: number;
  /** או: יתרה בשעות שמתחתיה מתריעים, גם בבנק גדול. */
  lowHours?: number;
}

/** סכום השעות שנספרות בבנק. שעה בלי סוג אינה נספרת — אחרת היתרה הייתה נשחקת בטעות. */
export const bankUsedHours = (entries: BankHourEntry[]): number =>
  round2(entries.reduce((sum, e) => (e.countsInBank === true ? sum + (e.hours || 0) : sum), 0));

export function bankBalance(
  purchased: number,
  entries: BankHourEntry[],
  thresholds: BankThresholds = {},
): BankBalance {
  const lowPct = thresholds.lowPct ?? 0.15;
  const lowHours = thresholds.lowHours ?? 2;
  const bought = round2(purchased || 0);
  const used = bankUsedHours(entries);
  const balance = round2(bought - used);
  const usedPct = bought > 0 ? round2((used / bought) * 100) : used > 0 ? 100 : 0;

  let state: BankState = 'ok';
  if (balance < 0) state = 'negative';
  else if (balance === 0) state = 'empty';
  else if (balance <= lowHours || (bought > 0 && balance / bought <= lowPct)) state = 'low';

  return { purchased: bought, used, balance, usedPct, state };
}

/** סימון לצבע/להתראה: בנק ריק, שלילי או נמוך דורש תשומת לב. */
export const bankNeedsAttention = (b: BankBalance): boolean => b.state !== 'ok';

// ------------------------------------------------- פיצול לחיוב / לא לחיוב

/**
 * שורת דיווח שעות. בטבלת הקוד סוג השעה "לחיוב" הוא גם זה שנספר בבנק
 * (counts_in_bank), ולכן אותו דגל קובע את שתי העמודות בדו"ח.
 */
export interface HoursRow {
  reporter: string;
  hours: number;
  countsInBank: boolean | null;
}

export interface HoursSplit {
  billable: number;
  nonBillable: number;
  total: number;
}

export const splitHours = (rows: HoursRow[]): HoursSplit => {
  let billable = 0;
  let nonBillable = 0;
  for (const r of rows) {
    if (r.countsInBank === true) billable += r.hours || 0;
    else nonBillable += r.hours || 0;
  }
  return { billable: round2(billable), nonBillable: round2(nonBillable), total: round2(billable + nonBillable) };
};

export interface ReporterSplit extends HoursSplit {
  reporter: string;
}

/** התווית לדיווח בלי עובד מזוהה. נשארת בסוף הדו"ח ולא בין השמות. */
export const NO_REPORTER = '—';

/** סכומי ביניים לכל עובד מדווח, ממוינים בשם, ועוד סכום-על. */
export function splitByReporter(rows: HoursRow[]): { groups: ReporterSplit[]; grand: HoursSplit } {
  const byReporter = new Map<string, HoursRow[]>();
  for (const r of rows) {
    const key = (r.reporter ?? '').trim() || NO_REPORTER;
    const list = byReporter.get(key);
    if (list) list.push(r);
    else byReporter.set(key, [r]);
  }
  const groups = [...byReporter.entries()]
    .map(([reporter, list]) => ({ reporter, ...splitHours(list) }))
    .sort((a, b) => {
      if (a.reporter === NO_REPORTER) return 1;
      if (b.reporter === NO_REPORTER) return -1;
      return a.reporter.localeCompare(b.reporter, 'he');
    });
  return { groups, grand: splitHours(rows) };
}

// ------------------------------------------------------- שירותים חודשיים

/**
 * המחיר הקובע לשורת שירות של לקוח: מחיר שנקבע על הלקוח דוחה את מחיר הקטלוג
 * כשהוא שונה מאפס. אפס פירושו "לפי הקטלוג", לא "בחינם".
 */
export const effectivePrice = (clientCost: number | null, catalogPrice: number | null): number =>
  round2(clientCost !== null && clientCost !== 0 ? clientCost : (catalogPrice ?? 0));

export interface ServiceLine {
  cost: number | null;
  price: number | null;
  qty: number | null;
}

export const lineTotal = (line: ServiceLine): number =>
  round2(effectivePrice(line.cost, line.price) * (line.qty ?? 0));

/** סך ההכנסה החודשית מכל השירותים שהועברו. */
export const monthlyRevenue = (lines: ServiceLine[]): number =>
  round2(lines.reduce((sum, l) => sum + lineTotal(l), 0));
