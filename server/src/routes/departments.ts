import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit, can, type Ctx, type Role } from '../context.ts';
import { badRequest, forbidden, notFound } from '../errors.ts';
import { localName, msg } from '../i18n.ts';

/**
 * מחלקות — נתון בסיס משותף לכל ארבע החברות (לטבלה אין company_id בכלל).
 * מה שכן פר חברה הוא השיוך: כמה נציגים של *החברה הפעילה* משויכים למחלקה,
 * ומי יכול להיות מנהל שלה — רק מי שחבר בחברה הפעילה, כי אדמין של חברה אחת
 * לא רואה את האנשים של החברות האחרות.
 *
 * כאן יושבים גם עזרי הקלט המשותפים לכל מודולי התחזוקה (לקוחות, אנשי קשר,
 * טבלאות קוד, פרמטרים, ייבוא). הם לא בקובץ ליבה כי הליבה (context/errors/i18n)
 * אינה בתחום האחריות של המודול הזה; המחלקות הן המודול הראשון שנרשם ולכן
 * המקום הטבעי להחזיק אותם.
 */

// ---------------------------------------------------------------- עזרי בקשה

export const paramsOf = (req: FastifyRequest) => req.params as Record<string, string | undefined>;
export const queryOf = (req: FastifyRequest) => req.query as Record<string, string | undefined>;
export const bodyOf = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

/** מזהה מתוך הנתיב. כל מה שאינו מספר שלם חיובי נדחה לפני שהוא מגיע ל-SQL. */
export function idOf(req: FastifyRequest, name = 'id'): number {
  const id = Number(paramsOf(req)[name]);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('מזהה לא תקין');
  return id;
}

/** דגל בשורת הכתובת, למשל ?all=1 שמחזיר גם רשומות שהושבתו. */
export const flag = (req: FastifyRequest, name: string): boolean => {
  const v = queryOf(req)[name];
  return v === '1' || v === 'true' || v === 'yes';
};

/** כתיבה מותרת למנהל בלבד. קריאה פתוחה לכל מי שמחובר. */
export function requireRole(ctx: Ctx, need: Role): void {
  if (!can(ctx.role, need)) throw forbidden(msg('forbidden', ctx.lang));
}
export const requireAdmin = (ctx: Ctx): void => requireRole(ctx, 'admin');

/** פעולה שנוגעת בכל החברות יחד (השבתת אדם, השבתת לקוח גלובלית) — סופר-אדמין בלבד. */
export function requireSuperadmin(ctx: Ctx): void {
  if (!ctx.user.isSuperadmin) throw forbidden(msg('forbidden', ctx.lang));
}

export function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`חסר שדה: ${field}`);
  const v = value.trim();
  if (v.length > max) throw badRequest(`השדה ${field} ארוך מדי (עד ${max} תווים)`);
  return v;
}

/** undefined = לא נשלח, ולכן לא נוגעים בשדה. null או '' = ניקוי השדה. */
export function optText(value: unknown, field: string, max = 200): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return text(value, field, max);
}

export function optInt(
  value: unknown,
  field: string,
  min = -2147483648,
  max = 2147483647,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`השדה ${field} חייב להיות מספר שלם בין ${min} ל-${max}`);
  }
  return n;
}

export function optNum(value: unknown, field: string, min = 0, max = 1e9): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw badRequest(`השדה ${field} חייב להיות מספר בין ${min} ל-${max}`);
  }
  return n;
}

export function optBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw badRequest(`השדה ${field} חייב להיות כן/לא`);
  return value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: string): boolean => EMAIL_RE.test(v);

export function optEmail(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const v = text(value, field, 200).toLowerCase();
  if (!isEmail(v)) throw badRequest(`${field}: כתובת מייל לא תקינה`);
  return v;
}

/** רשימת מיילים מופרדת בפסיקים (נמענים נוספים להתראות). */
export function optEmailList(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parts = text(value, field, 1000)
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of parts) if (!isEmail(p)) throw badRequest(`${field}: הכתובת ${p} לא תקינה`);
  return parts.join(', ');
}

/**
 * בונה את ה-SET של UPDATE רק מהשדות שנשלחו בפועל. מחזיר null כשאין מה לעדכן,
 * כך שאף מודול לא כותב שורה שלמה על בסיס PATCH חלקי.
 */
export function patchSet(
  fields: Record<string, unknown>,
  offset: number,
): { set: string; values: unknown[] } | null {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return null;
  return { set: keys.map((k, i) => `${k} = $${i + offset}`).join(', '), values: keys.map((k) => fields[k]) };
}

export const isDuplicate = (err: unknown): boolean => (err as { code?: string }).code === '23505';

// ---------------------------------------------------------------- מחלקות

