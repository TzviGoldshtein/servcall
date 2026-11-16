/**
 * קריאות שירות — הלב של המערכת.
 *
 * כלל הברזל: קריאה שייכת לחברה אחת. המספר שלה הוא רצף פר חברה שנלקח מ-
 * `companies.call_seq_next` באותה טרנזקציה שמכניסה את הקריאה, כך ששתי קריאות
 * שנפתחות באותו רגע לא יכולות לקבל את אותו מספר (הראל מתחיל ב-17601 כי הוא
 * ממשיך את המערכת הישנה).
 *
 * קריאה משותפת (`call_links.kind = 'shared'`) נראית ומתעדכנת גם בחברה המקבלת,
 * ולכן כל שליפה כאן מסננת ב"החברה שלי או קריאה ששותפה איתי" — ולא ב-company_id
 * לבדו. השעות נושאות את החברה המדווחת, כך שהחיוב נשאר נפרד.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
// exceljs הוא CommonJS: ייבוא בשם לא עובד תחת ESM, רק ברירת המחדל
import ExcelJS from 'exceljs';
import type { Ctx } from '../context.ts';
import { audit, can } from '../context.ts';
import type { Db } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound } from '../errors.ts';
import { msg, type Lang } from '../i18n.ts';

// ---------------------------------------------------------------- עזרי בקשה

/** שגיאת הרשאה אחידה: ההודעה מגיעה מהמילון של השרת, בשפת המשתמש. */
export function requireRole(ctx: Ctx, need: Parameters<typeof can>[1]): void {
  if (!can(ctx.role, need)) throw forbidden(msg('forbidden', ctx.lang));
}

export function text(value: unknown, field: string, max = 10_000): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`חסר שדה: ${field}`);
  if (value.length > max) throw badRequest(`השדה ${field} ארוך מדי`);
  return value.trim();
}

export function optionalText(value: unknown, field: string, max = 10_000): string | null {
  return value === undefined || value === null || value === '' ? null : text(value, field, max);
}

/** מספר שלם חיובי מגוף הבקשה או מה-query. undefined = לא נשלח, null = נוקה במפורש. */
export function optionalId(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`ערך לא תקין בשדה: ${field}`);
  return n;
}

export function requiredId(value: unknown, field: string): number {
  const n = optionalId(value, field);
  if (n == null) throw badRequest(`חסר שדה: ${field}`);
  return n;
}

export function optionalBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export const idParam = (req: FastifyRequest, key = 'id'): number => {
  const raw = (req.params as Record<string, string>)[key];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('מזהה לא תקין');
  return n;
};

/**
 * צילום של ההקשר כאובייקט רגיל. ה-Ctx שמגיע לראוטים קורא את המשתמש והחברה
 * מהבקשה הרצה דרך getters; בתוך טרנזקציה צריך את אותו הקשר עם ה-db של הטרנזקציה.
 */
export const withDb = (ctx: Ctx, db: Db): Ctx => ({
  db,
  user: ctx.user,
  companyId: ctx.companyId,
  role: ctx.role,
  lang: ctx.lang,
});

/** השם המוצג של רשומת lookup לפי שפת המשתמש, ישר ב-SQL. */
export const nameExpr = (alias: string, langParam: string): string =>
  `CASE WHEN ${langParam} = 'en' AND ${alias}.name_en IS NOT NULL THEN ${alias}.name_en ELSE ${alias}.name END`;

export const personExpr = (alias: string): string =>
  `nullif(trim(coalesce(${alias}.first_name,'') || ' ' || coalesce(${alias}.last_name,'')), '')`;

// ---------------------------------------------------------------- פרמטרי חברה

/** הפרמטרים שמנהלים את התנהגות הקריאות בחברה. המקור: settings[key='params']. */
export interface Params {
  defaultStatusNew: number | null;
  defaultStatusClose: number | null;
  signatureDefaultText: string;
  listShowOnlyOpen: boolean;
  listShowTime: boolean;
  listDescending: boolean;
  /** דקות מפתיחת הקריאה שאחריהן היא מסומנת כמתעכבת. 0 = כבוי. */
  markDelayMinutes: number;
  requireCallType: boolean;
  requireDetails: boolean;
  requireBillingStatus: boolean;
  requireDuration: boolean;
  sendRemarksLog: boolean;
  contactCanOnlyOpen: boolean;
}

const PARAM_DEFAULTS: Params = {
  defaultStatusNew: null,
  defaultStatusClose: null,
  signatureDefaultText: 'מאשר ביצוע לשביעות רצוני',
  listShowOnlyOpen: true,
  listShowTime: true,
  listDescending: true,
  markDelayMinutes: 0,
  requireCallType: true,
  requireDetails: false,
  requireBillingStatus: false,
  requireDuration: true,
  sendRemarksLog: true,
  contactCanOnlyOpen: false,
};

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const flag = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const nullableId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

