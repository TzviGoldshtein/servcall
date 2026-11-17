import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../auth.ts';
import { config } from '../config.ts';
import { audit, type Ctx } from '../context.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import type { Hub } from '../http.ts';
import { msg } from '../i18n.ts';
import {
  bodyOf,
  flag,
  idOf,
  notifyShared,
  optBool,
  optEmail,
  optText,
  patchSet,
  queryOf,
  requireAdmin,
  text,
} from './departments.ts';

/**
 * אנשי קשר. יושבים מתחת ללקוח ומשותפים לכל החברות, בדיוק כמו הלקוח עצמו.
 *
 * שני דברים שחייבים להישמר כאן:
 * 1. mobile_e164 — המספר תמיד מנורמל ל-E.164 (קידומת ברירת המחדל מ-config).
 *    עליו נשען הזיהוי של הודעת ווטסאפ נכנסת, ולכן הוא נגזר תמיד מהשדה mobile
 *    בשרת ולא מתקבל מהדפדפן.
 * 2. google_name — מתמלא מאנשי הקשר של גוגל במודול אחר. כשהוא קיים הוא *השם
 *    המוצג של איש הקשר*. השם של הלקוח הוא clients.name, ואת שני אלה לא מערבבים:
 *    איש הקשר נקרא "משה כהן" והלקוח "בית ספר אורט".
 */

/**
 * נרמול ל-E.164: מחזיר '+' וספרות, או null כשאין מספר נייד שאפשר להתקשר אליו.
 * מה שמטופל: 050-1234567 → +972501234567, 00972…, +972…, 972…, וגם מספר מקומי
 * בלי אפס מוביל (501234567). מספר שירות (1-800, 1-700) וקוד מרכזייה (*2000)
 * אינם ניידים ולכן מוחזר null — אחרת ווטסאפ היה "מזהה" לקוח לפי מספר שגוי.
 */
export function normaliseE164(raw: string | null | undefined, countryCode = config.defaultCountryCode): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.includes('*') || trimmed.includes('#')) return null;

  const plus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (plus) {
    // כבר בינלאומי
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = countryCode + digits.slice(1);
  } else if (digits.startsWith(countryCode) && digits.length > countryCode.length + 6) {
    // כבר נשמר בצורה בינלאומית בלי +
  } else if (digits.startsWith('1')) {
    return null; // 1-800 / 1-700 — מספר שירות, לא נייד
  } else {
    digits = countryCode + digits;
  }

  if (!/^\d{8,15}$/.test(digits)) return null;
  return '+' + digits;
}

/** אותו מספר בצורה שבה ווטסאפ מחזיק אותו (ה-jid הוא ספרות בלי +). */
export const waDigits = (e164: string | null | undefined): string | null =>
  e164 ? e164.replace(/\D/g, '') || null : null;

/** השם המוצג של איש הקשר: קודם מה שגוגל יודע, אחרת שם פרטי + משפחה. */
export const contactDisplayName = (row: {
  google_name?: string | null;
  googleName?: string | null;
  first_name?: string | null;
  firstName?: string | null;
  last_name?: string | null;
  lastName?: string | null;
}): string => {
  const google = (row.google_name ?? row.googleName ?? '').trim();
  if (google) return google;
  const first = (row.first_name ?? row.firstName ?? '').trim();
  const last = (row.last_name ?? row.lastName ?? '').trim();
  return [first, last].filter(Boolean).join(' ');
};

const CONTACT_COLUMNS = `ct.id, ct.client_id AS "clientId", ct.first_name AS "firstName", ct.last_name AS "lastName",
       ct.google_name AS "googleName",
       COALESCE(NULLIF(TRIM(COALESCE(ct.google_name, '')), ''),
                NULLIF(TRIM(ct.first_name || ' ' || COALESCE(ct.last_name, '')), '')) AS "displayName",
       ct.national_id AS "nationalId", ct.mobile, ct.mobile_e164 AS "mobileE164",
       ct.phone, ct.phone2, ct.fax, ct.email, ct.position, ct.username,
       (ct.password_hash IS NOT NULL) AS "hasPassword", ct.read_only AS "readOnly",
       ct.external_id AS "externalId", ct.active`;