export interface DepartmentRow {
  id: number;
  name: string;
  nameEn: string | null;
  managerId: number | null;
  managerName: string | null;
  active: boolean;
  members: number;
}

const DEPT_COLUMNS = `d.id, d.name, d.name_en AS "nameEn", d.manager_id AS "managerId",
       NULLIF(TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')), '') AS "managerName",
       d.active,
       (SELECT count(*)::int FROM user_companies uc
         WHERE uc.department_id = d.id AND uc.company_id = $1 AND uc.active) AS "members"`;

export function registerDepartmentsRoutes(app: FastifyInstance, ctx: Ctx): void {
  /** המנהל חייב להיות נציג פעיל *בחברה הפעילה* — אחרת אדמין היה ממנה אדם שהוא לא רואה. */
  async function requireCompanyMember(userId: number): Promise<void> {
    const { rows } = await ctx.db.query(
      'SELECT 1 FROM user_companies uc JOIN users u ON u.id = uc.user_id ' +
        'WHERE uc.user_id = $1 AND uc.company_id = $2 AND uc.active AND u.active',
      [userId, ctx.companyId],
    );
    if (!rows[0]) throw badRequest('המנהל שנבחר אינו נציג פעיל בחברה הזו');
  }

  async function one(id: number): Promise<DepartmentRow> {
    const { rows } = await ctx.db.query<DepartmentRow>(
      `SELECT ${DEPT_COLUMNS} FROM departments d LEFT JOIN users m ON m.id = d.manager_id WHERE d.id = $2`,
      [ctx.companyId, id],
    );
    const row = rows[0];
    if (!row) throw notFound(msg('notFound', ctx.lang));
    return row;
  }

  /** ברירת המחדל: רק מחלקות פעילות. ?all=1 מחזיר גם מושבתות, למסך התחזוקה. */
  app.get('/api/departments', async (req) => {
    const { rows } = await ctx.db.query<DepartmentRow>(
      `SELECT ${DEPT_COLUMNS} FROM departments d LEFT JOIN users m ON m.id = d.manager_id
        WHERE ($2 OR d.active) ORDER BY d.active DESC, d.name`,
      [ctx.companyId, flag(req, 'all')],
    );
    return rows.map((r) => ({ ...r, label: localName({ name: r.name, name_en: r.nameEn }, ctx.lang) }));
  });

  app.get('/api/departments/:id', async (req) => one(idOf(req)));

  app.post('/api/departments', async (req) => {
    requireAdmin(ctx);
    const b = bodyOf(req);
    const name = text(b.name, 'שם המחלקה', 80);
    const nameEn = optText(b.nameEn, 'שם באנגלית', 80) ?? null;
    const managerId = optInt(b.managerId, 'מנהל המחלקה') ?? null;
    if (managerId) await requireCompanyMember(managerId);
    const { rows } = await ctx.db.query<{ id: number }>(
      'INSERT INTO departments (name, name_en, manager_id) VALUES ($1,$2,$3) RETURNING id',
      [name, nameEn, managerId],
    );
    const id = rows[0]!.id;
    await audit(ctx, 'department.create', String(id), { name, nameEn, managerId }, req.ip);
    return one(id);
  });

  app.patch('/api/departments/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const b = bodyOf(req);
    const managerId = optInt(b.managerId, 'מנהל המחלקה');
    if (managerId) await requireCompanyMember(managerId);
    const patch = patchSet(
      {
        name: b.name === undefined ? undefined : text(b.name, 'שם המחלקה', 80),
        name_en: optText(b.nameEn, 'שם באנגלית', 80),
        manager_id: managerId,
        active: optBool(b.active, 'פעילה'),
      },
      2,
    );
    if (!patch) throw badRequest('אין מה לעדכן');
    const { rowCount } = await ctx.db.query(`UPDATE departments SET ${patch.set} WHERE id = $1`, [
      id,
      ...patch.values,
    ]);
    if (!rowCount) throw notFound(msg('notFound', ctx.lang));
    await audit(ctx, 'department.update', String(id), b, req.ip);
    return one(id);
  });

  /**
   * השבתה, לא מחיקה: מחלקה מושבתת יוצאת מהבוחרים אבל ההיסטוריה נשארת.
   * מחזיר כמה נציגים של החברה הפעילה עוד משויכים אליה, כדי שהמסך יציג אזהרה.
   */
  app.delete('/api/departments/:id', async (req) => {
    requireAdmin(ctx);
    const id = idOf(req);
    const before = await one(id);
    await ctx.db.query('UPDATE departments SET active = false WHERE id = $1', [id]);
    await audit(ctx, 'department.deactivate', String(id), { name: before.name }, req.ip);
    return { ok: true, members: before.members };
  });
}