/** הפרמטרים של החברה, עם נפילה לברירות המחדל כשחסר מפתח. */
export async function loadParams(db: Db, companyId: number): Promise<Params> {
  const { rows } = await db.query<{ value: Record<string, unknown> }>(
    "SELECT value FROM settings WHERE company_id = $1 AND key = 'params'",
    [companyId],
  );
  const v = rows[0]?.value ?? {};
  return {
    defaultStatusNew: nullableId(v.defaultStatusNew),
    defaultStatusClose: nullableId(v.defaultStatusClose),
    signatureDefaultText:
      typeof v.signatureDefaultText === 'string' ? v.signatureDefaultText : PARAM_DEFAULTS.signatureDefaultText,
    listShowOnlyOpen: flag(v.listShowOnlyOpen, PARAM_DEFAULTS.listShowOnlyOpen),
    listShowTime: flag(v.listShowTime, PARAM_DEFAULTS.listShowTime),
    listDescending: flag(v.listDescending, PARAM_DEFAULTS.listDescending),
    markDelayMinutes: Math.max(0, num(v.markDelayMinutes, 0)),
    requireCallType: flag(v.requireCallType, PARAM_DEFAULTS.requireCallType),
    requireDetails: flag(v.requireDetails, PARAM_DEFAULTS.requireDetails),
    requireBillingStatus: flag(v.requireBillingStatus, PARAM_DEFAULTS.requireBillingStatus),
    requireDuration: flag(v.requireDuration, PARAM_DEFAULTS.requireDuration),
    sendRemarksLog: flag(v.sendRemarksLog, PARAM_DEFAULTS.sendRemarksLog),
    contactCanOnlyOpen: flag(v.contactCanOnlyOpen, PARAM_DEFAULTS.contactCanOnlyOpen),
  };
}

// ------------------------------------------------------------ שדות חובה

/** מה שאפשר לשלוח על קריאה. undefined = לא נגעו בשדה. */
export interface CallInput {
  clientId?: number | null | undefined;
  contactId?: number | null | undefined;
  ownerUserId?: number | null | undefined;
  subject?: string | null | undefined;
  details?: string | null | undefined;
  typeId?: number | null | undefined;
  statusId?: number | null | undefined;
  billingStatusId?: number | null | undefined;
  durationId?: number | null | undefined;
}

const FIELD_LABELS: Record<string, string> = {
  clientId: 'לקוח',
  subject: 'נושא',
  statusId: 'סטטוס',
  typeId: 'סוג קריאה',
  details: 'תאור',
  billingStatusId: 'סטטוס חיוב',
  durationId: 'משך טיפול',
};

/**
 * שדות החובה נקבעים בפרמטרים של החברה. לקוח, נושא וסטטוס הם חובה תמיד.
 * `current` הוא מה שכבר שמור על הקריאה, כדי שעדכון חלקי לא ייפול על שדה שלא נגעו בו.
 */
export function missingFields(params: Params, input: CallInput, current: CallInput = {}): string[] {
  const merged: CallInput = { ...current, ...strip(input) };
  const missing: string[] = [];
  const need = (key: keyof CallInput) => {
    const value = merged[key];
    if (value === undefined || value === null || value === '') missing.push(key);
  };
  need('clientId');
  need('subject');
  need('statusId');
  if (params.requireCallType) need('typeId');
  if (params.requireDetails) need('details');
  if (params.requireBillingStatus) need('billingStatusId');
  if (params.requireDuration) need('durationId');
  return missing;
}

/** מסיר מפתחות שלא נשלחו, כדי שה-spread לא ידרוס את הקיים ב-undefined. */
function strip(input: CallInput): CallInput {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) out[key] = value;
  return out as CallInput;
}

export function assertRequired(params: Params, input: CallInput, current: CallInput = {}): void {
  const missing = missingFields(params, input, current);
  if (missing.length) {
    throw badRequest('חסרים שדות חובה: ' + missing.map((k) => FIELD_LABELS[k] ?? k).join(', '));
  }
}

// ------------------------------------------------------------ מספור ולוקאפים

/**
 * מקצה את המספר הבא של החברה. ה-UPDATE נועל את שורת החברה ומחזיר את המספר
 * שנלקח — אטומי, ולכן שתי קריאות במקביל מקבלות שני מספרים שונים. חייב לרוץ
 * באותה טרנזקציה של ה-INSERT, אחרת מספר יכול "להישרף" או להיכפל.
 */
export async function allocateNumber(db: Db, companyId: number): Promise<number> {
  const { rows } = await db.query<{ number: number }>(
    'UPDATE companies SET call_seq_next = call_seq_next + 1 WHERE id = $1 RETURNING call_seq_next - 1 AS number',
    [companyId],
  );
  const row = rows[0];
  if (!row) throw notFound('החברה לא נמצאה');
  return Number(row.number);
}

export interface Lookup {
  id: number;
  kind: string;
  name: string;
  is_closing: boolean | null;
  minutes: number | null;
  std_hours: number | null;
  counts_in_bank: boolean | null;
}

