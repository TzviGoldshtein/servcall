import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../auth.ts';
import { audit, type Ctx, type Role } from '../context.ts';
import { badRequest, forbidden, HttpError, notFound } from '../errors.ts';
import type { Hub } from '../http.ts';
import { isLang, msg } from '../i18n.ts';
import {
  bodyOf,
  flag,
  idOf,
  isDuplicate,
  notifyCompany,
  optBool,
  optEmail,
  optEmailList,
  optInt,
  optText,
  patchSet,
  queryOf,
  requireAdmin,
  requireSuperadmin,
  text,
} from './departments.ts';

/**
 * נציגים. האדם עצמו (users) משותף לכל החברות — שם, מייל, שם משתמש, שפה וסיסמה
 * אחת לכל המערכת. מה שנפרד לגמרי הוא השיוך (user_companies): הרשאה, שלוחה,
 * טלפון, מחלקה ומזהה הנהלת חשבונות — שורה לכל חברה.
 *
 * הכלל שמנחה את כל הקובץ: אדמין של חברה אחת עובד רק על השורה של החברה הפעילה.
 * הוא לא רואה ולא משנה שלוחה, הרשאה או מזהה הנה"ח של אותו אדם בחברה אחרת, ולכן
 * כל שאילתה כאן מצטמצמת ל-company_id של ההקשר. השבתת האדם עצמו (בכל החברות)
 * שמורה לסופר-אדמין.
 *
 * זהות הכניסה (מייל, שם משתמש, סיסמה) היא אחת לכל החברות. לכן אדמין של חברה
 * רשאי לגעת בה רק כשהאדם שייך לחברה שלו בלבד: אחרת איפוס סיסמה בקי טלקום היה
 * פותח לאדמין שלה כניסה לחשבון של אותו אדם בקוריץ. אדם שמשויך לעוד חברה, או
 * סופר-אדמין — זהות הכניסה שלו נערכת בידי סופר-אדמין (או בידי האדם עצמו).
 */

const ROLES: Role[] = ['admin', 'agent', 'opener', 'viewer'];

function role(value: unknown, field = 'הרשאה'): Role {
  if (typeof value !== 'string' || !ROLES.includes(value as Role)) throw badRequest(`${field} לא תקינה`);
  return value as Role;
}

/** שלוחה: ספרות וקודי מרכזייה (* # +), כמו בוואטסאפ צוות. */
function optExtension(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const ext = String(value).replace(/\s/g, '');
  if (!/^[0-9*#+]{1,20}$/.test(ext) || !/\d/.test(ext)) {
    throw badRequest('שלוחה יכולה להכיל ספרות ואת התווים * # + בלבד');
  }
  return ext;
}

function optPhone(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const v = text(value, field, 40);
  if (!/^[\d\s+()\-.]{3,40}$/.test(v)) throw badRequest(`${field}: מספר טלפון לא תקין`);
  return v;
}

function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) throw badRequest('הסיסמה חייבת להכיל לפחות 8 תווים');
  if (value.length > 200) throw badRequest('הסיסמה ארוכה מדי');
  return value;
}

export interface UserRow {
  id: number;
  email: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  lang: string;
  isSuperadmin: boolean;
  active: boolean;
  hasPassword: boolean;
  role: Role;
  extension: string | null;
  phone: string | null;
  mobile: string | null;
  companyEmail: string | null;
  recipientsEmail: string | null;
  departmentId: number | null;
  departmentName: string | null;
  externalId: string | null;
  notifyWhenOwner: boolean;
  membershipActive: boolean;
  inOtherCompanies: boolean;
}

