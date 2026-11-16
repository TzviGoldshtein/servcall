/**
 * השאילתות של הדו"חות. כל אחת מתחילה ב-company_id של ההקשר, וכל אחת מצרפת
 * את clients בכינוי `cl` ואת סטטוס הקריאה בכינוי `ls`, כי תנאי הסינון
 * (filters.ts) מסתמכים על הכינויים האלה.
 *
 * הלקוחות משותפים לארבע החברות; הקריאות, השעות והחיוב לא. לכן גם כשמצטרפים
 * לטבלה משותפת, התנאי על החברה נשאר על הטבלאות הפרטיות שלה.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { config } from '../config.ts';
import type { Ctx } from '../context.ts';
import { localName, type Lang } from '../i18n.ts';
import { deriveTheme } from '../theme.ts';
import { callWhere, hoursWhere, sqlBuilder, type ReportFilters } from './filters.ts';

// --------------------------------------------------------------- החברה

export interface CompanyRow {
  id: number;
  code: string;
  name: string;
  name_en: string | null;
  brand_primary: string;
  brand_accent: string | null;
  primary_target: number;
  logo_path: string | null;
}

export async function fetchCompany(ctx: Ctx): Promise<CompanyRow> {
  const { rows } = await ctx.db.query<CompanyRow>(
    'SELECT id, code, name, name_en, brand_primary, brand_accent, primary_target, logo_path ' +
      'FROM companies WHERE id = $1',
    [ctx.companyId],
  );
  const row = rows[0];
  if (!row) throw new Error(`company ${ctx.companyId} not found`);
  return row;
}

/** צבעי הכותרת של הדו"ח, מאותה גזירה שהדפדפן מקבל. */
export const brandOf = (company: CompanyRow): { primary: string; onPrimary: string; accent: string } => {
  const theme = deriveTheme({
    primary: company.brand_primary,
    accent: company.brand_accent,
    primaryTarget: company.primary_target,
  });
  return { primary: theme.primary, onPrimary: theme.onPrimary, accent: theme.accent };
};

const logoCache = new Map<string, { at: number; uri: string | null }>();
const LOGO_TTL_MS = 5 * 60 * 1000;

/**
 * הלוגו מוטמע בדו"ח כ-data URI: ה-PDF נטען מקובץ מקומי בלי רשת, ולכן קישור
 * לא היה נפתר. חסר לוגו — הכותרת נופלת לריבוע עם שתי אותיות, לא נשברת.
 */
export async function logoDataUri(company: CompanyRow): Promise<string | null> {
  const p = company.logo_path;
  if (!p) return null;
  const hit = logoCache.get(p);
  if (hit && Date.now() - hit.at < LOGO_TTL_MS) return hit.uri;
  const candidates = isAbsolute(p) ? [p] : [join(config.mediaDir, p), join(config.webDir, p)];
  let uri: string | null = null;
  for (const file of candidates) {
    try {
      const buf = await readFile(file);
      const ext = file.toLowerCase().split('.').pop() ?? '';
      const mime =
        ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      uri = `data:${mime};base64,${buf.toString('base64')}`;
      break;
    } catch {
      // ממשיכים למועמד הבא
    }
  }
  logoCache.set(p, { at: Date.now(), uri });
  return uri;
}

// --------------------------------------------------------- טבלאות קוד

export type LookupKind = 'call_type' | 'call_status' | 'billing_status' | 'duration' | 'hour_type' | 'service_type';

export interface LookupRow {
  id: number;
  kind: LookupKind;
  name: string;
  name_en: string | null;
  sort: number;
  is_closing: boolean | null;
  minutes: number | null;
  counts_in_bank: boolean | null;
}

/** ערכי טבלת קוד: המשותפים (company_id IS NULL) ואלה של החברה הפעילה. */
export async function fetchLookups(ctx: Ctx, kinds: LookupKind[]): Promise<LookupRow[]> {
  const { rows } = await ctx.db.query<LookupRow>(
    'SELECT id, kind, name, name_en, sort, is_closing, minutes, counts_in_bank FROM lookups ' +
      'WHERE kind = ANY($1::text[]) AND (company_id IS NULL OR company_id = $2) AND active ' +
      'ORDER BY kind, sort, id',
    [kinds, ctx.companyId],
  );
  return rows;
}

