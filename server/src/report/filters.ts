/**
 * מסך הסינון של הדו"חות, בצד השרת: קריאת הפרמטרים, בדיקתם ובניית תנאי ה-SQL.
 *
 * **הכלל שאינו נשבר:** כל שאילתה מתחילה ב-company_id של ההקשר. הלקוחות
 * משותפים לארבע החברות, אבל הקריאות, השעות והחיוב אינם — ודו"ח שמראה קריאה
 * של חברה אחרת הוא דליפה, לא אי-נוחות. לכן הפילטרים אינם יכולים לקבל
 * company_id מבחוץ: הוא נלקח תמיד מ-ctx.
 */
import { badRequest } from '../errors.ts';
import type { Lang } from '../i18n.ts';
import { dateText } from './fmt.ts';
import { texts } from './texts.ts';

export interface ReportFilters {
  from: string | null;
  to: string | null;
  clientIds: number[];
  groupIds: number[];
  ownerIds: number[];
  statusIds: number[];
  typeIds: number[];
  durationIds: number[];
  billingIds: number[];
  reporterIds: number[];
  hourTypeIds: number[];
  bankIds: number[];
  itemIds: number[];
  callIds: number[];
  callNumber: number | null;
  /** רק קריאות שלא נסגרו (status.is_closing = false). */
  openOnly: boolean;
  /** דו"ח מסכם לפי לקוחות: להציג את עמודת הקבוצה. */
  showGroup: boolean;
  /** דו"ח שעות: סכומי ביניים לכל עובד מדווח. */
  subtotals: boolean;
  /** רשימות לקוחות/שירותים: רק פעילים. */
  activeOnly: boolean;
  /** חיפוש חופשי בנושא ובתיאור. */
  q: string | null;
  limit: number | null;
}

export const EMPTY_FILTERS: ReportFilters = {
  from: null,
  to: null,
  clientIds: [],
  groupIds: [],
  ownerIds: [],
  statusIds: [],
  typeIds: [],
  durationIds: [],
  billingIds: [],
  reporterIds: [],
  hourTypeIds: [],
  bankIds: [],
  itemIds: [],
  callIds: [],
  callNumber: null,
  openOnly: false,
  showGroup: true,
  subtotals: false,
  activeOnly: true,
  q: null,
  limit: null,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const asDate = (v: unknown, field: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(new Date(s).getTime())) throw badRequest(`תאריך לא תקין: ${field}`);
  return s;
};

const asIds = (v: unknown, field: string): number[] => {
  if (v === undefined || v === null || v === '') return [];
  const raw = Array.isArray(v) ? v : String(v).split(',');
  const out: number[] = [];
  for (const part of raw) {
    const n = Number(String(part).trim());
    if (!Number.isInteger(n) || n <= 0) throw badRequest(`מזהה לא תקין: ${field}`);
    out.push(n);
  }
  return [...new Set(out)];
};

const asBool = (v: unknown, dflt: boolean): boolean => {
  if (v === undefined || v === null || v === '') return dflt;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};

const asInt = (v: unknown, field: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v));
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`מספר לא תקין: ${field}`);
  return n;
};

/** קורא את מסך הסינון. מה שלא נשלח — פשוט לא מסנן. */
export function parseFilters(query: unknown): ReportFilters {
  const q = (query ?? {}) as Record<string, unknown>;
  const from = asDate(q.from, 'מתאריך');
  const to = asDate(q.to, 'עד תאריך');
  if (from && to && from > to) throw badRequest('טווח התאריכים הפוך');
  const text = q.q === undefined || q.q === null ? null : String(q.q).trim().slice(0, 120) || null;
  const limit = asInt(q.limit, 'מספר שורות');
  return {
    from,
    to,
    clientIds: asIds(q.clientId ?? q.clientIds, 'לקוח'),
    groupIds: asIds(q.groupId ?? q.groupIds, 'קבוצה'),
    ownerIds: asIds(q.ownerId ?? q.ownerIds, 'גורם מטפל'),
    statusIds: asIds(q.statusId ?? q.statusIds, 'סטטוס'),
    typeIds: asIds(q.typeId ?? q.typeIds, 'סוג קריאה'),
    durationIds: asIds(q.durationId ?? q.durationIds, 'משך טיפול'),
    billingIds: asIds(q.billingId ?? q.billingIds, 'סטטוס חיוב'),
    reporterIds: asIds(q.reporterId ?? q.reporterIds, 'עובד מדווח'),
    hourTypeIds: asIds(q.hourTypeId ?? q.hourTypeIds, 'סוג שעה'),
    bankIds: asIds(q.bankId ?? q.bankIds, 'בנק שעות'),
    itemIds: asIds(q.itemId ?? q.itemIds, 'שירות'),
    callIds: asIds(q.callId ?? q.callIds, 'קריאה'),
    callNumber: asInt(q.callNumber, 'מספר קריאה'),
    openOnly: asBool(q.openOnly, false),
    showGroup: asBool(q.showGroup, true),
    subtotals: asBool(q.subtotals, false),
    activeOnly: asBool(q.activeOnly, true),
    q: text,
    limit: limit === null ? null : Math.min(limit, 5000),
  };
}

