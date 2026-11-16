import type { FastifyInstance } from 'fastify';
import { audit, type Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import { bodyOf, requireAdmin } from './departments.ts';
import type { LookupKind } from './lookups.ts';

/**
 * פרמטרי המערכת של החברה — שורת settings אחת עם key='params' (ראו 002_seed.sql).
 * הם פר חברה במובן המוחלט: לקי טלקום יכול להיות "משך טיפול חובה" ולסדקום לא,
 * ולכן כל קריאה וכתיבה כאן עוברות ב-company_id של ההקשר.
 *
 * הכלל החשוב: הסכמה סגורה. מפתח שלא מופיע ב-PARAM_FIELDS נדחה ב-400 ולא נשמר
 * "ליתר ביטחון", וערך לא תקין (מספר מחוץ לטווח, מזהה סטטוס שלא קיים או לא סוגר
 * קריאה) נדחה גם הוא. כך הטופס לא מרחיב את הסכמה בשקט בכל גרסה.
 */

type ParamType = 'bool' | 'int' | 'text' | 'lookup';
type ParamGroup = 'defaults' | 'required' | 'list' | 'signature' | 'notify' | 'security';

export interface ParamField {
  key: string;
  group: ParamGroup;
  type: ParamType;
  he: string;
  en: string;
  /** שורת ההסבר שמופיעה מתחת לכל מתג במסך הפרמטרים. */
  helpHe: string;
  helpEn: string;
  default: boolean | number | string | null;
  lookupKind?: LookupKind;
  /** סטטוס שחייב להיות סטטוס סוגר (is_closing). */
  closing?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
}

export const PARAM_GROUPS: { group: ParamGroup; he: string; en: string }[] = [
  { group: 'defaults', he: 'ברירות מחדל לקריאה', en: 'Call defaults' },
  { group: 'required', he: 'שדות חובה בפתיחת קריאה', en: 'Required fields' },
  { group: 'list', he: 'רשימת הקריאות', en: 'Call list' },
  { group: 'signature', he: 'חתימת לקוח', en: 'Customer signature' },
  { group: 'notify', he: 'יומן והודעות', en: 'Log and messages' },
  { group: 'security', he: 'אבטחה', en: 'Security' },
];

export const PARAM_FIELDS: ParamField[] = [
  {
    key: 'defaultStatusNew',
    group: 'defaults',
    type: 'lookup',
    lookupKind: 'call_status',
    he: 'סטטוס של קריאה חדשה',
    en: 'Status of a new call',
    helpHe: 'הסטטוס שנבחר אוטומטית כשנפתחת קריאה.',
    helpEn: 'The status selected automatically when a call is opened.',
    default: null,
  },
  {
    key: 'defaultStatusClose',
    group: 'defaults',
    type: 'lookup',
    lookupKind: 'call_status',
    closing: true,
    he: 'סטטוס סגירה',
    en: 'Closing status',
    helpHe: 'הסטטוס שנבחר בלחיצה על "סגור קריאה". חייב להיות סטטוס שסוגר קריאה.',
    helpEn: 'The status used by "close call". Must be a status that closes the call.',
    default: null,
  },
  {
    key: 'markDelayMinutes',
    group: 'defaults',
    type: 'int',
    min: 0,
    max: 1440,
    he: 'דקות עד סימון קריאה כמתעכבת',
    en: 'Minutes before a call is marked delayed',
    helpHe: '0 מכבה את הסימון. קריאה שלא נגעו בה יותר מהזמן הזה מסומנת ברשימה.',
    helpEn: '0 turns it off. A call untouched for longer is flagged in the list.',
    default: 0,
  },
  {
    key: 'requireCallType',
    group: 'required',
    type: 'bool',
    he: 'סוג קריאה',
    en: 'Call type',
    helpHe: 'אי אפשר לשמור קריאה בלי לבחור סוג.',
    helpEn: 'A call cannot be saved without a type.',
    default: true,
  },
  {
    key: 'requireDetails',
    group: 'required',
    type: 'bool',
    he: 'תיאור התקלה',
    en: 'Details',
    helpHe: 'מחייב למלא את גוף הקריאה ולא רק את הנושא.',
    helpEn: 'Forces the details field, not just the subject.',
    default: false,
  },
  {
    key: 'requireBillingStatus',
    group: 'required',
    type: 'bool',
    he: 'סטטוס חיוב',
    en: 'Billing status',
    helpHe: 'מחייב לבחור הסכם שירות או לחיוב בפתיחת הקריאה.',
    helpEn: 'Forces choosing service agreement or billable when opening a call.',
    default: false,
  },
  {
    key: 'requireDuration',
    group: 'required',
    type: 'bool',
    he: 'משך טיפול',
    en: 'Duration',
    helpHe: 'מחייב לבחור משך טיפול; ממנו נגזרת שורת השעות האוטומטית.',
    helpEn: 'Forces a duration; the automatic hours line is derived from it.',
    default: true,
  },
  {
    key: 'listShowOnlyOpen',
    group: 'list',
    type: 'bool',
    he: 'להציג קריאות פתוחות בלבד',
    en: 'Show open calls only',
    helpHe: 'כך נפתחת הרשימה; הנציג יכול להוסיף סגורות בכל רגע.',
    helpEn: 'How the list opens; an agent can add closed calls at any time.',
    default: true,
  },
  {
    key: 'listShowTime',
    group: 'list',
    type: 'bool',
    he: 'להציג שעה ליד התאריך',
    en: 'Show the time next to the date',
    helpHe: 'כשכבוי מוצג תאריך בלבד, והרשימה צרה יותר.',
    helpEn: 'When off only the date is shown and the list is narrower.',
    default: true,
  },
  {
    key: 'listDescending',
    group: 'list',
    type: 'bool',
    he: 'הקריאה החדשה בראש',
    en: 'Newest call first',
    helpHe: 'מיון יורד לפי מספר הקריאה.',
    helpEn: 'Sorts by call number, descending.',
    default: true,
  },
  {
    key: 'signatureDefaultText',
    group: 'signature',
    type: 'text',
    maxLength: 300,
    he: 'נוסח ברירת המחדל לחתימה',
    en: 'Default signature text',
    helpHe: 'הטקסט שמוצג ללקוח מעל שדה החתימה.',
    helpEn: 'The text shown to the customer above the signature field.',
    default: 'מאשר ביצוע לשביעות רצוני',
  },
  {
    key: 'sendRemarksLog',
    group: 'notify',
    type: 'bool',
    he: 'לצרף את יומן ההערות להודעה ללקוח',
    en: 'Include the remarks log in messages to the customer',
    helpHe: 'כשכבוי נשלח רק עדכון הסטטוס, בלי ההערות שנכתבו בקריאה.',
    helpEn: 'When off only the status update is sent, without the remarks.',
    default: true,
  },
  {
    key: 'contactCanOnlyOpen',
    group: 'notify',
    type: 'bool',
    he: 'איש קשר יכול לפתוח קריאה בלבד',
    en: 'Contacts may only open calls',
    helpHe: 'בפורטל הלקוחות: פתיחת קריאה כן, צפייה בהיסטוריה לא.',
    helpEn: 'In the customer portal: opening a call yes, browsing history no.',
    default: false,
  },
  {
    key: 'idleLogoutMinutes',
    group: 'security',
    type: 'int',
    min: 5,
    max: 1440,
    he: 'ניתוק אוטומטי בחוסר פעילות (דקות)',
    en: 'Automatic sign-out after inactivity (minutes)',
    helpHe: 'דורס את ברירת המחדל של השרת, לחברה הזו בלבד.',
    helpEn: "Overrides the server default, for this company only.",
    default: 45,
  },
];

const BY_KEY = new Map(PARAM_FIELDS.map((f) => [f.key, f]));

export type ParamValues = Record<string, boolean | number | string | null>;

export const paramDefaults = (): ParamValues =>
  Object.fromEntries(PARAM_FIELDS.map((f) => [f.key, f.default])) as ParamValues;

export function registerParamsRoutes(app: FastifyInstance, ctx: Ctx): void {
  async function load(): Promise<ParamValues> {
    const { rows } = await ctx.db.query<{ value: ParamValues }>(
      "SELECT value FROM settings WHERE company_id = $1 AND key = 'params'",
      [ctx.companyId],
    );
    const stored = rows[0]?.value ?? {};
    // ברירות מחדל ראשונות, ואז מה שנשמר — כך מפתח חדש בקוד מופיע מיד בלי מיגרציה
    const out = paramDefaults();
    for (const field of PARAM_FIELDS) {
      if (stored[field.key] !== undefined) out[field.key] = stored[field.key]!;
    }
    return out;
  }

  /** בדיקה אחת לכל שדה, לפי הטיפוס שלו. זורקת 400 מפורש בעברית. */
  async function validate(key: string, raw: unknown): Promise<boolean | number | string | null> {
    const field = BY_KEY.get(key);
    if (!field) throw badRequest(`פרמטר לא מוכר: ${key}`);
    if (field.type === 'bool') {
      if (typeof raw !== 'boolean') throw badRequest(`${field.he}: צריך כן או לא`);
      return raw;
    }
    if (field.type === 'int') {
      const n = Number(raw);
      const min = field.min ?? 0;
      const max = field.max ?? 100000;
      if (!Number.isInteger(n) || n < min || n > max) {
        throw badRequest(`${field.he}: מספר שלם בין ${min} ל-${max}`);
      }
      return n;
    }
    if (field.type === 'text') {
      if (raw === null || raw === '') return '';
      if (typeof raw !== 'string') throw badRequest(`${field.he}: צריך טקסט`);
      const v = raw.trim();
      if (v.length > (field.maxLength ?? 300)) throw badRequest(`${field.he}: ארוך מדי`);
      return v;
    }
    // lookup: המזהה חייב להיות ערך פעיל מהסוג הנכון, ובטווח הראייה של החברה
    if (raw === null || raw === '') return null;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw badRequest(`${field.he}: בחירה לא תקינה`);
    const { rows } = await ctx.db.query<{ is_closing: boolean | null }>(
      `SELECT is_closing FROM lookups
        WHERE id = $1 AND kind = $2 AND active AND (company_id IS NULL OR company_id = $3)`,
      [id, field.lookupKind, ctx.companyId],
    );
    const row = rows[0];
    if (!row) throw badRequest(`${field.he}: הערך שנבחר אינו קיים או אינו פעיל בחברה הזו`);
    if (field.closing && !row.is_closing) throw badRequest(`${field.he}: צריך לבחור סטטוס שסוגר קריאה`);
    return id;
  }

  /**
   * המסך מקבל גם את הערכים וגם את תיאור השדות, כדי שיוצג כרשימת מתגים
   * מקובצת עם שורת הסבר לכל אחד — ולא כגריד של key/value.
   */
  app.get('/api/params', async () => ({
    values: await load(),
    groups: PARAM_GROUPS.map((g) => ({ group: g.group, label: ctx.lang === 'en' ? g.en : g.he })),
    fields: PARAM_FIELDS.map((f) => ({
      key: f.key,
      group: f.group,
      type: f.type,
      label: ctx.lang === 'en' ? f.en : f.he,
      help: ctx.lang === 'en' ? f.helpEn : f.helpHe,
      lookupKind: f.lookupKind ?? null,
      closingOnly: f.closing === true,
      min: f.min ?? null,
      max: f.max ?? null,
    })),
  }));

  /**
   * שמירה חלקית: נשלחים רק הפרמטרים שהשתנו. מה שלא מוכר נדחה, ומה שעבר
   * בדיקה נכתב על שורת ה-params של החברה בלבד. ביומן נרשם רק מה שבאמת זז.
   */
  app.put('/api/params', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const incoming = (b.values && typeof b.values === 'object' ? b.values : b) as Record<string, unknown>;
    const keys = Object.keys(incoming);
    if (!keys.length) throw badRequest('אין מה לעדכן');

    const current = await load();
    const next: ParamValues = { ...current };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of keys) {
      const value = await validate(key, incoming[key]);
      if (current[key] !== value) changes[key] = { from: current[key] ?? null, to: value };
      next[key] = value;
    }
    await ctx.db.query(
      `INSERT INTO settings (company_id, key, value) VALUES ($1, 'params', $2::jsonb)
       ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [ctx.companyId, JSON.stringify(next)],
    );
    if (Object.keys(changes).length) await audit(ctx, 'params.update', null, changes, req.ip);
    return { values: next, changed: Object.keys(changes) };
  });
}