/** סדר העמודות בפיבוט נקבע מטבלת הקוד, כדי ששתי חברות יראו את אותו סדר. */
export const lookupOrder = (rows: LookupRow[], kind: LookupKind, lang: Lang): string[] =>
  rows.filter((r) => r.kind === kind).map((r) => localName(r, lang));

// --------------------------------------------------------------- קריאות

const OWNER_NAME = (alias: string) =>
  `NULLIF(TRIM(COALESCE(${alias}.first_name,'') || ' ' || COALESCE(${alias}.last_name,'')), '')`;

const CALL_JOINS = `
  FROM service_calls sc
  JOIN clients cl ON cl.id = sc.client_id
  LEFT JOIN client_groups cg ON cg.id = cl.group_id
  LEFT JOIN users ow ON ow.id = sc.owner_user_id
  LEFT JOIN lookups lt ON lt.id = sc.type_id
  JOIN lookups ls ON ls.id = sc.status_id
  LEFT JOIN lookups lb ON lb.id = sc.billing_status_id
  LEFT JOIN lookups ld ON ld.id = sc.duration_id`;

export interface CallFact {
  id: number;
  number: number;
  client_id: number;
  client_name: string;
  group_name: string | null;
  owner_name: string | null;
  type_name: string | null;
  type_name_en: string | null;
  status_name: string;
  status_name_en: string | null;
  is_closing: boolean | null;
  duration_name: string | null;
  duration_name_en: string | null;
  billing_name: string | null;
  billing_name_en: string | null;
}

/** השורות שמהן נבנים הפיבוטים והגרפים — רק המידות, בלי הטקסטים הארוכים. */
export async function fetchCallFacts(ctx: Ctx, f: ReportFilters): Promise<CallFact[]> {
  const b = sqlBuilder();
  const where = callWhere(b, ctx.companyId, f);
  const { rows } = await ctx.db.query<CallFact>(
    `SELECT sc.id, sc.number, cl.id AS client_id, cl.name AS client_name, cg.name AS group_name,
            ${OWNER_NAME('ow')} AS owner_name,
            lt.name AS type_name, lt.name_en AS type_name_en,
            ls.name AS status_name, ls.name_en AS status_name_en, ls.is_closing,
            ld.name AS duration_name, ld.name_en AS duration_name_en,
            lb.name AS billing_name, lb.name_en AS billing_name_en
     ${CALL_JOINS}
     WHERE ${where}
     ORDER BY sc.number`,
    b.values,
  );
  return rows;
}

export interface CallRow extends CallFact {
  subject: string;
  details: string | null;
  contact_name: string | null;
  contact_mobile: string | null;
  city: string | null;
  street: string | null;
  house_no: string | null;
  apartment: string | null;
  open_at: string;
  closed_at: string | null;
  updated_at: string | null;
  open_by_name: string | null;
  updated_by_name: string | null;
  closed_by_name: string | null;
  source: string;
  minutes: number | null;
}