/** מאמת שהערך מטבלת הקוד קיים, מהסוג הנכון ושייך לחברה (או משותף לכולן). */
export async function lookupOf(db: Db, companyId: number, id: number, kind: string): Promise<Lookup> {
  const { rows } = await db.query<Lookup>(
    'SELECT id, kind, name, is_closing, minutes, std_hours, counts_in_bank FROM lookups ' +
      'WHERE id = $1 AND kind = $2 AND (company_id IS NULL OR company_id = $3)',
    [id, kind, companyId],
  );
  const row = rows[0];
  if (!row) throw badRequest(`ערך לא תקין בטבלת הקוד: ${kind}`);
  return row;
}

const isClosing = async (db: Db, companyId: number, statusId: number): Promise<boolean> =>
  (await lookupOf(db, companyId, statusId, 'call_status')).is_closing === true;

// ------------------------------------------------------------ שעות אוטומטיות

/** התיאור של שורת השעות שנוצרת ממשך הטיפול. מזוהה גם לפי `auto = true`. */
export const AUTO_HOURS_DESCRIPTION = 'משך טיפול';

/**
 * בחירת משך טיפול יוצרת שורת שעות אוטומטית (דקות חלקי 60, "משך טיפול", לחיוב).
 * שינוי המשך מחליף אותה שורה בלבד — השורות שדווחו ביד לא נוגעים בהן לעולם.
 * השורה נושאת את החברה המדווחת, כך שבקריאה משותפת כל צד מחייב את שלו.
 */
export async function syncAutoHours(
  db: Db,
  callId: number,
  reportingCompanyId: number,
  durationId: number | null,
  ctx: Pick<Ctx, 'user'>,
): Promise<void> {
  await db.query('DELETE FROM call_hours WHERE call_id = $1 AND auto AND company_id = $2', [
    callId,
    reportingCompanyId,
  ]);
  if (durationId == null) return;
  const duration = await lookupOf(db, reportingCompanyId, durationId, 'duration');
  const minutes = duration.minutes ?? 0;
  // "טרם התחיל" ו"לקוח ממתין לשיחה" הם 0 דקות — אין מה לדווח
  if (minutes <= 0) return;
  const hours = Math.round((minutes / 60) * 100) / 100;
  await db.query(
    'INSERT INTO call_hours (call_id, company_id, work_date, reporter_id, hours, hour_price, description, hour_type_id, auto) ' +
      'SELECT $1, $2, current_date, $3, $4, ' +
      '  coalesce((SELECT ccs.hour_cost FROM service_calls sc ' +
      '    JOIN client_company_settings ccs ON ccs.client_id = sc.client_id AND ccs.company_id = $2 ' +
      '    WHERE sc.id = $1), 0), ' +
      '  $5, ' +
      // סוג השעה: "לחיוב" של אותה חברה (counts_in_bank), אחרת הראשון שיש
      '  (SELECT id FROM lookups WHERE kind = $6 AND (company_id IS NULL OR company_id = $2) AND active ' +
      '     ORDER BY counts_in_bank DESC NULLS LAST, sort LIMIT 1), ' +
      '  true',
    [callId, reportingCompanyId, ctx.user.id, hours, AUTO_HOURS_DESCRIPTION, 'hour_type'],
  );
}

// ------------------------------------------------------------ אירועי מערכת

/**
 * אירוע שהמערכת כותבת בעצמה (תאור הפתיחה, שינוי גורם מטפל, חתימה, העברה).
 * `kind = 'system'` — הממשק מציג אותו אחרת מהערה של נציג.
 */
export const systemEvent = (db: Db, callId: number, body: string, userId: number | null) =>
  db.query("INSERT INTO call_events (call_id, body, kind, created_by) VALUES ($1, $2, 'system', $3)", [
    callId,
    body,
    userId,
  ]);

const displayName = async (db: Db, userId: number | null): Promise<string> => {
  if (userId == null) return 'ללא';
  const { rows } = await db.query<{ name: string | null }>(
    `SELECT ${personExpr('u')} AS name FROM users u WHERE u.id = $1`,
    [userId],
  );
  return rows[0]?.name ?? 'ללא';
};

// ------------------------------------------------------------ קריאה בודדת

export interface CallRecord {
  id: number;
  companyId: number;
  number: number;
  clientId: number;
  contactId: number | null;
  ownerUserId: number | null;
  subject: string;
  details: string | null;
  typeId: number | null;
  statusId: number;
  billingStatusId: number | null;
  durationId: number | null;
  openAt: string;
  closedAt: string | null;
  source: string;
  /** הקריאה נראית לי כי שותפה איתי, לא כי היא שלי */
  shared: boolean;
}

const CALL_VISIBLE =
  '(sc.company_id = $2 OR EXISTS (SELECT 1 FROM call_links kl ' +
  "WHERE kl.kind = 'shared' AND kl.parent_call_id = sc.id AND kl.to_company_id = $2))";

