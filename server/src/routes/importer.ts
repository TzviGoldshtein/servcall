import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import ExcelJS from 'exceljs';
import { config } from '../config.ts';
import { audit, type Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { bodyOf, paramsOf, queryOf, requireAdmin } from './departments.ts';
import { normaliseE164 } from './contacts.ts';

/**
 * ייבוא לקוחות ואנשי קשר מאקסל — זה המסלול שבו נכנסים הנתונים מ-Loren ומקבצים
 * שהלקוח שולח. העבודה בשלושה שלבים, כמו בוואטסאפ צוות:
 *   1. העלאה (preview): הקובץ נקרא, הכותרות מזוהות, מוצעת התאמת עמודות,
 *      וכל השורות נבדקות — בלי לכתוב כלום למסד.
 *   2. אישור (run): אותו קובץ נכתב לפי ההתאמה שהמשתמש אישר, בטרנזקציה אחת.
 *   3. דו"ח שגיאות: שורה, עמודה וסיבה — גם כקובץ אקסל, כדי שיהיה מה לתקן ולהעלות מחדש.
 *
 * הלקוחות ואנשי הקשר נכתבים לטבלאות המשותפות, ומה שפר חברה (הערות לקריאה,
 * עלות שעה, דגל offline) נכתב ל-client_company_settings של החברה הפעילה בלבד.
 */

export type ImportField =
  | 'clientName'
  | 'vatId'
  | 'groupName'
  | 'phone'
  | 'phone2'
  | 'mobile'
  | 'fax'
  | 'city'
  | 'street'
  | 'houseNo'
  | 'zip'
  | 'externalId'
  | 'callRemarks'
  | 'hourCost'
  | 'offline'
  | 'contactFirstName'
  | 'contactLastName'
  | 'contactMobile'
  | 'contactPhone'
  | 'contactEmail'
  | 'contactPosition'
  | 'contactExternalId';

export interface ImportFieldInfo {
  field: ImportField;
  he: string;
  en: string;
  /** שדה פר חברה — נכתב ל-client_company_settings ולא ללקוח המשותף. */
  perCompany?: boolean;
  aliases: string[];
}

/** שמות העמודות שאנחנו מזהים לבד. ההתאמה תמיד ניתנת לשינוי במסך. */
export const IMPORT_FIELDS: ImportFieldInfo[] = [
  { field: 'clientName', he: 'שם הלקוח', en: 'Client name', aliases: ['שם לקוח', 'שם הלקוח', 'לקוח', 'client', 'client name', 'name', 'customer'] },
  { field: 'vatId', he: 'ח.פ. / עוסק', en: 'VAT id', aliases: ['חפ', 'ח.פ', 'ח.פ.', 'עוסק', 'מספר עוסק', 'ת.ז', 'vat', 'vat id', 'tax id'] },
  { field: 'groupName', he: 'קבוצת לקוחות', en: 'Client group', aliases: ['קבוצה', 'קבוצת לקוחות', 'group', 'client group'] },
  { field: 'phone', he: 'טלפון', en: 'Phone', aliases: ['טלפון', 'טלפון 1', 'phone', 'tel'] },
  { field: 'phone2', he: 'טלפון 2', en: 'Phone 2', aliases: ['טלפון 2', 'טלפון נוסף', 'phone 2', 'phone2'] },
  { field: 'mobile', he: 'נייד הלקוח', en: 'Client mobile', aliases: ['נייד', 'סלולרי', 'mobile', 'cell'] },
  { field: 'fax', he: 'פקס', en: 'Fax', aliases: ['פקס', 'fax'] },
  { field: 'city', he: 'עיר', en: 'City', aliases: ['עיר', 'ישוב', 'city'] },
  { field: 'street', he: 'רחוב', en: 'Street', aliases: ['רחוב', 'כתובת', 'street', 'address'] },
  { field: 'houseNo', he: 'מספר בית', en: 'House no.', aliases: ['מספר', 'מספר בית', 'house', 'house no'] },
  { field: 'zip', he: 'מיקוד', en: 'ZIP', aliases: ['מיקוד', 'zip', 'postal code'] },
  { field: 'externalId', he: 'מזהה בהנה"ח', en: 'Accounting id', aliases: ['מזהה', 'קוד לקוח', 'מספר לקוח', 'external id', 'code'] },
  { field: 'callRemarks', he: 'הערות לקריאה', en: 'Call remarks', perCompany: true, aliases: ['הערות', 'הערות לקריאה', 'הערה', 'remarks'] },
  { field: 'hourCost', he: 'עלות שעה', en: 'Hour cost', perCompany: true, aliases: ['עלות שעה', 'מחיר שעה', 'hour cost', 'hourly'] },
  { field: 'offline', he: 'לא מקבל הודעות', en: 'Offline', perCompany: true, aliases: ['לא מקבל הודעות', 'offline', 'ללא מיילים'] },
  { field: 'contactFirstName', he: 'איש קשר — שם פרטי', en: 'Contact first name', aliases: ['איש קשר', 'שם איש קשר', 'שם פרטי', 'contact', 'contact name', 'first name'] },
  { field: 'contactLastName', he: 'איש קשר — שם משפחה', en: 'Contact last name', aliases: ['שם משפחה', 'משפחה', 'last name', 'surname'] },
  { field: 'contactMobile', he: 'איש קשר — נייד', en: 'Contact mobile', aliases: ['נייד איש קשר', 'נייד של איש הקשר', 'contact mobile'] },
  { field: 'contactPhone', he: 'איש קשר — טלפון', en: 'Contact phone', aliases: ['טלפון איש קשר', 'contact phone'] },
  { field: 'contactEmail', he: 'איש קשר — מייל', en: 'Contact e-mail', aliases: ['מייל', 'אימייל', 'דואר אלקטרוני', 'email', 'e-mail', 'mail'] },
  { field: 'contactPosition', he: 'איש קשר — תפקיד', en: 'Contact position', aliases: ['תפקיד', 'position', 'role'] },
  { field: 'contactExternalId', he: 'איש קשר — מזהה חיצוני', en: 'Contact external id', aliases: ['מזהה איש קשר', 'contact id'] },
];

const FIELD_BY_NAME = new Map(IMPORT_FIELDS.map((f) => [f.field, f]));
const CONTACT_FIELDS: ImportField[] = [
  'contactFirstName',
  'contactLastName',
  'contactMobile',
  'contactPhone',
  'contactEmail',
  'contactPosition',
  'contactExternalId',
];

export const isImportField = (v: unknown): v is ImportField =>
  typeof v === 'string' && FIELD_BY_NAME.has(v as ImportField);

/** כותרת לצורת השוואה: בלי רווחים כפולים, סימני פיסוק ואותיות גדולות. */
const normalHeader = (raw: string): string =>
  raw
    .replace(/["'`]/g, '')
    .replace(/[.:_\-/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * התאמה אוטומטית של עמודות הקובץ לשדות שלנו. עמודה שלא זוהתה חוזרת כ-null
 * ומחכה שהמשתמש יבחר לה שדה (או ישאיר אותה בחוץ).
 */
export function suggestMapping(headers: string[]): (ImportField | null)[] {
  const taken = new Set<ImportField>();
  return headers.map((header) => {
    const key = normalHeader(header ?? '');
    if (!key) return null;
    for (const info of IMPORT_FIELDS) {
      if (taken.has(info.field)) continue;
      const names = [info.he, info.en, ...info.aliases].map(normalHeader);
      if (names.includes(key)) {
        taken.add(info.field);
        return info.field;
      }
    }
    // התאמה רופפת: כותרת שמתחילה בשם של שדה, למשל "שם הלקוח המלא". רק שמות
    // ארוכים נחשבים, אחרת "מספר מדף בארכיון" היה נתפס כ"מספר בית"
    for (const info of IMPORT_FIELDS) {
      if (taken.has(info.field)) continue;
      const names = [info.he, info.en, ...info.aliases].map(normalHeader).filter((n) => n.length >= 5);
      if (names.some((n) => key.startsWith(n))) {
        taken.add(info.field);
        return info.field;
      }
    }
    return null;
  });
}

export interface ImportIssue {
  /** מספר השורה בקובץ כפי שהוא נראה באקסל. */
  row: number;
  /** כותרת העמודה בקובץ, או השדה כשאין עמודה כזו בכלל. */
  column: string;
  field: ImportField | null;
  reason: string;
}

export interface ParsedClient {
  name: string;
  vatId: string | null;
  groupName: string | null;
  phone: string | null;
  phone2: string | null;
  mobile: string | null;
  fax: string | null;
  city: string | null;
  street: string | null;
  houseNo: string | null;
  zip: string | null;
  externalId: string | null;
  callRemarks: string | null;
  hourCost: number | null;
  offline: boolean | null;
}

export interface ParsedContact {
  firstName: string;
  lastName: string | null;
  mobile: string | null;
  mobileE164: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  externalId: string | null;
}

export interface ParsedRow {
  row: number;
  ok: boolean;
  client: ParsedClient | null;
  contact: ParsedContact | null;
  issues: ImportIssue[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 1,200 ₪ / "120.50" / 120 → מספר. undefined כשאי אפשר לקרוא את זה כמספר. */
export function parseMoney(raw: string): number | undefined {
  // סימני מטבח, רווחים ופסיקי אלפים יורדים; כל השאר חייב להיות מספר, אחרת
  // התא חוזר כשגיאה. "בערך 100" הוא לא מחיר, ואסור שייכנס בשקט כ-100.
  const cleaned = raw.replace(/[\s₪$,]/g, '');
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

const TRUE_WORDS = new Set(['כן', 'yes', 'true', '1', 'v', 'x', '✓']);
const FALSE_WORDS = new Set(['לא', 'no', 'false', '0', '-']);

export function parseBoolCell(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (!v) return undefined;
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return undefined;
}

const label = (field: ImportField, headers?: Partial<Record<ImportField, string>>): string =>
  headers?.[field] ?? FIELD_BY_NAME.get(field)?.he ?? field;

/**
 * בדיקת שורה אחת. פונקציה טהורה — אין בה מסד נתונים ואין בה בקשה — ולכן
 * היא גם מה שהבדיקות האוטומטיות מריצות. מחזירה את מה שאפשר לייבא ואת כל
 * הסיבות שבגללן אי אפשר (שורה, עמודה וסיבה).
 */
export function validateImportRow(
  row: number,
  cells: Partial<Record<ImportField, string>>,
  opts: { countryCode?: string; headers?: Partial<Record<ImportField, string>> } = {},
): ParsedRow {
  const countryCode = opts.countryCode ?? config.defaultCountryCode;
  const issues: ImportIssue[] = [];
  const add = (field: ImportField, reason: string) =>
    issues.push({ row, column: label(field, opts.headers), field, reason });
  const value = (field: ImportField): string => (cells[field] ?? '').trim();

  const name = value('clientName');
  if (!name) add('clientName', 'חסר שם לקוח');
  else if (name.length > 200) add('clientName', 'שם הלקוח ארוך מ-200 תווים');

  let vatId: string | null = null;
  const vatRaw = value('vatId');
  if (vatRaw) {
    const digits = vatRaw.replace(/\D/g, '');
    if (digits.length < 5 || digits.length > 15) add('vatId', `ח.פ. לא תקין: ${vatRaw}`);
    else vatId = digits;
  }

  let hourCost: number | null = null;
  const costRaw = value('hourCost');
  if (costRaw) {
    const parsed = parseMoney(costRaw);
    if (parsed === undefined || parsed < 0) add('hourCost', `עלות שעה לא מספרית: ${costRaw}`);
    else hourCost = parsed;
  }

  let offline: boolean | null = null;
  const offlineRaw = value('offline');
  if (offlineRaw) {
    const parsed = parseBoolCell(offlineRaw);
    if (parsed === undefined) add('offline', `צריך כן או לא, התקבל: ${offlineRaw}`);
    else offline = parsed;
  }

  // איש קשר: נכנס לייבוא רק אם מילאו עליו משהו, ואז חייב להיות לו שם פרטי
  const hasContact = CONTACT_FIELDS.some((f) => value(f) !== '');
  let contact: ParsedContact | null = null;
  if (hasContact) {
    const firstName = value('contactFirstName');
    if (!firstName) add('contactFirstName', 'מולאו פרטי איש קשר בלי שם פרטי');
    const mobileRaw = value('contactMobile');
    const mobileE164 = mobileRaw ? normaliseE164(mobileRaw, countryCode) : null;
    if (mobileRaw && !mobileE164) {
      add('contactMobile', `מספר נייד לא תקין לזיהוי בווטסאפ: ${mobileRaw}`);
    }
    const email = value('contactEmail');
    if (email && !EMAIL_RE.test(email)) add('contactEmail', `כתובת מייל לא תקינה: ${email}`);
    if (firstName) {
      contact = {
        firstName: firstName.slice(0, 60),
        lastName: value('contactLastName').slice(0, 60) || null,
        mobile: mobileRaw || null,
        mobileE164,
        phone: value('contactPhone') || null,
        email: email && EMAIL_RE.test(email) ? email.toLowerCase() : null,
        position: value('contactPosition').slice(0, 80) || null,
        externalId: value('contactExternalId').slice(0, 60) || null,
      };
    }
  }

  const ok = !issues.length;
  const client: ParsedClient | null = name
    ? {
        name,
        vatId,
        groupName: value('groupName') || null,
        phone: value('phone') || null,
        phone2: value('phone2') || null,
        mobile: value('mobile') || null,
        fax: value('fax') || null,
        city: value('city') || null,
        street: value('street') || null,
        houseNo: value('houseNo') || null,
        zip: value('zip') || null,
        externalId: value('externalId') || null,
        callRemarks: value('callRemarks') || null,
        hourCost,
        offline,
      }
    : null;
  return { row, ok, client, contact, issues };
}

/** תא של אקסל יכול להיות טקסט, מספר, תאריך, נוסחה או טקסט מעוצב. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const obj = value as { text?: unknown; result?: unknown; richText?: { text?: string }[]; hyperlink?: string };
  if (Array.isArray(obj.richText)) return obj.richText.map((p) => p.text ?? '').join('').trim();
  if (obj.text !== undefined) return cellText(obj.text);
  if (obj.result !== undefined) return cellText(obj.result);
  if (obj.hyperlink) return String(obj.hyperlink).trim();
  return '';
}

interface ImportJob {
  token: string;
  companyId: number;
  userId: number;
  fileName: string;
  sheet: string;
  headers: string[];
  mapping: (ImportField | null)[];
  rows: string[][];
  /** מספר השורה בקובץ, במקביל ל-rows. */
  rowNumbers: number[];
  issues: ImportIssue[];
  createdAt: number;
}

const JOB_TTL_MS = 30 * 60_000;
const MAX_JOBS = 20;
const MAX_ROWS = 5000;

/** העלאות שממתינות לאישור. חיות בזיכרון בלבד — ייבוא שלא אושר נשכח. */
const jobs = new Map<string, ImportJob>();

function pruneJobs(): void {
  const now = Date.now();
  for (const [token, job] of jobs) if (now - job.createdAt > JOB_TTL_MS) jobs.delete(token);
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) break;
    jobs.delete(oldest.token);
  }
}

export function registerImporterRoutes(app: FastifyInstance, ctx: Ctx): void {
  /** הקובץ נקרא פעם אחת לזיכרון; השורות הריקות נזרקות מיד. */
  async function readSheet(file: MultipartFile): Promise<{ sheet: string; headers: string[]; rows: string[][]; rowNumbers: number[] }> {
    const book = new ExcelJS.Workbook();
    try {
      // exceljs מכריז על Buffer משלו בטיפוסים שלו, ולכן ה-Buffer של node עובר בהמרה
      const buffer = (await file.toBuffer()) as unknown as Parameters<typeof book.xlsx.load>[0];
      await book.xlsx.load(buffer);
    } catch {
      throw badRequest('אי אפשר לקרוא את הקובץ. צריך קובץ אקסל (xlsx)');
    }
    const sheet = book.worksheets[0];
    if (!sheet) throw badRequest('הקובץ לא מכיל גיליונות');

    const raw: { number: number; cells: string[] }[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cellText(cell.value);
      });
      for (let i = 0; i < cells.length; i++) cells[i] = cells[i] ?? '';
      if (cells.some((c) => c !== '')) raw.push({ number: rowNumber, cells });
    });
    // שורת הכותרות היא הראשונה שיש בה לפחות שתי עמודות מלאות
    const headerIndex = raw.findIndex((r) => r.cells.filter((c) => c !== '').length >= 2);
    if (headerIndex < 0) throw badRequest('לא נמצאה שורת כותרות בקובץ');
    const headers = raw[headerIndex]!.cells.map((c) => c.trim());
    const body = raw.slice(headerIndex + 1);
    if (body.length > MAX_ROWS) throw badRequest(`הקובץ מכיל ${body.length} שורות. המקסימום לייבוא אחד הוא ${MAX_ROWS}`);
    return {
      sheet: sheet.name,
      headers,
      rows: body.map((r) => headers.map((_, i) => r.cells[i] ?? '')),
      rowNumbers: body.map((r) => r.number),
    };
  }

  /** התאמה שהגיעה מהמסך: { "0": "clientName", "3": null, ... } או מערך. */
  function readMapping(raw: unknown, headers: string[], fallback: (ImportField | null)[]): (ImportField | null)[] {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const source = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const out: (ImportField | null)[] = headers.map(() => null);
    const used = new Set<ImportField>();
    const put = (index: number, value: unknown) => {
      if (!Number.isInteger(index) || index < 0 || index >= headers.length) return;
      if (value === null || value === '' || value === undefined) return;
      if (!isImportField(value)) throw badRequest(`שדה ייבוא לא מוכר: ${String(value)}`);
      if (used.has(value)) throw badRequest(`השדה "${FIELD_BY_NAME.get(value)!.he}" הותאם ליותר מעמודה אחת`);
      used.add(value);
      out[index] = value;
    };
    if (Array.isArray(source)) source.forEach((v, i) => put(i, v));
    else for (const [key, v] of Object.entries(source as Record<string, unknown>)) put(Number(key), v);
    if (!used.has('clientName')) throw badRequest('חייבת להיות עמודה אחת שממופה לשם הלקוח');
    return out;
  }

  function cellsOf(row: string[], mapping: (ImportField | null)[]): Partial<Record<ImportField, string>> {
    const out: Partial<Record<ImportField, string>> = {};
    mapping.forEach((field, index) => {
      if (field) out[field] = row[index] ?? '';
    });
    return out;
  }

  function headerLabels(headers: string[], mapping: (ImportField | null)[]): Partial<Record<ImportField, string>> {
    const out: Partial<Record<ImportField, string>> = {};
    mapping.forEach((field, index) => {
      if (field) out[field] = headers[index] || FIELD_BY_NAME.get(field)!.he;
    });
    return out;
  }

  function parseAll(job: ImportJob, mapping: (ImportField | null)[]): ParsedRow[] {
    const headers = headerLabels(job.headers, mapping);
    return job.rows.map((row, i) =>
      validateImportRow(job.rowNumbers[i] ?? i + 2, cellsOf(row, mapping), {
        countryCode: config.defaultCountryCode,
        headers,
      }),
    );
  }

  function jobOf(token: string): ImportJob {
    pruneJobs();
    const job = jobs.get(token);
    // ייבוא שייך למי שהעלה אותו ולחברה שבה הוא עבד; לא עובר בין חברות
    if (!job || job.companyId !== ctx.companyId || job.userId !== ctx.user.id) {
      throw notFound('ההעלאה פגה. יש להעלות את הקובץ מחדש');
    }
    return job;
  }

  // ---- 1. העלאה ותצוגה מקדימה ----

  /**
   * מעלים קובץ (multipart, שדה file) ומקבלים את הכותרות, התאמה מוצעת,
   * 20 שורות ראשונות כפי שייובאו, וכל השגיאות. שום דבר לא נכתב למסד.
   */
  app.post('/api/import/clients/preview', async (req) => {
    requireAdmin(ctx);
    const file = await req.file({ limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });
    if (!file) throw badRequest('לא נשלח קובץ');
    const parsed = await readSheet(file);
    const suggested = suggestMapping(parsed.headers);
    const mapping = readMapping((file.fields?.mapping as { value?: unknown } | undefined)?.value, parsed.headers, suggested);

    const token = randomBytes(16).toString('base64url');
    const job: ImportJob = {
      token,
      companyId: ctx.companyId,
      userId: ctx.user.id,
      fileName: file.filename || 'clients.xlsx',
      sheet: parsed.sheet,
      headers: parsed.headers,
      mapping,
      rows: parsed.rows,
      rowNumbers: parsed.rowNumbers,
      issues: [],
      createdAt: Date.now(),
    };
    const rows = parseAll(job, mapping);
    job.issues = rows.flatMap((r) => r.issues);
    jobs.set(token, job);
    pruneJobs();

    return {
      token,
      sheet: job.sheet,
      fileName: job.fileName,
      headers: job.headers,
      /** ההתאמה המוצעת: שדה לכל עמודה, null = לא מיובאת. */
      mapping,
      fields: IMPORT_FIELDS.map((f) => ({
        field: f.field,
        label: ctx.lang === 'en' ? f.en : f.he,
        perCompany: f.perCompany === true,
      })),
      totals: {
        rows: rows.length,
        valid: rows.filter((r) => r.ok).length,
        invalid: rows.filter((r) => !r.ok).length,
        contacts: rows.filter((r) => r.ok && r.contact).length,
      },
      preview: rows.slice(0, 20),
      issues: job.issues.slice(0, 200),
    };
  });

  /** התאמה מחדש בלי להעלות שוב: אותו token, mapping אחר, בדיקה מחדש. */
  app.post('/api/import/clients/validate', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const job = jobOf(String(b.token ?? ''));
    const mapping = readMapping(b.mapping, job.headers, job.mapping);
    job.mapping = mapping;
    const rows = parseAll(job, mapping);
    job.issues = rows.flatMap((r) => r.issues);
    return {
      token: job.token,
      mapping,
      totals: {
        rows: rows.length,
        valid: rows.filter((r) => r.ok).length,
        invalid: rows.filter((r) => !r.ok).length,
        contacts: rows.filter((r) => r.ok && r.contact).length,
      },
      preview: rows.slice(0, 20),
      issues: job.issues.slice(0, 200),
    };
  });

  // ---- 2. ביצוע ----

  /**
   * כותב את מה שעבר בדיקה. התאמת לקוח קיים: קודם לפי מזהה ההנה"ח ואחר כך לפי
   * שם זהה (ללא תלות באותיות גדולות). שורות שגויות מדווחות ולא עוצרות את השאר.
   * updateExisting=false (ברירת מחדל) מוסיף רק חדשים ולא דורס נתון קיים.
   */
  app.post('/api/import/clients/run', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const job = jobOf(String(b.token ?? ''));
    const mapping = readMapping(b.mapping ?? job.mapping, job.headers, job.mapping);
    const updateExisting = b.updateExisting === true;
    const createGroups = b.createGroups === true;
    const rows = parseAll(job, mapping);
    const issues: ImportIssue[] = rows.flatMap((r) => r.issues);
    const stats = { clientsCreated: 0, clientsUpdated: 0, contactsCreated: 0, contactsUpdated: 0, skipped: 0 };
    const headers = headerLabels(job.headers, mapping);

    await ctx.db.tx(async (tx) => {
      const groupCache = new Map<string, number | null>();

      async function groupId(name: string, row: number): Promise<number | null> {
        const key = name.trim().toLowerCase();
        if (groupCache.has(key)) return groupCache.get(key) ?? null;
        const found = await tx.query<{ id: number }>(
          'SELECT id FROM client_groups WHERE lower(name) = $1 LIMIT 1',
          [key],
        );
        let id = found.rows[0]?.id ?? null;
        if (!id && createGroups) {
          const made = await tx.query<{ id: number }>(
            'INSERT INTO client_groups (name) VALUES ($1) RETURNING id',
            [name.trim().slice(0, 120)],
          );
          id = made.rows[0]!.id;
        }
        if (!id) {
          issues.push({
            row,
            column: headers.groupName ?? 'קבוצת לקוחות',
            field: 'groupName',
            reason: `הקבוצה "${name}" לא קיימת. יש לסמן "ליצור קבוצות חסרות" או לתקן את השם`,
          });
        }
        groupCache.set(key, id);
        return id;
      }

      for (const parsed of rows) {
        if (!parsed.ok || !parsed.client) {
          stats.skipped++;
          continue;
        }
        const c = parsed.client;
        const group = c.groupName ? await groupId(c.groupName, parsed.row) : null;

        // איתור לקוח קיים: מזהה הנה"ח קודם, ואחר כך שם זהה
        const existing = await tx.query<{ id: number }>(
          `SELECT id FROM clients
            WHERE ($1::text IS NOT NULL AND external_id = $1)
               OR ($1::text IS NULL AND lower(name) = lower($2))
            ORDER BY id LIMIT 1`,
          [c.externalId, c.name],
        );
        let clientId = existing.rows[0]?.id ?? null;

        if (clientId === null) {
          const made = await tx.query<{ id: number }>(
            `INSERT INTO clients (name, group_id, vat_id, phone, phone2, mobile, fax, city, street,
                                  house_no, zip, external_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
            [
              c.name, group, c.vatId, c.phone, c.phone2, c.mobile, c.fax, c.city, c.street,
              c.houseNo, c.zip, c.externalId, ctx.user.id,
            ],
          );
          clientId = made.rows[0]!.id;
          stats.clientsCreated++;
        } else if (updateExisting) {
          // COALESCE: תא ריק בקובץ לא מוחק נתון קיים
          await tx.query(
            `UPDATE clients SET
               group_id = COALESCE($2, group_id), vat_id = COALESCE($3, vat_id),
               phone = COALESCE($4, phone), phone2 = COALESCE($5, phone2),
               mobile = COALESCE($6, mobile), fax = COALESCE($7, fax),
               city = COALESCE($8, city), street = COALESCE($9, street),
               house_no = COALESCE($10, house_no), zip = COALESCE($11, zip),
               external_id = COALESCE($12, external_id),
               updated_at = now(), updated_by = $13
             WHERE id = $1`,
            [
              clientId, group, c.vatId, c.phone, c.phone2, c.mobile, c.fax, c.city, c.street,
              c.houseNo, c.zip, c.externalId, ctx.user.id,
            ],
          );
          stats.clientsUpdated++;
        }

        // הנתון שפר חברה — תמיד לחברה הפעילה בלבד
        await tx.query(
          `INSERT INTO client_company_settings (client_id, company_id, call_remarks, hour_cost, offline)
           VALUES ($1,$2,$3,$4,COALESCE($5,false))
           ON CONFLICT (client_id, company_id) DO UPDATE SET
             call_remarks = COALESCE(EXCLUDED.call_remarks, client_company_settings.call_remarks),
             hour_cost = COALESCE(EXCLUDED.hour_cost, client_company_settings.hour_cost),
             offline = COALESCE($5, client_company_settings.offline),
             active = true`,
          [clientId, ctx.companyId, c.callRemarks, c.hourCost, c.offline],
        );

        if (parsed.contact) {
          const ct = parsed.contact;
          // אותו איש קשר: לפי הנייד המנורמל, ואם אין — לפי שם מלא אצל אותו לקוח
          const found = await tx.query<{ id: number }>(
            `SELECT id FROM contacts
              WHERE client_id = $1
                AND (($2::text IS NOT NULL AND mobile_e164 = $2)
                     OR ($2::text IS NULL AND lower(first_name) = lower($3)
                         AND lower(COALESCE(last_name,'')) = lower(COALESCE($4,''))))
              ORDER BY id LIMIT 1`,
            [clientId, ct.mobileE164, ct.firstName, ct.lastName],
          );
          const contactId = found.rows[0]?.id ?? null;
          if (contactId === null) {
            await tx.query(
              `INSERT INTO contacts (client_id, first_name, last_name, mobile, mobile_e164, phone,
                                     email, position, external_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [clientId, ct.firstName, ct.lastName, ct.mobile, ct.mobileE164, ct.phone, ct.email, ct.position, ct.externalId],
            );
            stats.contactsCreated++;
          } else if (updateExisting) {
            await tx.query(
              `UPDATE contacts SET
                 last_name = COALESCE($2, last_name), mobile = COALESCE($3, mobile),
                 mobile_e164 = COALESCE($4, mobile_e164), phone = COALESCE($5, phone),
                 email = COALESCE($6, email), position = COALESCE($7, position),
                 external_id = COALESCE($8, external_id), active = true
               WHERE id = $1`,
              [contactId, ct.lastName, ct.mobile, ct.mobileE164, ct.phone, ct.email, ct.position, ct.externalId],
            );
            stats.contactsUpdated++;
          }
        }
      }
    });

    job.issues = issues;
    await audit(ctx, 'clients.import', undefined, { file: job.fileName, ...stats, issues: issues.length }, req.ip);
    return { ...stats, issues: issues.slice(0, 200), issuesTotal: issues.length, token: job.token };
  });

  // ---- 3. דו"ח שגיאות ----

  /** אותן שגיאות כ-JSON, או ?format=xlsx לקובץ שאפשר לשלוח למי שהכין את הקובץ. */
  app.get('/api/import/clients/:token/errors', async (req, reply: FastifyReply) => {
    requireAdmin(ctx);
    const job = jobOf(String(paramsOf(req).token ?? ''));
    if (queryOf(req).format !== 'xlsx') {
      return { fileName: job.fileName, total: job.issues.length, issues: job.issues };
    }
    const en = ctx.lang === 'en';
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet(en ? 'Errors' : 'שגיאות', {
      views: [{ rightToLeft: !en, state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = [
      { key: 'row', header: en ? 'Row' : 'שורה', width: 10 },
      { key: 'column', header: en ? 'Column' : 'עמודה', width: 26 },
      { key: 'reason', header: en ? 'Reason' : 'סיבה', width: 70 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const issue of job.issues) {
      sheet.addRow({ row: issue.row, column: issue.column, reason: issue.reason });
    }
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="import-errors.xlsx"')
      .send(buffer);
  });

  /** תבנית ריקה עם הכותרות שאנחנו מזהים לבד, כדי שלא יצטרכו לנחש. */
  app.get('/api/import/clients/template.xlsx', async (_req, reply: FastifyReply) => {
    requireAdmin(ctx);
    const en = ctx.lang === 'en';
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet(en ? 'Clients' : 'לקוחות', {
      views: [{ rightToLeft: !en, state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = IMPORT_FIELDS.map((f) => ({ key: f.field, header: en ? f.en : f.he, width: 20 }));
    sheet.getRow(1).font = { bold: true };
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="clients-template.xlsx"')
      .send(buffer);
  });
}