/** השורות המלאות — לאיתור קריאות, לדו"ח המפורט ולהיסטוריית לקוח. */
export async function fetchCallRows(ctx: Ctx, f: ReportFilters, cap?: number): Promise<CallRow[]> {
  const b = sqlBuilder();
  const where = callWhere(b, ctx.companyId, f);
  const limit = f.limit ?? cap ?? null;
  const { rows } = await ctx.db.query<CallRow>(
    `SELECT sc.id, sc.number, sc.subject, sc.details, sc.open_at, sc.closed_at, sc.updated_at, sc.source,
            cl.id AS client_id, cl.name AS client_name, cg.name AS group_name,
            cl.city, cl.street, cl.house_no, cl.apartment,
            ${OWNER_NAME('ow')} AS owner_name,
            ${OWNER_NAME('ct')} AS contact_name, ct.mobile AS contact_mobile,
            lt.name AS type_name, lt.name_en AS type_name_en,
            ls.name AS status_name, ls.name_en AS status_name_en, ls.is_closing,
            ld.name AS duration_name, ld.name_en AS duration_name_en, ld.minutes,
            lb.name AS billing_name, lb.name_en AS billing_name_en,
            ${OWNER_NAME('ou')} AS open_by_name,
            ${OWNER_NAME('uu')} AS updated_by_name,
            ${OWNER_NAME('cu')} AS closed_by_name
     ${CALL_JOINS}
     LEFT JOIN contacts ct ON ct.id = sc.contact_id
     LEFT JOIN users ou ON ou.id = sc.open_by
     LEFT JOIN users uu ON uu.id = sc.updated_by
     LEFT JOIN users cu ON cu.id = sc.closed_by
     WHERE ${where}
     ORDER BY sc.number${limit ? ` LIMIT ${b.add(limit)}` : ''}`,
    b.values,
  );
  return rows;
}

export interface EventRow {
  call_id: number;
  body: string | null;
  kind: string;
  created_at: string;
  author_name: string | null;
}

/** האירועים של קריאות נתונות. ההגנה על החברה נעשית בשאילתת הקריאות שקדמה. */
export async function fetchCallEvents(ctx: Ctx, callIds: number[]): Promise<EventRow[]> {
  if (!callIds.length) return [];
  const { rows } = await ctx.db.query<EventRow>(
    `SELECT ce.call_id, ce.body, ce.kind, ce.created_at, ${OWNER_NAME('u')} AS author_name
     FROM call_events ce
     JOIN service_calls sc ON sc.id = ce.call_id AND sc.company_id = $2
     LEFT JOIN users u ON u.id = ce.created_by
     WHERE ce.call_id = ANY($1::bigint[])
     ORDER BY ce.call_id, ce.created_at, ce.id`,
    [callIds, ctx.companyId],
  );
  return rows;
}

/** סכום השעות לכל קריאה — נדרש בדו"ח המפורט ("משך הטיפול בפועל"). */
export async function fetchCallHourTotals(
  ctx: Ctx,
  callIds: number[],
): Promise<Map<number, { billable: number; nonBillable: number }>> {
  const out = new Map<number, { billable: number; nonBillable: number }>();
  if (!callIds.length) return out;
  const { rows } = await ctx.db.query<{ call_id: number; billable: number; non_billable: number }>(
    `SELECT ch.call_id,
            COALESCE(sum(ch.hours) FILTER (WHERE COALESCE(l.counts_in_bank, false)), 0) AS billable,
            COALESCE(sum(ch.hours) FILTER (WHERE NOT COALESCE(l.counts_in_bank, false)), 0) AS non_billable
     FROM call_hours ch
     LEFT JOIN lookups l ON l.id = ch.hour_type_id
     WHERE ch.call_id = ANY($1::bigint[]) AND ch.company_id = $2
     GROUP BY ch.call_id`,
    [callIds, ctx.companyId],
  );
  for (const r of rows) out.set(r.call_id, { billable: r.billable, nonBillable: r.non_billable });
  return out;
}

// ---------------------------------------------------------------- שעות

export interface HourRow {
  id: number;
  work_date: string;
  from_time: string | null;
  to_time: string | null;
  hours: number;
  hour_price: number;
  description: string;
  auto: boolean;
  hour_type_name: string | null;
  hour_type_name_en: string | null;
  counts_in_bank: boolean | null;
  reporter_name: string | null;
  call_id: number;
  call_number: number;
  subject: string;
  client_id: number;
  client_name: string;
  group_name: string | null;
  bank_name: string | null;
}