/** שולפת קריאה שהחברה הפעילה רשאית לראות: שלה, או קריאה משותפת שהועברה אליה. */
export async function requireCall(ctx: Ctx, id: number): Promise<CallRecord> {
  const { rows } = await ctx.db.query<CallRecord>(
    'SELECT sc.id, sc.company_id AS "companyId", sc.number, sc.client_id AS "clientId", ' +
      'sc.contact_id AS "contactId", sc.owner_user_id AS "ownerUserId", sc.subject, sc.details, ' +
      'sc.type_id AS "typeId", sc.status_id AS "statusId", sc.billing_status_id AS "billingStatusId", ' +
      'sc.duration_id AS "durationId", sc.open_at AS "openAt", sc.closed_at AS "closedAt", sc.source, ' +
      '(sc.company_id <> $2) AS shared ' +
      `FROM service_calls sc WHERE sc.id = $1 AND ${CALL_VISIBLE}`,
    [id, ctx.companyId],
  );
  const row = rows[0];
  if (!row) throw notFound(msg('notFound', ctx.lang));
  return row;
}

// ------------------------------------------------------------ פתיחת קריאה

/**
 * פותחת קריאה בחברה נתונה. משמשת גם את פתיחת קריאת הבת בחברה אחרת (links.ts),
 * ולכן `companyId` מגיע כפרמטר ולא מההקשר. חייבת לרוץ בתוך טרנזקציה.
 */
export async function createCall(
  ctx: Ctx,
  companyId: number,
  input: CallInput,
  source = 'web',
): Promise<CallRecord> {
  const db = ctx.db;
  const params = await loadParams(db, companyId);
  const statusId = input.statusId ?? params.defaultStatusNew;
  const full: CallInput = { ...strip(input), statusId };
  assertRequired(params, full);

  const clientId = requiredId(full.clientId, 'לקוח');
  const subject = text(full.subject, 'נושא', 500);
  if (!statusId) throw badRequest('לא הוגדר סטטוס ברירת מחדל לחברה');
  const closing = await isClosing(db, companyId, statusId);
  if (full.typeId) await lookupOf(db, companyId, full.typeId, 'call_type');
  if (full.billingStatusId) await lookupOf(db, companyId, full.billingStatusId, 'billing_status');
  if (full.durationId) await lookupOf(db, companyId, full.durationId, 'duration');

  // המספר נלקח מהרצף של החברה בתוך אותה טרנזקציה — ראה allocateNumber
  const number = await allocateNumber(db, companyId);
  const { rows } = await db.query<{ id: number }>(
    'INSERT INTO service_calls (company_id, number, client_id, contact_id, owner_user_id, subject, details, ' +
      'type_id, status_id, billing_status_id, duration_id, open_by, source, closed_at, closed_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, ' +
      'CASE WHEN $14 THEN now() END, CASE WHEN $14 THEN $12::int END) RETURNING id',
    [
      companyId,
      number,
      clientId,
      full.contactId ?? null,
      full.ownerUserId ?? null,
      subject,
      full.details ?? null,
      full.typeId ?? null,
      statusId,
      full.billingStatusId ?? null,
      full.durationId ?? null,
      ctx.user.id,
      source,
      closing,
    ],
  );
  const id = rows[0]!.id;

  // תאור הפתיחה הוא האירוע הראשון של הקריאה, בכתיבת המערכת
  if (full.details) await systemEvent(db, id, full.details, ctx.user.id);
  if (full.durationId) await syncAutoHours(db, id, companyId, full.durationId, ctx);
  await audit(withDb(ctx, db), 'call.create', String(id), { companyId, number, clientId });
  return {
    id,
    companyId,
    number,
    clientId,
    contactId: full.contactId ?? null,
    ownerUserId: full.ownerUserId ?? null,
    subject,
    details: full.details ?? null,
    typeId: full.typeId ?? null,
    statusId,
    billingStatusId: full.billingStatusId ?? null,
    durationId: full.durationId ?? null,
    openAt: new Date().toISOString(),
    closedAt: closing ? new Date().toISOString() : null,
    source,
    shared: companyId !== ctx.companyId,
  };
}

/**
 * סוגרת קריאה: מעבירה ל-defaultStatusClose ורושמת מי סגר ומתי. זה מה שעושה
 * הכפתור "שמור אירוע וסגור קריאה", וגם סגירת האב בהעברה (transfer).
 */
export async function closeCall(ctx: Ctx, call: CallRecord): Promise<void> {
  const params = await loadParams(ctx.db, call.companyId);
  const statusId = params.defaultStatusClose;
  if (!statusId) throw badRequest('לא הוגדר סטטוס סגירה לחברה');
  await ctx.db.query(
    'UPDATE service_calls SET status_id = $2, closed_at = coalesce(closed_at, now()), ' +
      'closed_by = coalesce(closed_by, $3), updated_at = now(), updated_by = $3 WHERE id = $1',
    [call.id, statusId, ctx.user.id],
  );
  await audit(ctx, 'call.close', String(call.id), { statusId });
}

// ------------------------------------------------------------ רשימת הקריאות

const SORTABLE: Record<string, string> = {
  number: 'sc.number',
  client: 'cl.name',
  subject: 'sc.subject',
  owner: 'ow.first_name',
  type: 'ty.sort',
  status: 'st.sort',
  billing: 'bs.sort',
  openAt: 'sc.open_at',
  updatedAt: 'sc.updated_at',
  closedAt: 'sc.closed_at',
  hours: '"hoursTotal"',
};

export const PAGE_SIZE = 15;