// הקריאה מחזירה את האדם + השורה של החברה הפעילה בלבד. inOtherCompanies הוא
// כן/לא ולא פירוט, כדי שלא ייחשף מה הוא עושה בחברה אחרת.
const USER_COLUMNS = `u.id, u.email, u.username, u.first_name AS "firstName", u.last_name AS "lastName",
       u.lang, u.is_superadmin AS "isSuperadmin", u.active,
       (u.password_hash IS NOT NULL) AS "hasPassword",
       uc.role, uc.extension, uc.phone, uc.mobile, uc.email AS "companyEmail",
       uc.recipients_email AS "recipientsEmail", uc.department_id AS "departmentId",
       d.name AS "departmentName", uc.external_id AS "externalId",
       uc.notify_when_owner AS "notifyWhenOwner", uc.active AS "membershipActive",
       EXISTS (SELECT 1 FROM user_companies o
                WHERE o.user_id = u.id AND o.company_id <> uc.company_id AND o.active) AS "inOtherCompanies"`;

export function registerUsersRoutes(app: FastifyInstance, ctx: Ctx, hub?: Hub): void {
  /** ראו ההסבר בראש הקובץ: זהות כניסה משותפת לא נערכת מתוך חברה אחת. */
  async function guardIdentity(id: number): Promise<void> {
    if (ctx.user.isSuperadmin || id === ctx.user.id) return;
    const { rows } = await ctx.db.query(
      `SELECT 1 FROM users u
        WHERE u.id = $1
          AND (u.is_superadmin
               OR EXISTS (SELECT 1 FROM user_companies o WHERE o.user_id = u.id AND o.company_id <> $2))`,
      [id, ctx.companyId],
    );
    if (rows[0]) {
      throw forbidden(
        ctx.lang === 'en'
          ? 'This person also works in another company. Only a superadmin can change their sign-in details'
          : 'האדם הזה משויך גם לחברה אחרת. את פרטי הכניסה שלו (מייל, שם משתמש, סיסמה) משנה סופר-אדמין בלבד',
      );
    }
  }

  function langOf(value: unknown): string {
    if (!isLang(value)) throw badRequest('שפה לא תקינה');
    return value;
  }

  async function one(id: number): Promise<UserRow> {
    const { rows } = await ctx.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users u
         JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = $1
         LEFT JOIN departments d ON d.id = uc.department_id
        WHERE u.id = $2`,
      [ctx.companyId, id],
    );
    const row = rows[0];
    if (!row) throw notFound(msg('notFound', ctx.lang));
    return row;
  }

  /** שדות השיוך לחברה הפעילה. undefined = לא נשלח ולכן לא נוגעים. */
  async function membershipFields(b: Record<string, unknown>): Promise<Record<string, unknown>> {
    const departmentId = optInt(b.departmentId, 'מחלקה');
    if (departmentId) {
      const { rows } = await ctx.db.query('SELECT 1 FROM departments WHERE id = $1 AND active', [departmentId]);
      if (!rows[0]) throw badRequest('המחלקה שנבחרה לא קיימת או מושבתת');
    }
    return {
      role: b.role === undefined ? undefined : role(b.role),
      extension: optExtension(b.extension),
      phone: optPhone(b.phone, 'טלפון'),
      mobile: optPhone(b.mobile, 'נייד'),
      email: optEmail(b.companyEmail, 'מייל בחברה'),
      recipients_email: optEmailList(b.recipientsEmail, 'נמענים נוספים'),
      department_id: departmentId,
      external_id: optText(b.externalId, 'מזהה הנהלת חשבונות', 60),
      notify_when_owner: optBool(b.notifyWhenOwner, 'התראה כשאני האחראי'),
      active: optBool(b.membershipActive, 'שיוך פעיל'),
    };
  }

  /** אסור להוריד לעצמך הרשאה או להשבית את עצמך — אחרת החברה נשארת בלי אדמין. */
  function guardSelf(id: number, fields: Record<string, unknown>): void {
    if (id !== ctx.user.id) return;
    if (fields.role !== undefined && fields.role !== 'admin') throw badRequest('אי אפשר להוריד לעצמך את ההרשאה');
    if (fields.active === false) throw badRequest('אי אפשר להשבית את השיוך של עצמך');
  }

  // ---- קריאה ----

  /** רשימת הנציגים של החברה הפעילה. ?all=1 מוסיף מושבתים. */
  app.get('/api/users', async (req) => {
    const q = queryOf(req);
    const search = (q.q ?? '').trim().slice(0, 60);
    const { rows } = await ctx.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users u
         JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = $1
         LEFT JOIN departments d ON d.id = uc.department_id
        WHERE ($2 OR (u.active AND uc.active))
          AND ($3 = '' OR u.first_name ILIKE '%' || $3 || '%' OR COALESCE(u.last_name,'') ILIKE '%' || $3 || '%'
               OR u.email ILIKE '%' || $3 || '%' OR COALESCE(uc.extension,'') ILIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR uc.role = $4)
          AND ($5::int IS NULL OR uc.department_id = $5)
        ORDER BY u.active DESC, uc.active DESC, u.first_name, u.last_name`,
      [
        ctx.companyId,
        flag(req, 'all'),
        search,
        q.role ? role(q.role) : null,
        q.departmentId ? optInt(q.departmentId, 'מחלקה') ?? null : null,
      ],
    );
    return rows;
  });

  /** בוחרי "אחראי" ו"נציג מטפל": רק נציגים פעילים של החברה הפעילה. */
  app.get('/api/users/options', async () => {
    const { rows } = await ctx.db.query(
      `SELECT u.id, TRIM(u.first_name || ' ' || COALESCE(u.last_name, '')) AS name,
              uc.role, uc.extension
         FROM users u JOIN user_companies uc ON uc.user_id = u.id AND uc.company_id = $1
        WHERE u.active AND uc.active ORDER BY u.first_name, u.last_name`,
      [ctx.companyId],
    );
    return rows;
  });

  /**
   * אנשים שקיימים במערכת ואינם משויכים לחברה הפעילה, כדי לצרף נציג קיים
   * במקום לפתוח לו זהות שנייה. מוחזרים רק שם ומייל — שום פרט פר חברה.
   */
  app.get('/api/users/available', async (req) => {
    requireAdmin(ctx);
    const search = (queryOf(req).q ?? '').trim().slice(0, 60);
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.email, u.first_name AS "firstName", u.last_name AS "lastName"
         FROM users u
        WHERE u.active
          AND NOT EXISTS (SELECT 1 FROM user_companies uc WHERE uc.user_id = u.id AND uc.company_id = $1)
          AND ($2 = '' OR u.first_name ILIKE '%' || $2 || '%' OR COALESCE(u.last_name,'') ILIKE '%' || $2 || '%'
               OR u.email ILIKE '%' || $2 || '%')
        ORDER BY u.first_name, u.last_name LIMIT 30`,
      [ctx.companyId, search],
    );
    return rows;
  });

  app.get('/api/users/:id', async (req) => {
    const user = await one(idOf(req));
    // רק סופר-אדמין רואה את מפת החברות המלאה של אדם
    if (!ctx.user.isSuperadmin) return user;
    const { rows } = await ctx.db.query(
      `SELECT uc.company_id AS "companyId", c.code AS "companyCode", c.name AS "companyName",
              uc.role, uc.extension, uc.active
         FROM user_companies uc JOIN companies c ON c.id = uc.company_id
        WHERE uc.user_id = $1 ORDER BY c.id`,
      [user.id],
    );
    return { ...user, memberships: rows };
  });

  // ---- כתיבה ----

  /** אדם חדש + השיוך שלו לחברה הפעילה, בטרנזקציה אחת. */
  app.post('/api/users', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const email = optEmail(b.email, 'מייל');
    if (!email) throw badRequest('חסר שדה: מייל');
    const firstName = text(b.firstName, 'שם פרטי', 60);
    const lastName = optText(b.lastName, 'שם משפחה', 60) ?? null;
    const username = optText(b.username, 'שם משתמש', 50) ?? null;
    const lang = b.lang === undefined ? 'he' : langOf(b.lang);
    const hash = b.password === undefined || b.password === null || b.password === ''
      ? null
      : await hashPassword(password(b.password));
    const fields = await membershipFields({ ...b, role: b.role ?? 'agent' });

    try {
      const id = await ctx.db.tx(async (tx) => {
        const { rows } = await tx.query<{ id: number }>(
          `INSERT INTO users (email, username, first_name, last_name, lang, password_hash)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [email, username, firstName, lastName, lang, hash],
        );
        const userId = rows[0]!.id;
        const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
        await tx.query(
          `INSERT INTO user_companies (user_id, company_id${keys.length ? ', ' + keys.join(', ') : ''})
           VALUES ($1, $2${keys.map((_, i) => `, $${i + 3}`).join('')})`,
          [userId, ctx.companyId, ...keys.map((k) => fields[k])],
        );
        return userId;
      });
      await audit(ctx, 'user.create', String(id), { email, firstName, role: fields.role }, req.ip);
      notifyCompany(ctx, hub, 'user', id);
      return one(id);
    } catch (err) {
      if (isDuplicate(err)) {
        throw new HttpError(409, 'כבר קיים אדם עם המייל או שם המשתמש הזה. אפשר לצרף אותו לחברה מתוך "נציגים קיימים"');
      }
      throw err;
    }
  });

  /**
   * עדכון: פרטי האדם (משותפים) ובאותה בקשה גם השיוך לחברה הפעילה.
   * company_id בגוף הבקשה נדחה במפורש — השיוך שנערך הוא תמיד של ההקשר.
   */
  app.patch('/api/users/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    if (b.companyId !== undefined && Number(b.companyId) !== ctx.companyId) {
      throw badRequest('אפשר לערוך רק את השיוך של החברה שאתה עובד בה כרגע');
    }
    const before = await one(id); // מוודא שהאדם משויך לחברה הפעילה
    // הטופס שולח את הרשומה כולה; רק שינוי בפועל של שדה מוגן דורש את ההרשאה שלו
    if (b.isSuperadmin !== undefined && b.isSuperadmin !== before.isSuperadmin) requireSuperadmin(ctx);
    if (b.active !== undefined && b.active !== before.active) requireSuperadmin(ctx); // נוגע בכל החברות
    const email = optEmail(b.email, 'מייל');
    const username = optText(b.username, 'שם משתמש', 50);
    if (email === null) throw badRequest('חסר שדה: מייל');
    if (
      (email !== undefined && email !== before.email.toLowerCase()) ||
      (username !== undefined && username !== before.username)
    ) {
      await guardIdentity(id);
    }

    const person = patchSet(
      {
        email,
        username,
        first_name: b.firstName === undefined ? undefined : text(b.firstName, 'שם פרטי', 60),
        last_name: optText(b.lastName, 'שם משפחה', 60),
        lang: b.lang === undefined ? undefined : langOf(b.lang),
        is_superadmin: optBool(b.isSuperadmin, 'סופר-אדמין'),
        active: optBool(b.active, 'פעיל'),
      },
      2,
    );
    const fields = await membershipFields(b);
    guardSelf(id, fields);
    const membership = patchSet(fields, 3);
    if (!person && !membership) throw badRequest('אין מה לעדכן');

    await ctx.db.tx(async (tx) => {
      if (person) {
        try {
          await tx.query(`UPDATE users SET ${person.set} WHERE id = $1`, [id, ...person.values]);
        } catch (err) {
          if (isDuplicate(err)) throw new HttpError(409, 'המייל או שם המשתמש כבר תפוסים');
          throw err;
        }
      }
      if (membership) {
        await tx.query(
          `UPDATE user_companies SET ${membership.set} WHERE user_id = $1 AND company_id = $2`,
          [id, ctx.companyId, ...membership.values],
        );
      }
    });
    await audit(ctx, 'user.update', String(id), b, req.ip);
    // הרשאה שהשתנתה או שיוך שהושבת: החיבור החי נסגר מיד ולא בבקשה הבאה
    if (fields.role !== undefined || fields.active === false || b.active === false) hub?.dropUser(id);
    notifyCompany(ctx, hub, 'user', id);
    return one(id);
  });

  /**
   * צירוף אדם קיים לחברה הפעילה, או עדכון השיוך שלו בה — השורה הזו בלבד.
   * ברירת המחדל "נציג" חלה רק בצירוף חדש; בעדכון, שדה שלא נשלח נשאר כמו שהוא,
   * אחרת שמירה בלי הרשאה הייתה מורידה אדמין לנציג.
   */
  app.put('/api/users/:id/membership', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    const { rows: exists } = await ctx.db.query('SELECT 1 FROM users WHERE id = $1 AND active', [id]);
    if (!exists[0]) throw notFound(msg('notFound', ctx.lang));
    const { rows: member } = await ctx.db.query(
      'SELECT 1 FROM user_companies WHERE user_id = $1 AND company_id = $2',
      [id, ctx.companyId],
    );
    const fields = await membershipFields(member[0] ? b : { ...b, role: b.role ?? 'agent' });
    guardSelf(id, fields);
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    await ctx.db.query(
      `INSERT INTO user_companies (user_id, company_id${keys.length ? ', ' + keys.join(', ') : ''})
       VALUES ($1, $2${keys.map((_, i) => `, $${i + 3}`).join('')})
       ON CONFLICT (user_id, company_id) DO UPDATE SET
       ${keys.length ? keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ') : 'active = user_companies.active'}`,
      [id, ctx.companyId, ...keys.map((k) => fields[k])],
    );
    await audit(ctx, 'user.membership', String(id), { companyId: ctx.companyId, ...b }, req.ip);
    hub?.dropUser(id);
    notifyCompany(ctx, hub, 'user', id);
    return one(id);
  });

  /** השבתת השיוך לחברה הפעילה. האדם והחברות האחרות שלו לא נוגעים. */
  app.delete('/api/users/:id/membership', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    if (id === ctx.user.id) throw badRequest('אי אפשר להשבית את השיוך של עצמך');
    const { rowCount } = await ctx.db.query(
      'UPDATE user_companies SET active = false WHERE user_id = $1 AND company_id = $2',
      [id, ctx.companyId],
    );
    if (!rowCount) throw notFound(msg('notFound', ctx.lang));
    await audit(ctx, 'user.membership.deactivate', String(id), { companyId: ctx.companyId }, req.ip);
    hub?.dropUser(id);
    notifyCompany(ctx, hub, 'user', id);
    return { ok: true };
  });

  /**
   * השבתת האדם עצמו — בכל החברות, ולכן סופר-אדמין בלבד. אדמין של חברה מסירה
   * את השיוך שלו (DELETE על ה-membership) ולא את האדם.
   */
  app.delete('/api/users/:id', async (req) => {
    requireSuperadmin(ctx);
    const id = idOf(req);
    if (id === ctx.user.id) throw badRequest('אי אפשר להשבית את עצמך');
    const { rowCount } = await ctx.db.query('UPDATE users SET active = false WHERE id = $1', [id]);
    if (!rowCount) throw notFound(msg('notFound', ctx.lang));
    await ctx.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(ctx, 'user.deactivate', String(id), null, req.ip);
    hub?.dropUser(id);
    notifyCompany(ctx, hub, 'user', id);
    return { ok: true };
  });

  /**
   * קביעת סיסמה או איפוסה. ה-hash נוצר ב-scrypt של auth.ts; הסיסמה עצמה לא
   * נשמרת ולא נרשמת ביומן. { clear: true } מבטל סיסמה (אז נשארת כניסה דרך
   * ווטסאפ צוות בלבד). כל הסשנים הפתוחים של האדם נסגרים.
   */
  app.post('/api/users/:id/password', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    await one(id); // רק אדם שמשויך לחברה הפעילה
    await guardIdentity(id);
    const clear = b.clear === true;
    const hash = clear ? null : await hashPassword(password(b.password));
    await ctx.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
    await ctx.db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await audit(ctx, clear ? 'user.password.clear' : 'user.password.set', String(id), null, req.ip);
    hub?.dropUser(id);
    return { ok: true };
  });
}