// ------------------------------------------------------------- בניית SQL

export interface SqlBuilder {
  /** מוסיף ערך ומחזיר את מציין המקום שלו ($1, $2 …). */
  add(value: unknown): string;
  values: unknown[];
}

export const sqlBuilder = (): SqlBuilder => {
  const values: unknown[] = [];
  return {
    add: (value: unknown) => `$${values.push(value)}`,
    values,
  };
};

/**
 * תנאי הסינון על קריאות. `companyId` מגיע מההקשר והוא התנאי הראשון — תמיד.
 * `alias` הוא הכינוי של service_calls בשאילתה.
 */
export function callWhere(
  b: SqlBuilder,
  companyId: number,
  f: ReportFilters,
  alias = 'sc',
  dateColumn = 'open_at',
): string {
  const w = [`${alias}.company_id = ${b.add(companyId)}`];
  if (f.from) w.push(`${alias}.${dateColumn} >= ${b.add(f.from)}::date`);
  if (f.to) w.push(`${alias}.${dateColumn} < (${b.add(f.to)}::date + 1)`);
  if (f.clientIds.length) w.push(`${alias}.client_id = ANY(${b.add(f.clientIds)}::int[])`);
  if (f.groupIds.length) w.push(`cl.group_id = ANY(${b.add(f.groupIds)}::int[])`);
  if (f.ownerIds.length) w.push(`${alias}.owner_user_id = ANY(${b.add(f.ownerIds)}::int[])`);
  if (f.statusIds.length) w.push(`${alias}.status_id = ANY(${b.add(f.statusIds)}::int[])`);
  if (f.typeIds.length) w.push(`${alias}.type_id = ANY(${b.add(f.typeIds)}::int[])`);
  if (f.durationIds.length) w.push(`${alias}.duration_id = ANY(${b.add(f.durationIds)}::int[])`);
  if (f.billingIds.length) w.push(`${alias}.billing_status_id = ANY(${b.add(f.billingIds)}::int[])`);
  if (f.callIds.length) w.push(`${alias}.id = ANY(${b.add(f.callIds)}::bigint[])`);
  if (f.callNumber !== null) w.push(`${alias}.number = ${b.add(f.callNumber)}`);
  if (f.openOnly) w.push('COALESCE(ls.is_closing, false) = false');
  if (f.q) {
    const p = b.add(`%${f.q}%`);
    w.push(`(${alias}.subject ILIKE ${p} OR ${alias}.details ILIKE ${p})`);
  }
  return w.join(' AND ');
}

/** תנאי הסינון על דיווחי שעות. גם כאן החברה היא התנאי הראשון. */
export function hoursWhere(b: SqlBuilder, companyId: number, f: ReportFilters): string {
  const w = [`ch.company_id = ${b.add(companyId)}`];
  if (f.from) w.push(`ch.work_date >= ${b.add(f.from)}::date`);
  if (f.to) w.push(`ch.work_date <= ${b.add(f.to)}::date`);
  if (f.clientIds.length) w.push(`sc.client_id = ANY(${b.add(f.clientIds)}::int[])`);
  if (f.groupIds.length) w.push(`cl.group_id = ANY(${b.add(f.groupIds)}::int[])`);
  if (f.ownerIds.length) w.push(`sc.owner_user_id = ANY(${b.add(f.ownerIds)}::int[])`);
  if (f.reporterIds.length) w.push(`ch.reporter_id = ANY(${b.add(f.reporterIds)}::int[])`);
  if (f.hourTypeIds.length) w.push(`ch.hour_type_id = ANY(${b.add(f.hourTypeIds)}::int[])`);
  if (f.bankIds.length) w.push(`ch.hours_bank_id = ANY(${b.add(f.bankIds)}::int[])`);
  if (f.callIds.length) w.push(`ch.call_id = ANY(${b.add(f.callIds)}::bigint[])`);
  if (f.callNumber !== null) w.push(`sc.number = ${b.add(f.callNumber)}`);
  if (f.q) w.push(`ch.description ILIKE ${b.add(`%${f.q}%`)}`);
  return w.join(' AND ');
}

/** תיאור הסינון שנבחר, לכותרת הדו"ח. */
export function filterText(f: ReportFilters, lang: Lang, extra: string[] = []): string {
  const t = texts(lang);
  const parts: string[] = [];
  if (f.from || f.to) {
    const from = f.from ? dateText(f.from, lang) : '…';
    const to = f.to ? dateText(f.to, lang) : '…';
    parts.push(`${t.dateRange}: ${from} – ${to}`);
  }
  if (f.openOnly) parts.push(t.openOnly);
  if (f.q) parts.push(`"${f.q}"`);
  parts.push(...extra.filter(Boolean));
  return parts.join(' · ');
}