export async function fetchHourRows(ctx: Ctx, f: ReportFilters): Promise<HourRow[]> {
  const b = sqlBuilder();
  const where = hoursWhere(b, ctx.companyId, f);
  const { rows } = await ctx.db.query<HourRow>(
    `SELECT ch.id, ch.work_date, ch.from_time, ch.to_time, ch.hours, ch.hour_price, ch.description, ch.auto,
            lh.name AS hour_type_name, lh.name_en AS hour_type_name_en, lh.counts_in_bank,
            ${OWNER_NAME('ru')} AS reporter_name,
            sc.id AS call_id, sc.number AS call_number, sc.subject,
            cl.id AS client_id, cl.name AS client_name, cg.name AS group_name, hb.name AS bank_name
     FROM call_hours ch
     JOIN service_calls sc ON sc.id = ch.call_id AND sc.company_id = ch.company_id
     JOIN clients cl ON cl.id = sc.client_id
     LEFT JOIN client_groups cg ON cg.id = cl.group_id
     LEFT JOIN users ru ON ru.id = ch.reporter_id
     LEFT JOIN lookups lh ON lh.id = ch.hour_type_id
     LEFT JOIN hours_banks hb ON hb.id = ch.hours_bank_id AND hb.company_id = ch.company_id
     WHERE ${where}
     ORDER BY ${OWNER_NAME('ru')} NULLS LAST, ch.work_date, ch.id`,
    b.values,
  );
  return rows;
}

// ------------------------------------------------------------- לקוחות

export interface ClientRow {
  id: number;
  name: string;
  group_name: string | null;
  group_manager: string | null;
  vat_id: string | null;
  phone: string | null;
  mobile: string | null;
  city: string | null;
  street: string | null;
  house_no: string | null;
  apartment: string | null;
  hour_cost: number | null;
  call_remarks: string | null;
  active: boolean;
  open_calls: number;
  total_calls: number;
}

/**
 * רשימת הלקוחות של החברה הפעילה: אלה שיש להם הגדרות בחברה הזו, או שיש להם
 * בה קריאות. מאגר הלקוחות משותף, אבל דו"ח של סדקום לא מראה את כל הלקוחות
 * של קי טלקום.
 */
export async function fetchClients(ctx: Ctx, f: ReportFilters): Promise<ClientRow[]> {
  const b = sqlBuilder();
  const company = b.add(ctx.companyId);
  const w = [
    `(ccs.client_id IS NOT NULL OR EXISTS (SELECT 1 FROM service_calls s WHERE s.client_id = cl.id AND s.company_id = ${company}))`,
  ];
  if (f.activeOnly) w.push('cl.active AND COALESCE(ccs.active, true)');
  if (f.clientIds.length) w.push(`cl.id = ANY(${b.add(f.clientIds)}::int[])`);
  if (f.groupIds.length) w.push(`cl.group_id = ANY(${b.add(f.groupIds)}::int[])`);
  if (f.q) w.push(`cl.name ILIKE ${b.add(`%${f.q}%`)}`);
  const { rows } = await ctx.db.query<ClientRow>(
    `SELECT cl.id, cl.name, cg.name AS group_name, cg.manager AS group_manager,
            cl.vat_id, cl.phone, cl.mobile, cl.city, cl.street, cl.house_no, cl.apartment,
            ccs.hour_cost, ccs.call_remarks, (cl.active AND COALESCE(ccs.active, true)) AS active,
            (SELECT count(*) FROM service_calls s JOIN lookups l ON l.id = s.status_id
              WHERE s.client_id = cl.id AND s.company_id = ${company}
                AND COALESCE(l.is_closing, false) = false) AS open_calls,
            (SELECT count(*) FROM service_calls s
              WHERE s.client_id = cl.id AND s.company_id = ${company}) AS total_calls
     FROM clients cl
     LEFT JOIN client_groups cg ON cg.id = cl.group_id
     LEFT JOIN client_company_settings ccs ON ccs.client_id = cl.id AND ccs.company_id = ${company}
     WHERE ${w.join(' AND ')}
     ORDER BY cg.name NULLS LAST, cl.name`,
    b.values,
  );
  return rows;
}

// ------------------------------------------------- שירותים חודשיים

export interface ItemRow {
  id: number;
  name: string;
  name_en: string | null;
  price: number;
  active: boolean;
  clients: number;
}