interface ListQuery {
  page?: string;
  sort?: string;
  dir?: string;
  open?: string;
  number?: string;
  clientId?: string;
  client?: string;
  contactId?: string;
  ownerUserId?: string;
  typeId?: string;
  statusId?: string;
  billingStatusId?: string;
  durationId?: string;
  subject?: string;
  details?: string;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
  overdue?: string;
  all?: string;
}

interface ListResult {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  openOnly: boolean;
}

/**
 * הרשימה: סינון פר עמודה, מיון, ודפדוף של 15 שורות. "פתוחות בלבד" הוא ברירת
 * המחדל מהפרמטרים, וניתן לכבות אותו בכתובת. מסומנות קריאות שעברו את
 * markDelayMinutes או את תקן השעות של סוג הקריאה.
 */
async function listCalls(ctx: Ctx, query: ListQuery, params: Params, limit: number | null): Promise<ListResult> {
  const values: unknown[] = [ctx.lang, ctx.companyId, params.markDelayMinutes];
  const where: string[] = [CALL_VISIBLE];
  const add = (value: unknown): string => `$${values.push(value)}`;

  const openOnly = optionalBool(query.open) ?? params.listShowOnlyOpen;
  if (openOnly) where.push('sc.closed_at IS NULL AND st.is_closing IS NOT TRUE');

  if (query.number) where.push(`sc.number::text LIKE ${add(query.number.trim() + '%')}`);
  if (query.clientId) where.push(`sc.client_id = ${add(Number(query.clientId))}`);
  if (query.client) where.push(`cl.name ILIKE ${add('%' + query.client.trim() + '%')}`);
  if (query.contactId) where.push(`sc.contact_id = ${add(Number(query.contactId))}`);
  if (query.ownerUserId) {
    where.push(
      query.ownerUserId === 'none'
        ? 'sc.owner_user_id IS NULL'
        : `sc.owner_user_id = ${add(Number(query.ownerUserId))}`,
    );
  }
  if (query.typeId) where.push(`sc.type_id = ${add(Number(query.typeId))}`);
  if (query.statusId) where.push(`sc.status_id = ${add(Number(query.statusId))}`);
  if (query.billingStatusId) where.push(`sc.billing_status_id = ${add(Number(query.billingStatusId))}`);
  if (query.durationId) where.push(`sc.duration_id = ${add(Number(query.durationId))}`);
  if (query.subject) where.push(`sc.subject ILIKE ${add('%' + query.subject.trim() + '%')}`);
  if (query.details) where.push(`sc.details ILIKE ${add('%' + query.details.trim() + '%')}`);
  if (query.source) where.push(`sc.source = ${add(query.source)}`);
  if (query.from) where.push(`sc.open_at >= ${add(query.from)}::timestamptz`);
  if (query.to) where.push(`sc.open_at < (${add(query.to)}::date + 1)`);
  // חיפוש חופשי: מספר, נושא, תאור או שם לקוח
  if (query.q) {
    const q = add('%' + query.q.trim() + '%');
    const exact = add(Number(query.q) || 0);
    where.push(`(sc.subject ILIKE ${q} OR sc.details ILIKE ${q} OR cl.name ILIKE ${q} OR sc.number = ${exact})`);
  }

  const delayed =
    '(st.is_closing IS NOT TRUE AND sc.closed_at IS NULL AND $3::int > 0 ' +
    'AND sc.open_at < now() - make_interval(mins => $3::int))';
  const overStd =
    '(st.is_closing IS NOT TRUE AND sc.closed_at IS NULL AND ty.std_hours IS NOT NULL ' +
    'AND coalesce(hs.hours, 0) > ty.std_hours)';
  if (optionalBool(query.overdue)) where.push(`(${delayed} OR ${overStd})`);

  const sortKey = (query.sort && SORTABLE[query.sort]) ?? 'sc.open_at';
  const dir = query.dir === 'asc' ? 'ASC' : query.dir === 'desc' ? 'DESC' : params.listDescending ? 'DESC' : 'ASC';
  const page = Math.max(1, Number(query.page) || 1);

  const sql =
    'SELECT sc.id, sc.number, sc.company_id AS "companyId", (sc.company_id <> $2) AS shared, ' +
    'sc.client_id AS "clientId", cl.name AS "clientName", ' +
    `sc.contact_id AS "contactId", ${personExpr('ct')} AS "contactName", ` +
    `sc.owner_user_id AS "ownerUserId", ${personExpr('ow')} AS "ownerName", ` +
    'sc.subject, sc.details, sc.source, ' +
    `sc.type_id AS "typeId", ${nameExpr('ty', '$1')} AS "typeName", ty.std_hours AS "stdHours", ` +
    `sc.status_id AS "statusId", ${nameExpr('st', '$1')} AS "statusName", ` +
    'coalesce(st.is_closing, false) AS "statusClosing", ' +
    `sc.billing_status_id AS "billingStatusId", ${nameExpr('bs', '$1')} AS "billingStatusName", ` +
    `sc.duration_id AS "durationId", ${nameExpr('du', '$1')} AS "durationName", du.minutes AS "durationMinutes", ` +
    'sc.open_at AS "openAt", sc.updated_at AS "updatedAt", sc.closed_at AS "closedAt", ' +
    'coalesce(hs.hours, 0) AS "hoursTotal", ' +
    `${delayed} AS delayed, ${overStd} AS "overStd", ` +
    'EXISTS (SELECT 1 FROM call_links kl WHERE kl.parent_call_id = sc.id OR kl.child_call_id = sc.id) AS linked, ' +
    'count(*) OVER () AS "totalRows" ' +
    'FROM service_calls sc ' +
    'JOIN clients cl ON cl.id = sc.client_id ' +
    'JOIN lookups st ON st.id = sc.status_id ' +
    'LEFT JOIN contacts ct ON ct.id = sc.contact_id ' +
    'LEFT JOIN users ow ON ow.id = sc.owner_user_id ' +
    'LEFT JOIN lookups ty ON ty.id = sc.type_id ' +
    'LEFT JOIN lookups bs ON bs.id = sc.billing_status_id ' +
    'LEFT JOIN lookups du ON du.id = sc.duration_id ' +
    'LEFT JOIN LATERAL (SELECT sum(ch.hours) AS hours FROM call_hours ch WHERE ch.call_id = sc.id) hs ON true ' +
    `WHERE ${where.join(' AND ')} ` +
    `ORDER BY ${sortKey} ${dir} NULLS LAST, sc.id ${dir} ` +
    (limit === null ? '' : `LIMIT ${limit} OFFSET ${(page - 1) * limit}`);

  const { rows } = await ctx.db.query<Record<string, unknown>>(sql, values);
  const total = rows.length ? Number(rows[0]!.totalRows) : 0;
  for (const row of rows) delete row.totalRows;
  return { rows, total, page, pageSize: limit ?? total, openOnly };
}