export function registerContactsRoutes(app: FastifyInstance, ctx: Ctx, hub?: Hub): void {
  /**
   * שם המשתמש של הפורטל הוא מה שאיש הקשר מקליד בכניסה, ולכן חייב להיות יחיד
   * בין כל אנשי הקשר. לסכמה אין על זה אינדקס ייחודי, אז הבדיקה כאן.
   */
  async function requireFreeUsername(username: unknown, exceptId: number | null): Promise<void> {
    if (typeof username !== 'string') return;
    const { rows } = await ctx.db.query(
      'SELECT 1 FROM contacts WHERE lower(username) = lower($1) AND id IS DISTINCT FROM $2 LIMIT 1',
      [username, exceptId],
    );
    if (rows[0]) throw new HttpError(409, 'שם המשתמש הזה כבר תפוס אצל איש קשר אחר');
  }

  async function requireClient(clientId: number): Promise<{ id: number; name: string }> {
    const { rows } = await ctx.db.query<{ id: number; name: string }>(
      'SELECT id, name FROM clients WHERE id = $1',
      [clientId],
    );
    const row = rows[0];
    if (!row) throw notFound(msg('notFound', ctx.lang));
    return row;
  }

  async function one(id: number) {
    const { rows } = await ctx.db.query(
      `SELECT ${CONTACT_COLUMNS}, c.name AS "clientName" FROM contacts ct
         JOIN clients c ON c.id = ct.client_id WHERE ct.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw notFound(msg('notFound', ctx.lang));
    return row;
  }

  /**
   * שדות איש הקשר. mobile_e164 נגזר כאן תמיד מ-mobile, גם בעדכון חלקי:
   * כשנשלח נייד חדש מתעדכן גם המנורמל, וכשהנייד נמחק המנורמל נמחק איתו.
   */
  function fields(b: Record<string, unknown>, creating: boolean): Record<string, unknown> {
    const mobile = optText(b.mobile, 'נייד', 40);
    const out: Record<string, unknown> = {
      first_name: creating || b.firstName !== undefined ? text(b.firstName, 'שם פרטי', 60) : undefined,
      last_name: optText(b.lastName, 'שם משפחה', 60),
      national_id: optText(b.nationalId, 'ת.ז.', 20),
      mobile,
      phone: optText(b.phone, 'טלפון', 40),
      phone2: optText(b.phone2, 'טלפון 2', 40),
      fax: optText(b.fax, 'פקס', 40),
      email: optEmail(b.email, 'מייל'),
      position: optText(b.position, 'תפקיד', 80),
      username: optText(b.username, 'שם משתמש לפורטל', 60),
      read_only: optBool(b.readOnly, 'צפייה בלבד'),
      external_id: optText(b.externalId, 'מזהה חיצוני', 60),
      active: optBool(b.active, 'פעיל'),
    };
    if (mobile !== undefined) out.mobile_e164 = normaliseE164(mobile);
    return out;
  }

  // ---- קריאה ----

  /** אנשי הקשר של לקוח. ?all=1 מוסיף מושבתים. */
  app.get('/api/clients/:clientId/contacts', async (req) => {
    await requireClient(idOf(req, 'clientId'));
    const { rows } = await ctx.db.query(
      `SELECT ${CONTACT_COLUMNS} FROM contacts ct
        WHERE ct.client_id = $1 AND ($2 OR ct.active)
        ORDER BY ct.active DESC, "displayName"`,
      [idOf(req, 'clientId'), flag(req, 'all')],
    );
    return rows;
  });

  /**
   * זיהוי לפי טלפון — זה המקום שממנו ווטסאפ והמרכזייה מקבלים "מי מתקשר".
   * מקבל כל צורה (050…, 972…, +972…) ומשווה למספר המנורמל.
   */
  app.get('/api/contacts/lookup', async (req) => {
    const phone = (queryOf(req).phone ?? '').trim();
    const e164 = normaliseE164(phone);
    if (!e164) return { e164: null, matches: [] };
    const { rows } = await ctx.db.query(
      `SELECT ${CONTACT_COLUMNS}, c.name AS "clientName",
              s.call_remarks AS "callRemarks", COALESCE(s.offline, false) AS offline
         FROM contacts ct
         JOIN clients c ON c.id = ct.client_id
         LEFT JOIN client_company_settings s ON s.client_id = c.id AND s.company_id = $2
        WHERE ct.mobile_e164 = $1 AND ct.active AND c.active
        ORDER BY c.name LIMIT 20`,
      [e164, ctx.companyId],
    );
    return { e164, digits: waDigits(e164), matches: rows };
  });

  app.get('/api/contacts/:id', async (req) => one(idOf(req)));

  // ---- כתיבה ----

  app.post('/api/clients/:clientId/contacts', async (req) => {
    requireAdmin(ctx);
    const clientId = idOf(req, 'clientId');
    await requireClient(clientId);
    const values = fields(bodyOf(req), true);
    await requireFreeUsername(values.username, null);
    const keys = Object.keys(values).filter((k) => values[k] !== undefined);
    const { rows } = await ctx.db.query<{ id: number }>(
      `INSERT INTO contacts (client_id, ${keys.join(', ')})
       VALUES ($1${keys.map((_, i) => `, $${i + 2}`).join('')}) RETURNING id`,
      [clientId, ...keys.map((k) => values[k])],
    );
    await audit(ctx, 'contact.create', String(rows[0]!.id), { clientId, name: values.first_name }, req.ip);
    await notifyShared(ctx, hub, 'contact', rows[0]!.id);
    return one(rows[0]!.id);
  });

  app.patch('/api/contacts/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    await one(id);
    const values = fields(b, false);
    await requireFreeUsername(values.username, id);
    const patch = patchSet(values, 2);
    if (!patch) throw badRequest('אין מה לעדכן');
    await ctx.db.query(`UPDATE contacts SET ${patch.set} WHERE id = $1`, [id, ...patch.values]);
    await audit(ctx, 'contact.update', String(id), b, req.ip);
    await notifyShared(ctx, hub, 'contact', id);
    return one(id);
  });

  /** השבתה: איש הקשר יוצא מהבוחרים, והקריאות שהוא פתח נשארות. */
  app.delete('/api/contacts/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const { rowCount } = await ctx.db.query('UPDATE contacts SET active = false WHERE id = $1', [id]);
    if (!rowCount) throw notFound(msg('notFound', ctx.lang));
    await audit(ctx, 'contact.deactivate', String(id), null, req.ip);
    await notifyShared(ctx, hub, 'contact', id);
    return { ok: true };
  });

  /**
   * סיסמת הפורטל של איש הקשר (אותו scrypt של הנציגים).
   * { clear: true } מבטל את הכניסה שלו. שם המשתמש נקבע ב-PATCH הרגיל.
   */
  app.post('/api/contacts/:id/password', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    const contact = await one(id);
    const clear = b.clear === true;
    if (!clear && !contact.username) throw badRequest('צריך קודם לקבוע לאיש הקשר שם משתמש');
    if (!clear && (typeof b.password !== 'string' || b.password.length < 8)) {
      throw badRequest('הסיסמה חייבת להכיל לפחות 8 תווים');
    }
    const hash = clear ? null : await hashPassword(String(b.password));
    await ctx.db.query('UPDATE contacts SET password_hash = $2 WHERE id = $1', [id, hash]);
    await audit(ctx, clear ? 'contact.password.clear' : 'contact.password.set', String(id), null, req.ip);
    return { ok: true };
  });
}