/** קטלוג השירותים של החברה, עם כמה לקוחות משלמים על כל שירות. */
export async function fetchItems(ctx: Ctx, activeOnly = true): Promise<ItemRow[]> {
  const { rows } = await ctx.db.query<ItemRow>(
    `SELECT it.id, it.name, it.name_en, it.price, it.active,
            (SELECT count(*) FROM client_items ci
              WHERE ci.item_id = it.id AND ci.company_id = it.company_id
                AND ci.removed_at IS NULL AND ci.active) AS clients
     FROM items it
     WHERE it.company_id = $1 ${activeOnly ? 'AND it.active' : ''}
     ORDER BY it.name`,
    [ctx.companyId],
  );
  return rows;
}

export interface ClientItemRow {
  id: number;
  client_id: number;
  client_name: string;
  group_name: string | null;
  item_id: number;
  item_name: string;
  item_name_en: string | null;
  catalog_price: number;
  cost: number;
  qty: number;
  active: boolean;
  created_at: string;
  updated_at: string | null;
}

export async function fetchClientItems(ctx: Ctx, f: ReportFilters): Promise<ClientItemRow[]> {
  const b = sqlBuilder();
  const w = [`ci.company_id = ${b.add(ctx.companyId)}`, 'ci.removed_at IS NULL'];
  if (f.activeOnly) w.push('ci.active');
  if (f.clientIds.length) w.push(`ci.client_id = ANY(${b.add(f.clientIds)}::int[])`);
  if (f.groupIds.length) w.push(`cl.group_id = ANY(${b.add(f.groupIds)}::int[])`);
  if (f.itemIds.length) w.push(`ci.item_id = ANY(${b.add(f.itemIds)}::int[])`);
  if (f.q) w.push(`(cl.name ILIKE ${b.add(`%${f.q}%`)} OR it.name ILIKE ${b.add(`%${f.q}%`)})`);
  const { rows } = await ctx.db.query<ClientItemRow>(
    `SELECT ci.id, ci.client_id, cl.name AS client_name, cg.name AS group_name,
            ci.item_id, it.name AS item_name, it.name_en AS item_name_en,
            it.price AS catalog_price, ci.cost, ci.qty, ci.active, ci.created_at, ci.updated_at
     FROM client_items ci
     JOIN clients cl ON cl.id = ci.client_id
     LEFT JOIN client_groups cg ON cg.id = cl.group_id
     JOIN items it ON it.id = ci.item_id AND it.company_id = ci.company_id
     WHERE ${w.join(' AND ')}
     ORDER BY cl.name, it.name`,
    b.values,
  );
  return rows;
}

// ---------------------------------------------------------- בנק שעות

export interface BankRow {
  id: number;
  name: string;
  client_id: number;
  client_name: string;
  group_name: string | null;
  purchased: number;
  /** שעות שדווחו ונספרות בבנק — הסכום מסונן כבר כאן לפי counts_in_bank. */
  used_hours: number;
  entries: number;
  last_work_date: string | null;
  active: boolean;
}

export async function fetchHoursBanks(
  ctx: Ctx,
  opts: { clientIds?: number[]; activeOnly?: boolean; bankIds?: number[] } = {},
): Promise<BankRow[]> {
  const b = sqlBuilder();
  const w = [`hb.company_id = ${b.add(ctx.companyId)}`];
  if (opts.activeOnly !== false) w.push('hb.active');
  if (opts.clientIds?.length) w.push(`hb.client_id = ANY(${b.add(opts.clientIds)}::int[])`);
  if (opts.bankIds?.length) w.push(`hb.id = ANY(${b.add(opts.bankIds)}::int[])`);
  const { rows } = await ctx.db.query<BankRow>(
    `SELECT hb.id, hb.name, hb.client_id, cl.name AS client_name, cg.name AS group_name,
            hb.hours AS purchased, hb.active,
            COALESCE(u.hours, 0) AS used_hours, COALESCE(u.entries, 0) AS entries, u.last_work_date
     FROM hours_banks hb
     JOIN clients cl ON cl.id = hb.client_id
     LEFT JOIN client_groups cg ON cg.id = cl.group_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(sum(ch.hours) FILTER (WHERE COALESCE(l.counts_in_bank, false)), 0) AS hours,
              count(*) AS entries, max(ch.work_date) AS last_work_date
       FROM call_hours ch
       LEFT JOIN lookups l ON l.id = ch.hour_type_id
       WHERE ch.hours_bank_id = hb.id AND ch.company_id = hb.company_id
     ) u ON true
     WHERE ${w.join(' AND ')}
     ORDER BY cl.name, hb.name`,
    b.values,
  );
  return rows;
}