// ------------------------------------------------------------ ייצוא לאקסל

const EXPORT_COLUMNS: { key: string; he: string; en: string; width: number }[] = [
  { key: 'number', he: 'מספר', en: 'Number', width: 10 },
  { key: 'openAt', he: 'נפתחה', en: 'Opened', width: 18 },
  { key: 'clientName', he: 'לקוח', en: 'Client', width: 28 },
  { key: 'contactName', he: 'איש קשר', en: 'Contact', width: 20 },
  { key: 'subject', he: 'נושא', en: 'Subject', width: 40 },
  { key: 'typeName', he: 'סוג', en: 'Type', width: 18 },
  { key: 'statusName', he: 'סטטוס', en: 'Status', width: 18 },
  { key: 'billingStatusName', he: 'חיוב', en: 'Billing', width: 16 },
  { key: 'ownerName', he: 'גורם מטפל', en: 'Owner', width: 20 },
  { key: 'durationName', he: 'משך טיפול', en: 'Duration', width: 14 },
  { key: 'hoursTotal', he: 'שעות', en: 'Hours', width: 10 },
  { key: 'closedAt', he: 'נסגרה', en: 'Closed', width: 18 },
];

/** אותו סינון של הרשימה, בקובץ אקסל. גיליון עברי נפתח מימין לשמאל. */
async function exportExcel(ctx: Ctx, query: ListQuery, params: Params): Promise<Buffer> {
  const { rows } = await listCalls(ctx, query, params, null);
  const book = new ExcelJS.Workbook();
  book.creator = 'ServCall';
  const sheet = book.addWorksheet(ctx.lang === 'en' ? 'Service calls' : 'קריאות שירות', {
    views: [{ rightToLeft: ctx.lang !== 'en', state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = EXPORT_COLUMNS.map((c) => ({
    header: ctx.lang === 'en' ? c.en : c.he,
    key: c.key,
    width: c.width,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(
        EXPORT_COLUMNS.map((c) => {
          const value = row[c.key];
          if ((c.key === 'openAt' || c.key === 'closedAt') && value) return [c.key, new Date(String(value))];
          return [c.key, value ?? ''];
        }),
      ),
    );
  }
  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ------------------------------------------------------------ הראוטים

export function registerCallRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  /** טבלאות הקוד, הפרמטרים והנציגים של החברה — מה שהטופס והרשימה צריכים. */
  app.get('/api/calls/meta', async () => {
    const params = await loadParams(db, ctx.companyId);
    const lookups = await db.query(
      `SELECT id, kind, ${nameExpr('l', '$1')} AS name, sort, is_closing AS "isClosing", minutes, ` +
        'std_hours AS "stdHours", counts_in_bank AS "countsInBank", price ' +
        'FROM lookups l WHERE (company_id IS NULL OR company_id = $2) AND active ORDER BY kind, sort, id',
      [ctx.lang, ctx.companyId],
    );
    const agents = await db.query(
      `SELECT u.id, ${personExpr('u')} AS name, uc.role FROM users u ` +
        'JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = $1 ' +
        'WHERE u.active AND uc.active ORDER BY u.first_name, u.last_name',
      [ctx.companyId],
    );
    const companies = await db.query(
      'SELECT id, code, name, name_en AS "nameEn" FROM companies WHERE active AND id <> $1 ORDER BY id',
      [ctx.companyId],
    );
    return { params, lookups: lookups.rows, agents: agents.rows, companies: companies.rows, pageSize: PAGE_SIZE };
  });

  app.get('/api/calls', async (req) => {
    const params = await loadParams(db, ctx.companyId);
    return listCalls(ctx, req.query as ListQuery, params, PAGE_SIZE);
  });

  app.get('/api/calls/export', async (req, reply) => {
    const params = await loadParams(db, ctx.companyId);
    const buffer = await exportExcel(ctx, req.query as ListQuery, params);
    await audit(ctx, 'call.export', undefined, { query: req.query });
    const name = `calls-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(buffer);
  });

  /** קריאה אחת, עם הבאנר האדום של הלקוח, סימון החריגה והקישורים לחברות אחרות. */
  app.get('/api/calls/:id', async (req) => {
    const call = await requireCall(ctx, idParam(req));
    const params = await loadParams(db, call.companyId);
    const { rows } = await db.query(
      'SELECT sc.id, sc.number, sc.company_id AS "companyId", co.name AS "companyName", ' +
        '(sc.company_id <> $3) AS shared, sc.client_id AS "clientId", cl.name AS "clientName", ' +
        'cl.phone AS "clientPhone", cl.city AS "clientCity", ' +
        // ההערה של הלקוח בחברה הזו — הבאנר האדום בטופס
        'ccs.call_remarks AS "clientRemarks", ccs.hour_cost AS "hourCost", ' +
        `sc.contact_id AS "contactId", ${personExpr('ct')} AS "contactName", ct.mobile AS "contactMobile", ` +
        'ct.email AS "contactEmail", ' +
        `sc.owner_user_id AS "ownerUserId", ${personExpr('ow')} AS "ownerName", ` +
        'sc.subject, sc.details, sc.source, ' +
        `sc.type_id AS "typeId", ${nameExpr('ty', '$2')} AS "typeName", ty.std_hours AS "stdHours", ` +
        `sc.status_id AS "statusId", ${nameExpr('st', '$2')} AS "statusName", ` +
        'coalesce(st.is_closing, false) AS "statusClosing", ' +
        `sc.billing_status_id AS "billingStatusId", ${nameExpr('bs', '$2')} AS "billingStatusName", ` +
        `sc.duration_id AS "durationId", ${nameExpr('du', '$2')} AS "durationName", du.minutes AS "durationMinutes", ` +
        'sc.open_at AS "openAt", sc.open_by AS "openBy", ' +
        `${personExpr('op')} AS "openByName", sc.updated_at AS "updatedAt", ` +
        `sc.closed_at AS "closedAt", ${personExpr('cb')} AS "closedByName", ` +
        'coalesce((SELECT sum(ch.hours) FROM call_hours ch WHERE ch.call_id = sc.id), 0) AS "hoursTotal", ' +
        '(SELECT count(*) FROM call_events ce WHERE ce.call_id = sc.id) AS "eventsCount", ' +
        '(SELECT count(*) FROM call_files cf WHERE cf.call_id = sc.id AND cf.active) AS "filesCount", ' +
        '(SELECT count(*) FROM call_signatures cs WHERE cs.call_id = sc.id) AS "signaturesCount" ' +
        'FROM service_calls sc ' +
        'JOIN companies co ON co.id = sc.company_id ' +
        'JOIN clients cl ON cl.id = sc.client_id ' +
        'JOIN lookups st ON st.id = sc.status_id ' +
        'LEFT JOIN client_company_settings ccs ON ccs.client_id = sc.client_id AND ccs.company_id = sc.company_id ' +
        'LEFT JOIN contacts ct ON ct.id = sc.contact_id ' +
        'LEFT JOIN users ow ON ow.id = sc.owner_user_id ' +
        'LEFT JOIN users op ON op.id = sc.open_by ' +
        'LEFT JOIN users cb ON cb.id = sc.closed_by ' +
        'LEFT JOIN lookups ty ON ty.id = sc.type_id ' +
        'LEFT JOIN lookups bs ON bs.id = sc.billing_status_id ' +
        'LEFT JOIN lookups du ON du.id = sc.duration_id ' +
        'WHERE sc.id = $1',
      [call.id, ctx.lang, ctx.companyId],
    );
    const row = rows[0] as Record<string, unknown>;
    const hours = Number(row.hoursTotal ?? 0);
    const std = row.stdHours == null ? null : Number(row.stdHours);
    const open = !row.statusClosing && !row.closedAt;
    const openedMinutes = (Date.now() - new Date(String(row.openAt)).getTime()) / 60_000;
    return {
      ...row,
      delayed: open && params.markDelayMinutes > 0 && openedMinutes > params.markDelayMinutes,
      overStd: open && std !== null && hours > std,
      params,
    };
  });

  /** פתיחת קריאה. המספר מוקצה בתוך הטרנזקציה, ותאור הפתיחה נרשם כאירוע הראשון. */
  app.post('/api/calls', async (req) => {
    requireRole(ctx, 'opener');
    const body = req.body as Record<string, unknown>;
    const input = readInput(body);
    const created = await db.tx((tx) => createCall(withDb(ctx, tx), ctx.companyId, input, sourceOf(body.source)));
    return created;
  });

  /**
   * עדכון קריאה. שינוי גורם מטפל רושם אירוע מערכת; שינוי משך הטיפול מחליף את
   * שורת השעות האוטומטית; סטטוס סוגר רושם מי סגר ומתי, וסטטוס פתוח מנקה את זה.
   */
  app.patch('/api/calls/:id', async (req) => {
    requireRole(ctx, 'agent');
    const call = await requireCall(ctx, idParam(req));
    const body = req.body as Record<string, unknown>;
    const input = readInput(body, true);
    const params = await loadParams(db, call.companyId);
    assertRequired(params, input, call);

    return db.tx(async (tx) => {
      const txCtx = withDb(ctx, tx);
      const next = { ...call, ...strip(input) } as CallRecord;
      if (input.typeId) await lookupOf(tx, call.companyId, input.typeId, 'call_type');
      if (input.billingStatusId) await lookupOf(tx, call.companyId, input.billingStatusId, 'billing_status');
      if (input.durationId) await lookupOf(tx, call.companyId, input.durationId, 'duration');
      const closing = await isClosing(tx, call.companyId, next.statusId);

      await tx.query(
        'UPDATE service_calls SET client_id = $2, contact_id = $3, owner_user_id = $4, subject = $5, ' +
          'details = $6, type_id = $7, status_id = $8, billing_status_id = $9, duration_id = $10, ' +
          'updated_at = now(), updated_by = $11, ' +
          'closed_at = CASE WHEN $12 THEN coalesce(closed_at, now()) ELSE NULL END, ' +
          'closed_by = CASE WHEN $12 THEN coalesce(closed_by, $11) ELSE NULL END ' +
          'WHERE id = $1',
        [
          call.id,
          next.clientId,
          next.contactId,
          next.ownerUserId,
          next.subject,
          next.details,
          next.typeId,
          next.statusId,
          next.billingStatusId,
          next.durationId,
          ctx.user.id,
          closing,
        ],
      );

      // שינוי גורם מטפל: המערכת כותבת את זה בעצמה ביומן האירועים
      if (input.ownerUserId !== undefined && input.ownerUserId !== call.ownerUserId) {
        const from = await displayName(tx, call.ownerUserId);
        const to = await displayName(tx, next.ownerUserId);
        await systemEvent(tx, call.id, `בוצע שינוי גורם מטפל מ: ${from} ל: ${to}`, ctx.user.id);
      }
      // בחירת משך טיפול יוצרת שורת שעות; שינוי מחליף אותה ולא נוגע בידניות
      if (input.durationId !== undefined && input.durationId !== call.durationId) {
        await syncAutoHours(tx, call.id, ctx.companyId, input.durationId ?? null, ctx);
      }
      await audit(txCtx, 'call.update', String(call.id), input);
      return requireCall(txCtx, call.id);
    });
  });

  /**
   * מחיקת קריאה. מחיקה אינה הדרך — עדיף סטטוס סוגר. למנהל בלבד, ורק עם
   * אישור מפורש בכתובת, כדי שלא תקרה בלחיצה אחת.
   */
  app.delete('/api/calls/:id', async (req) => {
    requireRole(ctx, 'admin');
    const call = await requireCall(ctx, idParam(req));
    if (call.shared) throw forbidden('קריאה משותפת נמחקת רק בחברה שפתחה אותה');
    if ((req.query as { confirm?: string }).confirm !== 'yes') {
      throw new HttpError(409, 'מחיקת קריאה אינה מומלצת. אשרו את הפעולה או סגרו את הקריאה במקום');
    }
    await db.query('DELETE FROM service_calls WHERE id = $1', [call.id]);
    await audit(ctx, 'call.delete', String(call.id), { number: call.number });
    return { ok: true };
  });
}

const SOURCES = new Set(['web', 'whatsapp', 'email', 'portal', 'import']);
const sourceOf = (value: unknown): string => (typeof value === 'string' && SOURCES.has(value) ? value : 'web');

/** קורא את שדות הקריאה מגוף הבקשה. ב-patch שדה שלא נשלח נשאר כמו שהוא. */
function readInput(body: Record<string, unknown>, partial = false): CallInput {
  const has = (key: string) => !partial || key in body;
  return {
    clientId: has('clientId') ? optionalId(body.clientId, 'לקוח') : undefined,
    contactId: has('contactId') ? optionalId(body.contactId, 'איש קשר') : undefined,
    ownerUserId: has('ownerUserId') ? optionalId(body.ownerUserId, 'גורם מטפל') : undefined,
    subject: has('subject') ? optionalText(body.subject, 'נושא', 500) : undefined,
    details: has('details') ? optionalText(body.details, 'תאור', 20_000) : undefined,
    typeId: has('typeId') ? optionalId(body.typeId, 'סוג קריאה') : undefined,
    statusId: has('statusId') ? optionalId(body.statusId, 'סטטוס') : undefined,
    billingStatusId: has('billingStatusId') ? optionalId(body.billingStatusId, 'סטטוס חיוב') : undefined,
    durationId: has('durationId') ? optionalId(body.durationId, 'משך טיפול') : undefined,
  };
}