/** תנועות הבנק: כל דיווח שנזקף אליו. */
export async function fetchBankEntries(ctx: Ctx, bankId: number): Promise<HourRow[]> {
  const { rows } = await ctx.db.query<HourRow>(
    `SELECT ch.id, ch.work_date, ch.from_time, ch.to_time, ch.hours, ch.hour_price, ch.description, ch.auto,
            lh.name AS hour_type_name, lh.name_en AS hour_type_name_en, lh.counts_in_bank,
            ${OWNER_NAME('ru')} AS reporter_name,
            sc.id AS call_id, sc.number AS call_number, sc.subject,
            cl.id AS client_id, cl.name AS client_name, cg.name AS group_name, hb.name AS bank_name
     FROM call_hours ch
     JOIN hours_banks hb ON hb.id = ch.hours_bank_id AND hb.company_id = ch.company_id
     JOIN service_calls sc ON sc.id = ch.call_id AND sc.company_id = ch.company_id
     JOIN clients cl ON cl.id = sc.client_id
     LEFT JOIN client_groups cg ON cg.id = cl.group_id
     LEFT JOIN users ru ON ru.id = ch.reporter_id
     LEFT JOIN lookups lh ON lh.id = ch.hour_type_id
     WHERE ch.hours_bank_id = $1 AND ch.company_id = $2
     ORDER BY ch.work_date DESC, ch.id DESC`,
    [bankId, ctx.companyId],
  );
  return rows;
}

// --------------------------------------------- רשימות למסך הסינון

export interface Option {
  id: number;
  name: string;
}

export async function fetchFilterOptions(ctx: Ctx): Promise<{
  clients: Option[];
  groups: Option[];
  owners: Option[];
  reporters: Option[];
  items: Option[];
  banks: Option[];
  lookups: LookupRow[];
}> {
  const company = ctx.companyId;
  const [clients, groups, owners, items, banks, lookups] = await Promise.all([
    ctx.db.query<Option>(
      `SELECT cl.id, cl.name FROM clients cl
       LEFT JOIN client_company_settings ccs ON ccs.client_id = cl.id AND ccs.company_id = $1
       WHERE cl.active AND (ccs.client_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM service_calls s WHERE s.client_id = cl.id AND s.company_id = $1))
       ORDER BY cl.name`,
      [company],
    ),
    ctx.db.query<Option>('SELECT id, name FROM client_groups WHERE active ORDER BY name', []),
    ctx.db.query<Option>(
      `SELECT u.id, ${OWNER_NAME('u')} AS name FROM users u
       JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = $1 AND uc.active
       WHERE u.active ORDER BY name`,
      [company],
    ),
    ctx.db.query<Option>('SELECT id, name FROM items WHERE company_id = $1 AND active ORDER BY name', [company]),
    ctx.db.query<Option>(
      `SELECT hb.id, hb.name || ' — ' || cl.name AS name FROM hours_banks hb
       JOIN clients cl ON cl.id = hb.client_id
       WHERE hb.company_id = $1 AND hb.active ORDER BY cl.name, hb.name`,
      [company],
    ),
    fetchLookups(ctx, ['call_type', 'call_status', 'billing_status', 'duration', 'hour_type']),
  ]);
  return {
    clients: clients.rows,
    groups: groups.rows,
    owners: owners.rows,
    // מי שדיווח שעות בחברה הזו הוא תת-קבוצה של הנציגים; אותה רשימה משמשת לשניהם
    reporters: owners.rows,
    items: items.rows,
    banks: banks.rows,
    lookups,
  };
}
